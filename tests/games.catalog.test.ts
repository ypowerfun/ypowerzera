import { describe, expect, it } from "vitest";
import {
  buildStage,
  computeLeaderboard,
  createRng,
  isStageComplete,
  planLobbies,
  selectAdvancing,
  shuffle,
  stageStandings,
  validateStage,
  type BrResultInput,
  type Id,
  type LeaderboardSettings,
  type StageInput,
} from "@/engine";
import { GAMES, allPresets, getGame, type FormatPreset } from "@/games";
import { ids, simulateStage } from "./helpers";

function simulateLeaderboard(settings: LeaderboardSettings, seeds: Id[], rngSeed: string): { input: StageInput; champion: Id | null } {
  const rng = createRng(rngSeed);
  const br: BrResultInput[] = [];
  const input: StageInput = { settings, participants: seeds, specs: [], results: new Map(), groups: null, br };
  for (let round = 1; round <= settings.games; round++) {
    const state = computeLeaderboard(seeds, br, settings);
    if (state.finished) break;
    const order = settings.lobbyAssignment === "swiss" && round > 1 ? state.rows.map((r) => r.participantId) : seeds;
    const lobbies = planLobbies(order, settings.lobbySize, settings.lobbyAssignment, round, "sim");
    lobbies.forEach((lobby, li) => {
      shuffle(lobby, rng).forEach((id, i) => {
        br.push({ round, lobby: li + 1, participantId: id, placement: i + 1, kills: Math.floor(rng() * 8) });
      });
    });
  }
  const final = computeLeaderboard(seeds, br, settings);
  return { input, champion: final.champion };
}

function runPreset(preset: FormatPreset, n: number, rngSeed: string) {
  let seeds: Id[] = ids(n);
  const summaries: string[] = [];
  let champion: Id | null = null;
  preset.stages.forEach((stage, si) => {
    const errors = validateStage(stage.settings, seeds.length);
    expect(errors, `${preset.id} / ${stage.name} com ${seeds.length}: ${errors.join(" ")}`).toEqual([]);
    let input: StageInput;
    if (stage.settings.type === "LEADERBOARD") {
      const sim = simulateLeaderboard(stage.settings, seeds, `${rngSeed}-${si}`);
      input = sim.input;
      champion = sim.champion;
    } else {
      input = simulateStage(stage.settings, seeds, "random", `${rngSeed}`, `${rngSeed}-${si}`).input;
    }
    expect(isStageComplete(input), `${preset.id} / ${stage.name} deveria terminar`).toBe(true);
    const standings = stageStandings(input);
    expect(standings.length).toBe(seeds.length);
    expect(new Set(standings.map((r) => r.participantId)).size).toBe(seeds.length);
    const next = preset.stages[si + 1];
    if (next) {
      const adv = selectAdvancing(standings, stage.settings.advancement);
      expect(adv.length, `${preset.id}: avanço do estágio ${stage.name}`).toBeGreaterThan(1);
      expect(new Set(adv).size).toBe(adv.length);
      seeds = adv;
    }
    summaries.push(`${stage.name}:${seeds.length}`);
  });
  return { champion, summaries };
}

