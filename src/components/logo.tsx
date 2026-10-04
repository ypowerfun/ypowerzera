const NAME = "Prime Arena One";

/**
 * Marca Prime Arena One, a partir da arte oficial (public/brand).
 *  - `mark`: só o brasão quadrado (avatar, ícones); o tamanho vem do className (ex.: "h-10 w-10").
 *  - `full`: brasão + logotipo em texto (nítido em qualquer tamanho); `size` escolhe a escala.
 *  - `art`: a arte grande, para o destaque da home (usa a versão de alta resolução em telas densas).
 */
export function Logo({ variant = "full", size = "md", className = "" }: { variant?: "full" | "mark" | "art"; size?: "sm" | "md" | "lg"; className?: string }) {
  if (variant === "art") {
    return (
      <img
        src="/brand/prime-arena-one-512.webp"
        srcSet="/brand/prime-arena-one-512.webp 512w, /brand/prime-arena-one-1024.webp 1024w"
        sizes="(min-width: 1024px) 448px, 288px"
        width={512}
        height={512}
        alt={NAME}
        fetchPriority="high"
        decoding="async"
        className={`aspect-square rounded-[2rem] ${className}`}
      />
    );
  }

  const badge = (cls: string) => (
    <img src="/brand/prime-arena-one-128.webp" width={128} height={128} alt={variant === "mark" ? NAME : ""} decoding="async" className={`aspect-square shrink-0 rounded-[22%] ring-1 ring-white/10 ${cls}`} />
  );
  if (variant === "mark") return badge(className);

  const s = {
    sm: { img: "h-8 w-8", prime: "text-[15px]", arena: "text-[8px]", one: "text-[7px]" },
    md: { img: "h-9 w-9 sm:h-10 sm:w-10", prime: "text-base sm:text-lg", arena: "text-[8px] sm:text-[9px]", one: "text-[7px] sm:text-[8px]" },
    lg: { img: "h-12 w-12", prime: "text-2xl", arena: "text-[11px]", one: "text-[9px]" },
  }[size];

  return (
    <span className={`inline-flex items-center gap-2 sm:gap-2.5 ${className}`}>
      {badge(s.img)}
      {/* o nome é lido uma vez só: o texto visível é a marca, o brasão é decorativo */}
      <span className="flex flex-col leading-none">
        <span className={`display text-metal ${s.prime}`}>Prime</span>
        <span className="mt-1 flex items-center gap-1.5">
          <span className={`font-bold uppercase tracking-[0.3em] text-gold ${s.arena}`}>Arena</span>
          <span className={`rounded-[3px] bg-brand-strong px-1 py-px font-black uppercase leading-none tracking-wider text-white ${s.one}`}>One</span>
        </span>
      </span>
    </span>
  );
}
