import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { PASSWORD, makeOrg, makeUser, uid } from "./factories";
import { admin, balances, emailOf, fund, lastOtp, leaderWithWinnings, makeLeader, newAdmin } from "./wallet-helpers";
import { createTeam, deleteTeam, inviteToTeam, myTeams, setMemberRole } from "@/server/teams";
import { leaderDeletedTeams, leaderTeams } from "@/server/team-auth";
import { listReleaseRequests, requestBalanceReview, reviewBalanceRequest } from "@/server/team-release";
import { createDeposit, resolveHeldDeposit } from "@/server/deposits";
import { cancelChallenge, createChallenge } from "@/server/challenges";
import { cancelWithdrawal, confirmWithdrawal, requestWithdrawal, reviewWithdrawal } from "@/server/withdrawals";
import { createTournament, publishTournament } from "@/server/tournaments";
import { handlePixWebhook } from "@/server/pix-webhooks";
import { mockPayCharge } from "@/server/pix/mock";
import { reconcileAll, withdrawableBreakdown } from "@/server/wallet";

const nonce = () => `nonce-${Math.random().toString(36).slice(2)}-${Date.now()}`;
const future = (h: number) => new Date(Date.now() + h * 3600_000);
type Leader = Awaited<ReturnType<typeof makeLeader>>;
beforeEach(async () => {
  await db.rateLimit.deleteMany();
});

const challengeInput = (l: Leader, stakeCents = 1_000) => ({ teamId: l.team.id, gameId: "sf6", modeId: "1v1", bestOf: 3, stakeCents, lineupUserIds: [l.user.id] });

