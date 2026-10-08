import { randomUUID } from "node:crypto";
import type { D1Database } from "@cloudflare/workers-types";
import { AppError } from "@/lib/errors";

export async function saveD1GameAccount(db: D1Database, input: {
  userId: string; gameId: string; handle: string; data: Record<string,string>;
}) {
  const now=Date.now();
  try {
    const row = await db.prepare(`INSERT INTO GameAccount(id,userId,gameId,handle,data,createdAt,updatedAt)
      SELECT ?,?,?,?,?,?,? FROM User WHERE id=? AND bannedAt IS NULL
      ON CONFLICT(userId,gameId) DO UPDATE SET handle=excluded.handle,data=excluded.data,updatedAt=excluded.updatedAt RETURNING id`)
      .bind(randomUUID(),input.userId,input.gameId,input.handle,JSON.stringify(input.data),now,now,input.userId).first<{id:string}>();
    if (!row) throw new AppError("Sua conta não pode realizar esta operação.","FORBIDDEN");
    return row.id;
  } catch (error) {
    if (error instanceof Error && /UNIQUE constraint failed: GameAccount.gameId, GameAccount.handle/.test(error.message)) {
      throw new AppError("Este ID de jogo já está vinculado a outra conta da plataforma.","CONFLICT");
    }
    throw error;
  }
}
