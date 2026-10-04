import type { GameDef } from "./types";
import { BR_TIEBREAKERS, EA_ID, GENERIC_BR_PLACEMENT, POINTS_WIN_ONLY, TB_LEAGUE, TB_SWISS, bo, discordField, platformField } from "./common";

const redsecScoring = { formula: "additive" as const, placementPoints: GENERIC_BR_PLACEMENT, killPoints: 1 };

export const bf6: GameDef = {
  id: "bf6",
  slug: "battlefield-6",
  name: "Battlefield 6",
  abbr: "BF6",
  category: "Battle Royale",
  accent: "#ff7a1a",
  tagline: "REDSEC em esquadrões de 4 e modos 4v4 por chaves.",
  description:
    "Campeonatos de Battlefield 6 em dois estilos: leaderboard no estilo REDSEC (esquadrões de 4 no Battle Royale e fase final no Gauntlet) e disputas 4v4 em chave eliminatória para comunidades.",
  platforms: ["PC", "PlayStation", "Xbox"],
  regions: ["BR", "Américas", "EMEA", "APAC"],
  modes: [
    { id: "redsec-squads", label: "REDSEC — esquadrões de 4", teamSize: 4, maxSubs: 1, description: "Battle Royale/Gauntlet do REDSEC Elite Series." },
    { id: "team-4v4", label: "4v4 por chaves", teamSize: 4, maxSubs: 2, description: "Partidas 4v4 de modos por equipe (ex.: Squad Deathmatch, Domination)." },
  ],
  identity: [EA_ID, platformField(["PC", "PlayStation", "Xbox"]), discordField()],
  vetoSupported: true,
  matchSettings: [
    "REDSEC: lobbies personalizados de Battle Royale; os 8 melhores esquadrões disputam a fase final em Gauntlet.",
    "O REDSEC Elite Series oficial usa 50 esquadrões por região em 6 partidas de BR por dia, top 8 no Gauntlet, e pontos acumulados ao longo de 3 dias; os 25 melhores seguem para as finais regionais.",
    "Crossplay e cross-input permitidos, a menos que o regulamento do evento restrinja a plataforma.",
    "Modos 4v4: escolha de mapa por veto (se houver pool) e mapa/modo definidos pela organização.",
  ],
  rules: `- **Plataforma:** crossplay/cross-input conforme regulamento. Informe sua plataforma na inscrição.
- **Anti-cheat:** Javelin ativo; qualquer burla resulta em desclassificação.
- **Lobbies REDSEC:** a organização informa o código de lobby; quem não estiver no lobby não pontua na partida.
- **Pontuação:** pontos por colocação + 1 ponto por abate (valores editáveis no estágio de leaderboard).
- **Modos 4v4:** mapa e modo definidos pela organização; veto na sala da partida quando houver pool de mapas.`,
  presets: [
    {
      id: "bf6.redsec-day",
      name: "Dia de qualificação REDSEC + Final Gauntlet",
      description:
        "Qualificação de 6 partidas de Battle Royale em lobby único de até 50 esquadrões; o Top 8 avança para a final no Gauntlet com pontuação zerada.",
      basedOn: "REDSEC Elite Series (6 partidas de BR por dia → top 8 no Gauntlet). Pontuação sugerida e editável.",
      minParticipants: 10,
      maxParticipants: 100,
      suggestedParticipants: 50,
      modes: ["redsec-squads"],
      stages: [
        {
          name: "Qualificação (Battle Royale)",
          settings: {
            type: "LEADERBOARD",
            games: 6,
            lobbySize: 50,
            lobbyAssignment: "snake",
            scoring: redsecScoring,
            tiebreakers: BR_TIEBREAKERS,
            advancement: { count: 8 },
          },
        },
        {
          name: "Final (Gauntlet)",
          settings: {
            type: "LEADERBOARD",
            games: 4,
            lobbySize: 8,
            lobbyAssignment: "fixed",
            scoring: redsecScoring,
            tiebreakers: BR_TIEBREAKERS,
          },
        },
      ],
    },
    {
      id: "bf6.4v4-single",
      name: "4v4 — eliminação simples (Bo3)",
      description: "Chave eliminatória de equipes 4v4. Bo3 e final em Bo5.",
      basedOn: "Padrão de torneios de comunidade",
      minParticipants: 4,
      maxParticipants: 64,
      suggestedParticipants: 16,
      modes: ["team-4v4"],
      stages: [{ name: "Playoffs", settings: { type: "SINGLE_ELIMINATION", bestOf: bo(3, { finals: 5 }), thirdPlaceMatch: false } }],
    },
    {
      id: "bf6.4v4-double",
      name: "4v4 — eliminação dupla",
      description: "Cada equipe só cai após duas derrotas. Bo3, finais em Bo5.",
      basedOn: "Padrão de torneios de comunidade",
      minParticipants: 4,
      maxParticipants: 64,
      suggestedParticipants: 16,
      modes: ["team-4v4"],
      stages: [{ name: "Chave dupla", settings: { type: "DOUBLE_ELIMINATION", bestOf: bo(3, { finals: 5 }), grandFinalReset: true } }],
    },
    {
      id: "bf6.4v4-swiss",
      name: "4v4 — Suíço + playoffs",
      description: "Suíço de 3 vitórias/3 derrotas (Bo1, decisivas Bo3) e playoffs com os 8 melhores.",
      basedOn: "Formato suíço de torneios de FPS",
      minParticipants: 16,
      maxParticipants: 16,
      suggestedParticipants: 16,
      modes: ["team-4v4"],
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
      id: "bf6.4v4-league",
      name: "4v4 — liga de pontos corridos",
      description: "Todos contra todos em Bo3.",
      basedOn: "Formato de liga",
      minParticipants: 3,
      maxParticipants: 10,
      suggestedParticipants: 8,
      modes: ["team-4v4"],
      stages: [
        {
          name: "Pontos corridos",
          settings: { type: "ROUND_ROBIN", groups: 1, legs: 1, bestOf: 3, allowDraw: false, points: POINTS_WIN_ONLY, tiebreakers: TB_LEAGUE, groupAssignment: "snake" },
        },
      ],
    },
  ],
  notes: [
    "REDSEC Elite Series (fonte: comunicados oficiais da EA): 50 esquadrões de 4 por região, 6 partidas de Battle Royale por Match Day, Top 8 em Gauntlet; 3 Match Days de qualificação e Top 25 nas finais regionais; US$ 1 milhão em prêmios; Elite Series e Open Series.",
    "A tabela oficial de pontos do REDSEC não foi encontrada nas fontes consultadas; a pontuação aqui (15/12/10/8/6/5/4/3/2/1 + 1 por abate) é uma sugestão de comunidade e pode ser editada.",
    "Os modos por equipe do BF6 não têm circuito competitivo oficial detalhado; os presets 4v4 seguem práticas comuns de comunidades.",
  ],
};
