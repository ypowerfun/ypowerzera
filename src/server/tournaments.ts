import { sitesDatabase } from "@/lib/sites-d1";
import { createD1Tournament, transitionD1Tournament, updateD1Tournament, cancelD1FreeTournament, deleteD1Draft, seedD1Tournament } from "./d1/tournaments";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { safeHttpUrl } from "@/lib/url";
import { Prisma, type Tournament } from "@prisma/client";
import { db } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { slugify } from "@/lib/slug";
import { orderSeeds, validateStage, type SeedingMethod as EngineSeeding, type StageSettings } from "@/engine";
import { finalizeRules, getGame, getPreset, type PresetStage } from "@/games";
import { audit } from "./audit";
import { notify } from "./notifications";
import { expireStaleReservations, refundOrder, tryAutoRefund } from "./orders";
import { assertTournamentAccess, assertOrgAccess, requireActor, requireVerified } from "./permissions";
import { startStage, syncStage } from "./stage-runner";
import { uniqueSlug } from "./orgs";
import type { Actor, CustomField, PrizeSplitEntry } from "./types";

const MIN_FEE_CENTS = 500; // R$ 5,00 (mínimo para cobrança)
const MAX_FEE_CENTS = 500_000;

const customFieldSchema = z.object({
  key: z.string().regex(/^[a-z0-9_]{2,30}$/),
  label: z.string().min(2).max(80),
  type: z.enum(["text", "select", "checkbox"]),
  required: z.boolean(),
  private: z.boolean(),
  options: z.array(z.string().min(1).max(60)).max(20).optional(),
});

const prizeSplitSchema = z.array(z.object({ placement: z.number().int().min(1).max(64), label: z.string().min(1).max(40), percent: z.number().min(0).max(100) })).max(16);

const stageSchema = z.object({ name: z.string().trim().min(2).max(40), settings: z.custom<StageSettings>((v) => typeof v === "object" && v !== null && "type" in v) });

const dateOrNull = z.date().nullable().optional();

/** Link http(s). O `z.url()` puro aceita javascript:/data:, que num href viram XSS guardado. */
const httpUrlSchema = z.string().trim().max(200).refine((v) => safeHttpUrl(v) !== null, "Informe um link válido (http/https).");

export const createTournamentSchema = z.object({
  orgId: z.string(),
  gameId: z.string(),
  modeId: z.string(),
  presetId: z.string().optional(),
  stages: z.array(stageSchema).max(6).optional(),
  name: z.string().trim().min(4, "O nome deve ter pelo menos 4 caracteres.").max(80),
  summary: z.string().trim().max(200).optional(),
  description: z.string().trim().max(8000).optional(),
  rules: z.string().trim().max(20000).optional(),
  region: z.string().trim().max(30).optional(),
  platform: z.string().trim().max(30).optional(),
  startsAt: z.date(),
  registrationOpensAt: dateOrNull,
  registrationClosesAt: dateOrNull,
  checkInOpensAt: dateOrNull,
  checkInClosesAt: dateOrNull,
  minParticipants: z.number().int().min(2).max(1024).optional(),
  maxParticipants: z.number().int().min(2, "Mínimo de 2 vagas.").max(1024),
  entryFeeCents: z.number().int().min(0).default(0),
  prizePoolCents: z.number().int().min(0).default(0),
  prizeSplit: prizeSplitSchema.optional(),
  allowPlayerReporting: z.boolean().default(true),
  requireCheckIn: z.boolean().default(true),
  seedingMethod: z.enum(["MANUAL", "RANDOM", "RATING"]).default("RANDOM"),
  customFields: z.array(customFieldSchema).max(12).optional(),
  mapPool: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
  visibility: z.enum(["PUBLIC", "UNLISTED"]).default("PUBLIC"),
  streamUrl: httpUrlSchema.optional().or(z.literal("")),
  discordUrl: httpUrlSchema.optional().or(z.literal("")),
});

