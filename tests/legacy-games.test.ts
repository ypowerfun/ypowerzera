import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { linkGame, makeOrg, makeUser, uid } from "./factories";
import { admin } from "./wallet-helpers";
import { createTournament } from "@/server/tournaments";
import { createTeam } from "@/server/teams";
import { saveGameAccount } from "@/server/game-accounts";
import { deleteOrganization } from "@/server/orgs";
import { listUsers } from "@/server/users-admin";
import { migrateLegacyGameIds } from "../prisma/migrate-legacy";

const future = () => new Date(Date.now() + 72 * 3600_000);
const steam = (n: number) => `76561198${String(300000000 + n).padStart(9, "0")}`;
let seq = Math.floor(Math.random() * 50_000_000);

describe("registros antigos do CS:GO", () => {
  it("a migração leva campeonatos, times e contas para o CS2, sem apagar nem mesclar contas", async () => {
    const owner = await makeUser({ role: "ORGANIZER" });
    const org = await makeOrg(owner);
    const t = await createTournament(owner, { orgId: org.id, gameId: "cs2", modeId: "5v5", presetId: "cs2.single-elim", name: `Copa ${uid()}`, startsAt: future(), maxParticipants: 16 });
    await db.tournament.update({ where: { id: t.id }, data: { gameId: "csgo" } });
    const captain = await makeUser();
    const team = await createTeam(captain, { name: `Time ${uid()}`, tag: "CSG", gameId: "cs2" });
    await db.team.update({ where: { id: team.id }, data: { gameId: "csgo" } });

    // conta só de CS:GO: migra
    const solo = await makeUser();
    await db.gameAccount.create({ data: { userId: solo.id, gameId: "csgo", handle: steam(++seq), data: { steamId: steam(seq) } } });
    // quem já tem conta de CS2: a de CS:GO fica como está (nada é apagado nem mesclado)
    const both = await makeUser();
    await linkGame(both, "cs2");
    await db.gameAccount.create({ data: { userId: both.id, gameId: "csgo", handle: steam(++seq), data: { steamId: steam(seq) } } });
    // ID já usado por outra pessoa no CS2: não migra para não duplicar a conta de jogo na plataforma
    const other = await makeUser();
    const otherAcc = await linkGame(other, "cs2");
    const clash = await makeUser();
    await db.gameAccount.create({ data: { userId: clash.id, gameId: "csgo", handle: otherAcc.handle, data: { steamId: otherAcc.handle } } });

    const r = await migrateLegacyGameIds(db);
    expect(r.tournaments).toBeGreaterThanOrEqual(1);
    expect(r.teams).toBeGreaterThanOrEqual(1);
    expect(r.accounts).toBeGreaterThanOrEqual(1);
    expect(r.accountsKept).toBeGreaterThanOrEqual(2);

    expect((await db.tournament.findUniqueOrThrow({ where: { id: t.id } })).gameId).toBe("cs2");
    expect((await db.team.findUniqueOrThrow({ where: { id: team.id } })).gameId).toBe("cs2");
    expect(await db.gameAccount.count({ where: { userId: solo.id, gameId: "cs2" } })).toBe(1);
    expect(await db.gameAccount.count({ where: { userId: solo.id, gameId: "csgo" } })).toBe(0);
    expect(await db.gameAccount.count({ where: { userId: both.id } })).toBe(2); // continua com as duas
    expect(await db.gameAccount.count({ where: { userId: clash.id, gameId: "csgo" } })).toBe(1);

    const again = await migrateLegacyGameIds(db); // idempotente: só as contas mantidas continuam à espera
    expect(again.tournaments + again.teams + again.accounts).toBe(0);
  });

  it("escritas novas guardam sempre o id atual, mesmo se chegar o id antigo", async () => {
    const owner = await makeUser({ role: "ORGANIZER" });
    const org = await makeOrg(owner);
    const t = await createTournament(owner, { orgId: org.id, gameId: "csgo", modeId: "5v5", presetId: "cs2.single-elim", name: `Copa antiga ${uid()}`, startsAt: future(), maxParticipants: 16 });
    expect(t.gameId).toBe("cs2");
    const team = await createTeam(await makeUser(), { name: `Time antigo ${uid()}`, tag: "OLD", gameId: "csgo" });
    expect(team.gameId).toBe("cs2");
    const player = await makeUser();
    const acc = await saveGameAccount(player.id, "csgo", { steamId: steam(++seq) });
    expect(acc.gameId).toBe("cs2");
    expect(await db.gameAccount.count({ where: { userId: player.id, gameId: "csgo" } })).toBe(0);
  });
});

describe("contagens do admin ignoram organizações excluídas", () => {
  it("a coluna Organizações não conta a organização que o dono excluiu", async () => {
    const owner = await makeUser({ role: "ORGANIZER" });
    const org = await makeOrg(owner);
    const username = (await db.user.findUniqueOrThrow({ where: { id: owner.id } })).username;
    const a = await admin();
    const count = async () => (await listUsers(a, { q: username })).users.find((u) => u.id === owner.id)!.orgsManaged;
    expect(await count()).toBe(1);
    await deleteOrganization(owner, org.id, { confirmName: org.name });
    expect(await count()).toBe(0);
  });
});
