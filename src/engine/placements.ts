import type { Id, MatchSpec, ResolvedMatch, StandingRow } from "./types";

export type EliminationKind = "SINGLE" | "DOUBLE";

function emptyRow(id: Id): StandingRow {
  return { participantId: id, rank: 0, played: 0, wins: 0, draws: 0, losses: 0, points: 0, scoreFor: 0, scoreAgainst: 0, diff: 0 };
}

/**
 * Colocação final de uma chave eliminatória. Quem caiu na mesma rodada empata na mesma posição
 * (ex.: os 4 perdedores das quartas dividem o 5º lugar), exceto onde há disputa de 3º lugar.
 */
export function eliminationStandings(
  kind: EliminationKind,
  participants: readonly Id[],
  specs: readonly MatchSpec[],
  resolved: Map<string, ResolvedMatch>,
): StandingRow[] {
  const rows = new Map<Id, StandingRow>(participants.map((id) => [id, emptyRow(id)]));
  const seedIndex = new Map(participants.map((id, i) => [id, i]));
  const lossOrder = new Map<Id, number>();

  const orderOf = (spec: MatchSpec): number => {
    if (kind === "SINGLE") return spec.round;
    if (spec.bracket === "GF") return 1000 + spec.round;
    if (spec.bracket === "L") return spec.round;
    return 0;
  };

  let finalKey: string | null = null;
  let thirdKey: string | null = null;
  const lastRound = Math.max(0, ...specs.filter((s) => s.bracket === "W").map((s) => s.round));
  if (kind === "SINGLE") finalKey = `W${lastRound}-1`;
  else {
    const gf2 = resolved.get("GF-2");
    finalKey = gf2 && gf2.status !== "skipped" ? "GF-2" : "GF-1";
  }
  if (specs.some((s) => s.key === "T-1")) thirdKey = "T-1";

  for (const spec of specs) {
    const r = resolved.get(spec.key);
    if (!r || r.status !== "completed" || !r.result) continue;
    const a = r.entrantA.kind === "participant" ? r.entrantA.id : null;
    const b = r.entrantB.kind === "participant" ? r.entrantB.id : null;
    if (!a || !b) continue;
    const ra = rows.get(a);
    const rb = rows.get(b);
    if (!ra || !rb) continue;
    ra.played++;
    rb.played++;
    ra.scoreFor += r.result.scoreA;
    ra.scoreAgainst += r.result.scoreB;
    rb.scoreFor += r.result.scoreB;
    rb.scoreAgainst += r.result.scoreA;
    const winner = r.winner.kind === "participant" ? r.winner.id : null;
    const loser = r.loser.kind === "participant" ? r.loser.id : null;
    if (winner) rows.get(winner)!.wins++;
    if (loser) {
      rows.get(loser)!.losses++;
      if (spec.key !== thirdKey) {
        lossOrder.set(loser, Math.max(lossOrder.get(loser) ?? 0, orderOf(spec)));
      }
    }
  }
  for (const row of rows.values()) row.diff = row.scoreFor - row.scoreAgainst;

  const finalMatch = finalKey ? resolved.get(finalKey) : undefined;
  const champion = finalMatch?.status === "completed" && finalMatch.winner.kind === "participant" ? finalMatch.winner.id : null;
  const runnerUp = finalMatch?.status === "completed" && finalMatch.loser.kind === "participant" ? finalMatch.loser.id : null;

  // Ordenação: campeão, vice, depois por ordem de eliminação (mais tarde = melhor), depois seed.
  const third = thirdKey ? resolved.get(thirdKey) : undefined;
  const thirdPlayed = third?.status === "completed";
  const thirdWinner = thirdPlayed && third!.winner.kind === "participant" ? third!.winner.id : null;
  const thirdLoser = thirdPlayed && third!.loser.kind === "participant" ? third!.loser.id : null;

  const finished = champion !== null;
  const buckets = new Map<number, Id[]>();
  const fixed = new Map<Id, number>();
  if (champion) fixed.set(champion, 1);
  if (runnerUp) fixed.set(runnerUp, 2);
  if (thirdWinner) fixed.set(thirdWinner, 3);
  if (thirdLoser) fixed.set(thirdLoser, 4);

  for (const id of participants) {
    if (fixed.has(id)) continue;
    // Participantes ainda vivos (chave em andamento) ficam acima de quem já caiu
    const order = finished || lossOrder.has(id) ? (lossOrder.get(id) ?? 0) : Number.MAX_SAFE_INTEGER;
    if (!buckets.has(order)) buckets.set(order, []);
    buckets.get(order)!.push(id);
  }
  // posições fixas ocupam 1..k; sem disputa de 3º lugar, os demais continuam a partir do 3º
  let nextRank = 1 + fixed.size;
  const orders = [...buckets.keys()].sort((a, b) => b - a);
  const out: StandingRow[] = [];
  for (const [id, rank] of [...fixed.entries()].sort((a, b) => a[1] - b[1])) {
    out.push({ ...rows.get(id)!, rank });
  }
  for (const o of orders) {
    const ids = buckets.get(o)!.sort((x, y) => (seedIndex.get(x) ?? 0) - (seedIndex.get(y) ?? 0));
    for (const id of ids) out.push({ ...rows.get(id)!, rank: nextRank, tied: ids.length > 1 });
    nextRank += ids.length;
  }
  return out;
}
