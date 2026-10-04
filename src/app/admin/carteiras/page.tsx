import type { Metadata } from "next";
import { adjustWalletAction, freezeWalletAction, reconcileAction, unfreezeWalletAction } from "@/app/actions/admin";
import { ActionForm } from "@/components/action-form";
import { Badge, Card, Input, PageTitle, Table, Td, Th } from "@/components/ui";
import { db } from "@/lib/db";
import { formatMoney } from "@/lib/money";

export const metadata: Metadata = { title: "Admin · Carteiras", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function AdminWallets() {
  const wallets = await db.wallet.findMany({ orderBy: [{ frozenAt: "desc" }, { balanceCents: "desc" }], take: 60, include: { team: { select: { name: true, tag: true, slug: true } } } });
  const total = wallets.reduce((s, w) => s + w.balanceCents + w.lockedCents, 0);
  return (
    <div className="space-y-6">
      <PageTitle title="Carteiras" subtitle={`${wallets.length} carteira(s) · ${formatMoney(total)} sob custódia (inclui a da plataforma).`} actions={<ActionForm action={reconcileAction} className="" submit="Conciliar" submitVariant="secondary" submitClassName="">{null}</ActionForm>} />
      <Table>
        <thead><tr><Th>Carteira</Th><Th className="text-right">Disponível</Th><Th className="text-right">Custódia</Th><Th className="text-right">Dívida</Th><Th>Situação</Th><Th>Ações</Th></tr></thead>
        <tbody>
          {wallets.map((w) => (
            <tr key={w.id}>
              <Td><b>{w.team ? `[${w.team.tag}] ${w.team.name}` : "Plataforma"}</b></Td>
              <Td className="text-right tabular-nums">{formatMoney(w.balanceCents)}</Td><Td className="text-right tabular-nums">{formatMoney(w.lockedCents)}</Td><Td className="text-right tabular-nums text-danger">{w.debtCents ? formatMoney(w.debtCents) : "—"}</Td>
              <Td>{w.frozenAt ? <><Badge tone="danger">congelada</Badge><span className="block text-xs text-muted">{w.frozenReason}</span></> : <Badge tone="ok">ativa</Badge>}</Td>
              <Td>
                {w.team && (
                  <div className="flex flex-col gap-1.5">
                    {w.frozenAt ? (
                      <ActionForm action={unfreezeWalletAction} className="flex gap-1" submit="Liberar" submitVariant="secondary" submitClassName="px-2 py-1 text-xs"><input type="hidden" name="walletId" value={w.id} /><Input name="note" required minLength={10} placeholder="verificação feita" className="w-44 px-2 py-1" /></ActionForm>
                    ) : (
                      <ActionForm action={freezeWalletAction} className="flex gap-1" submit="Congelar" submitVariant="danger" submitClassName="px-2 py-1 text-xs" confirm="Congelar esta carteira?"><input type="hidden" name="walletId" value={w.id} /><Input name="reason" required minLength={10} placeholder="motivo" className="w-44 px-2 py-1" /></ActionForm>
                    )}
                    <details><summary className="cursor-pointer text-xs text-muted">Ajuste manual</summary>
                      <Card className="mt-2 space-y-2 p-3"><ActionForm action={adjustWalletAction} className="space-y-2" submit="Lançar ajuste" submitVariant="secondary" submitClassName="px-2 py-1 text-xs" confirm="Lançar este ajuste no razão? A operação é auditada e não pode ser apagada."><input type="hidden" name="walletId" value={w.id} /><Input name="cents" type="number" required placeholder="centavos (+/−)" className="w-40 px-2 py-1" /><Input name="note" required minLength={15} placeholder="motivo detalhado" className="w-56 px-2 py-1" /></ActionForm></Card>
                    </details>
                  </div>
                )}
              </Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </div>
  );
}
