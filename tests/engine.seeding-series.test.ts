import { describe, expect, it } from "vitest";
import {
  bracketOrder,
  createRng,
  firstTo,
  nextPowerOfTwo,
  orderSeeds,
  shuffle,
  snakeDistribute,
  validateScore,
} from "@/engine";

describe("seeding", () => {
  it("gera a ordem padrão de chave", () => {
    expect(bracketOrder(2)).toEqual([1, 2]);
    expect(bracketOrder(4)).toEqual([1, 4, 2, 3]);
    expect(bracketOrder(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6]);
    expect(bracketOrder(16).slice(0, 8)).toEqual([1, 16, 8, 9, 4, 13, 5, 12]);
  });

  it("rejeita tamanhos que não são potência de 2", () => {
    expect(() => bracketOrder(6)).toThrow();
  });

  it("calcula a próxima potência de 2", () => {
    expect([1, 2, 3, 5, 8, 9, 33].map(nextPowerOfTwo)).toEqual([1, 2, 4, 8, 8, 16, 64]);
  });

  it("distribui em cobra", () => {
    expect(snakeDistribute([1, 2, 3, 4, 5, 6, 7, 8], 2)).toEqual([
      [1, 4, 5, 8],
      [2, 3, 6, 7],
    ]);
    expect(snakeDistribute([1, 2, 3, 4, 5, 6], 3)).toEqual([[1, 6], [2, 5], [3, 4]]);
  });

  it("sorteio é determinístico e independe da ordem de entrada", () => {
    const c = ["a", "b", "c", "d", "e", "f"].map((id) => ({ id }));
    const x = orderSeeds(c, "random", "salt-1");
    const y = orderSeeds([...c].reverse(), "random", "salt-1");
    expect(x).toEqual(y);
    expect(orderSeeds(c, "random", "salt-2")).not.toEqual(x);
    expect([...x].sort()).toEqual(["a", "b", "c", "d", "e", "f"]);
  });

  it("ordena por seed manual e rating", () => {
    const c = [
      { id: "a", seed: 3, rating: 10 },
      { id: "b", seed: 1, rating: 30 },
      { id: "c", seed: null, rating: 20 },
      { id: "d", seed: 2, rating: null },
    ];
    expect(orderSeeds(c, "manual")).toEqual(["b", "d", "a", "c"]);
    expect(orderSeeds(c, "rating")).toEqual(["b", "c", "a", "d"]);
  });

  it("shuffle preserva os elementos", () => {
    const out = shuffle([1, 2, 3, 4, 5], createRng("x"));
    expect([...out].sort()).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("validateScore", () => {
  it("Bo1 aceita placar livre e recusa empate por padrão", () => {
    expect(validateScore(1, 13, 9)).toEqual({ ok: true, winner: "a" });
    expect(validateScore(1, 2, 3)).toEqual({ ok: true, winner: "b" });
    expect(validateScore(1, 1, 1).ok).toBe(false);
    expect(validateScore(1, 1, 1, { allowDraw: true })).toEqual({ ok: true, winner: null });
  });

  it("Bo3 e Bo5 exigem chegar ao número de vitórias", () => {
    expect(firstTo(3)).toBe(2);
    expect(firstTo(5)).toBe(3);
    expect(validateScore(3, 2, 1)).toEqual({ ok: true, winner: "a" });
    expect(validateScore(3, 0, 2)).toEqual({ ok: true, winner: "b" });
    expect(validateScore(3, 1, 1).ok).toBe(false);
    expect(validateScore(3, 2, 2).ok).toBe(false);
    expect(validateScore(3, 3, 0).ok).toBe(false);
    expect(validateScore(5, 3, 2)).toEqual({ ok: true, winner: "a" });
    expect(validateScore(5, 2, 2).ok).toBe(false);
  });

  it("recusa valores inválidos", () => {
    expect(validateScore(3, -1, 2).ok).toBe(false);
    expect(validateScore(3, 1.5, 2).ok).toBe(false);
    expect(validateScore(1, 1000, 1).ok).toBe(false);
    expect(validateScore(2, 1, 1).ok).toBe(false);
  });
});
