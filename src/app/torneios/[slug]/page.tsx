import { safeHttpUrl } from "@/lib/url";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { describeStage } from "@/engine";
import { finalizeRules } from "@/games";
import { checkInWindow, registrationWindow, refundsOnWithdrawal, STATUS_LABELS } from "@/lib/phases";
import { formatDateTime } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { getCurrentUser, toActor } from "@/server/session";
import { quote } from "@/server/orders";
import { stageViews, tournamentPage, type StageView } from "@/server/queries";
import { db } from "@/lib/db";
import { checkInAction, withdrawAction } from "@/app/actions/tournament";
import { ActionForm } from "@/components/action-form";
import { EliminationBracket, LeaderboardTable, RoundList, StandingsTable } from "@/components/bracket";
import { RichText } from "@/components/rich-text";
import { Alert, Badge, ButtonLink, Card, Empty, GameBadge, Table, Td, Th, cx } from "@/components/ui";
import { ScrollTabs } from "@/components/scroll-tabs";
import type { RosterMember } from "@/server/types";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const t = await db.tournament.findUnique({ where: { slug: (await params).slug }, select: { name: true, summary: true } });
  return { title: t?.name ?? "Torneio", description: t?.summary ?? undefined };
}

const tabs = [
  ["visao-geral", "Visão geral"],
  ["chaves", "Chaves e resultados"],
  ["participantes", "Participantes"],
  ["regras", "Regras"],
] as const;

