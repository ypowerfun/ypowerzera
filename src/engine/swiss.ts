import type { Id, MatchResult, MatchSpec, ResolvedMatch, StandingRow, SwissSettings } from "./types";
import { computeTable, type TableMatch } from "./standings";

export interface SwissRecord {
  a: Id;
  /** null = BYE */
  b: Id | null;
  round: number;
  result: MatchResult | null;
}

export interface SwissPlayer {
  id: Id;
  seedIndex: number;
  wins: number;
  losses: number;
  draws: number;
  points: number;
  hadBye: boolean;
  opponents: Id[];
  buchholz: number;
}

/** Converte specs + estado resolvido nos registros que o Swiss entende. */
export function swissRecords(specs: readonly MatchSpec[], resolved: Map<string, ResolvedMatch>): SwissRecord[] {
  const out: SwissRecord[] = [];
  for (const spec of specs) {
    const r = resolved.get(spec.key);
    if (!r) continue;
    const a = r.entrantA.kind === "participant" ? r.entrantA.id : null;
    const b = r.entrantB.kind === "participant" ? r.entrantB.id : null;
    if (r.status === "bye") {
      const who = a ?? b;
      if (who) out.push({ a: who, b: null, round: spec.round, result: null });
    } else if (a && b) {
      out.push({ a, b, round: spec.round, result: r.status === "completed" ? r.result : null });
    }
  }
  return out;
}

export function swissMaxRounds(n: number, s: SwissSettings): number {
  if (s.mode === "winLoss") return (s.winsToAdvance ?? 3) + (s.lossesToEliminate ?? 3) - 1;
  return s.rounds ?? Math.max(1, Math.ceil(Math.log2(Math.max(2, n))));
}

export function computeSwissState(participants: readonly Id[], records: readonly SwissRecord[], s: SwissSettings): Map<Id, SwissPlayer> {
  const map = new Map<Id, SwissPlayer>();
  participants.forEach((id, i) =>
    map.set(id, { id, seedIndex: i, wins: 0, losses: 0, draws: 0, points: 0, hadBye: false, opponents: [], buchholz: 0 }),
  );
  for (const r of records) {
    const pa = map.get(r.a);
    if (!pa) continue;
    if (r.b === null) {
      pa.hadBye = true;
      pa.wins++;
      pa.points += s.points.win;
      continue;
    }
    const pb = map.get(r.b);
    if (!pb) continue;
    // adversários contam desde que a partida foi sorteada (evita revanche), mesmo sem resultado
    pa.opponents.push(pb.id);
    pb.opponents.push(pa.id);
    if (!r.result) continue;
    if (r.result.winner === "a") {
      pa.wins++;
      pb.losses++;
      pa.points += s.points.win;
      pb.points += s.points.loss;
    } else if (r.result.winner === "b") {
      pb.wins++;
      pa.losses++;
      pb.points += s.points.win;
      pa.points += s.points.loss;
    } else {
      pa.draws++;
      pb.draws++;
      pa.points += s.points.draw;
      pb.points += s.points.draw;
    }
  }
  for (const p of map.values()) {
    p.buchholz = p.opponents.reduce((sum, o) => sum + (map.get(o)?.points ?? 0), 0);
  }
  return map;
}

export function swissDecision(p: SwissPlayer, s: SwissSettings): "advanced" | "eliminated" | "active" {
  if (s.mode !== "winLoss") return "active";
  if (p.wins >= (s.winsToAdvance ?? 3)) return "advanced";
  if (p.losses >= (s.lossesToEliminate ?? 3)) return "eliminated";
  return "active";
}

function rankKey(a: SwissPlayer, b: SwissPlayer): number {
  if (b.points !== a.points) return b.points - a.points;
  if (b.buchholz !== a.buchholz) return b.buchholz - a.buchholz;
  return a.seedIndex - b.seedIndex;
}

const NODE_LIMIT = 200_000;

/**
 * Pareia jogadores ordenados por ranking. Regras:
 *  1. ninguém repete adversário (se for possível evitar);
 *  2. prefere adversários do mesmo grupo de pontuação; sobra desce para o grupo seguinte;
 *  3. dentro do grupo: "slide" (metade de cima × metade de baixo, 1×9 no R1) ou "fold" (melhor × pior).
 * Usa busca com retrocesso; se não houver pareamento sem revanche, permite revanche.
 */
export function pairPlayers(
  ranked: readonly SwissPlayer[],
  groupKey: (p: SwissPlayer) => string,
  style: "slide" | "fold",
): Array<[SwissPlayer, SwissPlayer]> {
  const solve = (allowRematch: boolean): Array<[SwissPlayer, SwissPlayer]> | null => {
    let nodes = 0;
    const rec = (remaining: SwissPlayer[]): Array<[SwissPlayer, SwissPlayer]> | null => {
      if (remaining.length === 0) return [];
      if (++nodes > NODE_LIMIT) return null;
      const p = remaining[0];
      const rest = remaining.slice(1);
      const key = groupKey(p);
      const sameIdx: number[] = [];
      const otherIdx: number[] = [];
      rest.forEach((c, i) => (groupKey(c) === key ? sameIdx : otherIdx).push(i));
      const ordered: number[] = [];
      if (style === "fold") {
        ordered.push(...sameIdx.slice().reverse());
      } else {
        const g = sameIdx.length + 1;
        const start = Math.min(Math.floor(g / 2) - 1, sameIdx.length - 1);
        if (sameIdx.length > 0) {
          const s0 = Math.max(0, start);
          for (let k = s0; k < sameIdx.length; k++) ordered.push(sameIdx[k]);
          for (let k = s0 - 1; k >= 0; k--) ordered.push(sameIdx[k]);
        }
      }
      ordered.push(...otherIdx);
      for (const i of ordered) {
        const c = rest[i];
        if (!allowRematch && p.opponents.includes(c.id)) continue;
        const sub = rec(rest.filter((_, j) => j !== i));
        if (sub) return [[p, c], ...sub];
        if (nodes > NODE_LIMIT) return null;
      }
      return null;
    };
    return rec([...ranked]);
  };
  return solve(false) ?? solve(true) ?? greedy(ranked);
}

