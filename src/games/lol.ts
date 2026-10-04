import type { GameDef } from "./types";
import { RIOT_ID, TB_LEAGUE, TB_SWISS, POINTS_WIN_ONLY, bo, discordField, platformField } from "./common";

export const lol: GameDef = {
  id: "lol",
  slug: "league-of-legends",
  name: "League of Legends",
  abbr: "LoL",
  category: "MOBA",
  accent: "#c8aa6e",
  tagline: "5v5 em Summoner's Rift, com draft e séries Bo1/Bo3/Bo5.",
  description:
    "MOBA 5v5 da Riot Games. Os campeonatos seguem o padrão competitivo: draft de campeões (com Fearless Draft nas séries Bo3/Bo5), escolha de lado e séries que escalam de Bo1 para Bo3 e Bo5 nas fases decisivas.",
  platforms: ["PC"],
  regions: ["BR", "LAS", "LAN", "NA", "EUW", "EUNE", "KR", "OCE"],
  modes: [
    { id: "5v5", label: "5v5 Summoner's Rift", teamSize: 5, maxSubs: 2, description: "Cinco titulares e até dois reservas, mais técnico opcional." },
  ],
  identity: [
    RIOT_ID,
    {
      key: "role",
      label: "Função",
      type: "select",
      options: ["Top", "Jungle", "Mid", "ADC", "Suporte", "Reserva"],
      required: false,
    },
    discordField(),
  ],
  vetoSupported: false,
  matchSettings: [
    "Mapa: Summoner's Rift, modo Tournament Draft (lobby personalizado).",
    "Séries Bo3/Bo5: **Fearless Draft** — campeão escolhido por qualquer time em um jogo anterior da série fica indisponível para ambos nos jogos seguintes (formato adotado no Worlds desde 2025).",
    "Lados: o time de melhor seed escolhe o lado no jogo 1; o perdedor escolhe o lado no jogo seguinte.",
    "Pausas: até 10 minutos de pausa técnica acumulada por time; pausas táticas não são permitidas.",
  ],
  rules: `- **Lobby:** o time de menor seed cria o lobby personalizado (Tournament Draft) e convida o adversário e os espectadores indicados pela organização.
- **Draft:** bans e picks conforme o draft de torneio. Em séries Bo3/Bo5 vale o Fearless Draft.
- **Lados:** o melhor seed escolhe o lado no primeiro jogo; depois o perdedor do jogo anterior escolhe.
- **Remake:** só é permitido até os 3:00 de jogo por problema técnico comprovado ou decisão da organização.
- **Reservas:** substituições só entre jogos da série, com o aviso à organização antes do início do draft.
- **Prova do resultado:** print da tela de vitória/derrota com o placar da série.`,
  presets: [
    {
      id: "lol.single-elim",
      name: "Copa — eliminação simples",
      description: "Bo1 nas primeiras fases, Bo3 nas semifinais e Bo5 na final. O formato mais simples para copas de fim de semana.",
      basedOn: "Padrão de copas e torneios abertos",
      minParticipants: 4,
      maxParticipants: 64,
      suggestedParticipants: 16,
      stages: [{ name: "Playoffs", settings: { type: "SINGLE_ELIMINATION", bestOf: bo(1, { semifinals: 3, finals: 5 }), thirdPlaceMatch: false } }],
    },
    {
      id: "lol.double-elim",
      name: "Eliminação dupla (Bo3, finais Bo5)",
      description: "Cada time só é eliminado após duas derrotas. Grande final com reset.",
      basedOn: "Padrão de playoffs regionais",
      minParticipants: 4,
      maxParticipants: 64,
      suggestedParticipants: 16,
      stages: [{ name: "Chave dupla", settings: { type: "DOUBLE_ELIMINATION", bestOf: bo(3, { finals: 5 }), grandFinalReset: true } }],
    },
    {
      id: "lol.worlds",
      name: "Estilo Worlds — Suíço + mata-mata Bo5",
      description:
        "16 times em Suíço (3 vitórias classificam, 3 derrotas eliminam; Bo1 normal e Bo3 nas decisivas). Os 8 classificados seguem para eliminação simples em Bo5.",
      basedOn: "League of Legends World Championship 2025/2026 (Swiss Stage + Knockout Bo5)",
      minParticipants: 16,
      maxParticipants: 16,
      suggestedParticipants: 16,
      stages: [
        {
          name: "Fase suíça",
          settings: {
            type: "SWISS",
            mode: "winLoss",
            winsToAdvance: 3,
            lossesToEliminate: 3,
            bestOf: 1,
            decisiveBestOf: 3,
            allowDraw: false,
            points: POINTS_WIN_ONLY,
            tiebreakers: TB_SWISS,
            advancement: { count: 8 },
          },
        },
        { name: "Mata-mata", settings: { type: "SINGLE_ELIMINATION", bestOf: bo(5), thirdPlaceMatch: false } },
      ],
    },
    {
      id: "lol.groups-playoffs",
      name: "Fase de grupos + playoffs",
      description: "Dois grupos em pontos corridos (Bo1); os 2 melhores de cada grupo vão para playoffs eliminatórios (Bo3, final Bo5).",
      basedOn: "Formato clássico de ligas e circuitos regionais",
      minParticipants: 8,
      maxParticipants: 16,
      suggestedParticipants: 8,
      stages: [
        {
          name: "Fase de grupos",
          settings: {
            type: "ROUND_ROBIN",
            groups: 2,
            legs: 1,
            bestOf: 1,
            allowDraw: false,
            points: POINTS_WIN_ONLY,
            tiebreakers: TB_LEAGUE,
            groupAssignment: "snake",
            advancement: { perGroup: 2 },
          },
        },
        { name: "Playoffs", settings: { type: "SINGLE_ELIMINATION", bestOf: bo(3, { finals: 5 }), thirdPlaceMatch: false } },
      ],
    },
    {
      id: "lol.league",
      name: "Liga — pontos corridos (ida e volta)",
      description: "Todos contra todos em turno e returno. Ideal para ligas de várias semanas.",
      basedOn: "Formato de ligas regulares",
      minParticipants: 4,
      maxParticipants: 10,
      suggestedParticipants: 8,
      stages: [
        {
          name: "Pontos corridos",
          settings: { type: "ROUND_ROBIN", groups: 1, legs: 2, bestOf: 1, allowDraw: false, points: POINTS_WIN_ONLY, tiebreakers: TB_LEAGUE, groupAssignment: "snake" },
        },
      ],
    },
  ],
  notes: [
    "Formato Worlds conferido em fontes públicas sobre o Worlds 2026: Suíço de 16 times (3V/3D), Bo1 nas partidas sem classificação/eliminação em jogo, Bo3 nas decisivas e mata-mata Bo5.",
    "Fearless Draft é adotado em todas as séries Bo3/Bo5 desde o Worlds 2025.",
  ],
};
