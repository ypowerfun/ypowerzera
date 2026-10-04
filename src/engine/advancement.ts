import type { Advancement, Id, StandingRow } from "./types";
import { bracketOrder, nextPowerOfTwo } from "./seeding";

/**
 * Escolhe quem avança de um estágio para o seguinte, já na ordem de seed do próximo estágio.
 *
 * - `count`: os N melhores da classificação geral.
 * - `perGroup`: os K melhores de cada grupo. A ordem de seed é por "faixas" (todos os 1ºs, depois
 *   todos os 2ºs...) e, em seguida, corrigida para que ninguém enfrente o colega de grupo na
 *   1ª rodada da próxima chave (cruzamento de grupos, como no VCT).
 */
export function selectAdvancing(rows: readonly StandingRow[], adv: Advancement | undefined): Id[] {
  if (!adv || (adv.count === undefined && adv.perGroup === undefined)) return rows.map((r) => r.participantId);

  if (adv.perGroup !== undefined) {
    const picked = rows.filter((r) => (r.groupRank ?? r.rank) <= adv.perGroup!);
    const tiers = new Map<number, StandingRow[]>();
    for (const r of picked) {
      const t = r.groupRank ?? r.rank;
      if (!tiers.has(t)) tiers.set(t, []);
      tiers.get(t)!.push(r);
    }
    const ordered: StandingRow[] = [];
    for (const t of [...tiers.keys()].sort((a, b) => a - b)) {
      ordered.push(...tiers.get(t)!.sort((x, y) => x.rank - y.rank));
    }
    return separateGroups(ordered);
  }

  return rows
    .slice()
    .sort((x, y) => x.rank - y.rank)
    .slice(0, adv.count)
    .map((r) => r.participantId);
}

/** Troca participantes da mesma faixa para evitar confrontos entre colegas de grupo na 1ª rodada. */
export function separateGroups(ordered: StandingRow[]): Id[] {
  const n = ordered.length;
  const list = ordered.slice();
  if (n < 4) return list.map((r) => r.participantId);
  const size = nextPowerOfTwo(n);
  const order = bracketOrder(size);
  const pairs: Array<[number, number]> = [];
  for (let i = 0; i < size; i += 2) {
    const a = order[i] - 1;
    const b = order[i + 1] - 1;
    if (a < n && b < n) pairs.push([a, b]);
  }
  const tierOf = (i: number) => list[i].groupRank ?? list[i].rank;
  const conflicts = () => pairs.filter(([a, b]) => list[a].group != null && list[a].group === list[b].group);

  for (let attempt = 0; attempt < 50; attempt++) {
    const bad = conflicts();
    if (bad.length === 0) break;
    let improved = false;
    for (const [a, b] of bad) {
      // tenta trocar b (ou a) por outro da mesma faixa que resolva sem criar novo conflito
      for (const target of [b, a]) {
        for (let j = 0; j < n; j++) {
          if (j === target || tierOf(j) !== tierOf(target)) continue;
          const before = conflicts().length;
          [list[target], list[j]] = [list[j], list[target]];
          if (conflicts().length < before) {
            improved = true;
            break;
          }
          [list[target], list[j]] = [list[j], list[target]];
        }
        if (improved) break;
      }
      if (improved) break;
    }
    if (!improved) break;
  }
  return list.map((r) => r.participantId);
}
