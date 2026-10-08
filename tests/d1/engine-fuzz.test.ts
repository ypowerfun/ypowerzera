// @ts-nocheck
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Prisma } from "../../src/generated/prisma-d1-node/client";
import { createTestClient, createTestD1, type TestD1 } from "./harness";
import { q, uid } from "./engine-attack-helpers";

/**
 * Teste diferencial: sequências aleatórias de escritas dentro de uma transação que termina em erro.
 * Depois do rollback, TODAS as tabelas (SELECT * cru) têm que ser idênticas ao estado de antes.
 */
let t: TestD1;
beforeAll(async () => { t = await createTestD1(); });
afterAll(async () => { await t.dispose(); });

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

async function rawDump(): Promise<Record<string, string[]>> {
  const tables = (await q(t.d1, "SELECT name FROM sqlite_master WHERE type='table' AND substr(name,1,1) <> '_' AND name NOT LIKE 'sqlite%' AND name NOT LIKE 'd1%'")).map((r) => r.name as string);
  const out: Record<string, string[]> = {};
  for (const tb of tables) {
    const rows = await q(t.d1, `SELECT * FROM "${tb}"`);
    out[tb] = rows.map((r) => JSON.stringify(Object.entries(r).map(([k, v]) => [k, v, typeof v]))).sort();
  }
  return out;
}
function diff(a: Record<string, string[]>, b: Record<string, string[]>): string[] {
  const d: string[] = [];
  for (const tb of Object.keys(a)) {
    const sa = new Set(a[tb]), sb = new Set(b[tb]);
    const missing = a[tb].filter((x) => !sb.has(x));
    const extra = b[tb].filter((x) => !sa.has(x));
    if (missing.length || extra.length) d.push(`${tb}: faltando ${missing.length}, sobrando ${extra.length}${missing[0] ? " ex.faltando=" + missing[0].slice(0, 160) : ""}${extra[0] ? " ex.sobrando=" + extra[0].slice(0, 160) : ""}`);
  }
  return d;
}

