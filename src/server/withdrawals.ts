import { randomInt } from "node:crypto";
import { Prisma, type Withdrawal } from "@prisma/client";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { getEnv } from "@/lib/env";
import { hmacHex, safeEqual, verifyPassword } from "@/lib/crypto";
import { formatMoney } from "@/lib/money";
import { onlyDigits } from "@/lib/cpf";
import { audit } from "./audit";
import { getVerifiedCpf, requireKyc } from "./kyc";
import { moneyConfig, isWholeCredits } from "./money-config";
import { notify } from "./notifications";
import { sendMail } from "./mailer";
import { requireActor, requireVerified } from "./permissions";
import { getPixProvider, type TransferAuthRequest } from "./pix";
import { rateLimit } from "./rate-limit";
import { assessWithdrawalRisk, type RiskFlag } from "./risk";
import { requireTeamLeader } from "./team-auth";
import { getOrCreateTeamWallet, getPlatformWallet, postLedger, withdrawableBreakdown } from "./wallet";
import type { Actor } from "./types";

const OPEN: Withdrawal["status"][] = ["PENDING_CONFIRMATION", "UNDER_REVIEW", "APPROVED", "PROCESSING"];

const otpHash = (code: string, withdrawalId: string) => hmacHex(`${withdrawalId}:${code}`, "withdrawal-otp");

/**
 * Pedido de saque. Só o LÍDER da equipe, com identidade verificada (KYC), pode pedir — e o dinheiro só sai para
 * a chave Pix CPF do PRÓPRIO titular. Camadas, em ordem:
 *   senha de novo (re-autenticação) → limites → saldo sacável (giro + retenções) → fundos BLOQUEADOS na hora →
 *   código por e-mail (OTP) → pontuação de risco → revisão humana (se arriscado) → atraso com janela de cancelamento →
 *   o provedor ainda pergunta ao nosso servidor antes de executar (autorização de transferência).
 */
