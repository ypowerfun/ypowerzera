import type { Metadata } from "next";
import Link from "next/link";
import { brResultsAction, forfeitAction, nextStageAction, resetMatchAction, scheduleAction, setResultAction } from "@/app/actions/organizer";
import { ActionForm } from "@/components/action-form";
import { OrgNav } from "@/components/org-nav";
import { Alert, Badge, Card, Empty, Field, Input, PageTitle, Table, Td, Th } from "@/components/ui";
import { describeStage } from "@/engine";
import { db } from "@/lib/db";
import { toLocalInput } from "@/lib/dates";
import { loadManaged } from "@/server/organizer-page";
import { stageViews, type MatchView, type StageView } from "@/server/queries";

export const metadata: Metadata = { title: "Partidas", robots: { index: false } };
export const dynamic = "force-dynamic";

function MatchRow({ m, tid }: { m: MatchView; tid: string }) {
  const done = m.status === "COMPLETED";
  return (
    <Card className={`space-y-3 py-4 ${m.status === "DISPUTED" ? "border-danger/60" : m.status === "REPORTED" ? "border-warn/50" : ""}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link href={`/partidas/${m.id}`} className="font-semibold hover:text-brand-soft">{m.a?.name} <span className="text-muted">×</span> {m.b?.name}</Link>
        <span className="flex items-center gap-2"><span className="text-xs text-muted">{m.key} · Bo{m.bestOf}</span><Badge tone={done ? "ok" : m.status === "DISPUTED" ? "danger" : m.status === "REPORTED" ? "warn" : "brand"}>{done ? `${m.scoreA} × ${m.scoreB}${m.forfeit ? " (W.O.)" : ""}` : { READY: "pronta", REPORTED: "aguardando confirmação", DISPUTED: "em disputa" }[m.status] ?? m.status}</Badge></span>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <ActionForm action={setResultAction} className="flex flex-wrap items-end gap-2" submit={done ? "Corrigir" : "Lançar"} submitClassName="">
          <input type="hidden" name="tournamentId" value={tid} /><input type="hidden" name="matchId" value={m.id} />
          <Input name="scoreA" type="number" min={0} max={999} required defaultValue={m.scoreA ?? ""} className="w-20" aria-label={`Placar de ${m.a?.name}`} />
          <span className="pb-2.5 text-muted">×</span>
          <Input name="scoreB" type="number" min={0} max={999} required defaultValue={m.scoreB ?? ""} className="w-20" aria-label={`Placar de ${m.b?.name}`} />
          <Input name="note" placeholder="observação (opcional)" className="w-48" />
        </ActionForm>
        {!done && (
          <details><summary className="cursor-pointer text-sm text-warn">W.O.</summary>
            <ActionForm action={forfeitAction} className="mt-2 flex flex-wrap items-end gap-2" submit="Aplicar W.O." submitVariant="secondary" submitClassName="">
              <input type="hidden" name="tournamentId" value={tid} /><input type="hidden" name="matchId" value={m.id} />
              <select name="loser" className="rounded-lg border border-line bg-bg px-2 py-2 text-sm" aria-label="Quem perde"><option value="a">{m.a?.name} perde</option><option value="b">{m.b?.name} perde</option></select>
              <Input name="reason" required minLength={3} placeholder="motivo" className="w-48" />
            </ActionForm>
          </details>
        )}
        {(done || m.status === "REPORTED" || m.status === "DISPUTED") && <ActionForm action={resetMatchAction} className="" submit="Desfazer" submitVariant="ghost" submitClassName="text-xs" confirm="Desfazer este resultado?"><input type="hidden" name="tournamentId" value={tid} /><input type="hidden" name="matchId" value={m.id} /></ActionForm>}
        {!done && (
          <ActionForm action={scheduleAction} className="flex items-end gap-2" submit="Agendar" submitVariant="ghost" submitClassName="text-xs">
            <input type="hidden" name="tournamentId" value={tid} /><input type="hidden" name="matchId" value={m.id} />
            <Input name="at" type="datetime-local" defaultValue={toLocalInput(m.scheduledAt)} className="w-52 text-xs" aria-label="Horário" />
          </ActionForm>
        )}
      </div>
    </Card>
  );
}

function LeaderboardEntry({ s, tid }: { s: StageView; tid: string }) {
  const games = [...s.brGames].sort((a, b) => b.round - a.round || a.lobby - b.lobby);
  if (!games.length) return <Empty title="Aguardando a geração dos lobbies" />;
  const current = games.find((g) => !g.done) ?? games[0];
  return (
    <div className="space-y-6">
      {[current, ...games.filter((g) => g.id !== current.id).slice(0, 3)].map((g) => {
        const res = new Map(g.results.map((r) => [r.participantId, r]));
        return (
          <Card key={g.id} className="space-y-3">
            <div className="flex items-center justify-between"><h3 className="font-bold">Partida {g.round}{s.brGames.filter((x) => x.round === g.round).length > 1 ? ` · Lobby ${g.lobby}` : ""}</h3><Badge tone={g.done ? "ok" : "warn"}>{g.done ? "lançada" : "aguardando resultados"}</Badge></div>
            <ActionForm action={brResultsAction} className="space-y-3" submit={g.done ? "Corrigir resultados" : "Lançar resultados"} submitClassName="">
              <input type="hidden" name="tournamentId" value={tid} /><input type="hidden" name="brGameId" value={g.id} />
              <Table>
                <thead><tr><Th>Participante</Th><Th className="w-28">Colocação</Th><Th className="w-28">Abates</Th></tr></thead>
                <tbody>
                  {g.participants.map((p) => (
                    <tr key={p.id}>
                      <Td><input type="hidden" name="pid" value={p.id} /><b>{p.name}</b> {p.tag && <span className="text-xs text-muted">[{p.tag}]</span>}</Td>
                      <Td><Input name={`place_${p.id}`} type="number" min={1} defaultValue={res.get(p.id)?.placement ?? ""} aria-label={`Colocação de ${p.name}`} /></Td>
                      <Td><Input name={`kills_${p.id}`} type="number" min={0} max={99} defaultValue={res.get(p.id)?.kills ?? 0} aria-label={`Abates de ${p.name}`} /></Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
              <div className="flex flex-wrap items-center gap-4">
                <Field label="Código do lobby (opcional)" htmlFor={`code-${g.id}`}><Input id={`code-${g.id}`} name="code" defaultValue={g.code ?? ""} maxLength={80} className="w-56" /></Field>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="fillMissing" className="accent-brand" /> preencher ausentes com as últimas colocações</label>
              </div>
            </ActionForm>
          </Card>
        );
      })}
    </div>
  );
}

export default async function MatchesAdminPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { t, admin } = await loadManaged(id);
  const stages = (await stageViews(id)).filter((s) => s.status !== "PENDING");
  const disputes = await db.matchDispute.findMany({ where: { status: "OPEN", match: { stage: { tournamentId: id } } }, include: { match: true } });
  return (
    <div>
      <PageTitle title="Partidas e resultados" subtitle="Lance placares, resolva disputas, aplique W.O. e acompanhe os lobbies." />
      <OrgNav id={id} active="/partidas" />
      {t.status === "DRAFT" || t.status === "REGISTRATION" || t.status === "CHECK_IN" ? <Alert>O campeonato ainda não começou. Inicie-o na visão geral para gerar as chaves.</Alert> : null}
      {disputes.length > 0 && <Alert tone="danger" className="mb-4">{disputes.length} disputa(s) aberta(s): confira os relatos nas partidas marcadas em vermelho e lance o resultado final.</Alert>}
      <div className="space-y-10">
        {stages.map((s) => {
          const open = s.matches.filter((m) => ["READY", "REPORTED", "DISPUTED"].includes(m.status));
          const done = s.matches.filter((m) => m.status === "COMPLETED");
          return (
            <section key={s.id}>
              <div className="mb-3 flex flex-wrap items-center gap-2"><h2 className="text-lg font-extrabold">{s.order}. {s.name}</h2><Badge tone={s.status === "LIVE" ? "accent" : "ok"}>{s.status === "LIVE" ? "em andamento" : "concluída"}</Badge><span className="text-xs text-muted">{describeStage(s.settings)}</span></div>
              {s.type === "LEADERBOARD" ? (
                <LeaderboardEntry s={s} tid={id} />
              ) : (
                <div className="space-y-4">
                  {open.length === 0 && s.status === "LIVE" && <Alert>Nenhuma partida pronta no momento — aguardando as anteriores.</Alert>}
                  {open.sort((a, b) => (a.status === "DISPUTED" ? -1 : 0) - (b.status === "DISPUTED" ? -1 : 0)).map((m) => <MatchRow key={m.id} m={m} tid={id} />)}
                  {done.length > 0 && (
                    <details className="rounded-xl border border-line"><summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-muted">Partidas encerradas ({done.length})</summary><div className="space-y-3 p-3">{done.map((m) => <MatchRow key={m.id} m={m} tid={id} />)}</div></details>
                  )}
                </div>
              )}
              {s.status === "COMPLETED" && t.status === "LIVE" && admin && t.stages.some((x) => x.order === s.order + 1 && x.status === "PENDING") && (
                <div className="mt-4"><ActionForm action={nextStageAction} className="" submit="Iniciar próxima fase" submitClassName=""><input type="hidden" name="tournamentId" value={id} /></ActionForm></div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
