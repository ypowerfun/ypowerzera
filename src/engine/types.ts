/**
 * Tipos do motor de campeonatos.
 *
 * O motor é puro: não conhece banco de dados, HTTP nem React. Ele gera "especificações de partida"
 * (MatchSpec) com origens de vaga encadeadas (vencedor de X, perdedor de Y...), e resolve o estado
 * da chave a partir dos resultados registrados. Assim o banco só precisa guardar specs + resultados.
 */

export type Id = string;

/** De onde vem o participante de uma vaga da partida. */
export type SlotSource =
  | { kind: "participant"; id: Id }
  | { kind: "winner"; match: string }
  | { kind: "loser"; match: string }
  /** Participante que ocupa a vaga A / B de outra partida (usado no reset da grande final). */
  | { kind: "slotA"; match: string }
  | { kind: "slotB"; match: string }
  | { kind: "bye" };

export type BracketKind = "W" | "L" | "GF" | "THIRD" | "GROUP" | "SWISS";

export interface MatchSpec {
  /** Chave única dentro do estágio. Ex.: "W1-1", "L3-2", "GF-1", "G1-R2-3", "S4-5". */
  key: string;
  bracket: BracketKind;
  round: number;
  position: number;
  group: number | null;
  bestOf: number;
  a: SlotSource;
  b: SlotSource;
  /** Só é disputada se a partida indicada foi vencida pelo lado B (reset da grande final). */
  onlyIfWinner?: { match: string; side: "b" };
}

export interface MatchResult {
  scoreA: number;
  scoreB: number;
  /** null = empate (somente quando o estágio permite). */
  winner: "a" | "b" | null;
  /** Lado que perdeu por W.O./desqualificação. */
  forfeit?: "a" | "b" | null;
}

export interface MatchInput extends MatchSpec {
  result?: MatchResult | null;
}

export type Entrant =
  | { kind: "participant"; id: Id }
  | { kind: "bye" }
  | { kind: "pending" };

export type ResolvedStatus = "pending" | "ready" | "completed" | "bye" | "skipped";

export interface ResolvedMatch {
  key: string;
  status: ResolvedStatus;
  entrantA: Entrant;
  entrantB: Entrant;
  winner: Entrant;
  loser: Entrant;
  result: MatchResult | null;
}

/** Regras de melhor-de-N por fase do mata-mata. */
export interface BestOfRules {
  default: number;
  quarterfinals?: number;
  semifinals?: number;
  /** Final (e, na dupla eliminação, final da chave dos vencedores, dos perdedores e grande final). */
  finals?: number;
  thirdPlace?: number;
}

export type TiebreakCriterion =
  | "points"
  | "h2hPoints"
  | "h2hDiff"
  | "h2hScore"
  | "diff"
  | "scoreFor"
  | "wins"
  | "buchholz"
  | "seed";

export interface PointsRule {
  win: number;
  draw: number;
  loss: number;
}

export type SeedingMethod = "manual" | "random" | "rating";

// ───────────────────────── Configuração dos estágios ─────────────────────────

export interface Advancement {
  /** Quantos participantes avançam no total (quando não há grupos). */
  count?: number;
  /** Quantos avançam de cada grupo. */
  perGroup?: number;
}

export interface SingleEliminationSettings {
  type: "SINGLE_ELIMINATION";
  bestOf: BestOfRules;
  thirdPlaceMatch: boolean;
  advancement?: Advancement;
}

export interface DoubleEliminationSettings {
  type: "DOUBLE_ELIMINATION";
  bestOf: BestOfRules;
  grandFinalReset: boolean;
  advancement?: Advancement;
}

export interface RoundRobinSettings {
  type: "ROUND_ROBIN";
  groups: number;
  /** 1 = turno único; 2 = turno e returno. */
  legs: 1 | 2;
  bestOf: number;
  allowDraw: boolean;
  points: PointsRule;
  tiebreakers: TiebreakCriterion[];
  groupAssignment: "snake" | "random";
  advancement?: Advancement;
}

