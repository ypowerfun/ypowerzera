"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { guard, int, str, type FormState } from "@/lib/action-helpers";
import { db } from "@/lib/db";
import { acceptChallenge, cancelChallenge, createChallenge, disputeChallenge, reportChallengeResult, submitChallengeEvidence } from "@/server/challenges";
import { requireActionUser as requireUser, toActor } from "@/server/session";
import { creditsToCents } from "@/server/money-config";

export async function createChallengeAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser("/desafios/novo");
  const credits = int(fd, "credits");
  if (!Number.isFinite(credits) || credits < 1) return { error: "Informe a aposta em créditos inteiros (1 crédito = R$ 1,00)." };
  let invitedTeamId: string | undefined;
  const invitedSlug = str(fd, "invited").toLowerCase();
  if (invitedSlug) {
    const t = await db.team.findUnique({ where: { slug: invitedSlug } });
    if (!t) return { error: "Equipe convidada não encontrada (use o endereço/slug do time)." };
    invitedTeamId = t.id;
  }
  const res = await guard(() =>
    createChallenge(toActor(user), {
      teamId: str(fd, "teamId"),
      gameId: str(fd, "gameId"),
      modeId: str(fd, "modeId"),
      bestOf: int(fd, "bestOf"),
      stakeCents: creditsToCents(credits),
      lineupUserIds: fd.getAll("lineup").map(String),
      invitedTeamId,
      notes: str(fd, "notes") || undefined,
      expiresInHours: int(fd, "hours") || undefined,
    }),
  );
  if (!res.ok) return { error: res.error };
  redirect(`/desafios/${res.value.id}`);
}

export async function acceptChallengeAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser();
  const id = str(fd, "challengeId");
  const res = await guard(() => acceptChallenge(toActor(user), id, { teamId: str(fd, "teamId"), lineupUserIds: fd.getAll("lineup").map(String) }));
  if (!res.ok) return { error: res.error };
  revalidatePath(`/desafios/${id}`);
  redirect(`/desafios/${id}`);
}

export async function cancelChallengeAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser();
  const res = await guard(() => cancelChallenge(toActor(user), str(fd, "challengeId")));
  if (!res.ok) return { error: res.error };
  redirect("/desafios");
}

export async function reportChallengeAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser();
  const outcome = str(fd, "outcome");
  if (!["WON", "LOST", "NO_SHOW"].includes(outcome)) return { error: "Resultado inválido." };
  const res = await guard(() => reportChallengeResult(toActor(user), str(fd, "challengeId"), outcome as "WON" | "LOST" | "NO_SHOW"));
  if (!res.ok) return { error: res.error };
  revalidatePath(`/desafios/${str(fd, "challengeId")}`);
  return { success: { settled: "Resultado confirmado e créditos movimentados.", reported: "Resultado informado. O adversário precisa confirmar ou contestar.", disputed: "Caso enviado para análise de um árbitro." }[res.value] };
}

export async function disputeChallengeAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser();
  const res = await guard(() => disputeChallenge(toActor(user), str(fd, "challengeId"), str(fd, "reason")));
  if (!res.ok) return { error: res.error };
  revalidatePath(`/desafios/${str(fd, "challengeId")}`);
  return { success: "Disputa aberta. Um árbitro vai analisar." };
}

export async function evidenceChallengeAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser();
  const res = await guard(() => submitChallengeEvidence(toActor(user), str(fd, "challengeId"), str(fd, "text")));
  if (!res.ok) return { error: res.error };
  revalidatePath(`/desafios/${str(fd, "challengeId")}`);
  return { success: "Prova registrada." };
}
