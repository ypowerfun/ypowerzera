/**
 * Dados de demonstração (SOMENTE desenvolvimento). Passa pelos serviços reais — KYC cifrado,
 * depósitos Pix pelo webhook assinado, desafios com escrow — para que o razão fique íntegro.
 *
 *   npm run db:seed        → cria os dados (não faz nada se já existirem)
 *
 * Logins (senha: Prime#Arena2026 — ou SEED_PASSWORD):  admin@primearena.local · organizador@primearena.local ·
 * lider1@primearena.local … lider4@primearena.local · jogador1..6@primearena.local
 */
import { db } from "../src/lib/db";
import { hashPassword } from "../src/lib/crypto";
import { generateCpf } from "../src/lib/cpf";
import { effectiveRole, toSafeUser } from "../src/server/auth";
import { createOrganization } from "../src/server/orgs";
import { createTeam } from "../src/server/teams";
import { saveGameAccount } from "../src/server/game-accounts";
import { reviewKyc, submitKyc } from "../src/server/kyc";
import { createDeposit } from "../src/server/deposits";
import { handlePixWebhook } from "../src/server/pix-webhooks";
import { mockPayCharge } from "../src/server/pix/mock";
import { acceptChallenge, createChallenge, disputeChallenge, reportChallengeResult } from "../src/server/challenges";
import { createTournament, publishTournament } from "../src/server/tournaments";
import { registerForTournament } from "../src/server/registration";
import { createCoupon } from "../src/server/orders";
import { runReconciliation } from "../src/server/admin-wallet";
import type { Actor } from "../src/server/types";

const PASSWORD = process.env.SEED_PASSWORD ?? "Prime#Arena2026";
const hours = (h: number) => new Date(Date.now() + h * 3600_000);
const ago = (h: number) => new Date(Date.now() - h * 3600_000);

async function user(email: string, displayName: string, role: "USER" | "ORGANIZER" | "ADMIN" = "USER"): Promise<Actor> {
  const username = email.split("@")[0];
  const u = await db.user.create({
    data: { email, username, displayName, role, passwordHash: await hashPassword(PASSWORD), emailVerifiedAt: new Date(), createdAt: ago(24 * 15) },
  });
  return { ...toSafeUser(u), role: effectiveRole(u) } as Actor;
}

let cpfN = 4242;
const nextCpf = () => generateCpf(++cpfN * 7919);

async function verifiedLeader(admin: Actor, n: number, name: string, tag: string) {
  const u = await user(`lider${n}@primearena.local`, `Líder ${n}`);
  const cpf = nextCpf();
  await submitKyc(u, { fullName: `${name} da Silva`, cpf, birthDate: "1996-03-10" });
  await reviewKyc(admin, u.id, "approve");
  await db.kycProfile.update({ where: { userId: u.id }, data: { reviewedAt: ago(72) } });
  const team = await createTeam(u, { name, tag });
  await db.team.update({ where: { id: team.id }, data: { createdAt: ago(72) } });
  await saveGameAccount(u.id, "sf6", { capcomId: `lider${n}`, platform: "PC" });
  return { u, cpf, team };
}

async function deposit(l: Awaited<ReturnType<typeof verifiedLeader>>, cents: number, payerCpf: string | null = l.cpf) {
  const dep = await createDeposit(l.u, { teamId: l.team.id, amountCents: cents });
  const { rawBody, headers } = await mockPayCharge(dep.providerChargeId!, payerCpf);
  await handlePixWebhook(headers, rawBody);
}

