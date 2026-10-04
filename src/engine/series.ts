import type { BestOfRules } from "./types";

export function firstTo(bestOf: number): number {
  return Math.floor(bestOf / 2) + 1;
}

export type ScoreCheck =
  | { ok: true; winner: "a" | "b" | null }
  | { ok: false; error: string };

/**
 * Valida o placar de uma partida.
 * - Bo1: o placar é livre (rounds/gols). Vence quem tem mais; empate só se `allowDraw`.
 * - Bo3/Bo5/...: placar de séries. Vence quem chega a ⌊N/2⌋+1; o outro deve ter menos que isso.
 */
export function validateScore(bestOf: number, a: number, b: number, opts: { allowDraw?: boolean } = {}): ScoreCheck {
  if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0) {
    return { ok: false, error: "O placar deve ser composto por números inteiros não negativos." };
  }
  if (a > 999 || b > 999) return { ok: false, error: "Placar fora do limite." };
  if (bestOf === 1) {
    if (a === b) {
      return opts.allowDraw ? { ok: true, winner: null } : { ok: false, error: "Empates não são permitidos nesta partida." };
    }
    return { ok: true, winner: a > b ? "a" : "b" };
  }
  if (bestOf % 2 === 0) return { ok: false, error: "Melhor-de-N deve ser ímpar." };
  const need = firstTo(bestOf);
  if (a === need && b < need) return { ok: true, winner: "a" };
  if (b === need && a < need) return { ok: true, winner: "b" };
  return {
    ok: false,
    error: `Em uma melhor de ${bestOf}, o vencedor precisa chegar a ${need} vitórias e o outro ter menos que isso.`,
  };
}

export function normalizeBestOf(n: number | undefined, fallback = 1): number {
  if (!n || n < 1) return fallback;
  return n % 2 === 0 ? n + 1 : n;
}

export type RoundRole = "final" | "semifinal" | "quarterfinal" | "other";

export function bestOfForRound(rules: BestOfRules, role: RoundRole): number {
  const v =
    role === "final"
      ? rules.finals
      : role === "semifinal"
        ? rules.semifinals
        : role === "quarterfinal"
          ? rules.quarterfinals
          : undefined;
  return normalizeBestOf(v ?? rules.default, 1);
}

/** Rótulo curto: "Bo3". */
export function bestOfLabel(n: number): string {
  return `Bo${n}`;
}
