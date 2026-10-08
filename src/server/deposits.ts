import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { getEnv } from "@/lib/env";
import { decryptField, hmacHex } from "@/lib/crypto";
import { onlyDigits } from "@/lib/cpf";
import { formatMoney } from "@/lib/money";
import { audit } from "./audit";
import { notify } from "./notifications";
import { moneyConfig, isWholeCredits } from "./money-config";
import { getPixProvider } from "./pix";
import { requireActor, requireVerified } from "./permissions";
import { rateLimit } from "./rate-limit";
import { assertWalletOn } from "./settings";
import { requireTeamLeader } from "./team-auth";
import { adminUserIds } from "./admins";
import { freezeWallet, getOrCreateTeamWallet, postLedger } from "./wallet";
import { requireKyc } from "./kyc";
import type { Actor } from "./types";

/**
 * Depósito por Pix na carteira da EQUIPE. Só o líder pode gerar a cobrança.
 * O saldo é creditado EXCLUSIVAMENTE depois de: webhook autenticado → reconsulta da cobrança no provedor
 * → conferência de valor → conferência do CPF do pagador com o do titular (quando o provedor informa).
 */
export async function createDeposit(actorIn: Actor | null, input: { teamId: string; amountCents: number }) {
  await assertWalletOn();
  const actor = requireActor(actorIn);
  requireVerified(actor);
  const cfg = moneyConfig();
  if (!isWholeCredits(input.amountCents)) throw new AppError("O valor deve ser em créditos inteiros (1 crédito = R$ 1,00).");
  if (input.amountCents < cfg.depositMinCents) throw new AppError(`Depósito mínimo: ${formatMoney(cfg.depositMinCents)}.`);
  if (input.amountCents > cfg.depositMaxCents) throw new AppError(`Depósito máximo por Pix: ${formatMoney(cfg.depositMaxCents)}.`);
  const team = await requireTeamLeader(actor, input.teamId);
  const kyc = await requireKyc(actor.id, "submitted");
  await rateLimit(`deposit:${actor.id}`, 10, 3600, "Muitas tentativas de depósito. Aguarde um pouco.");
  const provider = getPixProvider();

  const now = new Date();
  const wallet = await getOrCreateTeamWallet(db, team.id);
  const dayAgo = new Date(now.getTime() - 24 * 3600_000);
  const pending = await db.deposit.count({ where: { userId: actor.id, status: "PENDING", expiresAt: { gt: now } } });
  if (pending >= cfg.depositMaxPending) throw new AppError("Você já tem Pix pendentes. Pague ou aguarde expirarem antes de gerar outro.");
  const today = await db.deposit.aggregate({ _sum: { amountCents: true }, where: { userId: actor.id, createdAt: { gte: dayAgo }, status: { in: ["PENDING", "CONFIRMED", "HELD"] } } });
  if ((today._sum.amountCents ?? 0) + input.amountCents > cfg.depositDailyUserCents) throw new AppError("Limite diário de depósitos atingido.");

  const expiresAt = new Date(now.getTime() + cfg.depositTtlMinutes * 60_000);
  const deposit = await db.deposit.create({
    data: { walletId: wallet.id, teamId: team.id, userId: actor.id, amountCents: input.amountCents, provider: provider.name, expiresAt },
  });
  try {
    const charge = await provider.createCharge({
      externalReference: deposit.id,
      amountCents: input.amountCents,
      expiresAt,
      payer: { name: kyc.fullName, cpf: decryptField(kyc.cpfEnc) },
    });
    const updated = await db.deposit.update({ where: { id: deposit.id }, data: { providerChargeId: charge.chargeId, pixCopyPaste: charge.copyPaste, pixQrImage: charge.qrImage ?? null } });
    await audit(actor.id, "deposit.create", "Deposit", deposit.id, { amountCents: input.amountCents, teamId: team.id });
    return updated;
  } catch (e) {
    await db.deposit.update({ where: { id: deposit.id }, data: { status: "FAILED" } });
    throw e;
  }
}

export type ConfirmResult = "credited" | "held" | "already" | "ignored" | "pending";

