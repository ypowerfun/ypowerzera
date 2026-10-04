import type { GameDef } from "./types";
import { BR_TIEBREAKERS, EPIC_ID, FNCS_REF_PLACEMENT, POINTS_WIN_ONLY, TB_LEAGUE, bo, discordField, platformField } from "./common";

export const fortnite: GameDef = {
  id: "fortnite",
  slug: "fortnite",
  name: "Fortnite",
  abbr: "FN",
  category: "Battle Royale",
  accent: "#7d5fff",
  tagline: "Sessões de leaderboard no estilo FNCS: colocação + eliminações.",
  description:
    "Battle royale da Epic Games. Os campeonatos seguem o modelo das sessões do FNCS: várias partidas em lobby, pontos por colocação e por eliminação, e desempate por Victory Royales. A edição 2026 do FNCS é disputada em Duos.",
  platforms: ["PC", "PlayStation", "Xbox", "Mobile"],
  regions: ["BR", "NAC", "NAW", "EU", "ASIA", "OCE", "ME"],
  modes: [
    { id: "solo", label: "Solo", teamSize: 1, maxSubs: 0 },
    { id: "duos", label: "Duos", teamSize: 2, maxSubs: 1, description: "Modo do FNCS 2026." },
    { id: "trios", label: "Trios", teamSize: 3, maxSubs: 1 },
    { id: "squads", label: "Squads", teamSize: 4, maxSubs: 1 },
  ],
  identity: [EPIC_ID, platformField(["PC", "PlayStation", "Xbox", "Switch", "Mobile"]), discordField()],
  vetoSupported: false,
  matchSettings: [
    "Modo: Battle Royale (Duos no FNCS 2026), jogado em ilha/modo competitivo definido pela organização.",
    "Pontuação: pontos por colocação + pontos por eliminação (valores editáveis por campeonato).",
    "Desempate: soma de Victory Royales → média de eliminações → média de colocação → tempo vivo.",
    "Lobby: código de ilha (Island Code) ou torneio da Epic informado no dia.",
  ],
  rules: `- **Lobbies:** a organização informa o código da ilha/lobby no horário combinado. Quem não estiver no lobby na hora da partida perde os pontos dela.
- **Pontuação:** pontos de colocação + pontos por eliminação, conforme a tabela do campeonato (veja o estágio do leaderboard).
- **Eliminações:** só contam eliminações válidas (não vale kill de time aliado nem combinar abates).
- **Disputas:** envie clipes/prints dentro de 15 minutos após o fim da partida. A organização confere pelo replay.
- **Anti-cheat:** Easy Anti-Cheat ativo; é proibido stream sniping.`,
  presets: [
    {
      id: "fortnite.session",
      name: "Sessão de 6 partidas (estilo FNCS)",
      description:
        "Leaderboard com 6 partidas. Pontos por colocação (tabela de referência FNCS 2024) + 2 pontos por eliminação. Desempate por Victory Royales, abates e melhor colocação.",
      basedOn: "FNCS — sessões de leaderboard (tabela de referência da edição 2024, via Liquipedia; confira o regulamento da temporada)",
      minParticipants: 4,
      maxParticipants: 150,
      suggestedParticipants: 50,
      modes: ["solo", "duos", "trios", "squads"],
      stages: [
        {
          name: "Sessão de leaderboard",
          settings: {
            type: "LEADERBOARD",
            games: 6,
            lobbySize: 50,
            lobbyAssignment: "snake",
            scoring: { formula: "additive", placementPoints: FNCS_REF_PLACEMENT, killPoints: 2 },
            tiebreakers: BR_TIEBREAKERS,
          },
        },
      ],
    },
    {
      id: "fortnite.qualifier-final",
      name: "Qualificatória + Final",
      description: "Qualificatória de 8 partidas; os 25 melhores avançam para uma final de 6 partidas com pontuação zerada.",
      basedOn: "Estrutura de Play-In → Final dos eventos FNCS",
      minParticipants: 30,
      maxParticipants: 150,
      suggestedParticipants: 100,
      modes: ["solo", "duos", "trios", "squads"],
      stages: [
        {
          name: "Qualificatória",
          settings: {
            type: "LEADERBOARD",
            games: 8,
            lobbySize: 50,
            lobbyAssignment: "snake",
            scoring: { formula: "additive", placementPoints: FNCS_REF_PLACEMENT, killPoints: 2 },
            tiebreakers: BR_TIEBREAKERS,
            advancement: { count: 25 },
          },
        },
        {
          name: "Final",
          settings: {
            type: "LEADERBOARD",
            games: 6,
            lobbySize: 25,
            lobbyAssignment: "fixed",
            scoring: { formula: "additive", placementPoints: FNCS_REF_PLACEMENT, killPoints: 2 },
            tiebreakers: BR_TIEBREAKERS,
          },
        },
      ],
    },
    {
      id: "fortnite.box-fight",
      name: "Duelos 1v1 (Box Fight) — eliminação simples",
      description: "Mata-mata de duelos 1v1 em ilha de Box Fight. Bo3 e final em Bo5.",
      basedOn: "Torneios de duelo da comunidade",
      minParticipants: 4,
      maxParticipants: 64,
      suggestedParticipants: 16,
      modes: ["solo"],
      stages: [{ name: "Chave de duelos", settings: { type: "SINGLE_ELIMINATION", bestOf: bo(3, { finals: 5 }), thirdPlaceMatch: true } }],
    },
    {
      id: "fortnite.league",
      name: "Liga de duelos — pontos corridos",
      description: "Todos contra todos em Bo3, turno único.",
      basedOn: "Formato de liga",
      minParticipants: 3,
      maxParticipants: 12,
      suggestedParticipants: 8,
      modes: ["solo"],
      stages: [
        {
          name: "Pontos corridos",
          settings: { type: "ROUND_ROBIN", groups: 1, legs: 1, bestOf: 3, allowDraw: false, points: POINTS_WIN_ONLY, tiebreakers: TB_LEAGUE, groupAssignment: "snake" },
        },
      ],
    },
  ],
  notes: [
    "FNCS 2026: eventos em Duos (Major 1, Major 2, Global Championship etc.); sessões de Play-In com até 11 partidas por dia, somando Dia 1 e Dia 2.",
    "A tabela de pontos oficial varia por evento/temporada. Os valores aqui são de referência (FNCS 2024: 65/56/52/48/44/40/38/36/34/32/30…/2 por colocação e 2 pontos por eliminação) e podem ser editados por campeonato.",
  ],
};
