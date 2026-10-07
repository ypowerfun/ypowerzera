import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { makeOrg, makeUser, uid } from "./factories";
import { admin } from "./wallet-helpers";
import { addOrgMember, deleteOrganization, myOrganizations, updateOrganization } from "@/server/orgs";
import { createTournament, publishTournament } from "@/server/tournaments";
import { canManageOrg } from "@/server/permissions";
import { organizerOverview } from "@/server/organizer";
import { setUserRole } from "@/server/users-admin";
import { effectiveRole, toSafeUser } from "@/server/auth";
import type { Actor } from "@/server/types";

const future = (h: number) => new Date(Date.now() + h * 3600_000);
const fresh = async (id: string): Promise<Actor> => {
  const u = await db.user.findUniqueOrThrow({ where: { id } });
  return { ...toSafeUser(u), role: effectiveRole(u) } as Actor;
};
const usernameOf = async (a: Actor) => (await db.user.findUniqueOrThrow({ where: { id: a.id } })).username;
const draft = (owner: Actor, orgId: string) =>
  createTournament(owner, { orgId, gameId: "sf6", modeId: "1v1", presetId: "sf6.single-elim", name: `Copa de teste ${uid()}`, startsAt: future(72), maxParticipants: 16 });

async function orgWithTeam() {
  const owner = await makeUser({ role: "ORGANIZER" });
  const org = await makeOrg(owner);
  const orgAdmin = await makeUser({ role: "ORGANIZER" });
  const staff = await makeUser();
  await addOrgMember(owner, org.id, await usernameOf(orgAdmin), "ADMIN");
  await addOrgMember(owner, org.id, await usernameOf(staff), "STAFF");
  return { owner, org, orgAdmin, staff };
}

describe("editar / renomear organização", () => {
  it("dono e admin da organização editam; equipe de apoio e jogador não; o endereço (slug) não muda", async () => {
    const { owner, org, orgAdmin, staff } = await orgWithTeam();
    const renamed = await updateOrganization(owner, org.id, { name: "  Nome Novo da Org  ", description: "  Descrição nova  " });
    expect(renamed).toMatchObject({ name: "Nome Novo da Org", description: "Descrição nova", slug: org.slug });
    expect(await db.auditLog.count({ where: { action: "org.update", entityId: org.id } })).toBe(1);

    await updateOrganization(orgAdmin, org.id, { name: "Renomeada pelo admin da org" });
    expect((await db.organization.findUniqueOrThrow({ where: { id: org.id } })).name).toBe("Renomeada pelo admin da org");
    // descrição vazia limpa o campo
    await updateOrganization(owner, org.id, { name: "Renomeada pelo admin da org", description: "" });
    expect((await db.organization.findUniqueOrThrow({ where: { id: org.id } })).description).toBeNull();

    await expect(updateOrganization(staff, org.id, { name: "Tentativa da equipe" })).rejects.toThrow(/permissão/);
    await expect(updateOrganization(await makeUser(), org.id, { name: "Tentativa de estranho" })).rejects.toThrow(/permissão/);
    await expect(updateOrganization(owner, org.id, { name: "ab" })).rejects.toThrow(/mínimo de 3/);
    await expect(updateOrganization(owner, org.id, { name: "x".repeat(61) })).rejects.toThrow(/máximo de 60/);

    // admin da plataforma edita qualquer organização
    await updateOrganization(await admin(), org.id, { name: "Ajustada pela plataforma" });
    expect((await db.organization.findUniqueOrThrow({ where: { id: org.id } })).name).toBe("Ajustada pela plataforma");
  });

  it("quem foi rebaixado a jogador perde a edição", async () => {
    const { owner, org } = await orgWithTeam();
    await setUserRole(await admin(), owner.id, "USER");
    await expect(updateOrganization(await fresh(owner.id), org.id, { name: "Ainda tento renomear" })).rejects.toThrow(/permissão/);
  });
});

