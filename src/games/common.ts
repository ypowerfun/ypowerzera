import type { IdentityField, GameDef } from "./types";
import type { BestOfRules, LeaderboardSettings, PointsRule, TiebreakCriterion } from "@/engine";

export const POINTS_3_1_0: PointsRule = { win: 3, draw: 1, loss: 0 };
export const POINTS_WIN_ONLY: PointsRule = { win: 1, draw: 0, loss: 0 };

export const TB_LEAGUE: TiebreakCriterion[] = ["points", "h2hPoints", "diff", "scoreFor", "seed"];
export const TB_SWISS: TiebreakCriterion[] = ["points", "buchholz", "diff", "seed"];

export const bo = (def: number, extra: Omit<BestOfRules, "default"> = {}): BestOfRules => ({ default: def, ...extra });

// ───────────── Tabelas de pontuação de battle royale ─────────────

/** ALGS (Apex Legends Global Series): 12/9/7/5/4/3/3/2/2/2/1×5/0. 1 ponto por abate. */
export const ALGS_PLACEMENT = [12, 9, 7, 5, 4, 3, 3, 2, 2, 2, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0];

/** FNCS 2024 (referência Liquipedia): 65/56/52/48/44/40/38/36/34/32/30/…/2. 2 pontos por eliminação. */
export const FNCS_REF_PLACEMENT = [65, 56, 52, 48, 44, 40, 38, 36, 34, 32, 30, 28, 26, 24, 22, 20, 18, 16, 14, 12, 10, 8, 6, 4, 2];

/** TFT: 8 pontos para o 1º até 1 ponto para o 8º. */
export const TFT_PLACEMENT = [8, 7, 6, 5, 4, 3, 2, 1];

/** Sugestão genérica de comunidade: 15/12/10/8/6/5/4/3/2/1 + 1 por abate. */
export const GENERIC_BR_PLACEMENT = [15, 12, 10, 8, 6, 5, 4, 3, 2, 1];

/** WSOW 2024 Trios: abates × multiplicador de colocação. */
export const WARZONE_TRIOS_MULTIPLIERS = [
  { from: 1, to: 1, multiplier: 2 },
  { from: 2, to: 5, multiplier: 1.8 },
  { from: 6, to: 10, multiplier: 1.6 },
  { from: 11, to: 15, multiplier: 1.4 },
  { from: 16, to: 25, multiplier: 1.2 },
];

/** WSOW Duos: 1º 2×, 2º–25º 1,5×, demais 1×. */
export const WARZONE_DUOS_MULTIPLIERS = [
  { from: 1, to: 1, multiplier: 2 },
  { from: 2, to: 25, multiplier: 1.5 },
];

export const BR_TIEBREAKERS: LeaderboardSettings["tiebreakers"] = ["points", "wins", "kills", "bestPlacement", "lastGamePlacement", "seed"];

// ───────────── Campos de identidade reutilizáveis ─────────────

export const RIOT_ID: IdentityField = {
  key: "riotId",
  label: "Riot ID",
  placeholder: "NomeDeInvocador#BR1",
  help: "Formato Nome#TAG, como aparece no cliente da Riot.",
  type: "text",
  pattern: "^[^#\\s][^#]{2,15}#[A-Za-z0-9]{3,5}$",
  patternHint: "Use o formato Nome#TAG (nome de 3 a 16 caracteres e tag de 3 a 5).",
  required: true,
  primary: true,
};

export const STEAM_ID: IdentityField = {
  key: "steamId",
  label: "Steam (SteamID64 ou link do perfil)",
  placeholder: "76561198000000000",
  help: "Cole o SteamID64 (17 dígitos) ou o link do seu perfil na Steam.",
  type: "text",
  pattern: "^(7656119\\d{10}|https?://steamcommunity\\.com/(id|profiles)/[A-Za-z0-9_-]+/?)$",
  patternHint: "Informe o SteamID64 (17 dígitos, começando com 7656119) ou o link steamcommunity.com do seu perfil.",
  required: true,
  primary: true,
};

export const FACEIT: IdentityField = {
  key: "faceit",
  label: "Nick na FACEIT (opcional)",
  placeholder: "seu_nick",
  type: "text",
  pattern: "^[A-Za-z0-9_-]{2,20}$",
  patternHint: "Nick de 2 a 20 caracteres (letras, números, _ e -).",
  required: false,
};

export const EPIC_ID: IdentityField = {
  key: "epicId",
  label: "Epic Games ID (nome de exibição)",
  placeholder: "SeuNomeNaEpic",
  type: "text",
  pattern: "^[\\w .\\-]{3,16}$",
  patternHint: "Nome de exibição da Epic com 3 a 16 caracteres.",
  required: true,
  primary: true,
};

export const EA_ID: IdentityField = {
  key: "eaId",
  label: "EA ID",
  placeholder: "SeuEAID",
  type: "text",
  pattern: "^[A-Za-z0-9_-]{3,16}$",
  patternHint: "EA ID de 3 a 16 caracteres (letras, números, _ e -).",
  required: true,
  primary: true,
};

export const ACTIVISION_ID: IdentityField = {
  key: "activisionId",
  label: "Activision ID",
  placeholder: "Nome#1234567",
  help: "Formato Nome#número, como aparece no Call of Duty.",
  type: "text",
  pattern: "^[^#\\s].{1,15}#\\d{4,8}$",
  patternHint: "Use o formato Nome#1234567.",
  required: true,
  primary: true,
};

export const CAPCOM_ID: IdentityField = {
  key: "capcomId",
  label: "ID do jogador (Capcom ID / PSN / Steam / Xbox)",
  placeholder: "SeuID",
  type: "text",
  pattern: "^.{3,32}$",
  patternHint: "Informe o ID que será usado nas salas de partida (3 a 32 caracteres).",
  required: true,
  primary: true,
};

export const discordField = (required = false): IdentityField => ({
  key: "discord",
  label: "Discord",
  placeholder: "usuario",
  help: "Usado pelos organizadores para contato durante o campeonato.",
  type: "text",
  pattern: "^[A-Za-z0-9_.]{2,32}$",
  patternHint: "Nome de usuário do Discord (2 a 32 caracteres: letras, números, _ e .).",
  required,
});

export const platformField = (options: string[], required = true): IdentityField => ({
  key: "platform",
  label: "Plataforma",
  type: "select",
  options,
  required,
});

// ───────────── Regulamento-base ─────────────

export const COMMON_RULES = `- **Elegibilidade:** cada jogador pode se inscrever em apenas um time/inscrição por campeonato e deve usar a própria conta, sem compartilhamento.
- **Contas:** o ID informado na inscrição deve ser o mesmo usado nas partidas. Trocas de conta só com aprovação da organização.
- **Check-in:** obrigatório na janela indicada na página do campeonato. Quem não fizer check-in perde a vaga (e, em caso de entrada paga, vale a política de reembolso do evento).
- **Atraso e W.O.:** tolerância de 10 minutos após o horário combinado da partida. Passado o prazo, a organização pode declarar W.O.
- **Resultados:** o placar é reportado pelo capitão (ou jogador) de cada lado. Se os dois relatos divergirem, a partida entra em disputa e a organização decide com base em provas (prints/replay).
- **Conduta:** é proibido o uso de cheats, exploits, ghosting, combinação de resultados e comportamento tóxico. A organização pode advertir, desclassificar e banir.
- **Decisão final:** a organização tem a palavra final em casos omissos.`;

export function finalizeRules(game: Pick<GameDef, "rules">): string {
  return `${COMMON_RULES}\n${game.rules}`;
}