function greedy(ranked: readonly SwissPlayer[]): Array<[SwissPlayer, SwissPlayer]> {
  const out: Array<[SwissPlayer, SwissPlayer]> = [];
  for (let i = 0; i + 1 < ranked.length; i += 2) out.push([ranked[i], ranked[i + 1]]);
  return out;
}

export type NextSwissRound =
  | { done: true }
  | { done: false; round: number; specs: MatchSpec[] };

/**
 * Gera a próxima rodada do Swiss. Pré-condição: todas as partidas da rodada anterior estão encerradas.
 */
export function generateNextSwissRound(
  participants: readonly Id[],
  specs: readonly MatchSpec[],
  resolved: Map<string, ResolvedMatch>,
  s: SwissSettings,
): NextSwissRound {
  const records = swissRecords(specs, resolved);
  const state = computeSwissState(participants, records, s);
  const lastRound = specs.reduce((m, x) => Math.max(m, x.round), 0);
  const round = lastRound + 1;
  const maxRounds = swissMaxRounds(participants.length, s);
  if (round > maxRounds) return { done: true };

  const active = [...state.values()].filter((p) => swissDecision(p, s) === "active");
  if (active.length === 0) return { done: true };
  if (s.mode === "winLoss" && active.length < 1) return { done: true };

  const ranked = active.sort(rankKey);
  const style: "slide" | "fold" = round === 1 || s.mode === "rounds" ? "slide" : "fold";
  const groupKey = (p: SwissPlayer) => (s.mode === "winLoss" ? `${p.wins}-${p.losses}` : String(p.points));

  // BYE para o pior ranqueado que ainda não tenha recebido bye (se houver número ímpar)
  let byePlayer: SwissPlayer | null = null;
  let pairs: Array<[SwissPlayer, SwissPlayer]>;
  if (ranked.length % 2 === 1) {
    const candidates = [...ranked].reverse();
    const sorted = [...candidates.filter((c) => !c.hadBye), ...candidates.filter((c) => c.hadBye)];
    byePlayer = sorted[0];
    pairs = pairPlayers(
      ranked.filter((p) => p.id !== byePlayer!.id),
      groupKey,
      style,
    );
  } else {
    pairs = pairPlayers(ranked, groupKey, style);
  }

  const decisiveBo = s.decisiveBestOf ?? s.bestOf;
  const isDecisive = (p: SwissPlayer) =>
    s.mode === "winLoss" && (p.wins === (s.winsToAdvance ?? 3) - 1 || p.losses === (s.lossesToEliminate ?? 3) - 1);

  const out: MatchSpec[] = pairs.map(([x, y], i) => ({
    key: `S${round}-${i + 1}`,
    bracket: "SWISS",
    round,
    position: i + 1,
    group: null,
    bestOf: isDecisive(x) || isDecisive(y) ? decisiveBo : s.bestOf,
    a: { kind: "participant", id: x.id },
    b: { kind: "participant", id: y.id },
  }));
  if (byePlayer) {
    out.push({
      key: `S${round}-${out.length + 1}`,
      bracket: "SWISS",
      round,
      position: out.length + 1,
      group: null,
      bestOf: s.bestOf,
      a: { kind: "participant", id: byePlayer.id },
      b: { kind: "bye" },
    });
  }
  return { done: false, round, specs: out };
}

/** Classificação do Swiss (na ordem: classificados, ativos, eliminados — ou tabela por pontos). */
export function swissStandings(participants: readonly Id[], records: readonly SwissRecord[], s: SwissSettings): StandingRow[] {
  const state = computeSwissState(participants, records, s);
  const tableMatches: TableMatch[] = records.map((r) => ({ a: r.a, b: r.b, result: r.result }));
  const base = computeTable(participants, tableMatches, {
    points: s.points,
    tiebreakers: s.tiebreakers.length ? s.tiebreakers : ["points", "buchholz", "diff"],
  });
  const withState = base.map((row) => ({ ...row, state: swissDecision(state.get(row.participantId)!, s) }));
  if (s.mode !== "winLoss") return withState;
  const order = { advanced: 0, active: 1, eliminated: 2 } as const;
  const sorted = [...withState].sort((x, y) => {
    if (order[x.state!] !== order[y.state!]) return order[x.state!] - order[y.state!];
    if (y.wins !== x.wins) return y.wins - x.wins;
    if (x.losses !== y.losses) return x.losses - y.losses;
    return x.rank - y.rank;
  });
  return sorted.map((r, i) => ({ ...r, rank: i + 1 }));
}
