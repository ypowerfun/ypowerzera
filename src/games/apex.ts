import type { GameDef } from "./types";
import { ALGS_PLACEMENT, BR_TIEBREAKERS, EA_ID, discordField, platformField } from "./common";

const algsScoring = { formula: "additive" as const, placementPoints: ALGS_PLACEMENT, killPoints: 1 };

export const apex: GameDef = {
  id: "apex",
  slug: "apex-legends",
  name: "Apex Legends",
  abbr: "APEX",
  category: "Battle Royale",
  accent: "#da292a",
  tagline: "Formato ALGS: 20 times, pontos por colocação e Match Point.",
  description:
    "Battle royale em trios da Respawn/EA. Os campeonatos seguem o ALGS: 20 times por lobby, 12 pontos para o 1º lugar até 0 para o 16º+, 1 ponto por abate e, nas finais, o formato Match Point (50 pontos + uma vitória).",
  platforms: ["PC", "PlayStation", "Xbox"],
  regions: ["BR", "NA", "EMEA", "APAC", "LATAM"],
  modes: [
    { id: "trios", label: "Trios", teamSize: 3, maxSubs: 1, description: "Formato oficial do ALGS: 3 jogadores + 1 reserva." },
    { id: "duos", label: "Duos", teamSize: 2, maxSubs: 1 },
  ],
  identity: [EA_ID, platformField(["PC", "PlayStation", "Xbox"]), discordField()],
  vetoSupported: false,
  matchSettings: [
    "Lobby personalizado do Apex (Custom Match) com 20 times; o mapa segue a rotação do ALGS.",
    "Pontos por colocação: 1º 12 · 2º 9 · 3º 7 · 4º 5 · 5º 4 · 6º–7º 3 · 8º–10º 2 · 11º–15º 1 · 16º–20º 0. 1 ponto por abate.",
    "Match Point: o time precisa atingir 50 pontos e DEPOIS vencer uma partida para ser campeão. Não há limite de partidas.",
    "Desempate: mais vitórias → mais abates → melhor colocação → colocação na última partida.",
  ],
  rules: `- **Lobby:** os líderes entram no lobby personalizado com o código informado pela organização.
- **Pontuação:** tabela ALGS (colocação + 1 ponto por abate). Abates válidos apenas contra times adversários.
- **Match Point:** quando algum time atinge 50 pontos, ele precisa vencer uma partida seguinte; se outro time vencer, o jogo segue.
- **Trocas de jogadores:** só antes da partida e com aviso à organização.
- **Prova do resultado:** a organização usa a tela de resultados do lobby; times enviam prints em caso de divergência.`,
  presets: [
    {
      id: "apex.match-point",
      name: "ALGS Match Point (50 pontos)",
      description: "Lobby único de até 20 times. Joga-se até alguém ter 50 pontos e vencer uma partida (teto de 20 partidas).",
      basedOn: "ALGS Playoffs/Finals — formato Match Point",
      minParticipants: 6,
      maxParticipants: 20,
      suggestedParticipants: 20,
      stages: [
        {
          name: "Match Point",
          settings: {
            type: "LEADERBOARD",
            games: 20,
            lobbySize: 20,
            lobbyAssignment: "fixed",
            scoring: algsScoring,
            matchPoint: { threshold: 50, requireWin: true },
            tiebreakers: BR_TIEBREAKERS,
          },
        },
      ],
    },
    {
      id: "apex.day",
      name: "Dia de jogos (6 partidas)",
      description: "Um dia de 6 partidas com a pontuação ALGS. Com mais de 20 times, vários lobbies jogam em paralelo.",
      basedOn: "ALGS — match day de 6 mapas",
      minParticipants: 6,
      maxParticipants: 60,
      suggestedParticipants: 20,
      stages: [
        {
          name: "Dia de jogos",
          settings: {
            type: "LEADERBOARD",
            games: 6,
            lobbySize: 20,
            lobbyAssignment: "snake",
            scoring: algsScoring,
            tiebreakers: BR_TIEBREAKERS,
          },
        },
      ],
    },
    {
      id: "apex.qualifier-final",
      name: "Qualificatória + Final Match Point",
      description: "Qualificatória de 6 partidas em vários lobbies; os 20 melhores disputam a final em Match Point (50 pontos).",
      basedOn: "ALGS — Challenger/Qualifiers → Finals",
      minParticipants: 24,
      maxParticipants: 60,
      suggestedParticipants: 40,
      stages: [
        {
          name: "Qualificatória",
          settings: {
            type: "LEADERBOARD",
            games: 6,
            lobbySize: 20,
            lobbyAssignment: "snake",
            scoring: algsScoring,
            tiebreakers: BR_TIEBREAKERS,
            advancement: { count: 20 },
          },
        },
        {
          name: "Final (Match Point)",
          settings: {
            type: "LEADERBOARD",
            games: 20,
            lobbySize: 20,
            lobbyAssignment: "fixed",
            scoring: algsScoring,
            matchPoint: { threshold: 50, requireWin: true },
            tiebreakers: BR_TIEBREAKERS,
          },
        },
      ],
    },
  ],
  notes: [
    "Tabela de pontos ALGS 2026 conferida: 12/9/7/5/4/3/3/2/2/2/1×5/0 e 1 ponto por abate. Match Point = 50 pontos + vitória.",
    "A temporada regular do ALGS usa pontos de série por dia de jogo (25 pontos para o 1º até 1 para o 20º). Para ligas assim, encadeie vários campeonatos ou use o leaderboard com várias partidas.",
  ],
};
