import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { devFinishTransferAction, devPayDepositAction, devReverseDepositAction } from "@/app/actions/wallet";
import { ActionForm } from "@/components/action-form";
import { Alert, Card, Empty, PageTitle } from "@/components/ui";
import { db } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { formatMoney } from "@/lib/money";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "Simulador de Pix (dev)", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function DevPix() {
  const env = getEnv();
  if (env.pixProvider !== "mock" || env.isProd) notFound();
  await requireUser("/dev/pix");
  const [deposits, confirmed, withdrawals] = await Promise.all([
    db.deposit.findMany({ where: { status: { in: ["PENDING", "EXPIRED"] } }, orderBy: { createdAt: "desc" }, take: 10 }),
    db.deposit.findMany({ where: { status: "CONFIRMED" }, orderBy: { createdAt: "desc" }, take: 5 }),
    db.withdrawal.findMany({ where: { status: "PROCESSING" }, orderBy: { createdAt: "desc" }, take: 10 }),
  ]);
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageTitle title="Simulador de Pix" subtitle="Só existe em desenvolvimento com PIX_PROVIDER=mock. Os webhooks simulados são ASSINADOS e passam pelo mesmo código de produção." />
      <Alert tone="warn">Nenhum dinheiro real é movimentado.</Alert>
      <Card>
        <h2 className="mb-3 font-bold">Pix aguardando pagamento</h2>
        {deposits.length === 0 ? <Empty title="Nenhum Pix pendente" /> : deposits.map((d) => (
          <div key={d.id} className="flex flex-wrap items-center justify-between gap-3 border-t border-line-soft py-3 first:border-0">
            <span className="text-sm"><b>{formatMoney(d.amountCents)}</b> <span className="text-xs text-muted">{d.id.slice(-8)} · {d.status}</span></span>
            <span className="flex gap-2">
              <ActionForm action={devPayDepositAction} className="" submit="Pagar (CPF do titular)" submitClassName="" ><input type="hidden" name="depositId" value={d.id} /><input type="hidden" name="who" value="owner" /></ActionForm>
              <ActionForm action={devPayDepositAction} className="" submit="Pagar com CPF de terceiro" submitVariant="danger" submitClassName=""><input type="hidden" name="depositId" value={d.id} /><input type="hidden" name="who" value="third" /></ActionForm>
            </span>
          </div>
        ))}
      </Card>
      <Card>
        <h2 className="mb-3 font-bold">Simular estorno (MED/chargeback)</h2>
        {confirmed.length === 0 ? <Empty title="Nenhum depósito creditado" /> : confirmed.map((d) => (
          <div key={d.id} className="flex items-center justify-between gap-3 border-t border-line-soft py-3 first:border-0"><span className="text-sm">{formatMoney(d.amountCents)} <span className="text-xs text-muted">{d.id.slice(-8)}</span></span>
            <ActionForm action={devReverseDepositAction} className="" submit="Estornar" submitVariant="danger" submitClassName=""><input type="hidden" name="depositId" value={d.id} /></ActionForm></div>
        ))}
      </Card>
      <Card>
        <h2 className="mb-3 font-bold">Saques enviados ao banco</h2>
        {withdrawals.length === 0 ? <Empty title="Nenhum saque em processamento"><p>Eles aparecem aqui depois que o job (/api/cron/wallet) envia ao provedor.</p></Empty> : withdrawals.map((w) => (
          <div key={w.id} className="flex flex-wrap items-center justify-between gap-3 border-t border-line-soft py-3 first:border-0"><span className="text-sm">{formatMoney(w.netCents)} · CPF •••{w.destinationCpfLast4}</span>
            <span className="flex gap-2">
              <ActionForm action={devFinishTransferAction} className="" submit="Banco: pago" submitClassName=""><input type="hidden" name="withdrawalId" value={w.id} /><input type="hidden" name="ok" value="1" /></ActionForm>
              <ActionForm action={devFinishTransferAction} className="" submit="Banco: recusou" submitVariant="danger" submitClassName=""><input type="hidden" name="withdrawalId" value={w.id} /><input type="hidden" name="ok" value="0" /></ActionForm>
            </span>
          </div>
        ))}
      </Card>
    </div>
  );
}
