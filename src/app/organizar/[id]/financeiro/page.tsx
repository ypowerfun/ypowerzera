import type { Metadata } from "next";
import { createCouponAction, prizePaidAction, refundAction } from "@/app/actions/organizer";
import { ActionForm } from "@/components/action-form";
import { OrgNav } from "@/components/org-nav";
import { Alert, Badge, Card, Empty, Field, Input, PageTitle, Stat, Table, Td, Th } from "@/components/ui";
import { formatDateTime } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { financials } from "@/server/organizer";
import { loadManaged } from "@/server/organizer-page";

export const metadata: Metadata = { title: "Financeiro", robots: { index: false } };
export const dynamic = "force-dynamic";

const tone = { PENDING: "warn", PAID: "ok", FAILED: "danger", CANCELED: "neutral", EXPIRED: "neutral", REFUNDED: "accent", PARTIALLY_REFUNDED: "accent" } as const;

export default async function FinancePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { t, admin } = await loadManaged(id);
  const f = await financials(id);
  return (
    <div className="space-y-8">
      <div>
        <PageTitle title="Financeiro" subtitle="Inscrições pagas, cupons e premiações." />
        <OrgNav id={id} active="/financeiro" />
      </div>
      <section className="grid gap-4 sm:grid-cols-4">
        <Stat label="Arrecadado (líquido de cupons)" value={formatMoney(f.gross)} tone="ok" hint={`${f.paidCount} pedido(s) pagos`} />
        <Stat label="Reembolsado" value={formatMoney(f.refunded)} />
        <Stat label="Taxa de serviço (plataforma)" value={formatMoney(f.fees)} hint="paga pelo jogador, não sai da sua receita" />
        <Stat label="Premiação definida" value={formatMoney(t.prizePoolCents)} tone="brand" />
      </section>

      <section>
        <h2 className="mb-3 font-bold">Premiações</h2>
        {f.prizes.length === 0 ? <Empty title="As premiações são calculadas quando o campeonato termina" /> : (
          <Table>
            <thead><tr><Th>Colocação</Th><Th>Participante</Th><Th>Valor</Th><Th>Situação</Th><Th /></tr></thead>
            <tbody>
              {f.prizes.map((p) => (
                <tr key={p.id}>
                  <Td className="font-bold">{p.placement}º · {p.label}</Td><Td>{p.participant.name}</Td><Td className="font-semibold">{formatMoney(p.amountCents)}</Td>
                  <Td><Badge tone={p.status === "PAID" ? "ok" : "warn"}>{p.status === "PAID" ? "paga" : "a pagar"}</Badge>{p.note && <span className="block text-xs text-muted">{p.note}</span>}</Td>
                  <Td>{p.status === "PENDING" && admin && <ActionForm action={prizePaidAction} className="flex gap-1" submit="Marcar como paga" submitVariant="secondary" submitClassName="px-2 py-1 text-xs"><input type="hidden" name="tournamentId" value={id} /><input type="hidden" name="awardId" value={p.id} /><Input name="note" placeholder="comprovante/obs." className="w-40 px-2 py-1" /></ActionForm>}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        <p className="mt-2 text-xs text-muted">A plataforma registra quem tem direito ao prêmio; o pagamento da premiação é feito pela organização.</p>
      </section>

      {t.entryFeeCents > 0 && admin && (
        <section className="grid gap-6 lg:grid-cols-2">
          <Card>
            <h2 className="mb-3 font-bold">Novo cupom</h2>
            <ActionForm action={createCouponAction} className="grid gap-3 sm:grid-cols-2" submit="Criar cupom" submitClassName="sm:col-span-2">
              <input type="hidden" name="tournamentId" value={id} /><input type="hidden" name="orgId" value={t.orgId} />
              <Field label="Código" htmlFor="code"><Input id="code" name="code" required placeholder="AMIGOS20" className="uppercase" /></Field>
              <Field label="Limite de usos" htmlFor="max"><Input id="max" name="max" type="number" min={1} /></Field>
              <Field label="Desconto (%)" htmlFor="percent"><Input id="percent" name="percent" type="number" min={1} max={100} /></Field>
              <Field label="ou desconto fixo (R$)" htmlFor="amount"><Input id="amount" name="amount" inputMode="decimal" /></Field>
            </ActionForm>
          </Card>
          <Card>
            <h2 className="mb-3 font-bold">Cupons</h2>
            {f.coupons.length === 0 ? <p className="text-sm text-muted">Nenhum cupom.</p> : <ul className="space-y-2 text-sm">{f.coupons.map((c) => <li key={c.id} className="flex justify-between"><b className="font-mono">{c.code}</b><span className="text-muted">{c.percentOff ? `${c.percentOff}%` : formatMoney(c.amountOffCents ?? 0)} · {c.redeemed}{c.maxRedemptions ? `/${c.maxRedemptions}` : ""} uso(s)</span></li>)}</ul>}
          </Card>
        </section>
      )}

      {t.entryFeeCents > 0 && (
        <section>
          <h2 className="mb-3 font-bold">Pedidos</h2>
          {f.orders.length === 0 ? <Empty title="Nenhum pedido ainda" /> : (
            <Table>
              <thead><tr><Th>Pedido</Th><Th>Jogador</Th><Th>Data</Th><Th>Total</Th><Th>Situação</Th><Th /></tr></thead>
              <tbody>
                {f.orders.map((o) => (
                  <tr key={o.id}>
                    <Td className="font-mono text-xs">{o.number}</Td><Td>{o.user.displayName}<span className="block text-xs text-muted">@{o.user.username}</span></Td><Td className="text-muted">{formatDateTime(o.createdAt)}</Td>
                    <Td className="font-semibold">{formatMoney(o.totalCents, o.currency)}{o.coupon && <span className="block text-xs text-ok">cupom {o.coupon.code}</span>}{o.refundedCents > 0 && <span className="block text-xs text-accent">reemb. {formatMoney(o.refundedCents, o.currency)}</span>}</Td>
                    <Td><Badge tone={tone[o.status]}>{o.status.toLowerCase().replace("_", " ")}</Badge></Td>
                    <Td>{admin && ["PAID", "PARTIALLY_REFUNDED"].includes(o.status) && <details><summary className="cursor-pointer text-xs text-danger">Reembolsar</summary><ActionForm action={refundAction} className="mt-2 flex gap-1" submit="Confirmar" submitVariant="danger" submitClassName="px-2 py-1 text-xs" confirm="Reembolsar o valor restante deste pedido?"><input type="hidden" name="tournamentId" value={id} /><input type="hidden" name="orderId" value={o.id} /><Input name="reason" required minLength={3} placeholder="motivo" className="w-40 px-2 py-1" /></ActionForm></details>}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </section>
      )}
      {t.entryFeeCents === 0 && <Alert>Campeonato gratuito: sem pedidos ou cupons.</Alert>}
    </div>
  );
}
