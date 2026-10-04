import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { cancelOrderAction, mockPayAction, startCheckoutAction } from "@/app/actions/tournament";
import { ActionForm } from "@/components/action-form";
import { Alert, Badge, Card, Field, Input, PageTitle } from "@/components/ui";
import { getEnv } from "@/lib/env";
import { formatDateTime } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { getOrderForUser } from "@/server/orders";
import { requireUser, toActor } from "@/server/session";

export const metadata: Metadata = { title: "Pagamento", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function CheckoutPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser(`/checkout/${id}`);
  const order = await getOrderForUser(toActor(user), id).catch(() => null);
  if (!order) notFound();
  if (order.status === "PAID") redirect(`/checkout/${id}/sucesso`);
  const expired = order.status !== "PENDING" || order.expiresAt < new Date();
  const env = getEnv();
  const mock = env.paymentsProvider === "mock";
  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <PageTitle title="Pagamento da inscrição" subtitle={`Pedido ${order.number}`} />
      <Card className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div><p className="font-bold">{order.tournament.name}</p><p className="text-xs text-muted">Inicia em {formatDateTime(order.tournament.startsAt)}</p></div>
          <Badge tone={expired ? "danger" : "warn"}>{expired ? "Expirado" : "Aguardando pagamento"}</Badge>
        </div>
        <dl className="space-y-1.5 border-t border-line pt-3 text-sm">
          <div className="flex justify-between"><dt className="text-muted">Inscrição</dt><dd>{formatMoney(order.subtotalCents, order.currency)}</dd></div>
          {order.discountCents > 0 && <div className="flex justify-between text-ok"><dt>Cupom {order.coupon?.code}</dt><dd>− {formatMoney(order.discountCents, order.currency)}</dd></div>}
          <div className="flex justify-between"><dt className="text-muted">Taxa de serviço</dt><dd>{formatMoney(order.serviceFeeCents, order.currency)}</dd></div>
          <div className="flex justify-between border-t border-line pt-2 text-lg font-extrabold"><dt>Total</dt><dd>{formatMoney(order.totalCents, order.currency)}</dd></div>
        </dl>
        {!expired && <p className="text-xs text-muted">Vaga reservada até {formatDateTime(order.expiresAt)}.</p>}
      </Card>

      {expired ? (
        <Alert tone="warn">Este pedido não está mais disponível. <Link href={`/torneios/${order.tournament.slug}`} className="underline">Voltar ao campeonato</Link> e refazer a inscrição.</Alert>
      ) : mock ? (
        <>
          <Alert tone="warn"><b>Ambiente de testes:</b> o pagamento é simulado e nenhum dinheiro é cobrado. Cartão aprovado: 4242 4242 4242 4242 · recusado: 4000 0000 0000 0002.</Alert>
          <Card>
            <h2 className="mb-3 font-bold">Cartão (simulado)</h2>
            <ActionForm action={mockPayAction} submit={`Pagar ${formatMoney(order.totalCents, order.currency)}`}>
              <input type="hidden" name="orderId" value={order.id} />
              <input type="hidden" name="method" value="card" />
              <Field label="Número do cartão" htmlFor="card"><Input id="card" name="card" inputMode="numeric" autoComplete="off" placeholder="4242 4242 4242 4242" required /></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Validade" htmlFor="exp"><Input id="exp" name="exp" placeholder="12/30" autoComplete="off" /></Field>
                <Field label="CVV" htmlFor="cvv"><Input id="cvv" name="cvv" inputMode="numeric" placeholder="123" autoComplete="off" /></Field>
              </div>
            </ActionForm>
          </Card>
          <Card>
            <h2 className="mb-1 font-bold">Pix (simulado)</h2>
            <p className="mb-3 text-sm text-muted">Simula o pagamento de um Pix de {formatMoney(order.totalCents, order.currency)}.</p>
            <ActionForm action={mockPayAction} submit="Simular pagamento do Pix" submitVariant="accent">
              <input type="hidden" name="orderId" value={order.id} />
              <input type="hidden" name="method" value="pix" />
            </ActionForm>
          </Card>
        </>
      ) : (
        <Card>
          <ActionForm action={startCheckoutAction} submit={`Pagar ${formatMoney(order.totalCents, order.currency)} (cartão ou Pix)`}>
            <input type="hidden" name="orderId" value={order.id} />
            <p className="text-sm text-muted">Você será levado ao ambiente seguro do provedor de pagamento. Nós nunca vemos nem guardamos os dados do seu cartão.</p>
          </ActionForm>
        </Card>
      )}

      {!expired && (
        <ActionForm action={cancelOrderAction} className="text-center" submit="Cancelar e liberar a vaga" submitVariant="ghost" submitClassName="">
          <input type="hidden" name="orderId" value={order.id} />
        </ActionForm>
      )}
    </div>
  );
}
