// @ts-nocheck
import { describe, expect, it } from "vitest";
import { createTestD1 } from "./harness";
import { mkEngine, q, uid } from "./engine-attack-helpers";

/**
 * Varredura de pontos de falha DURANTE o desfazer: para cada comando k do rollback, o k-ésimo comando falha (erro passageiro do D1);
 * depois a recuperação automática (outro Worker, relógio adiantado) tem que devolver o banco EXATAMENTE ao estado de antes.
 * Também com uma segunda falha, durante a própria recuperação.
 */
async function dump(d1: Awaited<ReturnType<typeof createTestD1>>["d1"]) {
  const tables = (await q(d1, "SELECT name FROM sqlite_master WHERE type='table' AND substr(name,1,1) <> '_' AND name NOT LIKE 'sqlite%' AND name NOT LIKE 'd1%'")).map((r) => r.name as string);
  const out: string[] = [];
  for (const tb of tables) for (const r of await q(d1, `SELECT * FROM "${tb}"`)) out.push(tb + JSON.stringify(Object.entries(r)));
  return out.sort();
}

async function scenario(d1: Awaited<ReturnType<typeof createTestD1>>["d1"], db: ReturnType<typeof mkEngine>["db"]) {
  const u = await db.user.create({ data: { email: `${uid()}@t.dev`, username: uid("u"), displayName: "x", passwordHash: "x" } });
  const u2 = await db.user.create({ data: { email: `${uid()}@t.dev`, username: uid("u"), displayName: "y", passwordHash: "x", bio: "b" } });
  for (let i = 0; i < 3; i++) await db.notification.create({ data: { userId: u.id, kind: "k", title: `n${i}`, body: "b" } });
  await db.session.create({ data: { id: uid("s"), userId: u.id, expiresAt: new Date(Date.now() + 1e6) } });
  const team = await db.team.create({ data: { name: uid("T"), tag: "T", slug: uid("s"), ownerId: u2.id } });
  await db.teamInvite.create({ data: { teamId: team.id, invitedById: u2.id, userId: u.id, token: uid("tk"), expiresAt: new Date(Date.now() + 1e6) } }); // SetNull ao apagar u
  const ss = uid("ss");
  await db.siteSetting.create({ data: { key: ss, value: "v" } });
  return { u, u2, team, ss };
}
const body = (ids: Awaited<ReturnType<typeof scenario>>) => async (tx: ReturnType<typeof mkEngine>["db"]) => {
  await tx.siteSetting.create({ data: { key: uid("new"), value: "novo" } });
  await tx.siteSetting.update({ where: { key: ids.ss }, data: { value: "alterado" } });
  await tx.user.update({ where: { id: ids.u2.id }, data: { bio: null, displayName: "z" } });
  await tx.user.delete({ where: { id: ids.u.id } }); // cascata (notificações, sessão) + SetNull (convite)
  await tx.notification.createMany({ data: [{ userId: ids.u2.id, kind: "k", title: "t", body: "b" }] });
  await tx.siteSetting.upsert({ where: { key: uid("up") }, create: { key: uid("up2"), value: "c" }, update: { value: "u" } });
  throw new Error("falha de negócio");
};

