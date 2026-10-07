import { db } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { safeEqual } from "@/lib/crypto";
import { runChallengeMaintenance } from "./challenges";
import { expireDeposits, reconcilePendingDeposits } from "./deposits";
import { expireStaleReservations } from "./orders";
import { runReconciliation } from "./admin-wallet";
import { purgeExpiredRateLimits } from "./rate-limit";
import { markCronRun } from "./settings";
import { expireStaleWithdrawalConfirmations, processDueWithdrawals, reconcileProcessing } from "./withdrawals";

export function cronAuthorized(authorization: string | null): boolean {
  const secret = getEnv().cronSecret;
  if (!secret || secret.length < 16) return false;
  const given = (authorization ?? "").replace(/^Bearer\s+/i, "");
  return safeEqual(given, secret);
}

/** Apaga o que já venceu e não serve mais (limites de tentativas, sessões e links de e-mail antigos): sem isso as tabelas só crescem. */
export async function purgeExpired(): Promise<{ rateLimits: number; sessions: number; tokens: number; securityAudit: number }> {
  const weekAgo = new Date(Date.now() - 7 * 86400_000);
  const rateLimits = await purgeExpiredRateLimits();
  const sessions = (await db.session.deleteMany({ where: { expiresAt: { lt: new Date() } } })).count;
  const tokens = (await db.authToken.deleteMany({ where: { OR: [{ expiresAt: { lt: weekAgo } }, { usedAt: { lt: weekAgo } }] } })).count;
  // Avisos de segurança (webhook sem assinatura etc.) só interessam recentes; a trilha financeira e administrativa NUNCA é apagada.
  const securityAudit = (await db.auditLog.deleteMany({ where: { action: { startsWith: "security." }, createdAt: { lt: new Date(Date.now() - 60 * 86400_000) } } })).count;
  return { rateLimits, sessions, tokens, securityAudit };
}

/** Tarefas periódicas (a cada 1–5 min): saques devidos, conciliação, expirações, desafios e reservas. */
export async function runWalletCron() {
  // antes de expirar: um Pix pago cujo webhook se perdeu ainda é creditado
  const pixChecked = await reconcilePendingDeposits();
  const [deposits, withdrawals, expiredConfirmations, reconciled, challenges, reservations] = await Promise.all([
    expireDeposits(),
    processDueWithdrawals(),
    expireStaleWithdrawalConfirmations(),
    reconcileProcessing(),
    runChallengeMaintenance(),
    expireStaleReservations(db),
  ]);
  const ledger = await runReconciliation();
  const purged = await purgeExpired();
  await markCronRun(); // é assim que o admin vê, em Configurações, que o agendador está rodando
  return { pixChecked, deposits, withdrawals, expiredConfirmations, reconciled, challenges, reservations, purged, ledgerOk: ledger.ok, mismatches: ledger.mismatches.slice(0, 5) };
}
