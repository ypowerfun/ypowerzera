import type { Id, MatchSpec, RoundRobinSettings } from "./types";
import { randomDistribute, snakeDistribute } from "./seeding";

/**
 * Método do círculo. Devolve as rodadas com os pares [casa, fora].
 * Com número ímpar de participantes, quem folga na rodada simplesmente não aparece.
 */
export function roundRobinPairings(ids: readonly Id[]): Array<Array<[Id, Id]>> {
  if (ids.length < 2) return [];
  const arr: (Id | null)[] = [...ids];
  if (arr.length % 2 === 1) arr.push(null);
  const n = arr.length;
  const rounds: Array<Array<[Id, Id]>> = [];
  for (let r = 0; r < n - 1; r++) {
    const pairs: Array<[Id, Id]> = [];
    for (let i = 0; i < n / 2; i++) {
      const x = arr[i];
      const y = arr[n - 1 - i];
      if (x === null || y === null) continue;
      // alterna mando do participante fixo para equilibrar casa/fora
      pairs.push(i === 0 && r % 2 === 1 ? [y, x] : [x, y]);
    }
    rounds.push(pairs);
    // gira todos menos o primeiro
    const last = arr.pop() as Id | null;
    arr.splice(1, 0, last);
  }
  return rounds;
}

export function assignGroups(seeds: readonly Id[], groups: number, method: "snake" | "random", salt: string): Id[][] {
  if (groups < 1) throw new Error("Número de grupos inválido.");
  if (seeds.length < groups * 2) throw new Error("Cada grupo precisa de ao menos 2 participantes.");
  return method === "random" ? randomDistribute(seeds, groups, salt) : snakeDistribute(seeds, groups);
}

export function generateRoundRobin(
  seeds: readonly Id[],
  settings: Pick<RoundRobinSettings, "groups" | "legs" | "bestOf" | "groupAssignment">,
  salt = "groups",
): { groups: Id[][]; specs: MatchSpec[] } {
  const groups = assignGroups(seeds, settings.groups, settings.groupAssignment, salt);
  const specs: MatchSpec[] = [];
  groups.forEach((members, gi) => {
    const g = gi + 1;
    const rounds = roundRobinPairings(members);
    const total = rounds.length;
    for (let leg = 0; leg < settings.legs; leg++) {
      rounds.forEach((pairs, ri) => {
        const round = leg * total + ri + 1;
        pairs.forEach(([x, y], pi) => {
          const [home, away] = leg === 0 ? [x, y] : [y, x];
          specs.push({
            key: `G${g}-R${round}-${pi + 1}`,
            bracket: "GROUP",
            round,
            position: pi + 1,
            group: g,
            bestOf: settings.bestOf,
            a: { kind: "participant", id: home },
            b: { kind: "participant", id: away },
          });
        });
      });
    }
  });
  return { groups, specs };
}
