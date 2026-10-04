import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { acceptChallengeAction, cancelChallengeAction, disputeChallengeAction, evidenceChallengeAction, reportChallengeAction } from "@/app/actions/challenges";
import { ActionForm } from "@/components/action-form";
import { Alert, Badge, ButtonLink, Card, Field, GameBadge, Input, PageTitle, Select, Textarea, buttonClass } from "@/components/ui";
import { getGame } from "@/games";
import { db } from "@/lib/db";
import { formatDateTime } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { challengeFee, type LineupMember } from "@/server/challenges";
import { getKyc } from "@/server/kyc";
import { getCurrentUser } from "@/server/session";
import { leaderTeams } from "@/server/team-auth";

export const metadata: Metadata = { title: "Desafio" };
export const dynamic = "force-dynamic";

const statusLabel = { OPEN: "Aberto", ACCEPTED: "Em andamento", REPORTED: "Aguardando confirmação", DISPUTED: "Em disputa", SETTLED: "Encerrado", CANCELED: "Cancelado", EXPIRED: "Expirado", VOID: "Anulado" } as const;
const statusTone = { OPEN: "ok", ACCEPTED: "brand", REPORTED: "warn", DISPUTED: "danger", SETTLED: "neutral", CANCELED: "neutral", EXPIRED: "neutral", VOID: "neutral" } as const;

