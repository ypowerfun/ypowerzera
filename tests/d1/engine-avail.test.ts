// @ts-nocheck
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DbBusyError, SimulatedCrash } from "../../src/lib/d1-engine";
import { createTestClient, createTestD1, type TestD1 } from "./harness";
import { mkEngine, q, stats, uid } from "./engine-attack-helpers";

let t: TestD1;
beforeEach(async () => { t = await createTestD1(); });
afterEach(async () => { await t.dispose(); });

const cnt = async (sql: string, ...b: unknown[]) => Number((await q(t.d1, sql, ...b))[0].c);

describe("ATK-9: custo do polling da trava cresce com o tamanho do diário", () => {
  it("quem espera pela trava baixa o diário INTEIRO a cada tentativa (a cada 15-75 ms)", async () => {
    const holder = mkEngine(t.d1);
    // 300 linhas de ~2 KB: o diário da transação tem ~600 KB
    await holder.db.siteSetting.createMany({ data: Array.from({ length: 300 }, (_, i) => ({ key: `row-${i}`, value: "x".repeat(2000) })) });
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const holding = holder.db.$transaction(async (tx) => {
      await tx.siteSetting.updateMany({ data: { value: "y".repeat(2000) } });
      await gate;
    });
    await new Promise((r) => setTimeout(r, 1500));
    const journalBytes = Number((await q(t.d1, "SELECT SUM(LENGTH(undo)) AS s FROM _Journal"))[0].s);
    const waiter = mkEngine(t.d1, { acquireMaxWaitMs: 2000 });
    stats.resultBytes = 0;
    stats.batches = 0;
    await expect(waiter.db.siteSetting.update({ where: { key: "row-1" }, data: { value: "z" } })).rejects.toBeInstanceOf(DbBusyError);
    console.log(`ATK-9 diário=${(journalBytes / 1024).toFixed(0)} KB | em 2 s de espera um único cliente fez ${stats.batches} tentativas e baixou ${(stats.resultBytes / 1024 / 1024).toFixed(1)} MB`);
    release();
    await holding;
    expect(stats.resultBytes).toBeLessThan(journalBytes * 3); // esperado: o diário só deveria ser lido por quem CONSEGUIU a trava
  }, 60000);
});

describe("ATK-11: falha (transitória) no rollback deixa a trava presa por 40 s", () => {
  it("um erro passageiro do D1 durante o desfazer: o site inteiro fica sem escrever até o TTL, e ninguém tenta de novo", async () => {
    let rollbackPhase = false;
    let injected = false;
    const a = mkEngine(t.d1, {}, () => async (sql, _b, phase) => {
      if (phase === "batch" && /SELECT undo FROM _Journal WHERE txId/.test(sql)) rollbackPhase = true;
      if (rollbackPhase && !injected && /^UPDATE .*SiteSetting/.test(sql)) {
        injected = true;
        throw new Error("D1_ERROR: Network connection lost (erro passageiro simulado)");
      }
    });
    const k = uid("k");
    await a.db.siteSetting.create({ data: { key: k, value: "v0" } });
    await expect(
      a.db.$transaction(async (tx) => {
        await tx.siteSetting.update({ where: { key: k }, data: { value: "v1" } });
        throw new Error("falha de negócio");
      }),
    ).rejects.toThrow("falha de negócio");
    const lease = (await q(t.d1, "SELECT owner, expiresAt FROM _Lease"))[0];
    const valueNow = (await q(t.d1, "SELECT value FROM SiteSetting WHERE key = ?", k))[0].value;
    console.log("ATK-11 trava presa? owner=", lease.owner ? "sim" : "não", "| expira em", Math.round((Number(lease.expiresAt) - Date.now()) / 1000), "s | valor visível a leituras agora:", valueNow, "| diário:", await cnt("SELECT COUNT(*) AS c FROM _Journal"));
    const other = mkEngine(t.d1, { acquireMaxWaitMs: 1500 });
    let err: unknown;
    try { await other.db.siteSetting.create({ data: { key: uid("o"), value: "x" } }); } catch (e) { err = e; }
    console.log("ATK-11 outro pedido de escrita:", err instanceof DbBusyError ? "DbBusyError (site ocupado)" : "ok");
    expect(err).toBeUndefined();
  }, 60000);
});

