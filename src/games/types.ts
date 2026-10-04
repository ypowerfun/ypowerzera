import type { StageSettings } from "@/engine";

export type GameId =
  | "lol"
  | "valorant"
  | "cs2"
  | "csgo"
  | "fortnite"
  | "apex"
  | "bf6"
  | "sf6"
  | "warzone"
  | "eafc"
  | "tft";

export type GameCategory = "MOBA" | "FPS tático" | "Battle Royale" | "Luta" | "Futebol" | "Auto battler";

export interface GameMode {
  id: string;
  label: string;
  /** Jogadores titulares por inscrição (1 = individual). */
  teamSize: number;
  /** Reservas permitidos. */
  maxSubs: number;
  description?: string;
}

export interface IdentityField {
  key: string;
  label: string;
  placeholder?: string;
  help?: string;
  type: "text" | "select";
  options?: string[];
  /** Expressão regular (fonte, sem barras) para validar o valor. */
  pattern?: string;
  patternHint?: string;
  required: boolean;
  /** O primeiro campo marcado como principal é usado como "nick" exibido na chave. */
  primary?: boolean;
}

export interface PresetStage {
  name: string;
  settings: StageSettings;
}

export interface FormatPreset {
  id: string;
  name: string;
  description: string;
  /** Em que se baseia (formato oficial ou prática comum). */
  basedOn: string;
  minParticipants: number;
  maxParticipants: number;
  suggestedParticipants: number;
  /** Modos de jogo compatíveis (ids de GameMode). Vazio = todos. */
  modes?: string[];
  stages: PresetStage[];
}

export interface MapPool {
  label: string;
  maps: string[];
  note?: string;
}

export interface GameDef {
  id: GameId;
  slug: string;
  name: string;
  /** Sigla curta para o selo. */
  abbr: string;
  category: GameCategory;
  /** Cor de destaque (hex). */
  accent: string;
  tagline: string;
  description: string;
  platforms: string[];
  regions: string[];
  modes: GameMode[];
  identity: IdentityField[];
  mapPool?: MapPool;
  /** Veto/pick de mapas disponível na sala da partida. */
  vetoSupported: boolean;
  /** Configurações de partida sugeridas (exibidas no regulamento e na sala da partida). */
  matchSettings: string[];
  /** Regras específicas, em markdown simples (lista com "- "). */
  rules: string;
  presets: FormatPreset[];
  /** Observações sobre a fonte dos formatos e pontos a conferir. */
  notes?: string[];
}