export async function requestWithdrawal(
  actorIn: Actor | null,
  input: { teamId: string; amountCents: number; password: string; nonce: string },
): Promise<{ withdrawalId: string }> {
  const env = getEnv();
  if (!env.walletEnabled) throw new AppError("A carteira está desativada.", "FORBIDDEN");
  if (env.payoutsPaused) throw new AppError("Saques temporariamente pausados para manutenção. Tente novamente mais tarde.", "FORBIDDEN");
  const actor = requireActor(actorIn);
  requireVerified(actor);
  const cfg = moneyConfig();

  const nonce = (input.nonce ?? "").trim();
  if (nonce.length < 8 || nonce.length > 64) throw new AppError("Requisição inválida. Recarregue a página e tente de novo.");
  const dup = await db.withdrawal.findUnique({ where: { requestedById_requestNonce: { requestedById: actor.id, requestNonce: nonce } } });
  if (dup) return { withdrawalId: dup.id }; // reenvio do mesmo formulário: não duplica

  if (!isWholeCredits(input.amountCents)) throw new AppError("O valor deve ser em créditos inteiros (1 crédito = R$ 1,00).");
  if (input.amountCents < cfg.withdrawMinCents) throw new AppError(`Saque mínimo: ${formatMoney(cfg.withdrawMinCents)}.`);
  if (input.amountCents > cfg.withdrawMaxCents) throw new AppError(`Saque máximo por pedido: ${formatMoney(cfg.withdrawMaxCents)}.`);
  if (cfg.withdrawFeeCents >= input.amountCents) throw new AppError("Valor menor que a tarifa de saque.");

  const team = await requireTeamLeader(actor, input.teamId);
  const kyc = await requireKyc(actor.id, "verified");
  const user = await db.user.findUniqueOrThrow({ where: { id: actor.id } });
  if (user.bannedAt) throw new AppError("Conta suspensa.", "FORBIDDEN");
  if (Date.now() - user.createdAt.getTime() < cfg.accountMinAgeHours * 3600_000) {
    throw new AppError(`Contas novas só podem sacar após ${cfg.accountMinAgeHours} horas do cadastro.`, "FORBIDDEN");
  }
  if (user.withdrawalLockedUntil && user.withdrawalLockedUntil > new Date()) {
    throw new AppError("Por segurança, saques ficam bloqueados por um período após alterar a senha. Tente novamente mais tarde.", "FORBIDDEN");
  }

  await rateLimit(`wd:req:${actor.id}`, 5, 3600, "Muitos pedidos de saque. Aguarde antes de tentar de novo.");
  await rateLimit(`wd:pw:${actor.id}`, 6, 900, "Muitas tentativas de senha. Aguarde 15 minutos.");
  if (!(await verifyPassword(input.password ?? "", user.passwordHash))) throw new AppError("Senha incorreta.", "UNAUTHENTICATED");

  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const now = new Date();
  const wd = await db.$transaction(
    async (tx) => {
      const wallet = await getOrCreateTeamWallet(tx, team.id);
      if (wallet.frozenAt) throw new AppError("Esta carteira está congelada. Entre em contato com o suporte.", "FORBIDDEN");
      const since = new Date(now.getTime() - 24 * 3600_000);
      const recent = await tx.withdrawal.findMany({ where: { walletId: wallet.id, createdAt: { gte: since }, status: { notIn: ["CANCELED", "REJECTED", "FAILED"] } } });
      if (recent.length >= cfg.withdrawDailyCount) throw new AppError("Limite diário de saques atingido para esta equipe.");
      if (recent.reduce((s, w) => s + w.amountCents, 0) + input.amountCents > cfg.withdrawDailyTeamCents) throw new AppError("Limite diário de valor sacado atingido para esta equipe.");
      const awaiting = await tx.withdrawal.count({ where: { walletId: wallet.id, status: "PENDING_CONFIRMATION" } });
      if (awaiting >= 2) throw new AppError("Confirme ou cancele os saques pendentes antes de pedir outro.");

      const b = await withdrawableBreakdown(tx, wallet.id, now);
      if (input.amountCents > b.withdrawableCents) {
        throw new AppError(
          `Saldo sacável: ${formatMoney(b.withdrawableCents)}. Depósitos precisam ser jogados em desafios antes de sair, ` +
            `e depósitos/prêmios recentes ficam retidos por segurança.`,
        );
      }
      const w = await tx.withdrawal.create({
        data: {
          walletId: wallet.id,
          teamId: team.id,
          requestedById: actor.id,
          amountCents: input.amountCents,
          feeCents: cfg.withdrawFeeCents,
          netCents: input.amountCents - cfg.withdrawFeeCents,
          destinationCpfLast4: kyc.cpfLast4,
          requestNonce: nonce,
          otpHash: "pending",
          otpExpiresAt: new Date(now.getTime() + cfg.otpTtlMinutes * 60_000),
        },
      });
      await tx.withdrawal.update({ where: { id: w.id }, data: { otpHash: otpHash(code, w.id) } });
      // os fundos saem do saldo disponível AGORA: impossível gastar duas vezes enquanto o saque tramita
      await postLedger(tx, { walletId: wallet.id, type: "WITHDRAWAL_HOLD", available: -input.amountCents, locked: input.amountCents, refType: "withdrawal", refId: w.id, key: `wd-hold:${w.id}`, memo: "Saque solicitado", actorId: actor.id });
      await audit(actor.id, "withdrawal.request", "Withdrawal", w.id, { amountCents: input.amountCents, teamId: team.id }, tx);
      return w;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 20000 },
  );

  await sendMail({
    to: user.email,
    subject: "Código de confirmação de saque — PRiME ARENA MANAGER",
    text: `Você pediu o saque de ${formatMoney(input.amountCents)} da equipe ${team.name}.\n\nCódigo de confirmação: ${code}\n(válido por ${cfg.otpTtlMinutes} minutos)\n\nSe NÃO foi você, ignore este e-mail e troque sua senha agora: o saque não será concluído sem este código.`,
  });
  return { withdrawalId: wd.id };
}

async function releaseHold(tx: Prisma.TransactionClient, w: Pick<Withdrawal, "id" | "walletId" | "amountCents">, memo: string) {
  await postLedger(tx, { walletId: w.walletId, type: "WITHDRAWAL_RELEASE", available: w.amountCents, locked: -w.amountCents, refType: "withdrawal", refId: w.id, key: `wd-release:${w.id}`, memo, allowFrozen: true });
}

