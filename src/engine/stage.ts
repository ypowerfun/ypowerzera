import type {
  Id,
  MatchResult,
  MatchSpec,
  ResolvedMatch,
  StageSettings,
  StageType,
  StandingRow,
} from "./types";
import { allSettled, resolveMatches } from "./resolve";
import { generateSingleElimination } from "./single-elimination";
import { generateDoubleElimination } from "./double-elimination";
import { generateRoundRobin } from "./round-robin";
import { generateGsl } from "./gsl";
import { computeSwissState, generateNextSwissRound, swissRecords, swissStandings, swissDecision } from "./swiss";
import { computeLeaderboard, type BrResultInput, type LeaderboardState } from "./leaderboard";
import { computeGroupTables, type TableMatch } from "./standings";
import { eliminationStandings } from "./placements";

/** Estado persistido de um estágio, o suficiente para o motor reconstruir tudo. */
export interface StageInput {
  settings: StageSettings;
  /** Participantes do estágio em ordem de seed. */
  participants: readonly Id[];
  specs: readonly MatchSpec[];
  results: ReadonlyMap<string, MatchResult>;
  groups: readonly (readonly Id[])[] | null;
  br: readonly BrResultInput[];
}

export interface BuiltStage {
  specs: MatchSpec[];
  groups: Id[][] | null;
}

export const STAGE_TYPE_LABELS: Record<StageType, string> = {
  SINGLE_ELIMINATION: "Eliminação simples",
  DOUBLE_ELIMINATION: "Eliminação dupla",
  ROUND_ROBIN: "Pontos corridos / Grupos",
  SWISS: "Sistema suíço",
  GSL: "Grupos GSL",
  LEADERBOARD: "Leaderboard (Battle Royale)",
};

/** Gera as partidas iniciais do estágio. Swiss gera só a rodada 1; leaderboard não tem partidas fixas. */
export function buildStage(settings: StageSettings, seeds: readonly Id[], salt = "stage"): BuiltStage {
  const errors = validateStage(settings, seeds.length);
  if (errors.length) throw new Error(errors.join(" "));
  switch (settings.type) {
    case "SINGLE_ELIMINATION":
      return { specs: generateSingleElimination(seeds, settings), groups: null };
    case "DOUBLE_ELIMINATION":
      return { specs: generateDoubleElimination(seeds, settings), groups: null };
    case "ROUND_ROBIN": {
      const { groups, specs } = generateRoundRobin(seeds, settings, salt);
      return { specs, groups };
    }
    case "GSL": {
      const { groups, specs } = generateGsl(seeds, settings, salt);
      return { specs, groups };
    }
    case "SWISS": {
      const first = generateNextSwissRound(seeds, [], new Map(), settings);
      if (first.done) throw new Error("Configuração do Swiss não gera rodadas.");
      return { specs: first.specs, groups: null };
    }
    case "LEADERBOARD":
      return { specs: [], groups: null };
  }
}

export function resolveStage(input: Pick<StageInput, "specs" | "results">): Map<string, ResolvedMatch> {
  return resolveMatches(input.specs.map((s) => ({ ...s, result: input.results.get(s.key) ?? null })));
}

function tableMatches(input: StageInput, resolved: Map<string, ResolvedMatch>): TableMatch[] {
  const out: TableMatch[] = [];
  for (const spec of input.specs) {
    const r = resolved.get(spec.key);
    if (!r) continue;
    const a = r.entrantA.kind === "participant" ? r.entrantA.id : null;
    const b = r.entrantB.kind === "participant" ? r.entrantB.id : null;
    if (r.status === "bye") {
      const who = a ?? b;
      if (who) out.push({ a: who, b: null, result: null, group: spec.group });
    } else if (r.status === "completed" && a && b && r.result) {
      out.push({ a, b, result: r.result, group: spec.group });
    }
  }
  return out;
}

export function leaderboardState(input: StageInput): LeaderboardState | null {
  if (input.settings.type !== "LEADERBOARD") return null;
  return computeLeaderboard(input.participants, input.br, input.settings);
}

/** Próxima rodada do Swiss, se a atual terminou e ainda há rodadas a jogar. */
export function nextSwissRound(input: StageInput): { specs: MatchSpec[]; round: number } | null {
  if (input.settings.type !== "SWISS") return null;
  const resolved = resolveStage(input);
  if (!allSettled(resolved)) return null;
  const next = generateNextSwissRound(input.participants, input.specs, resolved, input.settings);
  return next.done ? null : { specs: next.specs, round: next.round };
}

