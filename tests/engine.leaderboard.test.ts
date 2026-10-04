import { describe, expect, it } from "vitest";
import {
  computeLeaderboard,
  planLobbies,
  placementMultiplier,
  scoreGame,
  type BrResultInput,
  type LeaderboardSettings,
} from "@/engine";
import { ids } from "./helpers";

const ALGS = [12, 9, 7, 5, 4, 3, 3, 2, 2, 2, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0];

const algs = (extra: Partial<LeaderboardSettings> = {}): LeaderboardSettings => ({
  type: "LEADERBOARD",
  games: 6,
  lobbySize: 20,
  lobbyAssignment: "fixed",
  scoring: { formula: "additive", placementPoints: ALGS, killPoints: 1 },
  tiebreakers: ["points", "wins", "kills", "bestPlacement", "seed"],
  ...extra,
});

describe("pontuação", () => {
  it("ALGS: colocação + 1 ponto por abate", () => {
    const s = algs().scoring;
    expect(scoreGame(s, 1, 5)).toBe(17);
    expect(scoreGame(s, 2, 0)).toBe(9);
    expect(scoreGame(s, 8, 3)).toBe(5);
    expect(scoreGame(s, 16, 4)).toBe(4);
    expect(scoreGame(s, 25, 2)).toBe(2); // além da tabela: só abates
  });

  it("Warzone Trios (WSOW 2024): abates × multiplicador de colocação", () => {
    const scoring = {
      formula: "multiplier" as const,
      killPoints: 1,
      placementPoints: [],
      placementMultipliers: [
        { from: 1, to: 1, multiplier: 2 },
        { from: 2, to: 5, multiplier: 1.8 },
        { from: 6, to: 10, multiplier: 1.6 },
        { from: 11, to: 15, multiplier: 1.4 },
        { from: 16, to: 25, multiplier: 1.2 },
      ],
    };
    expect(scoreGame(scoring, 1, 10)).toBe(20);
    expect(scoreGame(scoring, 2, 10)).toBe(18);
    expect(scoreGame(scoring, 7, 5)).toBe(8);
    expect(scoreGame(scoring, 30, 5)).toBe(5);
    expect(scoreGame(scoring, 1, 0)).toBe(0);
    expect(placementMultiplier(scoring, 12)).toBe(1.4);
  });

  it("bônus de Victory Royale", () => {
    const s = { formula: "additive" as const, placementPoints: [10], killPoints: 2, victoryBonus: 3 };
    expect(scoreGame(s, 1, 2)).toBe(17);
    expect(scoreGame(s, 2, 2)).toBe(4);
  });
});

const game = (round: number, order: string[], kills: Record<string, number> = {}, lobby = 1): BrResultInput[] =>
  order.map((id, i) => ({ round, lobby, participantId: id, placement: i + 1, kills: kills[id] ?? 0 }));

describe("classificação do leaderboard", () => {
  const p = ids(5);

  it("soma pontos e ordena; desempata por vitórias, abates e seed", () => {
    const results = [...game(1, ["p1", "p2", "p3", "p4", "p5"], { p2: 3 }), ...game(2, ["p2", "p1", "p3", "p4", "p5"])];
    const lb = computeLeaderboard(p, results, algs());
    // p1: 12 + 9 = 21 | p2: 9+3 + 12 = 24
    expect(lb.rows[0].participantId).toBe("p2");
    expect(lb.rows[0].points).toBe(24);
    expect(lb.rows[1].participantId).toBe("p1");
    expect(lb.rows[0].wins).toBe(1);
    expect(lb.roundsPlayed).toBe(2);
    expect(lb.finished).toBe(false);
  });

  it("empate em pontos: mais vitórias vence; depois abates", () => {
    // p1 e p2 terminam com 21 pontos
    const results = [
      ...game(1, ["p1", "p2", "p3", "p4", "p5"], { p2: 0 }),
      ...game(2, ["p2", "p1", "p3", "p4", "p5"]),
    ];
    const lb = computeLeaderboard(p, results, algs());
    expect(lb.rows[0].points).toBe(21);
    expect(lb.rows[1].points).toBe(21);
    // ambos 1 vitória, 0 abates, melhor colocação 1 → seed
    expect(lb.rows[0].participantId).toBe("p1");
  });

  it("termina ao atingir o número de partidas", () => {
    const results = [1, 2, 3].flatMap((r) => game(r, ["p1", "p2", "p3", "p4", "p5"]));
    expect(computeLeaderboard(p, results, algs({ games: 3 })).finished).toBe(true);
    expect(computeLeaderboard(p, results, algs({ games: 4 })).finished).toBe(false);
  });
});

