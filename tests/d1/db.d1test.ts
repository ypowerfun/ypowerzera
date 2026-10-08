/**
 * Banco para os TESTES no "modo D1": um D1 de verdade (SQLite do workerd, via Miniflare) em memória, com as migrações
 * aplicadas, e o mesmo motor de transações que roda no ChatGPT Sites. Só é usado quando TEST_DB=d1 (veja vitest.config.ts). Fica em tests/ (e não em src/) de propósito: o build do servidor próprio (Docker) não leva a pasta tests/ e o typecheck do `next build` falharia ao não achar o harness.
 */
import type { PrismaClient as NodePrismaClient, Prisma as NodePrisma } from "@prisma/client";
import { createTestClient, createTestD1 } from "./harness";

const t = await createTestD1();
const { db: client, engine } = createTestClient(t.d1, { acquireMaxWaitMs: 30_000 });
(globalThis as { __d1Dispose?: () => Promise<void> }).__d1Dispose = () => t.dispose();

export const db = client as unknown as NodePrismaClient;
export type Tx = NodePrisma.TransactionClient | NodePrismaClient;
export type TxClient = NodePrisma.TransactionClient;

export async function engineHealth(): Promise<{ dead: number; pending: number; staleLease: boolean } | null> {
  return engine.health();
}
