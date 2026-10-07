import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { respondInviteAction } from "@/app/actions/account";
import { ActionForm } from "@/components/action-form";
import { Flash } from "@/components/flash";
import { Alert, Badge, ButtonLink, Card, Empty, PageTitle } from "@/components/ui";
import { getGame } from "@/games";
import { myTeams, pendingInvites } from "@/server/teams";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "Meus times" };
export const dynamic = "force-dynamic";

export default async function TeamsPage() {
  const user = await requireUser("/times");
  const [teams, invites] = await Promise.all([myTeams(user.id), pendingInvites(user.id)]);
  return (
    <>
      <PageTitle title="Meus times" subtitle="O capitão inscreve o time em campeonatos e movimenta a carteira da equipe." actions={<ButtonLink href="/times/novo">Criar time</ButtonLink>} />
      <Suspense fallback={null}><Flash /></Suspense>
      {invites.length > 0 && (
        <div className="mb-6 space-y-2">
          {invites.map((i) => (
            <Alert key={i.id} className="flex flex-wrap items-center justify-between gap-3">
              <span><b>{i.invitedBy.displayName}</b> convidou você para o time <b>[{i.team.tag}] {i.team.name}</b>.</span>
              <span className="flex gap-2">
                <ActionForm action={respondInviteAction} className="" submit="Aceitar" submitClassName=""><input type="hidden" name="inviteId" value={i.id} /><input type="hidden" name="decision" value="accept" /></ActionForm>
                <ActionForm action={respondInviteAction} className="" submit="Recusar" submitVariant="secondary" submitClassName=""><input type="hidden" name="inviteId" value={i.id} /><input type="hidden" name="decision" value="decline" /></ActionForm>
              </span>
            </Alert>
          ))}
        </div>
      )}
      {teams.length === 0 ? (
        <Empty title="Você ainda não faz parte de nenhum time"><Link href="/times/novo" className="text-brand-soft hover:underline">Crie o seu</Link> ou peça um convite ao capitão.</Empty>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {teams.map((m) => (
            <Link key={m.id} href={`/times/${m.team.slug}`} className="focus-ring rounded-xl">
              <Card className="h-full transition hover:border-brand-soft/60">
                <div className="flex items-center justify-between"><h2 className="font-bold">[{m.team.tag}] {m.team.name}</h2><Badge tone={m.role === "CAPTAIN" ? "brand" : "neutral"}>{{ CAPTAIN: "Capitão", PLAYER: "Jogador", SUB: "Reserva", COACH: "Técnico" }[m.role]}</Badge></div>
                <p className="mt-1 text-xs text-muted">{m.team.gameId ? getGame(m.team.gameId)?.name : "Multijogos"} · {m.team.members.length} integrante(s)</p>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
