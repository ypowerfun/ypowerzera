"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { guard, int, str, type FormState } from "@/lib/action-helpers";
import { reviewKyc } from "@/server/kyc";
import { adminResolveProcessing, reviewWithdrawal } from "@/server/withdrawals";
import { resolveHeldDeposit } from "@/server/deposits";
import { resolveChallenge } from "@/server/challenges";
import { adminAdjustWallet, adminFreezeWallet, adminUnfreezeWallet, runReconciliation } from "@/server/admin-wallet";
import { requireAdmin, toActor } from "@/server/session";

/** Executa a ação; em sucesso volta à lista com um código de confirmação (a linha tratada some, e o formulário com ela). */
function adminAction(run: (actor: ReturnType<typeof toActor>, fd: FormData) => Promise<unknown>, code: string, path: string) {
  return async (_: FormState, fd: FormData): Promise<FormState> => {
    const user = await requireAdmin();
    const res = await guard(() => run(toActor(user), fd));
    if (!res.ok) return { error: res.error };
    revalidatePath("/admin", "layout");
    redirect(`${path}?ok=${code}`);
  };
}

export const reviewKycAction = adminAction((a, fd) => reviewKyc(a, str(fd, "userId"), str(fd, "decision") === "approve" ? "approve" : "reject", str(fd, "reason")), "kyc", "/admin/kyc");
export const reviewWithdrawalAction = adminAction((a, fd) => reviewWithdrawal(a, str(fd, "withdrawalId"), str(fd, "decision") === "approve" ? "approve" : "reject", str(fd, "note")), "saque", "/admin/saques");
export const resolveProcessingAction = adminAction((a, fd) => adminResolveProcessing(a, str(fd, "withdrawalId"), str(fd, "outcome") === "paid" ? "paid" : "failed", str(fd, "note"), str(fd, "e2e") || undefined), "saque-conciliado", "/admin/saques");
export const resolveHeldDepositAction = adminAction((a, fd) => resolveHeldDeposit(a, str(fd, "depositId"), str(fd, "decision") === "credit" ? "credit" : "refund", str(fd, "note")), "deposito", "/admin/depositos");
export const resolveChallengeAction = adminAction((a, fd) => resolveChallenge(a, str(fd, "challengeId"), (["creator", "opponent", "void"] as const).find((o) => o === str(fd, "outcome")) ?? "void", str(fd, "note")), "desafio", "/admin/desafios");
export const freezeWalletAction = adminAction((a, fd) => adminFreezeWallet(a, str(fd, "walletId"), str(fd, "reason")), "congelada", "/admin/carteiras");
export const unfreezeWalletAction = adminAction((a, fd) => adminUnfreezeWallet(a, str(fd, "walletId"), str(fd, "note")), "liberada", "/admin/carteiras");
export const adjustWalletAction = adminAction((a, fd) => adminAdjustWallet(a, str(fd, "walletId"), int(fd, "cents"), str(fd, "note")), "ajuste", "/admin/carteiras");

export async function reconcileAction(_: FormState): Promise<FormState> {
  await requireAdmin();
  const r = await runReconciliation();
  revalidatePath("/admin", "layout");
  return r.ok ? { success: `Conciliação OK: ${r.wallets.length} carteira(s) conferidas; movimentos internos somam zero.` } : { error: `Inconsistências: ${r.mismatches.join(" | ")}` };
}
