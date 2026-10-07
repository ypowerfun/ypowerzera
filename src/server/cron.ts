import { db } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { safeEqual } from "@/lib/crypto";
import { runChallengeMaintenance } from "./challenges";
import { expireDeposits } from "./deposits";
import { expireStaleReservations } from "./orders";
import { runReconciliation } from "./admin-wallet";
import { expireStaleWithdrawalConfirmations, processDueWithdrawals, reconcileProcessing } from "./withdrawals";

export function cronAuthorized(authorization: string | null): boolean {
  const secret = getEnv().cronSecret;
  if (!secret || secret.length < 16) return false;
  const given = (authorization ?? "").replace(/^Bearer\s+/i, "");
  return safeEqual(given, secret);
}

/** Tarefas periódicas (a cada 1–5 min): saques devidos, conciliação, expirações, desafios e reservas. */
export async function runWalletCron() {
  const [deposits, withdrawals, expiredConfirmations, reconciled, challenges, reservations] = await Promise.all([
    expireDeposits(),
    processDueWithdrawals(),
    expireStaleWithdrawalConfirmations(),
    reconcileProcessing(),
    runChallengeMaintenance(),
    expireStaleReservations(db),
  ]);
  const ledger = await runReconciliation();
  return { deposits, withdrawals, expiredConfirmations, reconciled, challenges, reservations, ledgerOk: ledger.ok, mismatches: ledger.mismatches.slice(0, 5) };
}