export type CreateTournamentInput = z.input<typeof createTournamentSchema>;

export const DEFAULT_PRIZE_SPLIT: PrizeSplitEntry[] = [
  { placement: 1, label: "Campeão", percent: 60 },
  { placement: 2, label: "Vice-campeão", percent: 25 },
  { placement: 3, label: "3º lugar", percent: 15 },
];

function validateDates(d: {
  startsAt: Date;
  registrationOpensAt?: Date | null;
  registrationClosesAt?: Date | null;
  checkInOpensAt?: Date | null;
  checkInClosesAt?: Date | null;
}) {
  const { startsAt, registrationOpensAt: ro, registrationClosesAt: rc, checkInOpensAt: co, checkInClosesAt: cc } = d;
  if (ro && rc && ro >= rc) throw new AppError("A abertura das inscrições deve ser antes do encerramento.");
  if (rc && rc > startsAt) throw new AppError("As inscrições devem encerrar até o início do campeonato.");
  if (co && cc && co >= cc) throw new AppError("A abertura do check-in deve ser antes do encerramento.");
  if (cc && cc > new Date(startsAt.getTime() + 3600_000)) throw new AppError("O check-in deve encerrar até o início do campeonato.");
  if (co && ro && co < ro) throw new AppError("O check-in não pode abrir antes das inscrições.");
}

function validatePrize(poolCents: number, split: PrizeSplitEntry[]) {
  if (poolCents > 0 && split.length) {
    const total = split.reduce((s, e) => s + e.percent, 0);
    if (total > 100.0001) throw new AppError("A divisão da premiação passa de 100%.");
    const places = new Set(split.map((s) => s.placement));
    if (places.size !== split.length) throw new AppError("Há colocações repetidas na premiação.");
  }
}

function validateFee(cents: number) {
  if (cents !== 0 && (cents < MIN_FEE_CENTS || cents > MAX_FEE_CENTS)) {
    throw new AppError("A taxa de inscrição deve ser gratuita ou ficar entre R$ 5,00 e R$ 5.000,00.");
  }
}

function resolveStages(input: { gameId: string; modeId: string; presetId?: string; stages?: PresetStage[] }): { stages: PresetStage[]; presetId: string | null } {
  const game = getGame(input.gameId);
  if (!game) throw new AppError("Jogo inválido.");
  const mode = game.modes.find((m) => m.id === input.modeId);
  if (!mode) throw new AppError("Modo de jogo inválido para este jogo.");
  if (input.stages?.length) return { stages: input.stages, presetId: null };
  if (!input.presetId) throw new AppError("Escolha um formato de campeonato.");
  const preset = getPreset(input.gameId, input.presetId);
  if (!preset) throw new AppError("Formato inválido para este jogo.");
  if (preset.modes?.length && !preset.modes.includes(input.modeId)) throw new AppError("Este formato não é compatível com o modo escolhido.");
  return { stages: structuredClone(preset.stages) as PresetStage[], presetId: preset.id };
}

function validateStagesLoose(stages: PresetStage[]) {
  stages.forEach((s, i) => {
    // valida a configuração (Bo, tamanhos...) ignorando a contagem real de participantes, checada ao iniciar
    const errors = validateStage(s.settings, 64).filter((e) => !/precisa de pelo menos/.test(e) && !/múltiplo de 4/.test(e));
    if (errors.length) throw new AppError(`Fase ${i + 1} (${s.name}): ${errors.join(" ")}`);
  });
}