/** Chamado pelo webhook. Nunca confia no corpo da notificação: reconsulta a cobrança no provedor. */
export async function confirmDeposit(chargeId: string): Promise<ConfirmResult> {
  const dep = await db.deposit.findUnique({ where: { providerChargeId: chargeId } });
  if (!dep) return "ignored";
  if (dep.status === "CONFIRMED" || dep.status === "REVERSED" || dep.status === "REFUNDED") return "already";
  if (dep.status === "HELD") return "already";
  const info = await getPixProvider().getCharge(chargeId);
  if (info.status !== "PAID") return "pending";

  let hold: string | null = null;
  const payerHash = info.payerDocument ? hmacHex(onlyDigits(info.payerDocument), "cpf") : null;
  const depTeam = await db.team.findUnique({ where: { id: dep.teamId }, select: { deletedAt: true } });
  if (depTeam?.deletedAt) {
    hold = "Pagamento recebido depois que a equipe foi excluída: retido para revisão do administrador.";
  } else if (info.currency && info.currency !== "BRL") {
    hold = `Moeda do pagamento (${info.currency}) diferente de BRL: retido para revisão do administrador.`;
  } else if (info.amountCents !== dep.amountCents) {
    hold = `Valor pago (${formatMoney(info.amountCents)}) diverge do valor da cobrança (${formatMoney(dep.amountCents)}).`;
  } else if (!payerHash && getEnv().pixRequirePayerDoc) {
    hold = "O provedor não informou o CPF de quem pagou. Confira no painel do banco se foi o titular e libere manualmente.";
  } else if (payerHash) {
    const kyc = await db.kycProfile.findUnique({ where: { userId: dep.userId } });
    if (!kyc || kyc.cpfHash !== payerHash) hold = "O CPF de quem pagou não confere com o titular da conta (terceiros não podem depositar).";
  }

  const credited = await db.$transaction(async (tx) => {
    const res = await tx.deposit.updateMany({
      where: { id: dep.id, status: { in: ["PENDING", "EXPIRED"] } },
      data: { status: hold ? "HELD" : "CONFIRMED", confirmedAt: hold ? null : new Date(), payerDocHash: payerHash, holdReason: hold },
    });
    if (res.count === 0) return "already" as const;
    if (hold) {
      await audit(null, "deposit.held", "Deposit", dep.id, { reason: hold }, tx);
      return "held" as const;
    }
    await postLedger(tx, {
      walletId: dep.walletId,
      type: "DEPOSIT",
      available: dep.amountCents,
      refType: "deposit",
      refId: dep.id,
      key: `deposit:${dep.id}`,
      memo: "Depósito via Pix",
      actorId: dep.userId,
      allowFrozen: true,
    });
    await audit(null, "deposit.credited", "Deposit", dep.id, { amountCents: dep.amountCents, payerVerified: !!payerHash }, tx);
    return "credited" as const;
  });

  if (credited === "credited") await notify(dep.userId, "deposit.credited", "Depósito confirmado", `${formatMoney(dep.amountCents)} em créditos já estão na carteira da equipe.`, "/carteira");
  if (credited === "held") {
    await notify(await adminUserIds(), "deposit.held", "Depósito retido para revisão", hold ?? "", "/admin/carteiras");
    await notify(dep.userId, "deposit.held", "Depósito em análise", "Recebemos o Pix, mas ele precisa de uma verificação antes de virar crédito.", "/carteira");
  }
  return credited;
}

/** Estorno/MED/chargeback: retira o crédito. Sem saldo suficiente, vira dívida e a carteira é congelada. */
export async function reverseDeposit(chargeId: string): Promise<"reversed" | "already" | "ignored"> {
  const dep = await db.deposit.findUnique({ where: { providerChargeId: chargeId } });
  if (!dep) return "ignored";
  if (dep.status === "HELD") {
    // Estornado ENQUANTO retido: nenhum crédito foi dado, então o valor já "voltou" ao pagador. Vai para REFUNDED (como um retido
    // devolvido pelo admin: sem lançamento no razão, a conciliação continua fechando) e o admin não pode mais liberá-lo.
    const held = await getPixProvider().getCharge(chargeId);
    if (held.status !== "REVERSED") return "ignored";
    const r = await db.deposit.updateMany({ where: { id: dep.id, status: "HELD" }, data: { status: "REFUNDED", holdReason: `${dep.holdReason ?? ""} | Estornado pelo provedor enquanto retido.` } });
    if (r.count === 0) return "already";
    await audit(null, "deposit.reversed_while_held", "Deposit", dep.id, { amountCents: dep.amountCents });
    return "reversed";
  }
  if (dep.status !== "CONFIRMED") return "already";
  const info = await getPixProvider().getCharge(chargeId);
  if (info.status !== "REVERSED") return "ignored";
  return db.$transaction(async (tx) => {
    const res = await tx.deposit.updateMany({ where: { id: dep.id, status: "CONFIRMED" }, data: { status: "REVERSED" } });
    if (res.count === 0) return "already" as const;
    const w = await tx.wallet.findUniqueOrThrow({ where: { id: dep.walletId } });
    const take = Math.min(w.balanceCents, dep.amountCents);
    if (take > 0) {
      await postLedger(tx, { walletId: dep.walletId, type: "DEPOSIT_REVERSAL", available: -take, refType: "deposit", refId: dep.id, key: `deposit-reversal:${dep.id}`, memo: "Estorno do Pix (MED/chargeback)", allowFrozen: true });
    }
    const shortfall = dep.amountCents - take;
    if (shortfall > 0) await tx.wallet.update({ where: { id: dep.walletId }, data: { debtCents: { increment: shortfall } } });
    await freezeWallet(tx, dep.walletId, "Depósito estornado pelo provedor/banco: carteira em análise.");
    await audit(null, "deposit.reversed", "Deposit", dep.id, { amountCents: dep.amountCents, debited: take, shortfall }, tx);
    return "reversed" as const;
  });
}

