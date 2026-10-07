import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { PASSWORD, linkGame, makeOrg, makeTeamWithPlayers, makeUser, uid } from "./factories";
import { admin } from "./wallet-helpers";
import { createTournament, publishTournament, startTournament, updateTournament } from "@/server/tournaments";
import { checkIn, registerForTournament, withdrawRegistration } from "@/server/registration";
import { openDispute, reportMatch } from "@/server/matches";
import { completeOrder } from "@/server/orders";
import { addOrgMember, removeOrgMember } from "@/server/orgs";
import { setMemberRole } from "@/server/teams";
import { setUserBan } from "@/server/users-admin";
import { createSession, getUserBySessionToken, login } from "@/server/auth";
import { hashPassword } from "@/lib/crypto";
import type { Actor } from "@/server/types";

const future = (h: number) => new Date(Date.now() + h * 3600_000);
/** Inscrição desfeita: a linha some (sem pagamento) ou fica WITHDRAWN (com pedido pago); nos dois casos ela não vale mais. */
const isGone = async (id: string) => {
  const row = await db.participant.findUnique({ where: { id } });
  return row === null || row.status === "WITHDRAWN";
};
const usernameOf = async (a: Actor) => (await db.user.findUniqueOrThrow({ where: { id: a.id } })).username;

async function setup(gameId: string, modeId: string, presetId: string, extra: Record<string, unknown> = {}) {
  const owner = await makeUser();
  const org = await makeOrg(owner);
  const t = await createTournament(owner, {
    orgId: org.id, gameId, modeId, presetId, name: `Copa de segurança ${uid()}`, startsAt: future(48), maxParticipants: 16, requireCheckIn: true, ...extra,
  });
  await publishTournament(owner, t.id);
  return { owner, org, t };
}

async function liveMatch() {
  const { owner, org, t } = await setup("sf6", "1v1", "sf6.single-elim");
  const players = new Map<string, Actor>();
  for (let i = 0; i < 4; i++) {
    const u = await makeUser();
    await linkGame(u, "sf6");
    await registerForTournament(u, { tournamentId: t.id, acceptRules: true });
    players.set(u.id, u);
  }
  for (const p of await db.participant.findMany({ where: { tournamentId: t.id } })) await checkIn(owner, p.id);
  await startTournament(owner, t.id);
  const match = await db.match.findFirstOrThrow({ where: { status: "READY", stage: { tournamentId: t.id } }, include: { participantA: true, participantB: true } });
  return { owner, org, t, match, a: players.get(match.participantA!.userId)!, b: players.get(match.participantB!.userId)! };
}

describe("cupom: tentativas limitadas (não dá para adivinhar códigos)", () => {
  it("após 15 tentativas na hora, a próxima é barrada mesmo que o código seja válido", async () => {
    const { t } = await setup("sf6", "1v1", "sf6.single-elim", { entryFeeCents: 2000 });
    const u = await makeUser();
    await linkGame(u, "sf6");
    for (let i = 0; i < 15; i++) {
      await expect(registerForTournament(u, { tournamentId: t.id, acceptRules: true, couponCode: `CHUTE${i}` })).rejects.toThrow(/Cupom inválido/);
    }
    await expect(registerForTournament(u, { tournamentId: t.id, acceptRules: true, couponCode: "CHUTE16" })).rejects.toThrow(/Muitas tentativas de cupom/);
    await expect(registerForTournament(u, { tournamentId: t.id, acceptRules: true, couponCode: "x".repeat(41) })).rejects.toThrow(/Cupom inválido/);
  });
});

