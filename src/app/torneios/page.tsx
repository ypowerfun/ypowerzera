import type { Metadata } from "next";
import Link from "next/link";
import { GAMES } from "@/games";
import { listPublicTournaments, type ListFilters } from "@/server/queries";
import { TournamentCard } from "@/components/tournament-card";
import { ButtonLink, Empty, Input, PageTitle, Select, buttonClass, cx } from "@/components/ui";

export const metadata: Metadata = { title: "Torneios" };
export const dynamic = "force-dynamic";

export default async function TournamentsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const filters: ListFilters = {
    gameId: sp.jogo || undefined,
    status: (["abertos", "andamento", "encerrados"].includes(sp.status ?? "") ? sp.status : undefined) as ListFilters["status"],
    fee: (["gratis", "pago"].includes(sp.taxa ?? "") ? sp.taxa : undefined) as ListFilters["fee"],
    q: sp.q?.slice(0, 60) || undefined,
    page: Number(sp.pagina) || 1,
  };
  const { items, total, page, pages } = await listPublicTournaments(filters);
  const qs = (over: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ jogo: sp.jogo, status: sp.status, taxa: sp.taxa, q: sp.q, ...over })) if (v) p.set(k, v);
    const s = p.toString();
    return s ? `?${s}` : "";
  };
  return (
    <>
      <PageTitle title="Torneios" subtitle={`${total} campeonato${total === 1 ? "" : "s"} encontrado${total === 1 ? "" : "s"}.`} actions={<ButtonLink href="/organizar/novo" variant="secondary">Criar campeonato</ButtonLink>} />
      <form className="mb-6 grid gap-3 rounded-xl border border-line bg-surface/70 p-4 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1fr_auto]" role="search">
        <Input name="q" placeholder="Buscar por nome" defaultValue={sp.q} aria-label="Buscar por nome" />
        <Select name="jogo" defaultValue={sp.jogo ?? ""} aria-label="Jogo">
          <option value="">Todos os jogos</option>
          {GAMES.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
        </Select>
        <Select name="status" defaultValue={sp.status ?? ""} aria-label="Situação">
          <option value="">Qualquer situação</option>
          <option value="abertos">Inscrições abertas</option>
          <option value="andamento">Em andamento</option>
          <option value="encerrados">Encerrados</option>
        </Select>
        <Select name="taxa" defaultValue={sp.taxa ?? ""} aria-label="Taxa">
          <option value="">Grátis ou pago</option>
          <option value="gratis">Grátis</option>
          <option value="pago">Com taxa de inscrição</option>
        </Select>
        <button className={buttonClass("primary")}>Filtrar</button>
      </form>
      {items.length ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">{items.map((t) => <TournamentCard key={t.id} t={t} count={t._count.participants} orgName={t.org.name} />)}</div>
      ) : (
        <Empty title="Nenhum campeonato encontrado">Tente outros filtros ou <Link href="/organizar/novo" className="text-brand-soft hover:underline">crie o seu</Link>.</Empty>
      )}
      {pages > 1 && (
        <nav className="mt-8 flex items-center justify-center gap-2" aria-label="Paginação">
          {Array.from({ length: pages }, (_, i) => i + 1).map((n) => (
            <Link key={n} href={`/torneios${qs({ pagina: String(n) })}`} aria-current={n === page ? "page" : undefined} className={cx("rounded-lg border px-3 py-1.5 text-sm", n === page ? "border-brand bg-brand/20 text-brand-soft" : "border-line text-muted hover:text-ink")}>{n}</Link>
          ))}
        </nav>
      )}
    </>
  );
}
