import { describe, expect, it } from "vitest";
import {
  buildStage,
  computeTable,
  isStageComplete,
  roundRobinPairings,
  stageStandings,
  swissRecordsFor,
  type GslSettings,
  type RoundRobinSettings,
  type SwissSettings,
  type TableMatch,
} from "@/engine";
import { ids, resultFor, simulateStage, seedNumber } from "./helpers";

const rr = (extra: Partial<RoundRobinSettings> = {}): RoundRobinSettings => ({
  type: "ROUND_ROBIN",
  groups: 1,
  legs: 1,
  bestOf: 1,
  allowDraw: true,
  points: { win: 3, draw: 1, loss: 0 },
  tiebreakers: ["points", "h2hPoints", "diff", "scoreFor"],
  groupAssignment: "snake",
  ...extra,
});

const swissWL = (extra: Partial<SwissSettings> = {}): SwissSettings => ({
  type: "SWISS",
  mode: "winLoss",
  winsToAdvance: 3,
  lossesToEliminate: 3,
  bestOf: 1,
  decisiveBestOf: 3,
  allowDraw: false,
  points: { win: 1, draw: 0, loss: 0 },
  tiebreakers: ["points", "buchholz", "diff", "seed"],
  ...extra,
});

describe("pontos corridos", () => {
  it("método do círculo: todos jogam contra todos exatamente uma vez", () => {
    for (let n = 2; n <= 12; n++) {
      const rounds = roundRobinPairings(ids(n));
      const seen = new Set<string>();
      for (const r of rounds) {
        const inRound = new Set<string>();
        for (const [a, b] of r) {
          expect(inRound.has(a) || inRound.has(b)).toBe(false); // ninguém joga duas vezes na rodada
          inRound.add(a);
          inRound.add(b);
          seen.add([a, b].sort().join("|"));
        }
      }
      expect(seen.size).toBe((n * (n - 1)) / 2);
      expect(rounds.length).toBe(n % 2 === 0 ? n - 1 : n);
    }
  });

  it("turno e returno dobram as partidas e invertem o mando", () => {
    const built = buildStage(rr({ legs: 2 }), ids(6));
    expect(built.specs.length).toBe(30);
    const first = built.specs.find((s) => s.key === "G1-R1-1")!;
    const secondLeg = built.specs.find((s) => s.round === 6 && s.a.kind === "participant" && s.b.kind === "participant" && (s.b as { id: string }).id === (first.a as { id: string }).id && (s.a as { id: string }).id === (first.b as { id: string }).id);
    expect(secondLeg).toBeTruthy();
  });

  it("grupos em cobra, partidas só dentro do grupo", () => {
    const built = buildStage(rr({ groups: 2 }), ids(8));
    expect(built.groups!.map((g) => g.length)).toEqual([4, 4]);
    expect(built.groups![0]).toEqual(["p1", "p4", "p5", "p8"]);
    for (const s of built.specs) {
      const g = built.groups![s.group! - 1];
      expect(g).toContain((s.a as { id: string }).id);
      expect(g).toContain((s.b as { id: string }).id);
    }
    expect(built.specs.length).toBe(12);
  });

  it("simula 2 grupos de 4 (chalk): líderes e ordem corretos", () => {
    const sim = simulateStage(rr({ groups: 2 }), ids(8), "chalk");
    expect(isStageComplete(sim.input)).toBe(true);
    const st = stageStandings(sim.input);
    const g1 = st.filter((r) => r.group === 1);
    expect(g1.map((r) => r.participantId)).toEqual(["p1", "p4", "p5", "p8"]);
    expect(g1[0].points).toBe(9);
    // ranks gerais: 1ºs primeiro
    expect(st.slice(0, 2).every((r) => r.groupRank === 1)).toBe(true);
  });

  it("desempate por confronto direto antes do saldo", () => {
    // A, B, C empatados em pontos; confronto direto A>B>C>A cria ciclo -> cai para saldo
    const matches: TableMatch[] = [
      { a: "A", b: "B", result: { scoreA: 1, scoreB: 0, winner: "a" } },
      { a: "B", b: "C", result: { scoreA: 1, scoreB: 0, winner: "a" } },
      { a: "C", b: "A", result: { scoreA: 5, scoreB: 0, winner: "a" } },
      { a: "D", b: "A", result: { scoreA: 0, scoreB: 1, winner: "b" } },
    ];
    const table = computeTable(["A", "B", "C", "D"], matches, {
      points: { win: 3, draw: 1, loss: 0 },
      tiebreakers: ["points", "h2hPoints", "diff"],
    });
    // pontos: A=6, B=3, C=3, D=0 -> B x C: confronto direto B>C
    expect(table.map((r) => r.participantId)).toEqual(["A", "B", "C", "D"]);
  });

  it("empates (draw) valem 1 ponto e são aceitos", () => {
    const table = computeTable(
      ["A", "B"],
      [{ a: "A", b: "B", result: { scoreA: 2, scoreB: 2, winner: null } }],
      { points: { win: 3, draw: 1, loss: 0 }, tiebreakers: ["points"] },
    );
    expect(table.map((r) => r.points)).toEqual([1, 1]);
    expect(table[0].draws).toBe(1);
  });
});

