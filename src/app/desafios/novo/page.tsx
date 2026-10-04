import type { Metadata } from "next";
import Link from "next/link";
import { createChallengeAction } from "@/app/actions/challenges";
import { ActionForm } from "@/components/action-form";
import { Alert, Card, Field, Input, PageTitle, Select, Textarea, buttonClass } from "@/components/ui";
import { GAMES, getGame } from "@/games";
import { db } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { getKyc } from "@/server/kyc";
import { moneyConfig } from "@/server/money-config";
import { requireUser } from "@/server/session";
import { leaderTeams } from "@/server/team-auth";

export const metadata: Metadata = { title: "Criar desafio" };
export const dynamic = "force-dynamic";

export default async function NewChallengePage({ searchParams }: { searchParams: Promise<{ time?: string; jogo?: string }> }) {
  const user = await requireUser("/desafios/novo");
  const sp = await searchParams;
  const [kyc, teams] = await Promise.all([getKyc(user.id), leaderTeams(user.id)]);
  const cfg = moneyConfig();
  const entry = teams.find((t) => t.team.id === sp.time);
  const game = getGame(sp.jogo ?? "");
  const team = entry
    ? await db.team.findUnique({ where: { id: entry.team.id }, include: { wallet: true, members: { include: { user: { include: { gameAccounts: game ? { where: { gameId: game.id } } : false } } } } } })
    : null;
  const eligibleGames = GAMES.filter((g) => g.modes.some((m) => m.teamSize <= 5));
  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <PageTitle title="Criar desafio" subtitle="Sua aposta fica em custódia desde já e volta se ninguém aceitar." />
      {kyc?.status !== "VERIFIED" && <Alert tone="warn">Desafios valendo créditos exigem identidade <b>verificada</b>. <Link href="/carteira/verificacao" className="underline">Verificar agora</Link>.</Alert>}
      {teams.length === 0 ? (
        <Alert>Só o líder de uma equipe pode criar desafios. <Link href="/times/novo" className="underline">Crie uma equipe</Link>.</Alert>
      ) : (
        <Card>
          <form className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end" method="get">
            <Field label="Equipe" htmlFor="time"><Select id="time" name="time" defaultValue={sp.time ?? ""} required><option value="">Selecione…</option>{teams.map((t) => <option key={t.team.id} value={t.team.id}>[{t.team.tag}] {t.team.name}</option>)}</Select></Field>
            <Field label="Jogo" htmlFor="jogo"><Select id="jogo" name="jogo" defaultValue={sp.jogo ?? ""} required><option value="">Selecione…</option>{eligibleGames.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</Select></Field>
            <button className={buttonClass("secondary")}>Continuar</button>
          </form>
        </Card>
      )}

      {team && game && (
        <Card>
          <p className="mb-4 text-sm text-muted">Saldo disponível da equipe: <b className="text-ok">{formatMoney(team.wallet?.balanceCents ?? 0)}</b> · aposta de {formatMoney(cfg.stakeMinCents)} a {formatMoney(cfg.stakeMaxCents)} · taxa de {(cfg.challengeFeeBps / 100).toFixed(0)}% do pote.</p>
          <ActionForm action={createChallengeAction} submit="Criar desafio e bloquear aposta">
            <input type="hidden" name="teamId" value={team.id} />
            <input type="hidden" name="gameId" value={game.id} />
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Modo" htmlFor="modeId"><Select id="modeId" name="modeId" required>{game.modes.filter((m) => m.teamSize <= 5).map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</Select></Field>
              <Field label="Formato" htmlFor="bestOf"><Select id="bestOf" name="bestOf" defaultValue="3"><option value="1">Melhor de 1</option><option value="3">Melhor de 3</option><option value="5">Melhor de 5</option></Select></Field>
              <Field label="Aposta (créditos)" htmlFor="credits" hint="1 crédito = R$ 1,00"><Input id="credits" name="credits" type="number" min={cfg.stakeMinCents / 100} max={cfg.stakeMaxCents / 100} step={1} required /></Field>
            </div>
            <fieldset className="space-y-2">
              <legend className="mb-1 text-sm font-semibold">Quem vai jogar ({game.modes.map((m) => m.teamSize).filter((v, i, a) => a.indexOf(v) === i).join(" ou ")} jogador(es), conforme o modo)</legend>
              {team.members.map((m) => {
                const acc = (m.user as { gameAccounts?: Array<{ handle: string }> }).gameAccounts?.[0];
                return (
                  <label key={m.userId} className="flex items-center gap-3 rounded-lg border border-line-soft bg-elevated/40 px-3 py-2 text-sm">
                    <input type="checkbox" name="lineup" value={m.userId} disabled={!acc} defaultChecked={!!acc && m.userId === user.id} className="accent-brand" />
                    <span className="flex-1"><b>{m.user.displayName}</b> <span className="text-xs text-muted">{acc ? acc.handle : "sem conta de " + game.abbr}</span></span>
                  </label>
                );
              })}
            </fieldset>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Desafiar uma equipe específica (opcional)" htmlFor="invited" hint="Informe o endereço (slug) do time. Vazio = aberto a todos."><Input id="invited" name="invited" placeholder="nome-do-time" /></Field>
              <Field label="Expira em (horas)" htmlFor="hours"><Input id="hours" name="hours" type="number" min={1} max={72} defaultValue={cfg.challengeOpenTtlHours} /></Field>
            </div>
            <Field label="Observações (mapa, regras combinadas…)" htmlFor="notes"><Textarea id="notes" name="notes" maxLength={300} /></Field>
          </ActionForm>
        </Card>
      )}
    </div>
  );
}
