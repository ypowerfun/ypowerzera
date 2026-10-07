"use server";

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { guard, int, str, strRaw, type FormState } from "@/lib/action-helpers";
import { getEnv } from "@/lib/env";
import { submitKyc } from "@/server/kyc";
import { createDeposit } from "@/server/deposits";
import { cancelWithdrawal, confirmWithdrawal, requestWithdrawal } from "@/server/withdrawals";
import { requireUser, toActor } from "@/server/session";
import { creditsToCents } from "@/server/money-config";
import { db } from "@/lib/db";
import { handlePixWebhook } from "@/server/pix-webhooks";
import { mockFinishTransfer, mockPayCharge, mockReverseCharge } from "@/server/pix/mock";
import { decryptField } from "@/lib/crypto";
import { generateCpf } from "@/lib/cpf";

export async function submitKycAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser("/carteira/verificacao");
  const res = await guard(() => submitKyc(toActor(user), { fullName: str(fd, "fullName"), cpf: str(fd, "cpf"), birthDate: str(fd, "birthDate") }));
  if (!res.ok) return { error: res.error };
  revalidatePath("/carteira", "layout");
  return { success: "Dados enviados! Nossa equipe vai analisar e você será avisado por notificação." };
}

function credits(fd: FormData): number | null {
  const n = int(fd, "credits");
  return Number.isFinite(n) && n > 0 ? creditsToCents(n) : null;
}

export async function createDepositAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser();
  const teamId = str(fd, "teamId");
  const cents = credits(fd);
  if (cents === null) return { error: "Informe um valor em créditos inteiros (1 crédito = R$ 1,00)." };
  const res = await guard(() => createDeposit(toActor(user), { teamId, amountCents: cents }));
  if (!res.ok) return { error: res.error };
  redirect(`/carteira/${teamId}?pix=${res.value.id}`);
}

export async function requestWithdrawalAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser();
  const teamId = str(fd, "teamId");
  const cents = credits(fd);
  if (cents === null) return { error: "Informe um valor em créditos inteiros (1 crédito = R$ 1,00)." };
  const res = await guard(() => requestWithdrawal(toActor(user), { teamId, amountCents: cents, password: strRaw(fd, "password"), nonce: str(fd, "nonce") }));
  if (!res.ok) return { error: res.error };
  redirect(`/carteira/${teamId}?confirmar=${res.value.withdrawalId}`);
}

export async function confirmWithdrawalAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser();
  const teamId = str(fd, "teamId");
  const res = await guard(() => confirmWithdrawal(toActor(user), str(fd, "withdrawalId"), str(fd, "code")));
  if (!res.ok) return { error: res.error };
  revalidatePath(`/carteira/${teamId}`);
  redirect(`/carteira/${teamId}?saque=${res.value}`);
}

export async function cancelWithdrawalAction(_: FormState, fd: FormData): Promise<FormState> {
  const user = await requireUser();
  const res = await guard(() => cancelWithdrawal(toActor(user), str(fd, "withdrawalId")));
  if (!res.ok) return { error: res.error };
  revalidatePath(`/carteira/${str(fd, "teamId")}`);
  return { success: "Saque cancelado e valor devolvido ao saldo." };
}

export async function newNonce() {
  return randomUUID();
}

// ───────────── Simulador de Pix (SOMENTE desenvolvimento com PIX_PROVIDER=mock) ─────────────

function assertDev() {
  const env = getEnv();
  if (env.pixProvider !== "mock" || env.isProd) throw new Error("Simulador indisponível.");
}

export async function devPayDepositAction(_: FormState, fd: FormData): Promise<FormState> {
  assertDev();
  await requireUser("/dev/pix");
  const dep = await db.deposit.findUnique({ where: { id: str(fd, "depositId") } });
  if (!dep?.providerChargeId) return { error: "Depósito não encontrado." };
  const who = str(fd, "who");
  let payer: string;
  if (who === "third") payer = generateCpf(Math.floor(Math.random() * 1e8));
  else {
    const kyc = await db.kycProfile.findUnique({ where: { userId: dep.userId } });
    payer = kyc ? decryptField(kyc.cpfEnc) : generateCpf(1);
  }
  const hook = await mockPayCharge(dep.providerChargeId, payer);
  const res = await handlePixWebhook(hook.headers, hook.rawBody);
  revalidatePath("/dev/pix");
  return res.status === 200 ? { success: `Pix ${who === "third" ? "de terceiro " : ""}pago e webhook processado: ${JSON.stringify(res.body)}` } : { error: `Webhook respondeu ${res.status}` };
}

export async function devReverseDepositAction(_: FormState, fd: FormData): Promise<FormState> {
  assertDev();
  await requireUser("/dev/pix");
  const dep = await db.deposit.findUnique({ where: { id: str(fd, "depositId") } });
  if (!dep?.providerChargeId) return { error: "Depósito não encontrado." };
  const hook = await mockReverseCharge(dep.providerChargeId);
  const res = await handlePixWebhook(hook.headers, hook.rawBody);
  revalidatePath("/dev/pix");
  return { success: `Estorno (MED) simulado: ${JSON.stringify(res.body)}` };
}

export async function devFinishTransferAction(_: FormState, fd: FormData): Promise<FormState> {
  assertDev();
  await requireUser("/dev/pix");
  const w = await db.withdrawal.findUnique({ where: { id: str(fd, "withdrawalId") } });
  if (!w?.providerTransferId) return { error: "Saque ainda não foi enviado ao provedor." };
  const hook = await mockFinishTransfer(w.providerTransferId, str(fd, "ok") === "1");
  const res = await handlePixWebhook(hook.headers, hook.rawBody);
  revalidatePath("/dev/pix");
  return { success: `Banco simulado: ${JSON.stringify(res.body)}` };
}
