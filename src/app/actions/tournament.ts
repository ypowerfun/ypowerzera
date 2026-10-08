"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { bool, guard, int, str, type FormState } from "@/lib/action-helpers";
import { checkIn, registerForTournament, undoCheckIn, withdrawRegistration } from "@/server/registration";
import { cancelPendingOrder, completeOrder, failOrder, startCheckout } from "@/server/orders";
import { openDispute, reportMatch, vetoAction } from "@/server/matches";
import { requireActionUser as requireUser, toActor } from "@/server/session";
import { db } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { AppError } from "@/lib/errors";

export async function registerAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser();
  const tournamentId = str(fd, "tournamentId");
  const slug = str(fd, "slug");
  const answers: Record<string, string> = {};
  for (const [k, v] of fd.entries()) if (k.startsWith("cf_")) answers[k.slice(3)] = String(v);
  const res = await guard(() =>
    registerForTournament(toActor(user), {
      tournamentId,
      teamId: str(fd, "teamId") || undefined,
      starterIds: fd.getAll("starter").map(String),
      subIds: fd.getAll("sub").map(String),
      customAnswers: answers,
      couponCode: str(fd, "coupon") || undefined,
      acceptRules: bool(fd, "acceptRules"),
    }),
  );
  if (!res.ok) return { error: res.error };
  revalidatePath(`/torneios/${slug}`);
  if (res.value.status === "PENDING_PAYMENT" && res.value.orderId) redirect(`/checkout/${res.value.orderId}`);
  redirect(`/torneios/${slug}?inscrito=${res.value.status === "WAITLIST" ? "fila" : "ok"}`);
}

export async function checkInAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser();
  const res = await guard(() => (str(fd, "undo") ? undoCheckIn(toActor(user), str(fd, "participantId")) : checkIn(toActor(user), str(fd, "participantId"))));
  if (!res.ok) return { error: res.error };
  revalidatePath("/torneios/[slug]", "page");
  return { success: str(fd, "undo") ? "Check-in desfeito." : "Check-in confirmado! Boa sorte." };
}

export async function withdrawAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser();
  const res = await guard(() => withdrawRegistration(toActor(user), str(fd, "participantId")));
  if (!res.ok) return { error: res.error };
  revalidatePath("/torneios/[slug]", "page");
  redirect(`/torneios/${str(fd, "slug")}`);
}

// ───────────── checkout ─────────────

export async function startCheckoutAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser();
  const res = await guard(() => startCheckout(toActor(user), str(fd, "orderId")));
  if (!res.ok) return { error: res.error };
  redirect(res.value.redirectUrl);
}

export async function cancelOrderAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser();
  const res = await guard(() => cancelPendingOrder(toActor(user), str(fd, "orderId")));
  if (!res.ok) return { error: res.error };
  redirect(`/checkout/${str(fd, "orderId")}/cancelado`);
}

/** Checkout SIMULADO (somente com PAYMENTS_PROVIDER=mock fora de produção). Valida cartão de teste (Luhn). */
export async function mockPayAction(_: FormState, fd: FormData): Promise<FormState> {
  const env = getEnv();
  if (env.paymentsProvider !== "mock" || (env.isProd && !env.allowMockPayments)) return { error: "Checkout simulado indisponível." };
  const user = await requireUser();
  const orderId = str(fd, "orderId");
  const method = str(fd, "method") === "pix" ? "pix" : "card";
  const res = await guard(async () => {
    const order = await db.order.findUnique({ where: { id: orderId } });
    if (!order || order.userId !== user.id) throw new AppError("Pedido não encontrado.", "NOT_FOUND");
    if (order.status !== "PENDING") throw new AppError("Este pedido não está aguardando pagamento.");
    if (method === "card") {
      const digits = str(fd, "card").replace(/\D/g, "");
      if (digits.length < 13 || !luhn(digits)) throw new AppError("Número de cartão inválido. Use 4242 4242 4242 4242 para testar.");
      if (digits.startsWith("4000000000000002")) {
        await failOrder(orderId, "Cartão recusado (simulado).");
        throw new AppError("Pagamento recusado pelo emissor (simulação). Gere um novo pedido para tentar de novo.");
      }
    }
    return completeOrder(orderId, { amountTotal: order.totalCents, currency: order.currency, paymentId: `mock_${orderId}`, method });
  });
  if (!res.ok) return { error: res.error };
  redirect(`/checkout/${orderId}/sucesso`);
}

function luhn(d: string): boolean {
  let sum = 0;
  let alt = false;
  for (let i = d.length - 1; i >= 0; i--) {
    let n = Number(d[i]);
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

// ───────────── partidas ─────────────

export async function reportMatchAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser();
  const res = await guard(() => reportMatch(toActor(user), str(fd, "matchId"), int(fd, "scoreA"), int(fd, "scoreB")));
  if (!res.ok) return { error: res.error };
  revalidatePath(`/partidas/${str(fd, "matchId")}`);
  return { success: { reported: "Placar enviado. Aguardando o adversário confirmar.", completed: "Placar confirmado pelos dois lados. Partida encerrada!", disputed: "Os placares divergem. A organização foi chamada para decidir." }[res.value] };
}

export async function disputeMatchAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser();
  const res = await guard(() => openDispute(toActor(user), str(fd, "matchId"), str(fd, "reason")));
  if (!res.ok) return { error: res.error };
  revalidatePath(`/partidas/${str(fd, "matchId")}`);
  return { success: "Disputa aberta. A organização vai analisar." };
}

export async function vetoAction_(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser();
  const res = await guard(() => vetoAction(toActor(user), str(fd, "matchId"), str(fd, "map")));
  if (!res.ok) return { error: res.error };
  revalidatePath(`/partidas/${str(fd, "matchId")}`);
  return { success: "Escolha registrada." };
}
