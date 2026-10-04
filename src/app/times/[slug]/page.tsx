import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { inviteAction, removeMemberAction, setMemberRoleAction } from "@/app/actions/account";
import { ActionForm } from "@/components/action-form";
import { Badge, ButtonLink, Card, Field, Input, PageTitle, Select } from "@/components/ui";
import { db } from "@/lib/db";
import { getGame } from "@/games";
import { getCurrentUser } from "@/server/session";

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
  const invites = leader ? await db.teamInvite.findMany({ where: { teamId: team.id, status: "PENDING" }, include: { user: true } }) : [];
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageTitle title={`[${team.tag}] ${team.name}`} subtitle={`${team.gameId ? getGame(team.gameId)?.name : "Multijogos"}${team.description ? ` · ${team.description}` : ""}`} actions={leader ? <ButtonLink href={`/carteira/${team.id}`} variant="accent">Carteira da equipe</ButtonLink> : null} />
      <Card>
        <h2 className="mb-3 font-bold">Integrantes</h2>
        <ul className="divide-y divide-line-soft">
          {team.members.map((m) => (
            <li key={m.id} className="flex flex-wrap items-center gap-3 py-2.5 text-sm">
              <span className="min-w-40 flex-1"><b>{m.user.displayName}</b> <span className="text-xs text-muted">@{m.user.username}</span>
                <span className="block text-xs text-muted">{m.user.gameAccounts.length ? m.user.gameAccounts.map((a) => `${getGame(a.gameId)?.abbr}: ${a.handle}`).join(" · ") : "sem contas de jogo vinculadas"}</span></span>
              <Badge tone={m.role === "CAPTAIN" ? "brand" : "neutral"}>{{ CAPTAIN: "Capitão", PLAYER: "Jogador", SUB: "Reserva", COACH: "Técnico" }[m.role]}</Badge>
              {leader && m.userId !== user?.id && (
                <span className="flex gap-1.5">
                  <ActionForm action={setMemberRoleAction} className="" submit="Tornar capitão" submitVariant="ghost" submitClassName="text-xs" confirm="Transferir a capitania? Você deixará de movimentar a carteira da equipe.">
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
        {me && !leader && (
          <ActionForm action={removeMemberAction} className="mt-4" submit="Sair do time" submitVariant="secondary" submitClassName="" confirm="Sair deste time?">
            <input type="hidden" name="teamId" value={team.id} /><input type="hidden" name="userId" value={me.userId} />
          </ActionForm>
        )}
      </Card>
      {leader && (
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
      {!user && <p className="text-sm text-muted"><Link href="/entrar" className="text-brand-soft hover:underline">Entre</Link> para interagir com o time.</p>}
    </div>
  );
}
