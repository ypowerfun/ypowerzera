import type { Id, SeedingMethod } from "./types";
import { createRng, shuffle } from "./rng";

export function nextPowerOfTwo(n: number): number {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

export function isPowerOfTwo(n: number): boolean {
  return n > 0 && (n & (n - 1)) === 0;
}

/**
 * Ordem padrão de seeds numa chave de `size` vagas (potência de 2).
 * Ex.: 8 → [1,8,4,5,2,7,3,6] (pares: 1×8, 4×5, 2×7, 3×6). Seeds 1 e 2 só se cruzam na final.
 */
export function bracketOrder(size: number): number[] {
  if (!isPowerOfTwo(size)) throw new Error(`bracketOrder: ${size} não é potência de 2`);
  let order = [1];
  while (order.length < size) {
    const next = order.length * 2;
    const out: number[] = [];
    for (const s of order) out.push(s, next + 1 - s);
    order = out;
  }
  return order;
}

export interface SeedCandidate {
  id: Id;
  /** Seed manual (menor = melhor). */
  seed?: number | null;
  /** Rating (maior = melhor) — usado no método "rating". */
  rating?: number | null;
}

/**
 * Ordena os candidatos conforme o método de seeding e devolve os ids na ordem de seed (1º = melhor).
 * - manual: respeita `seed`; quem não tem seed vai depois, em ordem estável.
 * - rating: maior rating primeiro; sem rating depois.
 * - random: sorteio determinístico a partir de `salt`.
 */
export function orderSeeds(candidates: readonly SeedCandidate[], method: SeedingMethod, salt = "seed"): Id[] {
  const indexed = candidates.map((c, i) => ({ c, i }));
  if (method === "random") {
    const rng = createRng(salt);
    // ordena por id antes de embaralhar para que o resultado não dependa da ordem de entrada
    const stable = [...candidates].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    return shuffle(stable, rng).map((c) => c.id);
  }
  if (method === "rating") {
    return indexed
      .sort((x, y) => {
        const rx = x.c.rating ?? -Infinity;
        const ry = y.c.rating ?? -Infinity;
        if (rx !== ry) return ry - rx;
        return x.i - y.i;
      })
      .map((x) => x.c.id);
  }
  return indexed
    .sort((x, y) => {
      const sx = x.c.seed ?? Infinity;
      const sy = y.c.seed ?? Infinity;
      if (sx !== sy) return sx - sy;
      return x.i - y.i;
    })
    .map((x) => x.c.id);
}

/**
 * Distribui os seeds em `groups` grupos em "cobra" (snake): 1,2,3,4 | 8,7,6,5 | 9,10,...
 * Mantém os grupos equilibrados em força.
 */
export function snakeDistribute<T>(items: readonly T[], groups: number): T[][] {
  const out: T[][] = Array.from({ length: groups }, () => []);
  items.forEach((item, i) => {
    const row = Math.floor(i / groups);
    const col = i % groups;
    const g = row % 2 === 0 ? col : groups - 1 - col;
    out[g].push(item);
  });
  return out;
}

export function randomDistribute<T>(items: readonly T[], groups: number, salt: string): T[][] {
  const rng = createRng(salt);
  const out: T[][] = Array.from({ length: groups }, () => []);
  shuffle(items, rng).forEach((item, i) => out[i % groups].push(item));
  return out;
}
