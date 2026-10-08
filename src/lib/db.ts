import { PrismaClient, type Prisma } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const db: PrismaClient = globalForPrisma.prisma ?? new PrismaClient({ log: process.env.PRISMA_LOG ? ["query", "warn", "error"] : ["warn", "error"] });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;

/** Cliente ou transação interativa. */
export type Tx = Prisma.TransactionClient | PrismaClient;
export type TxClient = Prisma.TransactionClient;

/** Saúde do motor de transações do D1 (só existe no ChatGPT Sites; aqui, no banco SQLite tradicional, não se aplica). */
export async function engineHealth(): Promise<{ dead: number; pending: number; staleLease: boolean } | null> {
  return null;
}
