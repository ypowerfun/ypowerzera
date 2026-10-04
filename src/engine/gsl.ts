import type { GslSettings, Id, MatchSpec } from "./types";
import { assignGroups } from "./round-robin";

/**
 * Grupos GSL (dupla eliminação de 4): 1×4 e 2×3; vencedores jogam a "partida de vencedores",
 * perdedores a "partida de eliminação"; o perdedor dos vencedores enfrenta o vencedor da eliminação
 * na "partida decisiva". Classificam: vencedor da partida de vencedores e vencedor da decisiva.
 * Usado em Valorant Champions, StarCraft (GSL) e muitos campeonatos de CS.
 */
export function generateGsl(
  seeds: readonly Id[],
  settings: Pick<GslSettings, "bestOf" | "decisiveBestOf" | "groupAssignment">,
  salt = "gsl",
): { groups: Id[][]; specs: MatchSpec[] } {
  if (seeds.length < 4 || seeds.length % 4 !== 0) {
    throw new Error("Grupos GSL exigem um número de participantes múltiplo de 4.");
  }
  const groups = assignGroups(seeds, seeds.length / 4, settings.groupAssignment, salt);
  const decisive = settings.decisiveBestOf ?? settings.bestOf;
  const specs: MatchSpec[] = [];
  groups.forEach((m, gi) => {
    const g = gi + 1;
    const mk = (key: string, round: number, position: number, bestOf: number, a: MatchSpec["a"], b: MatchSpec["b"]): MatchSpec => ({
      key: `G${g}-${key}`,
      bracket: "GROUP",
      round,
      position,
      group: g,
      bestOf,
      a,
      b,
    });
    specs.push(
      mk("OM1", 1, 1, settings.bestOf, { kind: "participant", id: m[0] }, { kind: "participant", id: m[3] }),
      mk("OM2", 1, 2, settings.bestOf, { kind: "participant", id: m[1] }, { kind: "participant", id: m[2] }),
      mk("WM", 2, 1, decisive, { kind: "winner", match: `G${g}-OM1` }, { kind: "winner", match: `G${g}-OM2` }),
      mk("EM", 2, 2, settings.bestOf, { kind: "loser", match: `G${g}-OM1` }, { kind: "loser", match: `G${g}-OM2` }),
      mk("DM", 3, 1, decisive, { kind: "loser", match: `G${g}-WM` }, { kind: "winner", match: `G${g}-EM` }),
    );
  });
  return { groups, specs };
}

export const GSL_LABELS: Record<string, string> = {
  OM1: "Abertura 1",
  OM2: "Abertura 2",
  WM: "Partida de vencedores",
  EM: "Partida de eliminação",
  DM: "Partida decisiva",
};
