/** Coroa da marca (ouro), para destaques de campeão, premiação e selos. Herda a cor do texto. */
export function CrownIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <path d="M3 8l4.6 4.2L12 4.5l4.4 7.700L21 8l-1.800 11H4.800L3 8z" />
      <rect x="5" y="20.500" width="14" height="1.500" rx="0.750" />
    </svg>
  );
}
