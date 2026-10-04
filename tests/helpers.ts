import {
  buildStage,
  createRng,
  firstTo,
  isStageComplete,
  nextSwissRound,
  resolveStage,
  type Id,
  type MatchResult,
  type MatchSpec,
  type ResolvedMatch,
  type StageInput,
  type StageSettings,
} from "@/engine";

export const ids = (n: number): Id[] => Array.from({ length: n }, (_, i) => `p${i + 1}`);

export const seedNumber = (id: Id) => Number(id.slice(1));

export function resultFor(bestOf: number, winner: "a" | "b"): MatchResult {
  if (bestOf === 1) return winner === "a" ? { scoreA: 13, scoreB: 7, winner } : { scoreA: 7, scoreB: 13, winner };
  const need = firstTo(bestOf);
  return winner === "a" ? { scoreA: need, scoreB: 0, winner } : { scoreA: 0, scoreB: need, winner };
}

export type Strategy = "chalk" | "random";

export interface SimOutcome {
  input: StageInput;
  resolved: Map<string, ResolvedMatch>;
  played: Array<{ spec: MatchSpec; a: Id; b: Id; winner: Id }>;
}

/** Joga um estágio inteiro (exceto leaderboard). "chalk" = menor seed (melhor) sempre vence. */
export function simulateStage(settings: StageSettings, seeds: Id[], strategy: Strategy, salt = "t", rngSeed = "sim"): SimOutcome {
  const rng = createRng(rngSeed);
  const built = buildStage(settings, seeds, salt);
  const input: StageInput = {
    settings,
    participants: seeds,
    specs: [...built.specs],
    results: new Map(),
    groups: built.groups,
    br: [],
  };
  const played: SimOutcome["played"] = [];
  const results = input.results as Map<string, MatchResult>;
  let guard = 0;
  for (;;) {
    if (++guard > 5000) throw new Error("simulação não terminou");
    const resolved = resolveStage(input);
    const ready = [...resolved.values()].filter((m) => m.status === "ready");
    if (ready.length === 0) {
      const next = nextSwissRound(input);
      if (next) {
        (input.specs as MatchSpec[]).push(...next.specs);
        continue;
      }
      break;
    }
    for (const m of ready) {
      const spec = input.specs.find((s) => s.key === m.key)!;
      const a = (m.entrantA as { id: Id }).id;
      const b = (m.entrantB as { id: Id }).id;
      let winner: "a" | "b";
      if (strategy === "chalk") winner = seedNumber(a) < seedNumber(b) ? "a" : "b";
      else winner = rng() < 0.5 ? "a" : "b";
      results.set(m.key, resultFor(spec.bestOf, winner));
      played.push({ spec, a, b, winner: winner === "a" ? a : b });
    }
  }
  return { input, resolved: resolveStage(input), played };
}

export const defaultBestOf = { default: 1 };
