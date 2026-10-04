import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";

/**
 * Limitador de janela fixa persistido no banco (funciona com várias instâncias).
 * Lança AppError RATE_LIMIT quando o limite é excedido.
 */
export async function rateLimit(key: string, limit: number, windowSeconds: number, message = "Muitas tentativas. Aguarde alguns minutos e tente novamente."): Promise<void> {
  const now = new Date();
  const resetAt = new Date(now.getTime() + windowSeconds * 1000);
  const row = await db.rateLimit.findUnique({ where: { key } });
  if (!row || row.resetAt <= now) {
    await db.rateLimit.upsert({ where: { key }, create: { key, count: 1, resetAt }, update: { count: 1, resetAt } });
    return;
  }
  if (row.count >= limit) throw new AppError(message, "RATE_LIMIT");
  await db.rateLimit.update({ where: { key }, data: { count: { increment: 1 } } });
}

export async function resetRateLimit(key: string): Promise<void> {
  await db.rateLimit.deleteMany({ where: { key } });
}

/** Consulta sem consumir tentativa. */
export async function isRateLimited(key: string, limit: number): Promise<boolean> {
  const row = await db.rateLimit.findUnique({ where: { key } });
  return !!row && row.resetAt > new Date() && row.count >= limit;
}