export interface SwissSettings {
  type: "SWISS";
  mode: "rounds" | "winLoss";
  /** Número de rodadas (mode = rounds). */
  rounds?: number;
  /** Vitórias para classificar / derrotas para eliminar (mode = winLoss). Ex.: 3 e 3 (CS2 Major, Worlds). */
  winsToAdvance?: number;
  lossesToEliminate?: number;
  bestOf: number;
  /** Melhor-de-N das partidas decisivas (classificação/eliminação). Ex.: Bo1 normal, Bo3 decisiva. */
  decisiveBestOf?: number;
  allowDraw: boolean;
  points: PointsRule;
  tiebreakers: TiebreakCriterion[];
  advancement?: Advancement;
}

export interface GslSettings {
  type: "GSL";
  bestOf: number;
  /** Melhor-de-N das partidas de vencedores/decisão (opcional). */
  decisiveBestOf?: number;
  groupAssignment: "snake" | "random";
  advancement?: Advancement;
}

export type LeaderboardTiebreaker =
  | "points"
  | "wins"
  | "kills"
  | "bestPlacement"
  | "avgPlacement"
  | "lastGamePlacement"
  | "lastGamePoints"
  | "seed";

export interface PlacementMultiplier {
  from: number;
  to: number;
  multiplier: number;
}

export interface LeaderboardScoring {
  /** additive: colocação + abates × valor | multiplier: abates × multiplicador da colocação (Warzone). */
  formula: "additive" | "multiplier";
  /** Índice 0 = 1º lugar. Colocações além do tamanho da lista valem 0. */
  placementPoints: number[];
  killPoints: number;
  victoryBonus?: number;
  placementMultipliers?: PlacementMultiplier[];
}

export interface MatchPointRule {
  threshold: number;
  /** Precisa vencer uma partida depois de atingir o limite (ALGS, TFT Checkmate). */
  requireWin: boolean;
}

export interface LeaderboardSettings {
  type: "LEADERBOARD";
  /** Quantidade de rodadas (partidas) planejadas. Com matchPoint é o teto. */
  games: number;
  lobbySize: number;
  lobbyAssignment: "snake" | "swiss" | "random" | "fixed";
  scoring: LeaderboardScoring;
  matchPoint?: MatchPointRule;
  tiebreakers: LeaderboardTiebreaker[];
  advancement?: Advancement;
}

export type StageSettings =
  | SingleEliminationSettings
  | DoubleEliminationSettings
  | RoundRobinSettings
  | SwissSettings
  | GslSettings
  | LeaderboardSettings;

export type StageType = StageSettings["type"];

export const STAGE_TYPES: StageType[] = [
  "SINGLE_ELIMINATION",
  "DOUBLE_ELIMINATION",
  "ROUND_ROBIN",
  "SWISS",
  "GSL",
  "LEADERBOARD",
];

// ───────────────────────── Classificações ─────────────────────────

export interface StandingRow {
  participantId: Id;
  /** Posição (1 = melhor). Empatados em chaves eliminatórias compartilham a mesma posição. */
  rank: number;
  tied?: boolean;
  group?: number | null;
  groupRank?: number | null;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  points: number;
  scoreFor: number;
  scoreAgainst: number;
  diff: number;
  buchholz?: number;
  /** Swiss win/loss: situação do participante. */
  state?: "advanced" | "eliminated" | "active";
}

export interface LeaderboardRow {
  participantId: Id;
  rank: number;
  points: number;
  games: number;
  wins: number;
  kills: number;
  bestPlacement: number | null;
  avgPlacement: number | null;
  lastGamePlacement: number | null;
  lastGamePoints: number | null;
  perGame: Array<{ round: number; placement: number; kills: number; points: number }>;
  /** Atingiu o limite de match point. */
  matchPointEligible: boolean;
  champion?: boolean;
}