export async function createTournament(actorIn: Actor | null, rawInput: CreateTournamentInput) {
  const actor = requireActor(actorIn);
  requireVerified(actor);
  const parsed = createTournamentSchema.safeParse(rawInput);
  if (!parsed.success) throw new AppError(parsed.error.issues[0].message);
  const input = parsed.data;
  await assertOrgAccess(actor, input.orgId, "admin");

  const game = getGame(input.gameId);
  if (!game) throw new AppError("Jogo inválido.");
  const mode = game.modes.find((m) => m.id === input.modeId);
  if (!mode) throw new AppError("Modo de jogo inválido para este jogo.");
  const { stages, presetId } = resolveStages({ gameId: input.gameId, modeId: input.modeId, presetId: input.presetId, stages: input.stages as PresetStage[] | undefined });
  validateStagesLoose(stages);
  validateFee(input.entryFeeCents);
  validateDates(input);
  const prizeSplit = input.prizeSplit ?? (input.prizePoolCents > 0 ? DEFAULT_PRIZE_SPLIT : []);
  validatePrize(input.prizePoolCents, prizeSplit);
  const presetMin = (presetId ? getPreset(input.gameId, presetId)?.minParticipants : undefined) ?? 2;
  const minP = input.minParticipants ?? Math.min(presetMin, input.maxParticipants);
  if (minP > input.maxParticipants) throw new AppError("O mínimo de participantes não pode ser maior que o máximo.");

  const slug = await uniqueSlug(input.name, async (s) => !!(await db.tournament.findUnique({ where: { slug: s } })));
  const checkInOpens = input.checkInOpensAt ?? (input.requireCheckIn ? new Date(input.startsAt.getTime() - 60 * 60_000) : null);
  const checkInCloses = input.checkInClosesAt ?? (input.requireCheckIn ? input.startsAt : null);

  const data: Prisma.TournamentUncheckedCreateInput = {
        orgId: input.orgId,
        slug,
        name: input.name,
        gameId: game.id, // sempre o id canônico do catálogo
        modeId: input.modeId,
        presetId,
        visibility: input.visibility,
        summary: input.summary,
        description: input.description,
        rules: input.rules?.trim() ? input.rules : finalizeRules(game),
        region: input.region || null,
        platform: input.platform || null,
        streamUrl: input.streamUrl || null,
        discordUrl: input.discordUrl || null,
        startsAt: input.startsAt,
        registrationOpensAt: input.registrationOpensAt ?? null,
        registrationClosesAt: input.registrationClosesAt ?? null,
        checkInOpensAt: checkInOpens,
        checkInClosesAt: checkInCloses,
        minParticipants: minP,
        maxParticipants: input.maxParticipants,
        teamSize: mode.teamSize,
        maxSubs: mode.maxSubs,
        entryFeeCents: input.entryFeeCents,
        prizePoolCents: input.prizePoolCents,
        prizeSplit: prizeSplit as unknown as Prisma.InputJsonValue,
        allowPlayerReporting: input.allowPlayerReporting,
        requireCheckIn: input.requireCheckIn,
        seedingMethod: input.seedingMethod,
        seedSalt: randomBytes(12).toString("hex"),
        customFields: (input.customFields ?? []) as unknown as Prisma.InputJsonValue,
        mapPool: (input.mapPool ?? undefined) as unknown as Prisma.InputJsonValue | undefined,
      };
  const d1 = sitesDatabase();
  if (d1) {
    const id = await createD1Tournament(d1, actor, data, stages);
    return db.tournament.findUniqueOrThrow({ where: { id } });
  }
  const t = await db.$transaction(async (tx) => {
    const created = await tx.tournament.create({
      data,
    });
    await tx.stage.createMany({
      data: stages.map((s, i) => ({ tournamentId: created.id, order: i + 1, name: s.name, type: s.settings.type, settings: s.settings as unknown as Prisma.InputJsonValue })),
    });
    await audit(actor.id, "tournament.create", "Tournament", created.id, { name: created.name }, tx);
    return created;
  });
  return t;
}

async function loadManaged(actor: Actor, id: string, level: "admin" | "staff" = "admin") {
  const t = await db.tournament.findUnique({ where: { id }, include: { stages: { orderBy: { order: "asc" } } } });
  if (!t) throw new AppError("Campeonato não encontrado.", "NOT_FOUND");
  await assertTournamentAccess(actor, t, level);
  return t;
}

