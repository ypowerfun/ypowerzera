import type {
  Id,
  LeaderboardRow,
  LeaderboardScoring,
  LeaderboardSettings,
  LeaderboardTiebreaker,
} from "./types";
import { createRng, shuffle } from "./rng";
import { snakeDistribute } from "./seeding";

const round2 = (n: number) => Math.round(n * 100) / 100;

export function placementMultiplier(scoring: LeaderboardScoring, placement: number): number {
  const hit = scoring.placementMultipliers?.find((m) => placement >= m.from && placement <= m.to);
  return hit ? hit.multiplier : 1;
}

/**
 * Pontos de uma partida de battle royale.
 * - additive: pontos da colocação + abates × valor (Apex, Fortnite, TFT).
 * - multiplier: abates × multiplicador da colocação (Warzone: 1º = 2×, 2º–15º = 1,5×...).
 */
export function scoreGame(scoring: LeaderboardScoring, placement: number, kills: number): number {
  const bonus = placement === 1 ? (scoring.victoryBonus ?? 0) : 0;
  if (scoring.formula === "multiplier") {
    return round2(kills * scoring.killPoints * placementMultiplier(scoring, placement) + bonus);
  }
  const placementPts = scoring.placementPoints[placement - 1] ?? 0;
  return round2(placementPts + kills * scoring.killPoints + bonus);
}

export interface BrResultInput {
  round: number;
  lobby: number;
  participantId: Id;
  placement: number;
  kills: number;
}

export interface LeaderboardState {
  rows: LeaderboardRow[];
  champion: Id | null;
  /** Número da rodada em que o campeão foi definido (match point). */
  championRound: number | null;
  roundsPlayed: number;
  finished: boolean;
}

/**
 * Calcula a classificação geral do leaderboard.
 * `participants` deve estar na ordem de seed (usada como último desempate).
 * Com match point (ALGS 50 pts, TFT Checkmate 20), o campeão é quem vence uma partida
 * já tendo atingido o limite ANTES dela.
 */
