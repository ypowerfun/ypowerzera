import type { GameDef, GameId } from "./types";
import { lol } from "./lol";
import { valorant } from "./valorant";
import { cs2, csgo } from "./cs";
import { fortnite } from "./fortnite";
import { apex } from "./apex";
import { bf6 } from "./bf6";
import { sf6 } from "./sf6";
import { warzone } from "./warzone";
import { eafc } from "./eafc";
import { tft } from "./tft";

export * from "./types";
export * from "./common";

export const GAMES: GameDef[] = [lol, valorant, cs2, csgo, fortnite, apex, bf6, warzone, tft, sf6, eafc];

const byId = new Map<string, GameDef>(GAMES.map((g) => [g.id, g]));
const bySlug = new Map<string, GameDef>(GAMES.map((g) => [g.slug, g]));

export function getGame(id: string): GameDef | undefined {
  return byId.get(id);
}

export function getGameBySlug(slug: string): GameDef | undefined {
  return bySlug.get(slug);
}

export function requireGame(id: string): GameDef {
  const g = byId.get(id);
  if (!g) throw new Error(`Jogo desconhecido: ${id}`);
  return g;
}

export function getPreset(gameId: string, presetId: string) {
  return getGame(gameId)?.presets.find((p) => p.id === presetId);
}

export function allPresets() {
  return GAMES.flatMap((g) => g.presets.map((p) => ({ game: g, preset: p })));
}

export function presetsForMode(game: GameDef, modeId: string) {
  return game.presets.filter((p) => !p.modes || p.modes.length === 0 || p.modes.includes(modeId));
}

export type { GameId };
