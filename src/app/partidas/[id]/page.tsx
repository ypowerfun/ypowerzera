import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { disputeMatchAction, reportMatchAction, vetoAction_ } from "@/app/actions/tournament";
import { ActionForm } from "@/components/action-form";
import { Alert, Badge, Card, Field, Input, PageTitle, Select, Textarea } from "@/components/ui";
import { createVeto, isVetoComplete, nextStep, availableMaps, type VetoState } from "@/engine";
import { getGame } from "@/games";
import { formatDateTime } from "@/lib/dates";
import { currentVeto, vetoAvailable } from "@/server/matches";
import { matchPage } from "@/server/queries";
import { getCurrentUser } from "@/server/session";
import { db } from "@/lib/db";
import type { RosterMember } from "@/server/types";

export const metadata: Metadata = { title: "Sala da partida", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function MatchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const m = await matchPage(id);
  if (!m) notFound();
  const user = await getCurrentUser();
  const t = m.stage.tournament;
  if (t.status === "DRAFT") notFound();
  const game = getGame(t.gameId)!;
  const side = user ? (m.participantA?.userId === user.id ? "a" : m.participantB?.userId === user.id ? "b" : null) : null;
  const manager = user ? !!(await db.orgMember.findUnique({ where: { orgId_userId: { orgId: t.orgId, userId: user.id } } })) || user.role === "ADMIN" : false;
  const open = ["READY", "REPORTED", "DISPUTED"].includes(m.status) && t.status === "LIVE";
  const ra = m.reportA as { scoreA: number; scoreB: number } | null;
  const rb = m.reportB as { scoreA: number; scoreB: number } | null;
  const other = side === "a" ? rb : side === "b" ? ra : null;
  const mine = side === "a" ? ra : side === "b" ? rb : null;
  const veto = vetoAvailable({ bestOf: m.bestOf, stage: { tournament: t } }) ? currentVeto({ ...m, stage: { tournament: t } } as never) : null;

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageTitle title={`${m.participantA?.name ?? "A definir"} × ${m.participantB?.name ?? "A definir"}`} subtitle={<><Link href={`/torneios/${t.slug}?aba=chaves`} className="text-brand-soft hover:underline">{t.name}</Link> · {m.stage.name} · {m.key} · melhor de {m.bestOf}</>} />
      <Card className="flex flex-wrap items-center justify-between gap-4">
        <div className="text-center"><p className="text-sm text-muted">{m.participantA?.name ?? "—"}</p><p className="text-4xl font-black tabular-nums">{m.scoreA ?? "–"}</p></div>
        <div className="text-center">
          <Badge tone={m.status === "COMPLETED" ? "ok" : m.status === "DISPUTED" ? "danger" : m.status === "REPORTED" ? "warn" : "brand"}>{{ PENDING: "Aguardando adversários", READY: "Liberada", REPORTED: "Aguardando confirmação", DISPUTED: "Em disputa", COMPLETED: "Encerrada", BYE: "BYE", SKIPPED: "Não necessária" }[m.status]}</Badge>
          {m.forfeit && <p className="mt-1 text-xs text-warn">W.O.</p>}
          {m.scheduledAt && <p className="mt-1 text-xs text-muted">Agendada: {formatDateTime(m.scheduledAt)}</p>}
        </div>
        <div className="text-center"><p className="text-sm text-muted">{m.participantB?.name ?? "—"}</p><p className="text-4xl font-black tabular-nums">{m.scoreB ?? "–"}</p></div>
      </Card>

      {m.notes && <Alert>{m.notes}</Alert>}

      <div className="grid gap-4 md:grid-cols-2">
        {[m.participantA, m.participantB].map((p, i) =>
          p ? (
            <Card key={p.id}>
              <h2 className="mb-2 font-bold">{p.name} {p.tag && <span className="text-xs text-muted">[{p.tag}]</span>}</h2>
              <ul className="space-y-1 text-sm text-muted">{(p.roster as unknown as RosterMember[]).map((r) => <li key={r.userId}>{r.displayName} · <span className="text-ink">{r.handle}</span>{r.role === "sub" ? " (reserva)" : ""}</li>)}</ul>
              <p className="sr-only">{i === 0 ? "Lado A" : "Lado B"}</p>
            </Card>
          ) : null,
        )}
      </div>

      {veto && <VetoPanel state={veto} side={side} matchId={m.id} open={open} />}

      {open && side && t.allowPlayerReporting && (
        <Card className="space-y-4">
          <h2 className="font-bold">Relatar placar</h2>
          {m.status === "DISPUTED" && <Alert tone="danger">Os placares divergem. A organização vai decidir; você ainda pode corrigir seu relato.</Alert>}
          {other && !mine && (
            <Alert tone="warn">
              O adversário informou <b>{other.scoreA} × {other.scoreB}</b> ({m.participantA?.name} × {m.participantB?.name}). Confirme enviando o mesmo placar ou conteste.
            </Alert>
          )}
          {mine && <p className="text-sm text-muted">Seu último relato: <b>{mine.scoreA} × {mine.scoreB}</b>.</p>}
          <ActionForm action={reportMatchAction} className="grid grid-cols-[1fr_auto_1fr] items-end gap-3" submit={other && !mine ? "Confirmar placar" : "Enviar placar"} submitClassName="col-span-3">
            <input type="hidden" name="matchId" value={m.id} />
            <Field label={m.participantA?.name ?? "A"} htmlFor="scoreA"><Input id="scoreA" name="scoreA" type="number" min={0} max={999} required defaultValue={other?.scoreA} /></Field>
            <span className="pb-3 text-muted">×</span>
            <Field label={m.participantB?.name ?? "B"} htmlFor="scoreB"><Input id="scoreB" name="scoreB" type="number" min={0} max={999} required defaultValue={other?.scoreB} /></Field>
          </ActionForm>
          {m.bestOf > 1 && <p className="text-xs text-muted">Em melhor de {m.bestOf}, informe o placar de mapas/jogos (ex.: 2 × 1).</p>}
          {other && (
            <details className="rounded-lg border border-line-soft p-3">
              <summary className="cursor-pointer text-sm font-semibold text-danger">Contestar resultado</summary>
              <ActionForm action={disputeMatchAction} className="mt-3 space-y-3" submit="Abrir disputa" submitVariant="danger">
                <input type="hidden" name="matchId" value={m.id} />
                <Field label="Motivo (inclua links de prints/replay)" htmlFor="reason"><Textarea id="reason" name="reason" required minLength={5} maxLength={600} /></Field>
              </ActionForm>
            </details>
          )}
        </Card>
      )}

      {open && !t.allowPlayerReporting && <Alert>Neste campeonato apenas a organização lança os resultados.</Alert>}
      {manager && <p className="text-sm"><Link href={`/organizar/${t.id}/partidas`} className="text-brand-soft hover:underline">Gerenciar partidas →</Link></p>}
      {m.disputes.length > 0 && manager && (
        <Card><h2 className="mb-2 font-bold">Disputas</h2><ul className="space-y-2 text-sm">{m.disputes.map((d) => <li key={d.id}><Badge tone={d.status === "OPEN" ? "danger" : "ok"}>{d.status === "OPEN" ? "aberta" : "resolvida"}</Badge> <span className="text-muted">{d.reason}</span></li>)}</ul></Card>
      )}
      <p className="text-xs text-muted">{game.name} · {t.name}</p>
    </div>
  );
}

