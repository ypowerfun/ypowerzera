import { Prisma, type ReleaseStatus } from "@prisma/client";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { formatMoney } from "@/lib/money";
import { audit } from "./audit";
import { adminUserIds } from "./admins";
import { requireKyc } from "./kyc";
import { notify } from "./notifications";
import { requireActor, requireAdmin } from "./permissions";
import { rateLimit } from "./rate-limit";
import { assertWalletOn } from "./settings";
import { unfreezeWallet } from "./wallet";
import type { Actor } from "./types";

/**
 * Saldo de time EXCLUÍDO: fica bloqueado (carteira congelada). O ex-líder pede a revisão; um administrador
 * analisa e, se aprovar, libera o saldo para saque. O saque segue o fluxo normal (identidade verificada, senha,
 * código por e-mail, risco, liberação do admin) e só sai para o CPF do titular.
 */

/** O ex-líder pede ao administrador que revise e libere o saldo bloqueado do time excluído. */
export async function requestBalanceReview(actorIn: Actor | null, teamId: string, message: string) {
  await assertWalletOn();
  const actor = requireActor(actorIn);
  const text = (message ?? "").trim();
  if (text.length < 10 || text.length > 500) throw new AppError("Explique o pedido em 10 a 500 caracteres (ex.: para que conta o saque e por que o time foi excluído).");

  const team = await db.team.findUnique({ where: { id: teamId }, include: { members: true, wallet: true } });
  if (!team) throw new AppError("Equipe não encontrada.", "NOT_FOUND");
  if (!team.deletedAt) throw new AppError("Só equipes excluídas têm saldo bloqueado para revisão.");
  if (team.members.find((m) => m.userId === actor.id)?.role !== "CAPTAIN") throw new AppError("Somente o líder da equipe pode pedir a revisão do saldo.", "FORBIDDEN");
  if (team.balanceReleasedAt) throw new AppError("O saldo já foi liberado: peça o saque na Carteira.");
  const wallet = team.wallet;
  if (!wallet || wallet.balanceCents <= 0) throw new AppError("Não há saldo disponível para liberar.");
  await requireKyc(actor.id, "verified"); // o saque só vai para o CPF do titular verificado: confirme antes de ocupar o admin
  await rateLimit(`release-req:${actor.id}`, 5, 86400, "Você já fez vários pedidos hoje. Aguarde a análise do administrador.");

  const req = await db.$transaction(async (tx) => {
    const open = await tx.walletReleaseRequest.count({ where: { teamId, status: "PENDING" } });
    if (open > 0) throw new AppError("Já existe um pedido de revisão em análise para este time.", "CONFLICT");
    const r = await tx.walletReleaseRequest.create({ data: { teamId, walletId: wallet.id, requestedById: actor.id, message: text, balanceCents: wallet.balanceCents } });
    await audit(actor.id, "team.release.request", "WalletReleaseRequest", r.id, { teamId, balanceCents: wallet.balanceCents }, tx);
    await notify(await adminUserIds(tx), "team.release.request", "Pedido de liberação de saldo", `${actor.displayName ?? "O ex-líder"} pediu a revisão de ${formatMoney(wallet.balanceCents)} do time excluído ${team.name}.`, "/admin/saldos", tx);
    return r;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  return req;
}

/** Admin aprova (libera o saldo para saque) ou recusa o pedido. Quatro olhos: não pode ser do time nem o solicitante. */
export async function reviewBalanceRequest(actorIn: Actor | null, requestId: string, decision: "approve" | "reject", note: string) {
  const actor = requireActor(actorIn);
  requireAdmin(actor);
  const why = (note ?? "").trim();
  if (why.length < 10) throw new AppError("Escreva o que foi conferido ou o motivo (mínimo de 10 caracteres).");
  const req = await db.walletReleaseRequest.findUnique({ where: { id: requestId }, include: { team: { include: { members: true } } } });
  if (!req) throw new AppError("Pedido não encontrado.", "NOT_FOUND");
  if (req.status !== "PENDING") throw new AppError("Este pedido já foi analisado.", "CONFLICT");
  if (req.requestedById === actor.id || req.team.members.some((m) => m.userId === actor.id)) {
    throw new AppError("Conflito de interesse: você pertence a este time ou fez o pedido. Outro administrador precisa decidir.", "FORBIDDEN");
  }

  const now = new Date();
  const approved = decision === "approve";
  return db.$transaction(async (tx) => {
    const upd = await tx.walletReleaseRequest.updateMany({
      where: { id: req.id, status: "PENDING" },
      data: { status: (approved ? "APPROVED" : "REJECTED") as ReleaseStatus, reviewedById: actor.id, reviewedAt: now, reviewNote: why },
    });
    if (upd.count === 0) throw new AppError("Este pedido já foi analisado.", "CONFLICT");
    let releasedCents = 0;
    if (approved) {
      const wallet = await tx.wallet.findUniqueOrThrow({ where: { id: req.walletId } });
      const team = await tx.team.findUniqueOrThrow({ where: { id: req.teamId }, select: { deletedAt: true, balanceReleasedAt: true } });
      if (team.balanceReleasedAt) throw new AppError("O saldo deste time já foi liberado.", "CONFLICT");
      // Estas travas não nascem da exclusão: liberar o saldo não pode apagá-las por tabela. O admin as resolve antes, de propósito.
      if (wallet.debtCents > 0) throw new AppError(`A carteira tem uma dívida de ${formatMoney(wallet.debtCents)} (estorno de depósito). Resolva-a antes de liberar o saldo.`);
      if (wallet.frozenAt && team.deletedAt && wallet.frozenAt < team.deletedAt) {
        throw new AppError(`A carteira já estava congelada antes de o time ser excluído (${wallet.frozenReason ?? "sem motivo registrado"}). Descongele-a em Carteiras e conciliação, se for o caso, e só então libere o saldo.`);
      }
      releasedCents = wallet.balanceCents;
      await tx.walletReleaseRequest.update({ where: { id: req.id }, data: { releasedCents } });
      await tx.team.update({ where: { id: req.teamId }, data: { balanceReleasedAt: now } });
      await unfreezeWallet(tx, req.walletId);
    }
    await audit(actor.id, approved ? "team.release.approve" : "team.release.reject", "WalletReleaseRequest", req.id, { teamId: req.teamId, releasedCents, note: why }, tx);
    await notify(
      req.requestedById,
      "team.release.review",
      approved ? "Saldo liberado para saque" : "Pedido de liberação recusado",
      approved ? `O administrador liberou ${formatMoney(releasedCents)} do time ${req.team.name}. Peça o saque na Carteira.` : `Motivo: ${why}`,
      "/carteira",
      tx,
    );
    return { approved, releasedCents };
  });
}

export async function listReleaseRequests(actorIn: Actor | null, status?: ReleaseStatus) {
  const actor = requireActor(actorIn);
  requireAdmin(actor);
  const rows = await db.walletReleaseRequest.findMany({ where: status ? { status } : {}, orderBy: { createdAt: status === "PENDING" ? "asc" : "desc" }, take: 100, include: { team: { include: { wallet: true } } } });
  const users = await db.user.findMany({ where: { id: { in: [...new Set(rows.flatMap((r) => [r.requestedById, r.reviewedById].filter((x): x is string => !!x)))] } }, select: { id: true, username: true, displayName: true } });
  const by = new Map(users.map((u) => [u.id, u]));
  return rows.map((r) => ({ ...r, requester: by.get(r.requestedById) ?? null, reviewer: r.reviewedById ? (by.get(r.reviewedById) ?? null) : null }));
}

/** O pedido mais recente do time (para a tela da carteira do time excluído). */
export async function latestReleaseRequest(teamId: string) {
  return db.walletReleaseRequest.findFirst({ where: { teamId }, orderBy: { createdAt: "desc" } });
}
