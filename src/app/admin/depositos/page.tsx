import type { Metadata } from "next";
import { resolveHeldDepositAction } from "@/app/actions/admin";
import { ActionForm } from "@/components/action-form";
import { Alert, Card, Empty, Input, PageTitle } from "@/components/ui";
import { db } from "@/lib/db";
import { formatDateTime } from "@/lib/dates";
import { formatMoney } from "@/lib/money";

export const metadata: Metadata = { title: "Admin · Depósitos retidos", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function AdminDeposits() {
  const rows = await db.deposit.findMany({ where: { status: "HELD" }, orderBy: { createdAt: "asc" } });
  const teams = await db.team.findMany({ where: { id: { in: rows.map((d) => d.teamId) } } });
  const users = await db.user.findMany({ where: { id: { in: rows.map((d) => d.userId) } }, select: { id: true, username: true } });
  return (
    <div className="space-y-4">
      <PageTitle title="Depósitos retidos" subtitle="Pix recebido que não pôde ser creditado automaticamente (CPF do pagador diferente do titular, valor divergente...)." />
      <Alert>Para devolver ao pagador, faça a devolução no painel do provedor Pix e depois marque como “devolvido” aqui.</Alert>
      {rows.length === 0 ? <Empty title="Nenhum depósito retido" /> : rows.map((d) => (
        <Card key={d.id} className="space-y-3">
          <p className="font-bold">{formatMoney(d.amountCents)} <span className="text-sm font-normal text-muted">· {teams.find((t) => t.id === d.teamId)?.name} · @{users.find((u) => u.id === d.userId)?.username} · {formatDateTime(d.createdAt)}</span></p>
          <Alert tone="warn">{d.holdReason}</Alert>
          <div className="flex flex-wrap gap-3">
            <ActionForm action={resolveHeldDepositAction} className="flex flex-wrap items-end gap-2" submit="Creditar na carteira" submitClassName=""><input type="hidden" name="depositId" value={d.id} /><input type="hidden" name="decision" value="credit" /><Input name="note" required minLength={5} placeholder="Por que é seguro creditar" className="w-72" /></ActionForm>
            <ActionForm action={resolveHeldDepositAction} className="flex flex-wrap items-end gap-2" submit="Marcar como devolvido" submitVariant="danger" submitClassName=""><input type="hidden" name="depositId" value={d.id} /><input type="hidden" name="decision" value="refund" /><Input name="note" required minLength={5} placeholder="Comprovante da devolução" className="w-64" /></ActionForm>
          </div>
        </Card>
      ))}
    </div>
  );
}
