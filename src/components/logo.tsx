import { useId } from "react";

/** Marca PRiME ARENA MANAGER. `variant="mark"` mostra só o brasão (cabe em avatar/ícone). */
export function Logo({ variant = "full", className = "", title = "PRiME ARENA MANAGER" }: { variant?: "full" | "mark"; className?: string; title?: string }) {
  const uid = useId().replace(/:/g, "");
  const g = `g${uid}`;
  const w = `w${uid}`;
  const f = `f${uid}`;
  const mark = (
    <g>
      <path d="M48 4 85 25.500v45L48 92 11 70.500v-45z" fill={`url(#${f})`} stroke={`url(#${g})`} strokeWidth="4" strokeLinejoin="round" />
      <path d="M48 12.500 78 30v36L48 83.500 18 66V30z" fill="none" stroke="#1e3a8a" strokeWidth="1.500" opacity="0.9" />
      <path d="M34 66V30h17a11.500 11.500 0 0 1 0 23H34" fill="none" stroke={`url(#${g})`} strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="46.500" cy="41.500" r="4" fill="#22d3ee" />
      <circle cx="48" cy="48" r="38" fill="none" stroke="#38bdf8" strokeWidth="1" strokeDasharray="3 7" opacity="0.5" />
    </g>
  );
  const defs = (
    <defs>
      <linearGradient id={g} x1="8" y1="6" x2="88" y2="92" gradientUnits="userSpaceOnUse">
        <stop offset="0" stopColor="#7dd3fc" />
        <stop offset="0.5" stopColor="#3b82f6" />
        <stop offset="1" stopColor="#1d4ed8" />
      </linearGradient>
      <linearGradient id={w} x1="104" y1="0" x2="420" y2="0" gradientUnits="userSpaceOnUse">
        <stop offset="0" stopColor="#bfdbfe" />
        <stop offset="1" stopColor="#60a5fa" />
      </linearGradient>
      <linearGradient id={f} x1="0" y1="0" x2="0" y2="96" gradientUnits="userSpaceOnUse">
        <stop offset="0" stopColor="#0f1f4a" />
        <stop offset="1" stopColor="#060d24" />
      </linearGradient>
    </defs>
  );
  if (variant === "mark") {
    return (
      <svg viewBox="0 0 96 96" className={className} role="img" aria-label={title}>
        <title>{title}</title>
        {defs}
        {mark}
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 440 104" className={className} role="img" aria-label={title}>
      <title>{title}</title>
      {defs}
      <g transform="translate(4 4)">{mark}</g>
      <g fill="none" stroke={`url(#${w})`} strokeWidth="7.5" strokeLinecap="round" strokeLinejoin="round" transform="translate(116 10) scale(1.22)">
        <path d="M0 46V0h20a13 13 0 0 1 0 26H0" />
        <g transform="translate(46 0)">
          <path d="M0 46V0h20a13 13 0 0 1 0 26H0M18 26 32 46" />
        </g>
        <g transform="translate(92 0)">
          <path d="M0 46V16" />
        </g>
        <g transform="translate(112 0)">
          <path d="M0 46V0l17 26L34 0v46" />
        </g>
        <g transform="translate(164 0)">
          <path d="M28 0H0v46h28M0 23h22" />
        </g>
      </g>
      <circle cx="228.200" cy="19" r="6" fill="#22d3ee" />
      <text x="116" y="95" fill="#93c5fd" fontFamily="'Segoe UI','Helvetica Neue',Arial,sans-serif" fontSize="15" fontWeight="700" textLength="238" lengthAdjust="spacing">
        ARENA MANAGER
      </text>
    </svg>
  );
}