export function isStageComplete(input: StageInput): boolean {
  const { settings } = input;
  if (settings.type === "LEADERBOARD") return leaderboardState(input)!.finished;
  if (input.specs.length === 0) return false;
  const resolved = resolveStage(input);
  if (!allSettled(resolved)) return false;
  if (settings.type === "SWISS") {
    return generateNextSwissRound(input.participants, input.specs, resolved, settings).done;
  }
  return true;
}

export function stageStandings(input: StageInput): StandingRow[] {
  const { settings } = input;
  if (settings.type === "LEADERBOARD") {
    const state = leaderboardState(input)!;
    return state.rows.map((r) => ({
      participantId: r.participantId,
      rank: r.rank,
      played: r.games,
      wins: r.wins,
      draws: 0,
      losses: Math.max(0, r.games - r.wins),
      points: r.points,
      scoreFor: r.kills,
      scoreAgainst: 0,
      diff: r.kills,
    }));
  }
  const resolved = resolveStage(input);
  switch (settings.type) {
    case "SINGLE_ELIMINATION":
      return eliminationStandings("SINGLE", input.participants, input.specs, resolved);
    case "DOUBLE_ELIMINATION":
      return eliminationStandings("DOUBLE", input.participants, input.specs, resolved);
    case "ROUND_ROBIN":
      return computeGroupTables(input.groups ?? [input.participants], tableMatches(input, resolved), settings, input.participants);
    case "SWISS":
      return swissStandings(input.participants, swissRecords(input.specs, resolved), settings);
    case "GSL":
      return gslStandings(input, resolved);
  }
}

function gslStandings(input: StageInput, resolved: Map<string, ResolvedMatch>): StandingRow[] {
  const groups = input.groups ?? [];
  const seedIndex = new Map(input.participants.map((id, i) => [id, i]));
  const base = computeGroupTables(
    groups,
    tableMatches(input, resolved),
    { points: { win: 1, draw: 0, loss: 0 }, tiebreakers: ["points", "diff", "scoreFor", "seed"] },
    input.participants,
  );
  const byId = new Map(base.map((r) => [r.participantId, r]));
  const rows: StandingRow[] = [];
  groups.forEach((members, gi) => {
    const g = gi + 1;
    const idOf = (e: ResolvedMatch["winner"]) => (e.kind === "participant" ? e.id : null);
    const wm = resolved.get(`G${g}-WM`);
    const dm = resolved.get(`G${g}-DM`);
    const em = resolved.get(`G${g}-EM`);
    let order: Id[] | null = null;
    if (wm?.status === "completed" && dm?.status === "completed" && em?.status === "completed") {
      const o = [idOf(wm.winner), idOf(dm.winner), idOf(dm.loser), idOf(em.loser)];
      if (o.every((x): x is Id => x !== null)) order = o;
    }
    const fallback = base.filter((r) => r.group === g).map((r) => r.participantId);
    const finalOrder = order ?? fallback;
    finalOrder.forEach((id, i) => {
      const row = byId.get(id)!;
      rows.push({ ...row, group: g, groupRank: i + 1 });
    });
    void members;
  });
  rows.sort((x, y) => {
    if (x.groupRank !== y.groupRank) return x.groupRank! - y.groupRank!;
    if (y.wins !== x.wins) return y.wins - x.wins;
    if (y.diff !== x.diff) return y.diff - x.diff;
    return (seedIndex.get(x.participantId) ?? 0) - (seedIndex.get(y.participantId) ?? 0);
  });
  return rows.map((r, i) => ({ ...r, rank: i + 1 }));
}

/** Situação dos participantes no Swiss win/loss: usado nos rótulos "3-1", "classificado" etc. */
export function swissRecordsFor(input: StageInput) {
  if (input.settings.type !== "SWISS") return null;
  const resolved = resolveStage(input);
  const state = computeSwissState(input.participants, swissRecords(input.specs, resolved), input.settings);
  return new Map(
    [...state.entries()].map(([id, p]) => [id, { wins: p.wins, losses: p.losses, state: swissDecision(p, input.settings as never) }]),
  );
}

// ───────────────────────── Validação e valores padrão ─────────────────────────

export function minParticipants(settings: StageSettings): number {
  switch (settings.type) {
    case "SINGLE_ELIMINATION":
      return 2;
    case "DOUBLE_ELIMINATION":
      return 3;
    case "ROUND_ROBIN":
      return settings.groups * 2;
    case "SWISS":
      return 4;
    case "GSL":
      return 4;
    case "LEADERBOARD":
      return 2;
  }
}

