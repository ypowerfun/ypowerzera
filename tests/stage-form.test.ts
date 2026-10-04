import { describe, expect, it } from "vitest";
import { parseMultipliers, parseNumberList, parseStageSettings, formatMultipliers } from "@/lib/stage-form";
import { getGame } from "@/games";
import { validateStage, type StageSettings } from "@/engine";

const getter = (obj: Record<string, string>) => (k: string) => obj[k] ?? "";
const stage = (gameId: string, presetId: string, i: number) => getGame(gameId)!.presets.find((p) => p.id === presetId)!.stages[i].settings;

describe("formulário de fases", () => {
  it("parseia listas e multiplicadores", () => {
    expect(parseNumberList("12, 9;7  5\n4")).toEqual([12, 9, 7, 5, 4]);
    expect(parseNumberList("a, -1, 3")).toEqual([3]);
    expect(parseMultipliers("1:2, 2-5:1.8, 6-10:1.6, lixo")).toEqual([
      { from: 1, to: 1, multiplier: 2 },
      { from: 2, to: 5, multiplier: 1.8 },
      { from: 6, to: 10, multiplier: 1.6 },
    ]);
    expect(formatMultipliers(parseMultipliers("1:2, 2-5:1.8"))).toBe("1:2, 2-5:1.8");
  });

  it("eliminatória: Bo por fase, 3º lugar e avanço", () => {
    const prev = stage("sf6", "sf6.single-elim", 0);
    const s = parseStageSettings(prev, getter({ bo: "1", bo_sf: "3", bo_f: "5", third: "on", adv: "4" })) as Extract<StageSettings, { type: "SINGLE_ELIMINATION" }>;
    expect(s.bestOf).toMatchObject({ default: 1, semifinals: 3, finals: 5 });
    expect(s.thirdPlaceMatch).toBe(true);
    expect(s.advancement).toEqual({ count: 4 });
    expect(validateStage(s, 8)).toEqual([]);
    expect(parseStageSettings(prev, getter({ bo: "1" })).type).toBe("SINGLE_ELIMINATION");
  });

  it("Swiss: alterna entre rodadas fixas e 3V/3D mantendo desempates", () => {
    const prev = stage("cs2", "cs2.major", 0);
    const wl = parseStageSettings(prev, getter({ mode: "winLoss", wins: "4", losses: "2", bo: "1", bo_dec: "3", adv: "8" })) as Extract<StageSettings, { type: "SWISS" }>;
    expect(wl).toMatchObject({ mode: "winLoss", winsToAdvance: 4, lossesToEliminate: 2, decisiveBestOf: 3 });
    expect(wl.tiebreakers).toEqual((prev as typeof wl).tiebreakers);
    const fixed = parseStageSettings(prev, getter({ mode: "rounds", rounds: "6", bo: "1" })) as Extract<StageSettings, { type: "SWISS" }>;
    expect(fixed.mode).toBe("rounds");
    expect(fixed.rounds).toBe(6);
    expect(validateStage(fixed, 16)).toEqual([]);
  });

  it("leaderboard: pontos por colocação, multiplicadores, match point", () => {
    const prev = stage("apex", "apex.match-point", 0);
    const s = parseStageSettings(prev, getter({ games: "12", lobby: "20", assign: "fixed", formula: "additive", placement: "10, 8, 6, 5, 4", kill: "1", mp: "40", mp_win: "on" })) as Extract<StageSettings, { type: "LEADERBOARD" }>;
    expect(s.scoring.placementPoints).toEqual([10, 8, 6, 5, 4]);
    expect(s.matchPoint).toEqual({ threshold: 40, requireWin: true });
    expect(validateStage(s, 10)).toEqual([]);
    const wz = parseStageSettings(stage("warzone", "warzone.trios", 0), getter({ games: "6", lobby: "50", assign: "snake", formula: "multiplier", mult: "1:2, 2-5:1.8", kill: "1" })) as Extract<StageSettings, { type: "LEADERBOARD" }>;
    expect(wz.scoring.formula).toBe("multiplier");
    expect(wz.scoring.placementMultipliers).toHaveLength(2);
    expect(wz.matchPoint).toBeUndefined();
  });

  it("pontos corridos e GSL", () => {
    const rr = parseStageSettings(stage("eafc", "eafc.groups-knockout", 0), getter({ groups: "2", legs: "2", bo: "1", draw: "on", pw: "3", pd: "1", pl: "0", adv: "2" })) as Extract<StageSettings, { type: "ROUND_ROBIN" }>;
    expect(rr).toMatchObject({ groups: 2, legs: 2, allowDraw: true, advancement: { perGroup: 2 } });
    const gsl = parseStageSettings(stage("valorant", "valorant.champions", 0), getter({ bo: "3", adv: "2" })) as Extract<StageSettings, { type: "GSL" }>;
    expect(gsl.advancement).toEqual({ perGroup: 2 });
  });
});
