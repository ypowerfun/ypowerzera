import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Empty, PageTitle, Table, Td, Th } from "@/components/ui";
import { db } from "@/lib/db";
import { formatDateTime } from "@/lib/dates";
import { STATUS_LABELS } from "@/lib/phases";
import { requireUser } from "@/server/session";

export const metadata: Metadata = { title: "Minhas inscrições" };
export const dynamic = "force-dynamic";

export default async function MyRegistrations() {
  const user = await requireUser("/conta/inscricoes");
  const rows = await db.participant.findMany({ where: { OR: [{ userId: user.id }, { rosterEntries: { some: { userId: user.id } } }] }, include: { tournament: true }, orderBy: { registeredAt: "desc" } });
  return (
    <>
      <PageTitle title="Minhas inscrições" subtitle="Campeonatos em que você está inscrito, como capitão ou integrante do elenco." />
      {rows.length === 0 ? (
        <Empty title="Você ainda não está inscrito em nenhum campeonato"><Link href="/torneios" className="text-brand-soft hover:underline">Ver torneios abertos</Link></Empty>
      ) : (
        <Table>
          <thead><tr><Th>Campeonato</Th><Th>Inscrição</Th><Th>Início</Th><Th>Situação do torneio</Th><Th>Colocação</Th></tr></thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id}>
                <Td><Link href={`/torneios/${p.tournament.slug}`} className="font-semibold hover:text-brand-soft">{p.tournament.name}</Link></Td>
                <Td>{p.name} <Badge tone={p.status === "CHECKED_IN" ? "ok" : p.status === "DISQUALIFIED" ? "danger" : "neutral"}>{p.status.toLowerCase().replace("_", " ")}</Badge></Td>
                <Td className="text-muted">{formatDateTime(p.tournament.startsAt)}</Td>
                <Td>{STATUS_LABELS[p.tournament.status]}</Td>
                <Td className="font-bold">{p.finalPlacement ? `${p.finalPlacement}º` : "—"}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </>
  );
}
