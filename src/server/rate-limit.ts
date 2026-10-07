import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";

/**
 * Tenta reservar UMA tentativa na janela `key`. Devolve false quando o limite já foi atingido.
 *
 * É atômico: cada passo é uma única instrução condicional no banco (UPDATE ... WHERE count < limit), então 500 pedidos
 * simultâneos NÃO passam todos pelo limite (um "ler, depois gravar" deixaria todos lerem count=0).
 */
async function reserve(key: string, limit: number, windowSeconds: number): Promise<boolean> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const now = new Date();
    // 1) janela aberta e com folga: soma 1
    const inc = await db.rateLimit.updateMany({ where: { key, resetAt: { gt: now }, count: { lt: limit } }, data: { count: { increment: 1 } } });
    if (inc.count === 1) return true;
    // 2) janela vencida: reabre contando esta tentativa
    const resetAt = new Date(now.getTime() + windowSeconds * 1000);
    const reopened = await db.rateLimit.updateMany({ where: { key, resetAt: { lte: now } }, data: { count: 1, resetAt } });
    if (reopened.count === 1) return true;
    // 3) não existe ainda: cria (se outro pedido criou ao mesmo tempo, a chave única recusa e tentamos de novo)
    const row = await db.rateLimit.findUnique({ where: { key } });
    if (row && row.resetAt > now && row.count >= limit) return false;
    if (!row) {
      try {
        await db.rateLimit.create({ data: { key, count: 1, resetAt } });
        return true;
      } catch (e) {
        if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) throw e;
      }
    }
  }
  return false;
}

/**
 * Limitador de janela fixa persistido no banco.
 * Reserva a tentativa ANTES do trabalho caro; lança AppError RATE_LIMIT quando o limite é excedido.
 */
export async function rateLimit(key: string, limit: number, windowSeconds: number, message = "Muitas tentativas. Aguarde alguns minutos e tente novamente."): Promise<void> {
  if (!(await reserve(key, limit, windowSeconds))) throw new AppError(message, "RATE_LIMIT");
}

export async function resetRateLimit(key: string): Promise<void> {
  await db.rateLimit.deleteMany({ where: { key } });
}

/** Devolve uma tentativa reservada (por exemplo, um login que deu certo não deve gastar o limite do IP). */
export async function refundRateLimit(key: string): Promise<void> {
  await db.rateLimit.updateMany({ where: { key, resetAt: { gt: new Date() }, count: { gt: 0 } }, data: { count: { decrement: 1 } } });
}

/** Consulta sem consumir tentativa. */
export async function isRateLimited(key: string, limit: number): Promise<boolean> {
  const row = await db.rateLimit.findUnique({ where: { key } });
  return !!row && row.resetAt > new Date() && row.count >= limit;
}

/** Apaga janelas vencidas (o cron chama; sem isso a tabela só cresce). */
export async function purgeExpiredRateLimits(): Promise<number> {
  const r = await db.rateLimit.deleteMany({ where: { resetAt: { lt: new Date(Date.now() - 3600_000) } } });
  return r.count;
}
