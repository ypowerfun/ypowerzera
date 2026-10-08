"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { guard, safeNext, str, type FormState } from "@/lib/action-helpers";
import { removeGameAccount, saveGameAccount } from "@/server/game-accounts";
import { markAllRead } from "@/server/notifications";
import { createTeam, deleteTeam, inviteToTeam, removeFromTeam, respondToInvite, setMemberRole } from "@/server/teams";
import { requestBalanceReview } from "@/server/team-release";
import { createOrganization } from "@/server/orgs";
import { requireActionUser as requireUser, toActor } from "@/server/session";
import { getGame } from "@/games";

export async function saveGameAccountAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser("/conta/contas");
  const gameId = str(fd, "gameId");
  const game = getGame(gameId);
  if (!game) return { error: "Jogo inválido." };
  const input: Record<string, string> = {};
  for (const f of game.identity) input[f.key] = str(fd, f.key);
  const res = await guard(() => saveGameAccount(user.id, gameId, input));
  if (!res.ok) return { error: res.error };
  revalidatePath("/conta/contas");
  const next = str(fd, "next");
  if (next) redirect(safeNext(next, "/conta/contas"));
  return { success: `Conta de ${game.name} salva.` };
}

export async function removeGameAccountAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser("/conta/contas");
  const res = await guard(() => removeGameAccount(user.id, str(fd, "gameId")));
  if (!res.ok) return { error: res.error };
  revalidatePath("/conta/contas");
  return { success: "Vínculo removido." };
}

export async function markNotificationsReadAction() {
  const user = await requireUser("/conta/notificacoes");
  await markAllRead(user.id);
  revalidatePath("/conta/notificacoes");
}

// ───────────── times ─────────────

export async function createTeamAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser("/times/novo");
  const res = await guard(() => createTeam(toActor(user), { name: str(fd, "name"), tag: str(fd, "tag"), gameId: str(fd, "gameId") || undefined, description: str(fd, "description") || undefined }));
  if (!res.ok) return { error: res.error };
  redirect(`/times/${res.value.slug}`);
}

/** Excluir o time: o saldo (se houver) fica bloqueado até o líder pedir a revisão e um admin liberar. */
export async function deleteTeamAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser();
  const res = await guard(() => deleteTeam(toActor(user), str(fd, "teamId"), { reason: str(fd, "reason") }));
  if (!res.ok) return { error: res.error };
  revalidatePath("/times", "layout");
  redirect(user.role === "ADMIN" ? "/admin/equipes?ok=time-excluido" : `/times?ok=${res.value.balanceCents > 0 ? "time-excluido-saldo" : "time-excluido"}`);
}

/** O ex-líder de um time excluído pede ao admin que revise e libere o saldo bloqueado. */
export async function requestBalanceReviewAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser("/carteira");
  const res = await guard(() => requestBalanceReview(toActor(user), str(fd, "teamId"), str(fd, "message")));
  if (!res.ok) return { error: res.error };
  revalidatePath("/carteira", "layout");
  redirect("/carteira?ok=revisao-pedida");
}

export async function inviteAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser();
  const res = await guard(() => inviteToTeam(toActor(user), str(fd, "teamId"), str(fd, "username"), str(fd, "role") === "SUB" ? "SUB" : "PLAYER"));
  if (!res.ok) return { error: res.error };
  revalidatePath("/times/[slug]", "page");
  return { success: "Convite enviado." };
}

export async function respondInviteAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser("/times");
  const res = await guard(() => respondToInvite(toActor(user), str(fd, "inviteId"), str(fd, "decision") === "accept"));
  if (!res.ok) return { error: res.error };
  revalidatePath("/times");
  return { success: str(fd, "decision") === "accept" ? "Você entrou no time!" : "Convite recusado." };
}

export async function removeMemberAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser();
  const res = await guard(() => removeFromTeam(toActor(user), str(fd, "teamId"), str(fd, "userId")));
  if (!res.ok) return { error: res.error };
  revalidatePath("/times/[slug]", "page");
  revalidatePath("/times");
  return { success: "Pronto." };
}

export async function setMemberRoleAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser();
  const role = str(fd, "role");
  const res = await guard(() => setMemberRole(toActor(user), str(fd, "teamId"), str(fd, "userId"), role === "CAPTAIN" ? "CAPTAIN" : role === "SUB" ? "SUB" : "PLAYER"));
  if (!res.ok) return { error: res.error };
  revalidatePath("/times/[slug]", "page");
  return { success: "Função atualizada." };
}

export async function createOrgAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser("/organizar");
  const res = await guard(() => createOrganization(toActor(user), { name: str(fd, "name"), description: str(fd, "description") || undefined }));
  if (!res.ok) return { error: res.error };
  redirect("/organizar/novo");
}
