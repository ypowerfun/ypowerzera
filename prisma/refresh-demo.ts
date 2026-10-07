/**
 * Atualiza os NOMES dos dados de demonstração de bancos que já existem (a seed não roda de novo quando já há dados).
 * Só troca textos exatos que a própria seed criou; nada que alguém tenha criado ou renomeado é tocado. Seguro rodar sempre.
 * É chamado sozinho pelo `npm run dev` (scripts/setup.mjs --if-needed) e pode ser rodado à mão: npx tsx prisma/refresh-demo.ts
 */
import { PrismaClient } from "@prisma/client";

export const TOURNAMENT_RENAMES: [string, string][] = [
  ["Copa Prime Arena One de Street Fighter 6", "Copa Prime Arena de Street Fighter"],
  ["Copa Prime Arena de Street Fighter 6", "Copa Prime Arena de Street Fighter"],
  ["Prime Arena One Valorant Cup #1", "Prime Arena Valorant Cup #1"],
];
export const ORG_RENAMES: [string, string][] = [["Prime Arena One Oficial", "Prime Arena Oficial"]];

type Db = Pick<PrismaClient, "tournament" | "organization">;

/** Devolve quantos registros foram renomeados. */
export async function refreshDemoNames(db: Db): Promise<number> {
  let n = 0;
  for (const [from, to] of TOURNAMENT_RENAMES) n += (await db.tournament.updateMany({ where: { name: from }, data: { name: to } })).count;
  for (const [from, to] of ORG_RENAMES) n += (await db.organization.updateMany({ where: { name: from }, data: { name: to } })).count;
  return n;
}

if (process.argv[1] && /refresh-demo\.[cm]?[jt]s$/.test(process.argv[1])) {
  const db = new PrismaClient();
  refreshDemoNames(db)
    .then((n) => n && console.log(`✔ Nomes dos dados de demonstração atualizados (${n}).`))
    .catch((e) => {
      console.error("Não foi possível atualizar os nomes de demonstração:", e instanceof Error ? e.message : e);
      process.exitCode = 1;
    })
    .finally(() => db.$disconnect());
}