/** Confirma o saque com o código enviado por e-mail e decide entre análise manual e aprovação automática. */
export async function confirmWithdrawal(actorIn: Actor | null, withdrawalId: string, code: string): Promise<"approved" | "under_review"> {
  const actor = requireActor(actorIn);
  const cfg = moneyConfig();
  const w = await db.withdrawal.findUnique({ where: { id: withdrawalId } });
  if (!w || w.requestedById !== actor.id) throw new AppError("Saque não encontrado.", "NOT_FOUND");
  if (w.status !== "PENDING_CONFIRMATION") throw new AppError("Este saque não aguarda confirmação.");
  const cleaned = (code ?? "").replace(/\D/g, "");

  if (!w.otpExpiresAt || w.otpExpiresAt < new Date()) {
    await cancelInternal(w.id, "Código de confirmação expirado.");
    throw new AppError("O código expirou e o saque foi cancelado. Peça um novo.");
  }
  // conta a tentativa ANTES de comparar (atômico) para que corridas não burlem o limite
  const bumped = await db.withdrawal.updateMany({ where: { id: w.id, status: "PENDING_CONFIRMATION", otpAttempts: { lt: cfg.otpMaxAttempts } }, data: { otpAttempts: { increment: 1 } } });
  if (bumped.count === 0) {
    await cancelInternal(w.id, "Excesso de tentativas de código.");
    await audit(actor.id, "withdrawal.otp_lockout", "Withdrawal", w.id);
    throw new AppError("Muitas tentativas incorretas. O saque foi cancelado e o valor voltou ao saldo.", "RATE_LIMIT");
  }
  if (cleaned.length !== 6 || !safeEqual(otpHash(cleaned, w.id), w.otpHash ?? "")) {
    throw new AppError("Código incorreto.");
  }

  const user = await db.user.findUniqueOrThrow({ where: { id: actor.id } });
  const kyc = await requireKyc(actor.id, "verified");
  const wallet = await db.wallet.findUniqueOrThrow({ where: { id: w.walletId } });
  const now = new Date();
  const risk = await gatherRisk(w, user, kyc.reviewedAt, wallet.frozenAt !== null, now);
  const review = risk.needsReview || w.amountCents > cfg.withdrawAutoApproveMaxCents;
  const res = await db.withdrawal.updateMany({
    where: { id: w.id, status: "PENDING_CONFIRMATION" },
    data: {
      status: review ? "UNDER_REVIEW" : "APPROVED",
      confirmedAt: now,
      riskScore: risk.score,
      riskFlags: risk.flags as unknown as Prisma.InputJsonValue,
      processAfter: review ? null : new Date(now.getTime() + cfg.withdrawDelayMinutes * 60_000),
      otpHash: null,
    },
  });
  if (res.count === 0) throw new AppError("Este saque já foi processado.");
  await audit(actor.id, "withdrawal.confirm", "Withdrawal", w.id, { score: risk.score, flags: risk.flags, review });
  await sendMail({
    to: user.email,
    subject: "Saque solicitado — PRiME ARENA MANAGER",
    text: review
      ? `Seu saque de ${formatMoney(w.amountCents)} foi enviado para análise de segurança. Você será avisado quando for decidido.\nNão reconhece? Cancele em Carteira e troque sua senha.`
      : `Seu saque de ${formatMoney(w.amountCents)} será enviado por Pix para o CPF final ${w.destinationCpfLast4} em ~${cfg.withdrawDelayMinutes} minutos.\nNão foi você? Cancele agora em Carteira e troque sua senha.`,
  });
  if (review) {
    const admins = await db.user.findMany({ where: { role: "ADMIN" }, select: { id: true } });
    await notify(admins.map((a) => a.id), "withdrawal.review", "Saque aguardando análise", `${formatMoney(w.amountCents)} — risco ${risk.score}`, "/admin/saques");
  }
  return review ? "under_review" : "approved";
}