describe("remover inscrição paga é decisão de admin da organização", () => {
  it("equipe de apoio não remove (nem reembolsa) inscrição paga; o admin da organização sim; inscrição gratuita a equipe remove", async () => {
    const { owner, org, t } = await setup("sf6", "1v1", "sf6.single-elim", { entryFeeCents: 2000 });
    const staff = await makeUser();
    await addOrgMember(owner, org.id, await usernameOf(staff), "STAFF");

    const payer = await makeUser();
    await linkGame(payer, "sf6");
    const reg = await registerForTournament(payer, { tournamentId: t.id, acceptRules: true });
    expect(await completeOrder(reg.orderId!, { amountTotal: 2200, currency: "BRL", paymentId: `pi_${uid()}`, method: "card" })).toBe("paid");

    await expect(withdrawRegistration(staff, reg.participantId)).rejects.toThrow(/permissão/);
    expect((await db.order.findUniqueOrThrow({ where: { id: reg.orderId! } })).status).toBe("PAID"); // nada foi reembolsado

    await withdrawRegistration(owner, reg.participantId);
    expect(await isGone(reg.participantId)).toBe(true);
    expect((await db.order.findUniqueOrThrow({ where: { id: reg.orderId! } })).status).toMatch(/REFUNDED/);

    // campeonato gratuito: não há dinheiro envolvido, a equipe de apoio continua podendo remover
    const free = await setup("sf6", "1v1", "sf6.single-elim");
    const staff2 = await makeUser();
    await addOrgMember(free.owner, free.org.id, await usernameOf(staff2), "STAFF");
    const p = await makeUser();
    await linkGame(p, "sf6");
    const r2 = await registerForTournament(p, { tournamentId: free.t.id, acceptRules: true });
    await withdrawRegistration(staff2, r2.participantId);
    expect(await isGone(r2.participantId)).toBe(true);
  });
});

describe("disputa: texto limitado, só com o campeonato em andamento, sem inundar a organização", () => {
  it("recusa texto grande, limita o total e avisa a organização uma vez só", async () => {
    const { owner, match, a, b } = await liveMatch();
    await expect(openDispute(a, match.id, "x".repeat(601))).rejects.toThrow(/600 caracteres/);
    await expect(openDispute(a, match.id, "abc")).rejects.toThrow(/mínimo/);

    const before = await db.notification.count({ where: { userId: owner.id, kind: "match.disputed" } });
    await openDispute(a, match.id, "O adversário não apareceu no horário combinado.");
    await openDispute(b, match.id, "Eu estava na sala e tenho o print como prova.");
    expect(await db.notification.count({ where: { userId: owner.id, kind: "match.disputed" } })).toBe(before + 1);

    // o texto acumulado tem teto: depois de muitas mensagens a disputa recusa novas
    let refused = false;
    for (let i = 0; i < 12 && !refused; i++) {
      await db.rateLimit.deleteMany({ where: { key: { startsWith: "dispute:" } } });
      refused = await openDispute(a, match.id, `mensagem ${i} ${"y".repeat(560)}`).then(() => false, (e: Error) => /muitas mensagens/.test(e.message));
    }
    expect(refused).toBe(true);
    const open = await db.matchDispute.findFirstOrThrow({ where: { matchId: match.id, status: "OPEN" } });
    expect(open.reason.length).toBeLessThanOrEqual(4000);
  });

  it("limita a frequência por pessoa", async () => {
    const { match, a } = await liveMatch();
    await db.rateLimit.deleteMany({ where: { key: `dispute:${a.id}` } });
    for (let i = 0; i < 10; i++) await openDispute(a, match.id, `tentativa ${i} do jogador`).catch(() => undefined);
    await expect(openDispute(a, match.id, "mais uma disputa seguida")).rejects.toThrow(/Muitas disputas/);
  });

  it("campeonato que não está em andamento não aceita disputa", async () => {
    const { t, match, a } = await liveMatch();
    await db.tournament.update({ where: { id: t.id }, data: { status: "CANCELED" } });
    await expect(openDispute(a, match.id, "tentando abrir depois de cancelado")).rejects.toThrow(/não está em andamento/);
  });
});

