import type { GameDef } from "./types";
import {
  ACTIVISION_ID,
  BR_TIEBREAKERS,
  GENERIC_BR_PLACEMENT,
  WARZONE_DUOS_MULTIPLIERS,
  WARZONE_TRIOS_MULTIPLIERS,
  discordField,
  platformField,
} from "./common";

export const warzone: GameDef = {
  id: "warzone",
  slug: "call-of-duty-warzone",
  name: "Call of Duty: Warzone",
  abbr: "WZ",
  category: "Battle Royale",
  accent: "#74b816",
  tagline: "Abates × multiplicador de colocação, no estilo World Series of Warzone.",
  description:
    "Battle royale da Activision. A pontuação do World Series of Warzone é diferente da maioria dos BRs: cada abate vale 1 ponto multiplicado pela colocação do time (1º lugar vale o dobro). Também suportamos pontuação por colocação + abates para comunidades.",
  platforms: ["PC", "PlayStation", "Xbox"],
  regions: ["BR", "NA", "EU", "LATAM"],
  modes: [
    { id: "duos", label: "Duos", teamSize: 2, maxSubs: 1 },
    { id: "trios", label: "Trios", teamSize: 3, maxSubs: 1 },
    { id: "quads", label: "Quads", teamSize: 4, maxSubs: 1 },
  ],
  identity: [ACTIVISION_ID, platformField(["PC", "PlayStation", "Xbox"]), discordField()],
  vetoSupported: false,
  matchSettings: [
    "Lobbies em partida privada/torneio do Warzone com o mapa definido pela organização.",
    "Trios (WSOW 2024): cada abate = 1 ponto × multiplicador da colocação — 1º 2× · 2º–5º 1,8× · 6º–10º 1,6× · 11º–15º 1,4× · 16º–25º 1,2× · demais 1×.",
    "Duos (WSOW): 1º 2× · 2º–25º 1,5× · demais 1×.",
    "Quads: pontuação padrão de comunidade (colocação + abates), editável.",
  ],
  rules: `- **Lobby:** código/lobby informado pela organização; quem não estiver no lobby no horário não pontua na partida.
- **Abates:** valem apenas abates contra times adversários; combinar com outros times é proibido.
- **Prova:** envie prints/clipes da tela de resultado de cada partida ao final dela; a organização pode pedir o replay.
- **Pontuação:** conforme o estágio de leaderboard; abates multiplicados pela colocação (Duos/Trios) ou colocação + abates (Quads).
- **Anti-cheat:** Ricochet ativo; é proibido stream sniping e uso de bugs/exploits.`,
  presets: [
    {
      id: "warzone.trios",
      name: "Sessão Trios — estilo WSOW (6 partidas)",
      description: "6 partidas; cada abate vale 1 ponto × multiplicador de colocação (2× no 1º lugar, 1,8× do 2º ao 5º ...).",
      basedOn: "World Series of Warzone — pontuação de Trios (tabela de 2024)",
      minParticipants: 3,
      maxParticipants: 150,
      suggestedParticipants: 50,
      modes: ["trios"],
      stages: [
        {
          name: "Leaderboard",
          settings: {
            type: "LEADERBOARD",
            games: 6,
            lobbySize: 50,
            lobbyAssignment: "snake",
            scoring: { formula: "multiplier", placementPoints: [], killPoints: 1, placementMultipliers: WARZONE_TRIOS_MULTIPLIERS },
            tiebreakers: ["points", "wins", "kills", "bestPlacement", "seed"],
          },
        },
      ],
    },
    {
      id: "warzone.duos",
      name: "Sessão Duos — estilo WSOW (6 partidas)",
      description: "6 partidas; cada abate vale 1 ponto × multiplicador (1º 2×, 2º–25º 1,5×).",
      basedOn: "World Series of Warzone — pontuação de Duos",
      minParticipants: 3,
      maxParticipants: 150,
      suggestedParticipants: 50,
      modes: ["duos"],
      stages: [
        {
          name: "Leaderboard",
          settings: {
            type: "LEADERBOARD",
            games: 6,
            lobbySize: 75,
            lobbyAssignment: "snake",
            scoring: { formula: "multiplier", placementPoints: [], killPoints: 1, placementMultipliers: WARZONE_DUOS_MULTIPLIERS },
            tiebreakers: ["points", "wins", "kills", "bestPlacement", "seed"],
          },
        },
      ],
    },
    {
      id: "warzone.community",
      name: "Sessão comunitária — colocação + abates",
      description: "6 partidas com pontos por colocação (15/12/10/8/6/5/4/3/2/1) e 1 ponto por abate. Para Quads e eventos casuais.",
      basedOn: "Prática de comunidade (pontuação editável)",
      minParticipants: 3,
      maxParticipants: 150,
      suggestedParticipants: 40,
      stages: [
        {
          name: "Leaderboard",
          settings: {
            type: "LEADERBOARD",
            games: 6,
            lobbySize: 50,
            lobbyAssignment: "snake",
            scoring: { formula: "additive", placementPoints: GENERIC_BR_PLACEMENT, killPoints: 1 },
            tiebreakers: BR_TIEBREAKERS,
          },
        },
      ],
    },
    {
      id: "warzone.qualifier-final",
      name: "Qualificatória + Final (Trios)",
      description: "Qualificatória de 6 partidas; os 25 melhores trios avançam para uma final de 6 partidas com pontos zerados.",
      basedOn: "Estrutura de qualificatória → final dos eventos de Warzone",
      minParticipants: 30,
      maxParticipants: 150,
      suggestedParticipants: 75,
      modes: ["trios"],
      stages: [
        {
          name: "Qualificatória",
          settings: {
            type: "LEADERBOARD",
            games: 6,
            lobbySize: 50,
            lobbyAssignment: "snake",
            scoring: { formula: "multiplier", placementPoints: [], killPoints: 1, placementMultipliers: WARZONE_TRIOS_MULTIPLIERS },
            tiebreakers: ["points", "wins", "kills", "bestPlacement", "seed"],
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
            scoring: { formula: "multiplier", placementPoints: [], killPoints: 1, placementMultipliers: WARZONE_TRIOS_MULTIPLIERS },
            tiebreakers: ["points", "wins", "kills", "bestPlacement", "seed"],
          },
        },
      ],
    },
  ],
  notes: [
    "Conferido (WSOW 2024, Trios): 1 ponto por abate × 2,0 (1º), 1,8 (2º–5º), 1,6 (6º–10º), 1,4 (11º–15º), 1,2 (16º–25º), 1,0 (26º–34º). Duos: 2,0 (1º), 1,5 (2º–25º), sem bônus (26º–75º).",
    "As regras de partidas privadas e o número de times por lobby mudam com os patches do jogo; ajuste o tamanho do lobby conforme o modo escolhido.",
  ],
};
