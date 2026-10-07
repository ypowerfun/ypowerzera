import type { Metadata } from "next";
import Link from "next/link";
import { reviewBalanceRequestAction } from "@/app/actions/admin";
import { ActionForm } from "@/components/action-form";
import { Alert, Badge, Card, Empty, Input, PageTitle, Stat, Table, Td, Th } from "@/components/ui";
import { db } from "@/lib/db";
import { formatDate, formatDateTime } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { requireAdmin, toActor } from "@/server/session";
import { listReleaseRequests } from "@/server/team-release";

export const metadata: Metadata = { title: "Admin · Saldos de times excluídos", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function AdminBalances() {
  const me = await requireAdmin();
  const actor = toActor(me);
  const [pending, all] = await Promise.all([listReleaseRequests(actor, "PENDING"), listReleaseRequests(actor)]);
  const decided = all.filter((r) => r.status !== "PENDING").slice(0, 15);
  const extras = await Promise.all(
    pending.map(async (r) => {
      const [deposited, prizes, withdrawn, member] = await Promise.all([
        db.deposit.aggregate({ _sum: { amountCents: true }, where: { walletId: r.walletId, status: "CONFIRMED" } }),
        db.ledgerEntry.aggregate({ _sum: { availableDeltaCents: true }, where: { walletId: r.walletId, type: "PRIZE_WIN" } }),
        db.withdrawal.aggregate({ _sum: { netCents: true }, where: { walletId: r.walletId, status: "PAID" } }),
        db.teamMember.findFirst({ where: { teamId: r.teamId, userId: me.id }, select: { id: true } }),
      ]);
      return { deposited: deposited._sum.amountCents ?? 0, prizes: prizes._sum.availableDeltaCents ?? 0, withdrawn: withdrawn._sum.netCents ?? 0, isMember: !!member };
    }),
  );
  return (
    <div className="space-y-8">
      <PageTitle title="Saldos de times excluídos" subtitle="Quando um time é excluído, o saldo fica bloqueado. O ex-líder pede a revisão e você decide: ao aprovar, todo o saldo atual fica liberado para saque (que ainda passa pela verificação de identidade, senha, código por e-mail e a sua liberação do saque)." />
      <section className="space-y-4">
        <h2 className="font-bold">Pedidos em análise ({pending.length})</h2>
        {pending.length === 0 ? (
          <Empty title="Nenhum pedido aguardando" />
        ) : (
          pending.map((r, i) => {
            const x = extras[i];
            return (
              <Card key={r.id} className="space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-lg font-black">[{r.team.tag}] {r.team.name}</p>
                    <p className="text-xs text-muted">Excluído em {r.team.deletedAt ? formatDate(r.team.deletedAt) : "—"} · pedido de {r.requester?.displayName ?? "?"} (@{r.requester?.username ?? "?"}) em {formatDateTime(r.createdAt)}</p>
                  </div>
                  <Badge tone="warn">saldo atual {formatMoney(r.team.wallet?.balanceCents ?? 0)}</Badge>
                </div>
                <blockquote className="border-l-2 border-brand/60 bg-elevated/50 px-4 py-3 text-sm">{r.message}</blockquote>
                <div className="grid gap-3 sm:grid-cols-3">
                  <Stat label="Já depositado" value={formatMoney(x.deposited)} />
                  <Stat label="Prêmios recebidos" value={formatMoney(x.prizes)} />
                  <Stat label="Já sacado" value={formatMoney(x.withdrawn)} />
                </div>
                {(r.team.wallet?.debtCents ?? 0) > 0 && <Alert tone="danger">A carteira tem uma <b>dívida de {formatMoney(r.team.wallet?.debtCents ?? 0)}</b> (estorno de depósito). O sistema não deixa liberar o saldo antes de resolvê-la.</Alert>}
                {r.team.wallet?.frozenAt && r.team.deletedAt && r.team.wallet.frozenAt < r.team.deletedAt && <Alert tone="warn">Esta carteira já estava <b>congelada antes da exclusão</b> ({r.team.wallet.frozenReason ?? "sem motivo registrado"}). Para liberar, descongele-a antes em <Link href="/admin/carteiras" className="underline">Carteiras e conciliação</Link>.</Alert>}
                {x.isMember ? (
                  <Alert tone="warn">Você é membro deste time: outro administrador precisa decidir este pedido.</Alert>
                ) : (
                  <div className="flex flex-wrap items-end gap-3">
                    <ActionForm action={reviewBalanceRequestAction} className="flex flex-wrap items-end gap-2" submit="Liberar saldo para saque" submitClassName="whitespace-nowrap" confirm={`Liberar ${formatMoney(r.team.wallet?.balanceCents ?? 0)} para saque do ex-líder?`}>
                      <input type="hidden" name="requestId" value={r.id} />
                      <input type="hidden" name="decision" value="approve" />
                      <Input name="note" required minLength={10} maxLength={300} placeholder="O que foi conferido (mín. 10 caracteres)" aria-label="Justificativa da liberação" className="w-full sm:w-80" />
                    </ActionForm>
                    <ActionForm action={reviewBalanceRequestAction} className="flex flex-wrap items-end gap-2" submit="Recusar" submitVariant="danger" submitClassName="">
                      <input type="hidden" name="requestId" value={r.id} />
                      <input type="hidden" name="decision" value="reject" />
                      <Input name="note" required minLength={10} maxLength={300} placeholder="Motivo da recusa (o líder verá)" aria-label="Motivo da recusa" className="w-full sm:w-72" />
                    </ActionForm>
                  </div>
                )}
                <p className="text-xs text-muted"><Link href={`/times/${r.team.slug}`} className="text-brand-soft hover:underline">Ver a equipe →</Link></p>
              </Card>
            );
          })
        )}
      </section>
      <section className="space-y-3">
        <h2 className="font-bold">Decisões recentes</h2>
        {decided.length === 0 ? (
          <Empty title="Ainda não há decisões" />
        ) : (
          <Table>
            <thead><tr><Th>Data</Th><Th>Equipe</Th><Th>Resultado</Th><Th className="text-right">Liberado</Th><Th>Decidido por</Th><Th>Justificativa</Th></tr></thead>
            <tbody>
              {decided.map((r) => (
                <tr key={r.id}>
                  <Td className="whitespace-nowrap text-muted">{r.reviewedAt ? formatDateTime(r.reviewedAt) : "—"}</Td>
                  <Td>[{r.team.tag}] {r.team.name}</Td>
                  <Td><Badge tone={r.status === "APPROVED" ? "ok" : "danger"}>{r.status === "APPROVED" ? "Liberado" : "Recusado"}</Badge></Td>
                  <Td className="text-right tabular-nums">{r.releasedCents != null ? formatMoney(r.releasedCents) : "—"}</Td>
                  <Td>{r.reviewer?.displayName ?? "—"}</Td>
                  <Td className="max-w-xs text-xs text-muted">{r.reviewNote}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>
    </div>
  );
}
