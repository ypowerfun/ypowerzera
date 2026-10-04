import type { Metadata } from "next";
import Link from "next/link";
import { reconcileAction } from "@/app/actions/admin";
import { ActionForm } from "@/components/action-form";
import { Card, PageTitle, Stat } from "@/components/ui";
import { formatMoney } from "@/lib/money";
import { adminOverview } from "@/server/admin-wallet";

export const metadata: Metadata = { title: "Admin", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function AdminHome() {
  const o = await adminOverview();
  const items = [
    ["KYC aguardando análise", o.kyc, "/admin/kyc"],
    ["Saques em análise de risco", o.review, "/admin/saques"],
    ["Saques presos (conciliar)", o.processing, "/admin/saques"],
    ["Depósitos retidos", o.held, "/admin/depositos"],
    ["Desafios em disputa", o.disputed, "/admin/desafios"],
    ["Carteiras congeladas", o.frozen, "/admin/carteiras"],
  ] as const;
  return (
    <div className="space-y-6">
      <PageTitle title="Administração" subtitle="Fila de trabalho de segurança e arbitragem." />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {items.map(([label, n, href]) => (
          <Link key={label} href={href} className="focus-ring rounded-xl"><Stat label={label} value={n} tone={n > 0 ? "warn" : "ok"} hint={n > 0 ? "Requer atenção →" : "Em dia"} /></Link>
        ))}
        <Stat label="Receita da plataforma (taxas)" value={formatMoney(o.platformCents)} tone="brand" hint="Carteira da plataforma" />
      </div>
      <Card>
        <h2 className="mb-2 font-bold">Conciliação do razão</h2>
        <p className="mb-3 text-sm text-muted">Confere saldo de cada carteira × lançamentos, a conservação do dinheiro entre carteiras e razão × depósitos/saques. Roda também a cada ciclo do job agendado.</p>
        <ActionForm action={reconcileAction} className="" submit="Rodar conciliação agora" submitClassName="">{null}</ActionForm>
      </Card>
      <Card>
        <h2 className="mb-2 font-bold">Limites em vigor</h2>
        <dl className="grid gap-x-8 gap-y-1 text-sm sm:grid-cols-2">
          {[["Depósito", `${formatMoney(o.limits.depositMinCents)} a ${formatMoney(o.limits.depositMaxCents)}`], ["Saque por pedido", `${formatMoney(o.limits.withdrawMinCents)} a ${formatMoney(o.limits.withdrawMaxCents)}`], ["Saque automático até", formatMoney(o.limits.withdrawAutoApproveMaxCents)], ["Teto diário de saque/equipe", formatMoney(o.limits.withdrawDailyTeamCents)], ["Retenção de depósito", `${o.limits.depositHoldHours} h`], ["Retenção de prêmio", `${o.limits.winHoldHours} h`], ["Aposta", `${formatMoney(o.limits.stakeMinCents)} a ${formatMoney(o.limits.stakeMaxCents)}`], ["Taxa de desafio", `${(o.limits.challengeFeeBps / 100).toFixed(1)}% do pote`]].map(([k, v]) => <div key={k} className="flex justify-between border-b border-line-soft py-1"><dt className="text-muted">{k}</dt><dd className="font-semibold">{v}</dd></div>)}
        </dl>
      </Card>
    </div>
  );
}
