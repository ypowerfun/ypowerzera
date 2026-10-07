import { Prisma, type LedgerEntry, type LedgerType, type Wallet } from "@prisma/client";
import { db, type Tx, type TxClient } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { moneyConfig } from "./money-config";

/**
 * Núcleo da carteira: razão contábil IMUTÁVEL com idempotência.
 *
 * Regras que protegem o saldo:
 *  1. Todo movimento é um LedgerEntry; o saldo da carteira só muda junto com um lançamento, na mesma transação.
 *  2. Saídas usam UPDATE condicional (saldo >= valor) — o saldo nunca fica negativo, mesmo com requisições concorrentes.
 *  3. Cada lançamento tem uma chave de idempotência única: repetir o mesmo evento não repete o dinheiro.
 *  4. Lançamentos nunca são editados nem apagados. Correções são novos lançamentos (ADJUSTMENT).
 *  5. `reconcileAll` confere carteira × razão e a conservação do dinheiro entre as carteiras.
 */

export const PLATFORM_WALLET_ID = "platform";

export async function getOrCreateTeamWallet(tx: Tx, teamId: string): Promise<Wallet> {
  const existing = await tx.wallet.findUnique({ where: { teamId } });
  if (existing) return existing;
  try {
    return await tx.wallet.create({ data: { teamId, kind: "TEAM" } });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return tx.wallet.findUniqueOrThrow({ where: { teamId } });
    throw e;
  }
}

export async function getPlatformWallet(tx: Tx): Promise<Wallet> {
  const existing = await tx.wallet.findUnique({ where: { id: PLATFORM_WALLET_ID } });
  if (existing) return existing;
  try {
    return await tx.wallet.create({ data: { id: PLATFORM_WALLET_ID, kind: "PLATFORM" } });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") return tx.wallet.findUniqueOrThrow({ where: { id: PLATFORM_WALLET_ID } });
    throw e;
  }
}

export interface LedgerOp {
  walletId: string;
  type: LedgerType;
  /** Variação do saldo disponível (centavos, com sinal). */
  available: number;
  /** Variação do saldo bloqueado (centavos, com sinal). */
  locked?: number;
  refType: string;
  refId: string;
  /** Chave única do evento (ex.: "deposit:abc"). */
  key: string;
  memo?: string;
  actorId?: string | null;
  /** Permite movimentar mesmo com a carteira congelada (depósitos recebidos, ajustes, liberações). */
  allowFrozen?: boolean;
}

/** Lança no razão e atualiza o saldo de forma atômica e idempotente. */
export async function postLedger(tx: TxClient, op: LedgerOp): Promise<LedgerEntry> {
  const locked = op.locked ?? 0;
  if (!Number.isInteger(op.available) || !Number.isInteger(locked)) throw new Error("Valores do razão devem ser inteiros (centavos).");
  if (op.available === 0 && locked === 0) throw new Error("Lançamento sem valor.");

  const existing = await tx.ledgerEntry.findUnique({ where: { idempotencyKey: op.key } });
  if (existing) {
    if (existing.walletId !== op.walletId || existing.type !== op.type || existing.availableDeltaCents !== op.available || existing.lockedDeltaCents !== locked) {
      throw new Error(`Chave de idempotência reutilizada com dados diferentes: ${op.key}`);
    }
    return existing;
  }

  const where: Prisma.WalletWhereInput = { id: op.walletId };
  if (op.available < 0) where.balanceCents = { gte: -op.available };
  if (locked < 0) where.lockedCents = { gte: -locked };
  if (!op.allowFrozen && (op.available < 0 || op.type === "STAKE_LOCK")) where.frozenAt = null;

  const res = await tx.wallet.updateMany({
    where,
    data: { balanceCents: { increment: op.available }, lockedCents: { increment: locked }, version: { increment: 1 } },
  });
  if (res.count === 0) {
    const w = await tx.wallet.findUnique({ where: { id: op.walletId } });
    if (!w) throw new AppError("Carteira não encontrada.", "NOT_FOUND");
    if (w.frozenAt && !op.allowFrozen) throw new AppError("Esta carteira está congelada. Entre em contato com o suporte.", "FORBIDDEN");
    throw new AppError("Saldo insuficiente.");
  }
  const w = await tx.wallet.findUniqueOrThrow({ where: { id: op.walletId } });
  return tx.ledgerEntry.create({
    data: {
      walletId: op.walletId,
      type: op.type,
      availableDeltaCents: op.available,
      lockedDeltaCents: locked,
      balanceAfterCents: w.balanceCents,
      lockedAfterCents: w.lockedCents,
      refType: op.refType,
      refId: op.refId,
      idempotencyKey: op.key,
      memo: op.memo,
      actorId: op.actorId ?? null,
    },
  });
}

