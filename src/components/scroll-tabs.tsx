"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { cx } from "@/lib/cx";

/**
 * Barra de abas que rola na horizontal (celular): ao montar, leva a aba ativa (`aria-current="page"`) para o centro e
 * mostra um esmaecido nas bordas que ainda têm abas escondidas, para ninguém achar que as abas acabaram.
 * `watch` refaz o "levar a aba ativa para a vista" quando muda (ex.: o caminho atual).
 */
export function ScrollTabs({ label, className, wrapperClassName, fadeFrom = "from-bg", watch, children }: { label: string; className?: string; wrapperClassName?: string; fadeFrom?: string; watch?: string; children: ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  const [edges, setEdges] = useState({ start: false, end: false });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setEdges({ start: el.scrollLeft > 2, end: el.scrollLeft + el.clientWidth < el.scrollWidth - 2 });
    const active = el.querySelector<HTMLElement>('[aria-current="page"]');
    if (active) el.scrollLeft = active.offsetLeft - (el.clientWidth - active.offsetWidth) / 2; // só na barra: não rola a página
    update();
    el.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      el.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [watch]);

  return (
    <div className={cx("relative", wrapperClassName)}>
      <nav ref={ref} aria-label={label} className={cx("flex gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden", className)}>
        {children}
      </nav>
      {edges.start && <span aria-hidden className={cx("pointer-events-none absolute inset-y-0 left-0 w-8 bg-gradient-to-r to-transparent", fadeFrom)} />}
      {edges.end && <span aria-hidden className={cx("pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l to-transparent", fadeFrom)} />}
    </div>
  );
}
