import { Prisma } from "@prisma/client";
import {
  buildStage,
  computeLeaderboard,
  firstTo,
  isStageComplete,
  leaderboardState,
  nextSwissRound,
  planLobbies,
  resolveStage,
  selectAdvancing,
  stageStandings,
  type BracketKind,
  type Id,
  type MatchResult,
  type MatchSpec,
  type ResolvedMatch,
  type SlotSource,
  type StageInput,
  type StageSettings,
  type StandingRow,
} from "@/engine";
import type { Tx } from "@/lib/db";
import { notify } from "./notifications";

type MatchRow = Prisma.MatchGetPayload<object>;

export interface LoadedStage {
  stage: Prisma.StageGetPayload<object>;
  settings: StageSettings;
  input: StageInput;
  matches: MatchRow[];
  brGames: Array<Prisma.BrGameGetPayload<{ include: { results: true } }>>;
}

export function rowToSpec(m: MatchRow): MatchSpec {
  return {
    key: m.key,
    bracket: m.bracket as BracketKind,
    round: m.round,
    position: m.position,
    group: m.group,
    bestOf: m.bestOf,
    a: m.slotA as unknown as SlotSource,
    b: m.slotB as unknown as SlotSource,
    onlyIfWinner: (m.onlyIfWinner as unknown as MatchSpec["onlyIfWinner"]) ?? undefined,
  };
}

export async function loadStage(tx: Tx, stageId: string): Promise<LoadedStage> {
  const stage = await tx.stage.findUniqueOrThrow({ where: { id: stageId } });
  const matches = await tx.match.findMany({ where: { stageId }, orderBy: [{ round: "asc" }, { position: "asc" }] });
  const brGames = await tx.brGame.findMany({ where: { stageId }, include: { results: true }, orderBy: [{ round: "asc" }, { lobby: "asc" }] });
  const results = new Map<string, MatchResult>();
  for (const m of matches) {
    if (m.status === "COMPLETED" && m.winnerSide && m.scoreA !== null && m.scoreB !== null) {
      results.set(m.key, {
        scoreA: m.scoreA,
        scoreB: m.scoreB,
        winner: m.winnerSide === "draw" ? null : (m.winnerSide as "a" | "b"),
        forfeit: (m.forfeit as "a" | "b" | null) ?? null,
      });
    }
  }
  const br = brGames.flatMap((g) =>
    g.results.map((r) => ({ round: g.round, lobby: g.lobby, participantId: r.participantId, placement: r.placement, kills: r.kills })),
  );
  const settings = stage.settings as unknown as StageSettings;
  return {
    stage,
    settings,
    matches,
    brGames,
    input: {
      settings,
      participants: ((stage.seedOrder as unknown as Id[] | null) ?? []).slice(),
      specs: matches.map(rowToSpec),
      results,
      groups: (stage.groups as unknown as Id[][] | null) ?? null,
      br,
    },
  };
}

const idOf = (e: ResolvedMatch["entrantA"]): string | null => (e.kind === "participant" ? e.id : null);

function forfeitScore(bestOf: number, winner: "a" | "b") {
  const w = bestOf === 1 ? 3 : firstTo(bestOf);
  return winner === "a" ? { scoreA: w, scoreB: 0 } : { scoreA: 0, scoreB: w };
}
export { forfeitScore };

