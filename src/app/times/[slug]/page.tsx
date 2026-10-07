import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { deleteTeamAction, inviteAction, removeMemberAction, setMemberRoleAction } from "@/app/actions/account";
import { ActionForm } from "@/components/action-form";
import { Alert, Badge, ButtonLink, Card, Field, Input, PageTitle, Select } from "@/components/ui";
import { db } from "@/lib/db";
import { getGame } from "@/games";
import { formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { getCurrentUser } from "@/server/session";
import { isWalletOn } from "@/server/settings";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const t = await db.team.findUnique({ where: { slug: (await params).slug }, select: { name: true } });
  return { title: t?.name ?? "Time" };
}

export default async function TeamPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const team = await db.team.findUnique({ where: { slug }, include: { members: { include: { user: { include: { gameAccounts: true } } }, orderBy: { joinedAt: "asc" } }, wallet: true } });
  if (!team) notFound();
  const user = await getCurrentUser();
  const me = team.members.find((m) => m.userId === user?.id);
  const leader = me?.role === "CAPTAIN";
  const isAdmin = user?.role === "ADMIN";
  const deleted = !!team.deletedAt;
  if (deleted && !me && !isAdmin) notFound(); // time excluído só aparece para quem era do elenco e para administradores
  const manage = !deleted && (leader || isAdmin); // o admin gerencia qualquer time (convites, remoção, capitania, exclusão), mas não movimenta o saldo
  const walletOn = await isWalletOn();
  const balance = team.wallet?.balanceCents ?? 0;
  const invites = manage ? await db.teamInvite.findMany({ where: { teamId: team.id, status: "PENDING" }, include: { user: true } }) : [];
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageTitle title={`[${team.tag}] ${team.name}`} subtitle={`${team.gameId ? getGame(team.gameId)?.name : "Multijogos"}${team.description ? ` · ${team.description}` : ""}`} actions={leader && walletOn ? <ButtonLink href={deleted ? "/carteira" : `/carteira/${team.id}`} variant="accent">{deleted ? "Saldo do time" : "Carteira da equipe"}</ButtonLink> : null} />
      {deleted && (
        <Alert tone="warn">
          <b>Este time foi excluído{team.deletedAt ? ` em ${formatDate(team.deletedAt)}` : ""}.</b> Ele não aparece mais nas listas, não se inscreve em campeonatos e não movimenta a carteira.
          {leader && balance > 0 && walletOn && <> O saldo de <b>{formatMoney(balance)}</b> está {team.balanceReleasedAt ? "liberado para saque" : "bloqueado até a revisão do administrador"} — <Link href="/carteira" className="underline">veja na Carteira</Link>.</>}
        </Alert>
      )}
      <Card>
        <h2 className="mb-3 font-bold">Integrantes</h2>
        <ul className="divide-y divide-line-soft">
          {team.members.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center gap-3 py-2.5 text-sm">
              <span className="min-w-40 flex-1"><b>{m.user.displayName}</b> <span className="text-xs text-muted">@{m.user.username}</span>
                <span className="block text-xs text-muted">{m.user.gameAccounts.length ? m.user.gameAccounts.map((a) => `${getGame(a.gameId)?.abbr}: ${a.handle}`).join(" · ") : "sem contas de jogo vinculadas"}</span></span>
              <Badge tone={m.role === "CAPTAIN" ? "brand" : "neutral"}>{{ CAPTAIN: "Capitão", PLAYER: "Jogador", SUB: "Reserva", COACH: "Técnico" }[m.role]}</Badge>
              {manage && m.userId !== user?.id && (
                <span className="flex gap-1.5">
                  <ActionForm action={setMemberRoleAction} className="" submit="Tornar capitão" submitVariant="ghost" submitClassName="text-xs" confirm={leader ? "Transferir a capitania? Você deixará de movimentar a carteira da equipe." : "Transferir a capitania deste time para este integrante?"}>
                    <input type="hidden" name="teamId" value={team.id} /><input type="hidden" name="userId" value={m.userId} /><input type="hidden" name="role" value="CAPTAIN" />
                  </ActionForm>
                  <ActionForm action={removeMemberAction} className="" submit="Remover" submitVariant="danger" submitClassName="text-xs" confirm="Remover este integrante?">
                    <input type="hidden" name="teamId" value={team.id} /><input type="hidden" name="userId" value={m.userId} />
                  </ActionForm>
                </span>
              )}
            </li>
          ))}
        </ul>
        {me && !leader && !deleted && (
          <ActionForm action={removeMemberAction} className="mt-4" submit="Sair do time" submitVariant="secondary" submitClassName="" confirm="Sair deste time?">
            <input type="hidden" name="teamId" value={team.id} /><input type="hidden" name="userId" value={me.userId} />
          </ActionForm>
        )}
      </Card>
      {manage && (
        <Card>
          <h2 className="mb-3 font-bold">Convidar jogador</h2>
          <ActionForm action={inviteAction} className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end" submit="Convidar" submitClassName="">
            <input type="hidden" name="teamId" value={team.id} />
            <Field label="Nome de usuário" htmlFor="username"><Input id="username" name="username" required placeholder="usuario" /></Field>
            <Field label="Função" htmlFor="role"><Select id="role" name="role"><option value="PLAYER">Jogador</option><option value="SUB">Reserva</option></Select></Field>
          </ActionForm>
          {invites.length > 0 && <p className="mt-3 text-xs text-muted">Convites pendentes: {invites.map((i) => `@${i.user?.username}`).join(", ")}</p>}
        </Card>
      )}
      {manage && (
        <Card className="space-y-3 border-danger/40">
          <h2 className="font-bold text-danger">Excluir time</h2>
          <p className="text-sm text-muted">
            O time deixa de aparecer, sai das listas e não pode mais se inscrever em campeonatos. Não dá para excluir com desafio, saque, Pix pendente ou campeonato em andamento.
            {balance > 0 ? <> <b className="text-warn">O saldo de {formatMoney(balance)} ficará bloqueado</b> até {leader ? "você pedir a revisão ao administrador na Carteira e ele liberar" : "o ex-líder pedir a revisão e um administrador liberar"} para saque.</> : " Não há saldo na carteira do time."}
          </p>
          <ActionForm action={deleteTeamAction} className="space-y-3" submit="Excluir time" submitVariant="danger" submitClassName="" confirm={`Excluir o time ${team.name}? ${balance > 0 ? "O saldo ficará bloqueado até a revisão do administrador. " : ""}Esta ação não pode ser desfeita pela interface.`}>
            <input type="hidden" name="teamId" value={team.id} />
            <Field label={leader ? "Motivo (opcional)" : "Motivo da exclusão (obrigatório para o admin, mín. 10 caracteres)"} htmlFor="reason"><Input id="reason" name="reason" maxLength={300} required={!leader} minLength={leader ? undefined : 10} /></Field>
          </ActionForm>
        </Card>
      )}
      {!user && <p className="text-sm text-muted"><Link href="/entrar" className="text-brand-soft hover:underline">Entre</Link> para interagir com o time.</p>}
    </div>
  );
}