type Ids = Record<string, string[]>;
async function seed(db: ReturnType<typeof createTestClient>["db"]): Promise<Ids> {
  const ids: Ids = { user: [], team: [], org: [], tournament: [], stage: [], participant: [], match: [], brGame: [], wallet: [], invite: [], audit: [], notif: [] };
  for (let i = 0; i < 6; i++) ids.user.push((await db.user.create({ data: { email: `${uid("e")}@t.dev`, username: uid("un"), displayName: `U${i}`, passwordHash: "x", bio: i % 2 ? "bio" : null, emailVerifiedAt: i % 3 ? new Date("2026-01-02T03:04:05.678Z") : null } })).id);
  for (let i = 0; i < 2; i++) ids.org.push((await db.organization.create({ data: { slug: uid("o"), name: `O${i}` } })).id);
  for (let i = 0; i < 3; i++) ids.team.push((await db.team.create({ data: { name: uid("T"), tag: "TT", slug: uid("ts"), ownerId: ids.user[i] } })).id);
  for (let i = 0; i < 3; i++) await db.teamMember.create({ data: { teamId: ids.team[i], userId: ids.user[i], role: "CAPTAIN" } });
  await db.teamMember.create({ data: { teamId: ids.team[0], userId: ids.user[3], role: "PLAYER" } });
  for (let i = 0; i < 2; i++) ids.wallet.push((await db.wallet.create({ data: { teamId: ids.team[i], kind: "TEAM", balanceCents: 100 * (i + 1) } })).id);
  for (let i = 0; i < 4; i++) ids.invite.push((await db.teamInvite.create({ data: { teamId: ids.team[i % 3], invitedById: ids.user[0], userId: i < 3 ? ids.user[3 + (i % 3)] : null, token: uid("tok"), expiresAt: new Date(Date.now() + 1e6) } })).id);
  for (let i = 0; i < 6; i++) await db.notification.create({ data: { userId: ids.user[i % 4], kind: "k", title: `n${i}`, body: "b", readAt: i % 2 ? new Date() : null } });
  for (let i = 0; i < 4; i++) await db.session.create({ data: { id: uid("s"), userId: ids.user[i], expiresAt: new Date(Date.now() + 1e6), ip: i % 2 ? "1.1.1.1" : null } });
  for (let i = 0; i < 3; i++) await db.gameAccount.create({ data: { userId: ids.user[i], gameId: "valorant", handle: `h${i}`, data: { riotId: `r${i}#1`, nested: { a: [1, 2, { b: null }] } } } });
  for (let i = 0; i < 4; i++) ids.audit.push((await db.auditLog.create({ data: { action: "a", entity: "e", entityId: String(i), meta: i % 2 ? { x: i, y: [true, null, "s"] } : undefined } })).id);
  for (let i = 0; i < 4; i++) await db.siteSetting.create({ data: { key: uid("ss"), value: `v${i}`, updatedById: i % 2 ? ids.user[0] : null } });
  const trn = await db.tournament.create({ data: { orgId: ids.org[0], slug: uid("t"), name: "T", gameId: "g", modeId: "m", startsAt: new Date("2026-05-05T10:00:00.000Z"), maxParticipants: 8, seedSalt: "s", prizeSplit: [{ placement: 1, percent: 100 }], customFields: [], requireCheckIn: true } });
  ids.tournament.push(trn.id);
  const s1 = await db.stage.create({ data: { tournamentId: trn.id, order: 1, name: "S1", type: "SINGLE_ELIMINATION", settings: { type: "SINGLE_ELIMINATION" }, seedOrder: [1, 2, 3] } });
  const s2 = await db.stage.create({ data: { tournamentId: trn.id, order: 2, name: "S2", type: "LEADERBOARD", settings: {}, groups: [[1], [2]] } });
  ids.stage.push(s1.id, s2.id);
  for (let i = 0; i < 4; i++) ids.participant.push((await db.participant.create({ data: { tournamentId: trn.id, userId: ids.user[i], name: `P${i}`, roster: [{ userId: ids.user[i], role: "starter" }], seed: i + 1 } })).id);
  for (let i = 0; i < 4; i++) ids.match.push((await db.match.create({ data: { stageId: s1.id, key: `W1-${i}`, bracket: "W", round: 1 + (i % 2), position: i, slotA: { type: "seed", seed: 1 }, slotB: { type: "seed", seed: 2 }, participantAId: ids.participant[i], participantBId: ids.participant[(i + 1) % 4], reportA: i % 2 ? { scoreA: 1, scoreB: 0 } : undefined } })).id);
  await db.matchDispute.create({ data: { matchId: ids.match[0], openedById: ids.user[0], reason: "r" } });
  const g = await db.brGame.create({ data: { stageId: s2.id, round: 1, participantIds: ids.participant } });
  ids.brGame.push(g.id);
  for (let i = 0; i < 3; i++) await db.brResult.create({ data: { gameId: g.id, participantId: ids.participant[i], placement: i + 1 } });
  return ids;
}