describe("excluir time", () => {
  it("só o líder exclui; o time some das listas, o nome volta a ficar livre e a carteira é congelada", async () => {
    const l = await makeLeader();
    const member = await makeUser();
    await db.teamMember.create({ data: { teamId: l.team.id, userId: member.id, role: "PLAYER" } });
    const invitee = await makeUser();
    await inviteToTeam(l.user, l.team.id, (await db.user.findUniqueOrThrow({ where: { id: invitee.id } })).username);

    await expect(deleteTeam(member, l.team.id)).rejects.toThrow(/capitão/);
    await expect(deleteTeam(await makeUser(), l.team.id)).rejects.toThrow(/capitão/);

    const r = await deleteTeam(l.user, l.team.id);
    expect(r.balanceCents).toBe(0);
    const t = await db.team.findUniqueOrThrow({ where: { id: l.team.id }, include: { wallet: true } });
    expect(t.deletedAt).not.toBeNull();
    expect(t.balanceReleasedAt).toBeNull();
    expect(t.wallet!.frozenAt).not.toBeNull(); // sempre congela: qualquer valor que ainda chegue espera a revisão
    expect((await myTeams(l.user.id)).some((m) => m.teamId === l.team.id)).toBe(false);
    expect((await leaderTeams(l.user.id)).some((m) => m.teamId === l.team.id)).toBe(false);
    expect((await db.teamInvite.findFirstOrThrow({ where: { teamId: l.team.id } })).status).toBe("REVOKED");
    expect(await db.notification.count({ where: { userId: member.id, kind: "team.deleted" } })).toBe(1);
    expect(await db.auditLog.count({ where: { action: "team.delete", entityId: l.team.id } })).toBe(1);

    await expect(deleteTeam(l.user, l.team.id)).rejects.toThrow(/excluído/); // não exclui duas vezes
    await expect(inviteToTeam(l.user, l.team.id, "qualquer")).rejects.toThrow(/excluído/);
    const reused = await createTeam(l.user, { name: t.name, tag: "NEW" });
    expect(reused.id).not.toBe(l.team.id);
  });

  it("admin exclui time de outra pessoa, mas precisa informar o motivo", async () => {
    const l = await makeLeader();
    const a = await admin();
    await expect(deleteTeam(a, l.team.id)).rejects.toThrow(/motivo/);
    await deleteTeam(a, l.team.id, { reason: "Time usado para burlar as regras" });
    expect((await db.team.findUniqueOrThrow({ where: { id: l.team.id } })).deletedById).toBe(a.id);
    const log = await db.auditLog.findFirstOrThrow({ where: { action: "team.delete", entityId: l.team.id } });
    expect(log.meta).toMatchObject({ byAdmin: true, reason: "Time usado para burlar as regras" });
  });

  it("não exclui com desafio, saque, Pix pendente ou campeonato em andamento", async () => {
    const l = await makeLeader();
    await fund(l, 10_000);

    const ch = await createChallenge(l.user, challengeInput(l));
    await expect(deleteTeam(l.user, l.team.id)).rejects.toThrow(/desafio/);
    await cancelChallenge(l.user, ch.id);

    const pix = await createDeposit(l.user, { teamId: l.team.id, amountCents: 1_000 });
    await expect(deleteTeam(l.user, l.team.id)).rejects.toThrow(/Pix pendente/);
    await db.deposit.update({ where: { id: pix.id }, data: { status: "EXPIRED", expiresAt: new Date(Date.now() - 1000) } });

    // participação em campeonato aberto
    const owner = await makeUser({ role: "ORGANIZER" });
    const org = await makeOrg(owner);
    const tour = await createTournament(owner, { orgId: org.id, gameId: "sf6", modeId: "1v1", presetId: "sf6.single-elim", name: `Copa bloqueio ${uid()}`, startsAt: future(48), maxParticipants: 8 });
    await publishTournament(owner, tour.id);
    const part = await db.participant.create({ data: { tournamentId: tour.id, userId: l.user.id, teamId: l.team.id, name: "Time", roster: [] } });
    await expect(deleteTeam(l.user, l.team.id)).rejects.toThrow(/campeonato/);
    await db.participant.update({ where: { id: part.id }, data: { status: "WITHDRAWN" } });

    const r = await deleteTeam(l.user, l.team.id);
    expect(r.balanceCents).toBe(10_000);
  });

  it("não exclui com saque em andamento", async () => {
    const { winner } = await leaderWithWinnings(200_000, 50_000);
    const { withdrawalId } = await requestWithdrawal(winner.user, { teamId: winner.team.id, amountCents: 5_000, password: PASSWORD, nonce: nonce() });
    await expect(deleteTeam(winner.user, winner.team.id)).rejects.toThrow(/saque/);
    await cancelWithdrawal(winner.user, withdrawalId);
    await deleteTeam(winner.user, winner.team.id);
  });
});

