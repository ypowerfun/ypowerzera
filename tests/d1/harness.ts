import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { Miniflare } from "miniflare";
import { PrismaD1 } from "@prisma/adapter-d1";
import { Prisma, PrismaClient } from "../../src/generated/prisma-d1-node/client";
import { createD1Engine, type D1Like, type EngineDeps } from "../../src/lib/d1-engine";

const MIGRATIONS = path.resolve(__dirname, "../../migrations");

/** Divide um arquivo .sql em comandos (os do Prisma terminam em ";" no fim da linha). */
export function sqlStatements(sql: string): string[] {
  const noComments = sql
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n");
  return noComments
    .split(/;\s*\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export interface TestD1 {
  mf: Miniflare;
  d1: D1Like & { prepare(sql: string): { bind(...v: unknown[]): unknown; run(): Promise<unknown>; all(): Promise<{ results: unknown[] }> } };
  dispose(): Promise<void>;
}

/** Um D1 de verdade (SQLite do workerd via Miniflare), em memória, com as migrações aplicadas. */
export async function createTestD1(): Promise<TestD1> {
  const mf = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('ok') } }",
    compatibilityDate: "2025-06-01",
    d1Databases: { DB: `test-${Math.random().toString(36).slice(2)}` },
  });
  const d1 = (await mf.getD1Database("DB")) as unknown as TestD1["d1"];
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
    for (const stmt of sqlStatements(readFileSync(path.join(MIGRATIONS, file), "utf8"))) {
      await (d1.prepare(stmt) as unknown as { run(): Promise<unknown> }).run();
    }
  }
  return { mf, d1, dispose: () => mf.dispose() };
}

export function createTestClient(d1: TestD1["d1"], extra: Partial<EngineDeps> = {}) {
  const base = new PrismaClient({ adapter: new PrismaD1(d1 as never) }) as unknown as EngineDeps["base"];
  const engine = createD1Engine({ d1, base, dbNull: Prisma.DbNull, jsonNull: Prisma.JsonNull, ...extra });
  return { engine, db: engine.client as PrismaClient, base: base as unknown as PrismaClient };
}
