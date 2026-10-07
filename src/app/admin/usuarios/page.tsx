import { flatParams } from "@/lib/url";
import type { Metadata } from "next";
import Link from "next/link";
import type { Role } from "@prisma/client";
import { setUserBanAction, setUserRoleAction } from "@/app/actions/admin";
import { ActionForm } from "@/components/action-form";
import { Badge, Empty, Input, PageTitle, Select, Table, Td, Th, buttonClass } from "@/components/ui";
import { formatDate } from "@/lib/dates";
import { requireAdmin, toActor } from "@/server/session";
import { ROLE_LABELS, listUsers } from "@/server/users-admin";

export const metadata: Metadata = { title: "Admin · Usuários", robots: { index: false } };
export const dynamic = "force-dynamic";

const parseRole = (v?: string): Role | undefined => (v === "USER" || v === "ORGANIZER" || v === "ADMIN" ? v : undefined);

export default async function AdminUsers({ searchParams }: { searchParams: Promise<{ q?: string; role?: string; page?: string }> }) {
  const sp = flatParams(await searchParams);
  const me = await requireAdmin();
  const { users, total, page, pages } = await listUsers(toActor(me), { q: sp.q, role: parseRole(sp.role), page: Number(sp.page) || 1 });
  const qs = (p: number) => {
    const u = new URLSearchParams();
    if (sp.q) u.set("q", sp.q);
    if (sp.role) u.set("role", sp.role);
    if (p > 1) u.set("page", String(p));
    const s = u.toString();
    return `/admin/usuarios${s ? `?${s}` : ""}`;
  };
  const back = qs(page);
  return (
    <div className="space-y-5">
      <PageTitle title="Usuários e cargos" subtitle="Jogador (padrão), Organizador (cria organizações e campeonatos) e Administrador (acesso total). Aqui você promove um jogador a organizador ou o devolve a jogador." />
      <form method="get" className="flex flex-wrap items-end gap-2">
        <Input name="q" defaultValue={sp.q ?? ""} placeholder="Buscar por nome, usuário ou e-mail" aria-label="Buscar usuário" className="w-full sm:w-80" />
        <Select name="role" defaultValue={sp.role ?? ""} aria-label="Filtrar por cargo" className="w-full sm:w-48">
          <option value="">Todos os cargos</option>
          <option value="USER">Jogadores</option>
          <option value="ORGANIZER">Organizadores</option>
          <option value="ADMIN">Administradores</option>
        </Select>
        <button className={buttonClass("secondary")}>Filtrar</button>
      </form>
      <p className="text-sm text-muted">{total} usuário(s){sp.q || sp.role ? " encontrado(s)" : ""}.</p>
      {users.length === 0 ? (
        <Empty title="Nenhum usuário encontrado" />
      ) : (
        <Table>
          <thead><tr><Th>Usuário</Th><Th>Cargo</Th><Th className="text-right">Times que lidera</Th><Th className="text-right">Organizações</Th><Th>Cadastro</Th><Th>Ação</Th></tr></thead>
          <tbody>
            {users.map((u) => {
              const isAdmin = u.effectiveRole === "ADMIN";
              const toOrganizer = u.role === "USER";
              return (
                <tr key={u.id}>
                  <Td>
                    <b>{u.displayName}</b> <span className="text-xs text-muted">@{u.username}</span>
                    <span className="block text-xs text-muted">{u.email}{u.emailVerifiedAt ? "" : " · e-mail não verificado"}{u.bannedAt ? " · suspenso" : ""}</span>
                  </Td>
                  <Td><Badge tone={isAdmin ? "brand" : u.role === "ORGANIZER" ? "accent" : "neutral"}>{ROLE_LABELS[u.effectiveRole]}</Badge></Td>
                  <Td className="text-right tabular-nums">{u.teamsLed || "—"}</Td>
                  <Td className="text-right tabular-nums">{u.orgsManaged || "—"}</Td>
                  <Td className="whitespace-nowrap text-muted">{formatDate(u.createdAt)}</Td>
                  <Td>
                    {u.id === me.id ? (
                      <span className="text-xs text-muted">você</span>
                    ) : isAdmin ? (
                      <span className="text-xs text-muted">—</span>
                    ) : (
                      <>
                      <ActionForm
                        action={setUserRoleAction}
                        className=""
                        submit={toOrganizer ? "Tornar organizador" : "Voltar para jogador"}
                        submitVariant={toOrganizer ? "primary" : "secondary"}
                        submitClassName="whitespace-nowrap px-3 py-1.5 text-xs"
                        confirm={toOrganizer ? `Tornar ${u.displayName} organizador? Ele poderá criar organizações e campeonatos.` : `Voltar ${u.displayName} para jogador? Ele perde a gestão das organizações e dos campeonatos dele (você, como admin, continua podendo geri-los). Os times dele não mudam.`}
                      >
                        <input type="hidden" name="userId" value={u.id} />
                        <input type="hidden" name="role" value={toOrganizer ? "ORGANIZER" : "USER"} />
                        <input type="hidden" name="back" value={back} />
                      </ActionForm>
                      <details className="mt-2">
                        <summary className="cursor-pointer text-xs text-danger">{u.bannedAt ? "Reativar conta…" : "Suspender conta…"}</summary>
                        <ActionForm
                          action={setUserBanAction}
                          className="mt-2 space-y-2"
                          submit={u.bannedAt ? "Reativar" : "Suspender"}
                          submitVariant={u.bannedAt ? "secondary" : "danger"}
                          submitClassName="px-3 py-1.5 text-xs"
                          confirm={u.bannedAt ? `Reativar a conta de ${u.displayName}?` : `Suspender a conta de ${u.displayName}? Ela é desconectada agora e não consegue mais entrar nem se inscrever.`}
                        >
                          <input type="hidden" name="userId" value={u.id} />
                          <input type="hidden" name="ban" value={u.bannedAt ? "0" : "1"} />
                          <input type="hidden" name="back" value={back} />
                          {!u.bannedAt && <Input name="reason" required minLength={5} maxLength={300} placeholder="Motivo (fica registrado)" aria-label={`Motivo da suspensão de ${u.displayName}`} />}
                        </ActionForm>
                      </details>
                      </>
                    )}
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
      {pages > 1 && (
        <nav aria-label="Páginas" className="flex items-center justify-between text-sm">
          {page > 1 ? <Link href={qs(page - 1)} className="text-brand-soft hover:underline">← Anterior</Link> : <span />}
          <span className="text-muted">Página {page} de {pages}</span>
          {page < pages ? <Link href={qs(page + 1)} className="text-brand-soft hover:underline">Próxima →</Link> : <span />}
        </nav>
      )}
    </div>
  );
}