async function gatherRisk(w: Withdrawal, user: { createdAt: Date; withdrawalLockedUntil: Date | null }, kycReviewedAt: Date | null, frozen: boolean, now: Date) {
  const week = new Date(now.getTime() - 7 * 86400_000);
  const month = new Date(now.getTime() - 30 * 86400_000);
  const day = new Date(now.getTime() - 24 * 3600_000);
  const [prior, unverified, wins, last24] = await Promise.all([
    db.withdrawal.count({ where: { walletId: w.walletId, status: "PAID" } }),
    db.deposit.count({ where: { walletId: w.walletId, status: "CONFIRMED", payerDocHash: null, confirmedAt: { gte: month } } }),
    db.challenge.findMany({ where: { status: "SETTLED", settledAt: { gte: week }, winnerTeamId: w.teamId }, select: { creatorTeamId: true, opponentTeamId: true, riskFlags: true } }),
    db.withdrawal.count({ where: { walletId: w.walletId, createdAt: { gte: day }, status: { notIn: ["CANCELED", "REJECTED", "FAILED"] }, NOT: { id: w.id } } }),
  ]);
  const byOpponent = new Map<string, number>();
  let sharedIp = 0;
  for (const c of wins) {
    const opp = c.creatorTeamId === w.teamId ? c.opponentTeamId : c.creatorTeamId;
    if (opp) byOpponent.set(opp, (byOpponent.get(opp) ?? 0) + 1);
    if (((c.riskFlags as string[] | null) ?? []).includes("SAME_IP")) sharedIp++;
  }
  const recentLock = !!user.withdrawalLockedUntil && user.withdrawalLockedUntil.getTime() > now.getTime() - 7 * 86400_000;
  return assessWithdrawalRisk({
    amountCents: w.amountCents,
    firstWithdrawal: prior === 0,
    accountAgeDays: (now.getTime() - user.createdAt.getTime()) / 86400_000,
    kycAgeHours: kycReviewedAt ? (now.getTime() - kycReviewedAt.getTime()) / 3600_000 : 0,
    recentSecurityChange: recentLock,
    unverifiedPayerDeposits: unverified,
    repeatedOpponentWins: Math.max(0, ...byOpponent.values()),
    sharedIpWins: sharedIp,
    withdrawalsLast24h: last24,
    walletFrozen: frozen,
  });
}

async function cancelInternal(id: string, reason: string, from: Withdrawal["status"][] = ["PENDING_CONFIRMATION", "UNDER_REVIEW", "APPROVED"]): Promise<boolean> {
  return db.$transaction(async (tx) => {
    const w = await tx.withdrawal.findUnique({ where: { id } });
    if (!w) return false;
    const res = await tx.withdrawal.updateMany({ where: { id, status: { in: from } }, data: { status: "CANCELED", failureReason: reason, otpHash: null } });
    if (res.count === 0) return false;
    await releaseHold(tx, w, reason);
    return true;
  });
}

/** O líder cancela enquanto o dinheiro ainda não foi enviado ao provedor. */
export async function cancelWithdrawal(actorIn: Actor | null, withdrawalId: string): Promise<void> {
  const actor = requireActor(actorIn);
  const w = await db.withdrawal.findUnique({ where: { id: withdrawalId } });
  if (!w) throw new AppError("Saque não encontrado.", "NOT_FOUND");
  if (w.requestedById !== actor.id && actor.role !== "ADMIN") {
    await requireTeamLeader(actor, w.teamId);
  }
  const ok = await cancelInternal(w.id, `Cancelado por ${actor.role === "ADMIN" && w.requestedById !== actor.id ? "administrador" : "usuário"}.`);
  if (!ok) throw new AppError("Este saque não pode mais ser cancelado (já está em processamento ou finalizado).");
  await audit(actor.id, "withdrawal.cancel", "Withdrawal", w.id);
}

