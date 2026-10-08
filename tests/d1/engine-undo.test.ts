// @ts-nocheck
// LIMITAÇÃO CONHECIDA (documentada em docs/SITES.md): estes testes marcados com it.fails descrevem cenários que o motor NÃO cobre —
// uma ÚNICA chamada ao D1 parada por mais que o TTL da trava (40 s) entre a conferência e a gravação, ou o Prisma.JsonNull explícito.
// Se um dia o motor passar a cobri-los, o it.fails falha e avisa para trocar por it().
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestClient, createTestD1, type TestD1 } from "./harness";
import { exec, mkEngine, q, uid } from "./engine-attack-helpers";

let t: TestD1;
beforeEach(async () => { t = await createTestD1(); });
afterEach(async () => { await t.dispose(); });

const count = async (table: string) => Number((await q(t.d1, `SELECT COUNT(*) AS c FROM "${table}"`))[0].c);

describe("ATK-1: ordem de restauração na cascata em losango (BrResult depende de BrGame E de Participant)", () => {
  it("apagar o Tournament na transação e desfazer devolve tudo (BrResult exige BrGame e Participant antes)", async () => {
    const { db, base } = createTestClient(t.d1);
    const u = await db.user.create({ data: { email: `${uid()}@t.dev`, username: uid("u"), displayName: "x", passwordHash: "x" } });
    const org = await db.organization.create({ data: { slug: uid("o"), name: "O" } });
    const trn = await db.tournament.create({
      data: { orgId: org.id, slug: uid("t"), name: "T", gameId: "g", modeId: "m", startsAt: new Date(), maxParticipants: 8, seedSalt: "s" },
    });
    const stage = await db.stage.create({ data: { tournamentId: trn.id, order: 1, name: "BR", type: "LEADERBOARD", settings: {} } });
    const game = await db.brGame.create({ data: { stageId: stage.id, round: 1, participantIds: [] } });
    const part = await db.participant.create({ data: { tournamentId: trn.id, userId: u.id, name: "P", roster: [] } });
    await db.brResult.create({ data: { gameId: game.id, participantId: part.id, placement: 1, kills: 3 } });

    await expect(
      db.$transaction(async (tx) => {
        await tx.tournament.delete({ where: { id: trn.id } });
        expect(await tx.brResult.count()).toBeGreaterThanOrEqual(0);
        throw new Error("desfaz");
      }),
    ).rejects.toThrow("desfaz");

    const after = {
      tournament: await base.tournament.count({ where: { id: trn.id } }),
      stage: await base.stage.count({ where: { tournamentId: trn.id } }),
      game: await base.brGame.count({ where: { stageId: stage.id } }),
      part: await base.participant.count({ where: { tournamentId: trn.id } }),
      result: await base.brResult.count({ where: { gameId: game.id } }),
      journal: await count("_Journal"),
      dead: await count("_JournalDead"),
    };
    console.log("ATK-1 after rollback:", JSON.stringify(after));
    expect(after).toMatchObject({ tournament: 1, stage: 1, game: 1, part: 1, result: 1 });
  });

  it("a recuperação automática repete o mesmo erro 5 vezes e o diário vai para a quarentena: Stage/BrGame/BrResult perdidos para sempre", async () => {
    let clock = 1_000_000;
    const { db } = mkEngine(t.d1, { now: () => clock, sleep: async () => { clock += 50_000; }, acquireMaxWaitMs: 10_000_000 });
    const u = await db.user.create({ data: { email: `${uid()}@t.dev`, username: uid("u"), displayName: "x", passwordHash: "x" } });
    const org = await db.organization.create({ data: { slug: uid("o"), name: "O" } });
    const trn = await db.tournament.create({ data: { orgId: org.id, slug: uid("t"), name: "T", gameId: "g", modeId: "m", startsAt: new Date(), maxParticipants: 8, seedSalt: "s" } });
    const stage = await db.stage.create({ data: { tournamentId: trn.id, order: 1, name: "BR", type: "LEADERBOARD", settings: {} } });
    const game = await db.brGame.create({ data: { stageId: stage.id, round: 1, participantIds: [] } });
    const part = await db.participant.create({ data: { tournamentId: trn.id, userId: u.id, name: "P", roster: [] } });
    await db.brResult.create({ data: { gameId: game.id, participantId: part.id, placement: 1, kills: 3 } });
    await expect(db.$transaction(async (tx) => { await tx.tournament.delete({ where: { id: trn.id } }); throw new Error("desfaz"); })).rejects.toThrow("desfaz");
    // próximas escritas: cada uma tenta recuperar e falha (ou, na 5a, o diário vai para a quarentena)
    const outcomes: string[] = [];
    for (let i = 0; i < 7; i++) {
      clock += 100_000;
      try { await db.siteSetting.create({ data: { key: uid("w"), value: "x" } }); outcomes.push("ok"); } catch (e) { outcomes.push("ERRO:" + (e as Error).name); }
    }
    const dead = Number((await q(t.d1, `SELECT COUNT(*) AS c FROM _JournalDead`))[0].c);
    const stages = Number((await q(t.d1, `SELECT COUNT(*) AS c FROM Stage WHERE tournamentId = ?`, trn.id))[0].c);
    const results = Number((await q(t.d1, `SELECT COUNT(*) AS c FROM BrResult WHERE gameId = ?`, game.id))[0].c);
    console.log("ATK-1b resultados das escritas seguintes:", outcomes.join(","), "| _JournalDead:", dead, "| stages:", stages, "| brResults:", results);
    expect(stages).toBe(1); // deveria ter voltado
  });
});