describe("match point (ALGS 50 / TFT Checkmate)", () => {
  const settings = algs({ games: 20, matchPoint: { threshold: 50, requireWin: true } });
  const p = ids(4);

  it("atingir o limite NÃO basta: precisa vencer depois", () => {
    // p1 vence 5 partidas seguidas: 12×4 = 48 (+ abates). Na 5ª já atinge >= 50 mas só estava elegível depois.
    const results = [
      ...game(1, ["p1", "p2", "p3", "p4"], { p1: 2 }), // p1: 14
      ...game(2, ["p1", "p2", "p3", "p4"], { p1: 2 }), // 28
      ...game(3, ["p1", "p2", "p3", "p4"], { p1: 2 }), // 42
      ...game(4, ["p1", "p2", "p3", "p4"], { p1: 2 }), // 56 → elegível a partir da rodada 5
    ];
    let lb = computeLeaderboard(p, results, settings);
    expect(lb.champion).toBeNull();
    expect(lb.rows.find((r) => r.participantId === "p1")!.matchPointEligible).toBe(true);
    expect(lb.finished).toBe(false);

    // p2 vence a rodada 5: não encerra, p1 ainda é elegível
    lb = computeLeaderboard(p, [...results, ...game(5, ["p2", "p1", "p3", "p4"])], settings);
    expect(lb.champion).toBeNull();

    // p1 vence a rodada 5 já com match point → campeão
    lb = computeLeaderboard(p, [...results, ...game(5, ["p1", "p2", "p3", "p4"])], settings);
    expect(lb.champion).toBe("p1");
    expect(lb.championRound).toBe(5);
    expect(lb.finished).toBe(true);
    expect(lb.rows[0].participantId).toBe("p1");
    expect(lb.rows[0].champion).toBe(true);
  });

  it("campeão pode não ser o líder em pontos: outro time elegível vence", () => {
    const results = [
      ...game(1, ["p1", "p2", "p3", "p4"], { p1: 40 }), // p1: 52 → elegível
      ...game(2, ["p3", "p2", "p1", "p4"]),
    ];
    let lb = computeLeaderboard(p, results, settings);
    expect(lb.champion).toBeNull(); // p3 venceu mas não estava elegível
    lb = computeLeaderboard(p, [...results, ...game(3, ["p2", "p1", "p3", "p4"]), ...game(4, ["p1", "p2", "p3", "p4"])], settings);
    expect(lb.champion).toBe("p1");
  });

  it("TFT Checkmate 20: tabela 8..1", () => {
    const tft = algs({
      games: 8,
      lobbySize: 8,
      scoring: { formula: "additive", placementPoints: [8, 7, 6, 5, 4, 3, 2, 1], killPoints: 0 },
      matchPoint: { threshold: 20, requireWin: true },
    });
    const players = ids(8);
    const r = [1, 2, 3].flatMap((n) => game(n, ["p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8"]));
    // p1 = 24 após 3 jogos: elegível; vence a 4ª → campeão
    const lb = computeLeaderboard(players, [...r, ...game(4, ["p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8"])], tft);
    expect(lb.champion).toBe("p1");
  });
});

describe("lobbies", () => {
  const order = ids(40);

  it("um lobby quando todos cabem", () => {
    expect(planLobbies(ids(8), 8, "swiss", 2, "s")).toEqual([ids(8)]);
  });

  it("divide em lobbies de tamanho equilibrado", () => {
    for (const mode of ["snake", "swiss", "random", "fixed"] as const) {
      for (const round of [1, 2]) {
        const lobbies = planLobbies(order, 8, mode, round, "s");
        expect(lobbies.length).toBe(5);
        expect(lobbies.flat().sort()).toEqual([...order].sort());
        expect(lobbies.every((l) => l.length === 8)).toBe(true);
      }
    }
    const odd = planLobbies(ids(41), 8, "snake", 1, "s");
    expect(odd.length).toBe(6);
    expect(Math.max(...odd.map((l) => l.length)) - Math.min(...odd.map((l) => l.length))).toBeLessThanOrEqual(1);
  });

  it("swiss: lobbies consecutivos pela classificação a partir da rodada 2", () => {
    const lobbies = planLobbies(order, 8, "swiss", 2, "s");
    expect(lobbies[0]).toEqual(order.slice(0, 8));
    expect(lobbies[4]).toEqual(order.slice(32, 40));
  });

  it("snake na rodada 1 equilibra a força", () => {
    const lobbies = planLobbies(order, 8, "swiss", 1, "s");
    expect(lobbies[0][0]).toBe("p1");
    expect(lobbies[4][0]).toBe("p5");
  });

  it("random é determinístico por rodada", () => {
    const a = planLobbies(order, 8, "random", 1, "s");
    const b = planLobbies(order, 8, "random", 1, "s");
    const c = planLobbies(order, 8, "random", 2, "s");
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });
});
