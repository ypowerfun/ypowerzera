/**
 * Banco de dados no ChatGPT Sites (Cloudflare Workers + D1).
 * Substitui src/lib/db.ts quando o site é montado para o Sites (veja next.config.ts: PA_TARGET=sites).
 *
 * O binding do D1 só existe dentro de um pedido, então o cliente é obtido a cada acesso (e guardado por binding).
 * Toda a "transação" passa pelo motor de src/lib/d1-engine.ts (trava + diário de desfazer).
 */
import type { PrismaClient as NodePrismaClient, Prisma as NodePrisma } from "@prisma/client";
import { PrismaD1 } from "@prisma/adapter-d1";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { Prisma, PrismaClient } from "../generated/prisma-d1/client";
import { createD1Engine, type D1Like } from "./d1-engine";

const clients = new WeakMap<object, { client: object; engine: ReturnType<typeof createD1Engine> }>();

function current(): { client: object; engine: ReturnType<typeof createD1Engine> } {
  const { env } = getCloudflareContext();
  const d1 = (env as { DB?: unknown }).DB;
  if (!d1) throw new Error("O banco D1 (binding DB) não está configurado. Veja docs/SITES.md.");
  let hit = clients.get(d1 as object);
  if (!hit) {
    const base = new PrismaClient({ adapter: new PrismaD1(d1 as never), log: ["error"] });
    const engine = createD1Engine({ d1: d1 as D1Like, base: base as never, dbNull: Prisma.DbNull, jsonNull: Prisma.JsonNull });
    hit = { client: engine.client as object, engine };
    clients.set(d1 as object, hit);
  }
  return hit;
}

export const db: NodePrismaClient = new Proxy({} as NodePrismaClient, {
  get(_target, prop) {
    const { client } = current();
    const value = Reflect.get(client, prop);
    return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(client) : value;
  },
});

/** Cliente ou transação interativa. */
export type Tx = NodePrisma.TransactionClient | NodePrismaClient;
export type TxClient = NodePrisma.TransactionClient;

/** Saúde do motor de transações: quarentena do diário (deve ser 0), diário pendente e trava vencida. */
export async function engineHealth(): Promise<{ dead: number; pending: number; staleLease: boolean } | null> {
  return current().engine.health();
}
