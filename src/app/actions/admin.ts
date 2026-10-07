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
import { setUserRole } from "@/server/users-admin";
import { deleteTeam } from "@/server/teams";
import { reviewBalanceRequest } from "@/server/team-release";
import { sendTestMailToAdmin, setWalletEnabled, setWithdrawalsNeedAdminApproval } from "@/server/settings";

/** Executa a ação; em sucesso volta à lista com um código de confirmação (a linha tratada some, e o formulário com ela). */
function adminAction(run: (actor: ReturnType<typeof toActor>, fd: FormData) => Promise<unknown>, code: string | ((fd: FormData) => string), path: string) {
  return async (_: FormState, fd: FormData): Promise<FormState> => {
    const user = await requireAdmin();
    const res = await guard(() => run(toActor(user), fd));
    if (!res.ok) return { error: res.error };
    revalidatePath("/admin", "layout");
    redirect(`${path}?ok=${typeof code === "function" ? code(fd) : code}`);
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

// ───────── Usuários, equipes, saldos de times excluídos e configurações ─────────

/** Volta para a lista com os mesmos filtros (só dentro de /admin/usuarios; o parâmetro ok antigo é descartado). */
function backTo(fd: FormData, base: string): string {
  const raw = str(fd, "back");
  if (!raw.startsWith(base) || raw.startsWith("//") || raw.includes("://")) return base;
  return raw.replace(/([?&])ok=[^&]*&?/g, "$1").replace(/[?&]$/, "");
}

export async function setUserRoleAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireAdmin();
  const res = await guard(() => setUserRole(toActor(user), str(fd, "userId"), str(fd, "role") === "ORGANIZER" ? "ORGANIZER" : "USER"));
  if (!res.ok) return { error: res.error };
  revalidatePath("/admin", "layout");
  const back = backTo(fd, "/admin/usuarios");
  redirect(`${back}${back.includes("?") ? "&" : "?"}ok=cargo`);
}

export const adminDeleteTeamAction = adminAction((a, fd) => deleteTeam(a, str(fd, "teamId"), { reason: str(fd, "reason") }), "time-excluido", "/admin/equipes");

export const reviewBalanceRequestAction = adminAction(
  (a, fd) => reviewBalanceRequest(a, str(fd, "requestId"), str(fd, "decision") === "approve" ? "approve" : "reject", str(fd, "note")),
  (fd) => (str(fd, "decision") === "approve" ? "saldo-liberado" : "saldo-recusado"),
  "/admin/saldos",
);

/** Admin → Configurações → "Enviar e-mail de teste para mim". */
export const sendTestEmailAction = adminAction((a) => sendTestMailToAdmin(a), "email-teste", "/admin/configuracoes");

export const toggleWalletAction = adminAction((a, fd) => setWalletEnabled(a, str(fd, "enabled") === "on"), (fd) => (str(fd, "enabled") === "on" ? "carteira-ligada" : "carteira-desligada"), "/admin/configuracoes");

export const toggleWithdrawApprovalAction = adminAction(
  (a, fd) => setWithdrawalsNeedAdminApproval(a, str(fd, "required") === "on"),
  (fd) => (str(fd, "required") === "on" ? "saque-admin-on" : "saque-admin-off"),
  "/admin/configuracoes",
);
