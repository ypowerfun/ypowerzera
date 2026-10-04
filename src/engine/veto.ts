/**
 * Veto/pick de mapas (CS2, CS:GO, Valorant...). Máquina de estados pura.
 * Sequência: 1 ban cada, picks alternados, bans restantes; o mapa que sobra é o "decider".
 */

export type Team = "a" | "b";
export type VetoAction = "ban" | "pick";

export interface VetoStep {
  action: VetoAction;
  team: Team;
}

export interface VetoState {
  pool: string[];
  bestOf: number;
  steps: VetoStep[];
  /** Histórico de ações já realizadas, na ordem. */
  history: Array<VetoStep & { map: string }>;
}

export interface VetoMapResult {
  map: string;
  /** Quem escolheu o mapa. "decider" = sobrou do veto. */
  pickedBy: Team | "decider";
  /** Quem escolhe o lado: o time que NÃO escolheu o mapa. No decider, definido por regra do torneio. */
  sideChosenBy: Team | "rule";
}

export function vetoSteps(poolSize: number, bestOf: number, first: Team = "a"): VetoStep[] {
  const other: Team = first === "a" ? "b" : "a";
  const alt = (i: number): Team => (i % 2 === 0 ? first : other);
  if (![1, 3, 5].includes(bestOf)) throw new Error("Veto suportado apenas para Bo1, Bo3 e Bo5.");
  const picks = bestOf === 1 ? 0 : bestOf - 1;
  const initialBans = bestOf === 1 ? 0 : 2;
  const totalActions = poolSize - 1;
  const finalBans = totalActions - picks - initialBans;
  if (finalBans < 0 || (bestOf === 1 && poolSize < 2)) {
    throw new Error(`Pool de ${poolSize} mapas é pequeno para uma melhor de ${bestOf}.`);
  }
  const steps: VetoStep[] = [];
  if (bestOf === 1) {
    for (let i = 0; i < totalActions; i++) steps.push({ action: "ban", team: alt(i) });
    return steps;
  }
  for (let i = 0; i < initialBans; i++) steps.push({ action: "ban", team: alt(i) });
  for (let i = 0; i < picks; i++) steps.push({ action: "pick", team: alt(i) });
  for (let i = 0; i < finalBans; i++) steps.push({ action: "ban", team: alt(i) });
  return steps;
}

export function createVeto(pool: readonly string[], bestOf: number, first: Team = "a"): VetoState {
  const unique = [...new Set(pool)];
  return { pool: unique, bestOf, steps: vetoSteps(unique.length, bestOf, first), history: [] };
}

export function nextStep(state: VetoState): VetoStep | null {
  return state.steps[state.history.length] ?? null;
}

export function availableMaps(state: VetoState): string[] {
  const used = new Set(state.history.map((h) => h.map));
  return state.pool.filter((m) => !used.has(m));
}

export function isVetoComplete(state: VetoState): boolean {
  return state.history.length >= state.steps.length;
}

export function applyVeto(state: VetoState, team: Team, map: string): VetoState {
  const step = nextStep(state);
  if (!step) throw new Error("O veto já foi concluído.");
  if (step.team !== team) throw new Error("Não é a sua vez no veto.");
  if (!availableMaps(state).includes(map)) throw new Error("Mapa indisponível.");
  return { ...state, history: [...state.history, { ...step, map }] };
}

/** Mapas jogados, na ordem, após o término do veto. */
export function vetoResult(state: VetoState): VetoMapResult[] {
  if (!isVetoComplete(state)) throw new Error("Veto incompleto.");
  const out: VetoMapResult[] = state.history
    .filter((h) => h.action === "pick")
    .map((h) => ({ map: h.map, pickedBy: h.team, sideChosenBy: h.team === "a" ? "b" : "a" }));
  const decider = availableMaps(state)[0];
  if (decider) out.push({ map: decider, pickedBy: "decider", sideChosenBy: "rule" });
  // Bo1: só o decider
  return out;
}