function VetoPanel({ state, side, matchId, open }: { state: VetoState; side: "a" | "b" | null; matchId: string; open: boolean }) {
  const step = nextStep(state);
  const complete = isVetoComplete(state);
  const maps = availableMaps(state);
  void createVeto;
  return (
    <Card className="space-y-3">
      <h2 className="font-bold">Veto de mapas</h2>
      <ol className="flex flex-wrap gap-2 text-xs">
        {state.history.map((h, i) => (
          <li key={i} className={`rounded-lg border px-2.5 py-1 ${h.action === "pick" ? "border-ok/40 bg-ok/10 text-ok" : "border-danger/40 bg-danger/10 text-danger"}`}>
            {h.action === "pick" ? "✔ pick" : "✖ ban"} · time {h.team.toUpperCase()} · <b>{h.map}</b>
          </li>
        ))}
      </ol>
      {complete ? (
        <Alert tone="ok">Veto concluído. Mapas: {state.history.filter((h) => h.action === "pick").map((h) => h.map).join(", ")}{maps[0] ? `, decider: ${maps[0]}` : ""}.</Alert>
      ) : step ? (
        <>
          <p className="text-sm">Vez do <b>time {step.team.toUpperCase()}</b>: <b>{step.action === "ban" ? "banir" : "escolher"}</b> um mapa.</p>
          {open && side === step.team ? (
            <ActionForm action={vetoAction_} className="flex flex-wrap gap-2" submit={step.action === "ban" ? "Banir mapa" : "Escolher mapa"} submitClassName="">
              <input type="hidden" name="matchId" value={matchId} />
              <Select name="map" required className="max-w-56">{maps.map((m) => <option key={m}>{m}</option>)}</Select>
            </ActionForm>
          ) : (
            <p className="text-xs text-muted">Aguardando o outro time.</p>
          )}
        </>
      ) : null}
    </Card>
  );
}
