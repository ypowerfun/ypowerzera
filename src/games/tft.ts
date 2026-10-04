import type { GameDef } from "./types";
import { BR_TIEBREAKERS, RIOT_ID, TFT_PLACEMENT, discordField } from "./common";

const tftScoring = { formula: "additive" as const, placementPoints: TFT_PLACEMENT, killPoints: 0 };
const tftTiebreakers = ["points", "wins", "bestPlacement", "avgPlacement", "lastGamePlacement", "seed"] as typeof BR_TIEBREAKERS;

export const tft: GameDef = {
  id: "tft",
  slug: "teamfight-tactics",
  name: "Teamfight Tactics",
  abbr: "TFT",
  category: "Auto battler",
  accent: "#2ea8ff",
  tagline: "Lobbies de 8, pontos por colocação e final em Checkmate.",
  description:
    "Auto battler da Riot Games. Os campeonatos reúnem vários lobbies de 8 jogadores reembaralhados a cada partida (sistema suíço) e terminam em uma final no formato Checkmate: o jogador precisa atingir o limite de pontos e depois vencer uma partida.",
  platforms: ["PC", "Mobile"],
  regions: ["BR", "LAS", "LAN", "NA", "EUW", "KR", "OCE"],
  modes: [{ id: "solo", label: "Individual (lobby de 8)", teamSize: 1, maxSubs: 0 }],
  identity: [RIOT_ID, discordField()],
  vetoSupported: false,
  matchSettings: [
    "Lobby personalizado do TFT com 8 jogadores; os lobbies são reembaralhados a cada partida pelo sistema suíço.",
    "Pontos por colocação: 1º 8 · 2º 7 · 3º 6 · 4º 5 · 5º 4 · 6º 3 · 7º 2 · 8º 1.",
    "Final Checkmate: o jogador precisa atingir o limite de pontos (ex.: 20) e depois vencer uma partida para ser campeão. Se ninguém elegível vencer a partida 8, o campeão é definido pelos pontos.",
    "Desempate: mais vitórias → melhor colocação → média de colocação → colocação na última partida.",
  ],
  rules: `- **Lobbies:** a organização informa o lobby e os jogadores de cada partida; o reposicionamento segue o ranking após cada partida.
- **Pontuação:** colocação de 1º a 8º vale 8 a 1 ponto.
- **Atrasos:** quem não entrar no lobby a tempo é contado como último colocado da partida.
- **Prova:** print da tela final de colocação do lobby, enviado pelo jogador ou conferido pela organização.
- **Checkmate:** na final, só vence quem atingir o limite de pontos e vencer a partida seguinte.`,
  presets: [
    {
      id: "tft.open",
      name: "Estilo TFT Open — lobbies suíços + Checkmate 20",
      description:
        "6 partidas classificatórias com lobbies de 8 reembaralhados a cada partida pela classificação; os 8 melhores disputam a final Checkmate 20 (até 8 partidas).",
      basedOn: "TFT Pro Circuit/Opens — Swiss de lobbies (lobbies reembaralhados a cada partida) e final Checkmate 20",
      minParticipants: 16,
      maxParticipants: 128,
      suggestedParticipants: 64,
      stages: [
        {
          name: "Rodadas suíças",
          settings: {
            type: "LEADERBOARD",
            games: 6,
            lobbySize: 8,
            lobbyAssignment: "swiss",
            scoring: tftScoring,
            tiebreakers: tftTiebreakers,
            advancement: { count: 8 },
          },
        },
        {
          name: "Final (Checkmate 20)",
          settings: {
            type: "LEADERBOARD",
            games: 8,
            lobbySize: 8,
            lobbyAssignment: "fixed",
            scoring: tftScoring,
            matchPoint: { threshold: 20, requireWin: true },
            tiebreakers: tftTiebreakers,
          },
        },
      ],
    },
    {
      id: "tft.lobby",
      name: "Lobby único — Checkmate 20",
      description: "Até 8 jogadores no mesmo lobby; jogam até alguém atingir 20 pontos e vencer (teto de 8 partidas).",
      basedOn: "Final Checkmate 20 do TFT",
      minParticipants: 2,
      maxParticipants: 8,
      suggestedParticipants: 8,
      stages: [
        {
          name: "Checkmate 20",
          settings: {
            type: "LEADERBOARD",
            games: 8,
            lobbySize: 8,
            lobbyAssignment: "fixed",
            scoring: tftScoring,
            matchPoint: { threshold: 20, requireWin: true },
            tiebreakers: tftTiebreakers,
          },
        },
      ],
    },
    {
      id: "tft.points-day",
      name: "Dia de pontos (5 partidas, lobbies reembaralhados)",
      description: "Todos jogam 5 partidas; a cada partida os lobbies são recompostos pela classificação. Quem somar mais pontos vence.",
      basedOn: "Etapas de pontos acumulados dos Opens de TFT",
      minParticipants: 8,
      maxParticipants: 128,
      suggestedParticipants: 32,
      stages: [
        {
          name: "Leaderboard",
          settings: {
            type: "LEADERBOARD",
            games: 5,
            lobbySize: 8,
            lobbyAssignment: "swiss",
            scoring: tftScoring,
            tiebreakers: tftTiebreakers,
          },
        },
      ],
    },
  ],
  notes: [
    "Conferido: grandes torneios de TFT usam lobbies de 8 reembaralhados após cada partida (Swiss) e finais no formato Checkmate 20 (o primeiro a atingir 20 pontos e vencer uma partida; se ninguém elegível vencer a partida 8, o campeão sai pela pontuação).",
    "Os lobbies suíços funcionam melhor com quantidade de jogadores múltipla de 8; sobras formam um lobby menor.",
  ],
};
