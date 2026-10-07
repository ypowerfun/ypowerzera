import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { makeOrg, makeUser, uid } from "./factories";
import { createTournament } from "@/server/tournaments";
import { ORG_RENAMES, TOURNAMENT_RENAMES, refreshDemoNames } from "../prisma/refresh-demo";

const future = () => new Date(Date.now() + 72 * 3600_000);

describe("atualização dos nomes dos dados de demonstração", () => {
  it("renomeia só os textos exatos que a seed antiga criou e é idempotente", async () => {
    const owner = await makeUser({ role: "ORGANIZER" });
    const org = await makeOrg(owner);
    const make = (name: string) =>
      createTournament(owner, { orgId: org.id, gameId: "sf6", modeId: "1v1", presetId: "sf6.single-elim", name, startsAt: future(), maxParticipants: 16 });

    const sf6Old = await make("Copa Prime Arena de Street Fighter 6");
    const sf6Oldest = await make("Copa Prime Arena One de Street Fighter 6");
    const valOld = await make("Prime Arena One Valorant Cup #1");
    const mine = await make(`Copa do ${uid()} de Street Fighter 6`); // criado por alguém: não é da seed, não pode mudar
    await db.organization.update({ where: { id: org.id }, data: { name: "Prime Arena One Oficial" } });

    expect(await refreshDemoNames(db)).toBeGreaterThanOrEqual(4);
    const name = async (id: string) => (await db.tournament.findUniqueOrThrow({ where: { id } })).name;
    expect(await name(sf6Old.id)).toBe("Copa Prime Arena de Street Fighter");
    expect(await name(sf6Oldest.id)).toBe("Copa Prime Arena de Street Fighter");
    expect(await name(valOld.id)).toBe("Prime Arena Valorant Cup #1");
    expect(await name(mine.id)).toBe(mine.name); // intacto
    expect((await db.organization.findUniqueOrThrow({ where: { id: org.id } })).name).toBe("Prime Arena Oficial");

    expect(await refreshDemoNames(db)).toBe(0); // rodar de novo não faz nada
  });

  it("os nomes novos não aparecem entre os antigos (nada fica renomeando em laço)", () => {
    const olds = new Set([...TOURNAMENT_RENAMES, ...ORG_RENAMES].map(([from]) => from));
    for (const [, to] of [...TOURNAMENT_RENAMES, ...ORG_RENAMES]) expect(olds.has(to)).toBe(false);
  });
});
