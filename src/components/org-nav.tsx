import Link from "next/link";
import { ScrollTabs } from "./scroll-tabs";
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
    <ScrollTabs label="Gestão do campeonato" wrapperClassName="mb-6" className="border-b border-line">
      {items.map(([path, label]) => (
        <Link key={path} href={`/organizar/${id}${path}`} aria-current={active === path ? "page" : undefined} className={cx("whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-semibold", active === path ? "border-brand text-brand-soft" : "border-transparent text-muted hover:text-ink")}>
          {label}
        </Link>
      ))}
    </ScrollTabs>
  );
}
