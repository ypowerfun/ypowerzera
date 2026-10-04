import type { Entrant, MatchInput, ResolvedMatch, SlotSource } from "./types";

const PENDING: Entrant = { kind: "pending" };
const BYE: Entrant = { kind: "bye" };

export function isParticipant(e: Entrant): e is { kind: "participant"; id: string } {
  return e.kind === "participant";
}

export function entrantId(e: Entrant): string | null {
  return e.kind === "participant" ? e.id : null;
}

/**
 * Resolve o estado de todas as partidas de um estágio a partir dos resultados.
 * - Propaga vencedores/perdedores pelas origens de vaga.
 * - Trata BYEs (vaga que nunca será ocupada): a partida vira "bye" e o outro lado avança.
 * - Trata a partida condicional (reset da grande final).
 */
export function resolveMatches(matches: readonly MatchInput[]): Map<string, ResolvedMatch> {
  const byKey = new Map<string, MatchInput>();
  for (const m of matches) byKey.set(m.key, m);

  const memo = new Map<string, ResolvedMatch>();
  const visiting = new Set<string>();

  const entrantOf = (src: SlotSource): Entrant => {
    switch (src.kind) {
      case "participant":
        return { kind: "participant", id: src.id };
      case "bye":
        return BYE;
      case "winner":
        return resolveOne(src.match).winner;
      case "loser":
        return resolveOne(src.match).loser;
      case "slotA":
        return resolveOne(src.match).entrantA;
      case "slotB":
        return resolveOne(src.match).entrantB;
    }
  };

  function resolveOne(key: string): ResolvedMatch {
    const hit = memo.get(key);
    if (hit) return hit;
    const m = byKey.get(key);
    if (!m) throw new Error(`Partida inexistente referenciada: ${key}`);
    if (visiting.has(key)) throw new Error(`Ciclo de dependência na partida ${key}`);
    visiting.add(key);

    const entrantA = entrantOf(m.a);
    const entrantB = entrantOf(m.b);
    const result = m.result ?? null;
    let out: ResolvedMatch;

    // Partida condicional (reset da final): só existe se o lado B venceu a partida de referência.
    if (m.onlyIfWinner) {
      const dep = resolveOne(m.onlyIfWinner.match);
      if (dep.status === "completed" && dep.result?.winner !== m.onlyIfWinner.side) {
        out = {
          key,
          status: "skipped",
          entrantA,
          entrantB,
          winner: dep.winner,
          loser: dep.loser,
          result: null,
        };
        visiting.delete(key);
        memo.set(key, out);
        return out;
      }
      if (dep.status !== "completed") {
        out = { key, status: "pending", entrantA, entrantB, winner: PENDING, loser: PENDING, result: null };
        visiting.delete(key);
        memo.set(key, out);
        return out;
      }
    }

    if (entrantA.kind === "bye" && entrantB.kind === "bye") {
      out = { key, status: "bye", entrantA, entrantB, winner: BYE, loser: BYE, result: null };
    } else if (entrantA.kind === "bye") {
      out =
        entrantB.kind === "participant"
          ? { key, status: "bye", entrantA, entrantB, winner: entrantB, loser: BYE, result: null }
          : { key, status: "pending", entrantA, entrantB, winner: PENDING, loser: PENDING, result: null };
    } else if (entrantB.kind === "bye") {
      out =
        entrantA.kind === "participant"
          ? { key, status: "bye", entrantA, entrantB, winner: entrantA, loser: BYE, result: null }
          : { key, status: "pending", entrantA, entrantB, winner: PENDING, loser: PENDING, result: null };
    } else if (entrantA.kind === "pending" || entrantB.kind === "pending") {
      out = { key, status: "pending", entrantA, entrantB, winner: PENDING, loser: PENDING, result: null };
    } else if (!result) {
      out = { key, status: "ready", entrantA, entrantB, winner: PENDING, loser: PENDING, result: null };
    } else if (result.winner === "a") {
      out = { key, status: "completed", entrantA, entrantB, winner: entrantA, loser: entrantB, result };
    } else if (result.winner === "b") {
      out = { key, status: "completed", entrantA, entrantB, winner: entrantB, loser: entrantA, result };
    } else {
      // empate: ninguém avança por esta partida
      out = { key, status: "completed", entrantA, entrantB, winner: PENDING, loser: PENDING, result };
    }

    visiting.delete(key);
    memo.set(key, out);
    return out;
  }

  for (const m of matches) resolveOne(m.key);
  return memo;
}

/** Partidas jogáveis agora (as duas vagas preenchidas, sem resultado). */
export function readyMatches(resolved: Map<string, ResolvedMatch>): ResolvedMatch[] {
  return [...resolved.values()].filter((m) => m.status === "ready");
}

/** Todas as partidas estão encerradas (concluídas, bye ou puladas)? */
export function allSettled(resolved: Map<string, ResolvedMatch>): boolean {
  for (const m of resolved.values()) {
    if (m.status === "pending" || m.status === "ready") return false;
  }
  return true;
}
