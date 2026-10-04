import { db } from "@/lib/db";
import { hashPassword } from "@/lib/crypto";
import { saveGameAccount } from "@/server/game-accounts";
import { createOrganization } from "@/server/orgs";
import { createTeam } from "@/server/teams";
import { effectiveRole, toSafeUser } from "@/server/auth";
import type { Actor } from "@/server/types";

let counter = 0;
let cachedHash: string | null = null;

export const uid = () => `${Date.now().toString(36)}${(counter++).toString(36)}`;

export async function makeUser(opts: { verified?: boolean; role?: "USER" | "ORGANIZER" | "ADMIN"; name?: string; createdHoursAgo?: number } = {}): Promise<Actor> {
  cachedHash ??= await hashPassword("SenhaBoa#2026");
  const id = uid();
  const u = await db.user.create({
    data: {
      email: `u${id}@test.dev`,
      username: `u${id}`,
      displayName: opts.name ?? `Jogador ${id}`,
      passwordHash: cachedHash,
      role: opts.role ?? "USER",
      emailVerifiedAt: opts.verified === false ? null : new Date(),
      createdAt: opts.createdHoursAgo ? new Date(Date.now() - opts.createdHoursAgo * 3600_000) : undefined,
    },
  });
  return { ...toSafeUser(u), role: effectiveRole(u) } as Actor;
}

export const PASSWORD = "SenhaBoa#2026";

const identityFor: Record<string, (n: string) => Record<string, string>> = {
  sf6: (n) => ({ capcomId: `player${n}`, platform: "PC" }),
  cs2: (n) => ({ steamId: `7656119${String(8000000000 + Number(n.replace(/\D/g, "").slice(-8) || 1)).slice(-10)}` }),
  fortnite: (n) => ({ epicId: `Epic${n}`.slice(0, 16), platform: "PC" }),
  valorant: (n) => ({ riotId: `Nome${n}#BR1`.slice(0, 16) + "" }),
  lol: (n) => ({ riotId: `Nome${n}#BR1` }),
  apex: (n) => ({ eaId: `EA${n}`.slice(0, 16), platform: "PC" }),
};

// semente aleatória por arquivo: o banco de teste é compartilhado e o ID de jogo é único na plataforma
let steam = Math.floor(Math.random() * 80_000_000);
export async function linkGame(user: Actor, gameId: string) {
  const n = `${++steam}`;
  let identity: Record<string, string>;
  if (gameId === "cs2" || gameId === "csgo") identity = { steamId: `76561198${String(100000000 + steam).padStart(9, "0")}` };
  else if (gameId === "valorant" || gameId === "lol" || gameId === "tft") identity = { riotId: `Jog${n}#BR1` };
  else identity = (identityFor[gameId] ?? identityFor.sf6)(n);
  return saveGameAccount(user.id, gameId, identity);
}

export async function makeOrg(owner: Actor) {
  return createOrganization({ ...owner, role: "USER" }, { name: `Org ${uid()}` });
}

export async function makeTeamWithPlayers(captain: Actor, size: number, gameId: string, name?: string) {
  const team = await createTeam(captain, { name: name ?? `Time ${uid()}`, tag: uid().slice(-4).toUpperCase().replace(/[^A-Z0-9]/g, "X").padEnd(2, "X") });
  const players: Actor[] = [captain];
  await linkGame(captain, gameId);
  for (let i = 1; i < size; i++) {
    const p = await makeUser();
    await linkGame(p, gameId);
    await db.teamMember.create({ data: { teamId: team.id, userId: p.id, role: "PLAYER" } });
    players.push(p);
  }
  return { team, players };
}