describe("Swiss (3 vitórias / 3 derrotas)", () => {
  it("rodada 1 pareia metade de cima × metade de baixo (1×9 ... 8×16)", () => {
    const built = buildStage(swissWL(), ids(16));
    const pairs = built.specs.map((s) => [seedNumber((s.a as { id: string }).id), seedNumber((s.b as { id: string }).id)]);
    expect(pairs).toEqual([[1, 9], [2, 10], [3, 11], [4, 12], [5, 13], [6, 14], [7, 15], [8, 16]]);
  });

  for (const strategy of ["chalk", "random"] as const) {
    it(`16 times (${strategy}): 8 classificam e 8 são eliminados, sem revanche, no máximo 5 rodadas`, () => {
      for (let rep = 0; rep < (strategy === "random" ? 25 : 1); rep++) {
        const sim = simulateStage(swissWL(), ids(16), strategy, "s", `sw-${rep}`);
        expect(isStageComplete(sim.input)).toBe(true);
        const rounds = Math.max(...sim.played.map((p) => p.spec.round));
        expect(rounds).toBeLessThanOrEqual(5);
        const state = swissRecordsFor(sim.input)!;
        const adv = [...state.values()].filter((s) => s.state === "advanced");
        const elim = [...state.values()].filter((s) => s.state === "eliminated");
        expect(adv.length).toBe(8);
        expect(elim.length).toBe(8);
        for (const a of adv) expect(a.wins).toBe(3);
        for (const e of elim) expect(e.losses).toBe(3);
        // sem revanche
        const seen = new Set<string>();
        for (const p of sim.played) {
          const k = [p.a, p.b].sort().join("|");
          expect(seen.has(k)).toBe(false);
          seen.add(k);
        }
        // 8 classificados × 3 vitórias + vitórias dos eliminados. No caso "favorito vence" são
        // 24 + 9 = 33 partidas (padrão dos Majors de CS); com sorteios aleatórios o total pode variar
        // quando a regra "sem revanche" força um pareamento entre campanhas diferentes.
        if (strategy === "chalk") expect(sim.played.length).toBe(33);
        else {
          expect(sim.played.length).toBeGreaterThanOrEqual(24);
          expect(sim.played.length).toBeLessThanOrEqual(40);
        }
        const st = stageStandings(sim.input);
        expect(st.slice(0, 8).every((r) => r.state === "advanced")).toBe(true);
        expect(st.slice(8).every((r) => r.state === "eliminated")).toBe(true);
      }
    });
  }

  it("partidas decisivas usam o Bo decisivo; as demais o Bo normal", () => {
    const sim = simulateStage(swissWL(), ids(16), "chalk");
    const r1 = sim.played.filter((p) => p.spec.round === 1);
    expect(r1.every((p) => p.spec.bestOf === 1)).toBe(true);
    const r3 = sim.played.filter((p) => p.spec.round === 3);
    // rodada 3: 2-0 (classificação) e 0-2 (eliminação) são Bo3; 1-1 é Bo1
    expect(r3.some((p) => p.spec.bestOf === 3)).toBe(true);
    expect(r3.some((p) => p.spec.bestOf === 1)).toBe(true);
  });

  it("funciona com número ímpar (bye) e termina", () => {
    for (const n of [5, 7, 9, 11, 13, 15, 17, 21, 25]) {
      const sim = simulateStage(swissWL(), ids(n), "random", "s", `odd-${n}`);
      expect(isStageComplete(sim.input)).toBe(true);
      const state = swissRecordsFor(sim.input)!;
      expect([...state.values()].every((s) => s.state !== "active")).toBe(true);
    }
  });
});