describe("catálogo de jogos", () => {
  it("contém todos os jogos solicitados", () => {
    const names = GAMES.map((g) => g.id).sort();
    expect(names).toEqual(["apex", "bf6", "cs2", "csgo", "eafc", "fortnite", "lol", "sf6", "tft", "valorant", "warzone"]);
  });

  it("ids e slugs são únicos", () => {
    expect(new Set(GAMES.map((g) => g.id)).size).toBe(GAMES.length);
    expect(new Set(GAMES.map((g) => g.slug)).size).toBe(GAMES.length);
    const presetIds = allPresets().map((p) => p.preset.id);
    expect(new Set(presetIds).size).toBe(presetIds.length);
  });

  for (const game of GAMES) {
    describe(game.name, () => {
      it("tem modos, campos de identidade com campo principal e regras", () => {
        expect(game.modes.length).toBeGreaterThan(0);
        expect(game.identity.some((f) => f.primary && f.required)).toBe(true);
        expect(game.rules.length).toBeGreaterThan(40);
        expect(game.matchSettings.length).toBeGreaterThan(0);
        expect(game.presets.length).toBeGreaterThan(0);
        expect(game.description.length).toBeGreaterThan(40);
        for (const mode of game.modes) {
          expect(mode.teamSize).toBeGreaterThanOrEqual(1);
          expect(mode.maxSubs).toBeGreaterThanOrEqual(0);
        }
      });

      it("expressões regulares dos campos de identidade compilam", () => {
        for (const f of game.identity) {
          if (f.pattern) expect(() => new RegExp(f.pattern!)).not.toThrow();
          if (f.type === "select") expect(f.options?.length).toBeGreaterThan(0);
        }
      });

      it("presets só referenciam modos que existem", () => {
        const modeIds = new Set(game.modes.map((m) => m.id));
        for (const p of game.presets) for (const m of p.modes ?? []) expect(modeIds.has(m)).toBe(true);
      });

      it("jogos com veto têm pool de mapas", () => {
        if (game.vetoSupported && game.id !== "bf6") expect(game.mapPool?.maps.length).toBeGreaterThanOrEqual(7);
      });

      for (const preset of game.presets) {
        it(`preset "${preset.id}" roda de ponta a ponta (mín, sugerido, máx)`, () => {
          expect(preset.minParticipants).toBeLessThanOrEqual(preset.suggestedParticipants);
          expect(preset.suggestedParticipants).toBeLessThanOrEqual(preset.maxParticipants);
          const sizes = [...new Set([preset.minParticipants, preset.suggestedParticipants, preset.maxParticipants])];
          for (const n of sizes) {
            const out = runPreset(preset, n, `${preset.id}-${n}`);
            expect(out.summaries.length).toBe(preset.stages.length);
          }
        });
      }
    });
  }
});

describe("validações de formato", () => {
  it("rejeita participantes insuficientes e configurações inválidas", () => {
    const lol = getGame("lol")!;
    const worlds = lol.presets.find((p) => p.id === "lol.worlds")!;
    expect(validateStage(worlds.stages[0].settings, 3).length).toBeGreaterThan(0);
    expect(validateStage({ type: "SINGLE_ELIMINATION", bestOf: { default: 2 }, thirdPlaceMatch: false }, 8).length).toBeGreaterThan(0);
    expect(validateStage({ type: "GSL", bestOf: 3, groupAssignment: "snake" }, 6).length).toBeGreaterThan(0);
    expect(() => buildStage({ type: "GSL", bestOf: 3, groupAssignment: "snake" }, ids(6))).toThrow();
  });

  it("Apex Match Point: vencedor sempre tem match point; termina com campeão ou no teto", () => {
    const preset = getGame("apex")!.presets.find((p) => p.id === "apex.match-point")!;
    let champions = 0;
    for (let i = 0; i < 20; i++) {
      const sim = simulateLeaderboard(preset.stages[0].settings as LeaderboardSettings, ids(20), `mp-${i}`);
      const state = computeLeaderboard(ids(20), sim.input.br as BrResultInput[], preset.stages[0].settings as LeaderboardSettings);
      expect(state.finished).toBe(true);
      if (state.champion) {
        champions++;
        // o campeão tinha ≥ 50 pontos antes da partida decisiva
        const row = state.rows.find((r) => r.participantId === state.champion)!;
        const before = row.perGame.filter((g) => g.round < state.championRound!).reduce((s, g) => s + g.points, 0);
        expect(before).toBeGreaterThanOrEqual(50);
        expect(row.perGame.find((g) => g.round === state.championRound)!.placement).toBe(1);
      }
    }
    expect(champions).toBeGreaterThan(0);
  });
});
