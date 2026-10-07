/**
 * Migra para o id atual os registros que ainda guardam o id de um jogo que saiu do catálogo ("csgo" -> "cs2"), para que
 * apareçam nos filtros e na página do CS2 e possam ser usados (inscrição, desafio, conta de jogo). Idempotente e seguro:
 * - torneios, times e desafios só trocam o texto do jogo (não há unicidade sobre ele);
 * - contas de jogo só migram quando a pessoa ainda não tem conta de CS2 e o ID não colide com outra; nos demais casos ficam
 *   como estão (o catálogo continua abrindo o id antigo como CS2), nada é apagado nem mesclado.
 * É chamado sozinho pelo `npm run dev` (scripts/setup.mjs --if-needed) e pode ser rodado à mão: npx tsx prisma/migrate-legacy.ts
 */
import { PrismaClient } from "@prisma/client";

export const LEGACY_GAME_IDS: Record<string, string> = { csgo: "cs2" };

type Db = Pick<PrismaClient, "tournament" | "team" | "challenge" | "gameAccount">;

export interface LegacyMigrationResult {
  tournaments: number;
  teams: number;
  challenges: number;
  accounts: number;
  accountsKept: number;
}

export async function migrateLegacyGameIds(db: Db): Promise<LegacyMigrationResult> {
  const r: LegacyMigrationResult = { tournaments: 0, teams: 0, challenges: 0, accounts: 0, accountsKept: 0 };
  for (const [from, to] of Object.entries(LEGACY_GAME_IDS)) {
    r.tournaments += (await db.tournament.updateMany({ where: { gameId: from }, data: { gameId: to } })).count;
    r.teams += (await db.team.updateMany({ where: { gameId: from }, data: { gameId: to } })).count;
    r.challenges += (await db.challenge.updateMany({ where: { gameId: from }, data: { gameId: to } })).count;
    const accounts = await db.gameAccount.findMany({ where: { gameId: from } });
    for (const a of accounts) {
      const [mine, clash] = await Promise.all([
        db.gameAccount.findUnique({ where: { userId_gameId: { userId: a.userId, gameId: to } }, select: { id: true } }),
        db.gameAccount.findFirst({ where: { gameId: to, handle: a.handle, NOT: { userId: a.userId } }, select: { id: true } }),
      ]);
      if (mine || clash) {
        r.accountsKept++;
        continue;
      }
      await db.gameAccount.update({ where: { id: a.id }, data: { gameId: to } });
      r.accounts++;
    }
  }
  return r;
}

if (process.argv[1] && /migrate-legacy\.[cm]?[jt]s$/.test(process.argv[1])) {
  const db = new PrismaClient();
  migrateLegacyGameIds(db)
    .then((r) => {
      const n = r.tournaments + r.teams + r.challenges + r.accounts;
      if (n) console.log(`✔ Registros antigos do CS:GO passaram para o CS2 (${r.tournaments} campeonato(s), ${r.teams} time(s), ${r.challenges} desafio(s), ${r.accounts} conta(s)).`);
    })
    .catch((e) => {
      console.error("Não foi possível migrar os registros antigos de jogos:", e instanceof Error ? e.message : e);
      process.exitCode = 1;
    })
    .finally(() => db.$disconnect());
}