type Db = ReturnType<typeof createTestClient>["db"];
type Op = { name: string; run: (tx: Db, r: () => number, ids: Ids) => Promise<unknown> };
const pick = <T,>(r: () => number, a: T[]): T => a[Math.floor(r() * a.length)];
const ops: Op[] = [
  { name: "siteSetting.create", run: (tx, r) => tx.siteSetting.create({ data: { key: uid("n"), value: "x" } }) },
  { name: "siteSetting.updateMany", run: (tx, r) => tx.siteSetting.updateMany({ where: r() < 0.5 ? {} : { value: { startsWith: "v" } }, data: { value: "u" + Math.floor(r() * 9), updatedById: r() < 0.5 ? null : "zz" } }) },
  { name: "siteSetting.upsert(existing)", run: async (tx, r) => { const k = (await tx.siteSetting.findMany({ take: 3 }))[0]?.key ?? "none"; return tx.siteSetting.upsert({ where: { key: k }, create: { key: k, value: "c" }, update: { value: "up" } }); } },
  { name: "siteSetting.upsert(new)", run: (tx) => { const k = uid("nu"); return tx.siteSetting.upsert({ where: { key: k }, create: { key: k, value: "c" }, update: { value: "up" } }); } },
  { name: "siteSetting.deleteMany", run: (tx, r) => tx.siteSetting.deleteMany({ where: r() < 0.5 ? { value: { startsWith: "v" } } : {} }) },
  { name: "siteSetting.createMany(skipDup)", run: async (tx) => { const ex = (await tx.siteSetting.findMany({ take: 1 }))[0]?.key; return tx.siteSetting.createMany({ data: [{ key: uid("c1"), value: "1" }, ...(ex ? [{ key: ex, value: "dup" }] : []), { key: uid("c2"), value: "2" }], skipDuplicates: true }); } },
  { name: "siteSetting.createManyAndReturn", run: (tx) => tx.siteSetting.createManyAndReturn({ data: [{ key: uid("r1"), value: "1" }, { key: uid("r2"), value: "2" }] }) },
  { name: "siteSetting.updateManyAndReturn", run: (tx) => tx.siteSetting.updateManyAndReturn({ where: { value: { startsWith: "v" } }, data: { value: "ret" } }) },
  { name: "user.update", run: async (tx, r, ids) => tx.user.update({ where: { id: pick(r, ids.user) }, data: { displayName: "D" + Math.floor(r() * 99), bio: r() < 0.5 ? null : "nb", bannedAt: r() < 0.5 ? new Date("2027-01-01T00:00:00.000Z") : null, role: pick(r, ["USER", "ORGANIZER", "ADMIN"] as const) } }) },
  { name: "user.delete", run: (tx, r, ids) => tx.user.delete({ where: { id: pick(r, ids.user) } }) },
  { name: "user.deleteMany", run: (tx, r, ids) => tx.user.deleteMany({ where: { id: { in: [pick(r, ids.user), pick(r, ids.user)] } } }) },
  { name: "user.create", run: (tx) => tx.user.create({ data: { email: `${uid("e")}@t.dev`, username: uid("un"), displayName: "N", passwordHash: "x" } }) },
  { name: "notification.createMany", run: (tx, r, ids) => tx.notification.createMany({ data: ids.user.slice(0, 3).map((userId) => ({ userId, kind: "k", title: "t", body: "b" })) }) },
  { name: "notification.updateMany", run: (tx) => tx.notification.updateMany({ where: { readAt: null }, data: { readAt: new Date("2026-06-06T06:06:06.006Z") } }) },
  { name: "notification.deleteMany", run: (tx, r, ids) => tx.notification.deleteMany({ where: { userId: pick(r, ids.user) } }) },
  { name: "session.create", run: (tx, r, ids) => tx.session.create({ data: { id: uid("s"), userId: pick(r, ids.user), expiresAt: new Date(Date.now() + 5e6) } }) },
  { name: "session.deleteMany", run: (tx, r, ids) => tx.session.deleteMany({ where: { userId: pick(r, ids.user) } }) },
  { name: "gameAccount.upsert(compound)", run: (tx, r, ids) => { const userId = pick(r, ids.user); return tx.gameAccount.upsert({ where: { userId_gameId: { userId, gameId: "valorant" } }, create: { userId, gameId: "valorant", handle: "new", data: { a: 1 } }, update: { handle: "upd", data: { z: [1, 2, null] } } }); } },
  { name: "gameAccount.update(compound)", run: (tx, r, ids) => tx.gameAccount.update({ where: { userId_gameId: { userId: pick(r, ids.user), gameId: "valorant" } }, data: { data: { replaced: true } } }) },
  { name: "team.update", run: (tx, r, ids) => tx.team.update({ where: { id: pick(r, ids.team) }, data: { description: r() < 0.5 ? null : "desc", deletedAt: r() < 0.5 ? new Date() : null } }) },
  { name: "team.delete", run: (tx, r, ids) => tx.team.delete({ where: { id: pick(r, ids.team) } }) },
  { name: "teamMember.deleteMany", run: (tx, r, ids) => tx.teamMember.deleteMany({ where: { teamId: pick(r, ids.team) } }) },
  { name: "teamInvite.updateMany", run: (tx) => tx.teamInvite.updateMany({ where: { userId: null }, data: { status: "REVOKED" } }) },
  { name: "wallet.update(increment)", run: (tx, r, ids) => tx.wallet.update({ where: { id: pick(r, ids.wallet) }, data: { balanceCents: { increment: 50 }, version: { increment: 1 }, frozenAt: r() < 0.5 ? new Date() : null } }) },
  { name: "auditLog.create(json)", run: (tx, r) => tx.auditLog.create({ data: { action: "x", entity: "e", entityId: "1", meta: r() < 0.5 ? { a: [1, { b: "c" }] } : Prisma.DbNull } }) },
  { name: "auditLog.update(meta)", run: (tx, r, ids) => tx.auditLog.update({ where: { id: pick(r, ids.audit) }, data: { meta: r() < 0.5 ? Prisma.DbNull : ({ upd: true } as Prisma.InputJsonValue) } }) },
  { name: "tournament.update", run: (tx, r, ids) => tx.tournament.update({ where: { id: ids.tournament[0] }, data: { name: "TT" + Math.floor(r() * 99), prizeSplit: r() < 0.5 ? Prisma.DbNull : [{ p: 1 }], startedAt: new Date("2026-08-08T08:08:08.008Z"), allowPlayerReporting: r() < 0.5, requireCheckIn: false, minParticipants: { increment: 1 } } }) },
  { name: "stage.deleteMany(tournament)", run: (tx, r, ids) => tx.stage.deleteMany({ where: { tournamentId: ids.tournament[0] } }) },
  { name: "stage.createMany", run: (tx, r, ids) => tx.stage.createMany({ data: [{ tournamentId: ids.tournament[0], order: 5 + Math.floor(r() * 50), name: "N", type: "SWISS", settings: { s: 1 } }] }) },
  { name: "participant.delete", run: (tx, r, ids) => tx.participant.delete({ where: { id: pick(r, ids.participant) } }) },
  { name: "participant.update", run: (tx, r, ids) => tx.participant.update({ where: { id: pick(r, ids.participant) }, data: { status: "CHECKED_IN", checkedInAt: new Date(), roster: [{ x: 1 }], seed: null } }) },
  { name: "match.update", run: (tx, r, ids) => tx.match.update({ where: { id: pick(r, ids.match) }, data: { status: "COMPLETED", scoreA: 2, scoreB: 1, winnerSide: "a", reportA: Prisma.DbNull, reportB: { scoreA: 2, scoreB: 1 }, completedAt: new Date(), participantAId: null } }) },
  { name: "match.deleteMany(round>0)", run: (tx, r, ids) => tx.match.deleteMany({ where: { round: { gt: Math.floor(r() * 2) } } }) },
  { name: "brGame.deleteMany", run: (tx) => tx.brGame.deleteMany({ where: {} }) },
  { name: "brResult.deleteMany", run: (tx) => tx.brResult.deleteMany({ where: {} }) },
  { name: "brResult.createMany", run: (tx, r, ids) => tx.brResult.createMany({ data: [{ gameId: ids.brGame[0], participantId: ids.participant[3], placement: 9 }] }) },
  { name: "matchDispute.deleteMany", run: (tx) => tx.matchDispute.deleteMany({}) },
  { name: "tournament.delete", run: (tx, r, ids) => tx.tournament.delete({ where: { id: ids.tournament[0] } }) },
];

