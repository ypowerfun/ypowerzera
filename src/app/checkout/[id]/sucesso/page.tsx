import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Alert, ButtonLink, Card } from "@/components/ui";
import { formatMoney } from "@/lib/money";
import { getOrderForUser } from "@/server/orders";
import { requireUser, toActor } from "@/server/session";

export const metadata: Metadata = { title: "Pagamento", robots: { index: false } };
export const dynamic = "force-dynamic";

export default async function SuccessPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser(`/checkout/${id}/sucesso`);
  const order = await getOrderForUser(toActor(user), id).catch(() => null);
  if (!order) notFound();
  const paid = order.status === "PAID" || order.status === "REFUNDED" || order.status === "PARTIALLY_REFUNDED";
  return (
    <div className="mx-auto max-w-md">
      {!paid && <meta httpEquiv="refresh" content="4" />}
      <Card className="space-y-4 p-7 text-center">
        <h1 className="text-2xl font-extrabold">{paid ? "Pagamento confirmado!" : "Processando pagamento…"}</h1>
        {paid ? <Alert tone="ok">Sua inscrição em <b>{order.tournament.name}</b> está confirmada. Total pago: {formatMoney(order.totalCents, order.currency)}.</Alert> : <Alert>Estamos aguardando a confirmação do banco. Esta página atualiza sozinha (Pix pode levar alguns instantes).</Alert>}
        <p className="text-xs text-muted">Pedido {order.number}</p>
        <ButtonLink href={`/torneios/${order.tournament.slug}`}>Ir para o campeonato</ButtonLink>
      </Card>
    </div>
  );
}
