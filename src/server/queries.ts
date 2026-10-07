import { db } from "@/lib/db";
import {
  leaderboardState,
  resolveStage,
  stageStandings,
  swissRecordsFor,
  type LeaderboardRow,
  type SlotSource,
  type StageSettings,
  type StandingRow,
} from "@/engine";
import { getGame } from "@/games";
import { loadStage } from "./stage-runner";
import { activeCount, expireStaleReservations } from "./orders";
import { canManageOrg } from "./permissions";
import type { Actor } from "./types";

export interface ListFilters {
  gameId?: string;
  status?: "abertos" | "andamento" | "encerrados";
  fee?: "gratis" | "pago";
  q?: string;
  page?: number;
}

const PAGE = 12;

export async function listPublicTournaments(f: ListFilters = {}) {
  const statusWhere =
    f.status === "andamento"
      ? { status: "LIVE" as const }
      : f.status === "encerrados"
        ? { status: "COMPLETED" as const }
        : f.status === "abertos"
          ? { status: { in: ["REGISTRATION", "CHECK_IN"] as ("REGISTRATION" | "CHECK_IN")[] } }
          : { status: { in: ["REGISTRATION", "CHECK_IN", "LIVE", "COMPLETED"] as ("REGISTRATION" | "CHECK_IN" | "LIVE" | "COMPLETED")[] } };
  const where = {
    visibility: "PUBLIC" as const,
    ...statusWhere,
    ...(f.gameId ? { gameId: f.gameId } : {}),
    ...(f.fee === "gratis" ? { entryFeeCents: 0 } : f.fee === "pago" ? { entryFeeCents: { gt: 0 } } : {}),
    ...(f.q ? { name: { contains: f.q } } : {}),
  };
  const page = Math.max(1, f.page ?? 1);
  const [items, total] = await Promise.all([
    db.tournament.findMany({
      where,
      orderBy: f.status === "encerrados" ? { startsAt: "desc" } : { startsAt: "asc" },
      skip: (page - 1) * PAGE,
      take: PAGE,
      include: { org: { select: { name: true, slug: true } }, _count: { select: { participants: { where: { status: { in: ["REGISTERED", "CHECKED_IN", "PENDING_PAYMENT"] } } } } } },
    }),
    db.tournament.count({ where }),
  ]);
  return { items, total, page, pages: Math.max(1, Math.ceil(total / PAGE)) };
}

export async function upcomingTournaments(take = 6) {
  return db.tournament.findMany({
    where: { visibility: "PUBLIC", status: { in: ["REGISTRATION", "CHECK_IN", "LIVE"] } },
    orderBy: { startsAt: "asc" },
    take,
    include: { org: { select: { name: true } }, _count: { select: { participants: { where: { status: { in: ["REGISTERED", "CHECKED_IN", "PENDING_PAYMENT"] } } } } } },
  });
}

export async function tournamentPage(slug: string, viewer?: Actor) {
  const viewerId = viewer?.id;
  const t = await db.tournament.findUnique({ where: { slug }, include: { org: true, stages: { orderBy: { order: "asc" } } } });
  if (!t) return null;
  await expireStaleReservations(db, t.id);
  const [slots, mine, prizes] = await Promise.all([
    activeCount(db, t.id),
    viewerId ? db.participant.findUnique({ where: { tournamentId_userId: { tournamentId: t.id, userId: viewerId } }, include: { orders: { orderBy: { createdAt: "desc" }, take: 1 } } }) : null,
    db.prizeAward.findMany({ where: { tournamentId: t.id }, include: { participant: { select: { name: true } } }, orderBy: { placement: "asc" } }),
  ]);
  const waitlist = await db.participant.count({ where: { tournamentId: t.id, status: "WAITLIST" } });
  const isManager = viewer ? await canManageOrg(viewer, t.orgId, "staff") : false;
  return { t, slots, waitlist, mine, prizes, isManager, game: getGame(t.gameId) };
}

export interface PNames {
  id: string;
  name: string;
  tag: string | null;
  seed: number | null;
}

export interface MatchView {
  id: string;
  key: string;
  bracket: string;
  round: number;
  position: number;
  group: number | null;
  bestOf: number;
  status: string;
  scoreA: number | null;
  scoreB: number | null;
  winnerSide: string | null;
  forfeit: string | null;
  scheduledAt: Date | null;
  a: PNames | null;
  b: PNames | null;
  slotA: SlotSource;
  slotB: SlotSource;
}