const SEEDS = Number(process.env.FUZZ_SEEDS ?? 12);
const NOPS = Number(process.env.FUZZ_OPS ?? 14);
const EXCLUDE = new Set((process.env.FUZZ_EXCLUDE ?? "").split(",").filter(Boolean));

describe.skipIf(!process.env.D1_SLOW)("ATK-fuzz: rollback restaura TODAS as tabelas exatamente (SELECT * cru antes/depois)", () => {
  for (let s = 1; s <= SEEDS; s++) {
    it(`semente ${s}`, async () => {
      const { db } = createTestClient(t.d1, { acquireMaxWaitMs: 5000 });
      const ids = await seed(db);
      const before = await rawDump();
      const r = rng(s * 7919 + Number(process.env.FUZZ_BASE ?? 0));
      const done: string[] = [];
      let swallowed = 0;
      const ONLY = (process.env.FUZZ_ONLY ?? "").split(",").filter(Boolean);
      const pool = ops.filter((o) => !EXCLUDE.has(o.name) && (!ONLY.length || ONLY.some((x) => o.name.includes(x))));
      try {
        await db.$transaction(async (tx) => {
          for (let i = 0; i < NOPS; i++) {
            const op = pick(r, pool);
            try {
              await op.run(tx as Db, r, ids);
              done.push(op.name);
            } catch {
              swallowed++;
              done.push(op.name + "!");
            }
          }
          throw new Error("rollback-final");
        });
      } catch (e) {
        if ((e as Error).message !== "rollback-final") throw e;
      }
      const after = await rawDump();
      const d = diff(before, after);
      const jr = Number((await q(t.d1, "SELECT COUNT(*) AS c FROM _Journal"))[0].c);
      const lease = (await q(t.d1, "SELECT owner FROM _Lease"))[0].owner;
      console.log(`FUZZSTAT seed ${s}: ok=${done.filter((x) => !x.endsWith("!")).length} falhou=${swallowed}`);
      if (d.length || jr || lease) console.log(`FUZZ seed ${s} ops=[${done.join(", ")}]\n  diffs: ${d.join("\n  ")}\n  journal=${jr} lease=${lease}`);
      expect({ d, jr, lease }).toEqual({ d: [], jr: 0, lease: null });
    }, 120000);
  }
});