/** Carrega o estágio, aplica automações (W.O. de desclassificados, próximas rodadas) e grava o estado resolvido. */
export async function syncStage(tx: Tx, stageId: string): Promise<{ complete: boolean }> {
  let ctx = await loadStage(tx, stageId);
  const stage0 = ctx.stage;
  const tournamentId = stage0.tournamentId;

  for (let loop = 0; loop < 400; loop++) {
    ctx = await loadStage(tx, stageId);
    if (ctx.stage.status === "PENDING") return { complete: false };

    if (ctx.settings.type === "LEADERBOARD") {
      if (await ensureBrRound(tx, ctx)) continue;
      break;
    }

    const resolved = resolveStage(ctx.input);

    // 1) W.O. automático para desclassificados/desistentes
    const out = new Set(
      (await tx.participant.findMany({ where: { tournamentId, status: { in: ["DISQUALIFIED", "WITHDRAWN"] } }, select: { id: true } })).map((p) => p.id),
    );
    let forfeits = 0;
    if (out.size) {
      const seedIndex = new Map(ctx.input.participants.map((id, i) => [id, i]));
      for (const m of resolved.values()) {
        if (m.status !== "ready") continue;
        const a = idOf(m.entrantA)!;
        const b = idOf(m.entrantB)!;
        const aOut = out.has(a);
        const bOut = out.has(b);
        if (!aOut && !bOut) continue;
        const winner: "a" | "b" = aOut && bOut ? ((seedIndex.get(a) ?? 0) < (seedIndex.get(b) ?? 0) ? "a" : "b") : aOut ? "b" : "a";
        const row = ctx.matches.find((r) => r.key === m.key)!;
        const sc = forfeitScore(row.bestOf, winner);
        await tx.match.update({
          where: { id: row.id },
          data: {
            ...sc,
            winnerSide: winner,
            forfeit: winner === "a" ? "b" : "a",
            status: "COMPLETED",
            completedAt: new Date(),
            participantAId: a,
            participantBId: b,
            notes: row.notes ?? "W.O. automático (adversário desclassificado ou desistente).",
          },
        });
        forfeits++;
      }
    }
    if (forfeits) continue;

    // 2) grava o estado resolvido
    await persistResolved(tx, ctx, resolved);

    // 3) próxima rodada do Swiss
    if (ctx.settings.type === "SWISS") {
      const next = nextSwissRound(ctx.input);
      if (next) {
        await tx.match.createMany({ data: next.specs.map((s) => specToRow(stageId, s)) });
        continue;
      }
    }
    break;
  }

  ctx = await loadStage(tx, stageId);
  let complete = ctx.settings.type === "LEADERBOARD" ? brStageFinished(ctx) : isStageComplete(ctx.input);
  if (ctx.input.specs.length === 0 && ctx.settings.type !== "LEADERBOARD") complete = false;

  if (complete) {
    if (ctx.stage.status !== "COMPLETED") {
      await tx.stage.update({ where: { id: stageId }, data: { status: "COMPLETED", completedAt: new Date() } });
    }
    await onStageCompleted(tx, ctx);
  } else if (ctx.stage.status === "COMPLETED") {
    await tx.stage.update({ where: { id: stageId }, data: { status: "LIVE", completedAt: null } });
  }
  return { complete };
}

export function specToRow(stageId: string, s: MatchSpec) {
  return {
    stageId,
    key: s.key,
    bracket: s.bracket,
    round: s.round,
    position: s.position,
    group: s.group,
    bestOf: s.bestOf,
    slotA: s.a as unknown as Prisma.InputJsonValue,
    slotB: s.b as unknown as Prisma.InputJsonValue,
    onlyIfWinner: (s.onlyIfWinner ?? undefined) as unknown as Prisma.InputJsonValue | undefined,
  };
}