describe("excluir organização", () => {
  it("só o dono (ou o admin da plataforma), digitando o nome exato", async () => {
    const { owner, org, orgAdmin, staff } = await orgWithTeam();
    await expect(deleteOrganization(orgAdmin, org.id, { confirmName: org.name })).rejects.toThrow(/Só o dono/);
    await expect(deleteOrganization(staff, org.id, { confirmName: org.name })).rejects.toThrow(/Só o dono/);
    await expect(deleteOrganization(await makeUser(), org.id, { confirmName: org.name })).rejects.toThrow(/Só o dono/);
    await expect(deleteOrganization(owner, org.id, { confirmName: "outro nome" })).rejects.toThrow(/nome exato/);
    await expect(deleteOrganization(owner, org.id, { confirmName: "" })).rejects.toThrow(/nome exato/);
    expect((await db.organization.findUniqueOrThrow({ where: { id: org.id } })).deletedAt).toBeNull();

    await deleteOrganization(owner, org.id, { confirmName: `  ${org.name}  ` });
    const gone = await db.organization.findUniqueOrThrow({ where: { id: org.id } });
    expect(gone.deletedAt).not.toBeNull(); // exclusão lógica: a linha e o histórico ficam
    expect(await db.auditLog.count({ where: { action: "org.delete", entityId: org.id } })).toBe(1);
    // os outros membros são avisados; quem excluiu não
    expect(await db.notification.count({ where: { kind: "org.deleted", userId: orgAdmin.id } })).toBe(1);
    expect(await db.notification.count({ where: { kind: "org.deleted", userId: owner.id } })).toBe(0);
    await expect(deleteOrganization(owner, org.id, { confirmName: org.name })).rejects.toThrow(/não encontrada/); // não exclui duas vezes
  });

  it("o admin da plataforma exclui organização de outra pessoa; o dono rebaixado não exclui", async () => {
    const a = await orgWithTeam();
    await deleteOrganization(await admin(), a.org.id, { confirmName: a.org.name });
    expect((await db.organization.findUniqueOrThrow({ where: { id: a.org.id } })).deletedAt).not.toBeNull();
    expect((await db.auditLog.findFirstOrThrow({ where: { action: "org.delete", entityId: a.org.id } })).meta).toMatchObject({ byAdmin: true });

    const b = await orgWithTeam();
    await setUserRole(await admin(), b.owner.id, "USER");
    await expect(deleteOrganization(await fresh(b.owner.id), b.org.id, { confirmName: b.org.name })).rejects.toThrow(/Só o dono/);
  });

  it("não exclui com campeonato aberto ou em andamento; rascunhos não impedem", async () => {
    const { owner, org } = await orgWithTeam();
    const t = await draft(owner, org.id);
    await publishTournament(owner, t.id); // inscrições abertas
    await expect(deleteOrganization(owner, org.id, { confirmName: org.name })).rejects.toThrow(/aberto\(s\) ou em andamento/);
    expect((await db.organization.findUniqueOrThrow({ where: { id: org.id } })).deletedAt).toBeNull();

    await db.tournament.update({ where: { id: t.id }, data: { status: "CANCELED" } }); // cancelado deixa de impedir
    await draft(owner, org.id); // e um rascunho também não
    await deleteOrganization(owner, org.id, { confirmName: org.name });
    expect((await db.organization.findUniqueOrThrow({ where: { id: org.id } })).deletedAt).not.toBeNull();
  });

  it("não exclui com premiação ainda por pagar", async () => {
    const { owner, org } = await orgWithTeam();
    const t = await draft(owner, org.id);
    const player = await makeUser();
    const p = await db.participant.create({ data: { tournamentId: t.id, userId: player.id, name: "Campeão", roster: [] } });
    await db.tournament.update({ where: { id: t.id }, data: { status: "COMPLETED" } });
    const award = await db.prizeAward.create({ data: { tournamentId: t.id, participantId: p.id, placement: 1, label: "Campeão", amountCents: 10_000 } });
    await expect(deleteOrganization(owner, org.id, { confirmName: org.name })).rejects.toThrow(/premiação/);
    await db.prizeAward.update({ where: { id: award.id }, data: { status: "PAID", paidAt: new Date() } });
    await deleteOrganization(owner, org.id, { confirmName: org.name });
    expect((await db.organization.findUniqueOrThrow({ where: { id: org.id } })).deletedAt).not.toBeNull();
  });

  it("depois de excluída: some das listas, ninguém cria campeonato nela e só o admin enxerga o histórico", async () => {
    const { owner, org, orgAdmin, staff } = await orgWithTeam();
    const t = await draft(owner, org.id);
    const a = await admin();
    expect((await organizerOverview(owner)).orgs.map((o) => o.id)).toContain(org.id);
    expect((await organizerOverview(a)).orgs.map((o) => o.id)).toContain(org.id);

    await deleteOrganization(owner, org.id, { confirmName: org.name });

    expect((await organizerOverview(owner)).orgs.map((o) => o.id)).not.toContain(org.id);
    expect((await organizerOverview(a)).orgs.map((o) => o.id)).not.toContain(org.id);
    expect((await organizerOverview(a)).tournaments.map((x) => x.id)).not.toContain(t.id);
    expect((await myOrganizations(owner.id)).map((m) => m.orgId)).not.toContain(org.id);
    expect((await organizerOverview(staff)).orgs).toHaveLength(0);

    await expect(draft(owner, org.id)).rejects.toThrow(/não encontrada/);
    await expect(draft(a, org.id)).rejects.toThrow(/não encontrada/); // nem o admin cria campeonato em organização excluída
    await expect(addOrgMember(owner, org.id, await usernameOf(await makeUser()), "STAFF")).rejects.toThrow(/não encontrada/);
    await expect(updateOrganization(owner, org.id, { name: "Voltando dos mortos" })).rejects.toThrow(/não encontrada/);

    expect(await canManageOrg(owner, org.id, "staff")).toBe(false);
    expect(await canManageOrg(orgAdmin, org.id, "staff")).toBe(false);
    expect(await canManageOrg(a, org.id, "admin")).toBe(true); // o histórico segue acessível ao admin da plataforma
  });
});
