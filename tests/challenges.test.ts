import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { createRng } from "@/engine";
import { PASSWORD, makeUser } from "./factories";
import { admin, balances, fund, makeKycUser, makeLeader, newAdmin, playChallenge, type Leader } from "./wallet-helpers";
import {
  acceptChallenge,
  cancelChallenge,
  challengeFee,
  createChallenge,
  disputeChallenge,
  expireOpenChallenges,
  reportChallengeResult,
  resolveChallenge,
  runChallengeMaintenance,
  submitChallengeEvidence,
} from "@/server/challenges";
import { freezeWallet, reconcileAll, withdrawableBreakdown } from "@/server/wallet";

beforeEach(async () => {
  await db.rateLimit.deleteMany();
});

const create = (l: Leader, stake = 10_000, extra: Record<string, unknown> = {}) =>
  createChallenge(l.user, { teamId: l.team.id, gameId: "sf6", modeId: "1v1", bestOf: 3, stakeCents: stake, lineupUserIds: [l.user.id], ...extra });
const accept = (l: Leader, id: string) => acceptChallenge(l.user, id, { teamId: l.team.id, lineupUserIds: [l.user.id] });

async function funded(cents = 20_000) {
  const l = await makeLeader();
  await fund(l, cents);
  return l;
}

async function mustReconcile() {
  const r = await reconcileAll();
  expect(r.ok, r.mismatches.join("; ")).toBe(true);
}