describe("troca de capitão: a inscrição do time passa para o novo capitão", () => {
  it("o ex-capitão perde o controle e o novo capitão assume", async () => {
    const { t } = await setup("cs2", "5v5", "cs2.single-elim");
    const { team, players } = await makeTeamWithPlayers(await makeUser(), 5, "cs2");
    const [oldCaptain, newCaptain] = players;
    void newCaptain;
    const reg = await registerForTournament(oldCaptain, { tournamentId: t.id, teamId: team.id, starterIds: players.map((p) => p.id), acceptRules: true });
    expect((await db.participant.findUniqueOrThrow({ where: { id: reg.participantId } })).userId).toBe(oldCaptain.id);

    await setMemberRole(oldCaptain, team.id, players[1].id, "CAPTAIN");
    expect((await db.participant.findUniqueOrThrow({ where: { id: reg.participantId } })).userId).toBe(players[1].id);

    // o ex-capitão, agora só jogador, não consegue mais desistir nem desfazer nada pelo time
    await expect(withdrawRegistration(oldCaptain, reg.participantId)).rejects.toThrow(/permissão/);
    await withdrawRegistration(players[1], reg.participantId);
    expect(await isGone(reg.participantId)).toBe(true);
  });

  it("não troca a inscrição de campeonato já encerrado", async () => {
    const { t } = await setup("cs2", "5v5", "cs2.single-elim");
    const { team, players } = await makeTeamWithPlayers(await makeUser(), 5, "cs2");
    const reg = await registerForTournament(players[0], { tournamentId: t.id, teamId: team.id, starterIds: players.map((p) => p.id), acceptRules: true });
    await db.tournament.update({ where: { id: t.id }, data: { status: "COMPLETED" } });
    await setMemberRole(players[0], team.id, players[2].id, "CAPTAIN");
    expect((await db.participant.findUniqueOrThrow({ where: { id: reg.participantId } })).userId).toBe(players[0].id);
  });
});

describe("premiação anunciada vira promessa depois das inscrições", () => {
  it("só pode aumentar; a divisão não muda; sem inscritos continua livre", async () => {
    const { owner, t } = await setup("sf6", "1v1", "sf6.single-elim", { prizePoolCents: 10_000 });
    await updateTournament(owner, t.id, { prizePoolCents: 8_000 }); // ninguém inscrito ainda: livre
    const p = await makeUser();
    await linkGame(p, "sf6");
    await registerForTournament(p, { tournamentId: t.id, acceptRules: true });
    await expect(updateTournament(owner, t.id, { prizePoolCents: 100 })).rejects.toThrow(/só pode aumentar/);
    await expect(updateTournament(owner, t.id, { prizePoolCents: 7_999 })).rejects.toThrow(/só pode aumentar/);
    await updateTournament(owner, t.id, { prizePoolCents: 20_000 });
    expect((await db.tournament.findUniqueOrThrow({ where: { id: t.id } })).prizePoolCents).toBe(20_000);
    await expect(updateTournament(owner, t.id, { prizeSplit: [{ placement: 1, label: "Campeão", percent: 100 }] })).rejects.toThrow(/divisão da premiação/);
  });
});

describe("sem provedor de pagamento não se cria taxa em campeonato publicado", () => {
  const saved = process.env.PAYMENTS_PROVIDER;
  afterEach(() => {
    if (saved === undefined) delete process.env.PAYMENTS_PROVIDER;
    else process.env.PAYMENTS_PROVIDER = saved;
  });

  it("PAYMENTS_PROVIDER=none recusa a taxa depois de publicado (as vagas não ficariam presas)", async () => {
    const { owner, t } = await setup("sf6", "1v1", "sf6.single-elim");
    process.env.PAYMENTS_PROVIDER = "none";
    await expect(updateTournament(owner, t.id, { entryFeeCents: 1500 })).rejects.toThrow(/Pagamentos indisponíveis/);
    process.env.PAYMENTS_PROVIDER = "mock";
    await updateTournament(owner, t.id, { entryFeeCents: 1500 });
  });
});