async function persistResolved(tx: Tx, ctx: LoadedStage, resolved: Map<string, ResolvedMatch>) {
  const becameReady: Array<{ row: MatchRow; a: string; b: string }> = [];
  for (const row of ctx.matches) {
    const r = resolved.get(row.key);
    if (!r) continue;
    const aId = idOf(r.entrantA);
    const bId = idOf(r.entrantB);
    const participantsChanged = row.participantAId !== aId || row.participantBId !== bId;
    const data: Prisma.MatchUncheckedUpdateInput = {};
    if (participantsChanged) {
      data.participantAId = aId;
      data.participantBId = bId;
    }
    switch (r.status) {
      case "pending":
        if (row.status !== "PENDING" || participantsChanged) {
          Object.assign(data, { status: "PENDING", scoreA: null, scoreB: null, winnerSide: null, forfeit: null, reportA: Prisma.DbNull, reportB: Prisma.DbNull, completedAt: null });
        }
        break;
      case "ready":
        if (row.status === "COMPLETED" || row.status === "BYE" || row.status === "SKIPPED" || row.status === "PENDING") {
          Object.assign(data, { status: "READY", scoreA: null, scoreB: null, winnerSide: null, forfeit: null, completedAt: null });
          if (row.status === "PENDING") becameReady.push({ row, a: aId!, b: bId! });
        } else if (participantsChanged) {
          Object.assign(data, { status: "READY", reportA: Prisma.DbNull, reportB: Prisma.DbNull });
        }
        break;
      case "completed":
        if (row.status !== "COMPLETED") data.status = "COMPLETED";
        break;
      case "bye": {
        const side = aId ? "a" : "b";
        if (row.status !== "BYE" || row.winnerSide !== side) {
          Object.assign(data, { status: "BYE", winnerSide: side, scoreA: null, scoreB: null, completedAt: row.completedAt ?? new Date() });
        }
        break;
      }
      case "skipped":
        if (row.status !== "SKIPPED") Object.assign(data, { status: "SKIPPED", scoreA: null, scoreB: null, winnerSide: null });
        break;
    }
    if (Object.keys(data).length) await tx.match.update({ where: { id: row.id }, data });
  }
  if (becameReady.length) {
    const parts = await tx.participant.findMany({
      where: { id: { in: becameReady.flatMap((x) => [x.a, x.b]) } },
      select: { id: true, userId: true, name: true },
    });
    const byId = new Map(parts.map((p) => [p.id, p]));
    const stage = ctx.stage;
    const t = await tx.tournament.findUniqueOrThrow({ where: { id: stage.tournamentId }, select: { slug: true, name: true } });
    for (const x of becameReady) {
      const pa = byId.get(x.a);
      const pb = byId.get(x.b);
      if (!pa || !pb) continue;
      await notify(pa.userId, "match.ready", "Sua partida está liberada", `${t.name}: ${pa.name} × ${pb.name}`, `/partidas/${x.row.id}`, tx);
      await notify(pb.userId, "match.ready", "Sua partida está liberada", `${t.name}: ${pa.name} × ${pb.name}`, `/partidas/${x.row.id}`, tx);
    }
  }
}

// ───────────────────────── Leaderboard ─────────────────────────

function brGameDone(g: LoadedStage["brGames"][number]): boolean {
  return g.completedAt !== null && g.results.length > 0;
}

function brStageFinished(ctx: LoadedStage): boolean {
  if (ctx.settings.type !== "LEADERBOARD") return false;
  const state = leaderboardState(ctx.input)!;
  if (!state.finished) return false;
  const lastRound = ctx.brGames.reduce((m, g) => Math.max(m, g.round), 0);
  if (lastRound === 0) return false;
  return ctx.brGames.filter((g) => g.round === lastRound).every(brGameDone);
}

/** Cria a próxima rodada de lobbies quando a anterior terminou. Retorna true se criou algo. */
async function ensureBrRound(tx: Tx, ctx: LoadedStage): Promise<boolean> {
  if (ctx.settings.type !== "LEADERBOARD") return false;
  const s = ctx.settings;
  const state = leaderboardState(ctx.input)!;
  const planned = ctx.brGames.reduce((m, g) => Math.max(m, g.round), 0);
  if (state.finished && planned > 0 && ctx.brGames.filter((g) => g.round === planned).every(brGameDone)) return false;
  if (planned > 0) {
    const current = ctx.brGames.filter((g) => g.round === planned);
    if (!current.every(brGameDone)) return false;
    if (planned >= s.games) return false;
  }
  const round = planned + 1;
  const out = new Set(
    (await tx.participant.findMany({ where: { tournamentId: ctx.stage.tournamentId, status: { in: ["DISQUALIFIED", "WITHDRAWN"] } }, select: { id: true } })).map((p) => p.id),
  );
  const seeds = ctx.input.participants.filter((id) => !out.has(id));
  if (seeds.length === 0) return false;
  const order = s.lobbyAssignment === "swiss" && round > 1 ? state.rows.map((r) => r.participantId).filter((id) => !out.has(id)) : seeds;
  const lobbies = planLobbies(order, s.lobbySize, s.lobbyAssignment, round, ctx.stage.id);
  for (let i = 0; i < lobbies.length; i++) {
    await tx.brGame.create({ data: { stageId: ctx.stage.id, round, lobby: i + 1, participantIds: lobbies[i] as unknown as Prisma.InputJsonValue } });
  }
  return true;
}

