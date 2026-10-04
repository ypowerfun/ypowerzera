import type { GameDef } from "./types";
import { EA_ID, POINTS_3_1_0, POINTS_WIN_ONLY, TB_LEAGUE, bo, discordField, platformField } from "./common";

export const eafc: GameDef = {
  id: "eafc",
  slug: "ea-sports-fc",
  name: "EA SPORTS FC",
  abbr: "FC",
  category: "Futebol",
  accent: "#14d46a",
  tagline: "1v1 com fase de grupos 3-1-0 e mata-mata de jogo único.",
  description:
    "Futebol da EA SPORTS. Os campeonatos 1v1 seguem o modelo do FC Pro: fase de grupos/pools com jogos únicos (3 pontos por vitória, 1 por empate) e mata-mata eliminatório em jogo único, com prorrogação e pênaltis. Também suportamos Pro Clubs por times.",
  platforms: ["PlayStation", "Xbox", "PC"],
  regions: ["BR", "LATAM", "NA", "EU", "MENA", "Ásia"],
  modes: [
    { id: "1v1", label: "1v1 (consoles/PC)", teamSize: 1, maxSubs: 0 },
    { id: "pro-clubs", label: "Pro Clubs (11v11)", teamSize: 11, maxSubs: 5, description: "Times de jogadores controlando cada posição." },
  ],
  identity: [EA_ID, platformField(["PlayStation", "Xbox", "PC"]), discordField()],
  vetoSupported: false,
  matchSettings: [
    "Partida amistosa (Kick-off) com configurações do evento. Referência FC Pro: tempo de jogo de 6 minutos por tempo, sem custom tactics extras além do permitido pelo regulamento.",
    "Fase de grupos: partidas decididas no tempo regulamentar, sem prorrogação nem pênaltis; empates valem 1 ponto.",
    "Mata-mata: em caso de empate, a partida é decidida com prorrogação e pênaltis (ou rejogo, conforme regulamento).",
    "Times/elencos permitidos: definidos pelo regulamento do evento (ex.: clubes e seleções, sem times lendários).",
  ],
  rules: `- **Partida:** jogada em modo amistoso. O jogador que aparece primeiro na chave (casa) cria a partida e convida o adversário.
- **Configurações:** seguem a lista do campeonato; qualquer alteração precisa ser acordada com a organização.
- **Desconexão:** se ocorrer até os 15' do primeiro tempo sem gols, a partida é refeita; depois disso, vale o placar da hora, com a decisão final da organização.
- **Empates:** na fase de grupos o empate é permitido (1 ponto). No mata-mata, prorrogação e pênaltis.
- **Prova:** print do placar final da partida e do resumo (Match Facts).`,
  presets: [
    {
      id: "eafc.groups-knockout",
      name: "Grupos (3-1-0) + mata-mata de jogo único",
      description: "Fase de grupos em pontos corridos (turno único, vitória 3 pts, empate 1) e mata-mata eliminatório em jogo único com os 2 melhores de cada grupo.",
      basedOn: "EA SPORTS FC Pro — fase de grupos 3-1-0 em jogo único e mata-mata de partida única",
      minParticipants: 8,
      maxParticipants: 64,
      suggestedParticipants: 16,
      modes: ["1v1"],
      stages: [
        {
          name: "Fase de grupos",
          settings: {
            type: "ROUND_ROBIN",
            groups: 4,
            legs: 1,
            bestOf: 1,
            allowDraw: true,
            points: POINTS_3_1_0,
            tiebreakers: TB_LEAGUE,
            groupAssignment: "snake",
            advancement: { perGroup: 2 },
          },
        },
        { name: "Mata-mata", settings: { type: "SINGLE_ELIMINATION", bestOf: bo(1), thirdPlaceMatch: true } },
      ],
    },
    {
      id: "eafc.cup",
      name: "Copa — eliminação simples (jogo único)",
      description: "Mata-mata direto. Empates se resolvem com prorrogação e pênaltis (ou rejogo).",
      basedOn: "FC Pro — knockout de jogo único",
      minParticipants: 4,
      maxParticipants: 128,
      suggestedParticipants: 32,
      stages: [{ name: "Copa", settings: { type: "SINGLE_ELIMINATION", bestOf: bo(1), thirdPlaceMatch: true } }],
    },
    {
      id: "eafc.league",
      name: "Liga — pontos corridos (ida e volta)",
      description: "Todos contra todos em turno e returno, 3 pontos por vitória.",
      basedOn: "Formato de liga de futebol",
      minParticipants: 3,
      maxParticipants: 12,
      suggestedParticipants: 8,
      stages: [
        {
          name: "Pontos corridos",
          settings: { type: "ROUND_ROBIN", groups: 1, legs: 2, bestOf: 1, allowDraw: true, points: POINTS_3_1_0, tiebreakers: TB_LEAGUE, groupAssignment: "snake" },
        },
      ],
    },
    {
      id: "eafc.swiss-knockout",
      name: "Suíço de 5 rodadas + mata-mata (Top 8)",
      description: "Cada jogador faz 5 jogos únicos contra rivais de campanha parecida (3-1-0). Os 8 melhores vão ao mata-mata.",
      basedOn: "Adaptação do formato de pools do FC Pro (cada jogador enfrenta um adversário de cada pool)",
      minParticipants: 8,
      maxParticipants: 64,
      suggestedParticipants: 32,
      modes: ["1v1"],
      stages: [
        {
          name: "Fase suíça",
          settings: {
            type: "SWISS",
            mode: "rounds",
            rounds: 5,
            bestOf: 1,
            allowDraw: true,
            points: POINTS_3_1_0,
            tiebreakers: ["points", "buchholz", "diff", "scoreFor", "seed"],
            advancement: { count: 8 },
          },
        },
        { name: "Mata-mata", settings: { type: "SINGLE_ELIMINATION", bestOf: bo(1), thirdPlaceMatch: true } },
      ],
    },
    {
      id: "eafc.clubs-league",
      name: "Pro Clubs — liga",
      description: "Liga de clubes Pro Clubs com pontos corridos, turno único.",
      basedOn: "Formato de liga",
      minParticipants: 3,
      maxParticipants: 12,
      suggestedParticipants: 8,
      modes: ["pro-clubs"],
      stages: [
        {
          name: "Pontos corridos",
          settings: { type: "ROUND_ROBIN", groups: 1, legs: 1, bestOf: 1, allowDraw: true, points: POINTS_3_1_0, tiebreakers: TB_LEAGUE, groupAssignment: "snake" },
        },
      ],
    },
  ],
  notes: [
    "Conferido nas regras do FC Pro 26: partidas 1v1 em jogo único; fase de grupos com 3 pontos por vitória e 1 por empate, sem prorrogação; mata-mata em chave eliminatória simples, com prorrogação e pênaltis se necessário.",
    "No FC Pro, cada jogador enfrenta um adversário de cada pool na fase de grupos; o preset Suíço é uma aproximação (o motor não sorteia por pools).",
  ],
};

void POINTS_WIN_ONLY;
