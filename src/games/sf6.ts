import type { GameDef } from "./types";
import { CAPCOM_ID, POINTS_WIN_ONLY, TB_LEAGUE, bo, discordField, platformField } from "./common";

export const sf6: GameDef = {
  id: "sf6",
  slug: "street-fighter",
  name: "Street Fighter",
  abbr: "SF",
  category: "Luta",
  accent: "#f5b800",
  tagline: "1v1 em dupla eliminação, Bo3 com finais Bo5, estilo Capcom Cup/EVO.",
  description:
    "Jogo de luta da Capcom. Os campeonatos seguem o padrão dos eventos oficiais: dupla eliminação com sets Bo3 e finais (vencedores, perdedores e grande final) em Bo5, com grupos em pontos corridos antes do Top 8 quando há muitos jogadores.",
  platforms: ["PC", "PlayStation", "Xbox"],
  regions: ["BR", "LATAM", "NA", "EU", "Ásia", "Oceania"],
  modes: [{ id: "1v1", label: "1v1", teamSize: 1, maxSubs: 0 }],
  identity: [
    CAPCOM_ID,
    platformField(["PC", "PlayStation", "Xbox"]),
    { key: "main", label: "Personagem principal (opcional)", type: "text", required: false },
    discordField(),
  ],
  vetoSupported: false,
  matchSettings: [
    "Sets Bo3 (2 games vencem) e finais Bo5 (3 games vencem) — padrão Capcom Cup (Bo3 até o Top 3; Bo5 nas finais).",
    "Cada game com 99 segundos e 2 rounds para vencer (padrão de torneio), salvo regra do evento.",
    "Seleção de personagem e de cenário seguem o regulamento do evento (ex.: personagem fixo durante o set ou troca liberada pelo perdedor).",
    "Controle: o jogador usa o próprio controle/arcade; sem macros.",
  ],
  rules: `- **Salas:** a partida é jogada em sala personalizada (Battle Hub/Custom Room) criada pelo jogador de melhor seed; conexão cabeada recomendada.
- **Sets:** Bo3, com Bo5 nas finais. Quem vence os games necessários vence o set.
- **Desconexão:** se um jogador cair, a organização decide entre refazer o round/game ou conceder o game, conforme a causa.
- **Personagem e cenário:** conforme o regulamento do evento. Ao final do set, informe o placar na plataforma.
- **Comportamento:** é proibido stalling, uso de macro e assistência externa durante os games.`,
  presets: [
    {
      id: "sf6.double-elim",
      name: "Eliminação dupla (Bo3, finais Bo5)",
      description: "O padrão dos majors: dupla eliminação com sets Bo3 e finais Bo5.",
      basedOn: "Capcom Cup / EVO — Bo3 com Bo5 nas finais da chave",
      minParticipants: 4,
      maxParticipants: 256,
      suggestedParticipants: 32,
      stages: [{ name: "Chave dupla", settings: { type: "DOUBLE_ELIMINATION", bestOf: bo(3, { finals: 5 }), grandFinalReset: true } }],
    },
    {
      id: "sf6.pools-top8",
      name: "Grupos + Top 8 em dupla eliminação",
      description:
        "Grupos de pontos corridos (Bo3) e os 2 melhores de cada um avançam para o Top 8 em dupla eliminação (Bo3, finais Bo5).",
      basedOn: "Capcom Pro Tour (fase de grupos → bracket) e Capcom Cup (Bo3 → Bo5 no Top 3)",
      minParticipants: 16,
      maxParticipants: 64,
      suggestedParticipants: 24,
      stages: [
        {
          name: "Grupos",
          settings: {
            type: "ROUND_ROBIN",
            groups: 4,
            legs: 1,
            bestOf: 3,
            allowDraw: false,
            points: POINTS_WIN_ONLY,
            tiebreakers: TB_LEAGUE,
            groupAssignment: "snake",
            advancement: { perGroup: 2 },
          },
        },
        { name: "Top 8", settings: { type: "DOUBLE_ELIMINATION", bestOf: bo(3, { finals: 5 }), grandFinalReset: true } },
      ],
    },
    {
      id: "sf6.single-elim",
      name: "Eliminação simples (Bo3, final Bo5)",
      description: "Torneio rápido de uma tarde. Disputa de 3º lugar incluída.",
      basedOn: "Padrão de torneios locais",
      minParticipants: 4,
      maxParticipants: 128,
      suggestedParticipants: 16,
      stages: [{ name: "Chave", settings: { type: "SINGLE_ELIMINATION", bestOf: bo(3, { finals: 5 }), thirdPlaceMatch: true } }],
    },
    {
      id: "sf6.round-robin",
      name: "Liga — todos contra todos (Bo3)",
      description: "Pontos corridos, turno único. Ótimo para ligas semanais entre amigos.",
      basedOn: "Formato de liga",
      minParticipants: 3,
      maxParticipants: 12,
      suggestedParticipants: 8,
      stages: [
        {
          name: "Pontos corridos",
          settings: { type: "ROUND_ROBIN", groups: 1, legs: 1, bestOf: 3, allowDraw: false, points: POINTS_WIN_ONLY, tiebreakers: TB_LEAGUE, groupAssignment: "snake" },
        },
      ],
    },
  ],
  notes: [
    "Conferido: Capcom Cup usa Bo3 até o Top 3 e Bo5 para as finais (vencedores, perdedores e grande final); o Capcom Pro Tour combina fases de grupos e dupla eliminação.",
    "Regras de seleção de personagem/cenário variam entre eventos; ajuste no regulamento do campeonato.",
  ],
};