export function validateStage(settings: StageSettings, participantCount: number): string[] {
  const errors: string[] = [];
  const bo = (n: number, label: string) => {
    if (!Number.isInteger(n) || n < 1 || n > 9 || n % 2 === 0) errors.push(`${label}: use uma melhor-de-N ímpar (1, 3, 5...).`);
  };
  switch (settings.type) {
    case "SINGLE_ELIMINATION":
    case "DOUBLE_ELIMINATION":
      bo(settings.bestOf.default, "Melhor de");
      for (const k of ["quarterfinals", "semifinals", "finals", "thirdPlace"] as const) {
        const v = settings.bestOf[k];
        if (v !== undefined) bo(v, `Melhor de (${k})`);
      }
      break;
    case "ROUND_ROBIN":
      if (!Number.isInteger(settings.groups) || settings.groups < 1) errors.push("Número de grupos inválido.");
      bo(settings.bestOf, "Melhor de");
      if (settings.legs !== 1 && settings.legs !== 2) errors.push("Turnos devem ser 1 ou 2.");
      break;
    case "SWISS":
      bo(settings.bestOf, "Melhor de");
      if (settings.decisiveBestOf !== undefined) bo(settings.decisiveBestOf, "Melhor de (decisivas)");
      if (settings.mode === "winLoss") {
        if (!settings.winsToAdvance || settings.winsToAdvance < 1) errors.push("Informe as vitórias para classificar.");
        if (!settings.lossesToEliminate || settings.lossesToEliminate < 1) errors.push("Informe as derrotas para eliminar.");
      } else if (!settings.rounds || settings.rounds < 1) {
        errors.push("Informe o número de rodadas.");
      }
      break;
    case "GSL":
      bo(settings.bestOf, "Melhor de");
      if (settings.decisiveBestOf !== undefined) bo(settings.decisiveBestOf, "Melhor de (decisivas)");
      break;
    case "LEADERBOARD":
      if (!Number.isInteger(settings.games) || settings.games < 1 || settings.games > 50) errors.push("Número de partidas deve ficar entre 1 e 50.");
      if (!Number.isInteger(settings.lobbySize) || settings.lobbySize < 2) errors.push("Tamanho do lobby inválido.");
      if (settings.scoring.formula === "additive" && settings.scoring.placementPoints.length === 0 && settings.scoring.killPoints === 0) {
        errors.push("Defina pontos por colocação e/ou por abate.");
      }
      if (settings.matchPoint && settings.matchPoint.threshold < 1) errors.push("Limite de match point inválido.");
      break;
  }
  const min = minParticipants(settings);
  if (participantCount < min) errors.push(`${STAGE_TYPE_LABELS[settings.type]} precisa de pelo menos ${min} participantes (há ${participantCount}).`);
  if (settings.type === "GSL" && participantCount % 4 !== 0) errors.push("Grupos GSL exigem um número de participantes múltiplo de 4.");
  if (settings.type === "ROUND_ROBIN" && participantCount < settings.groups * 2) errors.push("Cada grupo precisa de ao menos 2 participantes.");
  return errors;
}

export function describeStage(s: StageSettings): string {
  const bo = (n: number) => `Bo${n}`;
  switch (s.type) {
    case "SINGLE_ELIMINATION": {
      const extra = [s.bestOf.finals && s.bestOf.finals !== s.bestOf.default ? `final ${bo(s.bestOf.finals)}` : null, s.thirdPlaceMatch ? "disputa de 3º lugar" : null]
        .filter(Boolean)
        .join(", ");
      return `Eliminação simples, ${bo(s.bestOf.default)}${extra ? ` (${extra})` : ""}`;
    }
    case "DOUBLE_ELIMINATION":
      return `Eliminação dupla, ${bo(s.bestOf.default)}${s.bestOf.finals && s.bestOf.finals !== s.bestOf.default ? ` (finais ${bo(s.bestOf.finals)})` : ""}${s.grandFinalReset ? ", com reset da grande final" : ""}`;
    case "ROUND_ROBIN":
      return `${s.groups > 1 ? `${s.groups} grupos` : "Pontos corridos"}, ${s.legs === 2 ? "ida e volta" : "turno único"}, ${bo(s.bestOf)}`;
    case "SWISS":
      return s.mode === "winLoss"
        ? `Suíço ${s.winsToAdvance} vitórias / ${s.lossesToEliminate} derrotas, ${bo(s.bestOf)}${s.decisiveBestOf && s.decisiveBestOf !== s.bestOf ? ` (decisivas ${bo(s.decisiveBestOf)})` : ""}`
        : `Suíço de ${s.rounds} rodadas, ${bo(s.bestOf)}`;
    case "GSL":
      return `Grupos GSL de 4, ${bo(s.bestOf)}${s.decisiveBestOf && s.decisiveBestOf !== s.bestOf ? ` (decisivas ${bo(s.decisiveBestOf)})` : ""}`;
    case "LEADERBOARD":
      return `Leaderboard de ${s.games} partidas, lobbies de ${s.lobbySize}${s.matchPoint ? `, match point ${s.matchPoint.threshold}` : ""}`;
  }
}
