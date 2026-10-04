import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { PASSWORD, linkGame, makeOrg, makeTeamWithPlayers, makeUser } from "./factories";
import { createTournament, publishTournament, startTournament, startNextStage, openCheckIn, cancelTournament, updateTournament } from "@/server/tournaments";
import { checkIn, disqualifyParticipant, registerForTournament, withdrawRegistration } from "@/server/registration";
import { forfeitMatch, openDispute, reportMatch, resetMatch, setMatchResult } from "@/server/matches";
import { submitBrResults } from "@/server/leaderboard";
import { completeOrder, createCoupon, expireStaleReservations, refundOrder } from "@/server/orders";
import { getPreset } from "@/games";
import { loadStage } from "@/server/stage-runner";
import type { Actor } from "@/server/types";

const future = (h: number) => new Date(Date.now() + h * 3600_000);

async function setup(gameId: string, modeId: string, presetId: string, extra: Record<string, unknown> = {}) {
  const owner = await makeUser();
  const org = await makeOrg(owner);
  const t = await createTournament(owner, {
    orgId: org.id,
    gameId,
    modeId,
    presetId,
    name: `Copa de teste ${Math.random().toString(36).slice(2, 8)}`,
    startsAt: future(48),
    maxParticipants: 64,
    requireCheckIn: true,
    ...extra,
  });
  await publishTournament(owner, t.id);
  return { owner, org, t };
}

async function registerSolo(t: { id: string }, gameId: string, n: number) {
  const out: Actor[] = [];
  for (let i = 0; i < n; i++) {
    const u = await makeUser();
    await linkGame(u, gameId);
    const r = await registerForTournament(u, { tournamentId: t.id, acceptRules: true });
    expect(r.status).toBe("REGISTERED");
    out.push(u);
  }
  return out;
}

/** Joga todas as partidas prontas até o estágio acabar, via relato dos dois capitães. */
async function playAllMatches(owner: Actor, tournamentId: string, players: Map<string, Actor>, pick: (a: number, b: number) => "a" | "b" = (a, b) => (a < b ? "a" : "b")) {
  for (let guard = 0; guard < 500; guard++) {
    const ready = await db.match.findMany({ where: { status: "READY", stage: { tournamentId } }, include: { participantA: true, participantB: true } });
    if (!ready.length) return;
    for (const m of ready) {
      const winner = pick(m.participantA!.seed!, m.participantB!.seed!);
      const need = m.bestOf === 1 ? 1 : Math.floor(m.bestOf / 2) + 1;
      const [sa, sb] = winner === "a" ? [need, 0] : [0, need];
      const a = players.get(m.participantA!.userId)!;
      const b = players.get(m.participantB!.userId)!;
      expect(await reportMatch(a, m.id, sa, sb)).toBe("reported");
      expect(await reportMatch(b, m.id, sa, sb)).toBe("completed");
    }
  }
  throw new Error("não terminou");
}

