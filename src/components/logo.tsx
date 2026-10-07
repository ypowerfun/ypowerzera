const NAME = "Prime Arena";

/**
 * Marca Prime Arena, a partir da arte oficial (public/brand).
 *  - `full`: logo horizontal (marca + logotipo PRIME ARENA, recortados da arte oficial) para cabeçalho e rodapé; `size` escolhe a altura.
 *  - `mark`: só o "A" vermelho facetado, em quadrado (avatar, ícones); o tamanho vem do className (ex.: "h-10 w-10").
 *  - `art`: a arte oficial completa, para o destaque da home.
 */
export function Logo({ variant = "full", size = "md", className = "" }: { variant?: "full" | "mark" | "art"; size?: "sm" | "md" | "lg"; className?: string }) {
  if (variant === "art") {
    return (
      <img
        src="/brand/prime-arena-art-512.webp"
        srcSet="/brand/prime-arena-art-512.webp 512w, /brand/prime-arena-art-960.webp 960w"
        sizes="(min-width: 1024px) 448px, 288px"
        width={960}
        height={960}
        alt={NAME}
        fetchPriority="high"
        decoding="async"
        className={`aspect-square ${className}`}
      />
    );
  }

  if (variant === "mark") {
    return <img src="/brand/prime-arena-mark-128.webp" srcSet="/brand/prime-arena-mark-128.webp 1x, /brand/prime-arena-mark-256.webp 2x" width={128} height={128} alt={NAME} decoding="async" className={`aspect-square shrink-0 rounded-md ${className}`} />;
  }

  const h = { sm: "h-9", md: "h-10 sm:h-12", lg: "h-14" }[size];
  return (
    <img
      src="/brand/prime-arena-logo-h-104.webp"
      srcSet="/brand/prime-arena-logo-h-104.webp 375w, /brand/prime-arena-logo-h-208.webp 750w"
      sizes="(min-width: 640px) 173px, 144px"
      width={375}
      height={104}
      alt={NAME}
      decoding="async"
      className={`w-auto shrink-0 rounded-md ${h} ${className}`}
    />
  );
}
