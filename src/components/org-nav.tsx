import Link from "next/link";
import { cx } from "./ui";

const items = [
  ["", "Visão geral"],
  ["/participantes", "Participantes"],
  ["/fases", "Fases"],
  ["/partidas", "Partidas"],
  ["/financeiro", "Financeiro"],
  ["/configuracoes", "Configurações"],
] as const;

export function OrgNav({ id, active }: { id: string; active: string }) {
  return (
    <nav className="mb-6 flex gap-1 overflow-x-auto border-b border-line" aria-label="Gestão do campeonato">
      {items.map(([path, label]) => (
        <Link key={path} href={`/organizar/${id}${path}`} aria-current={active === path ? "page" : undefined} className={cx("whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-semibold", active === path ? "border-brand text-brand-soft" : "border-transparent text-muted hover:text-ink")}>
          {label}
        </Link>
      ))}
    </nav>
  );
}