export async function freezeWallet(tx: Tx, walletId: string, reason: string): Promise<void> {
  await tx.wallet.updateMany({ where: { id: walletId, frozenAt: null }, data: { frozenAt: new Date(), frozenReason: reason.slice(0, 300) } });
}

export async function unfreezeWallet(tx: Tx, walletId: string): Promise<void> {
  await tx.wallet.update({ where: { id: walletId }, data: { frozenAt: null, frozenReason: null } });
}

// ───────────────────────── Quanto pode ser sacado ─────────────────────────

export interface WithdrawableBreakdown {
  balanceCents: number;
  lockedCents: number;
  /** Depósitos que ainda não foram "jogados" (apostados) em desafios. */
  unplayedDepositsCents: number;
  /** Depósitos dentro da janela de retenção (estorno/MED). */
  recentDepositsCents: number;
  /** Prêmios dentro da janela de contestação. */
  recentWinsCents: number;
  withdrawableCents: number;
}

/**
 * Regra anti-lavagem e anti-estorno: só se saca o que foi GANHO.
 *  - depósito precisa ser apostado ao menos uma vez (giro) antes de sair;
 *  - depósitos recentes ficam retidos pela janela do estorno/MED do Pix;
 *  - prêmios recentes ficam retidos pela janela de contestação.
 * retido = max(depósitos não jogados, depósitos recentes) + prêmios recentes.
 */
export async function withdrawableBreakdown(tx: Tx, walletId: string, now = new Date()): Promise<WithdrawableBreakdown> {
  const cfg = moneyConfig();
  const w = await tx.wallet.findUniqueOrThrow({ where: { id: walletId } });
  const sum = async (type: LedgerType, since?: Date, field: "availableDeltaCents" | "lockedDeltaCents" = "availableDeltaCents") => {
    const r = await tx.ledgerEntry.aggregate({ _sum: { [field]: true }, where: { walletId, type, ...(since ? { createdAt: { gte: since } } : {}) } });
    return (r._sum[field] as number | null) ?? 0;
  };
  const deposited = (await sum("DEPOSIT")) + (await sum("DEPOSIT_REVERSAL"));
  // stake "jogada" = perdida (STAKE_LOSS) ou devolvida ao vencedor após o jogo (STAKE_RETURN); ambas reduzem o bloqueado
  const playedLost = -(await sum("STAKE_LOSS", undefined, "lockedDeltaCents"));
  const playedWon = -(await sum("STAKE_RETURN", undefined, "lockedDeltaCents"));
  const played = playedLost + playedWon;
  const unplayed = Math.max(0, deposited - played);
  const recentDeposits = Math.max(0, await sum("DEPOSIT", new Date(now.getTime() - cfg.depositHoldHours * 3600_000)));
  const recentWins = Math.max(0, await sum("PRIZE_WIN", new Date(now.getTime() - cfg.winHoldHours * 3600_000)));
  // Saldo de time EXCLUÍDO e já liberado pelo admin: ele revisou o caso, então não vale a retenção de giro/72h.
  const team = w.teamId ? await tx.team.findUnique({ where: { id: w.teamId }, select: { deletedAt: true, balanceReleasedAt: true } }) : null;
  if (team?.deletedAt && team.balanceReleasedAt) {
    return { balanceCents: w.balanceCents, lockedCents: w.lockedCents, unplayedDepositsCents: 0, recentDepositsCents: 0, recentWinsCents: 0, withdrawableCents: w.balanceCents };
  }
  const retained = Math.max(unplayed, recentDeposits) + recentWins;
  return {
    balanceCents: w.balanceCents,
    lockedCents: w.lockedCents,
    unplayedDepositsCents: unplayed,
    recentDepositsCents: recentDeposits,
    recentWinsCents: recentWins,
    withdrawableCents: Math.max(0, w.balanceCents - retained),
  };
}

