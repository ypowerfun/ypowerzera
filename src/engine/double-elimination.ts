import type { BestOfRules, Id, MatchSpec } from "./types";
import { nextPowerOfTwo } from "./seeding";
import { bestOfForRound } from "./series";
import { firstRoundSlots, roleForRound } from "./single-elimination";

export interface DoubleEliminationOptions {
  bestOf: BestOfRules;
  grandFinalReset: boolean;
}

/**
 * Para evitar revanches precoces, os perdedores que "caem" para a chave inferior entram em ordem
 * invertida (rodadas ímpares) ou com as metades trocadas (rodadas pares).
 */
function dropIndex(k: number, i: number, m: number): number {
  if (m === 1) return 1;
  if (k % 2 === 1) return m - i + 1;
  return ((i - 1 + m / 2) % m) + 1;
}

/**
 * Dupla eliminação: chave dos vencedores (W), chave dos perdedores (L) e grande final (GF),
 * com reset opcional (o campeão da chave inferior precisa vencer duas vezes).
 */
export function generateDoubleElimination(seeds: readonly Id[], opts: DoubleEliminationOptions): MatchSpec[] {
  const n = seeds.length;
  if (n < 3) throw new Error("A dupla eliminação exige ao menos 3 participantes.");
  const size = nextPowerOfTwo(n);
  const R = Math.log2(size);
  const specs: MatchSpec[] = [];
  const slots = firstRoundSlots(seeds, size);

  // ── Chave dos vencedores
  for (let i = 1; i <= size / 2; i++) {
    specs.push({
      key: `W1-${i}`,
      bracket: "W",
      round: 1,
      position: i,
      group: null,
      bestOf: bestOfForRound(opts.bestOf, roleForRound(1, R)),
      a: slots[2 * i - 2],
      b: slots[2 * i - 1],
    });
  }
  for (let r = 2; r <= R; r++) {
    for (let i = 1; i <= size / 2 ** r; i++) {
      specs.push({
        key: `W${r}-${i}`,
        bracket: "W",
        round: r,
        position: i,
        group: null,
        bestOf: bestOfForRound(opts.bestOf, roleForRound(r, R)),
        a: { kind: "winner", match: `W${r - 1}-${2 * i - 1}` },
        b: { kind: "winner", match: `W${r - 1}-${2 * i}` },
      });
    }
  }

  // ── Chave dos perdedores
  const lbRounds = 2 * (R - 1);
  const lbRole = (round: number) => roleForRound(round, lbRounds);
  for (let i = 1; i <= size / 4; i++) {
    specs.push({
      key: `L1-${i}`,
      bracket: "L",
      round: 1,
      position: i,
      group: null,
      bestOf: bestOfForRound(opts.bestOf, lbRole(1)),
      a: { kind: "loser", match: `W1-${2 * i - 1}` },
      b: { kind: "loser", match: `W1-${2 * i}` },
    });
  }
  for (let k = 1; k <= R - 1; k++) {
    const m = size / 2 ** (k + 1);
    const dropRound = 2 * k;
    for (let i = 1; i <= m; i++) {
      specs.push({
        key: `L${dropRound}-${i}`,
        bracket: "L",
        round: dropRound,
        position: i,
        group: null,
        bestOf: bestOfForRound(opts.bestOf, lbRole(dropRound)),
        a: { kind: "winner", match: `L${dropRound - 1}-${i}` },
        b: { kind: "loser", match: `W${k + 1}-${dropIndex(k, i, m)}` },
      });
    }
    if (k < R - 1) {
      const advRound = 2 * k + 1;
      for (let i = 1; i <= m / 2; i++) {
        specs.push({
          key: `L${advRound}-${i}`,
          bracket: "L",
          round: advRound,
          position: i,
          group: null,
          bestOf: bestOfForRound(opts.bestOf, lbRole(advRound)),
          a: { kind: "winner", match: `L${dropRound}-${2 * i - 1}` },
          b: { kind: "winner", match: `L${dropRound}-${2 * i}` },
        });
      }
    }
  }

  // ── Grande final
  const finalBestOf = bestOfForRound(opts.bestOf, "final");
  specs.push({
    key: "GF-1",
    bracket: "GF",
    round: 1,
    position: 1,
    group: null,
    bestOf: finalBestOf,
    a: { kind: "winner", match: `W${R}-1` },
    b: { kind: "winner", match: `L${lbRounds}-1` },
  });
  if (opts.grandFinalReset) {
    specs.push({
      key: "GF-2",
      bracket: "GF",
      round: 2,
      position: 1,
      group: null,
      bestOf: finalBestOf,
      a: { kind: "slotA", match: "GF-1" },
      b: { kind: "slotB", match: "GF-1" },
      onlyIfWinner: { match: "GF-1", side: "b" },
    });
  }
  return specs;
}
