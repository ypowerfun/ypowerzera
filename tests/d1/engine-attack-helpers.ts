// @ts-nocheck
import { PrismaD1 } from "@prisma/adapter-d1";
import { Prisma, PrismaClient } from "../../src/generated/prisma-d1-node/client";
import { createD1Engine, type EngineDeps } from "../../src/lib/d1-engine";
import type { TestD1 } from "./harness";

type AnyD1 = TestD1["d1"];
export type Hook = (sql: string, binds: unknown[], phase: "run" | "batch") => Promise<void | (() => void | Promise<void>)> | void | (() => void | Promise<void>);

/** Envolve o D1 para observar/atrasar cada comando (antes de executar). Statements embrulhados são desembrulhados no batch. */
export const stats = { batchSizes: [] as number[], resultBytes: 0, batches: 0 };
export function wrapD1(real: AnyD1, hook: () => Hook | undefined, log?: Array<{ sql: string; binds: unknown[] }>): AnyD1 {
  const mk = (sql: string, binds: unknown[]) => {
    const stmt: Record<string, unknown> = {
      __sql: sql,
      __binds: binds,
      __real: (real.prepare(sql) as unknown as { bind(...v: unknown[]): unknown }).bind(...binds),
      bind: (...v: unknown[]) => mk(sql, v),
    };
    for (const m of ["run", "all", "raw", "first"]) {
      stmt[m] = async (...a: unknown[]) => {
        log?.push({ sql, binds });
        const after = await hook()?.(sql, binds, "run");
        const out = await (stmt.__real as Record<string, (...x: unknown[]) => Promise<unknown>>)[m](...a);
        if (typeof after === "function") await after();
        return out;
      };
    }
    return stmt;
  };
  return {
    prepare: (sql: string) => mk(sql, []),
    batch: async (stmts: Array<Record<string, unknown>>) => {
      const afters: Array<() => void | Promise<void>> = [];
      for (const s of stmts) {
        log?.push({ sql: s.__sql as string, binds: s.__binds as unknown[] });
        const a = await hook()?.(s.__sql as string, s.__binds as unknown[], "batch");
        if (typeof a === "function") afters.push(a);
      }
      stats.batchSizes.push(stmts.length);
      stats.batches++;
      const res = await (real as unknown as { batch(s: unknown[]): Promise<Array<{ results?: unknown[] }>> }).batch(stmts.map((s) => s.__real));
      for (const r of res) if (r?.results?.length) stats.resultBytes += JSON.stringify(r.results).length;
      for (const a of afters) await a();
      return res;
    },
    exec: (s: string) => (real as unknown as { exec(s: string): Promise<unknown> }).exec(s),
  } as unknown as AnyD1;
}

/** Cria um motor + cliente Prisma "base" que passam por D1 embrulhados (hook compartilhado entre os dois). */
export function mkEngine(real: AnyD1, extra: Partial<EngineDeps> = {}, hook: () => Hook | undefined = () => undefined, log?: Array<{ sql: string; binds: unknown[] }>) {
  const d1 = wrapD1(real, hook, log);
  const base = new PrismaClient({ adapter: new PrismaD1(d1 as never) }) as unknown as EngineDeps["base"];
  const engine = createD1Engine({ d1, base, dbNull: Prisma.DbNull, jsonNull: Prisma.JsonNull, ...extra });
  return { engine, db: engine.client as PrismaClient, base: base as unknown as PrismaClient };
}

export const q = async (d1: AnyD1, sql: string, ...binds: unknown[]) =>
  (await (d1.prepare(sql) as unknown as { bind(...v: unknown[]): { all(): Promise<{ results: unknown[] }> } }).bind(...binds).all()).results as Array<Record<string, unknown>>;
export const exec = async (d1: AnyD1, sql: string, ...binds: unknown[]) =>
  (d1.prepare(sql) as unknown as { bind(...v: unknown[]): { run(): Promise<unknown> } }).bind(...binds).run();

let n = 0;
export const uid = (p = "k") => `${p}-${Date.now().toString(36)}-${n++}`;
