import type { Id, MatchResult, PointsRule, StandingRow, TiebreakCriterion } from "./types";

export interface TableMatch {
  a: Id;
  /** null = BYE (vitória automática para `a`). */
  b: Id | null;
  result: MatchResult | null;
  group?: number | null;
}

export interface TableOptions {
  points: PointsRule;
  tiebreakers: TiebreakCriterion[];
}

interface Stats {
  played: number;
  wins: number;
  draws: number;
  losses: number;
  points: number;
  scoreFor: number;
  scoreAgainst: number;
}

const emptyStats = (): Stats => ({ played: 0, wins: 0, draws: 0, losses: 0, points: 0, scoreFor: 0, scoreAgainst: 0 });

function applyMatch(stats: Map<Id, Stats>, m: TableMatch, rule: PointsRule) {
  const sa = stats.get(m.a);
  if (!sa) return;
  if (m.b === null) {
    sa.played++;
    sa.wins++;
    sa.points += rule.win;
    return;
  }
  const sb = stats.get(m.b);
  if (!sb || !m.result) return;
  const { scoreA, scoreB, winner } = m.result;
  sa.played++;
  sb.played++;
  sa.scoreFor += scoreA;
  sa.scoreAgainst += scoreB;
  sb.scoreFor += scoreB;
  sb.scoreAgainst += scoreA;
  if (winner === "a") {
    sa.wins++;
    sb.losses++;
    sa.points += rule.win;
    sb.points += rule.loss;
  } else if (winner === "b") {
    sb.wins++;
    sa.losses++;
    sb.points += rule.win;
    sa.points += rule.loss;
  } else {
    sa.draws++;
    sb.draws++;
    sa.points += rule.draw;
    sb.points += rule.draw;
  }
}

export function computeStats(participants: readonly Id[], matches: readonly TableMatch[], rule: PointsRule): Map<Id, Stats> {
  const stats = new Map<Id, Stats>();
  for (const id of participants) stats.set(id, emptyStats());
  for (const m of matches) {
    if (m.b !== null && !m.result) continue;
    applyMatch(stats, m, rule);
  }
  return stats;
}

/** Soma dos pontos dos adversários enfrentados (sistema Buchholz). Byes não contam. */
export function computeBuchholz(
  participants: readonly Id[],
  matches: readonly TableMatch[],
  stats: Map<Id, Stats>,
): Map<Id, number> {
  const out = new Map<Id, number>();
  for (const id of participants) out.set(id, 0);
  for (const m of matches) {
    if (m.b === null || !m.result) continue;
    out.set(m.a, (out.get(m.a) ?? 0) + (stats.get(m.b)?.points ?? 0));
    out.set(m.b, (out.get(m.b) ?? 0) + (stats.get(m.a)?.points ?? 0));
  }
  return out;
}

/**
 * Classifica `ids` aplicando os critérios em cadeia. Em empate, o próximo critério desempata
 * apenas o subgrupo empatado; critérios "h2h" consideram só os confrontos entre os empatados.
 * O último desempate é sempre o seed (ordem original).
 */
