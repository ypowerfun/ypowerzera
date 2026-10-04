import type { Metadata } from "next";
import Link from "next/link";
import { addOrgMemberAction } from "@/app/actions/organizer";
import { createOrgAction } from "@/app/actions/account";
import { ActionForm } from "@/components/action-form";
import { Badge, ButtonLink, Card, Empty, Field, Input, PageTitle, Select, Table, Td, Th } from "@/components/ui";
import { getGame } from "@/games";
import { formatDateTime } from "@/lib/dates";
import { STATUS_LABELS } from "@/lib/phases";
import { organizerOverview } from "@/server/organizer";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "Organizar" };
export const dynamic = "force-dynamic";

export default async function OrganizerHome() {
  const user = await requireUser("/organizar");
  const { memberships, tournaments } = await organizerOverview(user.id, user.role === "ADMIN");
  return (
    <div className="space-y-8">
      <PageTitle title="Painel do organizador" subtitle="Crie campeonatos, gerencie inscrições, chaves, resultados e premiações." actions={memberships.length ? <ButtonLink href="/organizar/novo">Novo campeonato</ButtonLink> : null} />
      {memberships.length === 0 ? (
        <Card className="mx-auto max-w-lg">
          <h2 className="font-bold">Crie sua organização</h2>
          <p className="mb-4 mt-1 text-sm text-muted">Toda organização agrupa campeonatos, equipe de apoio e cupons. É grátis e leva um minuto.</p>
          {!user.emailVerifiedAt && <p className="mb-3 text-sm text-warn">Confirme seu e-mail antes de criar uma organização.</p>}
          <ActionForm action={createOrgAction} submit="Criar organização">
            <Field label="Nome" htmlFor="name"><Input id="name" name="name" required minLength={3} maxLength={60} /></Field>
            <Field label="Descrição (opcional)" htmlFor="description"><Input id="description" name="description" maxLength={500} /></Field>
          </ActionForm>
        </Card>
      ) : (
        <>
          <section>
            <h2 className="mb-3 font-bold">Suas organizações</h2>
            <div className="grid gap-4 md:grid-cols-2">
              {memberships.map((m) => (
                <Card key={m.id}>
                  <div className="flex items-center justify-between"><h3 className="font-bold">{m.org.name}</h3><Badge tone="brand">{{ OWNER: "Dono", ADMIN: "Admin", STAFF: "Equipe" }[m.role]}</Badge></div>
                  {(m.role === "OWNER" || m.role === "ADMIN") && (
                    <details className="mt-3"><summary className="cursor-pointer text-sm text-brand-soft">Adicionar membro</summary>
                      <ActionForm action={addOrgMemberAction} className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto]" submit="Adicionar" submitClassName="">
                        <input type="hidden" name="orgId" value={m.orgId} />
                        <Field label="Usuário" htmlFor={`u-${m.id}`}><Input id={`u-${m.id}`} name="username" required placeholder="usuario" /></Field>
                        <Field label="Função" htmlFor={`r-${m.id}`}><Select id={`r-${m.id}`} name="role"><option value="STAFF">Equipe (opera partidas)</option><option value="ADMIN">Admin</option></Select></Field>
                      </ActionForm>
                    </details>
                  )}
                </Card>
              ))}
            </div>
          </section>
          <section>
            <h2 className="mb-3 font-bold">Campeonatos</h2>
            {tournaments.length === 0 ? (
              <Empty title="Você ainda não criou campeonatos"><Link href="/organizar/novo" className="text-brand-soft hover:underline">Criar o primeiro</Link></Empty>
            ) : (
              <Table>
                <thead><tr><Th>Campeonato</Th><Th>Jogo</Th><Th>Início</Th><Th>Inscritos</Th><Th>Situação</Th></tr></thead>
                <tbody>
                  {tournaments.map((t) => (
                    <tr key={t.id}>
                      <Td><Link href={`/organizar/${t.id}`} className="font-semibold hover:text-brand-soft">{t.name}</Link><span className="block text-xs text-muted">{t.org.name}</span></Td>
                      <Td>{getGame(t.gameId)?.abbr}</Td>
                      <Td className="text-muted">{formatDateTime(t.startsAt)}</Td>
                      <Td>{t._count.participants}/{t.maxParticipants}</Td>
                      <Td><Badge tone={t.status === "LIVE" ? "accent" : t.status === "REGISTRATION" ? "ok" : t.status === "CANCELED" ? "danger" : "neutral"}>{STATUS_LABELS[t.status]}</Badge></Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </section>
        </>
      )}
    </div>
  );
}
