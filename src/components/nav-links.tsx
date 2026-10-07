"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "@/lib/cx";

export interface NavItem {
  href: string;
  label: string;
}

/** Links da navegação principal com a página atual marcada (aria-current + barra vermelha). */
export function NavLinks({ links, variant }: { links: NavItem[]; variant: "desktop" | "mobile" }) {
  const pathname = usePathname();
  return (
    <>
      {links.map((l) => {
        const active = pathname === l.href || pathname.startsWith(`${l.href}/`);
        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={active ? "page" : undefined}
            className={cx(
              "text-sm font-bold uppercase tracking-wider transition focus-ring",
              variant === "desktop" ? "relative rounded-md px-3 py-2" : "whitespace-nowrap rounded-md px-3 py-1.5",
              variant === "desktop" && active && "after:absolute after:inset-x-3 after:-bottom-3 after:h-0.5 after:bg-brand",
              active ? (variant === "desktop" ? "text-ink" : "bg-brand/15 text-ink") : "text-muted hover:text-ink",
            )}
          >
            {l.label}
          </Link>
        );
      })}
    </>
  );
}
