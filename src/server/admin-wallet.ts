import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { audit } from "./audit";
import { moneyConfig } from "./money-config";
import { notify } from "./notifications";
import { requireActor } from "./permissions";
import { freezeWallet, postLedger, reconcileAll, unfreezeWallet } from "./wallet";
import { MANUAL_PAYOUT, notManualPayout } from "./withdrawals";
import type { Actor } from "./types";

async function adminOutsideTeam(actorIn: Actor | null, walletId: string) {
  const actor = requireActor(actorIn);
  if (actor.role !== "ADMIN") throw new AppError("Apenas administradores.", "FORBIDDEN");
  const wallet = await db.wallet.findUnique({ where: { id: walletId } });
  if (!wallet) throw new AppError("Carteira não encontrada.", "NOT_FOUND");
  if (wallet.teamId) {
    const member = await db.teamMember.findFirst({ where: { teamId: wallet.teamId, userId: actor.id } });
    if (member) throw new AppError("Conflito de interesse: você pertence a esta equipe.", "FORBIDDEN");
  }
  return { actor, wallet };
}

export async function adminFreezeWallet(actorIn: Actor | null, walletId: string, reason: string) {
  const { actor } = await adminOutsideTeam(actorIn, walletId);
  if (reason.trim().length < 10) throw new AppError("Descreva o motivo (mínimo de 10 caracteres).");
  await freezeWallet(db, walletId, reason.trim());
  await audit(actor.id, "wallet.freeze", "Wallet", walletId, { reason });
}

export async function adminUnfreezeWallet(actorIn: Actor | null, walletId: string, note: string) {
  const { actor, wallet } = await adminOutsideTeam(actorIn, walletId);
  if (note.trim().length < 10) throw new AppError("Descreva o que foi verificado (mínimo de 10 caracteres).");
  if (wallet.debtCents > 0) throw new AppError("A carteira tem dívida pendente. Regularize (ajuste) antes de descongelar.");
  await unfreezeWallet(db, walletId);
  await audit(actor.id, "wallet.unfreeze", "Wallet", walletId, { note });
}

/**
 * Ajuste manual (correção contábil). É um NOVO lançamento no razão — nunca se edita o histórico.
 * Travas: admin sem vínculo com a equipe, motivo detalhado, teto por operação, auditoria.
 */
export async function adminAdjustWallet(actorIn: Actor | null, walletId: string, amountCents: number, note: string) {
  const { actor, wallet } = await adminOutsideTeam(actorIn, walletId);
  if (!Number.isInteger(amountCents) || amountCents === 0) throw new AppError("Informe um valor inteiro em centavos, diferente de zero.");
  if (Math.abs(amountCents) > 200_000) throw new AppError("Ajustes acima de R$ 2.000,00 exigem um processo próprio (contate o responsável pela plataforma).");
  if (note.trim().length < 15) throw new AppError("Descreva detalhadamente o motivo do ajuste (mínimo de 15 caracteres).");
  const entry = await db.$transaction(async (tx) => {
    const e = await postLedger(tx, {
      walletId,
      type: "ADJUSTMENT",
      available: amountCents,
      refType: "adjustment",
      refId: walletId,
      key: `adjust:${walletId}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
      memo: note.trim().slice(0, 200),
      actorId: actor.id,
      allowFrozen: true,
    });
    if (amountCents > 0 && wallet.debtCents > 0) {
      await tx.wallet.update({ where: { id: walletId }, data: { debtCents: Math.max(0, wallet.debtCents - amountCents) } });
    }
    await audit(actor.id, "wallet.adjust", "Wallet", walletId, { amountCents, note }, tx);
    return e;
  });
  if (wallet.teamId) {
    const team = await db.team.findUnique({ where: { id: wallet.teamId } });
    if (team) await notify(team.ownerId, "wallet.adjusted", "Ajuste na carteira", note.trim(), `/carteira/${team.id}`);
  }
  return entry;
}

/** Roda a conciliação e, se algo estiver errado, registra alerta de segurança. */
export async function runReconciliation() {
  const r = await reconcileAll();
  if (!r.ok) {
    console.error("[CONCILIAÇÃO] inconsistências:", r.mismatches);
    await audit(null, "security.reconciliation_failed", "System", "wallets", { mismatches: r.mismatches.slice(0, 20) });
  }
  return r;
}

export async function adminOverview() {
  const [kyc, review, held, disputed, processing, manualPayouts, frozen, releasePending] = await Promise.all([
    db.kycProfile.count({ where: { status: "PENDING" } }),
    db.withdrawal.count({ where: { status: "UNDER_REVIEW" } }),
    db.deposit.count({ where: { status: "HELD" } }),
    db.challenge.count({ where: { status: "DISPUTED" } }),
    db.withdrawal.count({ where: { status: "PROCESSING", ...notManualPayout, updatedAt: { lt: new Date(Date.now() - 10 * 60_000) } } }),
    db.withdrawal.count({ where: { status: "PROCESSING", provider: MANUAL_PAYOUT } }),
    db.wallet.count({ where: { frozenAt: { not: null } } }),
    db.walletReleaseRequest.count({ where: { status: "PENDING" } }),
  ]);
  const platform = await db.wallet.findUnique({ where: { id: "platform" } });
  return { kyc, review, held, disputed, processing, manualPayouts, frozen, releasePending, platformCents: platform?.balanceCents ?? 0, limits: moneyConfig() };
}