export interface StageView {
  id: string;
  name: string;
  order: number;
  type: StageSettings["type"];
  status: string;
  settings: StageSettings;
  matches: MatchView[];
  groups: string[][] | null;
  standings: Array<StandingRow & { name: string; tag: string | null }>;
  leaderboard: Array<LeaderboardRow & { name: string; tag: string | null }> | null;
  brGames: Array<{ id: string; round: number; lobby: number; code: string | null; done: boolean; participants: PNames[]; results: Array<{ participantId: string; placement: number; kills: number }> }>;
  swiss: Record<string, { wins: number; losses: number; state: string }> | null;
  participants: PNames[];
  champion: string | null;
}

export async function stageViews(tournamentId: string): Promise<StageView[]> {
  const stages = await db.stage.findMany({ where: { tournamentId }, orderBy: { order: "asc" } });
  const people = await db.participant.findMany({ where: { tournamentId }, select: { id: true, name: true, tag: true, seed: true } });
  const byId = new Map(people.map((p) => [p.id, p]));
  const out: StageView[] = [];
  for (const s of stages) {
    const settings = s.settings as unknown as StageSettings;
    const base = { id: s.id, name: s.name, order: s.order, type: settings.type, status: s.status, settings };
    if (s.status === "PENDING") {
      const pre = ((s.seedOrder as unknown as string[] | null) ?? []).map((id) => byId.get(id)).filter((x): x is PNames => !!x);
      out.push({ ...base, matches: [], groups: null, standings: [], leaderboard: null, brGames: [], swiss: null, participants: pre, champion: null });
      continue;
    }
    const ctx = await loadStage(db, s.id);
    const matches: MatchView[] = ctx.matches.map((m) => ({
      id: m.id,
      key: m.key,
      bracket: m.bracket,
      round: m.round,
      position: m.position,
      group: m.group,
      bestOf: m.bestOf,
      status: m.status,
      scoreA: m.scoreA,
      scoreB: m.scoreB,
      winnerSide: m.winnerSide,
      forfeit: m.forfeit,
      scheduledAt: m.scheduledAt,
      a: m.participantAId ? (byId.get(m.participantAId) ?? null) : null,
      b: m.participantBId ? (byId.get(m.participantBId) ?? null) : null,
      slotA: m.slotA as unknown as SlotSource,
      slotB: m.slotB as unknown as SlotSource,
    }));
    const standings = stageStandings(ctx.input).map((r) => ({ ...r, name: byId.get(r.participantId)?.name ?? "—", tag: byId.get(r.participantId)?.tag ?? null }));
    let leaderboard: StageView["leaderboard"] = null;
    let champion: string | null = null;
    if (settings.type === "LEADERBOARD") {
      const st = leaderboardState(ctx.input)!;
      leaderboard = st.rows.map((r) => ({ ...r, name: byId.get(r.participantId)?.name ?? "—", tag: byId.get(r.participantId)?.tag ?? null }));
      champion = st.champion;
    }
    const swissMap = swissRecordsFor(ctx.input);
    out.push({
      ...base,
      matches,
      groups: ctx.input.groups ? ctx.input.groups.map((g) => [...g]) : null,
      standings,
      leaderboard,
      brGames: ctx.brGames.map((g) => ({
        id: g.id,
        round: g.round,
        lobby: g.lobby,
        code: g.code,
        done: g.completedAt !== null,
        participants: ((g.participantIds as unknown as string[]) ?? []).map((id) => byId.get(id)).filter((x): x is PNames => !!x),
        results: g.results.map((r) => ({ participantId: r.participantId, placement: r.placement, kills: r.kills })),
      })),
      swiss: swissMap ? Object.fromEntries([...swissMap.entries()].map(([id, v]) => [id, v])) : null,
      participants: ctx.input.participants.map((id) => byId.get(id)).filter((x): x is PNames => !!x),
      champion,
    });
    void resolveStage;
  }
  return out;
}

export async function matchPage(id: string) {
  const m = await db.match.findUnique({
    where: { id },
    include: { stage: { include: { tournament: { include: { org: true } } } }, participantA: true, participantB: true, disputes: { orderBy: { createdAt: "desc" } } },
  });
  return m;
}
