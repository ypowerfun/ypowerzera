import { describe, expect, it } from "vitest";
import {
  generateDoubleElimination,
  generateSingleElimination,
  nextPowerOfTwo,
  resolveMatches,
  stageStandings,
  isStageComplete,
  type DoubleEliminationSettings,
  type SingleEliminationSettings,
} from "@/engine";
import { ids, simulateStage, seedNumber } from "./helpers";

const se = (extra: Partial<SingleEliminationSettings> = {}): SingleEliminationSettings => ({
  type: "SINGLE_ELIMINATION",
  bestOf: { default: 3, finals: 5 },
  thirdPlaceMatch: false,
  ...extra,
});
const de = (extra: Partial<DoubleEliminationSettings> = {}): DoubleEliminationSettings => ({
  type: "DOUBLE_ELIMINATION",
  bestOf: { default: 3, finals: 5 },
  grandFinalReset: true,
  ...extra,
});

describe("eliminação simples", () => {
  it("gera o número certo de partidas e de byes", () => {
    const specs = generateSingleElimination(ids(6), { bestOf: { default: 1 }, thirdPlaceMatch: false });
    expect(specs.length).toBe(7); // chave de 8
    const resolved = resolveMatches(specs.map((s) => ({ ...s })));
    const byes = [...resolved.values()].filter((m) => m.status === "bye");
    expect(byes.length).toBe(2);
    // seeds 1 e 2 recebem os byes
    expect(byes.map((m) => (m.winner as { id: string }).id).sort()).toEqual(["p1", "p2"]);
  });

  it("aplica melhor-de-N por fase", () => {
    const specs = generateSingleElimination(ids(8), { bestOf: { default: 1, quarterfinals: 3, semifinals: 3, finals: 5 }, thirdPlaceMatch: true });
    const bo = (k: string) => specs.find((s) => s.key === k)!.bestOf;
    expect(bo("W1-1")).toBe(3); // quartas (8 times: 3 rodadas)
    expect(bo("W2-1")).toBe(3);
    expect(bo("W3-1")).toBe(5);
    expect(bo("T-1")).toBe(1);
  });

  it("recusa menos de 2 participantes", () => {
    expect(() => generateSingleElimination(ids(1), { bestOf: { default: 1 }, thirdPlaceMatch: false })).toThrow();
  });

  for (let n = 2; n <= 40; n++) {
    it(`simula ${n} participantes: n-1 partidas, campeão = seed 1 (chalk)`, () => {
      const sim = simulateStage(se(), ids(n), "chalk");
      expect(isStageComplete(sim.input)).toBe(true);
      expect(sim.played.length).toBe(n - 1);
      const standings = stageStandings(sim.input);
      expect(standings.length).toBe(n);
      expect(standings[0].participantId).toBe("p1");
      if (n >= 2) expect(standings[1].participantId).toBe("p2");
      // ranks monotônicos e todos presentes
      const ranks = standings.map((s) => s.rank);
      expect([...ranks].sort((a, b) => a - b)).toEqual(ranks);
      expect(new Set(standings.map((s) => s.participantId)).size).toBe(n);
    });
  }

  it("campeão é o vencedor da final com resultados aleatórios", () => {
    for (let n = 3; n <= 20; n++) {
      const sim = simulateStage(se(), ids(n), "random", "x", `r${n}`);
      const rounds = Math.log2(nextPowerOfTwo(n));
      const final = sim.resolved.get(`W${rounds}-1`)!;
      const standings = stageStandings(sim.input);
      expect(standings[0].participantId).toBe((final.winner as { id: string }).id);
      expect(standings[1].participantId).toBe((final.loser as { id: string }).id);
    }
  });

  it("com disputa de 3º lugar, define 3º e 4º", () => {
    const sim = simulateStage(se({ thirdPlaceMatch: true }), ids(8), "chalk");
    const st = stageStandings(sim.input);
    expect(st.slice(0, 4).map((s) => s.participantId)).toEqual(["p1", "p2", "p3", "p4"]);
    expect(st.slice(0, 4).map((s) => s.rank)).toEqual([1, 2, 3, 4]);
    expect(st.slice(4).every((s) => s.rank === 5 && s.tied)).toBe(true);
  });

  it("sem disputa de 3º, os semifinalistas empatam em 3º", () => {
    const sim = simulateStage(se(), ids(8), "chalk");
    const st = stageStandings(sim.input);
    expect(st.filter((s) => s.rank === 3).length).toBe(2);
  });

  it("seeds melhores só se encontram nas fases finais (chalk)", () => {
    const sim = simulateStage(se(), ids(16), "chalk");
    const r1 = sim.played.filter((p) => p.spec.round === 1);
    expect(r1.map((p) => [seedNumber(p.a), seedNumber(p.b)].sort((x, y) => x - y).join("v")).sort()).toEqual(
      ["1v16", "2v15", "3v14", "4v13", "5v12", "6v11", "7v10", "8v9"].sort(),
    );
    const semis = sim.played.filter((p) => p.spec.round === 3).map((p) => [seedNumber(p.a), seedNumber(p.b)].sort((x, y) => x - y).join("v"));
    expect(semis.sort()).toEqual(["1v4", "2v3"]);
  });
});