describe("ATK-12: prazo da transação e TTL medidos de pontos diferentes", () => {
  it("recuperação demorada consome o TTL: o prazo de 25 s começa DEPOIS dela, então a transação passa do vencimento da trava sem ser barrada pelo prazo", async () => {
    let clock = 100_000_000;
    // morre depois de 10 escritas, antes do commit
    const dying = mkEngine(t.d1, { now: () => clock, crashPoint: (p) => { if (p === "before-commit") throw new SimulatedCrash(p); } });
    await expect(dying.db.$transaction(async (tx) => { for (let i = 0; i < 10; i++) await tx.siteSetting.create({ data: { key: uid("d"), value: "x" } }); })).rejects.toBeInstanceOf(SimulatedCrash);
    clock += 50_000; // trava vencida
    let recovering = true;
    const slow = mkEngine(t.d1, { now: () => clock }, () => async (sql, _b, phase) => {
      if (phase === "run" && recovering && /^DELETE FROM `main`/.test(sql)) clock += 3_000; // cada desfazer leva 3 s (D1 lento)
    });
    const t0 = clock;
    const k = uid("slow");
    let outcome = "";
    try {
      await slow.db.$transaction(async (tx) => {
        recovering = false;
        clock += 14_000;
        await tx.siteSetting.create({ data: { key: k, value: "depois do vencimento" } });
      });
      outcome = "SUCESSO";
    } catch (e) { outcome = "ERRO " + (e as Error).message; }
    console.log("ATK-12 idade da transação na escrita (s):", (clock - t0) / 1000, "-> resultado:", outcome, "| linha existe:", (await cnt("SELECT COUNT(*) AS c FROM SiteSetting WHERE key = ?", k)) === 1);
  });
});

describe("ATK-16: duas instâncias do motor (dois Workers) disputando o mesmo D1", () => {
  it("40 transações ler-e-somar de 2 motores + 25% de falhas: nenhuma soma se perde, diário vazio, trava livre", async () => {
    const e1 = createTestClient(t.d1, { acquireMaxWaitMs: 120_000 });
    const e2 = createTestClient(t.d1, { acquireMaxWaitMs: 120_000 });
    const w = await e1.db.wallet.create({ data: { kind: "PLATFORM", id: uid("w") } });
    const run = (db: typeof e1.db, i: number) =>
      db.$transaction(async (tx) => {
        const cur = await tx.wallet.findUniqueOrThrow({ where: { id: w.id } });
        await tx.wallet.update({ where: { id: w.id }, data: { balanceCents: cur.balanceCents + 10 } });
        if (i % 4 === 0) throw new Error("falha " + i);
      }).then(() => true, () => false);
    const results = await Promise.all(Array.from({ length: 40 }, (_, i) => run(i % 2 ? e1.db : e2.db, i + 1)));
    const ok = results.filter(Boolean).length;
    const bal = (await e1.db.wallet.findUniqueOrThrow({ where: { id: w.id } })).balanceCents;
    console.log("ATK-16 confirmadas:", ok, "saldo:", bal);
    expect(bal).toBe(ok * 10);
    expect(await cnt("SELECT COUNT(*) AS c FROM _Journal")).toBe(0);
    expect((await q(t.d1, "SELECT owner FROM _Lease"))[0].owner).toBeNull();
  }, 180000);
});

describe("ATK-19: $transaction aninhada (db global dentro de tx) não tem savepoint", () => {
  it("falha da transação interna capturada pelo chamador: as escritas parciais da interna entram no commit da externa", async () => {
    const { db } = createTestClient(t.d1);
    const kInner = uid("inner"), kOuter = uid("outer");
    await db.$transaction(async () => {
      try {
        await db.$transaction(async (tx2) => {
          await tx2.siteSetting.create({ data: { key: kInner, value: "parcial" } });
          throw new Error("falha interna");
        });
      } catch { /* o chamador trata o erro e segue */ }
      await db.siteSetting.create({ data: { key: kOuter, value: "ok" } });
    });
    const inner = await cnt("SELECT COUNT(*) AS c FROM SiteSetting WHERE key = ?", kInner);
    console.log("ATK-19 linha da transação interna que FALHOU existe depois do commit externo?", inner === 1);
    expect(inner).toBe(0);
  });
});
