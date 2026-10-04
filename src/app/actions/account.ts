"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { guard, safeNext, str, type FormState } from "@/lib/action-helpers";
import { removeGameAccount, saveGameAccount } from "@/server/game-accounts";
import { markAllRead } from "@/server/notifications";
import { createTeam, inviteToTeam, removeFromTeam, respondToInvite, setMemberRole } from "@/server/teams";
import { createOrganization } from "@/server/orgs";
import { requireUser, toActor } from "@/server/session";
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
  await removeGameAccount(user.id, str(fd, "gameId"));
  revalidatePath("/conta/contas");
  return { success: "Conta removida." };
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