export default async function ChallengePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ time?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const c = await db.challenge.findUnique({ where: { id }, include: { creatorTeam: true, opponentTeam: true } });
  if (!c) notFound();
  const user = await getCurrentUser();
  const game = getGame(c.gameId)!;
  const mode = game.modes.find((m) => m.id === c.modeId)!;
  const myTeams = user ? await leaderTeams(user.id) : [];
  const myIds = new Set(myTeams.map((t) => t.team.id));
  const isCreator = myIds.has(c.creatorTeamId);
  const isOpponent = !!c.opponentTeamId && myIds.has(c.opponentTeamId);
  const involved = isCreator || isOpponent;
  const mySide = isCreator ? "a" : isOpponent ? "b" : null;
  const fee = challengeFee(c.stakeCents, c.feeBps);
  const winnerGets = c.stakeCents * 2 - fee;
  const kyc = user ? await getKyc(user.id) : null;
  const creatorLineup = c.creatorLineup as unknown as LineupMember[];
  const opponentLineup = (c.opponentLineup as unknown as LineupMember[] | null) ?? [];
  const canAcceptTeams = myTeams.filter((t) => t.team.id !== c.creatorTeamId && (!c.invitedTeamId || c.invitedTeamId === t.team.id));
  const acceptTeam = sp.time ? await db.team.findFirst({ where: { id: sp.time, members: { some: { userId: user?.id ?? "", role: "CAPTAIN" } } }, include: { wallet: true, members: { include: { user: { include: { gameAccounts: { where: { gameId: c.gameId } } } } } } } }) : null;
  const evidence = involved ? { a: c.evidenceA, b: c.evidenceB } : null;
  const live = ["ACCEPTED", "REPORTED", "DISPUTED"].includes(c.status);

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageTitle title={`${c.creatorTeam.name} × ${c.opponentTeam?.name ?? "aguardando adversário"}`} subtitle={<span className="inline-flex items-center gap-2"><GameBadge abbr={game.abbr} accent={game.accent} size="sm" />{game.name} · {mode.label} · melhor de {c.bestOf}</span>} actions={<Badge tone={statusTone[c.status]}>{statusLabel[c.status]}</Badge>} />

      <Card className="grid gap-4 text-center sm:grid-cols-3">
        <div><p className="text-xs uppercase tracking-wider text-muted">Aposta de cada equipe</p><p className="text-3xl font-black text-accent">{formatMoney(c.stakeCents)}</p></div>
        <div><p className="text-xs uppercase tracking-wider text-muted">Pote</p><p className="text-3xl font-black">{formatMoney(c.stakeCents * 2)}</p><p className="text-xs text-muted">taxa {formatMoney(fee)} ({(c.feeBps / 100).toFixed(0)}%)</p></div>
        <div><p className="text-xs uppercase tracking-wider text-muted">Vencedor recebe</p><p className="text-3xl font-black text-ok">{formatMoney(winnerGets)}</p><p className="text-xs text-muted">lucro de {formatMoney(c.stakeCents - fee)}</p></div>
      </Card>

      {c.notes && <Alert>{c.notes}</Alert>}
      {c.status === "OPEN" && <p className="text-xs text-muted">Aberto até {formatDateTime(c.expiresAt)}{c.invitedTeamId ? " · convite direto" : ""}.</p>}

      <div className="grid gap-4 md:grid-cols-2">
        {[["Equipe A (criadora)", c.creatorTeam.name, creatorLineup], ["Equipe B", c.opponentTeam?.name, opponentLineup]].map(([label, name, lineup]) => (
          <Card key={String(label)}>
            <p className="text-xs uppercase tracking-wider text-muted">{String(label)}</p>
            <p className="font-bold">{(name as string | undefined) ?? "—"}</p>
            <ul className="mt-2 space-y-1 text-sm text-muted">{(lineup as LineupMember[]).map((l) => <li key={l.userId}>{l.displayName} · <span className="text-ink">{l.handle}</span></li>)}{(lineup as LineupMember[]).length === 0 && <li>aguardando</li>}</ul>
            {c.winnerTeamId && (name === c.creatorTeam.name ? c.winnerTeamId === c.creatorTeamId : c.winnerTeamId === c.opponentTeamId) && <Badge tone="ok" className="mt-2">Vencedora</Badge>}
          </Card>
        ))}
      </div>

      {c.status === "OPEN" && !involved && (
        <Card className="space-y-4">
          <h2 className="font-bold">Aceitar este desafio</h2>
          {!user ? <ButtonLink href={`/entrar?next=/desafios/${c.id}`}>Entrar para aceitar</ButtonLink> : kyc?.status !== "VERIFIED" ? <Alert tone="warn">Verifique sua identidade para aceitar desafios. <Link href="/carteira/verificacao" className="underline">Verificar</Link></Alert> : canAcceptTeams.length === 0 ? <Alert>Você precisa ser líder de uma equipe (diferente da criadora{c.invitedTeamId ? " e a equipe convidada" : ""}).</Alert> : (
            <>
              <form method="get" className="flex flex-wrap items-end gap-3">
                <div className="min-w-56 flex-1"><Field label="Sua equipe" htmlFor="time"><Select id="time" name="time" defaultValue={sp.time ?? ""}><option value="">Selecione…</option>{canAcceptTeams.map((t) => <option key={t.team.id} value={t.team.id}>[{t.team.tag}] {t.team.name} — saldo {formatMoney(t.team.wallet?.balanceCents ?? 0)}</option>)}</Select></Field></div>
                <button className={buttonClass("secondary")}>Escolher</button>
              </form>
              {acceptTeam && (
                <ActionForm action={acceptChallengeAction} submit={`Aceitar e bloquear ${formatMoney(c.stakeCents)}`}>
                  <input type="hidden" name="challengeId" value={c.id} />
                  <input type="hidden" name="teamId" value={acceptTeam.id} />
                  <p className="text-sm text-muted">Saldo da equipe: <b className="text-ok">{formatMoney(acceptTeam.wallet?.balanceCents ?? 0)}</b>. Ao aceitar, {formatMoney(c.stakeCents)} ficam em custódia até o resultado.</p>
                  <fieldset className="space-y-2"><legend className="mb-1 text-sm font-semibold">Escale {mode.teamSize} jogador(es)</legend>
                    {acceptTeam.members.map((m) => { const acc = m.user.gameAccounts[0]; return (
                      <label key={m.userId} className="flex items-center gap-3 rounded-lg border border-line-soft bg-elevated/40 px-3 py-2 text-sm"><input type="checkbox" name="lineup" value={m.userId} disabled={!acc} defaultChecked={!!acc && m.userId === user.id} className="accent-brand" /><span className="flex-1"><b>{m.user.displayName}</b> <span className="text-xs text-muted">{acc ? acc.handle : `sem conta de ${game.abbr}`}</span></span></label>
                    ); })}
                  </fieldset>
                </ActionForm>
              )}
            </>
          )}
        </Card>
      )}

      {c.status === "OPEN" && isCreator && (
        <ActionForm action={cancelChallengeAction} className="" submit="Cancelar desafio e recuperar a aposta" submitVariant="danger" submitClassName="" confirm="Cancelar este desafio? A aposta volta ao saldo."><input type="hidden" name="challengeId" value={c.id} /></ActionForm>
      )}

      {live && involved && (
        <Card className="space-y-4">
          <h2 className="font-bold">Resultado</h2>
          {c.status === "REPORTED" && (
            <Alert tone="warn">
              {c.reportedBy === mySide ? <>Você informou a vitória. Aguardando o adversário confirmar{c.autoSettleAt ? ` — se ele não responder até ${formatDateTime(c.autoSettleAt)}, o resultado é efetivado automaticamente` : ""}.</> : <>O adversário informou que <b>venceu</b>. Reconheça a derrota para encerrar ou conteste com provas{c.autoSettleAt ? ` — sem resposta até ${formatDateTime(c.autoSettleAt)} o resultado é efetivado` : ""}.</>}
            </Alert>
          )}
          {c.status === "DISPUTED" && <Alert tone="danger"><b>Em disputa:</b> {c.disputeReason} Um árbitro vai decidir com base nas provas. Você ainda pode anexar provas ou reconhecer a derrota.</Alert>}
          <div className="grid gap-3 sm:grid-cols-3">
            {c.status !== "DISPUTED" && !(c.status === "REPORTED" && c.reportedBy === mySide) && (
              <ActionForm action={reportChallengeAction} className="" submit="Nós vencemos" submitClassName=""><input type="hidden" name="challengeId" value={c.id} /><input type="hidden" name="outcome" value="WON" /></ActionForm>
            )}
            <ActionForm action={reportChallengeAction} className="" submit="Reconhecer derrota" submitVariant="secondary" submitClassName="" confirm="Reconhecer a derrota entrega o pote ao adversário imediatamente. Confirmar?"><input type="hidden" name="challengeId" value={c.id} /><input type="hidden" name="outcome" value="LOST" /></ActionForm>
            {c.status === "ACCEPTED" && <ActionForm action={reportChallengeAction} className="" submit="Adversário não apareceu" submitVariant="danger" submitClassName="" confirm="Informar que o adversário não compareceu? Um árbitro vai analisar."><input type="hidden" name="challengeId" value={c.id} /><input type="hidden" name="outcome" value="NO_SHOW" /></ActionForm>}
          </div>
          {(c.status === "ACCEPTED" || c.status === "REPORTED") && (
            <details className="rounded-lg border border-line-soft p-3"><summary className="cursor-pointer text-sm font-semibold text-danger">Contestar / abrir disputa</summary>
              <ActionForm action={disputeChallengeAction} className="mt-3 space-y-3" submit="Abrir disputa" submitVariant="danger" submitClassName=""><input type="hidden" name="challengeId" value={c.id} /><Field label="Motivo" htmlFor="reason"><Textarea id="reason" name="reason" required minLength={10} maxLength={500} /></Field></ActionForm>
            </details>
          )}
          <details className="rounded-lg border border-line-soft p-3"><summary className="cursor-pointer text-sm font-semibold">Anexar provas (texto/links)</summary>
            <ActionForm action={evidenceChallengeAction} className="mt-3 space-y-3" submit="Salvar prova" submitVariant="secondary" submitClassName=""><input type="hidden" name="challengeId" value={c.id} /><Field label="Links de prints/replay ou descrição" htmlFor="text"><Textarea id="text" name="text" required maxLength={1000} defaultValue={(mySide === "a" ? evidence?.a : evidence?.b) ?? ""} /></Field></ActionForm>
          </details>
        </Card>
      )}

      {involved && evidence && (evidence.a || evidence.b) && c.status !== "OPEN" && (
        <Card><h2 className="mb-2 font-bold">Provas enviadas</h2><dl className="space-y-2 text-sm"><div><dt className="text-xs text-muted">Equipe A</dt><dd>{evidence.a ?? "—"}</dd></div><div><dt className="text-xs text-muted">Equipe B</dt><dd>{evidence.b ?? "—"}</dd></div></dl></Card>
      )}

      {c.status === "SETTLED" && <Alert tone="ok">Desafio encerrado em {formatDateTime(c.settledAt)}. Vencedora: <b>{c.winnerTeamId === c.creatorTeamId ? c.creatorTeam.name : c.opponentTeam?.name}</b>. {c.resolutionNote}</Alert>}
      {c.status === "VOID" && <Alert>Desafio anulado e apostas devolvidas. {c.resolutionNote}</Alert>}
    </div>
  );
}
