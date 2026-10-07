import { flatParams } from "@/lib/url";
import type { Metadata } from "next";
import Link from "next/link";
import { adminDeleteTeamAction } from "@/app/actions/admin";
import { ActionForm } from "@/components/action-form";
import { Badge, Empty, Input, PageTitle, Table, Td, Th, buttonClass } from "@/components/ui";
import { db } from "@/lib/db";
import { formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { requireAdmin } from "@/server/session";

export const metadata: Metadata = { title: "Admin · Equipes", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function AdminTeams({ searchParams }: { searchParams: Promise<{ q?: string; situacao?: string }> }) {
  const sp = flatParams(await searchParams);
  await requireAdmin();
  const q = (sp.q ?? "").trim().slice(0, 60);
  const situacao = sp.situacao === "excluidas" ? "excluidas" : sp.situacao === "ativas" ? "ativas" : "";
  const teams = await db.team.findMany({
    where: {
      ...(situacao === "excluidas" ? { deletedAt: { not: null } } : situacao === "ativas" ? { deletedAt: null } : {}),
      ...(q ? { OR: [{ name: { contains: q } }, { tag: { contains: q } }, { slug: { contains: q } }] } : {}),
    },
    orderBy: [{ createdAt: "desc" }],
    take: 60,
    include: { wallet: true, owner: { select: { displayName: true, username: true } }, _count: { select: { members: true } } },
  });
  return (
    <div className="space-y-5">
      <PageTitle title="Equipes" subtitle="O administrador pode abrir qualquer equipe (convidar, remover e transferir a capitania) e excluí-la. Excluir congela o saldo: ele só sai depois do pedido de revisão do ex-líder e da sua liberação em “Saldos de times excluídos”." />
      <form method="get" className="flex flex-wrap items-end gap-2">
        <Input name="q" defaultValue={q} placeholder="Buscar por nome, tag ou endereço" aria-label="Buscar equipe" className="w-full sm:w-80" />
        <select name="situacao" defaultValue={situacao} aria-label="Situação" className="w-full rounded-md border border-line bg-bg/70 px-3 py-2.5 text-sm text-ink sm:w-48">
          <option value="">Todas</option>
          <option value="ativas">Ativas</option>
          <option value="excluidas">Excluídas</option>
        </select>
        <button className={buttonClass("secondary")}>Filtrar</button>
      </form>
      {teams.length === 0 ? (
        <Empty title="Nenhuma equipe encontrada" />
      ) : (
        <Table>
          <thead><tr><Th>Equipe</Th><Th>Líder</Th><Th className="text-right">Integrantes</Th><Th className="text-right">Saldo</Th><Th>Situação</Th><Th>Ações</Th></tr></thead>
          <tbody>
            {teams.map((t) => (
              <tr key={t.id}>
                <Td>
                  <Link href={`/times/${t.slug}`} className="font-semibold hover:text-brand-soft">[{t.tag}] {t.name}</Link>
                  <span className="block text-xs text-muted">criada em {formatDate(t.createdAt)}</span>
                </Td>
                <Td>{t.owner.displayName} <span className="text-xs text-muted">@{t.owner.username}</span></Td>
                <Td className="text-right tabular-nums">{t._count.members}</Td>
                <Td className="text-right tabular-nums">{t.wallet ? formatMoney(t.wallet.balanceCents + t.wallet.lockedCents) : "—"}</Td>
                <Td>
                  {t.deletedAt ? (
                    <>
                      <Badge tone="danger">excluída</Badge>
                      <span className="mt-1 block text-xs text-muted">{formatDate(t.deletedAt)} · {t.balanceReleasedAt ? "saldo liberado" : t.wallet && t.wallet.balanceCents > 0 ? "saldo bloqueado" : "sem saldo"}</span>
                    </>
                  ) : (
                    <Badge tone="ok">ativa</Badge>
                  )}
                </Td>
                <Td className="min-w-[14rem]">
                  <div className="flex flex-col gap-1.5">
                    <Link href={`/times/${t.slug}`} className="text-xs text-brand-soft hover:underline">Abrir equipe →</Link>
                    {!t.deletedAt && (
                      <details>
                        <summary className="cursor-pointer text-xs text-danger">Excluir equipe…</summary>
                        <ActionForm action={adminDeleteTeamAction} className="mt-2 space-y-2" submit="Excluir equipe" submitVariant="danger" submitClassName="px-3 py-1.5 text-xs" confirm={`Excluir a equipe [${t.tag}] ${t.name}? O saldo, se houver, fica bloqueado até a revisão.`}>
                          <input type="hidden" name="teamId" value={t.id} />
                          <Input name="reason" required minLength={10} maxLength={300} placeholder="Motivo (obrigatório, mín. 10 caracteres)" aria-label="Motivo da exclusão" className="px-2 py-1" />
                        </ActionForm>
                      </details>
                    )}
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      {teams.length === 60 && <p className="text-xs text-muted">Mostrando as 60 mais recentes: refine a busca para achar outras.</p>}
    </div>
  );
}