export type UpdateTournamentInput = Partial<
  Pick<
    z.infer<typeof createTournamentSchema>,
    | "name" | "summary" | "description" | "rules" | "region" | "platform" | "startsAt" | "registrationOpensAt" | "registrationClosesAt"
    | "checkInOpensAt" | "checkInClosesAt" | "minParticipants" | "maxParticipants" | "entryFeeCents" | "prizePoolCents" | "prizeSplit"
    | "allowPlayerReporting" | "requireCheckIn" | "seedingMethod" | "customFields" | "mapPool" | "visibility" | "streamUrl" | "discordUrl" | "stages"
  >
>;

function validateTextPatch(patch: UpdateTournamentInput) {
  if (patch.name !== undefined && (patch.name.trim().length < 4 || patch.name.length > 80)) throw new AppError("O nome deve ter de 4 a 80 caracteres.");
  if (patch.summary && patch.summary.length > 200) throw new AppError("O resumo pode ter até 200 caracteres.");
  if (patch.description && patch.description.length > 8000) throw new AppError("A descrição é muito longa.");
  if (patch.rules && patch.rules.length > 20000) throw new AppError("O regulamento é muito longo.");
  for (const k of ["streamUrl", "discordUrl"] as const) {
    const v = patch[k];
    if (v) {
      let ok = false;
      try {
        const u = new URL(v);
        ok = (u.protocol === "https:" || u.protocol === "http:") && v.length <= 200;
      } catch {
        ok = false;
      }
      if (!ok) throw new AppError("Informe um link válido (http/https).");
    }
  }
}

