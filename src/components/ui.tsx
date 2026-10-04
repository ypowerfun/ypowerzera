import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { cx } from "@/lib/cx";
import { ScrollTable } from "./scroll-table";

export { cx };

const btnBase =
  "inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition focus-ring disabled:opacity-50 disabled:cursor-not-allowed";
const btnVariants = {
  primary: "bg-gradient-to-b from-brand-strong to-[#0d4bbf] text-white border border-brand-soft/40 shadow-glow hover:brightness-110",
  gold: "bg-gradient-to-b from-[#ffd56e] to-gold-strong text-[#1b1203] border border-[#ffe19a]/60 shadow-gold hover:brightness-105",
  secondary: "bg-elevated text-ink border border-line hover:border-brand-soft/60 hover:bg-[#12204a]",
  ghost: "text-muted hover:text-ink hover:bg-elevated",
  danger: "bg-danger/15 text-danger border border-danger/40 hover:bg-danger/25",
  accent: "bg-accent/15 text-accent border border-accent/40 hover:bg-accent/25",
} as const;

export function buttonClass(variant: keyof typeof btnVariants = "primary", extra = "") {
  return cx(btnBase, btnVariants[variant], extra);
}

export function ButtonLink({ href, variant = "primary", className, children, ...rest }: { href: string; variant?: keyof typeof btnVariants } & Omit<ComponentProps<typeof Link>, "href">) {
  return (
    <Link href={href} className={buttonClass(variant, className)} {...rest}>
      {children}
    </Link>
  );
}

export function Card({ className, children, ...rest }: ComponentProps<"div">) {
  return (
    <div className={cx("rounded-xl border border-line bg-surface/80 p-5 shadow-[inset_0_1px_0_rgb(255_255_255/0.04)] backdrop-blur", className)} {...rest}>
      {children}
    </div>
  );
}

export function PageTitle({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">{title}</h1>
        <span aria-hidden className="mt-2 block h-0.5 w-12 rounded-full bg-gradient-to-r from-gold to-transparent" />
        {subtitle && <p className="mt-2 max-w-2xl text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

const badgeTone = {
  neutral: "border-line text-muted bg-elevated",
  brand: "border-brand/40 text-brand-soft bg-brand/10",
  ok: "border-ok/40 text-ok bg-ok/10",
  warn: "border-warn/40 text-warn bg-warn/10",
  danger: "border-danger/40 text-danger bg-danger/10",
  accent: "border-accent/40 text-accent bg-accent/10",
  gold: "border-gold/40 text-gold bg-gold/10",
} as const;

export function Badge({ tone = "neutral", children, className }: { tone?: keyof typeof badgeTone; children: ReactNode; className?: string }) {
  return <span className={cx("inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold", badgeTone[tone], className)}>{children}</span>;
}

export function Alert({ tone = "info", children, className }: { tone?: "info" | "ok" | "warn" | "danger"; children: ReactNode; className?: string }) {
  const t = {
    info: "border-brand/40 bg-brand/10 text-brand-soft",
    ok: "border-ok/40 bg-ok/10 text-ok",
    warn: "border-warn/40 bg-warn/10 text-warn",
    danger: "border-danger/40 bg-danger/10 text-danger",
  }[tone];
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={cx("rounded-lg border px-4 py-3 text-sm", t, className)}>
      {children}
    </div>
  );
}

export function Field({ label, hint, error, children, htmlFor }: { label: string; hint?: ReactNode; error?: string; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-sm font-medium text-ink">
        {label}
      </label>
      {children}
      {hint && <p className="text-xs text-muted">{hint}</p>}
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}

const inputBase = "w-full max-w-full rounded-lg border border-line bg-bg/70 px-3 py-2.5 text-sm text-ink placeholder:text-muted/90 focus-ring focus:border-brand-soft";

export function Input({ className, ...rest }: ComponentProps<"input">) {
  return <input className={cx(inputBase, className)} {...rest} />;
}
export function Select({ className, children, ...rest }: ComponentProps<"select">) {
  return (
    <select className={cx(inputBase, "pr-8", className)} {...rest}>
      {children}
    </select>
  );
}
export function Textarea({ className, ...rest }: ComponentProps<"textarea">) {
  return <textarea className={cx(inputBase, "min-h-24", className)} {...rest} />;
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-line px-6 py-10 text-center">
      <p className="font-semibold">{title}</p>
      {children && <div className="mt-1 text-sm text-muted">{children}</div>}
    </div>
  );
}

export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "ok" | "warn" | "brand" | "gold" }) {
  return (
    <div className="min-w-0 rounded-xl border border-line bg-elevated/60 p-4">
      <p className="text-xs uppercase tracking-wider text-muted">{label}</p>
      <p className={cx("mt-1 text-xl font-extrabold sm:text-2xl", tone === "ok" && "text-ok", tone === "warn" && "text-warn", tone === "brand" && "text-brand-soft", tone === "gold" && "text-gold")}>{value}</p>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}

export function Table({ children, className, tableClassName }: { children: ReactNode; className?: string; tableClassName?: string }) {
  return (
    <ScrollTable className={className} tableClassName={tableClassName}>
      {children}
    </ScrollTable>
  );
}
export const Th = ({ children, className }: { children?: ReactNode; className?: string }) => (
  <th className={cx("bg-elevated/70 px-2 py-2 text-xs sm:px-3 font-semibold uppercase tracking-wider text-muted", className)}>{children}</th>
);
export const Td = ({ children, className }: { children?: ReactNode; className?: string }) => <td className={cx("border-t border-line-soft px-2 py-2.5 align-middle sm:px-3", className)}>{children}</td>;

export function GameBadge({ abbr, accent, size = "md" }: { abbr: string; accent: string; size?: "sm" | "md" | "lg" }) {
  const dims = { sm: "h-7 min-w-7 text-[10px]", md: "h-10 min-w-10 text-xs", lg: "h-14 min-w-14 text-sm" }[size];
  return (
    <span className={cx("inline-flex items-center justify-center rounded-lg px-2 font-black tracking-wide", dims)} style={{ background: `${accent}22`, color: `color-mix(in srgb, ${accent} 60%, #fff)`, border: `1px solid ${accent}66` }}>
      {abbr}
    </span>
  );
}

/** Título de seção com a barra dourada inclinada da marca. `action` fica à direita (ex.: "Ver todos"). */
export function SectionTitle({ id, children, action }: { id?: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-4 flex items-end justify-between gap-3">
      <h2 id={id} className="flex min-w-0 items-center gap-2.5 text-lg font-black uppercase italic tracking-wide sm:text-xl">
        <span aria-hidden className="h-4 w-1.5 -skew-x-12 rounded-[2px] bg-gradient-to-b from-gold to-gold-deep" />
        {children}
      </h2>
      {action && <div className="shrink-0 whitespace-nowrap text-right">{action}</div>}
    </div>
  );
}
