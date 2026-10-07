import { flatParams } from "@/lib/url";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { registerAction } from "@/app/actions/tournament";
import { ActionForm } from "@/components/action-form";
import { Alert, Badge, Card, Field, Input, PageTitle, Select, buttonClass } from "@/components/ui";
import { getGame } from "@/games";
import { db } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { registrationWindow } from "@/lib/phases";
import { quote } from "@/server/orders";
import { requireUser } from "@/server/session";
import { activeCount } from "@/server/orders";
import type { CustomField } from "@/server/types";

export const metadata: Metadata = { title: "Inscrição", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function RegistrationPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ time?: string }> }) {
  const { slug } = await params;
  const sp = flatParams(await searchParams);
  const user = await requireUser(`/torneios/${slug}/inscricao`);
  const t = await db.tournament.findUnique({ where: { slug } });
  // Rascunho é só do organizador (a página do campeonato já dá 404): a tela de inscrição não pode entregar nome, taxa e campos.
  if (!t || t.status === "DRAFT") notFound();
  const game = getGame(t.gameId)!;
  const mode = game.modes.find((m) => m.id === t.modeId)!;
  const existing = await db.participant.findUnique({ where: { tournamentId_userId: { tournamentId: t.id, userId: user.id } } });
  if (existing && existing.status !== "WITHDRAWN") redirect(`/torneios/${slug}`);
  const win = registrationWindow(t);
  const full = (await activeCount(db, t.id)) >= t.maxParticipants;
  const price = quote(t);
  const fields = (t.customFields as unknown as CustomField[] | null) ?? [];
  const solo = t.teamSize === 1;

  const myAccount = await db.gameAccount.findUnique({ where: { userId_gameId: { userId: user.id, gameId: t.gameId } } });
  const teams = solo ? [] : await db.teamMember.findMany({ where: { userId: user.id, role: "CAPTAIN", team: { deletedAt: null } }, include: { team: { include: { members: { include: { user: { include: { gameAccounts: { where: { gameId: t.gameId } } } } } } } } } });
  const chosen = teams.find((m) => m.team.id === sp.time)?.team;

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <PageTitle title={`Inscrição: ${t.name}`} subtitle={`${game.name} · ${mode.label}`} />
      {win !== "open" && <Alert tone="warn">As inscrições não estão abertas no momento.</Alert>}
      {!user.emailVerifiedAt && <Alert tone="warn">Confirme seu e-mail para se inscrever. Reenvie o link em <Link href="/conta" className="underline">Minha conta</Link>.</Alert>}
      {full && <Alert tone="warn">Vagas esgotadas: você entrará na <b>fila de espera</b> e será avisado se abrir uma vaga. {t.entryFeeCents > 0 && "O pagamento só é cobrado se você for promovido."}</Alert>}

      {!myAccount && (
        <Alert tone="danger">
          Você ainda não vinculou sua conta de {game.name}. <Link href={`/conta/contas?jogo=${t.gameId}&next=/torneios/${slug}/inscricao`} className="font-semibold underline">Vincular agora</Link>.
        </Alert>
      )}

      {!solo && (
        <Card>
          <form className="flex flex-wrap items-end gap-3" method="get">
            <div className="min-w-56 flex-1">
              <Field label="Time" htmlFor="time" hint="Somente o capitão inscreve o time.">
                <Select id="time" name="time" defaultValue={sp.time ?? ""}>
                  <option value="">Selecione…</option>
                  {teams.map((m) => <option key={m.team.id} value={m.team.id}>[{m.team.tag}] {m.team.name}</option>)}
                </Select>
              </Field>
            </div>
            <button className={buttonClass("secondary")}>Escolher time</button>
          </form>
          {teams.length === 0 && <p className="mt-3 text-sm text-muted">Você não é capitão de nenhum time. <Link href="/times/novo" className="text-brand-soft hover:underline">Crie um time</Link> primeiro.</p>}
        </Card>
      )}

      {(solo || chosen) && myAccount && (
        <Card>
          <ActionForm action={registerAction} className="space-y-5" submit={full ? "Entrar na fila de espera" : t.entryFeeCents > 0 ? "Continuar para o pagamento" : "Confirmar inscrição"}>
            <input type="hidden" name="tournamentId" value={t.id} />
            <input type="hidden" name="slug" value={t.slug} />
            {chosen && <input type="hidden" name="teamId" value={chosen.id} />}

            {solo ? (
              <div className="rounded-lg border border-line bg-elevated/50 p-3 text-sm">Você jogará como <b>{user.displayName}</b> · {myAccount.handle}</div>
            ) : (
              chosen && (
                <fieldset className="space-y-2">
                  <legend className="mb-1 text-sm font-semibold">Elenco — {mode.teamSize} titulares{mode.maxSubs ? ` e até ${mode.maxSubs} reserva(s)` : ""}</legend>
                  {chosen.members.map((m) => {
                    const acc = m.user.gameAccounts[0];
                    return (
                      <div key={m.userId} className="flex flex-wrap items-center gap-4 rounded-lg border border-line-soft bg-elevated/40 px-3 py-2 text-sm">
                        <span className="min-w-40 flex-1"><b>{m.user.displayName}</b> <span className="text-xs text-muted">{acc ? acc.handle : "sem conta vinculada"}</span> {m.role === "CAPTAIN" && <Badge tone="brand">capitão</Badge>}</span>
                        <label className="flex items-center gap-1.5"><input type="checkbox" name="starter" value={m.userId} disabled={!acc} defaultChecked={!!acc && m.role === "CAPTAIN"} className="accent-brand" /> titular</label>
                        {mode.maxSubs > 0 && <label className="flex items-center gap-1.5"><input type="checkbox" name="sub" value={m.userId} disabled={!acc} className="accent-brand" /> reserva</label>}
                      </div>
                    );
                  })}
                  <p className="text-xs text-muted">Só aparecem como selecionáveis os membros que já vincularam a conta do jogo.</p>
                </fieldset>
              )
            )}

            {fields.map((f) => (
              <Field key={f.key} label={`${f.label}${f.required ? " *" : ""}`} htmlFor={`cf_${f.key}`} hint={f.private ? "Visível apenas para a organização." : "Visível para os adversários."}>
                {f.type === "select" ? (
                  <Select id={`cf_${f.key}`} name={`cf_${f.key}`} required={f.required}>
                    <option value="">Selecione…</option>
                    {f.options?.map((o) => <option key={o}>{o}</option>)}
                  </Select>
                ) : f.type === "checkbox" ? (
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" id={`cf_${f.key}`} name={`cf_${f.key}`} className="accent-brand" required={f.required} /> {f.label}</label>
                ) : (
                  <Input id={`cf_${f.key}`} name={`cf_${f.key}`} required={f.required} maxLength={300} />
                )}
              </Field>
            ))}

            {t.entryFeeCents > 0 && !full && (
              <div className="space-y-3 rounded-lg border border-line bg-elevated/40 p-4 text-sm">
                <Field label="Cupom de desconto (opcional)" htmlFor="coupon"><Input id="coupon" name="coupon" placeholder="CODIGO" autoCapitalize="characters" /></Field>
                <dl className="space-y-1">
                  <div className="flex justify-between"><dt className="text-muted">Inscrição</dt><dd>{formatMoney(price.subtotalCents, t.currency)}</dd></div>
                  <div className="flex justify-between"><dt className="text-muted">Taxa de serviço</dt><dd>{formatMoney(price.serviceFeeCents, t.currency)}</dd></div>
                  <div className="flex justify-between border-t border-line pt-1 font-bold"><dt>Total (antes do cupom)</dt><dd>{formatMoney(price.totalCents, t.currency)}</dd></div>
                </dl>
                <p className="text-xs text-muted">Sua vaga fica reservada por 30 minutos enquanto você paga.</p>
              </div>
            )}

            <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="acceptRules" className="mt-1 accent-brand" required /> <span>Li e aceito o <Link href={`/torneios/${t.slug}?aba=regras`} target="_blank" className="text-brand-soft underline">regulamento</Link> do campeonato.</span></label>
          </ActionForm>
        </Card>
      )}
    </div>
  );
}