export async function updateTournament(actorIn: Actor | null, id: string, patch: UpdateTournamentInput) {
  const actor = requireActor(actorIn);
  const t = await loadManaged(actor, id, "admin");
  if (t.status === "COMPLETED" || t.status === "CANCELED") throw new AppError("Este campeonato foi encerrado e não pode mais ser editado.");
  const started = t.status === "LIVE";
  const structural: Array<keyof UpdateTournamentInput> = ["stages", "entryFeeCents", "maxParticipants", "minParticipants", "seedingMethod", "requireCheckIn"];
  if (started) for (const k of structural) if (patch[k] !== undefined) throw new AppError("O campeonato já começou: formato, vagas e taxa não podem ser alterados.");

  validateTextPatch(patch);

  const participants = await db.participant.count({ where: { tournamentId: id, status: { in: ["REGISTERED", "CHECKED_IN", "PENDING_PAYMENT", "WAITLIST"] } } });
  if (patch.entryFeeCents !== undefined && patch.entryFeeCents !== t.entryFeeCents) {
    if (participants > 0) throw new AppError("Já há inscrições: não é possível alterar a taxa. Crie cupons ou um novo campeonato.");
    validateFee(patch.entryFeeCents);
    if (patch.entryFeeCents > 0 && t.status !== "DRAFT") {
      // Sem provedor de pagamento (PAYMENTS_PROVIDER=none) ninguém consegue pagar: as vagas ficariam presas em "aguardando pagamento".
      const { paymentsAvailable } = await import("./payments");
      if (!paymentsAvailable()) throw new AppError("Pagamentos indisponíveis neste site: os campeonatos publicados só podem ser gratuitos.");
    }
  }
  // Com inscritos a premiação anunciada é uma promessa: só pode aumentar, e a divisão entre os colocados não muda.
  if (participants > 0) {
    if (patch.prizePoolCents !== undefined && patch.prizePoolCents < t.prizePoolCents) throw new AppError("Já há inscrições: a premiação só pode aumentar, não diminuir.");
    const norm = (v: unknown) => JSON.stringify(((v as PrizeSplitEntry[] | null) ?? []).map((e) => [e.placement, e.label, e.percent]));
    if (patch.prizeSplit !== undefined && norm(patch.prizeSplit) !== norm(t.prizeSplit)) throw new AppError("Já há inscrições: a divisão da premiação entre os colocados não pode mais mudar.");
  }
  const active = await db.participant.count({ where: { tournamentId: id, status: { in: ["REGISTERED", "CHECKED_IN", "PENDING_PAYMENT"] } } });
  if (patch.maxParticipants !== undefined && patch.maxParticipants < active) throw new AppError(`Há ${active} inscrições ativas; as vagas não podem ficar abaixo disso.`);

  const merged = {
    startsAt: patch.startsAt ?? t.startsAt,
    registrationOpensAt: patch.registrationOpensAt === undefined ? t.registrationOpensAt : patch.registrationOpensAt,
    registrationClosesAt: patch.registrationClosesAt === undefined ? t.registrationClosesAt : patch.registrationClosesAt,
    checkInOpensAt: patch.checkInOpensAt === undefined ? t.checkInOpensAt : patch.checkInOpensAt,
    checkInClosesAt: patch.checkInClosesAt === undefined ? t.checkInClosesAt : patch.checkInClosesAt,
  };
  validateDates(merged);
  const pool = patch.prizePoolCents ?? t.prizePoolCents;
  const split = patch.prizeSplit ?? ((t.prizeSplit as unknown as PrizeSplitEntry[] | null) ?? []);
  validatePrize(pool, split);
  const minP = patch.minParticipants ?? t.minParticipants;
  const maxP = patch.maxParticipants ?? t.maxParticipants;
  if (minP > maxP) throw new AppError("O mínimo de participantes não pode ser maior que o máximo.");

  const data: Prisma.TournamentUpdateInput = {};
  for (const k of ["name", "summary", "description", "rules", "region", "platform", "startsAt", "registrationOpensAt", "registrationClosesAt", "checkInOpensAt", "checkInClosesAt", "minParticipants", "maxParticipants", "entryFeeCents", "prizePoolCents", "allowPlayerReporting", "requireCheckIn", "seedingMethod", "visibility", "streamUrl", "discordUrl"] as const) {
    if (patch[k] !== undefined) (data as Record<string, unknown>)[k] = patch[k] === "" ? null : patch[k];
  }
  if (patch.prizeSplit) data.prizeSplit = patch.prizeSplit as unknown as Prisma.InputJsonValue;
  if (patch.customFields) data.customFields = patch.customFields as unknown as Prisma.InputJsonValue;
  if (patch.mapPool) data.mapPool = patch.mapPool as unknown as Prisma.InputJsonValue;

  const d1 = sitesDatabase();
  if (d1) {
    if (patch.stages) validateStagesLoose(patch.stages as PresetStage[]);
    const norm = (v: unknown) => JSON.stringify(((v as PrizeSplitEntry[] | null) ?? []).map(e => [e.placement,e.label,e.percent]));
    await updateD1Tournament(d1, { actorId: actor.id, actorIsAdmin: actor.role === "ADMIN", tournamentId: id, updatedAt: t.updatedAt.getTime(),
      data, fields: Object.keys(patch), stages: patch.stages, prizeChanged: patch.prizeSplit !== undefined && norm(patch.prizeSplit) !== norm(t.prizeSplit) });
    return db.tournament.findUniqueOrThrow({ where: { id } });
  }
  await db.$transaction(async (tx) => {
    await tx.tournament.update({ where: { id }, data });
    if (patch.stages) {
      const stages = patch.stages as PresetStage[];
      validateStagesLoose(stages);
      await tx.stage.deleteMany({ where: { tournamentId: id } });
      await tx.stage.createMany({ data: stages.map((s, i) => ({ tournamentId: id, order: i + 1, name: s.name, type: s.settings.type, settings: s.settings as unknown as Prisma.InputJsonValue })) });
    }
    await audit(actor.id, "tournament.update", "Tournament", id, { fields: Object.keys(patch) }, tx);
  });
  return db.tournament.findUniqueOrThrow({ where: { id } });
}

