import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import type { LeaderboardSettings } from "@/engine";
import { audit } from "./audit";
import { assertTournamentAccess, requireActor } from "./permissions";
import { syncStage } from "./stage-runner";
import type { Actor } from "./types";

export interface BrRowInput {
  participantId: string;
  placement: number;
  kills: number;
}

/**
 * Lança (ou corrige) o resultado de uma partida de leaderboard. Valida colocações únicas e abates.
 * Depois dos resultados, o estágio gera a próxima rodada de lobbies automaticamente.
 * Se `fillMissing` estiver ativo, quem não apareceu recebe as últimas colocações com 0 abates.
 */
export async function submitBrResults(actorIn: Actor | null, brGameId: string, rows: BrRowInput[], opts: { fillMissing?: boolean; code?: string } = {}) {
  const actor = requireActor(actorIn);
  await db.$transaction(
    async (tx) => {
      const game = await tx.brGame.findUnique({ where: { id: brGameId }, include: { stage: { include: { tournament: true } } } });
      if (!game) throw new AppError("Partida não encontrada.", "NOT_FOUND");
      const t = game.stage.tournament;
      await assertTournamentAccess(actor, t, "staff", tx);
      if (t.status !== "LIVE") throw new AppError("O campeonato não está em andamento.");
      if (game.stage.status !== "LIVE" && game.stage.status !== "COMPLETED") throw new AppError("Esta fase não está em andamento.");
      const settings = game.stage.settings as unknown as LeaderboardSettings;
      const lobby = game.participantIds as unknown as string[];

      // só é possível editar a rodada mais recente
      const later = await tx.brGame.findMany({ where: { stageId: game.stageId, round: { gt: game.round } }, include: { results: true } });
      if (later.some((g) => g.results.length > 0)) throw new AppError("As rodadas seguintes já têm resultados. Corrija-as primeiro.");
      const nextStage = await tx.stage.findFirst({ where: { tournamentId: t.id, order: game.stage.order + 1 } });
      if (nextStage && nextStage.status !== "PENDING") throw new AppError("A próxima fase já começou; este resultado não pode mais ser alterado.");

      const known = new Set(lobby);
      const seen = new Set<string>();
      const placements = new Set<number>();
      for (const r of rows) {
        if (!known.has(r.participantId)) throw new AppError("Há participante que não pertence a este lobby.");
        if (seen.has(r.participantId)) throw new AppError("Participante repetido na lista.");
        seen.add(r.participantId);
        if (!Number.isInteger(r.placement) || r.placement < 1 || r.placement > Math.max(settings.lobbySize, lobby.length)) {
          throw new AppError(`Colocação inválida (use de 1 a ${Math.max(settings.lobbySize, lobby.length)}).`);
        }
        if (placements.has(r.placement)) throw new AppError(`A colocação ${r.placement} foi usada mais de uma vez.`);
        placements.add(r.placement);
        if (!Number.isInteger(r.kills) || r.kills < 0 || r.kills > 99) throw new AppError("Abates devem ser inteiros entre 0 e 99.");
      }
      let finalRows = rows;
      const missing = lobby.filter((id) => !seen.has(id));
      if (missing.length) {
        if (!opts.fillMissing) throw new AppError(`Faltam ${missing.length} participante(s) no lançamento. Informe todos ou use "preencher ausentes".`);
        let next = lobby.length;
        const used = new Set(placements);
        finalRows = [...rows];
        for (const id of missing) {
          while (used.has(next) && next > 0) next--;
          finalRows.push({ participantId: id, placement: next, kills: 0 });
          used.add(next);
          next--;
        }
      }
      await tx.brResult.deleteMany({ where: { gameId: game.id } });
      await tx.brResult.createMany({ data: finalRows.map((r) => ({ gameId: game.id, participantId: r.participantId, placement: r.placement, kills: r.kills })) });
      await tx.brGame.update({ where: { id: game.id }, data: { completedAt: new Date(), ...(opts.code !== undefined ? { code: opts.code } : {}) } });
      // rodadas seguintes planejadas (sem resultado) serão refeitas pelo estágio
      if (later.length) await tx.brGame.deleteMany({ where: { stageId: game.stageId, round: { gt: game.round } } });
      await syncStage(tx, game.stageId);
      await audit(actor.id, "br.results", "BrGame", game.id, { rows: finalRows.length }, tx);
    },
    { timeout: 30000 },
  );
}

export async function setBrGameCode(actorIn: Actor | null, brGameId: string, code: string) {
  const actor = requireActor(actorIn);
  const game = await db.brGame.findUnique({ where: { id: brGameId }, include: { stage: { include: { tournament: true } } } });
  if (!game) throw new AppError("Partida não encontrada.", "NOT_FOUND");
  await assertTournamentAccess(actor, game.stage.tournament, "staff");
  await db.brGame.update({ where: { id: game.id }, data: { code: code.trim().slice(0, 80) || null } });
}

export type { Prisma };