/** Revisão manual por um ADMINISTRADOR que não seja o solicitante nem membro da equipe (quatro olhos). */
export async function reviewWithdrawal(actorIn: Actor | null, withdrawalId: string, decision: "approve" | "reject", note: string): Promise<void> {
  const actor = requireActor(actorIn);
  if (actor.role !== "ADMIN") throw new AppError("Apenas administradores podem revisar saques.", "FORBIDDEN");
  if (note.trim().length < 5) throw new AppError("Descreva a decisão (mínimo de 5 caracteres).");
  const w = await db.withdrawal.findUnique({ where: { id: withdrawalId } });
  if (!w) throw new AppError("Saque não encontrado.", "NOT_FOUND");
  if (w.requestedById === actor.id) throw new AppError("Conflito de interesse: você não pode aprovar o próprio saque.", "FORBIDDEN");
  const member = await db.teamMember.findFirst({ where: { teamId: w.teamId, userId: actor.id } });
  if (member) throw new AppError("Conflito de interesse: você pertence a esta equipe.", "FORBIDDEN");
  if (w.status !== "UNDER_REVIEW") throw new AppError("Este saque não está em análise.");
  const cfg = moneyConfig();
  if (decision === "reject") {
    const ok = await cancelInternal(w.id, `Recusado: ${note.trim()}`, ["UNDER_REVIEW"]);
    if (ok) await db.withdrawal.update({ where: { id: w.id }, data: { status: "REJECTED", reviewedById: actor.id, reviewedAt: new Date(), reviewNote: note.trim() } });
  } else {
    const res = await db.withdrawal.updateMany({
      where: { id: w.id, status: "UNDER_REVIEW" },
      data: { status: "APPROVED", reviewedById: actor.id, reviewedAt: new Date(), reviewNote: note.trim(), processAfter: new Date(Date.now() + cfg.withdrawDelayMinutes * 60_000) },
    });
    if (res.count === 0) throw new AppError("Este saque já foi decidido.");
  }
  await audit(actor.id, `withdrawal.review.${decision}`, "Withdrawal", w.id, { note });
  await notify(w.requestedById, "withdrawal.reviewed", decision === "approve" ? "Saque aprovado" : "Saque recusado", note.trim(), "/carteira");
}

// ───────────────────────── Processamento (job) ─────────────────────────

/** Envia ao provedor os saques aprovados cuja janela de cancelamento já passou. Chamado pelo job agendado. */
export async function processDueWithdrawals(now = new Date(), limit = 20): Promise<{ processed: number; skipped: number }> {
  if (getEnv().payoutsPaused) return { processed: 0, skipped: 0 };
  const due = await db.withdrawal.findMany({ where: { status: "APPROVED", processAfter: { lte: now } }, orderBy: { processAfter: "asc" }, take: limit });
  let processed = 0;
  let skipped = 0;
  for (const w of due) {
    const r = await processWithdrawal(w.id, now);
    if (r === "sent") processed++;
    else skipped++;
  }
  return { processed, skipped };
}

export async function processWithdrawal(id: string, now = new Date()): Promise<"sent" | "skipped" | "needs_reconciliation"> {
  // transição atômica: só UM processo consegue mover APPROVED → PROCESSING (impede pagamento duplicado)
  const claimed = await db.withdrawal.updateMany({ where: { id, status: "APPROVED", processAfter: { lte: now } }, data: { status: "PROCESSING" } });
  if (claimed.count === 0) return "skipped";
  const w = await db.withdrawal.findUniqueOrThrow({ where: { id } });
  const [user, wallet] = await Promise.all([db.user.findUniqueOrThrow({ where: { id: w.requestedById } }), db.wallet.findUniqueOrThrow({ where: { id: w.walletId } })]);

  // revalida tudo no último instante
  const reasons: string[] = [];
  if (wallet.frozenAt) reasons.push("carteira congelada");
  if (user.bannedAt) reasons.push("usuário suspenso");
  if (user.withdrawalLockedUntil && w.confirmedAt && user.withdrawalLockedUntil > w.confirmedAt) reasons.push("credenciais alteradas após o pedido");
  let cpf = "";
  try {
    cpf = await getVerifiedCpf(w.requestedById);
  } catch {
    reasons.push("identidade não está mais verificada");
  }
  if (reasons.length) {
    await db.withdrawal.update({ where: { id }, data: { status: "UNDER_REVIEW", processAfter: null, failureReason: `Retornou à análise: ${reasons.join(", ")}.` } });
    await audit(null, "withdrawal.revalidation_failed", "Withdrawal", id, { reasons });
    return "skipped";
  }

  const provider = getPixProvider();
  try {
    const out = await provider.sendPix({ externalReference: w.id, amountCents: w.netCents, pixKey: cpf, description: "Saque PRiME ARENA MANAGER" });
    await db.withdrawal.update({ where: { id }, data: { provider: provider.name, providerTransferId: out.transferId } });
    if (out.status === "DONE") await markPaid(id, out.endToEndId ?? null);
    else if (out.status === "FAILED") await markFailed(id, "Recusado pelo provedor.");
    return "sent";
  } catch (e) {
    // Falha ambígua (a transferência pode ou não ter saído): NUNCA reenviar nem devolver o saldo automaticamente.
    await db.withdrawal.update({ where: { id }, data: { failureReason: "Resposta ambígua do provedor — conciliação manual necessária." } });
    await audit(null, "withdrawal.needs_reconciliation", "Withdrawal", id, { error: e instanceof Error ? e.message : String(e) });
    console.error(`[withdrawal ${id}] resposta ambígua do provedor; requer conciliação manual`);
    return "needs_reconciliation";
  }
}

