import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { addOrgMemberAction, deleteOrgAction, removeOrgMemberAction, updateOrgAction } from "@/app/actions/organizer";
import { createOrgAction } from "@/app/actions/account";
import { ActionForm } from "@/components/action-form";
import { Flash } from "@/components/flash";
import { Alert, Badge, ButtonLink, Card, Empty, Field, GameBadge, Input, PageTitle, Select, Table, Td, Th, Textarea } from "@/components/ui";
import { getGame } from "@/games";
import { formatDateTime } from "@/lib/dates";
import { STATUS_LABELS } from "@/lib/phases";
import { organizerOverview } from "@/server/organizer";
import { requireUser, toActor } from "@/server/session";

export const metadata: Metadata = { title: "Organizar" };
export const dynamic = "force-dynamic";

export default async function OrganizerHome() {
  const user = await requireUser("/organizar");
  const isAdmin = user.role === "ADMIN";
  const canCreate = isAdmin || user.role === "ORGANIZER"; // jogador comum não cria organização nem campeonato
  const { orgs, tournaments } = await organizerOverview(toActor(user));
  if (!canCreate && orgs.length === 0) {
    return (
      <div className="mx-auto max-w-xl space-y-4">
        <PageTitle title="Painel do organizador" subtitle="Área para quem cria e gerencia campeonatos." />
        <Alert tone="warn"><b>Seu cargo é Jogador.</b> Só organizadores criam organizações e campeonatos. Quer organizar? Peça a um administrador da plataforma para liberar o seu acesso — enquanto isso você pode <Link href="/torneios" className="underline">entrar em campeonatos</Link> e <Link href="/times/novo" className="underline">criar o seu time</Link>.</Alert>
      </div>
    );
  }
  return (
    <div className="space-y-8">
      <Suspense fallback={null}><Flash /></Suspense>
      <PageTitle title="Painel do organizador" subtitle={isAdmin ? "Como administrador você vê e gerencia todas as organizações e campeonatos da plataforma." : "Crie campeonatos, gerencie inscrições, chaves, resultados e premiações."} actions={canCreate && orgs.length ? <ButtonLink href="/organizar/novo">Novo campeonato</ButtonLink> : null} />
      {orgs.length === 0 ? (
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
            <h2 className="mb-3 font-bold">{isAdmin ? "Todas as organizações" : "Suas organizações"}</h2>
            <div className="grid gap-4 md:grid-cols-2">
              {orgs.map((o) => {
                // o admin da plataforma pode tudo em qualquer organização, mesmo naquelas de que também é membro (dono, admin ou equipe)
                const canEdit = canCreate && (isAdmin || o.role === "OWNER" || o.role === "ADMIN");
                const canDelete = canCreate && (isAdmin || o.role === "OWNER");
                return (
                  <Card key={o.id} className="space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="truncate font-bold">{o.name}</h3>
                        {o.description && <p className="mt-0.5 line-clamp-2 text-xs text-muted">{o.description}</p>}
                      </div>
                      <Badge tone="brand">{{ OWNER: "Dono", ADMIN: "Admin", STAFF: "Equipe", PLATFORM: "Admin da plataforma" }[o.role]}</Badge>
                    </div>
                    {canEdit && (
                      <details className="border-t border-line-soft pt-3">
                        <summary className="cursor-pointer text-sm text-brand-soft">Editar organização</summary>
                        <ActionForm action={updateOrgAction} className="mt-3 space-y-3" submit="Salvar alterações" submitClassName="">
                          <input type="hidden" name="orgId" value={o.id} />
                          <Field label="Nome" htmlFor={`n-${o.id}`}><Input id={`n-${o.id}`} name="name" required minLength={3} maxLength={60} defaultValue={o.name} /></Field>
                          <Field label="Descrição (opcional)" htmlFor={`d-${o.id}`}><Textarea id={`d-${o.id}`} name="description" maxLength={500} rows={3} defaultValue={o.description ?? ""} /></Field>
                        </ActionForm>
                      </details>
                    )}
                    {canEdit && (
                      <details className="border-t border-line-soft pt-3">
                        <summary className="cursor-pointer text-sm text-brand-soft">Adicionar membro</summary>
                        <ActionForm action={addOrgMemberAction} className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto]" submit="Adicionar" submitClassName="">
                          <input type="hidden" name="orgId" value={o.id} />
                          <Field label="Usuário" htmlFor={`u-${o.id}`}><Input id={`u-${o.id}`} name="username" required placeholder="usuario" /></Field>
                          <Field label="Função" htmlFor={`r-${o.id}`}><Select id={`r-${o.id}`} name="role"><option value="STAFF">Equipe (opera partidas)</option><option value="ADMIN">Admin</option></Select></Field>
                        </ActionForm>
                      </details>
                    )}
                    {canEdit && (
                      <details className="border-t border-line-soft pt-3">
                        <summary className="cursor-pointer text-sm text-brand-soft">Remover membro</summary>
                        <ActionForm action={removeOrgMemberAction} className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto]" submit="Remover" submitVariant="danger" submitClassName="" confirm="Remover esta pessoa da organização? Ela perde o acesso aos campeonatos agora.">
                          <input type="hidden" name="orgId" value={o.id} />
                          <Field label="Quem sai da organização (@login)" htmlFor={`rm-${o.id}`}><Input id={`rm-${o.id}`} name="username" required placeholder="login da pessoa" /></Field>
                        </ActionForm>
                      </details>
                    )}
                    {canDelete && (
                      <details className="border-t border-line-soft pt-3">
                        <summary className="cursor-pointer text-sm text-danger">Excluir organização…</summary>
                        <div className="mt-3 space-y-3">
                          <p className="text-xs text-muted">A organização some das listas e ninguém mais a gerencia; o histórico dos campeonatos já encerrados permanece. Não dá para excluir com campeonato aberto ou em andamento, nem com premiação a pagar.</p>
                          <ActionForm action={deleteOrgAction} className="space-y-3" submit="Excluir organização" submitVariant="danger" submitClassName="" confirm={`Excluir a organização ${o.name}? Esta ação não pode ser desfeita pela interface.`}>
                            <input type="hidden" name="orgId" value={o.id} />
                            <Field label={`Para confirmar, digite o nome: ${o.name}`} htmlFor={`x-${o.id}`}><Input id={`x-${o.id}`} name="confirmName" required autoComplete="off" placeholder={o.name} /></Field>
                          </ActionForm>
                        </div>
                      </details>
                    )}
                  </Card>
                );
              })}
            </div>
            {canCreate && (
              <details className="mt-4"><summary className="cursor-pointer text-sm text-brand-soft">Criar outra organização</summary>
                <Card className="mt-3 max-w-lg">
                  <ActionForm action={createOrgAction} submit="Criar organização">
                    <Field label="Nome" htmlFor="name2"><Input id="name2" name="name" required minLength={3} maxLength={60} /></Field>
                    <Field label="Descrição (opcional)" htmlFor="description2"><Input id="description2" name="description" maxLength={500} /></Field>
                  </ActionForm>
                </Card>
              </details>
            )}
          </section>
          <section>
            <h2 className="mb-3 font-bold">Campeonatos</h2>
            {tournaments.length === 0 ? (
              <Empty title="Nenhum campeonato ainda">{canCreate ? <Link href="/organizar/novo" className="text-brand-soft hover:underline">Criar o primeiro</Link> : "Quando a organização tiver campeonatos, eles aparecem aqui."}</Empty>
            ) : (
              <Table tableClassName="min-w-0 sm:min-w-[32rem]">
                <thead><tr><Th>Campeonato</Th><Th className="hidden sm:table-cell">Jogo</Th><Th className="hidden sm:table-cell">Início</Th><Th>Inscritos</Th><Th>Situação</Th></tr></thead>
                <tbody>
                  {tournaments.map((t) => (
                    <tr key={t.id}>
                      <Td><Link href={`/organizar/${t.id}`} className="font-semibold hover:text-brand-soft">{t.name}</Link><span className="block text-xs text-muted">{t.org.name}</span><span className="block text-xs text-muted sm:hidden">{getGame(t.gameId)?.abbr} · {formatDateTime(t.startsAt)}</span></Td>
                      <Td className="hidden sm:table-cell">{(() => { const g = getGame(t.gameId); return g ? <span className="inline-flex items-center gap-2"><GameBadge game={g} size="sm" />{g.abbr}</span> : null; })()}</Td>
                      <Td className="hidden text-muted sm:table-cell">{formatDateTime(t.startsAt)}</Td>
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