export default async function TournamentPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ aba?: string; inscrito?: string }> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const user = await getCurrentUser();
  const data = await tournamentPage(slug, user ? toActor(user) : undefined);
  if (!data) notFound();
  const { t, slots, waitlist, mine, prizes, isManager, game } = data;
  if (t.status === "DRAFT" && !isManager && user?.role !== "ADMIN") notFound();
  const started = t.status === "LIVE" || t.status === "COMPLETED";
  const tab = (tabs.map((x) => x[0]) as string[]).includes(sp.aba ?? "") ? sp.aba! : started ? "chaves" : "visao-geral";
  const reg = registrationWindow(t);
  const ci = checkInWindow(t);
  const price = quote(t);
  const full = slots >= t.maxParticipants;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start gap-4">
        {game && <GameBadge game={game} size="lg" />}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-black sm:text-3xl">{t.name}</h1>
            <Badge tone={t.status === "REGISTRATION" ? "ok" : t.status === "CHECK_IN" ? "warn" : t.status === "LIVE" ? "accent" : t.status === "CANCELED" ? "danger" : "neutral"}>{STATUS_LABELS[t.status]}</Badge>
            {t.visibility === "UNLISTED" && <Badge>Não listado</Badge>}
          </div>
          <p className="mt-1 text-sm text-muted">
            {game?.name} · {game?.modes.find((m) => m.id === t.modeId)?.label} · por <span className="font-semibold text-ink">{t.org.name}</span> · {formatDateTime(t.startsAt)}
          </p>
          {t.summary && <p className="mt-2 max-w-2xl text-sm">{t.summary}</p>}
        </div>
        {isManager && <ButtonLink href={`/organizar/${t.id}`} variant="secondary">Gerenciar</ButtonLink>}
      </header>

      {sp.inscrito === "ok" && <Alert tone="ok">Inscrição confirmada! Fique de olho no check-in.</Alert>}
      {sp.inscrito === "fila" && <Alert tone="warn">O campeonato está lotado: você entrou na fila de espera e será avisado se abrir uma vaga.</Alert>}

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="min-w-0 space-y-5">
          <ScrollTabs label="Seções" className="border-b border-line">
            {tabs.map(([k, label]) => (
              <Link key={k} href={`/torneios/${t.slug}?aba=${k}`} aria-current={tab === k ? "page" : undefined} className={cx("whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-semibold", tab === k ? "border-brand text-brand-soft" : "border-transparent text-muted hover:text-ink")}>
                {label}
              </Link>
            ))}
          </ScrollTabs>

          {tab === "visao-geral" && (
            <div className="space-y-5">
              {t.description && <Card><h2 className="mb-2 font-bold">Sobre</h2><RichText text={t.description} /></Card>}
              <Card>
                <h2 className="mb-3 font-bold">Formato</h2>
                <ol className="space-y-2 text-sm">
                  {t.stages.map((s) => (
                    <li key={s.id} className="flex gap-3"><span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand/20 text-xs font-bold text-brand-soft">{s.order}</span><span><b>{s.name}</b><br /><span className="text-muted">{describeStage(s.settings as never)}</span></span></li>
                  ))}
                </ol>
              </Card>
              <Card>
                <h2 className="mb-3 font-bold">Datas</h2>
                <dl className="grid gap-3 text-sm sm:grid-cols-2">
                  <div><dt className="text-muted">Início</dt><dd className="font-semibold">{formatDateTime(t.startsAt)}</dd></div>
                  <div><dt className="text-muted">Inscrições</dt><dd className="font-semibold">{t.registrationOpensAt ? formatDateTime(t.registrationOpensAt) : "Abertas"} → {t.registrationClosesAt ? formatDateTime(t.registrationClosesAt) : "até começar"}</dd></div>
                  {t.requireCheckIn && <div><dt className="text-muted">Check-in</dt><dd className="font-semibold">{formatDateTime(t.checkInOpensAt)} → {formatDateTime(t.checkInClosesAt)}</dd></div>}
                  <div><dt className="text-muted">Relato de placar</dt><dd className="font-semibold">{t.allowPlayerReporting ? "Pelos capitães (confirmação dupla)" : "Somente pela organização"}</dd></div>
                </dl>
              </Card>
              {(t.prizePoolCents > 0 || prizes.length > 0) && (
                <Card>
                  <h2 className="mb-3 font-bold">Premiação <span className="font-black text-silver">{formatMoney(t.prizePoolCents, t.currency)}</span></h2>
                  {prizes.length > 0 ? (
                    <ul className="space-y-1.5 text-sm">{prizes.map((p) => <li key={p.id} className="flex justify-between"><span>{p.placement}º · {p.participant.name}</span><span className="font-bold">{formatMoney(p.amountCents, t.currency)} {p.status === "PAID" && <Badge tone="ok">pago</Badge>}</span></li>)}</ul>
                  ) : (
                    <ul className="space-y-1.5 text-sm">{((t.prizeSplit as unknown as Array<{ placement: number; label: string; percent: number }>) ?? []).map((p) => <li key={p.placement} className="flex justify-between"><span>{p.placement}º · {p.label}</span><span className="font-bold">{formatMoney(Math.floor((t.prizePoolCents * p.percent) / 100), t.currency)} <span className="text-xs text-muted">({p.percent}%)</span></span></li>)}</ul>
                  )}
                </Card>
              )}
              {(safeHttpUrl(t.streamUrl) || safeHttpUrl(t.discordUrl)) && (
                <Card className="flex flex-wrap gap-3 text-sm">
                  {safeHttpUrl(t.streamUrl) && <a href={safeHttpUrl(t.streamUrl)!} target="_blank" rel="noopener noreferrer nofollow" className="text-brand-soft hover:underline">📺 Transmissão</a>}
                  {safeHttpUrl(t.discordUrl) && <a href={safeHttpUrl(t.discordUrl)!} target="_blank" rel="noopener noreferrer nofollow" className="text-brand-soft hover:underline">💬 Discord</a>}
                </Card>
              )}
            </div>
          )}

          {tab === "chaves" && <Stages tournamentId={t.id} started={started} />}

          {tab === "participantes" && <Participants tournamentId={t.id} isManager={isManager} />}

          {tab === "regras" && (
            <Card>
              <h2 className="mb-3 font-bold">Regulamento</h2>
              <RichText text={t.rules?.trim() ? t.rules : game ? finalizeRules(game) : ""} />
              {game && <><h3 className="mb-2 mt-5 text-sm font-bold">Configurações de partida</h3><ul className="list-disc space-y-1 pl-5 text-sm text-muted">{game.matchSettings.map((m, i) => <li key={i}>{m}</li>)}</ul></>}
            </Card>
          )}
        </div>

        <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
          <Card className="space-y-4">
            <div className="flex items-baseline justify-between">
              <span className="text-sm text-muted">Inscrição</span>
              <span className="text-xl font-black">{t.entryFeeCents ? formatMoney(t.entryFeeCents, t.currency) : "Grátis"}</span>
            </div>
            {t.entryFeeCents > 0 && <p className="-mt-2 text-xs text-muted">+ {formatMoney(price.serviceFeeCents, t.currency)} de taxa de serviço = <b className="text-ink">{formatMoney(price.totalCents, t.currency)}</b></p>}
            <div>
              <div className="mb-1 flex justify-between text-xs text-muted"><span>Vagas</span><span>{slots}/{t.maxParticipants}{waitlist ? ` · ${waitlist} na fila` : ""}</span></div>
              <div className="h-2 overflow-hidden rounded-full bg-elevated"><div className="h-full rounded-full bg-gradient-to-r from-brand to-brand-soft" style={{ width: `${Math.min(100, (slots / t.maxParticipants) * 100)}%` }} /></div>
            </div>
            <Registration t={t} mine={mine} user={!!user} reg={reg} ci={ci} full={full} />
            {t.entryFeeCents > 0 && <p className="text-[11px] leading-snug text-muted">Reembolso automático ao desistir {refundsOnWithdrawal(t) ? "até o início do check-in" : "(janela encerrada)"}. Cancelamento pela organização devolve tudo.</p>}
          </Card>
        </aside>
      </div>
    </div>
  );
}

