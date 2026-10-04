import type { FormatPreset, GameDef } from "./types";
import { FACEIT, STEAM_ID, TB_LEAGUE, TB_SWISS, POINTS_WIN_ONLY, bo, discordField } from "./common";

const csPresets = (prefix: string, label: string): FormatPreset[] => [
  {
    id: `${prefix}.single-elim`,
    name: "Copa — eliminação simples",
    description: "Bo1 nas primeiras fases, Bo3 nas semifinais e final.",
    basedOn: "Padrão de copas e torneios abertos",
    minParticipants: 4,
    maxParticipants: 64,
    suggestedParticipants: 16,
    stages: [{ name: "Playoffs", settings: { type: "SINGLE_ELIMINATION", bestOf: bo(1, { semifinals: 3, finals: 3 }), thirdPlaceMatch: false } }],
  },
  {
    id: `${prefix}.double-elim`,
    name: "Eliminação dupla (Bo1 → Bo3 nas finais)",
    description: "Bo1 nas rodadas iniciais; semifinais e finais em Bo3. Cada time só cai após duas derrotas.",
    basedOn: "Padrão de playoffs de torneios de CS",
    minParticipants: 4,
    maxParticipants: 64,
    suggestedParticipants: 16,
    stages: [{ name: "Chave dupla", settings: { type: "DOUBLE_ELIMINATION", bestOf: bo(1, { semifinals: 3, finals: 3 }), grandFinalReset: true } }],
  },
  {
    id: `${prefix}.major`,
    name: `Estilo Major (${label}) — Suíço 3-3 + playoffs Bo3`,
    description:
      "16 times em Suíço (3 vitórias classificam, 3 derrotas eliminam). Partidas decisivas (classificação/eliminação) em Bo3, as demais em Bo1. Os 8 classificados jogam playoffs eliminatórios em Bo3.",
    basedOn: "CS Majors: Suíço de 16 times (Bo1 e Bo3 decisivas) → playoffs de 8 times em Bo3",
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
      { name: "Playoffs", settings: { type: "SINGLE_ELIMINATION", bestOf: bo(3), thirdPlaceMatch: false } },
    ],
  },
  {
    id: `${prefix}.gsl-playoffs`,
    name: "Grupos GSL + playoffs",
    description: "16 times em 4 grupos GSL (Bo1 nas aberturas, Bo3 nas partidas de vencedores e decisiva). Top 2 de cada grupo vão aos playoffs Bo3.",
    basedOn: "Formato de grupos GSL usado em ligas e qualificatórios de CS",
    minParticipants: 16,
    maxParticipants: 16,
    suggestedParticipants: 16,
    stages: [
      { name: "Fase de grupos (GSL)", settings: { type: "GSL", bestOf: 1, decisiveBestOf: 3, groupAssignment: "snake", advancement: { perGroup: 2 } } },
      { name: "Playoffs", settings: { type: "SINGLE_ELIMINATION", bestOf: bo(3), thirdPlaceMatch: false } },
    ],
  },
  {
    id: `${prefix}.swiss-open`,
    name: "Suíço de rodadas fixas (Bo1)",
    description: "5 rodadas em Bo1 com pareamento por campanha e desempate por Buchholz. Ótimo para campeonatos abertos com muitos times.",
    basedOn: "Sistema suíço clássico",
    minParticipants: 8,
    maxParticipants: 64,
    suggestedParticipants: 32,
    stages: [
      {
        name: "Suíço",
        settings: { type: "SWISS", mode: "rounds", rounds: 5, bestOf: 1, allowDraw: false, points: POINTS_WIN_ONLY, tiebreakers: TB_SWISS, advancement: { count: 8 } },
      },
      { name: "Playoffs", settings: { type: "SINGLE_ELIMINATION", bestOf: bo(1, { semifinals: 3, finals: 3 }), thirdPlaceMatch: false } },
    ],
  },
  {
    id: `${prefix}.league`,
    name: "Liga — pontos corridos",
    description: "Todos contra todos, turno único em Bo1 ou Bo3.",
    basedOn: "Formato de ligas",
    minParticipants: 4,
    maxParticipants: 12,
    suggestedParticipants: 8,
    stages: [
      {
        name: "Pontos corridos",
        settings: { type: "ROUND_ROBIN", groups: 1, legs: 1, bestOf: 3, allowDraw: false, points: POINTS_WIN_ONLY, tiebreakers: TB_LEAGUE, groupAssignment: "snake" },
      },
    ],
  },
];