describe("Swiss (rodadas fixas)", () => {
  const fixed = (extra: Partial<SwissSettings> = {}): SwissSettings => ({
    type: "SWISS",
    mode: "rounds",
    rounds: 4,
    bestOf: 1,
    allowDraw: false,
    points: { win: 3, draw: 1, loss: 0 },
    tiebreakers: ["points", "buchholz", "diff", "seed"],
    ...extra,
  });

  it("joga exatamente N rodadas e ninguém repete adversário", () => {
    for (const n of [8, 12, 16, 7, 13, 32]) {
      const sim = simulateStage(fixed({ rounds: 4 }), ids(n), "random", "s", `fx-${n}`);
      expect(isStageComplete(sim.input)).toBe(true);
      const rounds = new Set(sim.input.specs.map((s) => s.round));
      expect(rounds.size).toBe(4);
      const seen = new Set<string>();
      for (const p of sim.played) {
        const k = [p.a, p.b].sort().join("|");
        expect(seen.has(k)).toBe(false);
        seen.add(k);
      }
      expect(stageStandings(sim.input).length).toBe(n);
    }
  });

  it("buchholz desempata a classificação", () => {
    const sim = simulateStage(fixed({ rounds: 3 }), ids(8), "chalk");
    const st = stageStandings(sim.input);
    expect(st[0].participantId).toBe("p1");
    expect(st[0].points).toBe(9);
  });
});

describe("Grupos GSL", () => {
  const gsl = (extra: Partial<GslSettings> = {}): GslSettings => ({ type: "GSL", bestOf: 3, groupAssignment: "snake", ...extra });

  it("exige múltiplo de 4", () => {
    expect(() => buildStage(gsl(), ids(6))).toThrow();
    expect(() => buildStage(gsl(), ids(3))).toThrow();
  });

  it("estrutura de um grupo: 1×4, 2×3, vencedores, eliminação e decisiva", () => {
    const built = buildStage(gsl(), ids(4));
    expect(built.specs.map((s) => s.key)).toEqual(["G1-OM1", "G1-OM2", "G1-WM", "G1-EM", "G1-DM"]);
    const om1 = built.specs[0];
    expect([(om1.a as { id: string }).id, (om1.b as { id: string }).id]).toEqual(["p1", "p4"]);
  });

  it("simula 16 times (chalk): 4 grupos, 5 partidas cada, top 2 por grupo", () => {
    const sim = simulateStage(gsl(), ids(16), "chalk");
    expect(sim.played.length).toBe(20);
    const st = stageStandings(sim.input);
    expect(st.length).toBe(16);
    const g1 = st.filter((r) => r.group === 1).map((r) => r.participantId);
    expect(g1.sort()).toEqual(["p1", "p16", "p8", "p9"].sort()); // snake: 1,8,9,16
    for (const g of [1, 2, 3, 4]) {
      const rows = st.filter((r) => r.group === g).sort((a, b) => a.groupRank! - b.groupRank!);
      expect(rows.map((r) => r.groupRank)).toEqual([1, 2, 3, 4]);
      // chalk: o melhor seed do grupo é o 1º e o 2º melhor o 2º
      const seeds = rows.map((r) => seedNumber(r.participantId));
      expect(seeds[0]).toBe(Math.min(...seeds));
    }
  });

  it("aleatório: sempre 2 classificados por grupo e 1 eliminado em cada partida", () => {
    for (let rep = 0; rep < 10; rep++) {
      const sim = simulateStage(gsl(), ids(8), "random", "g", `gsl-${rep}`);
      expect(isStageComplete(sim.input)).toBe(true);
      const losses = new Map<string, number>();
      for (const p of sim.played) {
        const l = p.winner === p.a ? p.b : p.a;
        losses.set(l, (losses.get(l) ?? 0) + 1);
      }
      const st = stageStandings(sim.input);
      for (const g of [1, 2]) {
        const rows = st.filter((r) => r.group === g).sort((a, b) => a.groupRank! - b.groupRank!);
        // 1º: no máximo 1 derrota; 4º: 2 derrotas; classificados (top 2) perderam no máximo 1
        expect(losses.get(rows[0].participantId) ?? 0).toBeLessThanOrEqual(1);
        expect(losses.get(rows[1].participantId) ?? 0).toBeLessThanOrEqual(1);
        expect(losses.get(rows[3].participantId) ?? 0).toBe(2);
      }
    }
  });

  it("usa o Bo decisivo nas partidas de vencedores e decisiva", () => {
    const built = buildStage(gsl({ bestOf: 1, decisiveBestOf: 3 }), ids(4));
    const bo = Object.fromEntries(built.specs.map((s) => [s.key, s.bestOf]));
    expect(bo).toEqual({ "G1-OM1": 1, "G1-OM2": 1, "G1-WM": 3, "G1-EM": 1, "G1-DM": 3 });
  });
});

describe("resultFor helper", () => {
  it("gera placares válidos", () => {
    expect(resultFor(3, "a")).toMatchObject({ scoreA: 2, scoreB: 0 });
    expect(resultFor(1, "b")).toMatchObject({ winner: "b" });
  });
});