function Registration({ t, mine, user, reg, ci, full }: { t: NonNullable<Awaited<ReturnType<typeof tournamentPage>>>["t"]; mine: NonNullable<Awaited<ReturnType<typeof tournamentPage>>>["mine"]; user: boolean; reg: string; ci: string; full: boolean }) {
  if (t.status === "CANCELED") return <Alert tone="danger">Campeonato cancelado.</Alert>;
  if (t.status === "COMPLETED") return <Alert>Campeonato encerrado.</Alert>;
  if (mine && mine.status !== "WITHDRAWN") {
    const order = mine.orders[0];
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between text-sm"><span className="text-muted">Sua inscrição</span><Badge tone={mine.status === "CHECKED_IN" ? "ok" : mine.status === "REGISTERED" ? "brand" : mine.status === "DISQUALIFIED" ? "danger" : "warn"}>{{ REGISTERED: "Confirmada", CHECKED_IN: "Check-in feito", PENDING_PAYMENT: "Aguardando pagamento", WAITLIST: "Na fila", DISQUALIFIED: "Desclassificada", WITHDRAWN: "Desistiu" }[mine.status]}</Badge></div>
        {mine.status === "PENDING_PAYMENT" && order && <ButtonLink href={`/checkout/${order.id}`} className="w-full">Pagar agora</ButtonLink>}
        {t.requireCheckIn && (mine.status === "REGISTERED" || mine.status === "CHECKED_IN") && t.status !== "LIVE" && (
          ci === "open" ? (
            <ActionForm action={checkInAction} className="space-y-2" submit={mine.status === "CHECKED_IN" ? "Desfazer check-in" : "Fazer check-in"} submitVariant={mine.status === "CHECKED_IN" ? "secondary" : "primary"}>
              <input type="hidden" name="participantId" value={mine.id} />
              {mine.status === "CHECKED_IN" && <input type="hidden" name="undo" value="1" />}
            </ActionForm>
          ) : (
            <p className="text-xs text-muted">{ci === "not_open" ? `Check-in abre em ${formatDateTime(t.checkInOpensAt)}.` : "Check-in encerrado."}</p>
          )
        )}
        {!["LIVE", "COMPLETED"].includes(t.status) && mine.status !== "DISQUALIFIED" && (
          <ActionForm action={withdrawAction} className="space-y-2" submit="Desistir da inscrição" submitVariant="danger" confirm="Tem certeza que deseja desistir da inscrição?">
            <input type="hidden" name="participantId" value={mine.id} />
            <input type="hidden" name="slug" value={t.slug} />
          </ActionForm>
        )}
      </div>
    );
  }
  if (t.status === "LIVE") return <Alert>Campeonato em andamento. Inscrições encerradas.</Alert>;
  if (reg === "not_open") return <Alert tone="warn">Inscrições abrem em {formatDateTime(t.registrationOpensAt)}.</Alert>;
  if (reg === "closed") return <Alert tone="warn">Inscrições encerradas.</Alert>;
  if (!user) return <ButtonLink href={`/entrar?next=/torneios/${t.slug}/inscricao`} className="w-full">Entrar para se inscrever</ButtonLink>;
  return <ButtonLink href={`/torneios/${t.slug}/inscricao`} className="w-full">{full ? "Entrar na fila de espera" : "Inscrever-se"}</ButtonLink>;
}

