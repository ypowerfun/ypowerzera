import type { BestOfRules, Id, MatchSpec, SlotSource } from "./types";
import { bracketOrder, nextPowerOfTwo } from "./seeding";
import { bestOfForRound, normalizeBestOf, type RoundRole } from "./series";

export function roleForRound(round: number, totalRounds: number): RoundRole {
  const remaining = totalRounds - round;
  if (remaining === 0) return "final";
  if (remaining === 1) return "semifinal";
  if (remaining === 2) return "quarterfinal";
  return "other";
}

/** Vagas do 1º turno da chave dos vencedores (compartilhado com a dupla eliminação). */
export function firstRoundSlots(seeds: readonly Id[], size: number): SlotSource[] {
  const order = bracketOrder(size);
  return order.map((seed): SlotSource => (seed <= seeds.length ? { kind: "participant", id: seeds[seed - 1] } : { kind: "bye" }));
}

export interface SingleEliminationOptions {
  bestOf: BestOfRules;
  thirdPlaceMatch: boolean;
}

/**
 * Gera uma chave eliminatória simples para `seeds` (ordem de seed, 1º = melhor).
 * Seeds que sobram viram BYE e os melhores seeds recebem os byes.
 */
export function generateSingleElimination(seeds: readonly Id[], opts: SingleEliminationOptions): MatchSpec[] {
  const n = seeds.length;
  if (n < 2) throw new Error("A eliminatória simples exige ao menos 2 participantes.");
  const size = nextPowerOfTwo(n);
  const rounds = Math.log2(size);
  const specs: MatchSpec[] = [];
  const slots = firstRoundSlots(seeds, size);

  for (let i = 1; i <= size / 2; i++) {
    specs.push({
      key: `W1-${i}`,
      bracket: "W",
      round: 1,
      position: i,
      group: null,
      bestOf: bestOfForRound(opts.bestOf, roleForRound(1, rounds)),
      a: slots[2 * i - 2],
      b: slots[2 * i - 1],
    });
  }
  for (let r = 2; r <= rounds; r++) {
    const count = size / 2 ** r;
    for (let i = 1; i <= count; i++) {
      specs.push({
        key: `W${r}-${i}`,
        bracket: "W",
        round: r,
        position: i,
        group: null,
        bestOf: bestOfForRound(opts.bestOf, roleForRound(r, rounds)),
        a: { kind: "winner", match: `W${r - 1}-${2 * i - 1}` },
        b: { kind: "winner", match: `W${r - 1}-${2 * i}` },
      });
    }
  }
  if (opts.thirdPlaceMatch && rounds >= 2) {
    specs.push({
      key: "T-1",
      bracket: "THIRD",
      round: rounds,
      position: 1,
      group: null,
      bestOf: normalizeBestOf(opts.bestOf.thirdPlace ?? opts.bestOf.default, 1),
      a: { kind: "loser", match: `W${rounds - 1}-1` },
      b: { kind: "loser", match: `W${rounds - 1}-2` },
    });
  }
  return specs;
}
