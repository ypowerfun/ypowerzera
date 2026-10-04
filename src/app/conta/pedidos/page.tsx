import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Empty, PageTitle, Table, Td, Th } from "@/components/ui";
import { formatDateTime } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { ordersOfUser } from "@/server/orders";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "Meus pedidos" };
export const dynamic = "force-dynamic";

const tone = { PENDING: "warn", PAID: "ok", FAILED: "danger", CANCELED: "neutral", EXPIRED: "neutral", REFUNDED: "accent", PARTIALLY_REFUNDED: "accent" } as const;
const label = { PENDING: "Aguardando", PAID: "Pago", FAILED: "Falhou", CANCELED: "Cancelado", EXPIRED: "Expirado", REFUNDED: "Reembolsado", PARTIALLY_REFUNDED: "Reembolso parcial" } as const;

export default async function OrdersPage() {
  const user = await requireUser("/conta/pedidos");
  const orders = await ordersOfUser(user.id);
  return (
    <>
      <PageTitle title="Meus pedidos" subtitle="Inscrições pagas em campeonatos." />
      {orders.length === 0 ? (
        <Empty title="Nenhum pedido ainda" />
      ) : (
        <Table>
          <thead><tr><Th>Pedido</Th><Th>Campeonato</Th><Th>Data</Th><Th>Total</Th><Th>Situação</Th></tr></thead>
          <tbody>
            {orders.map((o) => (
              <tr key={o.id}>
                <Td className="font-mono text-xs">{o.status === "PENDING" ? <Link href={`/checkout/${o.id}`} className="text-brand-soft hover:underline">{o.number}</Link> : o.number}</Td>
                <Td><Link href={`/torneios/${o.tournament.slug}`} className="hover:text-brand-soft">{o.tournament.name}</Link></Td>
                <Td className="text-muted">{formatDateTime(o.createdAt)}</Td>
                <Td className="font-semibold">{formatMoney(o.totalCents, o.currency)}{o.refundedCents > 0 && <span className="block text-xs text-accent">reembolsado {formatMoney(o.refundedCents, o.currency)}</span>}</Td>
                <Td><Badge tone={tone[o.status]}>{label[o.status]}</Badge></Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}