export function computeLeaderboard(
  participants: readonly Id[],
  results: readonly BrResultInput[],
  settings: LeaderboardSettings,
): LeaderboardState {
  const seedIndex = new Map(participants.map((id, i) => [id, i]));
  const rounds = [...new Set(results.map((r) => r.round))].sort((a, b) => a - b);
  const totals = new Map<Id, number>(participants.map((id) => [id, 0]));
  const perGame = new Map<Id, LeaderboardRow["perGame"]>(participants.map((id) => [id, []]));

  let champion: Id | null = null;
  let championRound: number | null = null;

  for (const round of rounds) {
    const inRound = results.filter((r) => r.round === round);
    const lobbies = new Set(inRound.map((r) => r.lobby));

    // elegíveis ao match point = já tinham o limite antes desta rodada
    const eligibleBefore = new Set<Id>();
    if (settings.matchPoint) {
      for (const [id, t] of totals) if (t >= settings.matchPoint.threshold) eligibleBefore.add(id);
    }

    for (const r of inRound) {
      if (!totals.has(r.participantId)) continue;
      const pts = scoreGame(settings.scoring, r.placement, r.kills);
      totals.set(r.participantId, round2((totals.get(r.participantId) ?? 0) + pts));
      perGame.get(r.participantId)!.push({ round, placement: r.placement, kills: r.kills, points: pts });
    }

    if (settings.matchPoint && !champion && lobbies.size === 1) {
      const winner = inRound.find((r) => r.placement === 1);
      if (winner && eligibleBefore.has(winner.participantId)) {
        champion = winner.participantId;
        championRound = round;
      } else if (!settings.matchPoint.requireWin) {
        // sem exigência de vitória: quem atinge o limite encerra
        const reached = inRound.filter((r) => (totals.get(r.participantId) ?? 0) >= settings.matchPoint!.threshold);
        if (reached.length) {
          champion = reached.sort((x, y) => (totals.get(y.participantId)! - totals.get(x.participantId)!))[0].participantId;
          championRound = round;
        }
      }
    }
  }

  const rows: LeaderboardRow[] = participants.map((id) => {
    const games = perGame.get(id)!;
    const placements = games.map((g) => g.placement);
    const last = games.length ? games[games.length - 1] : null;
    return {
      participantId: id,
      rank: 0,
      points: totals.get(id) ?? 0,
      games: games.length,
      wins: games.filter((g) => g.placement === 1).length,
      kills: games.reduce((s, g) => s + g.kills, 0),
      bestPlacement: placements.length ? Math.min(...placements) : null,
      avgPlacement: placements.length ? round2(placements.reduce((s, p) => s + p, 0) / placements.length) : null,
      lastGamePlacement: last?.placement ?? null,
      lastGamePoints: last?.points ?? null,
      perGame: games,
      matchPointEligible: settings.matchPoint ? (totals.get(id) ?? 0) >= settings.matchPoint.threshold : false,
    };
  });

  const tiebreakers: LeaderboardTiebreaker[] = settings.tiebreakers.length ? settings.tiebreakers : ["points", "wins", "kills", "seed"];
  const cmp = (x: LeaderboardRow, y: LeaderboardRow): number => {
    if (champion) {
      if (x.participantId === champion) return -1;
      if (y.participantId === champion) return 1;
    }
    for (const t of tiebreakers) {
      let d = 0;
      switch (t) {
        case "points":
          d = y.points - x.points;
          break;
        case "wins":
          d = y.wins - x.wins;
          break;
        case "kills":
          d = y.kills - x.kills;
          break;
        case "bestPlacement":
          d = (x.bestPlacement ?? Infinity) - (y.bestPlacement ?? Infinity);
          break;
        case "avgPlacement":
          d = (x.avgPlacement ?? Infinity) - (y.avgPlacement ?? Infinity);
          break;
        case "lastGamePlacement":
          d = (x.lastGamePlacement ?? Infinity) - (y.lastGamePlacement ?? Infinity);
          break;
        case "lastGamePoints":
          d = (y.lastGamePoints ?? -Infinity) - (x.lastGamePoints ?? -Infinity);
          break;
        case "seed":
          d = (seedIndex.get(x.participantId) ?? 0) - (seedIndex.get(y.participantId) ?? 0);
          break;
      }
      if (d !== 0) return d;
    }
    return (seedIndex.get(x.participantId) ?? 0) - (seedIndex.get(y.participantId) ?? 0);
  };
  rows.sort(cmp);
  rows.forEach((r, i) => {
    r.rank = i + 1;
    if (champion && r.participantId === champion) r.champion = true;
  });

  const roundsPlayed = rounds.length;
  const finished = champion !== null || roundsPlayed >= settings.games;
  return { rows, champion, championRound, roundsPlayed, finished };
}

/**
 * Divide a ordem (seed ou classificação) em lobbies.
 * - single: um lobby só quando todos cabem.
 * - snake: distribui em cobra para equilibrar a força dos lobbies.
 * - swiss: lobbies consecutivos (os melhores jogam juntos) — usado no TFT; na rodada 1 usa snake.
 * - random: sorteio determinístico por rodada.
 * - fixed: igual à rodada 1 em todas as rodadas (quem chama passa a ordem de seeds).
 */
export function planLobbies(
  order: readonly Id[],
  lobbySize: number,
  assignment: LeaderboardSettings["lobbyAssignment"],
  round: number,
  salt: string,
): Id[][] {
  const n = order.length;
  const count = Math.max(1, Math.ceil(n / lobbySize));
  if (count === 1) return [[...order]];
  if (assignment === "random") {
    const shuffled = shuffle(order, createRng(`${salt}:${round}`));
    return snakeDistribute(shuffled, count);
  }
  if (assignment === "swiss" && round > 1) {
    const base = Math.floor(n / count);
    const extra = n % count;
    const out: Id[][] = [];
    let idx = 0;
    for (let l = 0; l < count; l++) {
      const size = base + (l < extra ? 1 : 0);
      out.push(order.slice(idx, idx + size) as Id[]);
      idx += size;
    }
    return out;
  }
  return snakeDistribute(order, count);
}
