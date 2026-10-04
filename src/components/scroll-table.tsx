"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { cx } from "@/lib/cx";

/** Contêiner de tabela que rola na horizontal e mostra um esmaecido na borda que ainda tem colunas escondidas. */
export function ScrollTable({ children, className, tableClassName }: { children: ReactNode; className?: string; tableClassName?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: false, end: false });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setEdges({ start: el.scrollLeft > 2, end: el.scrollLeft + el.clientWidth < el.scrollWidth - 2 });
    update();
    el.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : null;
    ro?.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      ro?.disconnect();
    };
  }, []);

  return (
    <div className={cx("relative", className)}>
      <div ref={ref} className="overflow-x-auto rounded-xl border border-line">
        <table className={cx("w-full min-w-[32rem] text-left text-sm", tableClassName)}>{children}</table>
      </div>
      {edges.start && <span aria-hidden className="pointer-events-none absolute inset-y-px left-px w-8 rounded-l-xl bg-gradient-to-r from-bg to-transparent" />}
      {edges.end && <span aria-hidden className="pointer-events-none absolute inset-y-px right-px w-10 rounded-r-xl bg-gradient-to-l from-bg to-transparent" />}
    </div>
  );
}