describe("membros da organização", () => {
  it("só o dono põe e tira outro admin; o admin gerencia a equipe de apoio; o dono não sai", async () => {
    const owner = await makeUser();
    const org = await makeOrg(owner);
    const orgAdmin = await makeUser({ role: "ORGANIZER" });
    const orgAdmin2 = await makeUser({ role: "ORGANIZER" });
    const staff = await makeUser();
    await addOrgMember(owner, org.id, await usernameOf(orgAdmin), "ADMIN");

    await expect(addOrgMember(orgAdmin, org.id, await usernameOf(orgAdmin2), "ADMIN")).rejects.toThrow(/só o dono/i);
    await addOrgMember(orgAdmin, org.id, await usernameOf(staff), "STAFF");
    await addOrgMember(owner, org.id, await usernameOf(orgAdmin2), "ADMIN");

    await expect(removeOrgMember(orgAdmin, org.id, orgAdmin2.id)).rejects.toThrow(/só o dono/i);
    await removeOrgMember(orgAdmin, org.id, staff.id);
    expect(await db.orgMember.count({ where: { orgId: org.id, userId: staff.id } })).toBe(0);
    await expect(removeOrgMember(orgAdmin, org.id, staff.id)).rejects.toThrow(/não faz parte/);
    await expect(removeOrgMember(orgAdmin, org.id, owner.id)).rejects.toThrow(/dono/);

    await removeOrgMember(owner, org.id, orgAdmin2.id);
    expect(await db.orgMember.count({ where: { orgId: org.id, userId: orgAdmin2.id } })).toBe(0);
    await removeOrgMember(await admin(), org.id, orgAdmin.id); // admin da plataforma também
    expect(await db.orgMember.count({ where: { orgId: org.id, userId: orgAdmin.id } })).toBe(0);

    // quem foi removido perde o acesso na hora
    await expect(addOrgMember(orgAdmin, org.id, await usernameOf(staff), "STAFF")).rejects.toThrow(/permissão/);
    // estranho não remove ninguém
    await expect(removeOrgMember(await makeUser(), org.id, owner.id)).rejects.toThrow(/permissão/);
  });
});

describe("suspender e reativar contas (admin)", () => {
  it("desconecta na hora, impede o login e a reativação devolve o acesso; tudo auditado", async () => {
    const adm = await admin();
    const u = await makeUser();
    const dbU = await db.user.findUniqueOrThrow({ where: { id: u.id } });
    await db.user.update({ where: { id: u.id }, data: { passwordHash: await hashPassword(PASSWORD) } });
    const s = await createSession(u.id);
    expect(await getUserBySessionToken(s.token)).not.toBeNull();

    await expect(setUserBan(adm, u.id, true, "abc")).rejects.toThrow(/motivo/);
    await setUserBan(adm, u.id, true, "Fraude comprovada em desafio");
    expect(await getUserBySessionToken(s.token)).toBeNull();
    expect(await db.session.count({ where: { userId: u.id } })).toBe(0);
    await expect(login({ identifier: dbU.email, password: PASSWORD }, { ip: `ban-${uid()}` })).rejects.toThrow(/suspensa/);
    await expect(setUserBan(adm, u.id, true, "de novo, mesmo motivo")).rejects.toThrow(/já está suspensa/);
    expect(await db.auditLog.count({ where: { action: "user.ban", entityId: u.id } })).toBe(1);

    await setUserBan(adm, u.id, false, "");
    const back = await login({ identifier: dbU.email, password: PASSWORD }, { ip: `ban-${uid()}` });
    expect(back.user.id).toBe(u.id);
    expect(await db.auditLog.count({ where: { action: "user.unban", entityId: u.id } })).toBe(1);
  });

  it("não suspende a si mesmo, outro administrador, e só admin suspende", async () => {
    const adm = await admin();
    const other = await makeUser({ role: "ADMIN" });
    const player = await makeUser();
    await expect(setUserBan(adm, adm.id, true, "motivo qualquer")).rejects.toThrow(/si mesmo/);
    await expect(setUserBan(adm, other.id, true, "motivo qualquer")).rejects.toThrow(/Administradores/);
    await expect(setUserBan(player, other.id, true, "motivo qualquer")).rejects.toThrow();
    await expect(setUserBan(player, adm.id, true, "motivo qualquer")).rejects.toThrow();
  });
});

// reportMatch já é coberto em tournament-flow; aqui só garantimos que a troca de capitão não mexe em partidas de quem não é do time
describe("relato de placar continua restrito aos dois lados", () => {
  it("um estranho não relata", async () => {
    const { match } = await liveMatch();
    await expect(reportMatch(await makeUser(), match.id, 2, 0)).rejects.toThrow();
  });
});