// ───────────────────────── Auditoria contábil ─────────────────────────

export interface ReconcileResult {
  ok: boolean;
  wallets: Array<{ walletId: string; balance: number; ledgerBalance: number; locked: number; ledgerLocked: number }>;
  mismatches: string[];
  /** Soma líquida dos movimentos internos (deve ser 0: dinheiro só muda de lugar). */
  internalNetCents: number;
  depositsLedgerCents: number;
  depositsTableCents: number;
  withdrawalsPaidLedgerCents: number;
  withdrawalsPaidTableCents: number;
}

const INTERNAL: LedgerType[] = ["WITHDRAWAL_HOLD", "WITHDRAWAL_RELEASE", "STAKE_LOCK", "STAKE_REFUND", "STAKE_LOSS", "STAKE_RETURN", "PRIZE_WIN", "FEE"];

/** Confere (1) saldo de cada carteira = soma do razão, (2) conservação do dinheiro, (3) razão × depósitos/saques. */
export async function reconcileAll(tx: Tx = db): Promise<ReconcileResult> {
  const wallets = await tx.wallet.findMany();
  const out: ReconcileResult["wallets"] = [];
  const mismatches: string[] = [];
  for (const w of wallets) {
    const r = await tx.ledgerEntry.aggregate({ _sum: { availableDeltaCents: true, lockedDeltaCents: true }, where: { walletId: w.id } });
    const lb = r._sum.availableDeltaCents ?? 0;
    const ll = r._sum.lockedDeltaCents ?? 0;
    out.push({ walletId: w.id, balance: w.balanceCents, ledgerBalance: lb, locked: w.lockedCents, ledgerLocked: ll });
    if (lb !== w.balanceCents) mismatches.push(`Carteira ${w.id}: saldo ${w.balanceCents} ≠ razão ${lb}`);
    if (ll !== w.lockedCents) mismatches.push(`Carteira ${w.id}: bloqueado ${w.lockedCents} ≠ razão ${ll}`);
    if (w.balanceCents < 0 || w.lockedCents < 0) mismatches.push(`Carteira ${w.id}: saldo negativo`);
  }
  const internal = await tx.ledgerEntry.aggregate({ _sum: { availableDeltaCents: true, lockedDeltaCents: true }, where: { type: { in: INTERNAL } } });
  const internalNet = (internal._sum.availableDeltaCents ?? 0) + (internal._sum.lockedDeltaCents ?? 0);
  if (internalNet !== 0) mismatches.push(`Conservação violada: movimentos internos somam ${internalNet}`);

  const depLedger = (await tx.ledgerEntry.aggregate({ _sum: { availableDeltaCents: true }, where: { type: "DEPOSIT" } }))._sum.availableDeltaCents ?? 0;
  const depTable = (await tx.deposit.aggregate({ _sum: { amountCents: true }, where: { status: { in: ["CONFIRMED", "REVERSED"] } } }))._sum.amountCents ?? 0;
  if (depLedger !== depTable) mismatches.push(`Depósitos: razão ${depLedger} ≠ tabela ${depTable}`);
  const wdLedger = -((await tx.ledgerEntry.aggregate({ _sum: { lockedDeltaCents: true }, where: { type: "WITHDRAWAL_PAID" } }))._sum.lockedDeltaCents ?? 0);
  // o razão registra o valor LÍQUIDO enviado ao banco (a tarifa é lançada à parte como FEE)
  const wdTable = (await tx.withdrawal.aggregate({ _sum: { netCents: true }, where: { status: "PAID" } }))._sum.netCents ?? 0;
  if (wdLedger !== wdTable) mismatches.push(`Saques pagos: razão ${wdLedger} ≠ tabela ${wdTable}`);

  return {
    ok: mismatches.length === 0,
    wallets: out,
    mismatches,
    internalNetCents: internalNet,
    depositsLedgerCents: depLedger,
    depositsTableCents: depTable,
    withdrawalsPaidLedgerCents: wdLedger,
    withdrawalsPaidTableCents: wdTable,
  };
}

export async function walletOverview(teamId: string) {
  const wallet = await db.wallet.findUnique({ where: { teamId } });
  if (!wallet) return null;
  const breakdown = await withdrawableBreakdown(db, wallet.id);
  return { wallet, breakdown };
}