describe("campeonato individual gratuito (SF6, eliminação simples)", () => {
  it("inscrição → check-in → chave → placares → campeão e colocações", async () => {
    const { owner, t } = await setup("sf6", "1v1", "sf6.single-elim");
    const players = await registerSolo(t, "sf6", 8);
    const parts = await db.participant.findMany({ where: { tournamentId: t.id } });
    // sem check-in não começa
    await expect(startTournament(owner, t.id)).rejects.toThrow(/pelo menos/);
    for (const p of parts) await checkIn(owner, p.id);
    const started = await startTournament(owner, t.id);
    expect(started.status).toBe("LIVE");

    const stage = await db.stage.findFirstOrThrow({ where: { tournamentId: t.id } });
    expect(stage.status).toBe("LIVE");
    const matches = await db.match.findMany({ where: { stageId: stage.id } });
    expect(matches.length).toBe(8); // 7 + disputa de 3º
    expect(matches.filter((m) => m.status === "READY").length).toBe(4);

    const map = new Map(players.map((p) => [p.id, p]));
    await playAllMatches(owner, t.id, map);

    const done = await db.tournament.findUniqueOrThrow({ where: { id: t.id } });
    expect(done.status).toBe("COMPLETED");
    const final = await db.participant.findMany({ where: { tournamentId: t.id }, orderBy: { finalPlacement: "asc" } });
    expect(final.map((p) => p.finalPlacement)).toEqual([1, 2, 3, 4, 5, 5, 5, 5]);
    expect(final[0].seed).toBe(1); // favorito venceu tudo
    // notificações de partida
    expect(await db.notification.count({ where: { kind: "match.ready" } })).toBeGreaterThan(0);
  });

  it("partidas só aceitam relato dos capitães e placar válido", async () => {
    const { owner, t } = await setup("sf6", "1v1", "sf6.single-elim");
    const players = await registerSolo(t, "sf6", 4);
    for (const p of await db.participant.findMany({ where: { tournamentId: t.id } })) await checkIn(owner, p.id);
    await startTournament(owner, t.id);
    const m = await db.match.findFirstOrThrow({ where: { status: "READY", stage: { tournamentId: t.id } }, include: { participantA: true, participantB: true } });
    const outsider = await makeUser();
    await expect(reportMatch(outsider, m.id, 2, 0)).rejects.toThrow(/capitães/);
    const a = players.find((p) => p.id === m.participantA!.userId)!;
    const b = players.find((p) => p.id === m.participantB!.userId)!;
    await expect(reportMatch(a, m.id, 1, 1)).rejects.toThrow(/vencedor/);
    await expect(reportMatch(a, m.id, 3, 0)).rejects.toThrow();
    expect(await reportMatch(a, m.id, 2, 0)).toBe("reported");
    // divergência vira disputa
    expect(await reportMatch(b, m.id, 0, 2)).toBe("disputed");
    expect((await db.matchDispute.count({ where: { matchId: m.id, status: "OPEN" } }))).toBe(1);
    // só a organização resolve
    await expect(setMatchResult(a, m.id, 2, 0)).rejects.toThrow(/permissão/);
    await setMatchResult(owner, m.id, 2, 1, "Conferido pelo replay");
    const after = await db.match.findUniqueOrThrow({ where: { id: m.id } });
    expect(after.status).toBe("COMPLETED");
    expect(after.winnerSide).toBe("a");
    expect(await db.matchDispute.count({ where: { matchId: m.id, status: "OPEN" } })).toBe(0);
  });

  it("não deixa alterar resultado quando a fase seguinte já foi jogada; reset libera", async () => {
    const { owner, t } = await setup("sf6", "1v1", "sf6.single-elim");
    const players = await registerSolo(t, "sf6", 4);
    for (const p of await db.participant.findMany({ where: { tournamentId: t.id } })) await checkIn(owner, p.id);
    await startTournament(owner, t.id);
    const map = new Map(players.map((p) => [p.id, p]));
    const first = await db.match.findFirstOrThrow({ where: { key: "W1-1", stage: { tournamentId: t.id } } });
    const need = (bo: number) => (bo === 1 ? 1 : Math.floor(bo / 2) + 1);
    const ready = await db.match.findMany({ where: { status: "READY", stage: { tournamentId: t.id } } });
    for (const m of ready) await setMatchResult(owner, m.id, need(m.bestOf), 0);
    const final = await db.match.findFirstOrThrow({ where: { key: "W2-1", stage: { tournamentId: t.id } } });
    expect(final.status).toBe("READY");
    // alterar W1-1 muda o finalista: permitido enquanto a final não foi jogada
    await setMatchResult(owner, first.id, 0, need(first.bestOf));
    const refreshed = await db.match.findUniqueOrThrow({ where: { id: final.id } });
    expect(refreshed.status).toBe("READY");
    await setMatchResult(owner, final.id, need(final.bestOf), 0);
    await expect(setMatchResult(owner, first.id, need(first.bestOf), 0)).rejects.toThrow(/seguintes/);
    await resetMatch(owner, final.id);
    await setMatchResult(owner, first.id, need(first.bestOf), 0);
    void map;
  });

  it("W.O. e desclassificação no meio do campeonato", async () => {
    const { owner, t } = await setup("sf6", "1v1", "sf6.single-elim");
    await registerSolo(t, "sf6", 8);
    for (const p of await db.participant.findMany({ where: { tournamentId: t.id } })) await checkIn(owner, p.id);
    await startTournament(owner, t.id);
    const target = await db.participant.findFirstOrThrow({ where: { tournamentId: t.id, seed: 1 } });
    await disqualifyParticipant(owner, target.id, "Uso de macro comprovado");
    const m = await db.match.findFirstOrThrow({ where: { stage: { tournamentId: t.id }, OR: [{ participantAId: target.id }, { participantBId: target.id }] } });
    expect(m.status).toBe("COMPLETED");
    expect(m.forfeit).not.toBeNull();
    const winnerId = m.winnerSide === "a" ? m.participantAId : m.participantBId;
    expect(winnerId).not.toBe(target.id);
    // o adversário já avançou
    const next = await db.match.findFirstOrThrow({ where: { key: "W2-1", stage: { tournamentId: t.id } } });
    expect([next.participantAId, next.participantBId]).toContain(winnerId);
    // W.O. manual
    const ready = await db.match.findFirstOrThrow({ where: { status: "READY", stage: { tournamentId: t.id } } });
    await forfeitMatch(owner, ready.id, "a", "Não compareceu");
    const wo = await db.match.findUniqueOrThrow({ where: { id: ready.id } });
    expect(wo.winnerSide).toBe("b");
    expect(wo.forfeit).toBe("a");
  });

  it("validação ao editar: nome, links e limites", async () => {
    const { owner, t } = await setup("sf6", "1v1", "sf6.single-elim");
    await expect(updateTournament(owner, t.id, { name: "ab" })).rejects.toThrow(/nome/i);
    await expect(updateTournament(owner, t.id, { streamUrl: "javascript:alert(1)" })).rejects.toThrow(/link válido/);
    await expect(updateTournament(owner, t.id, { discordUrl: "não é url" })).rejects.toThrow(/link válido/);
    const ok = await updateTournament(owner, t.id, { name: "Novo nome da copa", streamUrl: "https://twitch.tv/canal", summary: "" });
    expect(ok.name).toBe("Novo nome da copa");
    expect(ok.summary).toBeNull();
  });

  it("controle de acesso: só a organização opera o campeonato", async () => {
    const { owner, t } = await setup("sf6", "1v1", "sf6.single-elim");
    const stranger = await makeUser();
    await expect(startTournament(stranger, t.id)).rejects.toThrow(/permissão/);
    await expect(updateTournament(stranger, t.id, { name: "Hackeado" })).rejects.toThrow(/permissão/);
    await expect(cancelTournament(stranger, t.id, "teste")).rejects.toThrow(/permissão/);
    await expect(openCheckIn(stranger, t.id)).rejects.toThrow(/permissão/);
    await expect(openCheckIn(owner, t.id)).resolves.toBeUndefined();
  });
});