async function Stages({ tournamentId, started }: { tournamentId: string; started: boolean }) {
  const stages = await stageViews(tournamentId);
  if (!started && stages.every((s) => s.status === "PENDING")) return <Empty title="As chaves ainda não foram geradas">Assim que a organização iniciar o campeonato, as chaves aparecem aqui.</Empty>;
  return (
    <div className="space-y-10">
      {stages.map((s) => (
        <section key={s.id} aria-labelledby={`st-${s.id}`}>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <h2 id={`st-${s.id}`} className="text-lg font-extrabold">{s.order}. {s.name}</h2>
            <Badge tone={s.status === "LIVE" ? "accent" : s.status === "COMPLETED" ? "ok" : "neutral"}>{s.status === "LIVE" ? "em andamento" : s.status === "COMPLETED" ? "concluída" : "aguardando"}</Badge>
            <span className="text-xs text-muted">{describeStage(s.settings)}</span>
          </div>
          <StageBody s={s} />
        </section>
      ))}
    </div>
  );
}

function StageBody({ s }: { s: StageView }) {
  if (s.status === "PENDING") {
    return s.participants.length ? <Alert>Esta fase começa quando a anterior terminar. Classificados: {s.participants.map((p) => p.name).join(", ")}.</Alert> : <Alert>Esta fase começa quando a anterior terminar.</Alert>;
  }
  switch (s.type) {
    case "SINGLE_ELIMINATION":
    case "DOUBLE_ELIMINATION":
      return (
        <div className="space-y-4">
          <EliminationBracket matches={s.matches} />
          {s.status === "COMPLETED" && <StandingsTable rows={s.standings.slice(0, 8)} />}
        </div>
      );
    case "SWISS":
      return (
        <div className="space-y-5">
          <StandingsTable rows={s.standings} swiss={s.swiss} highlight={s.settings.advancement?.count ?? 0} />
          <RoundList matches={s.matches} />
        </div>
      );
    case "LEADERBOARD":
      return (
        <div className="space-y-4">
          {s.leaderboard && <LeaderboardTable rows={s.leaderboard} games={s.settings.type === "LEADERBOARD" ? s.settings.games : 0} champion={s.champion} advance={s.settings.advancement?.count} />}
          {s.brGames.length > 0 && <p className="text-xs text-muted">{s.brGames.filter((g) => g.done).length} de {s.brGames.length} partida(s) lançada(s) até agora.</p>}
        </div>
      );
    default: {
      const groups = s.groups ?? [];
      return (
        <div className="space-y-8">
          {groups.map((_, gi) => (
            <div key={gi} className="space-y-3">
              {groups.length > 1 && <h3 className="font-bold text-brand-soft">Grupo {String.fromCharCode(65 + gi)}</h3>}
              <StandingsTable rows={s.standings.filter((r) => r.group === gi + 1)} highlight={s.settings.advancement?.perGroup ?? 0} />
              <RoundList matches={s.matches} group={gi + 1} />
            </div>
          ))}
        </div>
      );
    }
  }
}

async function Participants({ tournamentId, isManager }: { tournamentId: string; isManager: boolean }) {
  const ps = await db.participant.findMany({
    where: { tournamentId, status: isManager ? undefined : { in: ["REGISTERED", "CHECKED_IN", "DISQUALIFIED"] } },
    orderBy: [{ seed: "asc" }, { registeredAt: "asc" }],
  });
  if (!ps.length) return <Empty title="Ninguém inscrito ainda">Seja o primeiro!</Empty>;
  return (
    <Table>
      <thead><tr><Th className="w-10">#</Th><Th>Participante</Th><Th>Jogadores</Th><Th>Situação</Th></tr></thead>
      <tbody>
        {ps.map((p, i) => (
          <tr key={p.id}>
            <Td className="text-muted">{p.seed ?? i + 1}</Td>
            <Td><span className="font-semibold">{p.name}</span> {p.tag && <span className="text-xs text-muted">[{p.tag}]</span>}</Td>
            <Td className="text-xs text-muted">{(p.roster as unknown as RosterMember[]).map((r) => `${r.displayName} (${r.handle})${r.role === "sub" ? " · reserva" : ""}`).join(", ")}</Td>
            <Td><Badge tone={p.status === "CHECKED_IN" ? "ok" : p.status === "DISQUALIFIED" ? "danger" : "neutral"}>{{ REGISTERED: "Confirmado", CHECKED_IN: "Check-in", PENDING_PAYMENT: "Pagamento pendente", WAITLIST: "Fila", DISQUALIFIED: "Desclassificado", WITHDRAWN: "Desistiu" }[p.status]}</Badge></Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