export async function markPaid(id: string, endToEndId: string | null): Promise<boolean> {
  return db.$transaction(async (tx) => {
    const res = await tx.withdrawal.updateMany({ where: { id, status: "PROCESSING" }, data: { status: "PAID", paidAt: new Date(), endToEndId, failureReason: null } });
    if (res.count === 0) return false;
    const w = await tx.withdrawal.findUniqueOrThrow({ where: { id } });
    await postLedger(tx, { walletId: w.walletId, type: "WITHDRAWAL_PAID", available: 0, locked: -w.netCents, refType: "withdrawal", refId: w.id, key: `wd-paid:${w.id}`, memo: "Saque pago via Pix", allowFrozen: true });
    if (w.feeCents > 0) {
      await postLedger(tx, { walletId: w.walletId, type: "FEE", available: 0, locked: -w.feeCents, refType: "withdrawal", refId: w.id, key: `wd-fee:${w.id}`, memo: "Tarifa de saque", allowFrozen: true });
      const platform = await getPlatformWallet(tx);
      await postLedger(tx, { walletId: platform.id, type: "FEE", available: w.feeCents, refType: "withdrawal", refId: w.id, key: `wd-fee-platform:${w.id}`, memo: "Tarifa de saque", allowFrozen: true });
    }
    await audit(null, "withdrawal.paid", "Withdrawal", w.id, { netCents: w.netCents }, tx);
    await notify(w.requestedById, "withdrawal.paid", "Saque pago", `${formatMoney(w.netCents)} enviados por Pix para o CPF final ${w.destinationCpfLast4}.`, "/carteira", tx);
    return true;
  });
}

export async function markFailed(id: string, reason: string): Promise<boolean> {
  return db.$transaction(async (tx) => {
    const w = await tx.withdrawal.findUnique({ where: { id } });
    if (!w) return false;
    const res = await tx.withdrawal.updateMany({ where: { id, status: { in: ["PROCESSING", "APPROVED"] } }, data: { status: "FAILED", failureReason: reason } });
    if (res.count === 0) return false;
    await releaseHold(tx, w, `Saque falhou: ${reason}`);
    await audit(null, "withdrawal.failed", "Withdrawal", id, { reason }, tx);
    await notify(w.requestedById, "withdrawal.failed", "Saque não concluído", `${reason} O valor voltou ao saldo da equipe.`, "/carteira", tx);
    return true;
  });
}

/** Evento do provedor (webhook): confirma consultando o estado real da transferência. */
export async function handleTransferEvent(type: "TRANSFER_DONE" | "TRANSFER_FAILED", ref: { transferId?: string; externalReference?: string }): Promise<"paid" | "failed" | "ignored"> {
  const w = ref.externalReference
    ? await db.withdrawal.findUnique({ where: { id: ref.externalReference } })
    : ref.transferId
      ? await db.withdrawal.findUnique({ where: { providerTransferId: ref.transferId } })
      : null;
  if (!w || w.status !== "PROCESSING") return "ignored";
  const transferId = w.providerTransferId ?? ref.transferId;
  if (!transferId) return "ignored";
  if (!w.providerTransferId) await db.withdrawal.update({ where: { id: w.id }, data: { providerTransferId: transferId } }).catch(() => undefined);
  const info = await getPixProvider().getTransfer(transferId);
  if (type === "TRANSFER_DONE" && info.status === "DONE") return (await markPaid(w.id, info.endToEndId ?? null)) ? "paid" : "ignored";
  if (type === "TRANSFER_FAILED" && info.status === "FAILED") return (await markFailed(w.id, info.failureReason ?? "Recusado pelo banco de destino.")) ? "failed" : "ignored";
  return "ignored";
}

