import { db } from "@/lib/db";
import { generateCpf } from "@/lib/cpf";
import { makeUser } from "./factories";
import { reviewKyc, submitKyc } from "@/server/kyc";
import { createTeam } from "@/server/teams";
import { createDeposit } from "@/server/deposits";
import { handlePixWebhook } from "@/server/pix-webhooks";
import { mockPayCharge } from "@/server/pix/mock";
import { saveGameAccount } from "@/server/game-accounts";
import { getOrCreateTeamWallet } from "@/server/wallet";
import { testOutbox } from "@/server/mailer";
import type { Actor } from "@/server/types";

// semente aleatória por arquivo: o banco de teste é compartilhado e o CPF é único por conta (regra do produto)
let cpfSeed = Math.floor(Math.random() * 90_000_000) + 1000;
export const nextCpf = () => generateCpf(++cpfSeed * 7919);

let adminCache: Actor | null = null;
export async function admin(): Promise<Actor> {
  if (!adminCache) adminCache = await makeUser({ role: "ADMIN", name: "Admin Teste" });
  return adminCache;
}
export const newAdmin = () => makeUser({ role: "ADMIN" });

export interface KycUser {
  user: Actor;
  cpf: string;
}

/** Usuário antigo (cadastrado há 10 dias), com KYC aprovado há 2 dias. */
export async function makeKycUser(opts: { approved?: boolean; ageHours?: number } = {}): Promise<KycUser> {
  const user = await makeUser({ createdHoursAgo: opts.ageHours ?? 240 });
  const cpf = nextCpf();
  await submitKyc(user, { fullName: "Fulano de Tal Silva", cpf, birthDate: "1995-05-05" });
  if (opts.approved !== false) {
    await reviewKyc(await admin(), user.id, "approve");
    await db.kycProfile.update({ where: { userId: user.id }, data: { reviewedAt: new Date(Date.now() - 48 * 3600_000) } });
  }
  return { user, cpf };
}

/** Líder com equipe criada há 2 dias e jogo vinculado. */
export async function makeLeader(opts: { approved?: boolean; gameId?: string } = {}) {
  const k = await makeKycUser({ approved: opts.approved });
  const team = await createTeam(k.user, { name: `Equipe ${Math.random().toString(36).slice(2, 8)}`, tag: Math.random().toString(36).slice(2, 5).toUpperCase().replace(/[^A-Z0-9]/g, "X").padEnd(3, "X") });
  await db.team.update({ where: { id: team.id }, data: { createdAt: new Date(Date.now() - 48 * 3600_000) } });
  await saveGameAccount(k.user.id, opts.gameId ?? "sf6", { capcomId: `lider${k.user.id.slice(-6)}`, platform: "PC" });
  const wallet = await getOrCreateTeamWallet(db, team.id);
  return { ...k, team, walletId: wallet.id };
}

export type Leader = Awaited<ReturnType<typeof makeLeader>>;

/** Faz um depósito de ponta a ponta: cobrança → pagamento no provedor → webhook assinado. */
export async function fund(l: Leader, cents: number, opts: { payerCpf?: string | null } = {}) {
  const dep = await createDeposit(l.user, { teamId: l.team.id, amountCents: cents });
  const payer = opts.payerCpf === undefined ? l.cpf : opts.payerCpf;
  const { rawBody, headers } = await mockPayCharge(dep.providerChargeId!, payer);
  const res = await handlePixWebhook(headers, rawBody);
  return { dep, res, rawBody, headers };
}

/** Envelhece lançamentos e depósitos para simular a passagem do tempo (janelas de retenção). */
export async function backdate(walletId: string, hours: number) {
  const ago = (h: number) => new Date(Date.now() - h * 3600_000);
  const entries = await db.ledgerEntry.findMany({ where: { walletId } });
  for (const e of entries) await db.ledgerEntry.update({ where: { id: e.id }, data: { createdAt: new Date(e.createdAt.getTime() - hours * 3600_000) } });
  await db.deposit.updateMany({ where: { walletId }, data: { confirmedAt: ago(hours) } });
}

export async function balances(walletId: string) {
  const w = await db.wallet.findUniqueOrThrow({ where: { id: walletId } });
  return { available: w.balanceCents, locked: w.lockedCents };
}

export function lastOtp(email: string): string {
  const mail = [...testOutbox].reverse().find((m) => m.to === email && m.subject.includes("Código de confirmação"));
  const m = mail?.text.match(/Código de confirmação: (\d{6})/);
  if (!m) throw new Error("OTP não encontrado no e-mail");
  return m[1];
}

export async function emailOf(user: Actor) {
  return (await db.user.findUniqueOrThrow({ where: { id: user.id } })).email;
}

import { acceptChallenge, createChallenge, reportChallengeResult } from "@/server/challenges";

/** Duas equipes jogam um desafio 1v1 e `winner` ganha (o perdedor reconhece a derrota). */
export async function playChallenge(a: Leader, b: Leader, stakeCents: number, winner: "a" | "b" = "a") {
  const c = await createChallenge(a.user, { teamId: a.team.id, gameId: "sf6", modeId: "1v1", bestOf: 3, stakeCents, lineupUserIds: [a.user.id] });
  await acceptChallenge(b.user, c.id, { teamId: b.team.id, lineupUserIds: [b.user.id] });
  const loser = winner === "a" ? b : a;
  await reportChallengeResult(loser.user, c.id, "LOST");
  return c;
}

/** Líder cuja equipe depositou `depositCents`, jogou e ganhou — e cujas retenções já expiraram. */
export async function leaderWithWinnings(depositCents = 20_000, stakeCents = 10_000) {
  const winner = await makeLeader();
  const loser = await makeLeader();
  await fund(winner, depositCents);
  await fund(loser, stakeCents);
  await playChallenge(winner, loser, stakeCents, "a");
  await backdate(winner.walletId, 100);
  return { winner, loser };
}
