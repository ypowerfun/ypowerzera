import type { Advancement, LeaderboardSettings, PlacementMultiplier, StageSettings } from "@/engine";

type Get = (name: string) => string;

const num = (v: string, def?: number): number | undefined => {
  if (v.trim() === "") return def;
  const n = Number(v.replace(",", "."));
  return Number.isFinite(n) ? n : def;
};
const intOr = (v: string, def: number): number => {
  const n = num(v);
  return n === undefined ? def : Math.trunc(n);
};
const on = (v: string) => ["on", "true", "1"].includes(v);

/** "12, 9, 7" → [12, 9, 7] */
export function parseNumberList(text: string): number[] {
  return text
    .split(/[\s,;]+/)
    .filter(Boolean)
    .map((x) => Number(x.replace(",", ".")))
    .filter((n) => Number.isFinite(n) && n >= 0);
}

/** "1-1:2, 2-5:1.8" → [{from:1,to:1,multiplier:2},{from:2,to:5,multiplier:1.8}] */
export function parseMultipliers(text: string): PlacementMultiplier[] {
  const out: PlacementMultiplier[] = [];
  for (const part of text.split(/[,;\n]+/).map((p) => p.trim()).filter(Boolean)) {
    const m = part.match(/^(\d+)(?:\s*-\s*(\d+))?\s*:\s*([\d.,]+)$/);
    if (!m) continue;
    const from = Number(m[1]);
    const to = m[2] ? Number(m[2]) : from;
    const multiplier = Number(m[3].replace(",", "."));
    if (from >= 1 && to >= from && Number.isFinite(multiplier) && multiplier > 0) out.push({ from, to, multiplier });
  }
  return out;
}

export const formatMultipliers = (ms: PlacementMultiplier[] | undefined) => (ms ?? []).map((m) => `${m.from}${m.to !== m.from ? `-${m.to}` : ""}:${m.multiplier}`).join(", ");

function advancement(get: Get, kind: "count" | "perGroup" | "none", prev?: Advancement): Advancement | undefined {
  if (kind === "none") return prev;
  const v = num(get("adv"));
  if (!v || v < 1) return undefined;
  return kind === "count" ? { count: Math.trunc(v) } : { perGroup: Math.trunc(v) };
}

/**
 * Converte os campos do formulário de uma fase em StageSettings, partindo da configuração anterior
 * (mantém o que o formulário não edita, como critérios de desempate). `get("campo")` lê o valor já com o prefixo da fase.
 */
export function parseStageSettings(prev: StageSettings, get: Get): StageSettings {
  switch (prev.type) {
    case "SINGLE_ELIMINATION":
      return {
        ...prev,
        bestOf: { default: intOr(get("bo"), prev.bestOf.default), quarterfinals: num(get("bo_qf")) ? intOr(get("bo_qf"), 1) : undefined, semifinals: num(get("bo_sf")) ? intOr(get("bo_sf"), 1) : undefined, finals: num(get("bo_f")) ? intOr(get("bo_f"), 1) : undefined },
        thirdPlaceMatch: on(get("third")),
        advancement: advancement(get, "count", prev.advancement),
      };
    case "DOUBLE_ELIMINATION":
      return {
        ...prev,
        bestOf: { default: intOr(get("bo"), prev.bestOf.default), semifinals: num(get("bo_sf")) ? intOr(get("bo_sf"), 1) : undefined, finals: num(get("bo_f")) ? intOr(get("bo_f"), 1) : undefined },
        grandFinalReset: on(get("reset")),
        advancement: advancement(get, "count", prev.advancement),
      };
    case "ROUND_ROBIN":
      return {
        ...prev,
        groups: Math.max(1, intOr(get("groups"), prev.groups)),
        legs: intOr(get("legs"), prev.legs) === 2 ? 2 : 1,
        bestOf: intOr(get("bo"), prev.bestOf),
        allowDraw: on(get("draw")),
        points: { win: num(get("pw"), prev.points.win)!, draw: num(get("pd"), prev.points.draw)!, loss: num(get("pl"), prev.points.loss)! },
        advancement: advancement(get, "perGroup", prev.advancement),
      };
    case "SWISS": {
      const mode = get("mode") === "rounds" ? "rounds" : "winLoss";
      return {
        ...prev,
        mode,
        rounds: mode === "rounds" ? intOr(get("rounds"), prev.rounds ?? 5) : prev.rounds,
        winsToAdvance: mode === "winLoss" ? intOr(get("wins"), prev.winsToAdvance ?? 3) : prev.winsToAdvance,
        lossesToEliminate: mode === "winLoss" ? intOr(get("losses"), prev.lossesToEliminate ?? 3) : prev.lossesToEliminate,
        bestOf: intOr(get("bo"), prev.bestOf),
        decisiveBestOf: num(get("bo_dec")) ? intOr(get("bo_dec"), prev.bestOf) : undefined,
        allowDraw: on(get("draw")),
        advancement: advancement(get, "count", prev.advancement),
      };
    }
    case "GSL":
      return { ...prev, bestOf: intOr(get("bo"), prev.bestOf), decisiveBestOf: num(get("bo_dec")) ? intOr(get("bo_dec"), prev.bestOf) : undefined, advancement: advancement(get, "perGroup", prev.advancement) };
    case "LEADERBOARD": {
      const formula = get("formula") === "multiplier" ? "multiplier" : "additive";
      const placementPoints = parseNumberList(get("placement"));
      const matchThreshold = num(get("mp"));
      const out: LeaderboardSettings = {
        ...prev,
        games: intOr(get("games"), prev.games),
        lobbySize: intOr(get("lobby"), prev.lobbySize),
        lobbyAssignment: (["snake", "swiss", "random", "fixed"] as const).includes(get("assign") as never) ? (get("assign") as LeaderboardSettings["lobbyAssignment"]) : prev.lobbyAssignment,
        scoring: {
          formula,
          placementPoints: formula === "additive" ? placementPoints : [],
          killPoints: num(get("kill"), prev.scoring.killPoints)!,
          victoryBonus: num(get("vr")) || undefined,
          placementMultipliers: formula === "multiplier" ? parseMultipliers(get("mult")) : undefined,
        },
        matchPoint: matchThreshold && matchThreshold > 0 ? { threshold: Math.trunc(matchThreshold), requireWin: on(get("mp_win")) } : undefined,
        advancement: advancement(get, "count", prev.advancement),
      };
      return out;
    }
  }
}
