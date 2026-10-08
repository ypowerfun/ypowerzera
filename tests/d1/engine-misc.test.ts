// @ts-nocheck
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestClient, createTestD1, type TestD1 } from "./harness";
import { exec, mkEngine, q, stats, uid } from "./engine-attack-helpers";

let t: TestD1;
beforeEach(async () => { t = await createTestD1(); });
afterEach(async () => { await t.dispose(); });

const val = async (key: string) => (await q(t.d1, `SELECT value FROM SiteSetting WHERE key = ?`, key))[0]?.value as string | undefined;
const cnt = async (sql: string, ...b: unknown[]) => Number((await q(t.d1, sql, ...b))[0].c);

describe("ATK-13: escrita 'zumbi' depois do rollback (ALS ainda aponta para a transação encerrada)", () => {
  it("Promise.all com um ramo que falha cedo e outro que lê antes de escrever: a escrita do 2o ramo persiste DEPOIS do rollback", async () => {
    const { db } = createTestClient(t.d1);
    const k = uid("zombie");
    await expect(
      db.$transaction(async (tx) => {
        await Promise.all([
          (async () => {
            await tx.siteSetting.findMany({ take: 1 }); // leitura em andamento quando o outro ramo falha
            await tx.siteSetting.create({ data: { key: k, value: "escrita-zumbi" } });
          })(),
          Promise.reject(new Error("outro ramo falhou")),
        ]);
      }),
    ).rejects.toThrow("outro ramo falhou");
    await new Promise((r) => setTimeout(r, 1500)); // deixa o ramo órfão terminar
    const v = await val(k);
    console.log("ATK-13 valor depois do rollback:", v, "| trava:", JSON.stringify(await q(t.d1, "SELECT owner FROM _Lease")), "| diário:", await cnt("SELECT COUNT(*) AS c FROM _Journal"));
    expect(v).toBeUndefined(); // numa transação de verdade a escrita seria recusada ("transaction already closed")
  });

  it("escrita sem await no corpo da transação que só começa depois do commit vira escrita avulsa (sem erro)", async () => {
    const { db } = createTestClient(t.d1);
    const k = uid("late");
    await db.$transaction(async (tx) => {
      void new Promise((r) => setTimeout(r, 200)).then(() => tx.siteSetting.create({ data: { key: k, value: "tarde" } }));
    });
    await new Promise((r) => setTimeout(r, 1500));
    console.log("ATK-13b valor:", await val(k));
  });
});

describe("ATK-15: caminhos de escrita que não passam pelo motor", () => {
  it("$executeRaw dentro da transação não entra no diário (rollback não desfaz) e fora dela não toma a trava", async () => {
    const { db } = createTestClient(t.d1);
    const k = uid("raw");
    await expect(
      db.$transaction(async (tx) => {
        await (tx as unknown as { $executeRawUnsafe(s: string, ...a: unknown[]): Promise<number> }).$executeRawUnsafe(`INSERT INTO SiteSetting (key, value, updatedAt) VALUES (?, 'raw', '2026-01-01T00:00:00.000+00:00')`, k);
        throw new Error("desfaz");
      }),
    ).rejects.toThrow("desfaz");
    console.log("ATK-15 raw sobreviveu ao rollback?", (await val(k)) !== undefined);
    expect(await val(k)).toBeUndefined();
  });
});

describe("ATK-8: createMany dividido em vários INSERT (limite de 98 parâmetros do D1) deixa resíduo quando o erro é capturado dentro da transação", () => {
  it("falha na última parte, erro capturado, transação confirma: as partes anteriores ficam gravadas", async () => {
    const { db } = createTestClient(t.d1);
    const keys = Array.from({ length: 100 }, (_, i) => `ck-${String(i).padStart(3, "0")}`);
    await db.siteSetting.create({ data: { key: "ck-099", value: "ja-existia" } });
    await db.$transaction(async (tx) => {
      try {
        await tx.siteSetting.createMany({ data: keys.map((key) => ({ key, value: "v" })) });
      } catch {
        /* capturado: no SQLite normal nada do createMany ficou */
      }
    });
    const n = await cnt(`SELECT COUNT(*) AS c FROM SiteSetting WHERE key LIKE 'ck-%'`);
    console.log("ATK-8 linhas ck-* depois do createMany que falhou (esperado 1):", n);
    expect(n).toBe(1);
  });
});

describe("ATK-10: parâmetros por comando e tamanho do lote", () => {
  it("deleteMany/createMany grandes: máximo de parâmetros por comando e de comandos por batch", async () => {
    const log: Array<{ sql: string; binds: unknown[] }> = [];
    const batches: number[] = [];
    const { db } = mkEngine(t.d1, {}, () => undefined, log);
    // 150 usuários com 1 notificação cada
    const users = [] as string[];
    for (let i = 0; i < 150; i++) users.push((await db.user.create({ data: { email: `${uid()}@t.dev`, username: uid("u"), displayName: "x", passwordHash: "x" } })).id);
    await db.notification.createMany({ data: users.map((userId) => ({ userId, kind: "k", title: "t", body: "b" })) });
    log.length = 0;
    let err: unknown;
    try {
      await db.$transaction(async (tx) => {
        await tx.user.deleteMany({ where: { id: { in: users } } });
        throw new Error("desfaz");
      });
    } catch (e) { err = e; }
    console.log("ATK-10 erro:", String((err as Error)?.message).replace(/\n/g, " | ").slice(0, 900));
    const maxBinds = Math.max(...log.map((l) => l.binds.length));
    console.log("ATK-10 comandos:", log.length, "| máx. de parâmetros em um comando:", maxBinds, "| usuários restaurados:", await cnt("SELECT COUNT(*) AS c FROM User"), "| notificações:", await cnt("SELECT COUNT(*) AS c FROM Notification"));
    void batches;
    expect(await cnt("SELECT COUNT(*) AS c FROM User")).toBe(150);
    expect(await cnt("SELECT COUNT(*) AS c FROM Notification")).toBe(150);
  });
});

describe("ATK-14: tamanho do diário e do lote", () => {
  it("createMany de 4100 linhas numa transação monta um batch de >100 comandos no diário (e não há teto para createMany)", async () => {
    const { db } = mkEngine(t.d1);
    stats.batchSizes.length = 0;
    await db.$transaction(async (tx) => {
      await tx.siteSetting.createMany({ data: Array.from({ length: 4100 }, (_, i) => ({ key: `big-${i}`, value: "v" })) });
    });
    console.log("ATK-14 maior batch (comandos):", Math.max(...stats.batchSizes), "| linhas:", await cnt("SELECT COUNT(*) AS c FROM SiteSetting"));
    expect(Math.max(...stats.batchSizes)).toBeLessThanOrEqual(100);
  }, 120000);
});