describe("saldo de time excluído: bloqueio, revisão e liberação pelo admin", () => {
  async function deletedWithBalance() {
    const l = await makeLeader();
    await fund(l, 20_000);
    const r = await deleteTeam(l.user, l.team.id);
    expect(r.balanceCents).toBe(20_000);
    return l;
  }

  it("o saldo fica bloqueado: não deposita, não aposta, não saca", async () => {
    const l = await deletedWithBalance();
    expect((await leaderDeletedTeams(l.user.id)).map((r) => r.teamId)).toContain(l.team.id);
    await expect(createDeposit(l.user, { teamId: l.team.id, amountCents: 1_000 })).rejects.toThrow(/excluída/);
    await expect(createChallenge(l.user, challengeInput(l))).rejects.toThrow(/excluída/);
    await expect(requestWithdrawal(l.user, { teamId: l.team.id, amountCents: 2_000, password: PASSWORD, nonce: nonce() })).rejects.toThrow(/bloqueado/);
    expect((await balances(l.walletId)).available).toBe(20_000); // nada se perdeu
  });

  it("pedido de revisão: valida texto, líder, KYC e um pedido por vez", async () => {
    const l = await deletedWithBalance();
    await expect(requestBalanceReview(l.user, l.team.id, "curto")).rejects.toThrow(/10 a 500/);
    const stranger = await makeUser();
    await expect(requestBalanceReview(stranger, l.team.id, "Quero o saldo do time que não é meu")).rejects.toThrow(/líder/);
    const live = await makeLeader();
    await expect(requestBalanceReview(live.user, live.team.id, "Time ainda ativo, não deveria valer")).rejects.toThrow(/excluídas/);

    const req = await requestBalanceReview(l.user, l.team.id, "Encerramos o time; quero sacar o saldo para a minha conta.");
    expect(req.status).toBe("PENDING");
    expect(req.balanceCents).toBe(20_000);
    expect(await db.notification.count({ where: { kind: "team.release.request" } })).toBeGreaterThan(0);
    await expect(requestBalanceReview(l.user, l.team.id, "Segundo pedido enquanto o primeiro está em análise")).rejects.toThrow(/em análise/);
    expect((await listReleaseRequests(await admin(), "PENDING")).some((r) => r.id === req.id)).toBe(true);
    await expect(listReleaseRequests(l.user)).rejects.toThrow(/administradores/);
  });

  it("admin: precisa de motivo, não pode ser do time; recusa mantém o bloqueio; aprovação libera todo o saldo para saque", async () => {
    const l = await deletedWithBalance();
    const req1 = await requestBalanceReview(l.user, l.team.id, "Encerramos o time; quero sacar o saldo para a minha conta.");

    await expect(reviewBalanceRequest(await makeUser(), req1.id, "approve", "Tentando aprovar sem ser admin")).rejects.toThrow(/administradores/);
    await expect(reviewBalanceRequest(await admin(), req1.id, "approve", "curto")).rejects.toThrow(/10 caracteres/);
    const insider = await newAdmin();
    await db.teamMember.create({ data: { teamId: l.team.id, userId: insider.id, role: "PLAYER" } });
    await expect(reviewBalanceRequest(insider, req1.id, "approve", "Aprovando o saldo do meu próprio time")).rejects.toThrow(/Conflito/);

    // recusa: continua tudo bloqueado, e o líder pode pedir de novo
    await reviewBalanceRequest(await admin(), req1.id, "reject", "Documentos de origem do saldo não conferem");
    expect((await db.walletReleaseRequest.findUniqueOrThrow({ where: { id: req1.id } })).status).toBe("REJECTED");
    expect((await db.team.findUniqueOrThrow({ where: { id: l.team.id } })).balanceReleasedAt).toBeNull();
    expect((await db.wallet.findUniqueOrThrow({ where: { id: l.walletId } })).frozenAt).not.toBeNull();
    await expect(requestWithdrawal(l.user, { teamId: l.team.id, amountCents: 2_000, password: PASSWORD, nonce: nonce() })).rejects.toThrow(/bloqueado/);
    await expect(reviewBalanceRequest(await admin(), req1.id, "approve", "Tentando reanalisar o mesmo pedido")).rejects.toThrow(/já foi analisado/);

    const req2 = await requestBalanceReview(l.user, l.team.id, "Segui a orientação e anexei a origem do saldo ao suporte.");
    // antes da liberação o saldo é "não jogado": nada é sacável
    expect((await withdrawableBreakdown(db, l.walletId)).withdrawableCents).toBe(0);
    const out = await reviewBalanceRequest(await admin(), req2.id, "approve", "Conferi a origem dos depósitos e o titular");
    expect(out).toEqual({ approved: true, releasedCents: 20_000 });
    const t = await db.team.findUniqueOrThrow({ where: { id: l.team.id }, include: { wallet: true } });
    expect(t.balanceReleasedAt).not.toBeNull();
    expect(t.wallet!.frozenAt).toBeNull();
    expect((await db.walletReleaseRequest.findUniqueOrThrow({ where: { id: req2.id } })).releasedCents).toBe(20_000);
    expect((await withdrawableBreakdown(db, l.walletId)).withdrawableCents).toBe(20_000); // sem a retenção de giro/72h
    expect((await reconcileAll()).ok).toBe(true);

    // o ex-líder saca pelo fluxo normal; como todo saque, ainda espera a liberação do admin
    const { withdrawalId } = await requestWithdrawal(l.user, { teamId: l.team.id, amountCents: 20_000, password: PASSWORD, nonce: nonce() });
    expect(await confirmWithdrawal(l.user, withdrawalId, lastOtp(await emailOf(l.user)))).toBe("under_review");
    await reviewWithdrawal(await admin(), withdrawalId, "approve", "Saldo de time excluído já liberado e conferido");
    expect((await db.withdrawal.findUniqueOrThrow({ where: { id: withdrawalId } })).status).toBe("APPROVED");
    expect((await balances(l.walletId)).available).toBe(0);
    expect((await reconcileAll()).ok).toBe(true);
    // e só o saque: depositar ou apostar continua barrado
    await expect(createDeposit(l.user, { teamId: l.team.id, amountCents: 1_000 })).rejects.toThrow(/excluída/);
  });

  it("não pede revisão sem saldo, nem depois de liberado", async () => {
    const empty = await makeLeader();
    await deleteTeam(empty.user, empty.team.id);
    await expect(requestBalanceReview(empty.user, empty.team.id, "Não há saldo, mas vou pedir mesmo assim")).rejects.toThrow(/Não há saldo/);

    const l = await deletedWithBalance();
    const req = await requestBalanceReview(l.user, l.team.id, "Encerramos o time; quero sacar o saldo para a minha conta.");
    await reviewBalanceRequest(await admin(), req.id, "approve", "Conferi tudo e o titular é o líder");
    await expect(requestBalanceReview(l.user, l.team.id, "Pedindo de novo depois de já liberado")).rejects.toThrow(/já foi liberado/);
  });

  it("Pix pago depois da exclusão não credita sozinho: fica retido para o admin", async () => {
    const l = await makeLeader();
    const dep = await createDeposit(l.user, { teamId: l.team.id, amountCents: 10_000 });
    await db.deposit.update({ where: { id: dep.id }, data: { status: "EXPIRED", expiresAt: new Date(Date.now() - 1000) } });
    await deleteTeam(l.user, l.team.id);

    const { rawBody, headers } = await mockPayCharge(dep.providerChargeId!, l.cpf);
    await handlePixWebhook(headers, rawBody);
    const held = await db.deposit.findUniqueOrThrow({ where: { id: dep.id } });
    expect(held.status).toBe("HELD");
    expect(held.holdReason).toMatch(/excluída/);
    expect((await balances(l.walletId)).available).toBe(0);

    await resolveHeldDeposit(await admin(), dep.id, "credit", "Pagamento legítimo do líder, conferido no banco");
    expect((await balances(l.walletId)).available).toBe(10_000); // entra, mas segue bloqueado até a liberação
    expect((await db.wallet.findUniqueOrThrow({ where: { id: l.walletId } })).frozenAt).not.toBeNull();
    expect((await reconcileAll()).ok).toBe(true);
  });

  it("desafiar um time excluído não funciona", async () => {
    const dead = await makeLeader();
    await deleteTeam(dead.user, dead.team.id);
    const l = await makeLeader();
    await fund(l, 5_000);
    await expect(createChallenge(l.user, { ...challengeInput(l), invitedTeamId: dead.team.id })).rejects.toThrow(/não encontrada/);
  });
});