export async function publishTournament(actorIn: Actor | null, id: string) {
  const actor = requireActor(actorIn);
  const t = await loadManaged(actor, id, "admin");
  if (t.status !== "DRAFT") throw new AppError("Este campeonato já foi publicado.");
  if (t.startsAt <= new Date()) throw new AppError("A data de início já passou. Ajuste o horário antes de publicar.");
  if (t.stages.length === 0) throw new AppError("Defina ao menos uma fase.");
  if (t.entryFeeCents > 0) {
    const { paymentsAvailable } = await import("./payments");
    if (!paymentsAvailable()) throw new AppError("Pagamentos indisponíveis: configure o provedor para publicar campeonatos pagos.");
  }
  const d1 = sitesDatabase();
  if (d1) return transitionD1Tournament(d1, { actorId: actor.id, actorIsAdmin: actor.role === "ADMIN", tournamentId: id, updatedAt: t.updatedAt.getTime(), checkIn: false });
  await db.tournament.update({ where: { id }, data: { status: "REGISTRATION", publishedAt: new Date() } });
  await audit(actor.id, "tournament.publish", "Tournament", id);
}

export async function openCheckIn(actorIn: Actor | null, id: string) {
  const actor = requireActor(actorIn);
  const t = await loadManaged(actor, id, "staff");
  if (t.status !== "REGISTRATION") throw new AppError("O check-in só pode ser aberto com as inscrições abertas.");
  const d1 = sitesDatabase();
  if (d1) return transitionD1Tournament(d1, { actorId: actor.id, actorIsAdmin: actor.role === "ADMIN", tournamentId: id, updatedAt: t.updatedAt.getTime(), checkIn: true });
  await db.tournament.update({ where: { id }, data: { status: "CHECK_IN" } });
  const ps = await db.participant.findMany({ where: { tournamentId: id, status: "REGISTERED" }, select: { userId: true } });
  await notify(ps.map((p) => p.userId), "checkin.open", "Check-in aberto", `Faça o check-in em ${t.name} para garantir sua vaga.`, `/torneios/${t.slug}`);
  await audit(actor.id, "tournament.checkin_open", "Tournament", id);
}

/** Embaralha/atribui seeds conforme o método do campeonato (apenas antes de começar). */
export async function applySeeding(actorIn: Actor | null, id: string, method?: "MANUAL" | "RANDOM" | "RATING") {
  const actor = requireActor(actorIn);
  const t = await loadManaged(actor, id, "staff");
  if (t.status === "LIVE" || t.status === "COMPLETED") throw new AppError("O campeonato já começou.");
  const m = method ?? t.seedingMethod;
  const ps = await db.participant.findMany({ where: { tournamentId: id, status: { in: ["REGISTERED", "CHECKED_IN"] } } });
  const ordered = orderSeeds(ps.map((p) => ({ id: p.id, seed: m === "MANUAL" ? p.seed : null, rating: p.rating })), m.toLowerCase() as EngineSeeding, t.seedSalt);
  const d1 = sitesDatabase();
  if (d1) return seedD1Tournament(d1, { actorId: actor.id, actorIsAdmin: actor.role === "ADMIN", tournamentId: id, updatedAt: t.updatedAt.getTime(), participants: ps, ordered });
  await db.$transaction(ordered.map((pid, i) => db.participant.update({ where: { id: pid }, data: { seed: i + 1 } })));
}