async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("O seed é só para desenvolvimento.");
  if (await db.user.findUnique({ where: { email: "admin@primearena.local" } })) {
    console.log("Dados de demonstração já existem — nada a fazer. (Para recomeçar, apague prisma/dev.db e rode `npm run db:push && npm run db:seed`.)");
    return;
  }

  const admin = await user("admin@primearena.local", "Admin Prime", "ADMIN");
  const organizer = await user("organizador@primearena.local", "Organizador Prime", "ORGANIZER");
  const org = await createOrganization(organizer, { name: "Prime Arena One Oficial", description: "Campeonatos oficiais da plataforma." });

  // Jogadores avulsos (verificados, com contas de jogo) para torneios individuais
  const players: Actor[] = [];
  for (let i = 1; i <= 6; i++) {
    const p = await user(`jogador${i}@primearena.local`, `Jogador ${i}`);
    await saveGameAccount(p.id, "sf6", { capcomId: `jogador${i}`, platform: "PC" });
    players.push(p);
  }

  // Quatro equipes com líder verificado e saldo
  const l1 = await verifiedLeader(admin, 1, "Trovão Azul", "TRV");
  const l2 = await verifiedLeader(admin, 2, "Fênix Digital", "FNX");
  const l3 = await verifiedLeader(admin, 3, "Lobos do Norte", "LBN");
  const l4 = await verifiedLeader(admin, 4, "Sombra Prime", "SPR");
  await deposit(l1, 50_000);
  await deposit(l2, 30_000);
  await deposit(l3, 20_000);
  await deposit(l4, 10_000);

  // Desafios: um aberto, um liquidado, um em disputa (para a fila do admin)
  const open = await createChallenge(l1.u, { teamId: l1.team.id, gameId: "sf6", modeId: "1v1", bestOf: 3, stakeCents: 5_000, lineupUserIds: [l1.u.id], notes: "Procuro adversário nível Diamante." });
  const settled = await createChallenge(l2.u, { teamId: l2.team.id, gameId: "sf6", modeId: "1v1", bestOf: 3, stakeCents: 2_000, lineupUserIds: [l2.u.id] });
  await acceptChallenge(l3.u, settled.id, { teamId: l3.team.id, lineupUserIds: [l3.u.id] });
  await reportChallengeResult(l3.u, settled.id, "LOST");
  const disputed = await createChallenge(l3.u, { teamId: l3.team.id, gameId: "sf6", modeId: "1v1", bestOf: 1, stakeCents: 3_000, lineupUserIds: [l3.u.id] });
  await acceptChallenge(l4.u, disputed.id, { teamId: l4.team.id, lineupUserIds: [l4.u.id] });
  await disputeChallenge(l4.u, disputed.id, "O adversário alega vitória, mas houve queda de conexão no round final. Tenho o vídeo.");

  // Fila do admin: KYC pendente + depósito retido (Pix pago por CPF de terceiro)
  const pending = await user("kyc.pendente@primearena.local", "Aguardando KYC");
  await submitKyc(pending, { fullName: "Maria Pendente de Souza", cpf: nextCpf(), birthDate: "1999-09-09" });
  await deposit(l4, 5_000, nextCpf());

  // Torneios
  const free = await createTournament(organizer, {
    orgId: org.id, gameId: "sf6", modeId: "1v1", presetId: "sf6.single-elim",
    name: "Copa Prime Arena One de Street Fighter 6", summary: "Eliminação simples, melhor de 3. Inscrição gratuita.",
    description: "Torneio aberto da comunidade. Check-in 30 minutos antes.", startsAt: hours(72), maxParticipants: 16, requireCheckIn: true,
    prizePoolCents: 100_000,
  });
  await publishTournament(organizer, free.id);
  for (const p of players) await registerForTournament(p, { tournamentId: free.id, acceptRules: true });

  const paid = await createTournament(organizer, {
    orgId: org.id, gameId: "valorant", modeId: "5v5", presetId: "valorant.double-elim",
    name: "Prime Arena One Valorant Cup #1", summary: "Chave dupla. Inscrição por equipe.",
    startsAt: hours(120), maxParticipants: 16, entryFeeCents: 5_000, prizePoolCents: 400_000, requireCheckIn: true,
  });
  await publishTournament(organizer, paid.id);
  await createCoupon(organizer, { orgId: org.id, tournamentId: paid.id, code: "BEMVINDO", percentOff: 20, maxRedemptions: 100 });

  const rec = await runReconciliation();
  console.log(rec.ok ? "Conciliação do razão: OK" : `ATENÇÃO — inconsistências: ${rec.mismatches.join(" | ")}`);
  console.log(`\nPronto. Senha de todos: ${PASSWORD}`);
  console.log("  admin@primearena.local · organizador@primearena.local · lider1..4@primearena.local · jogador1..6@primearena.local");
  console.log(`  Desafio aberto: /desafios/${open.id}`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => db.$disconnect());
