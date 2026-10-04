import { describe, expect, it } from "vitest";
import {
  applyVeto,
  availableMaps,
  bracketOrder,
  buildStage,
  createVeto,
  eliminationStandings,
  isStageComplete,
  isVetoComplete,
  nextPowerOfTwo,
  nextStep,
  selectAdvancing,
  stageStandings,
  vetoResult,
  vetoSteps,
  type DoubleEliminationSettings,
  type GslSettings,
  type RoundRobinSettings,
  type StandingRow,
  type SwissSettings,
  type SingleEliminationSettings,
} from "@/engine";
import { ids, simulateStage } from "./helpers";

const row = (id: string, group: number, groupRank: number, rank: number): StandingRow => ({
  participantId: id,
  rank,
  group,
  groupRank,
  played: 0,
  wins: 0,
  draws: 0,
  losses: 0,
  points: 0,
  scoreFor: 0,
  scoreAgainst: 0,
  diff: 0,
});

function groupRows(G: number, K: number): StandingRow[] {
  const rows: StandingRow[] = [];
  let rank = 0;
  for (let t = 1; t <= K; t++) for (let g = 1; g <= G; g++) rows.push(row(`g${g}t${t}`, g, t, ++rank));
  return rows;
}

describe("avanço entre fases", () => {
  it("count: pega os N melhores", () => {
    const rows = ids(8).map((id, i) => row(id, 1, i + 1, i + 1));
    expect(selectAdvancing(rows, { count: 4 })).toEqual(["p1", "p2", "p3", "p4"]);
    expect(selectAdvancing(rows, undefined).length).toBe(8);
  });

  for (const G of [2, 3, 4, 6, 8]) {
    for (const K of [1, 2, 3, 4]) {
      const n = G * K;
      if (n < 4) continue;
      it(`${G} grupos × top ${K}: ninguém enfrenta colega de grupo na 1ª rodada`, () => {
        const advancing = selectAdvancing(groupRows(G, K), { perGroup: K });
        expect(advancing.length).toBe(n);
        expect(new Set(advancing).size).toBe(n);
        const size = nextPowerOfTwo(n);
        const order = bracketOrder(size);
        const groupOf = (id: string) => id.match(/^g(\d+)/)![1];
        for (let i = 0; i < size; i += 2) {
          const a = order[i] - 1;
          const b = order[i + 1] - 1;
          if (a < n && b < n) expect(groupOf(advancing[a])).not.toBe(groupOf(advancing[b]));
        }
        // 1ºs colocados ficam nos melhores seeds
        const firsts = advancing.slice(0, G);
        expect(firsts.every((id) => id.endsWith("t1"))).toBe(true);
      });
    }
  }
});

describe("fluxo multi-estágio: GSL → eliminação dupla", () => {
  it("16 times, 4 grupos GSL, 8 avançam para a dupla eliminação e geram campeão", () => {
    const gsl: GslSettings = { type: "GSL", bestOf: 3, groupAssignment: "snake" };
    const g = simulateStage(gsl, ids(16), "random", "g", "multi");
    expect(isStageComplete(g.input)).toBe(true);
    const advancing = selectAdvancing(stageStandings(g.input), { perGroup: 2 });
    expect(advancing.length).toBe(8);
    const de: DoubleEliminationSettings = { type: "DOUBLE_ELIMINATION", bestOf: { default: 3, finals: 5 }, grandFinalReset: true };
    const po = simulateStage(de, advancing, "random", "p", "multi-po");
    expect(isStageComplete(po.input)).toBe(true);
    expect(stageStandings(po.input)[0].participantId).toBeTruthy();
    expect(po.played.length).toBeGreaterThanOrEqual(14);
  });

  it("VCT-like: 2 grupos de 6 (pontos corridos), top 4 → dupla eliminação de 8", () => {
    const rr: RoundRobinSettings = {
      type: "ROUND_ROBIN",
      groups: 2,
      legs: 1,
      bestOf: 3,
      allowDraw: false,
      points: { win: 1, draw: 0, loss: 0 },
      tiebreakers: ["points", "h2hPoints", "diff", "seed"],
      groupAssignment: "snake",
    };
    const g = simulateStage(rr, ids(12), "random", "g", "vct");
    const advancing = selectAdvancing(stageStandings(g.input), { perGroup: 4 });
    expect(advancing.length).toBe(8);
    const de: DoubleEliminationSettings = { type: "DOUBLE_ELIMINATION", bestOf: { default: 3 }, grandFinalReset: true };
    const built = buildStage(de, advancing);
    // nenhum confronto de 1ª rodada entre colegas de grupo
    const standings = stageStandings(g.input);
    const groupOf = new Map(standings.map((r) => [r.participantId, r.group]));
    for (const s of built.specs.filter((x) => x.round === 1 && x.bracket === "W")) {
      const a = (s.a as { id: string }).id;
      const b = (s.b as { id: string }).id;
      expect(groupOf.get(a)).not.toBe(groupOf.get(b));
    }
  });

  it("Worlds-like: Swiss 16 (3-3, Bo1/Bo3) → eliminação simples Bo5 com 8", () => {
    const swiss: SwissSettings = {
      type: "SWISS",
      mode: "winLoss",
      winsToAdvance: 3,
      lossesToEliminate: 3,
      bestOf: 1,
      decisiveBestOf: 3,
      allowDraw: false,
      points: { win: 1, draw: 0, loss: 0 },
      tiebreakers: ["points", "buchholz", "seed"],
    };
    const sw = simulateStage(swiss, ids(16), "random", "s", "worlds");
    const qualified = selectAdvancing(stageStandings(sw.input), { count: 8 });
    expect(qualified.length).toBe(8);
    const se: SingleEliminationSettings = { type: "SINGLE_ELIMINATION", bestOf: { default: 5 }, thirdPlaceMatch: false };
    const ko = simulateStage(se, qualified, "random", "k", "worlds-ko");
    expect(ko.played.length).toBe(7);
    expect(ko.played.every((p) => p.spec.bestOf === 5)).toBe(true);
  });
});