// ───────────────────────── Fim de estágio / campeonato ─────────────────────────

async function onStageCompleted(tx: Tx, ctx: LoadedStage) {
  const t = await tx.tournament.findUniqueOrThrow({ where: { id: ctx.stage.tournamentId }, include: { stages: { orderBy: { order: "asc" } } } });
  const next = t.stages.find((s) => s.order === ctx.stage.order + 1);
  if (next) {
    if (next.status === "PENDING") {
      const rows = stageStandings(ctx.input);
      const advancing = selectAdvancing(rows, ctx.settings.advancement);
      await tx.stage.update({ where: { id: next.id }, data: { seedOrder: advancing as unknown as Prisma.InputJsonValue } });
    }
    return;
  }
  if (t.status === "LIVE") await finalizeTournament(tx, t.id);
}

/** Calcula a colocação final de todos os participantes e gera as premiações. */
export async function finalizeTournament(tx: Tx, tournamentId: string): Promise<void> {
  const t = await tx.tournament.findUniqueOrThrow({ where: { id: tournamentId }, include: { stages: { orderBy: { order: "asc" } } } });
  const placement = new Map<string, number>();
  let offset = 0;
  for (const stage of [...t.stages].reverse()) {
    if (stage.status !== "COMPLETED") continue;
    const ctx = await loadStage(tx, stage.id);
    const rows: StandingRow[] = stageStandings(ctx.input);
    const rest = rows.filter((r) => !placement.has(r.participantId));
    for (const r of rest) {
      const better = rest.filter((x) => x.rank < r.rank).length;
      placement.set(r.participantId, offset + better + 1);
    }
    offset += rest.length;
  }
  for (const [id, p] of placement) await tx.participant.update({ where: { id }, data: { finalPlacement: p } });

  await tx.prizeAward.deleteMany({ where: { tournamentId, status: "PENDING" } });
  const split = (t.prizeSplit as unknown as Array<{ placement: number; label: string; percent: number }> | null) ?? [];
  if (t.prizePoolCents > 0 && split.length) {
    const byPlacement = new Map<number, string[]>();
    for (const [id, p] of placement) byPlacement.set(p, [...(byPlacement.get(p) ?? []), id]);
    for (const [p, ids] of byPlacement) {
      // empates dividem igualmente os prêmios das posições ocupadas
      const spots = Array.from({ length: ids.length }, (_, i) => p + i);
      const entries = spots.map((sp) => split.find((s) => s.placement === sp)).filter((x): x is NonNullable<typeof x> => !!x);
      if (!entries.length) continue;
      const totalCents = entries.reduce((sum, e) => sum + Math.floor((t.prizePoolCents * e.percent) / 100), 0);
      const each = Math.floor(totalCents / ids.length);
      if (each <= 0) continue;
      for (const id of ids) {
        await tx.prizeAward.upsert({
          where: { tournamentId_participantId: { tournamentId, participantId: id } },
          create: { tournamentId, participantId: id, placement: p, label: entries[0].label, amountCents: each },
          update: { placement: p, label: entries[0].label, amountCents: each },
        });
      }
    }
  }
  await tx.tournament.update({ where: { id: tournamentId }, data: { status: "COMPLETED", completedAt: new Date() } });
}

/** Inicia um estágio: gera as partidas a partir dos seeds. */
export async function startStage(tx: Tx, stageId: string, seeds: Id[]): Promise<void> {
  const stage = await tx.stage.findUniqueOrThrow({ where: { id: stageId } });
  const t = await tx.tournament.findUniqueOrThrow({ where: { id: stage.tournamentId } });
  const settings = stage.settings as unknown as StageSettings;
  const built = buildStage(settings, seeds, `${t.seedSalt}:${stage.order}`);
  if (built.specs.length) await tx.match.createMany({ data: built.specs.map((s) => specToRow(stageId, s)) });
  await tx.stage.update({
    where: { id: stageId },
    data: {
      status: "LIVE",
      startedAt: new Date(),
      seedOrder: seeds as unknown as Prisma.InputJsonValue,
      groups: (built.groups ?? undefined) as unknown as Prisma.InputJsonValue | undefined,
    },
  });
  await syncStage(tx, stageId);
}

export { computeLeaderboard };