export async function startTournament(actorIn: Actor | null, id: string) {
  const actor = requireActor(actorIn);
  const t = await loadManaged(actor, id, "admin");
  if (t.status !== "REGISTRATION" && t.status !== "CHECK_IN") throw new AppError("O campeonato precisa estar com inscrições abertas ou em check-in para começar.");
  const first = t.stages[0];
  if (!first) throw new AppError("Defina ao menos uma fase.");

  const dropped: Array<{ id: string; userId: string; was: string }> = [];
  await db.$transaction(
    async (tx) => {
      dropped.length = 0; // a transação pode ser repetida
      await expireStaleReservations(tx, id);
      const all = await tx.participant.findMany({ where: { tournamentId: id } });
      const eligible = all.filter((p) => (t.requireCheckIn ? p.status === "CHECKED_IN" : p.status === "REGISTERED" || p.status === "CHECKED_IN"));
      const settings = first.settings as unknown as StageSettings;
      const errors = validateStage(settings, eligible.length);
      if (eligible.length < t.minParticipants) errors.unshift(`São necessários pelo menos ${t.minParticipants} participantes confirmados (há ${eligible.length}).`);
      if (errors.length) throw new AppError(errors.join(" "));

      // quem não confirmou presença/pagamento sai do campeonato
      for (const p of all.filter((x) => !eligible.includes(x) && x.status !== "DISQUALIFIED" && x.status !== "WITHDRAWN")) {
        await tx.participant.update({
          where: { id: p.id },
          data: { status: "WITHDRAWN", dqReason: p.status === "REGISTERED" ? "Sem check-in" : p.status === "PENDING_PAYMENT" ? "Pagamento não concluído" : "Lista de espera", withdrawnAt: new Date() },
        });
        await tx.order.updateMany({ where: { participantId: p.id, status: "PENDING" }, data: { status: "CANCELED" } });
        await tx.rosterEntry.deleteMany({ where: { participantId: p.id } });
        dropped.push({ id: p.id, userId: p.userId, was: p.status });
      }

      const method = t.seedingMethod.toLowerCase() as EngineSeeding;
      const ordered = orderSeeds(
        eligible.map((p) => ({ id: p.id, seed: method === "manual" ? p.seed : null, rating: p.rating })),
        method,
        t.seedSalt,
      );
      for (let i = 0; i < ordered.length; i++) await tx.participant.update({ where: { id: ordered[i] }, data: { seed: i + 1 } });

      await startStage(tx, first.id, ordered);
      await tx.tournament.update({ where: { id }, data: { status: "LIVE", startedAt: new Date() } });
      await audit(actor.id, "tournament.start", "Tournament", id, { participants: ordered.length }, tx);
      const users = eligible.map((p) => p.userId);
      await notify(users, "tournament.started", "O campeonato começou!", `${t.name} foi iniciado. Veja suas partidas.`, `/torneios/${t.slug}`, tx);
    },
    { timeout: 60000 },
  );
  await settleDropped(t, dropped);
  return db.tournament.findUniqueOrThrow({ where: { id } });
}

/**
 * Quem ficou de fora no início (sem check-in, pagamento pendente ou lista de espera) é avisado. Se já tinha PAGO e o organizador
 * começou antes de o check-in encerrar, a pessoa não teve chance justa de confirmar presença: o valor é devolvido sozinho.
 * Com a janela de check-in encerrada, a regra do campeonato vale (quem não confirmou presença perde a vaga).
 */
async function settleDropped(t: Pick<Tournament, "name" | "slug" | "checkInClosesAt">, dropped: Array<{ id: string; userId: string; was: string }>): Promise<void> {
  const windowClosed = t.checkInClosesAt !== null && t.checkInClosesAt <= new Date();
  for (const d of dropped) {
    let refunded = false;
    if (d.was === "REGISTERED" && !windowClosed) {
      const paid = await db.order.findFirst({ where: { participantId: d.id, status: { in: ["PAID", "PARTIALLY_REFUNDED"] } } });
      if (paid) {
        refunded = await tryAutoRefund(paid.id);
      }
    }
    const why = d.was === "REGISTERED" ? "você não fez o check-in a tempo" : d.was === "PENDING_PAYMENT" ? "o pagamento não foi concluído" : "não abriu vaga para você";
    await notify(d.userId, "participant.dropped", "Você ficou de fora da chave", `${t.name} começou e ${why}.${refunded ? " O valor da sua inscrição foi reembolsado." : ""}`, `/torneios/${t.slug}`).catch(() => undefined);
  }
}