const csRules = (extra: string) => `- **Servidor:** partidas em servidor dedicado/comunidade indicado pela organização, com anticheat ativo. O uso de GOTV/demo é obrigatório quando disponível.
- **Veto:** realizado na sala da partida da plataforma. O time A (melhor seed) começa. Bo1: 6 bans e o mapa restante é jogado; Bo3: ban, ban, pick, pick, ban, ban e o restante é o decider.
- **Lados:** o time que NÃO escolheu o mapa escolhe o lado; no decider, faca (knife round) ou regra do torneio.
- **Formato de jogo:** MR12 (13 rounds para vencer); prorrogação MR3 com $10.000 de início, sem limite de rounds.
- **Pausas:** pausas técnicas de até 5 minutos por incidente; pausa tática só nas condições do regulamento do evento.
- **Reservas:** substituições somente entre mapas.
${extra}`;

export const cs2: GameDef = {
  id: "cs2",
  slug: "counter-strike-2",
  name: "Counter-Strike 2",
  abbr: "CS2",
  category: "FPS tático",
  accent: "#f6a31b",
  tagline: "5v5 com veto de mapas, Suíço de Major e playoffs em Bo3.",
  description:
    "O FPS tático da Valve. Suporta o formato dos Majors (Suíço 3-3 com Bo1 e Bo3 decisivas), grupos GSL, dupla eliminação e muito mais.",
  platforms: ["PC"],
  regions: ["BR", "LATAM", "NA", "EU", "CIS", "Ásia", "Oceania"],
  modes: [{ id: "5v5", label: "5v5 Competitivo", teamSize: 5, maxSubs: 2, description: "Cinco titulares e até dois reservas, mais técnico opcional." }],
  identity: [STEAM_ID, FACEIT, discordField()],
  mapPool: {
    label: "Active Duty (ajuste conforme a rotação vigente)",
    maps: ["Ancient", "Anubis", "Dust II", "Inferno", "Mirage", "Nuke", "Overpass"],
    note: "A rotação de mapas muda com atualizações do jogo. O organizador pode editar o pool.",
  },
  vetoSupported: true,
  matchSettings: [
    "Modo: Competitivo 5v5, MR12, prorrogação MR3.",
    "Veto Bo1: 6 bans alternados (decider = mapa restante). Bo3: ban, ban, pick, pick, ban, ban (decider = restante).",
    "Lado: o adversário de quem escolheu o mapa escolhe o lado; no decider, faca ou regra do evento.",
    "Pausas técnicas e táticas conforme o regulamento do evento.",
  ],
  rules: csRules("- **Prova do resultado:** print da tabela final de cada mapa e/ou demo."),
  presets: csPresets("cs2", "CS2"),
  notes: [
    "O Major de Colônia 2026 usa 3 Suíços de 16 times (3V/3D). Nos estágios 1 e 2, partidas de classificação/eliminação são Bo3 e as demais Bo1; no estágio 3 tudo é Bo3.",
    "Pools de mapas mudam; confira a rotação oficial antes de publicar o campeonato.",
  ],
};

export const csgo: GameDef = {
  id: "csgo",
  slug: "counter-strike-go",
  name: "CS:GO (legado)",
  abbr: "CSGO",
  category: "FPS tático",
  accent: "#de9b35",
  tagline: "Campeonatos retrô de CS:GO com os mesmos formatos de CS.",
  description:
    "Suporte a campeonatos de Counter-Strike: Global Offensive (versão legada), útil para ligas retrô e comunidades que ainda mantêm servidores. Usa os mesmos formatos do CS2.",
  platforms: ["PC"],
  regions: ["BR", "LATAM", "NA", "EU"],
  modes: [{ id: "5v5", label: "5v5 Competitivo", teamSize: 5, maxSubs: 2, description: "Cinco titulares e até dois reservas." }],
  identity: [STEAM_ID, FACEIT, discordField()],
  mapPool: {
    label: "Active Duty clássico (CS:GO, fim de 2023)",
    maps: ["Ancient", "Anubis", "Inferno", "Mirage", "Nuke", "Overpass", "Vertigo"],
  },
  vetoSupported: true,
  matchSettings: [
    "Modo: Competitivo 5v5, MR15 (16 rounds para vencer) — versão clássica; prorrogação MR3.",
    "Veto Bo1: 6 bans alternados. Bo3: ban, ban, pick, pick, ban, ban.",
    "Servidor de comunidade com anticheat; demos obrigatórias.",
  ],
  rules: csRules("- **Versão:** o campeonato é disputado em CS:GO legado. Confirme com a organização a versão do cliente/servidor.\n- **Formato de jogo:** MR15 (16 rounds) na versão clássica, salvo regra diferente do evento."),
  presets: csPresets("csgo", "CS:GO"),
  notes: ["O CS:GO foi substituído pelo CS2 em 2023; mantemos o suporte para ligas retrô e comunidades."],
};