function rankByCriteria(
  ids: Id[],
  criteria: TiebreakCriterion[],
  ctx: {
    stats: Map<Id, Stats>;
    buchholz: Map<Id, number>;
    matches: readonly TableMatch[];
    rule: PointsRule;
    seedIndex: Map<Id, number>;
  },
): Id[] {
  if (ids.length <= 1) return ids;
  if (criteria.length === 0) return ids.slice().sort((x, y) => (ctx.seedIndex.get(x) ?? 0) - (ctx.seedIndex.get(y) ?? 0));
  const [criterion, ...rest] = criteria;

  const value = (id: Id): number => {
    const s = ctx.stats.get(id)!;
    switch (criterion) {
      case "points":
        return s.points;
      case "wins":
        return s.wins;
      case "diff":
        return s.scoreFor - s.scoreAgainst;
      case "scoreFor":
        return s.scoreFor;
      case "buchholz":
        return ctx.buchholz.get(id) ?? 0;
      case "seed":
        return -(ctx.seedIndex.get(id) ?? 0);
      default:
        return 0;
    }
  };

  let values: Map<Id, number>;
  if (criterion === "h2hPoints" || criterion === "h2hDiff" || criterion === "h2hScore") {
    const set = new Set(ids);
    const sub = computeStats(
      ids,
      ctx.matches.filter((m) => m.b !== null && set.has(m.a) && set.has(m.b)),
      ctx.rule,
    );
    values = new Map(
      ids.map((id) => {
        const s = sub.get(id)!;
        const v = criterion === "h2hPoints" ? s.points : criterion === "h2hDiff" ? s.scoreFor - s.scoreAgainst : s.scoreFor;
        return [id, v];
      }),
    );
  } else {
    values = new Map(ids.map((id) => [id, value(id)]));
  }

  const sorted = ids.slice().sort((x, y) => {
    const d = values.get(y)! - values.get(x)!;
    if (d !== 0) return d;
    return (ctx.seedIndex.get(x) ?? 0) - (ctx.seedIndex.get(y) ?? 0);
  });

  const out: Id[] = [];
  let i = 0;
  while (i < sorted.length) {
    let j = i + 1;
    while (j < sorted.length && values.get(sorted[j]) === values.get(sorted[i])) j++;
    const bucket = sorted.slice(i, j);
    out.push(...(bucket.length > 1 ? rankByCriteria(bucket, rest, ctx) : bucket));
    i = j;
  }
  return out;
}

/** Tabela de classificação de um conjunto de participantes (um grupo, um Swiss, uma liga...). */
export function computeTable(participants: readonly Id[], matches: readonly TableMatch[], opts: TableOptions): StandingRow[] {
  const stats = computeStats(participants, matches, opts.points);
  const buchholz = computeBuchholz(participants, matches, stats);
  const seedIndex = new Map(participants.map((id, i) => [id, i]));
  const criteria = opts.tiebreakers.length ? opts.tiebreakers : (["points", "h2hPoints", "diff", "scoreFor"] as TiebreakCriterion[]);
  const ordered = rankByCriteria([...participants], criteria, {
    stats,
    buchholz,
    matches,
    rule: opts.points,
    seedIndex,
  });
  return ordered.map((id, i) => {
    const s = stats.get(id)!;
    return {
      participantId: id,
      rank: i + 1,
      played: s.played,
      wins: s.wins,
      draws: s.draws,
      losses: s.losses,
      points: s.points,
      scoreFor: s.scoreFor,
      scoreAgainst: s.scoreAgainst,
      diff: s.scoreFor - s.scoreAgainst,
      buchholz: buchholz.get(id) ?? 0,
    };
  });
}

/**
 * Classificação por grupos. `rank` é a posição geral entre todos os grupos: primeiro todos os
 * 1ºs colocados (ordenados por pontos/saldo), depois os 2ºs, e assim por diante.
 */
export function computeGroupTables(
  groups: readonly (readonly Id[])[],
  matches: readonly TableMatch[],
  opts: TableOptions,
  seedOrder: readonly Id[],
): StandingRow[] {
  const seedIndex = new Map(seedOrder.map((id, i) => [id, i]));
  const rows: StandingRow[] = [];
  groups.forEach((members, gi) => {
    const set = new Set(members);
    const groupMatches = matches.filter((m) => set.has(m.a));
    const ordered = [...members].sort((x, y) => (seedIndex.get(x) ?? 0) - (seedIndex.get(y) ?? 0));
    computeTable(ordered, groupMatches, opts).forEach((row) => {
      rows.push({ ...row, group: gi + 1, groupRank: row.rank });
    });
  });
  rows.sort((x, y) => {
    if (x.groupRank !== y.groupRank) return x.groupRank! - y.groupRank!;
    if (y.points !== x.points) return y.points - x.points;
    if (y.diff !== x.diff) return y.diff - x.diff;
    if (y.scoreFor !== x.scoreFor) return y.scoreFor - x.scoreFor;
    return (seedIndex.get(x.participantId) ?? 0) - (seedIndex.get(y.participantId) ?? 0);
  });
  return rows.map((r, i) => ({ ...r, rank: i + 1 }));
}
