import type { Metadata } from "next";
import Link from "next/link";
import { cancelTournamentAction, deleteDraftAction, nextStageAction, openCheckInAction, publishAction, seedingAction, startAction } from "@/app/actions/organizer";
import { ActionForm } from "@/components/action-form";
import { OrgNav } from "@/components/org-nav";
import { Alert, Badge, ButtonLink, Card, Field, PageTitle, Stat, Textarea } from "@/components/ui";
import { describeStage } from "@/engine";
import { db } from "@/lib/db";
import { formatDateTime } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { STATUS_LABELS } from "@/lib/phases";
import { loadManaged } from "@/server/organizer-page";

export const metadata: Metadata = { title: "Gerenciar campeonato", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function ManagePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ criado?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const { t, admin } = await loadManaged(id);
  const counts = await db.participant.groupBy({ by: ["status"], where: { tournamentId: id }, _count: true });
  const n = (s: string) => counts.find((c) => c.status === s)?._count ?? 0;
  const confirmed = n("REGISTERED") + n("CHECKED_IN");
  const live = t.stages.find((s) => s.status === "LIVE");
  const nextPending = t.stages.find((s) => s.status === "PENDING");
  const readyForNext = t.status === "LIVE" && !live && nextPending && t.stages.find((s) => s.order === nextPending.order - 1)?.status === "COMPLETED";
  const disputes = await db.matchDispute.count({ where: { status: "OPEN", match: { stage: { tournamentId: id } } } });
  const readyMatches = await db.match.count({ where: { status: { in: ["READY", "REPORTED", "DISPUTED"] }, stage: { tournamentId: id } } });

  return (
    <div>
      <PageTitle title={t.name} subtitle={`${t.org.name} · ${formatDateTime(t.startsAt)}`} actions={<><Badge tone={t.status === "LIVE" ? "accent" : t.status === "REGISTRATION" ? "ok" : "neutral"}>{STATUS_LABELS[t.status]}</Badge><ButtonLink href={`/torneios/${t.slug}`} variant="secondary">Ver página pública</ButtonLink></>} />
      <OrgNav id={id} active="" />
      {sp.criado && <Alert tone="ok" className="mb-4">Campeonato criado como rascunho. Revise as configurações e publique para abrir as inscrições.</Alert>}

      <section className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Confirmados" value={`${confirmed}/${t.maxParticipants}`} tone="ok" hint={`mínimo ${t.minParticipants}`} />
        <Stat label="Check-in feito" value={n("CHECKED_IN")} tone="brand" hint={t.requireCheckIn ? "exigido para jogar" : "não exigido"} />
        <Stat label="Pagamento pendente" value={n("PENDING_PAYMENT")} tone="warn" hint={`${n("WAITLIST")} na fila de espera`} />
        <Stat label="Partidas abertas" value={readyMatches} hint={disputes ? `${disputes} disputa(s)!` : "sem disputas"} tone={disputes ? "warn" : undefined} />
      </section>

      {disputes > 0 && <Alert tone="danger" className="mb-4">Há {disputes} disputa(s) aguardando decisão. <Link href={`/organizar/${id}/partidas`} className="underline">Resolver agora</Link></Alert>}

      <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
        <Card className="space-y-4">
          <h2 className="font-bold">Ciclo de vida</h2>
          {t.status === "DRAFT" && (
            <>
              <p className="text-sm text-muted">Rascunho: só você vê. Revise <Link href={`/organizar/${id}/fases`} className="text-brand-soft hover:underline">as fases</Link> e <Link href={`/organizar/${id}/configuracoes`} className="text-brand-soft hover:underline">as configurações</Link>.</p>
              {admin && <ActionForm action={publishAction} className="" submit="Publicar e abrir inscrições" submitClassName=""><input type="hidden" name="tournamentId" value={id} /></ActionForm>}
              {admin && <ActionForm action={deleteDraftAction} className="" submit="Excluir rascunho" submitVariant="danger" submitClassName="" confirm="Excluir este rascunho definitivamente?"><input type="hidden" name="tournamentId" value={id} /></ActionForm>}
            </>
          )}
          {(t.status === "REGISTRATION" || t.status === "CHECK_IN") && (
            <>
              <ul className="space-y-1.5 text-sm text-muted">
                <li>✔ {confirmed} participante(s) confirmado(s){confirmed < t.minParticipants && <span className="text-warn"> — faltam {t.minParticipants - confirmed} para o mínimo</span>}</li>
                {t.requireCheckIn && <li>{n("CHECKED_IN") >= t.minParticipants ? "✔" : "•"} {n("CHECKED_IN")} com check-in (só eles entram nas chaves)</li>}
              </ul>
              <div className="flex flex-wrap gap-3">
                {t.status === "REGISTRATION" && <ActionForm action={openCheckInAction} className="" submit="Abrir check-in agora" submitVariant="secondary" submitClassName=""><input type="hidden" name="tournamentId" value={id} /></ActionForm>}
                <ActionForm action={seedingAction} className="" submit="Aplicar seeding" submitVariant="secondary" submitClassName=""><input type="hidden" name="tournamentId" value={id} /></ActionForm>
                {admin && <ActionForm action={startAction} className="" submit="Iniciar campeonato e gerar chaves" submitClassName="" confirm="Iniciar agora? Quem não fez check-in ficará de fora e as inscrições serão encerradas."><input type="hidden" name="tournamentId" value={id} /></ActionForm>}
              </div>
            </>
          )}
          {t.status === "LIVE" && (
            <>
              <p className="text-sm text-muted">{live ? <>Fase em andamento: <b className="text-ink">{live.name}</b>. <Link href={`/organizar/${id}/partidas`} className="text-brand-soft hover:underline">Lançar resultados →</Link></> : readyForNext ? "A fase anterior terminou. Inicie a próxima." : "Aguardando."}</p>
              {readyForNext && admin && <ActionForm action={nextStageAction} className="" submit={`Iniciar: ${nextPending!.name}`} submitClassName=""><input type="hidden" name="tournamentId" value={id} /></ActionForm>}
            </>
          )}
          {t.status === "COMPLETED" && <Alert tone="ok">Campeonato encerrado em {formatDateTime(t.completedAt)}. <Link href={`/organizar/${id}/financeiro`} className="underline">Ver premiações</Link></Alert>}
          {t.status === "CANCELED" && <Alert tone="danger">Campeonato cancelado.</Alert>}
          {admin && !["COMPLETED", "CANCELED", "DRAFT"].includes(t.status) && (
            <details className="rounded-lg border border-danger/30 p-3"><summary className="cursor-pointer text-sm font-semibold text-danger">Cancelar campeonato</summary>
              <ActionForm action={cancelTournamentAction} className="mt-3 space-y-3" submit="Cancelar e reembolsar todos" submitVariant="danger" submitClassName="" confirm="Cancelar o campeonato? Todas as inscrições pagas serão reembolsadas.">
                <input type="hidden" name="tournamentId" value={id} />
                <Field label="Motivo (os participantes verão)" htmlFor="reason"><Textarea id="reason" name="reason" required minLength={3} maxLength={300} /></Field>
              </ActionForm>
            </details>
          )}
        </Card>
        <Card>
          <h2 className="mb-3 font-bold">Fases</h2>
          <ol className="space-y-3 text-sm">
            {t.stages.map((s) => (
              <li key={s.id} className="flex items-start gap-3"><span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand/20 text-xs font-bold text-brand-soft">{s.order}</span><span className="min-w-0 flex-1"><b>{s.name}</b> <Badge tone={s.status === "LIVE" ? "accent" : s.status === "COMPLETED" ? "ok" : "neutral"}>{s.status === "LIVE" ? "em andamento" : s.status === "COMPLETED" ? "concluída" : "aguardando"}</Badge><span className="block text-xs text-muted">{describeStage(s.settings as never)}</span></span></li>
            ))}
          </ol>
          <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-line pt-4 text-sm">
            <div><dt className="text-xs text-muted">Inscrição</dt><dd className="font-semibold">{t.entryFeeCents ? formatMoney(t.entryFeeCents) : "Grátis"}</dd></div>
            <div><dt className="text-xs text-muted">Premiação</dt><dd className={t.prizePoolCents ? "font-black text-gold" : "font-semibold"}>{t.prizePoolCents ? formatMoney(t.prizePoolCents) : "—"}</dd></div>
          </dl>
        </Card>
      </div>
    </div>
  );
}