const MODE = (process.env.SWEEP_MODE ?? "before") as "before" | "after";
describe.skipIf(!process.env.D1_SLOW)("ATK-SWEEP: falha em cada ponto do rollback + recuperação", () => {
  it("1ª varredura: o k-ésimo comando do rollback falha; a recuperação restaura tudo", async () => {
    // descobre quantos comandos o rollback gasta
    let K = 0;
    {
      const t0 = await createTestD1();
      let phase = false;
      const { db } = mkEngine(t0.d1, {}, () => async (sql) => { if (/SELECT undo FROM _Journal WHERE txId/.test(sql)) phase = true; else if (phase) K++; });
      const ids = await scenario(t0.d1, db);
      await expect(db.$transaction(body(ids))).rejects.toThrow("falha de negócio");
      await t0.dispose();
    }
    console.log("ATK-SWEEP comandos no rollback:", K);
    const bad: string[] = [];
    for (let k = 0; k <= K; k++) {
      const t1 = await createTestD1();
      let clock = 1_000_000;
      let phase = false;
      let n = 0;
      const failing = mkEngine(t1.d1, { now: () => clock }, () => async (sql) => {
        if (/SELECT undo FROM _Journal WHERE txId/.test(sql)) { phase = true; return; }
        if (phase && n++ === k) {
          if (MODE === "before") throw new Error("D1_ERROR: erro passageiro simulado no rollback #" + k);
          return () => { throw new Error("D1_ERROR: resposta perdida (o comando EXECUTOU) no rollback #" + k); };
        }
      });
      const ids = await scenario(t1.d1, failing.db);
      const before = await dump(t1.d1);
      await expect(failing.db.$transaction(body(ids))).rejects.toThrow();
      // recuperação por outro Worker, depois do TTL
      clock += 100_000;
      const rec = mkEngine(t1.d1, { now: () => clock });
      let err = "";
      try { await rec.db.siteSetting.create({ data: { key: uid("after"), value: "x" } }); } catch (e) { err = (e as Error).message.slice(0, 80); }
      // remove a linha de prova antes de comparar
      await q(t1.d1, "DELETE FROM SiteSetting WHERE key LIKE 'after-%'");
      const after = await dump(t1.d1);
      const jr = Number((await q(t1.d1, "SELECT COUNT(*) AS c FROM _Journal"))[0].c);
      if (JSON.stringify(before) !== JSON.stringify(after) || jr) {
        const miss = before.filter((x) => !after.includes(x)).length, extra = after.filter((x) => !before.includes(x)).length;
        bad.push(`k=${k}: faltando ${miss}, sobrando ${extra}, diário=${jr} ${err}`);
      }
      await t1.dispose();
    }
    console.log("ATK-SWEEP resultados com divergência:", bad.length ? "\n  " + bad.join("\n  ") : "nenhuma");
    expect(bad).toEqual([]);
  }, 600000);

  it("2ª varredura: falha em k1 durante o rollback E em k2 durante a recuperação (amostra)", async () => {
    const bad: string[] = [];
    for (const [k1, k2] of [[0, 0], [1, 3], [2, 5], [4, 1], [6, 8], [8, 2], [10, 10], [3, 12], [5, 6], [7, 14], [9, 4], [11, 7], [12, 9], [14, 11], [16, 13], [17, 15]] as const) {
      const t1 = await createTestD1();
      let clock = 1_000_000;
      let phase = false, n = 0;
      const failing = mkEngine(t1.d1, { now: () => clock }, () => async (sql) => {
        if (/SELECT undo FROM _Journal WHERE txId/.test(sql)) { phase = true; return; }
        if (phase && n++ === k1) throw new Error("falha rollback");
      });
      const ids = await scenario(t1.d1, failing.db);
      const before = await dump(t1.d1);
      await expect(failing.db.$transaction(body(ids))).rejects.toThrow();
      clock += 100_000;
      let rphase = false, m = 0;
      const rec1 = mkEngine(t1.d1, { now: () => clock }, () => async (sql, _b, ph) => {
        if (/SELECT undo FROM _Journal ORDER BY rowid DESC/.test(sql)) { rphase = true; return; }
        if (rphase && ph === "run" && m++ === k2) {
          if (MODE === "before") throw new Error("falha na recuperação");
          return () => { throw new Error("resposta perdida na recuperação"); };
        }
      });
      try { await rec1.db.siteSetting.create({ data: { key: uid("after"), value: "x" } }); } catch { /* esperado */ }
      clock += 100_000;
      const rec2 = mkEngine(t1.d1, { now: () => clock });
      for (let i = 0; i < 6; i++) { try { await rec2.db.siteSetting.create({ data: { key: uid("after"), value: "x" } }); break; } catch { clock += 100_000; } }
      await q(t1.d1, "DELETE FROM SiteSetting WHERE key LIKE 'after-%'");
      const after = await dump(t1.d1);
      const jr = Number((await q(t1.d1, "SELECT COUNT(*) AS c FROM _Journal"))[0].c);
      if (JSON.stringify(before) !== JSON.stringify(after) || jr) bad.push(`k1=${k1} k2=${k2}: faltando ${before.filter((x) => !after.includes(x)).length}, sobrando ${after.filter((x) => !before.includes(x)).length}, diário=${jr}`);
      await t1.dispose();
    }
    console.log("ATK-SWEEP2 divergências:", bad.length ? "\n  " + bad.join("\n  ") : "nenhuma");
    expect(bad).toEqual([]);
  }, 600000);
});
