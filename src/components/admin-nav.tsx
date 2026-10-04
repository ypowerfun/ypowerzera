"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ScrollTabs } from "./scroll-tabs";
import { cx } from "./ui";

const LINKS = [["/admin", "Resumo"], ["/admin/kyc", "KYC"], ["/admin/saques", "Saques"], ["/admin/depositos", "Depósitos retidos"], ["/admin/desafios", "Desafios em disputa"], ["/admin/carteiras", "Carteiras e conciliação"]] as const;

export function AdminNav() {
  const pathname = usePathname();
  return (
    <ScrollTabs label="Administração" watch={pathname} fadeFrom="from-surface" wrapperClassName="mb-6 overflow-hidden rounded-xl border border-line bg-surface/70" className="p-1.5">
      {LINKS.map(([href, label]) => {
        const active = href === "/admin" ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link key={href} href={href} aria-current={active ? "page" : undefined} className={cx("whitespace-nowrap rounded-lg border-b-2 px-3 py-2 text-sm font-semibold", active ? "border-gold bg-elevated text-ink" : "border-transparent text-muted hover:bg-elevated hover:text-ink")}>
            {label}
          </Link>
        );
      })}
    </ScrollTabs>
  );
}