/** Inicia a próxima fase (depois que a anterior terminou). */
export async function startNextStage(actorIn: Actor | null, id: string) {
  const actor = requireActor(actorIn);
  const t = await loadManaged(actor, id, "admin");
  if (t.status !== "LIVE") throw new AppError("O campeonato não está em andamento.");
  const live = t.stages.find((s) => s.status === "LIVE");
  if (live) throw new AppError(`A fase "${live.name}" ainda está em andamento.`);
  const next = t.stages.find((s) => s.status === "PENDING");
  if (!next) throw new AppError("Não há próxima fase.");
  const prev = t.stages.find((s) => s.order === next.order - 1);
  if (!prev || prev.status !== "COMPLETED") throw new AppError("A fase anterior ainda não terminou.");
  const seeds = ((next.seedOrder as unknown as string[] | null) ?? []).filter(Boolean);
  const settings = next.settings as unknown as StageSettings;
  const errors = validateStage(settings, seeds.length);
  if (errors.length) throw new AppError(errors.join(" "));
  await db.$transaction(
    async (tx) => {
      await startStage(tx, next.id, seeds);
      await audit(actor.id, "stage.start", "Stage", next.id, { participants: seeds.length }, tx);
    },
    { timeout: 60000 },
  );
}

export async function cancelTournament(actorIn: Actor | null, id: string, reason: string) {
  const actor = requireActor(actorIn);
  const t = await loadManaged(actor, id, "admin");
  if (t.status === "COMPLETED" || t.status === "CANCELED") throw new AppError("Este campeonato já foi encerrado.");
  if (reason.trim().length < 3) throw new AppError("Informe o motivo do cancelamento.");
  if (reason.length > 500) throw new AppError("O motivo pode ter até 500 caracteres.");
  const d1 = sitesDatabase();
  if (d1) return cancelD1FreeTournament(d1, { actorId: actor.id, actorIsAdmin: actor.role === "ADMIN", tournamentId: id, updatedAt: t.updatedAt.getTime(), reason });
  await db.tournament.update({ where: { id }, data: { status: "CANCELED" } });
  const orders = await db.order.findMany({ where: { tournamentId: id, status: { in: ["PAID", "PARTIALLY_REFUNDED"] } } });
  const failures: string[] = [];
  for (const o of orders) {
    try {
      await refundOrder(actor, o.id, { reason: `Campeonato cancelado: ${reason.trim()}` });
    } catch (e) {
      failures.push(`${o.number}: ${e instanceof Error ? e.message : "erro"}`);
    }
  }
  await db.order.updateMany({ where: { tournamentId: id, status: "PENDING" }, data: { status: "CANCELED" } });
  const ps = await db.participant.findMany({ where: { tournamentId: id }, select: { userId: true } });
  await notify(ps.map((p) => p.userId), "tournament.canceled", "Campeonato cancelado", `${t.name} foi cancelado: ${reason.trim()}`, `/torneios/${t.slug}`);
  await audit(actor.id, "tournament.cancel", "Tournament", id, { reason, refundFailures: failures });
  return { refundFailures: failures };
}

export async function deleteDraft(actorIn: Actor | null, id: string) {
  const actor = requireActor(actorIn);
  const t = await loadManaged(actor, id, "admin");
  if (t.status !== "DRAFT") throw new AppError("Só rascunhos podem ser excluídos. Para os demais, cancele o campeonato.");
  const d1 = sitesDatabase();
  if (d1) return deleteD1Draft(d1, { actorId: actor.id, actorIsAdmin: actor.role === "ADMIN", tournamentId: id, updatedAt: t.updatedAt.getTime() });
  await db.tournament.delete({ where: { id } });
  await audit(actor.id, "tournament.delete", "Tournament", id);
}

export async function getTournamentBySlug(slug: string) {
  return db.tournament.findUnique({ where: { slug }, include: { org: true, stages: { orderBy: { order: "asc" } } } });
}

export { slugify, syncStage };
export type { Tournament };
