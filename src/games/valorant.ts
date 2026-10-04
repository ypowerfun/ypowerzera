import type { GameDef } from "./types";
import { RIOT_ID, TB_LEAGUE, POINTS_WIN_ONLY, bo, discordField } from "./common";

export const valorant: GameDef = {
  id: "valorant",
  slug: "valorant",
  name: "VALORANT",
  abbr: "VAL",
  category: "FPS tático",
  accent: "#ff4655",
  tagline: "5v5 tático com veto de mapas, grupos GSL e dupla eliminação.",
  description:
    "FPS tático 5v5 da Riot Games. Os campeonatos usam veto/pick de mapas (Bo1, Bo3 ou Bo5), grupos GSL de 4 times e playoffs de dupla eliminação, como no VCT.",
  platforms: ["PC"],
  regions: ["BR", "LATAM Sul", "LATAM Norte", "NA", "EMEA", "APAC"],
  modes: [{ id: "5v5", label: "5v5 Competitivo", teamSize: 5, maxSubs: 2, description: "Cinco titulares e até dois reservas, mais técnico opcional." }],
  identity: [RIOT_ID, { key: "agentPool", label: "Agentes principais (opcional)", type: "text", required: false }, discordField()],
  mapPool: {
    label: "Pool padrão (ajuste conforme o patch vigente)",
    maps: ["Abyss", "Bind", "Haven", "Lotus", "Pearl", "Split", "Sunset"],
    note: "O pool de mapas muda com os patches. O organizador pode editar o pool de cada campeonato.",
  },
  vetoSupported: true,
  matchSettings: [
    "Modo: Competitivo/Personalizado com 13 rounds para vencer e prorrogação (vence quem abrir 2 rounds).",
    "Veto: Bo1 — 6 bans alternados e o mapa restante é jogado; Bo3 — ban, ban, pick, pick, ban, ban e o restante é o decider; Bo5 — ban, ban, depois 4 picks alternados e o decider.",
    "Lado: o time que NÃO escolheu o mapa escolhe o lado inicial. No decider, a regra do torneio define quem escolhe.",
    "Pausas técnicas limitadas e cada time pode pedir pausa tática conforme as regras de torneio do jogo.",
  ],
  rules: `- **Lobby:** partidas em lobby personalizado criado pelo time de menor seed; espectadores indicados pela organização.
- **Veto:** realizado na sala da partida da plataforma. O time A (melhor seed) começa.
- **Agentes:** sem restrição de repetição, a menos que o regulamento do evento diga o contrário.
- **Substituições:** apenas entre mapas, com aviso à organização.
- **Prova do resultado:** print do placar final de cada mapa (ou replay).`,
  presets: [
    {
      id: "valorant.single-elim",
      name: "Copa — eliminação simples",
      description: "Bo1 até as quartas, Bo3 nas semifinais e final.",
      basedOn: "Padrão de copas abertas",
      minParticipants: 4,
      maxParticipants: 64,
      suggestedParticipants: 16,
      stages: [{ name: "Playoffs", settings: { type: "SINGLE_ELIMINATION", bestOf: bo(1, { semifinals: 3, finals: 3 }), thirdPlaceMatch: false } }],
    },
    {
      id: "valorant.double-elim",
      name: "Eliminação dupla (Bo3, finais Bo5)",
      description: "Playoffs no estilo VCT: Bo3 em toda a chave e Bo5 nas finais (vencedores, perdedores e grande final).",
      basedOn: "VCT — playoffs de dupla eliminação",
      minParticipants: 4,
      maxParticipants: 64,
      suggestedParticipants: 16,
      stages: [{ name: "Playoffs", settings: { type: "DOUBLE_ELIMINATION", bestOf: bo(3, { finals: 5 }), grandFinalReset: true } }],
    },
    {
      id: "valorant.champions",
      name: "Estilo Champions — grupos GSL + playoffs",
      description:
        "16 times em 4 grupos GSL (dupla eliminação de 4, tudo Bo3). Os 2 melhores de cada grupo avançam para playoffs de dupla eliminação.",
      basedOn: "VALORANT Champions 2026 (4 grupos GSL Bo3 → playoffs)",
      minParticipants: 16,
      maxParticipants: 16,
      suggestedParticipants: 16,
      stages: [
        { name: "Fase de grupos (GSL)", settings: { type: "GSL", bestOf: 3, groupAssignment: "snake", advancement: { perGroup: 2 } } },
        { name: "Playoffs", settings: { type: "DOUBLE_ELIMINATION", bestOf: bo(3, { finals: 5 }), grandFinalReset: true } },
      ],
    },
    {
      id: "valorant.vct-stage",
      name: "Estilo VCT Stage — 2 grupos + playoffs",
      description:
        "12 times em 2 grupos de 6 (pontos corridos, turno único, Bo3). Os 4 melhores de cada grupo seguem para playoffs de dupla eliminação, cruzando os grupos.",
      basedOn: "VCT Stage 1/2 (2 grupos de 6 → 8 times em dupla eliminação)",
      minParticipants: 12,
      maxParticipants: 12,
      suggestedParticipants: 12,
      stages: [
        {
          name: "Fase de grupos",
          settings: {
            type: "ROUND_ROBIN",
            groups: 2,
            legs: 1,
            bestOf: 3,
            allowDraw: false,
            points: POINTS_WIN_ONLY,
            tiebreakers: TB_LEAGUE,
            groupAssignment: "snake",
            advancement: { perGroup: 4 },
          },
        },
        { name: "Playoffs", settings: { type: "DOUBLE_ELIMINATION", bestOf: bo(3, { finals: 5 }), grandFinalReset: true } },
      ],
    },
  ],
  notes: [
    "Champions 2026: 16 times em 4 grupos GSL (Bo3). Os 2 primeiros de cada grupo vão aos playoffs. VCT Stage: 12 times em 2 grupos com round-robin simples; os 4 melhores de cada grupo seguem para dupla eliminação.",
    "O Kickoff do VCT usa eliminação tripla; esse formato ainda não é suportado pelo motor (use dupla eliminação).",
  ],
};