/** Concilia saques presos em PROCESSING consultando o provedor (job). */
export async function reconcileProcessing(olderThanMinutes = 10, now = new Date()): Promise<{ checked: number; resolved: number }> {
  const stuck = await db.withdrawal.findMany({ where: { status: "PROCESSING", updatedAt: { lt: new Date(now.getTime() - olderThanMinutes * 60_000) } } });
  let resolved = 0;
  for (const w of stuck) {
    if (!w.providerTransferId) continue; // sem id no provedor: só um administrador resolve
    const info = await getPixProvider().getTransfer(w.providerTransferId).catch(() => null);
    if (!info) continue;
    if (info.status === "DONE" && (await markPaid(w.id, info.endToEndId ?? null))) resolved++;
    else if (info.status === "FAILED" && (await markFailed(w.id, info.failureReason ?? "Recusado."))) resolved++;
  }
  return { checked: stuck.length, resolved };
}

/** Resolução manual de um saque em PROCESSING sem resposta do provedor (admin confere no painel do banco). */
export async function adminResolveProcessing(actorIn: Actor | null, id: string, outcome: "paid" | "failed", note: string, endToEndId?: string) {
  const actor = requireActor(actorIn);
  if (actor.role !== "ADMIN") throw new AppError("Apenas administradores.", "FORBIDDEN");
  if (note.trim().length < 5) throw new AppError("Descreva o que foi conferido no provedor.");
  const w = await db.withdrawal.findUnique({ where: { id } });
  if (!w || w.status !== "PROCESSING") throw new AppError("Saque não está em processamento.");
  if (w.requestedById === actor.id) throw new AppError("Conflito de interesse.", "FORBIDDEN");
  const ok = outcome === "paid" ? await markPaid(id, endToEndId ?? null) : await markFailed(id, `Conciliado manualmente: ${note.trim()}`);
  await audit(actor.id, `withdrawal.admin_${outcome}`, "Withdrawal", id, { note });
  return ok;
}

// ───────────────────────── Autorização de transferência ─────────────────────────

/**
 * O provedor pergunta se pode executar uma transferência. Só aprovamos se ela corresponde EXATAMENTE a um saque
 * nosso em PROCESSING (mesmo valor, mesma chave CPF do titular, carteira íntegra). Qualquer outra tentativa — por exemplo,
 * alguém que roubou a chave de API — é RECUSADA e vira alerta de segurança.
 */
export async function authorizeTransfer(req: TransferAuthRequest): Promise<{ approved: boolean; reason?: string }> {
  const refuse = async (reason: string, extra: Record<string, unknown> = {}) => {
    await audit(null, "security.transfer_refused", "Withdrawal", req.externalReference ?? req.transferId ?? "unknown", { reason, amountCents: req.amountCents, ...extra });
    console.error(`[SEGURANÇA] transferência recusada: ${reason} (ref=${req.externalReference ?? req.transferId ?? "?"}, valor=${req.amountCents})`);
    return { approved: false, reason };
  };
  if (getEnv().payoutsPaused) return refuse("saques pausados");
  const w = req.externalReference
    ? await db.withdrawal.findUnique({ where: { id: req.externalReference } })
    : req.transferId
      ? await db.withdrawal.findUnique({ where: { providerTransferId: req.transferId } })
      : null;
  if (!w) return refuse("transferência não originada pelo sistema");
  if (w.status !== "PROCESSING") return refuse(`saque em estado ${w.status}`);
  if (w.netCents !== req.amountCents) return refuse("valor diverge do saque autorizado", { expected: w.netCents });
  const wallet = await db.wallet.findUnique({ where: { id: w.walletId } });
  if (!wallet || wallet.frozenAt) return refuse("carteira congelada");
  if (req.pixKey) {
    let cpf: string;
    try {
      cpf = await getVerifiedCpf(w.requestedById);
    } catch {
      return refuse("titular sem identidade verificada");
    }
    if (onlyDigits(req.pixKey) !== onlyDigits(cpf)) return refuse("chave Pix de destino não pertence ao titular verificado");
  }
  return { approved: true };
}

export async function listWithdrawals(teamId: string, take = 20) {
  return db.withdrawal.findMany({ where: { teamId }, orderBy: { createdAt: "desc" }, take });
}

export type { RiskFlag };