describe("ATK-2: update que muda a chave primária não é desfeito", () => {
  it("SiteSetting.key renomeada dentro da transação e a transação falha", async () => {
    const { db } = createTestClient(t.d1);
    const k = uid("pk"), k2 = uid("pk2");
    await db.siteSetting.create({ data: { key: k, value: "v" } });
    await expect(
      db.$transaction(async (tx) => {
        await tx.siteSetting.update({ where: { key: k }, data: { key: k2 } });
        throw new Error("desfaz");
      }),
    ).rejects.toThrow("desfaz");
    const orig = await db.siteSetting.findUnique({ where: { key: k } });
    const renamed = await db.siteSetting.findUnique({ where: { key: k2 } });
    console.log("ATK-2 original:", !!orig, "renomeada:", !!renamed);
    expect(orig).not.toBeNull();
    expect(renamed).toBeNull();
  });

  it("Team.id (PK) mudando cascateia (ON UPDATE CASCADE) para TeamMember e o desfazer não alcança", async () => {
    const { db, base } = createTestClient(t.d1);
    const u = await db.user.create({ data: { email: `${uid()}@t.dev`, username: uid("u"), displayName: "x", passwordHash: "x" } });
    const team = await db.team.create({ data: { name: uid("N"), tag: "TT", slug: uid("s"), ownerId: u.id } });
    await db.teamMember.create({ data: { teamId: team.id, userId: u.id, role: "CAPTAIN" } });
    const newId = uid("newteam");
    await expect(
      db.$transaction(async (tx) => {
        await tx.team.update({ where: { id: team.id }, data: { id: newId } });
        throw new Error("desfaz");
      }),
    ).rejects.toThrow("desfaz");
    const orig = await base.team.count({ where: { id: team.id } });
    const moved = await base.team.count({ where: { id: newId } });
    const members = await base.teamMember.count({ where: { teamId: team.id } });
    console.log("ATK-2b team original:", orig, "renomeado:", moved, "membros no id antigo:", members);
    expect(orig).toBe(1);
    expect(members).toBe(1);
  });
});

describe("ATK-3: JSON null explícito (Prisma.JsonNull) em coluna Json opcional", () => {
  it.fails("restaura como DbNull (NULL do SQL) em vez de 'null' JSON", async () => {
    const { db } = createTestClient(t.d1);
    const { Prisma } = await import("../../src/generated/prisma-d1-node/client");
    const a = await db.auditLog.create({ data: { action: "a", entity: "e", entityId: "1", meta: Prisma.JsonNull } });
    const before = await q(t.d1, `SELECT meta, typeof(meta) AS tp FROM AuditLog WHERE id = ?`, a.id);
    await expect(
      db.$transaction(async (tx) => {
        await tx.auditLog.update({ where: { id: a.id }, data: { meta: { x: 1 } } });
        throw new Error("desfaz");
      }),
    ).rejects.toThrow("desfaz");
    const after = await q(t.d1, `SELECT meta, typeof(meta) AS tp FROM AuditLog WHERE id = ?`, a.id);
    console.log("ATK-3 antes:", JSON.stringify(before), "depois:", JSON.stringify(after));
    expect(after).toEqual(before);
  });
});