describe("capitania gerida pelo admin", () => {
  it("o admin transfere a capitania de verdade: o capitão anterior deixa de ser líder", async () => {
    const l = await makeLeader();
    const member = await makeUser();
    await db.teamMember.create({ data: { teamId: l.team.id, userId: member.id, role: "PLAYER" } });
    const a = await newAdmin(); // nem é do time
    await setMemberRole(a, l.team.id, member.id, "CAPTAIN");
    const rows = await db.teamMember.findMany({ where: { teamId: l.team.id } });
    expect(rows.filter((m) => m.role === "CAPTAIN").map((m) => m.userId)).toEqual([member.id]); // um só líder
    expect(rows.find((m) => m.userId === l.user.id)!.role).toBe("PLAYER");
    expect((await db.team.findUniqueOrThrow({ where: { id: l.team.id } })).ownerId).toBe(member.id);
    // o líder antigo já não movimenta o dinheiro
    await expect(createDeposit(l.user, { teamId: l.team.id, amountCents: 1_000 })).rejects.toThrow(/líder/);
  });

  it("o admin não vira líder de time alheio, nem se convida; ninguém fica sem capitão", async () => {
    const l = await makeLeader();
    const a = await newAdmin();
    await expect(inviteToTeam(a, l.team.id, (await db.user.findUniqueOrThrow({ where: { id: a.id } })).username)).rejects.toThrow(/a si mesmo/);
    // mesmo que entre no time por outro caminho (membro comum), não pode se promover
    await db.teamMember.create({ data: { teamId: l.team.id, userId: a.id, role: "PLAYER" } });
    await expect(setMemberRole(a, l.team.id, a.id, "CAPTAIN")).rejects.toThrow(/Administradores não podem/);
    expect((await db.teamMember.findFirstOrThrow({ where: { teamId: l.team.id, userId: l.user.id } })).role).toBe("CAPTAIN");
    // rebaixar o único capitão sem transferir é recusado
    await expect(setMemberRole(l.user, l.team.id, l.user.id, "PLAYER")).rejects.toThrow(/transfira/);
  });
});