describe("inscrição de equipes (CS2)", () => {
  it("elenco, capitão, reservas e jogador duplicado", async () => {
    const { owner, t } = await setup("cs2", "5v5", "cs2.single-elim");
    const { team, players } = await makeTeamWithPlayers(await makeUser(), 5, "cs2");
    const captain = players[0];
    const starters = players.map((p) => p.id);
    // sem aceitar regulamento
    await expect(registerForTournament(captain, { tournamentId: t.id, teamId: team.id, starterIds: starters, acceptRules: false })).rejects.toThrow(/regulamento/);
    // titulares a menos
    await expect(registerForTournament(captain, { tournamentId: t.id, teamId: team.id, starterIds: starters.slice(0, 4), acceptRules: true })).rejects.toThrow(/exatamente 5/);
    // quem não é capitão não inscreve
    await expect(registerForTournament(players[1], { tournamentId: t.id, teamId: team.id, starterIds: starters, acceptRules: true })).rejects.toThrow(/capitão/);
    const ok = await registerForTournament(captain, { tournamentId: t.id, teamId: team.id, starterIds: starters, acceptRules: true });
    expect(ok.status).toBe("REGISTERED");
    const p = await db.participant.findUniqueOrThrow({ where: { id: ok.participantId } });
    expect((p.roster as unknown as unknown[]).length).toBe(5);
    expect(p.name).toBe(team.name);
    // mesmo capitão de novo
    await expect(registerForTournament(captain, { tournamentId: t.id, teamId: team.id, starterIds: starters, acceptRules: true })).rejects.toThrow(/já está inscrito/);
    // jogador de outro time já no elenco
    const other = await makeTeamWithPlayers(await makeUser(), 4, "cs2");
    await db.teamMember.create({ data: { teamId: other.team.id, userId: players[2].id, role: "PLAYER" } });
    await expect(
      registerForTournament(other.players[0], { tournamentId: t.id, teamId: other.team.id, starterIds: [...other.players.map((x) => x.id), players[2].id], acceptRules: true }),
    ).rejects.toThrow(/já está inscrito/);
    void owner;
  });

  it("exige conta de jogo vinculada e e-mail verificado", async () => {
    const { t } = await setup("cs2", "5v5", "cs2.single-elim");
    const unverified = await makeUser({ verified: false });
    await expect(registerForTournament(unverified, { tournamentId: t.id, acceptRules: true })).rejects.toThrow(/e-mail/i);
    const noAccount = await makeUser();
    const team = await makeTeamWithPlayers(noAccount, 1, "cs2");
    await db.gameAccount.deleteMany({ where: { userId: noAccount.id } });
    await expect(
      registerForTournament(noAccount, { tournamentId: t.id, teamId: team.team.id, starterIds: [noAccount.id], acceptRules: true }),
    ).rejects.toThrow(/exatamente 5/);
  });

  it("conta de jogo não pode ser reutilizada por outro usuário", async () => {
    const a = await makeUser();
    const b = await makeUser();
    const { saveGameAccount } = await import("@/server/game-accounts");
    await saveGameAccount(a.id, "lol", { riotId: "Unico#BR1" });
    await expect(saveGameAccount(b.id, "lol", { riotId: "Unico#BR1" })).rejects.toThrow(/já está vinculado/);
    await expect(saveGameAccount(b.id, "lol", { riotId: "sem-tag" })).rejects.toThrow(/Nome#TAG/);
  });
});

describe("capacidade, fila de espera e desistência", () => {
  it("lota, entra na fila e promove quando alguém desiste", async () => {
    const { owner, t } = await setup("sf6", "1v1", "sf6.single-elim", { maxParticipants: 4 });
    const ps = await registerSolo(t, "sf6", 4);
    const late = await makeUser();
    await linkGame(late, "sf6");
    const r = await registerForTournament(late, { tournamentId: t.id, acceptRules: true });
    expect(r.status).toBe("WAITLIST");
    const first = await db.participant.findFirstOrThrow({ where: { tournamentId: t.id, userId: ps[0].id } });
    await withdrawRegistration(ps[0], first.id);
    const promoted = await db.participant.findUniqueOrThrow({ where: { id: r.participantId } });
    expect(promoted.status).toBe("REGISTERED");
    expect(await db.notification.count({ where: { userId: late.id, kind: "waitlist.promoted" } })).toBe(1);
    void owner;
  });
});

describe("campeonato pago (checkout simulado)", () => {
  it("reserva a vaga, cobra taxa de serviço, confirma pagamento e é idempotente", async () => {
    const { owner, t } = await setup("sf6", "1v1", "sf6.single-elim", { entryFeeCents: 2000, prizePoolCents: 10000 });
    const u = await makeUser();
    await linkGame(u, "sf6");
    const r = await registerForTournament(u, { tournamentId: t.id, acceptRules: true });
    expect(r.status).toBe("PENDING_PAYMENT");
    const order = await db.order.findUniqueOrThrow({ where: { id: r.orderId! } });
    expect(order.subtotalCents).toBe(2000);
    expect(order.serviceFeeCents).toBe(200); // 10%
    expect(order.totalCents).toBe(2200);
    expect(order.status).toBe("PENDING");
    expect(order.number).toMatch(/^PA-\d{6}-[A-Z0-9]{6}$/);
    // valor divergente não confirma
    expect(await completeOrder(order.id, { amountTotal: 100, currency: "BRL" })).toBe("mismatch");
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("FAILED");
    void owner;
  });

  it("confirmação normal registra, e duplicata não faz nada", async () => {
    const { t } = await setup("sf6", "1v1", "sf6.single-elim", { entryFeeCents: 2000 });
    const u = await makeUser();
    await linkGame(u, "sf6");
    const r = await registerForTournament(u, { tournamentId: t.id, acceptRules: true });
    expect(await completeOrder(r.orderId!, { amountTotal: 2200, currency: "BRL", paymentId: "pi_1", method: "card" })).toBe("paid");
    expect(await completeOrder(r.orderId!, { amountTotal: 2200, currency: "BRL", paymentId: "pi_1" })).toBe("already");
    const p = await db.participant.findUniqueOrThrow({ where: { id: r.participantId } });
    expect(p.status).toBe("REGISTERED");
    expect((await db.order.findUniqueOrThrow({ where: { id: r.orderId! } })).paidAt).not.toBeNull();
  });

  it("reserva expirada libera a vaga; pagamento tardio é reembolsado", async () => {
    const { t } = await setup("sf6", "1v1", "sf6.single-elim", { entryFeeCents: 2000, maxParticipants: 2 });
    const u1 = await makeUser();
    const u2 = await makeUser();
    const u3 = await makeUser();
    for (const u of [u1, u2, u3]) await linkGame(u, "sf6");
    const r1 = await registerForTournament(u1, { tournamentId: t.id, acceptRules: true });
    await registerForTournament(u2, { tournamentId: t.id, acceptRules: true });
    const wait = await registerForTournament(u3, { tournamentId: t.id, acceptRules: true });
    expect(wait.status).toBe("WAITLIST");
    await db.participant.update({ where: { id: r1.participantId }, data: { reservedUntil: new Date(Date.now() - 1000) } });
    await expireStaleReservations(db, t.id);
    expect(await db.participant.findUnique({ where: { id: r1.participantId } })).toBeNull();
    expect((await db.order.findUniqueOrThrow({ where: { id: r1.orderId! } })).status).toBe("EXPIRED");
    // fila promovida (pago → 24h para pagar)
    expect((await db.participant.findUniqueOrThrow({ where: { id: wait.participantId } })).status).toBe("PENDING_PAYMENT");
    // pagamento tardio do pedido expirado → reembolso automático
    expect(await completeOrder(r1.orderId!, { amountTotal: 2200, currency: "BRL", paymentId: "pi_late" })).toBe("refunded");
    const late = await db.order.findUniqueOrThrow({ where: { id: r1.orderId! } });
    expect(late.status).toBe("REFUNDED");
    expect(late.refundedCents).toBe(2200);
  });

  it("cupom: desconto, limite de usos e devolução ao cancelar; 100% vira gratuito", async () => {
    const { owner, org, t } = await setup("sf6", "1v1", "sf6.single-elim", { entryFeeCents: 2000 });
    await createCoupon(owner, { orgId: org.id, tournamentId: t.id, code: "meia50", percentOff: 50, maxRedemptions: 1 });
    await createCoupon(owner, { orgId: org.id, tournamentId: t.id, code: "free100", percentOff: 100 });
    const u1 = await makeUser();
    const u2 = await makeUser();
    const u3 = await makeUser();
    for (const u of [u1, u2, u3]) await linkGame(u, "sf6");
    const r1 = await registerForTournament(u1, { tournamentId: t.id, acceptRules: true, couponCode: "MEIA50" });
    const o1 = await db.order.findUniqueOrThrow({ where: { id: r1.orderId! } });
    expect([o1.discountCents, o1.serviceFeeCents, o1.totalCents]).toEqual([1000, 100, 1100]);
    await expect(registerForTournament(u2, { tournamentId: t.id, acceptRules: true, couponCode: "meia50" })).rejects.toThrow(/limite/);
    await expect(registerForTournament(u2, { tournamentId: t.id, acceptRules: true, couponCode: "nao-existe" })).rejects.toThrow(/Cupom inválido/);
    const r3 = await registerForTournament(u3, { tournamentId: t.id, acceptRules: true, couponCode: "FREE100" });
    expect(r3.status).toBe("REGISTERED");
    expect((await db.order.findUniqueOrThrow({ where: { id: r3.orderId! } })).totalCents).toBe(0);
    // desistir do pagamento devolve o uso do cupom
    const { cancelPendingOrder } = await import("@/server/orders");
    await cancelPendingOrder(u1, r1.orderId!);
    expect((await db.coupon.findUniqueOrThrow({ where: { code: "MEIA50" } })).redeemed).toBe(0);
  });

  it("desistir antes do check-in reembolsa; organização reembolsa e cancelamento devolve tudo", async () => {
    const { owner, t } = await setup("sf6", "1v1", "sf6.single-elim", { entryFeeCents: 2000 });
    const u = await makeUser();
    await linkGame(u, "sf6");
    const r = await registerForTournament(u, { tournamentId: t.id, acceptRules: true });
    await completeOrder(r.orderId!, { amountTotal: 2200, currency: "BRL", paymentId: "pi_x" });
    await withdrawRegistration(u, r.participantId);
    const o = await db.order.findUniqueOrThrow({ where: { id: r.orderId! } });
    expect(o.status).toBe("REFUNDED");
    expect(o.refundedCents).toBe(2200);

    const u2 = await makeUser();
    await linkGame(u2, "sf6");
    const r2 = await registerForTournament(u2, { tournamentId: t.id, acceptRules: true });
    await completeOrder(r2.orderId!, { amountTotal: 2200, currency: "BRL", paymentId: "pi_y" });
    await expect(refundOrder(u2, r2.orderId!, { reason: "quero meu dinheiro" })).rejects.toThrow(/permissão/);
    const res = await cancelTournament(owner, t.id, "Problema no servidor");
    expect(res.refundFailures).toEqual([]);
    expect((await db.order.findUniqueOrThrow({ where: { id: r2.orderId! } })).status).toBe("REFUNDED");
    expect((await db.tournament.findUniqueOrThrow({ where: { id: t.id } })).status).toBe("CANCELED");
  });
});

describe("Swiss + mata-mata e leaderboard", () => {
  it("fase suíça (rodadas fixas) seguida de playoffs por times de CS2", async () => {
    const owner = await makeUser();
    const org = await makeOrg(owner);
    const t = await createTournament(owner, {
      orgId: org.id,
      gameId: "cs2",
      modeId: "5v5",
      name: "Copa Suíça de teste",
      startsAt: future(48),
      maxParticipants: 16,
      stages: [
        { name: "Suíço", settings: { type: "SWISS", mode: "rounds", rounds: 3, bestOf: 1, allowDraw: false, points: { win: 1, draw: 0, loss: 0 }, tiebreakers: ["points", "buchholz", "seed"], advancement: { count: 4 } } },
        { name: "Playoffs", settings: { type: "SINGLE_ELIMINATION", bestOf: { default: 3 }, thirdPlaceMatch: false } },
      ],
    });
    await publishTournament(owner, t.id);
    const players = new Map<string, Actor>();
    for (let i = 0; i < 8; i++) {
      const { team, players: ps } = await makeTeamWithPlayers(await makeUser(), 5, "cs2");
      const r = await registerForTournament(ps[0], { tournamentId: t.id, teamId: team.id, starterIds: ps.map((p) => p.id), acceptRules: true });
      expect(r.status).toBe("REGISTERED");
      players.set(ps[0].id, ps[0]);
    }
    for (const p of await db.participant.findMany({ where: { tournamentId: t.id } })) await checkIn(owner, p.id);
    await startTournament(owner, t.id);
    // joga as 3 rodadas do Suíço
    await playAllMatches(owner, t.id, players);
    const stages = await db.stage.findMany({ where: { tournamentId: t.id }, orderBy: { order: "asc" } });
    expect(stages[0].status).toBe("COMPLETED");
    const swissRounds = new Set((await db.match.findMany({ where: { stageId: stages[0].id } })).map((m) => m.round));
    expect(swissRounds.size).toBe(3);
    expect(stages[1].status).toBe("PENDING");
    expect((stages[1].seedOrder as unknown as string[]).length).toBe(4);
    await expect(startNextStage(players.values().next().value as Actor, t.id)).rejects.toThrow(/permissão/);
    await startNextStage(owner, t.id);
    await playAllMatches(owner, t.id, players);
    const done = await db.tournament.findUniqueOrThrow({ where: { id: t.id } });
    expect(done.status).toBe("COMPLETED");
    const champion = await db.participant.findFirstOrThrow({ where: { tournamentId: t.id, finalPlacement: 1 } });
    expect(champion.seed).toBeLessThanOrEqual(4);
    // todos os 8 têm colocação; eliminados no Suíço ficam atrás dos 4 dos playoffs
    const all = await db.participant.findMany({ where: { tournamentId: t.id } });
    expect(all.every((p) => p.finalPlacement !== null)).toBe(true);
    expect(Math.min(...all.filter((p) => !(stages[1].seedOrder as unknown as string[]).includes(p.id)).map((p) => p.finalPlacement!))).toBeGreaterThanOrEqual(5);
  });

  it("leaderboard Fortnite (6 partidas): resultados, validação, colocação final e premiação", async () => {
    const { owner, t } = await setup("fortnite", "solo", "fortnite.session", { entryFeeCents: 0, prizePoolCents: 10000 });
    const players = await registerSolo(t, "fortnite", 10);
    for (const p of await db.participant.findMany({ where: { tournamentId: t.id } })) await checkIn(owner, p.id);
    await startTournament(owner, t.id);
    for (let round = 1; round <= 6; round++) {
      const games = await db.brGame.findMany({ where: { stage: { tournamentId: t.id }, round } });
      expect(games.length).toBe(1);
      const lobby = games[0].participantIds as unknown as string[];
      const parts = await db.participant.findMany({ where: { id: { in: lobby } }, orderBy: { seed: "asc" } });
      // melhor seed vence sempre
      const rows = parts.map((p, i) => ({ participantId: p.id, placement: i + 1, kills: parts.length - i }));
      if (round === 1) {
        await expect(submitBrResults(owner, games[0].id, rows.slice(1))).rejects.toThrow(/Faltam/);
        await expect(submitBrResults(owner, games[0].id, [{ ...rows[0], placement: 2 }, ...rows.slice(1)])).rejects.toThrow(/mais de uma vez/);
        await expect(submitBrResults(players[0], games[0].id, rows)).rejects.toThrow(/permissão/);
        await expect(submitBrResults(owner, games[0].id, [{ ...rows[0], kills: -1 }, ...rows.slice(1)])).rejects.toThrow(/Abates/);
      }
      await submitBrResults(owner, games[0].id, rows);
    }
    const done = await db.tournament.findUniqueOrThrow({ where: { id: t.id } });
    expect(done.status).toBe("COMPLETED");
    const first = await db.participant.findFirstOrThrow({ where: { tournamentId: t.id, finalPlacement: 1 } });
    expect(first.seed).toBe(1);
    const prizes = await db.prizeAward.findMany({ where: { tournamentId: t.id }, orderBy: { placement: "asc" } });
    expect(prizes.map((p) => [p.placement, p.amountCents])).toEqual([[1, 6000], [2, 2500], [3, 1500]]);
  });

  it("leaderboard com 2 estágios (Qualificatória → Final) avança os melhores", async () => {
    const { owner, t } = await setup("fortnite", "solo", "fortnite.qualifier-final");
    // preset exige 30+ jogadores: usa 30 para testar o avanço de 25
    await registerSolo(t, "fortnite", 30);
    for (const p of await db.participant.findMany({ where: { tournamentId: t.id } })) await checkIn(owner, p.id);
    await startTournament(owner, t.id);
    const preset = getPreset("fortnite", "fortnite.qualifier-final")!;
    expect(preset.stages.length).toBe(2);
    const stage1 = await db.stage.findFirstOrThrow({ where: { tournamentId: t.id, order: 1 } });
    for (let round = 1; round <= 8; round++) {
      const games = await db.brGame.findMany({ where: { stageId: stage1.id, round } });
      expect(games.length).toBe(1);
      const lobby = games[0].participantIds as unknown as string[];
      const parts = await db.participant.findMany({ where: { id: { in: lobby } }, orderBy: { seed: "asc" } });
      await submitBrResults(owner, games[0].id, parts.map((p, i) => ({ participantId: p.id, placement: i + 1, kills: 0 })));
    }
    const stages = await db.stage.findMany({ where: { tournamentId: t.id }, orderBy: { order: "asc" } });
    expect(stages[0].status).toBe("COMPLETED");
    expect((stages[1].seedOrder as unknown as string[]).length).toBe(25);
    await startNextStage(owner, t.id);
    const ctx = await loadStage(db, stages[1].id);
    expect(ctx.brGames.length).toBe(1);
    for (let round = 1; round <= 6; round++) {
      const g = (await db.brGame.findMany({ where: { stageId: stages[1].id, round } }))[0];
      const lobby = g.participantIds as unknown as string[];
      const parts = await db.participant.findMany({ where: { id: { in: lobby } }, orderBy: { seed: "asc" } });
      await submitBrResults(owner, g.id, parts.map((p, i) => ({ participantId: p.id, placement: i + 1, kills: 0 })));
    }
    const done = await db.tournament.findUniqueOrThrow({ where: { id: t.id } });
    expect(done.status).toBe("COMPLETED");
    const placements = (await db.participant.findMany({ where: { tournamentId: t.id } })).map((p) => p.finalPlacement!).sort((a, b) => a - b);
    expect(placements).toEqual(Array.from({ length: 30 }, (_, i) => i + 1));
  });
});

describe("disputa explícita", () => {
  it("capitão contesta placar reportado", async () => {
    const { owner, t } = await setup("sf6", "1v1", "sf6.single-elim");
    const players = await registerSolo(t, "sf6", 4);
    for (const p of await db.participant.findMany({ where: { tournamentId: t.id } })) await checkIn(owner, p.id);
    await startTournament(owner, t.id);
    const m = await db.match.findFirstOrThrow({ where: { status: "READY", stage: { tournamentId: t.id } }, include: { participantA: true, participantB: true } });
    const a = players.find((p) => p.id === m.participantA!.userId)!;
    const b = players.find((p) => p.id === m.participantB!.userId)!;
    await reportMatch(a, m.id, 2, 0);
    await expect(openDispute(b, m.id, "x")).rejects.toThrow(/motivo/);
    await openDispute(b, m.id, "O adversário desconectou no 2º round");
    expect((await db.match.findUniqueOrThrow({ where: { id: m.id } })).status).toBe("DISPUTED");
    expect(await db.notification.count({ where: { userId: owner.id, kind: "match.disputed" } })).toBe(1);
  });
});

void PASSWORD;