describe("eliminação dupla", () => {
  it("exige ao menos 3 participantes", () => {
    expect(() => generateDoubleElimination(ids(2), { bestOf: { default: 1 }, grandFinalReset: true })).toThrow();
  });

  it("estrutura de 8: 7 vencedores + 6 perdedores + GF + reset", () => {
    const specs = generateDoubleElimination(ids(8), { bestOf: { default: 1 }, grandFinalReset: true });
    expect(specs.filter((s) => s.bracket === "W").length).toBe(7);
    expect(specs.filter((s) => s.bracket === "L").length).toBe(6);
    expect(specs.filter((s) => s.bracket === "GF").length).toBe(2);
    const lRounds = [...new Set(specs.filter((s) => s.bracket === "L").map((s) => s.round))].sort();
    expect(lRounds).toEqual([1, 2, 3, 4]);
  });

  it("estrutura de 16: 15 + 14 + 2", () => {
    const specs = generateDoubleElimination(ids(16), { bestOf: { default: 1 }, grandFinalReset: true });
    expect(specs.filter((s) => s.bracket === "W").length).toBe(15);
    expect(specs.filter((s) => s.bracket === "L").length).toBe(14);
  });

  it("sem reset, não gera GF-2", () => {
    const specs = generateDoubleElimination(ids(8), { bestOf: { default: 1 }, grandFinalReset: false });
    expect(specs.some((s) => s.key === "GF-2")).toBe(false);
  });

  for (let n = 3; n <= 40; n++) {
    it(`simula ${n} participantes (chalk): 2n-2 partidas, campeão seed 1, sem reset`, () => {
      const sim = simulateStage(de(), ids(n), "chalk");
      expect(isStageComplete(sim.input)).toBe(true);
      expect(sim.played.length).toBe(2 * n - 2);
      expect(sim.resolved.get("GF-2")!.status).toBe("skipped");
      const st = stageStandings(sim.input);
      expect(st[0].participantId).toBe("p1");
      expect(st[1].participantId).toBe("p2");
      expect(st.length).toBe(n);
    });

    it(`simula ${n} participantes (aleatório): invariantes de dupla eliminação`, () => {
      for (let rep = 0; rep < 3; rep++) {
        const sim = simulateStage(de(), ids(n), "random", "x", `de-${n}-${rep}`);
        expect(isStageComplete(sim.input)).toBe(true);
        const gf2Played = sim.played.some((p) => p.spec.key === "GF-2");
        expect(sim.played.length).toBe(2 * n - 2 + (gf2Played ? 1 : 0));

        const losses = new Map<string, number>();
        for (const p of sim.played) {
          const loser = p.winner === p.a ? p.b : p.a;
          losses.set(loser, (losses.get(loser) ?? 0) + 1);
          expect(p.a).not.toBe(p.b);
        }
        const st = stageStandings(sim.input);
        const champion = st[0].participantId;
        for (const id of ids(n)) {
          const l = losses.get(id) ?? 0;
          if (id === champion) expect(l).toBeLessThanOrEqual(1); // só perde se foi o campeão do reset
          else expect(l).toBe(2);
        }
        // campeão = vencedor da última partida da GF
        const last = gf2Played ? "GF-2" : "GF-1";
        expect((sim.resolved.get(last)!.winner as { id: string }).id).toBe(champion);
      }
    });
  }

  it("reset: campeão da chave inferior precisa vencer duas vezes", () => {
    const specs = generateDoubleElimination(ids(4), { bestOf: { default: 1 }, grandFinalReset: true });
    // força: p1 vence WB, p2 vai pra LB e vence tudo; na GF1 p2 vence -> GF2 necessária
    const results = new Map<string, "a" | "b">();
    const play = (map: Map<string, "a" | "b">) =>
      resolveMatches(specs.map((s) => ({ ...s, result: map.has(s.key) ? { scoreA: map.get(s.key) === "a" ? 1 : 0, scoreB: map.get(s.key) === "b" ? 1 : 0, winner: map.get(s.key)! } : null })));
    results.set("W1-1", "a"); // p1 > p4
    results.set("W1-2", "a"); // p2 > p3
    results.set("W2-1", "a"); // p1 > p2
    results.set("L1-1", "b"); // p4 vs p3 -> p3 ... (a = perdedor W1-1 = p4, b = perdedor W1-2 = p3)
    results.set("L2-1", "a"); // vencedor L1 (p3) vs perdedor W2-1 (p2) -> a = p3 ... queremos p2: use b
    let r = play(results);
    expect(r.get("L2-1")!.status).toBe("completed");
    results.set("L2-1", "b"); // p2 vence
    r = play(results);
    results.set("GF-1", "b"); // LB champ (p2) vence a primeira
    r = play(results);
    expect(r.get("GF-2")!.status).toBe("ready");
    results.set("GF-2", "a");
    r = play(results);
    expect(r.get("GF-2")!.status).toBe("completed");
  });

  it("chave dos perdedores do 8: evita revanche imediata da R2 (chalk)", () => {
    const sim = simulateStage(de(), ids(8), "chalk");
    const l2 = sim.played.filter((p) => p.spec.key.startsWith("L2-"));
    // cada partida L2 enfrenta um vencedor da L1 contra um perdedor da W2; em chalk não deve haver rematch com W1
    for (const m of l2) {
      const earlier = sim.played.filter((p) => p.spec.round === 1 && p.spec.bracket === "W");
      const met = earlier.some((p) => [p.a, p.b].includes(m.a) && [p.a, p.b].includes(m.b));
      expect(met).toBe(false);
    }
  });
});