describe("criação e escrow", () => {
  it("trava a aposta do criador na hora; saldo insuficiente não cria desafio", async () => {
    const a = await funded(20_000);
    const c = await create(a, 15_000);
    expect(await balances(a.walletId)).toEqual({ available: 5_000, locked: 15_000 });
    expect(c.status).toBe("OPEN");
    const before = await db.challenge.count({ where: { creatorTeamId: a.team.id } });
    await expect(create(a, 10_000)).rejects.toThrow(/Saldo insuficiente/);
    expect(await db.challenge.count({ where: { creatorTeamId: a.team.id } })).toBe(before);
    expect(await balances(a.walletId)).toEqual({ available: 5_000, locked: 15_000 });
    await mustReconcile();
  });

  it("valida valores, modo, líder, KYC e idade da equipe", async () => {
    const a = await funded();
    await expect(create(a, 150)).rejects.toThrow(/inteiros/);
    await expect(create(a, 50)).rejects.toThrow(/inteiros/);
    await expect(create(a, 10_000_000)).rejects.toThrow(/entre/);
    await expect(create(a, 10_000, { bestOf: 2 })).rejects.toThrow(/melhor de/i);
    await expect(create(a, 10_000, { modeId: "inexistente" })).rejects.toThrow(/Modo/);
    await expect(create(a, 10_000, { gameId: "inexistente" })).rejects.toThrow(/Jogo/);
    await expect(create(a, 10_000, { lineupUserIds: [] })).rejects.toThrow(/exatamente 1/);
    const member = await makeKycUser();
    await db.teamMember.create({ data: { teamId: a.team.id, userId: member.user.id, role: "PLAYER" } });
    await expect(createChallenge(member.user, { teamId: a.team.id, gameId: "sf6", modeId: "1v1", bestOf: 1, stakeCents: 10_000, lineupUserIds: [a.user.id] })).rejects.toThrow(/líder/);
    const unverified = await makeLeader({ approved: false });
    await expect(create(unverified)).rejects.toThrow(/análise|identidade/);
    const young = await funded();
    await db.team.update({ where: { id: young.team.id }, data: { createdAt: new Date() } });
    await expect(create(young)).rejects.toThrow(/Equipes novas/);
    // escalado precisa ser membro e ter conta do jogo
    const outsider = await makeUser();
    await expect(create(a, 10_000, { lineupUserIds: [outsider.id] })).rejects.toThrow(/membros da equipe/);
    await db.gameAccount.deleteMany({ where: { userId: a.user.id } });
    await expect(create(a, 10_000)).rejects.toThrow(/conta do jogo/);
  });

  it("criador cancela e recebe de volta; depois do aceite não cancela; expirado devolve", async () => {
    const a = await funded();
    const c = await create(a, 10_000);
    const stranger = await funded();
    await expect(cancelChallenge(stranger.user, c.id)).rejects.toThrow(/líder/);
    await cancelChallenge(a.user, c.id);
    expect(await balances(a.walletId)).toEqual({ available: 20_000, locked: 0 });
    await expect(cancelChallenge(a.user, c.id)).rejects.toThrow(/Só desafios abertos/);

    const c2 = await create(a, 10_000);
    const b = await funded();
    await accept(b, c2.id);
    await expect(cancelChallenge(a.user, c2.id)).rejects.toThrow(/Só desafios abertos/);

    const c3 = await create(a, 5_000);
    await db.challenge.update({ where: { id: c3.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await expireOpenChallenges()).toBe(1);
    expect((await db.challenge.findUniqueOrThrow({ where: { id: c3.id } })).status).toBe("EXPIRED");
    expect(await balances(a.walletId)).toEqual({ available: 10_000, locked: 10_000 });
    await mustReconcile();
  });

  it("limite de desafios abertos por equipe", async () => {
    const a = await funded(500_000);
    process.env.DEPOSIT_MAX_CENTS = "5000000";
    for (let i = 0; i < 5; i++) await create(a, 100);
    delete process.env.DEPOSIT_MAX_CENTS;
    await expect(create(a, 100)).rejects.toThrow(/desafios abertos/);
  });
});

describe("aceite", () => {
  it("trava a aposta do adversário; recusa a própria equipe, convite alheio, integrantes em comum e saldo insuficiente", async () => {
    const a = await funded();
    const c = await create(a, 10_000);
    await expect(accept(a, c.id)).rejects.toThrow(/própria equipe/);

    const poor = await makeLeader();
    await expect(accept(poor, c.id)).rejects.toThrow(/Saldo insuficiente/);
    expect((await db.challenge.findUniqueOrThrow({ where: { id: c.id } })).status).toBe("OPEN"); // continua aberto
    expect(await balances(poor.walletId)).toEqual({ available: 0, locked: 0 });

    const shared = await funded();
    await db.teamMember.create({ data: { teamId: shared.team.id, userId: a.user.id, role: "PLAYER" } });
    await expect(accept(shared, c.id)).rejects.toThrow(/em comum/);

    const invitedOnly = await create(a, 10_000, { invitedTeamId: (await funded()).team.id });
    const wrong = await funded();
    await expect(accept(wrong, invitedOnly.id)).rejects.toThrow(/convite direto/);

    const b = await funded();
    const accepted = await accept(b, c.id);
    expect(accepted.status).toBe("ACCEPTED");
    expect(await balances(b.walletId)).toEqual({ available: 10_000, locked: 10_000 });
    await mustReconcile();
  });

  it("só o líder aceita; KYC verificado é obrigatório", async () => {
    const a = await funded();
    const c = await create(a, 10_000);
    const b = await funded();
    const member = await makeKycUser();
    await db.teamMember.create({ data: { teamId: b.team.id, userId: member.user.id, role: "PLAYER" } });
    await expect(acceptChallenge(member.user, c.id, { teamId: b.team.id, lineupUserIds: [b.user.id] })).rejects.toThrow(/líder/);
    await db.kycProfile.update({ where: { userId: b.user.id }, data: { status: "PENDING" } });
    await expect(accept(b, c.id)).rejects.toThrow(/análise/);
  });

  it("5 equipes aceitando ao mesmo tempo: só UMA consegue e só ela tem a aposta travada", async () => {
    const a = await funded();
    const c = await create(a, 10_000);
    const rivals = await Promise.all(Array.from({ length: 5 }, () => funded()));
    const results = await Promise.allSettled(rivals.map((r) => accept(r, c.id)));
    expect(results.filter((r) => r.status === "fulfilled").length).toBe(1);
    const locked = await Promise.all(rivals.map((r) => balances(r.walletId)));
    expect(locked.filter((b) => b.locked === 10_000).length).toBe(1);
    expect(locked.filter((b) => b.locked === 0 && b.available === 20_000).length).toBe(4);
    await mustReconcile();
  });
});

describe("resultado, taxa e conservação", () => {
  it("taxa de 10% do pote: vencedor +R$ 80, perdedor −R$ 100, plataforma +R$ 20", async () => {
    expect(challengeFee(10_000, 1_000)).toBe(2_000);
    expect(challengeFee(100, 1_000)).toBe(20);
    expect(challengeFee(100, 9_000)).toBe(50); // nunca passa de 50% da stake
    const platformBefore = (await db.wallet.findUnique({ where: { id: "platform" } }))?.balanceCents ?? 0;
    const a = await funded(20_000);
    const b = await funded(20_000);
    await playChallenge(a, b, 10_000, "a");
    expect(await balances(a.walletId)).toEqual({ available: 28_000, locked: 0 }); // 20.000 + 8.000
    expect(await balances(b.walletId)).toEqual({ available: 10_000, locked: 0 });
    const platform = await db.wallet.findUniqueOrThrow({ where: { id: "platform" } });
    expect(platform.balanceCents - platformBefore).toBe(2_000);
    await mustReconcile();
  });

  it("reconhecer a derrota liquida na hora; quem informa vitória aguarda confirmação", async () => {
    const a = await funded();
    const b = await funded();
    const c = await create(a, 10_000);
    await accept(b, c.id);
    const member = await makeKycUser();
    await db.teamMember.create({ data: { teamId: a.team.id, userId: member.user.id, role: "PLAYER" } });
    await expect(reportChallengeResult(member.user, c.id, "WON")).rejects.toThrow(/líderes/);
    const outsider = await funded();
    await expect(reportChallengeResult(outsider.user, c.id, "LOST")).rejects.toThrow(/líderes/);
    expect(await reportChallengeResult(a.user, c.id, "WON")).toBe("reported");
    const reported = await db.challenge.findUniqueOrThrow({ where: { id: c.id } });
    expect(reported.status).toBe("REPORTED");
    expect(reported.autoSettleAt).not.toBeNull();
    // não pode vencer a si mesmo duas vezes nem o adversário "vencer" depois sem disputa
    expect(await reportChallengeResult(b.user, c.id, "WON")).toBe("disputed");
    expect((await db.challenge.findUniqueOrThrow({ where: { id: c.id } })).status).toBe("DISPUTED");
    // o adversário reconhece a derrota → liquida
    expect(await reportChallengeResult(b.user, c.id, "LOST")).toBe("settled");
    expect((await db.challenge.findUniqueOrThrow({ where: { id: c.id } })).winnerTeamId).toBe(a.team.id);
    await expect(reportChallengeResult(a.user, c.id, "WON")).rejects.toThrow(/não está em andamento/);
    await mustReconcile();
  });

  it("liquidação é única mesmo com os dois lados reconhecendo a derrota ao mesmo tempo", async () => {
    const a = await funded();
    const b = await funded();
    const c = await create(a, 10_000);
    await accept(b, c.id);
    const res = await Promise.allSettled([reportChallengeResult(a.user, c.id, "LOST"), reportChallengeResult(b.user, c.id, "LOST")]);
    expect(res.filter((r) => r.status === "fulfilled").length).toBe(1);
    expect(await db.ledgerEntry.count({ where: { refId: c.id, type: "PRIZE_WIN" } })).toBe(1);
    expect(await db.ledgerEntry.count({ where: { refId: c.id, type: "STAKE_LOSS" } })).toBe(1);
    await mustReconcile();
  });

  it("disputa: contestação, provas e decisão do admin (sem conflito de interesse)", async () => {
    const a = await funded();
    const b = await funded();
    const c = await create(a, 10_000);
    await accept(b, c.id);
    await reportChallengeResult(a.user, c.id, "WON");
    await expect(disputeChallenge(b.user, c.id, "curto")).rejects.toThrow(/10 caracteres/);
    await disputeChallenge(b.user, c.id, "Eu venci: o adversário desconectou no round decisivo");
    expect((await db.challenge.findUniqueOrThrow({ where: { id: c.id } })).status).toBe("DISPUTED");
    await submitChallengeEvidence(a.user, c.id, "https://exemplo.com/print-final.png");
    await submitChallengeEvidence(b.user, c.id, "Replay: https://exemplo.com/replay");
    const stranger = await makeUser();
    await expect(resolveChallenge(stranger, c.id, "creator", "tentando resolver a disputa")).rejects.toThrow(/administradores/);
    const insider = await newAdmin();
    await db.teamMember.create({ data: { teamId: a.team.id, userId: insider.id, role: "PLAYER" } });
    await expect(resolveChallenge(insider, c.id, "creator", "sou da equipe do criador")).rejects.toThrow(/Conflito/);
    await expect(resolveChallenge(await admin(), c.id, "opponent", "curta")).rejects.toThrow(/10 caracteres/);
    await resolveChallenge(await admin(), c.id, "opponent", "Replay comprova a desconexão do criador no round decisivo");
    const done = await db.challenge.findUniqueOrThrow({ where: { id: c.id } });
    expect(done.status).toBe("SETTLED");
    expect(done.winnerTeamId).toBe(b.team.id);
    expect(done.resolvedById).toBeTruthy();
    await expect(resolveChallenge(await admin(), c.id, "creator", "já decidido anteriormente")).rejects.toThrow(/não está em disputa/);
    await mustReconcile();
  });

  it("não compareceu → disputa; admin anula e devolve as duas apostas", async () => {
    const a = await funded();
    const b = await funded();
    const c = await create(a, 10_000);
    await accept(b, c.id);
    expect(await reportChallengeResult(a.user, c.id, "NO_SHOW")).toBe("disputed");
    await resolveChallenge(await admin(), c.id, "void", "Nenhuma das equipes compareceu à partida combinada");
    expect((await db.challenge.findUniqueOrThrow({ where: { id: c.id } })).status).toBe("VOID");
    expect(await balances(a.walletId)).toEqual({ available: 20_000, locked: 0 });
    expect(await balances(b.walletId)).toEqual({ available: 20_000, locked: 0 });
    await mustReconcile();
  });

  it("efetivação automática só para stakes baixas e depois do prazo; desafio esquecido vira disputa", async () => {
    const a = await funded(300_000 > 0 ? 20_000 : 0);
    const b = await funded(20_000);
    const small = await create(a, 5_000);
    await accept(b, small.id);
    await reportChallengeResult(a.user, small.id, "WON");
    expect((await runChallengeMaintenance()).autoSettled).toBe(0); // prazo ainda não venceu
    await db.challenge.update({ where: { id: small.id }, data: { autoSettleAt: new Date(Date.now() - 1000) } });
    expect((await runChallengeMaintenance()).autoSettled).toBe(1);
    expect((await db.challenge.findUniqueOrThrow({ where: { id: small.id } })).winnerTeamId).toBe(a.team.id);

    process.env.AUTO_SETTLE_MAX_STAKE_CENTS = "1000";
    const big = await create(a, 5_000);
    await accept(b, big.id);
    await reportChallengeResult(a.user, big.id, "WON");
    delete process.env.AUTO_SETTLE_MAX_STAKE_CENTS;
    expect((await db.challenge.findUniqueOrThrow({ where: { id: big.id } })).autoSettleAt).toBeNull();

    const forgotten = await create(a, 5_000);
    await accept(b, forgotten.id);
    await db.challenge.update({ where: { id: forgotten.id }, data: { acceptedAt: new Date(Date.now() - 25 * 3600_000) } });
    expect((await runChallengeMaintenance()).stale).toBeGreaterThanOrEqual(1);
    expect((await db.challenge.findUniqueOrThrow({ where: { id: forgotten.id } })).status).toBe("DISPUTED");
    await mustReconcile();
  });
});

describe("anti-conluio e retenções", () => {
  it("marca SAME_IP quando as equipes compartilham IP e REPEATED_PAIR em confrontos repetidos", async () => {
    const a = await funded(500_000 / 10);
    const b = await funded(500_000 / 10);
    for (const l of [a, b]) await db.session.create({ data: { id: `s-${l.user.id}`, userId: l.user.id, expiresAt: new Date(Date.now() + 86400_000), ip: "200.100.50.25" } });
    const c1 = await create(a, 1_000);
    const accepted = await accept(b, c1.id);
    expect(accepted.riskFlags as string[]).toContain("SAME_IP");
    await reportChallengeResult(b.user, c1.id, "LOST");
    await playChallenge(a, b, 1_000, "a");
    const c3 = await create(a, 1_000);
    const third = await accept(b, c3.id);
    expect(third.riskFlags as string[]).toContain("REPEATED_PAIR");
  });

  it("prêmio recém-ganho fica retido por 24h; depósito só sai depois de jogado", async () => {
    const a = await funded(20_000);
    const b = await funded(20_000);
    await playChallenge(a, b, 10_000, "a");
    let br = await withdrawableBreakdown(db, a.walletId);
    expect(br.balanceCents).toBe(28_000);
    expect(br.recentWinsCents).toBe(8_000);
    expect(br.withdrawableCents).toBe(0); // depósito recente (72h) + prêmio recente (24h)
    const { backdate } = await import("./wallet-helpers");
    await backdate(a.walletId, 30); // passou a retenção do prêmio, não a do depósito
    br = await withdrawableBreakdown(db, a.walletId);
    expect(br.recentWinsCents).toBe(0);
    expect(br.recentDepositsCents).toBe(20_000);
    await backdate(a.walletId, 100);
    br = await withdrawableBreakdown(db, a.walletId);
    // depósito 20.000, jogado 10.000 → 10.000 ainda "não jogados" ficam retidos
    expect(br.unplayedDepositsCents).toBe(10_000);
    expect(br.withdrawableCents).toBe(18_000);
  });

  it("carteira congelada não cria nem aceita desafios", async () => {
    const a = await funded();
    const b = await funded();
    const c = await create(a, 5_000);
    await freezeWallet(db, b.walletId, "suspeita de fraude");
    await expect(accept(b, c.id)).rejects.toThrow(/congelada/);
    await freezeWallet(db, a.walletId, "suspeita de fraude");
    await expect(create(a, 5_000)).rejects.toThrow(/congelada/);
    expect((await db.challenge.findUniqueOrThrow({ where: { id: c.id } })).status).toBe("OPEN");
  });
});

describe("invariantes sob operações aleatórias", () => {
  it("60 operações embaralhadas entre 4 equipes: nenhum saldo negativo e a conciliação sempre fecha", async () => {
    const teams = await Promise.all(Array.from({ length: 4 }, () => funded(30_000)));
    const rng = createRng("fuzz-prime-arena");
    const pick = <T,>(xs: T[]) => xs[Math.floor(rng() * xs.length)];
    const open: string[] = [];
    const active: string[] = [];
    let ops = 0;
    for (let i = 0; i < 60; i++) {
      const r = rng();
      try {
        if (r < 0.28) {
          const l = pick(teams);
          const c = await create(l, pick([100, 500, 1_000, 2_500]));
          open.push(c.id);
        } else if (r < 0.5 && open.length) {
          const id = open.splice(Math.floor(rng() * open.length), 1)[0];
          const c = await db.challenge.findUniqueOrThrow({ where: { id } });
          const other = pick(teams.filter((t) => t.team.id !== c.creatorTeamId));
          await accept(other, id);
          active.push(id);
        } else if (r < 0.7 && active.length) {
          const id = active.splice(Math.floor(rng() * active.length), 1)[0];
          const c = await db.challenge.findUniqueOrThrow({ where: { id } });
          const loserTeam = rng() < 0.5 ? c.creatorTeamId : c.opponentTeamId!;
          const loser = teams.find((t) => t.team.id === loserTeam)!;
          await reportChallengeResult(loser.user, id, "LOST");
        } else if (r < 0.8 && open.length) {
          const id = open.splice(Math.floor(rng() * open.length), 1)[0];
          const c = await db.challenge.findUniqueOrThrow({ where: { id } });
          await cancelChallenge(teams.find((t) => t.team.id === c.creatorTeamId)!.user, id);
        } else if (r < 0.9 && active.length) {
          const id = active.splice(Math.floor(rng() * active.length), 1)[0];
          const c = await db.challenge.findUniqueOrThrow({ where: { id } });
          await reportChallengeResult(teams.find((t) => t.team.id === c.creatorTeamId)!.user, id, "NO_SHOW");
          await resolveChallenge(await admin(), id, pick(["creator", "opponent", "void"] as const), "Decisão do árbitro após análise das provas");
        } else {
          await fund(pick(teams), 1_000);
        }
        ops++;
      } catch (e) {
        // recusas de regra de negócio são esperadas (saldo, limites...); qualquer outro erro é bug
        if (!(e instanceof Error) || e.name !== "AppError") throw e;
      }
      const wallets = await db.wallet.findMany();
      for (const w of wallets) {
        expect(w.balanceCents).toBeGreaterThanOrEqual(0);
        expect(w.lockedCents).toBeGreaterThanOrEqual(0);
      }
      if (i % 10 === 9) await mustReconcile();
    }
    expect(ops).toBeGreaterThan(30);
    await mustReconcile();
    // o dinheiro total nunca muda: soma de todas as carteiras = soma dos depósitos confirmados
    const wallets = await db.wallet.findMany();
    const total = wallets.reduce((s, w) => s + w.balanceCents + w.lockedCents, 0);
    const deposits = (await db.deposit.aggregate({ _sum: { amountCents: true }, where: { status: { in: ["CONFIRMED", "REVERSED"] } } }))._sum.amountCents ?? 0;
    const paid = (await db.withdrawal.aggregate({ _sum: { netCents: true }, where: { status: "PAID" } }))._sum.netCents ?? 0;
    const adjustments = (await db.ledgerEntry.aggregate({ _sum: { availableDeltaCents: true }, where: { type: { in: ["ADJUSTMENT", "DEPOSIT_REVERSAL"] } } }))._sum.availableDeltaCents ?? 0;
    expect(total).toBe(deposits - paid + adjustments);
  });
});

void PASSWORD;