/**
 * O provedor avisou que a cobrança venceu (sessão ou Pix expirado): sai da fila de pendentes. Não mexe em dinheiro e, como
 * `expireDeposits`, deixa o depósito EXPIRED confirmável: um pagamento tardio ainda é conferido e creditado pelo caminho normal.
 */
export async function expireDepositByCharge(chargeId: string): Promise<"expired" | "already" | "ignored"> {
  const dep = await db.deposit.findUnique({ where: { providerChargeId: chargeId } });
  if (!dep) return "ignored";
  const res = await db.deposit.updateMany({ where: { id: dep.id, status: "PENDING" }, data: { status: "EXPIRED" } });
  if (res.count === 0) return "already";
  await audit(null, "deposit.expired_by_provider", "Deposit", dep.id);
  return "expired";
}

/**
 * Rede de segurança para o webhook perdido: o provedor pode falhar ao entregar (ou o site estar fora do ar naquele minuto) e um Pix
 * PAGO nunca seria creditado. A cada ciclo do agendador reconsulta, no provedor, as cobranças ainda pendentes com alguns minutos de
 * vida; `confirmDeposit` credita só o que o provedor confirma como pago (mesmas conferências do webhook).
 */
export async function reconcilePendingDeposits(now = new Date(), limit = 20): Promise<{ checked: number; credited: number }> {
  const due = await db.deposit.findMany({
    where: { status: "PENDING", providerChargeId: { not: null }, createdAt: { lt: new Date(now.getTime() - 3 * 60_000) }, expiresAt: { gt: new Date(now.getTime() - 30 * 60_000) } },
    orderBy: { createdAt: "asc" },
    take: limit,
    select: { providerChargeId: true },
  });
  let credited = 0;
  for (const d of due) {
    try {
      const r = await confirmDeposit(d.providerChargeId!);
      if (r === "credited") credited++;
    } catch (e) {
      console.error(`[depósitos] Não consegui reconsultar a cobrança ${d.providerChargeId}: ${e instanceof Error ? e.message : e}`);
    }
  }
  return { checked: due.length, credited };
}

/** Marca como expirados os Pix que passaram do prazo (um pagamento tardio ainda pode ser confirmado). */
export async function expireDeposits(now = new Date()): Promise<number> {
  const r = await db.deposit.updateMany({ where: { status: "PENDING", expiresAt: { lt: now } }, data: { status: "EXPIRED" } });
  return r.count;
}

export async function resolveHeldDeposit(actorIn: Actor | null, depositId: string, decision: "credit" | "refund", note: string) {
  const actor = requireActor(actorIn);
  if (actor.role !== "ADMIN") throw new AppError("Apenas administradores podem resolver depósitos retidos.", "FORBIDDEN");
  if (note.trim().length < 5) throw new AppError("Descreva a decisão (mínimo de 5 caracteres).");
  const dep = await db.deposit.findUnique({ where: { id: depositId } });
  if (!dep || dep.status !== "HELD") throw new AppError("Depósito não está retido.", "NOT_FOUND");
  const team = await db.team.findUnique({ where: { id: dep.teamId }, include: { members: true } });
  if (team?.members.some((m) => m.userId === actor.id) || dep.userId === actor.id) throw new AppError("Conflito de interesse: você pertence a esta equipe.", "FORBIDDEN");
  if (decision === "credit" && dep.providerChargeId) {
    // Liberar é creditar dinheiro: confirma de novo, no provedor, que o Pix continua pago (não foi estornado nem cancelado).
    const info = await getPixProvider().getCharge(dep.providerChargeId);
    if (info.status !== "PAID") throw new AppError("O provedor não mostra este Pix como pago (estornado ou cancelado). Não é possível creditar; devolva o valor.");
  }
  await db.$transaction(async (tx) => {
    const res = await tx.deposit.updateMany({
      where: { id: dep.id, status: "HELD" },
      data: { status: decision === "credit" ? "CONFIRMED" : "REFUNDED", confirmedAt: decision === "credit" ? new Date() : null, holdReason: `${dep.holdReason ?? ""} | Decisão: ${note.trim()}` },
    });
    if (res.count === 0) return;
    if (decision === "credit") {
      await postLedger(tx, { walletId: dep.walletId, type: "DEPOSIT", available: dep.amountCents, refType: "deposit", refId: dep.id, key: `deposit:${dep.id}`, memo: "Depósito liberado após revisão", actorId: actor.id, allowFrozen: true });
    }
    await audit(actor.id, `deposit.held.${decision}`, "Deposit", dep.id, { note }, tx);
  });
  await notify(dep.userId, "deposit.resolved", decision === "credit" ? "Depósito liberado" : "Depósito devolvido", note.trim(), "/carteira");
}

export async function listDeposits(teamId: string, take = 20) {
  return db.deposit.findMany({ where: { teamId }, orderBy: { createdAt: "desc" }, take });
}

