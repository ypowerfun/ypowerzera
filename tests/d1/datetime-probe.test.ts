import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestClient, createTestD1, type TestD1 } from "./harness";

let t: TestD1;
beforeAll(async () => { t = await createTestD1(); });
afterAll(async () => { await t.dispose(); });

describe("formato de data no D1 (a migração dos dados depende disto)", () => {
  it("o Prisma grava DateTime como TEXTO ISO e lê também milissegundos inteiros (formato do SQLite antigo)", async () => {
    const { db } = createTestClient(t.d1);
    const when = new Date("2026-03-04T05:06:07.089Z");
    await db.siteSetting.create({ data: { key: "dt1", value: "x", updatedAt: when } });
    const raw = async (sql: string) => ((await (t.d1.prepare(sql) as unknown as { all(): Promise<{ results: unknown[] }> }).all()).results);
    const stored = (await raw(`SELECT updatedAt, typeof(updatedAt) AS tp FROM SiteSetting WHERE key='dt1'`))[0] as { updatedAt: unknown; tp: string };
    expect(stored.tp).toBe("text");
    expect(stored.updatedAt).toBe("2026-03-04T05:06:07.089+00:00");
    // linha no formato do SQLite tradicional do Prisma (milissegundos inteiros)
    await (t.d1.prepare(`INSERT INTO SiteSetting (key, value, updatedAt) VALUES ('dt2','y', ${when.getTime()})`) as unknown as { run(): Promise<unknown> }).run();
    const r = await db.siteSetting.findUniqueOrThrow({ where: { key: "dt2" } });
    expect(r.updatedAt.toISOString()).toBe(when.toISOString());
    const r1 = await db.siteSetting.findUniqueOrThrow({ where: { key: "dt1" } });
    expect(r1.updatedAt.toISOString()).toBe(when.toISOString());
    // ATENÇÃO: misturar os dois formatos na MESMA coluna quebra comparações (no SQLite todo inteiro é "menor" que todo texto):
    // por isso scripts/export-to-d1.mjs converte tudo para texto ISO antes de importar.
    const wronglyOld = await db.siteSetting.count({ where: { updatedAt: { lt: new Date("2000-01-01") } } });
    expect(wronglyOld).toBe(1); // a linha em milissegundos "parece" anterior ao ano 2000: é por isso que a conversão é obrigatória
  });
});