describe("liberação do saldo não apaga outras travas da carteira", () => {
  async function requested() {
    const l = await makeLeader();
    await fund(l, 20_000);
    return l;
  }

  it("recusa liberar quando a carteira já estava congelada por outro motivo antes da exclusão", async () => {
    const l = await requested();
    await db.wallet.update({ where: { id: l.walletId }, data: { frozenAt: new Date(Date.now() - 3600_000), frozenReason: "Suspeita de fraude no depósito" } });
    await deleteTeam(l.user, l.team.id);
    const req = await requestBalanceReview(l.user, l.team.id, "Encerramos o time; quero sacar o saldo para a minha conta.");
    await expect(reviewBalanceRequest(await admin(), req.id, "approve", "Conferi os documentos do titular")).rejects.toThrow(/já estava congelada.*Suspeita de fraude/);
    expect((await db.walletReleaseRequest.findUniqueOrThrow({ where: { id: req.id } })).status).toBe("PENDING"); // nada mudou
    expect((await db.team.findUniqueOrThrow({ where: { id: l.team.id } })).balanceReleasedAt).toBeNull();
    // o admin descongela de propósito (outro fluxo) e então a liberação passa
    await db.wallet.update({ where: { id: l.walletId }, data: { frozenAt: null, frozenReason: null } });
    expect((await reviewBalanceRequest(await admin(), req.id, "approve", "Fraude descartada; titular conferido")).approved).toBe(true);
  });

  it("recusa liberar com dívida de estorno na carteira", async () => {
    const l = await requested();
    await deleteTeam(l.user, l.team.id);
    const req = await requestBalanceReview(l.user, l.team.id, "Encerramos o time; quero sacar o saldo para a minha conta.");
    await db.wallet.update({ where: { id: l.walletId }, data: { debtCents: 5_000 } });
    await expect(reviewBalanceRequest(await admin(), req.id, "approve", "Conferi os documentos do titular")).rejects.toThrow(/dívida de R\$\s5\d,00|dívida/);
    expect((await db.walletReleaseRequest.findUniqueOrThrow({ where: { id: req.id } })).status).toBe("PENDING");
  });
});

