import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { makeOrg, makeUser, uid } from "./factories";
import { admin, newAdmin } from "./wallet-helpers";
import { createOrganization, addOrgMember } from "@/server/orgs";
import { createTournament, updateTournament } from "@/server/tournaments";
import { effectiveRole, toSafeUser } from "@/server/auth";
import { listUsers, setUserRole } from "@/server/users-admin";
import { organizerOverview } from "@/server/organizer";
import type { Actor } from "@/server/types";

const future = (h: number) => new Date(Date.now() + h * 3600_000);

/** O ator "como o site monta a cada requisição": papel lido do banco no momento. */
async function fresh(userId: string): Promise<Actor> {
  const u = await db.user.findUniqueOrThrow({ where: { id: userId } });
  return { ...toSafeUser(u), role: effectiveRole(u) } as Actor;
}

async function tournamentOf(owner: Actor, orgId: string) {
  return createTournament(owner, { orgId, gameId: "sf6", modeId: "1v1", presetId: "sf6.single-elim", name: `Copa de papéis ${uid()}`, startsAt: future(48), maxParticipants: 16 });
}

describe("três cargos: jogador, organizador e admin", () => {
  it("jogador não cria organização nem campeonato; organizador cria", async () => {
    const player = await makeUser();
    expect(player.role).toBe("USER");
    await expect(createOrganization(player, { name: `Org ${uid()}` })).rejects.toThrow(/organizadores/);
    expect((await db.user.findUniqueOrThrow({ where: { id: player.id } })).role).toBe("USER"); // sem promoção automática

    const organizer = await makeUser({ role: "ORGANIZER" });
    const org = await createOrganization(organizer, { name: `Org ${uid()}` });
    const t = await tournamentOf(organizer, org.id);
    expect(t.status).toBe("DRAFT");

    // jogador sem vínculo também não cria campeonato na organização de outro
    await expect(tournamentOf(player, org.id)).rejects.toThrow(/permissão/);
  });

  it("admin gerencia a organização e o campeonato de qualquer pessoa", async () => {
    const owner = await makeUser({ role: "ORGANIZER" });
    const org = await createOrganization(owner, { name: `Org ${uid()}` });
    const t = await tournamentOf(owner, org.id);
    const a = await admin();

    const edited = await updateTournament(a, t.id, { name: "Nome alterado pelo administrador" });
    expect(edited.name).toBe("Nome alterado pelo administrador");
    const other = await tournamentOf(a, org.id); // cria campeonato na organização alheia
    expect(other.orgId).toBe(org.id);

    // organizador de OUTRA organização não mexe
    const rival = await makeUser({ role: "ORGANIZER" });
    await expect(updateTournament(rival, t.id, { name: "Invasão" })).rejects.toThrow(/permissão/);
  });

  it("admin troca jogador ↔ organizador; o efeito é imediato e fica auditado", async () => {
    const a = await admin();
    const player = await makeUser();
    const r = await setUserRole(a, player.id, "ORGANIZER");
    expect(r).toMatchObject({ changed: true, from: "USER", to: "ORGANIZER" });
    expect((await db.user.findUniqueOrThrow({ where: { id: player.id } })).role).toBe("ORGANIZER");
    expect(await db.auditLog.count({ where: { action: "user.role", entityId: player.id } })).toBe(1);
    expect(await db.notification.count({ where: { userId: player.id, kind: "user.role" } })).toBe(1);

    // agora o antigo jogador cria organização
    const org = await createOrganization(await fresh(player.id), { name: `Org ${uid()}` });
    const t = await tournamentOf(await fresh(player.id), org.id);

    // repetir não muda nada
    expect(await setUserRole(a, player.id, "ORGANIZER")).toMatchObject({ changed: false });

    // volta a jogador: informa o impacto e perde a gestão, mas o admin continua podendo
    const back = await setUserRole(a, player.id, "USER");
    expect(back).toMatchObject({ changed: true, from: "ORGANIZER", to: "USER", impact: { orgs: 1 } });
    const asPlayer = await fresh(player.id);
    expect(asPlayer.role).toBe("USER");
    await expect(createOrganization(asPlayer, { name: `Org ${uid()}` })).rejects.toThrow(/organizadores/);
    await expect(updateTournament(asPlayer, t.id, { name: "Ainda mando aqui?" })).rejects.toThrow(/permissão/);
    expect((await updateTournament(a, t.id, { name: "Admin assume o campeonato" })).name).toBe("Admin assume o campeonato");
  });

  it("quem volta a ser jogador mantém só a função de equipe de apoio (STAFF) que um organizador deu", async () => {
    const owner = await makeUser({ role: "ORGANIZER" });
    const org = await makeOrg(owner);
    const helper = await makeUser(); // jogador comum
    await addOrgMember(owner, org.id, (await db.user.findUniqueOrThrow({ where: { id: helper.id } })).username, "STAFF");
    const { canManageOrg } = await import("@/server/permissions");
    expect(await canManageOrg(await fresh(helper.id), org.id, "staff")).toBe(true); // opera partidas
    expect(await canManageOrg(await fresh(helper.id), org.id, "admin")).toBe(false); // mas não administra
    // um jogador com função ADMIN na organização só vale como organizador
    const second = await makeUser();
    await addOrgMember(owner, org.id, (await db.user.findUniqueOrThrow({ where: { id: second.id } })).username, "ADMIN");
    expect(await canManageOrg(await fresh(second.id), org.id, "staff")).toBe(false);
    await setUserRole(await admin(), second.id, "ORGANIZER");
    expect(await canManageOrg(await fresh(second.id), org.id, "admin")).toBe(true);
  });

  it("travas: só admin muda cargo; ninguém altera a si mesmo nem outro admin; só jogador/organizador", async () => {
    const a = await admin();
    const target = await makeUser();
    const organizer = await makeUser({ role: "ORGANIZER" });
    await expect(setUserRole(organizer, target.id, "ORGANIZER")).rejects.toThrow(/administradores/);
    await expect(setUserRole(await fresh(target.id), target.id, "ORGANIZER")).rejects.toThrow(/administradores/);
    await expect(setUserRole(a, a.id, "USER")).rejects.toThrow(/próprio cargo/);
    const other = await newAdmin();
    await expect(setUserRole(a, other.id, "USER")).rejects.toThrow(/administrador/);
    await expect(setUserRole(a, target.id, "ADMIN")).rejects.toThrow(/Jogador ou Organizador/);
    await expect(setUserRole(a, "nao-existe", "USER")).rejects.toThrow(/não encontrado/);
    expect((await db.user.findUniqueOrThrow({ where: { id: other.id } })).role).toBe("ADMIN"); // intacto
  });

  it("e-mail em ADMIN_EMAILS (verificado) também é protegido contra rebaixamento", async () => {
    const u = await makeUser();
    const email = (await db.user.findUniqueOrThrow({ where: { id: u.id } })).email;
    const before = process.env.ADMIN_EMAILS;
    process.env.ADMIN_EMAILS = email;
    try {
      await expect(setUserRole(await admin(), u.id, "ORGANIZER")).rejects.toThrow(/administrador/);
    } finally {
      if (before === undefined) delete process.env.ADMIN_EMAILS;
      else process.env.ADMIN_EMAILS = before;
    }
  });

  it("listagem de usuários: só admin; busca e filtro por cargo", async () => {
    const organizer = await makeUser({ role: "ORGANIZER", name: "Organizadora Zelda Teste" });
    const player = await makeUser();
    await expect(listUsers(player)).rejects.toThrow(/administradores/);
    const a = await admin();
    const found = await listUsers(a, { q: "Zelda Teste" });
    expect(found.users.map((u) => u.id)).toContain(organizer.id);
    expect(found.users.every((u) => u.displayName.includes("Zelda"))).toBe(true);
    const onlyOrg = await listUsers(a, { role: "ORGANIZER", q: (await db.user.findUniqueOrThrow({ where: { id: organizer.id } })).username });
    expect(onlyOrg.users).toHaveLength(1);
    expect(onlyOrg.users[0].role).toBe("ORGANIZER");
    expect((await listUsers(a, { role: "USER", q: (await db.user.findUniqueOrThrow({ where: { id: organizer.id } })).username })).users).toHaveLength(0);
  });

  it("painel do organizador: o admin vê todas as organizações; o organizador, só as suas", async () => {
    const owner = await makeUser({ role: "ORGANIZER" });
    const org = await makeOrg(owner);
    const other = await makeOrg(await makeUser({ role: "ORGANIZER" }));
    const a = await admin();
    const asAdmin = await organizerOverview(a.id, true);
    expect(asAdmin.orgs.map((o) => o.id)).toEqual(expect.arrayContaining([org.id, other.id]));
    expect(asAdmin.orgs.find((o) => o.id === org.id)?.role).toBe("PLATFORM");
    const asOwner = await organizerOverview(owner.id, false);
    expect(asOwner.orgs.map((o) => o.id)).toEqual([org.id]);
    expect(asOwner.orgs[0].role).toBe("OWNER");
  });
});
