import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { requireGame, type GameDef, type IdentityField } from "@/games";

export function validateIdentity(game: GameDef, input: Record<string, string | undefined>): { data: Record<string, string>; handle: string } {
  const data: Record<string, string> = {};
  let handle = "";
  for (const field of game.identity) {
    const raw = (input[field.key] ?? "").trim();
    if (!raw) {
      if (field.required) throw new AppError(`Informe: ${field.label}.`);
      continue;
    }
    if (raw.length > 120) throw new AppError(`${field.label} é muito longo.`);
    if (field.type === "select" && !field.options?.includes(raw)) throw new AppError(`Valor inválido em ${field.label}.`);
    if (field.pattern && !new RegExp(field.pattern).test(raw)) throw new AppError(field.patternHint ?? `${field.label} em formato inválido.`);
    data[field.key] = raw;
    if (field.primary && !handle) handle = raw;
  }
  if (!handle) throw new AppError("Informe o ID principal da conta.");
  return { data, handle };
}

export async function saveGameAccount(userId: string, gameId: string, input: Record<string, string | undefined>) {
  const game = requireGame(gameId);
  const { data, handle } = validateIdentity(game, input);
  // O mesmo ID de jogo não pode ser vinculado a duas contas da plataforma (evita contas duplicadas/smurfs).
  const clash = await db.gameAccount.findFirst({ where: { gameId, handle, NOT: { userId } }, select: { id: true } });
  if (clash) throw new AppError("Este ID de jogo já está vinculado a outra conta da plataforma.", "CONFLICT");
  return db.gameAccount.upsert({
    where: { userId_gameId: { userId, gameId } },
    create: { userId, gameId, handle, data },
    update: { handle, data },
  });
}

export async function removeGameAccount(userId: string, gameId: string): Promise<void> {
  await db.gameAccount.deleteMany({ where: { userId, gameId } });
}

export async function listGameAccounts(userId: string) {
  return db.gameAccount.findMany({ where: { userId }, orderBy: { gameId: "asc" } });
}

export type { IdentityField };