describe("placements", () => {
  it("eliminationStandings tolera chave incompleta (vivos ficam acima)", () => {
    const built = buildStage({ type: "SINGLE_ELIMINATION", bestOf: { default: 1 }, thirdPlaceMatch: false }, ids(4));
    const st = eliminationStandings("SINGLE", ids(4), built.specs, new Map());
    expect(st.length).toBe(4);
  });
});

describe("veto de mapas", () => {
  const pool = ["Mirage", "Inferno", "Nuke", "Ancient", "Anubis", "Dust2", "Overpass"];

  it("sequências padrão", () => {
    const fmt = (steps: ReturnType<typeof vetoSteps>) => steps.map((s) => `${s.action}:${s.team}`).join(" ");
    expect(fmt(vetoSteps(7, 1))).toBe("ban:a ban:b ban:a ban:b ban:a ban:b");
    expect(fmt(vetoSteps(7, 3))).toBe("ban:a ban:b pick:a pick:b ban:a ban:b");
    expect(fmt(vetoSteps(7, 5))).toBe("ban:a ban:b pick:a pick:b pick:a pick:b");
  });

  it("recusa pool pequeno demais", () => {
    expect(() => vetoSteps(5, 5)).toThrow();
    expect(() => vetoSteps(7, 2)).toThrow();
  });

  it("Bo3 completo: picks, decider e escolha de lado", () => {
    let v = createVeto(pool, 3);
    const play = (team: "a" | "b", map: string) => (v = applyVeto(v, team, map));
    play("a", "Overpass");
    play("b", "Dust2");
    play("a", "Mirage");
    play("b", "Inferno");
    expect(isVetoComplete(v)).toBe(false);
    play("a", "Nuke");
    play("b", "Anubis");
    expect(isVetoComplete(v)).toBe(true);
    const res = vetoResult(v);
    expect(res.map((r) => r.map)).toEqual(["Mirage", "Inferno", "Ancient"]);
    expect(res[0]).toMatchObject({ pickedBy: "a", sideChosenBy: "b" });
    expect(res[1]).toMatchObject({ pickedBy: "b", sideChosenBy: "a" });
    expect(res[2]).toMatchObject({ pickedBy: "decider", sideChosenBy: "rule" });
  });

  it("valida vez e mapa", () => {
    const v = createVeto(pool, 1);
    expect(nextStep(v)).toEqual({ action: "ban", team: "a" });
    expect(() => applyVeto(v, "b", "Mirage")).toThrow(/vez/);
    expect(() => applyVeto(v, "a", "Vertigo")).toThrow(/indispon/);
    const v2 = applyVeto(v, "a", "Mirage");
    expect(availableMaps(v2)).not.toContain("Mirage");
    expect(() => applyVeto(v2, "b", "Mirage")).toThrow(/indispon/);
  });

  it("Bo1 deixa 1 mapa", () => {
    let v = createVeto(pool, 1, "b");
    const order: Array<"a" | "b"> = ["b", "a", "b", "a", "b", "a"];
    for (const t of order) v = applyVeto(v, t, availableMaps(v)[0]);
    expect(isVetoComplete(v)).toBe(true);
    expect(vetoResult(v)).toHaveLength(1);
  });
});
