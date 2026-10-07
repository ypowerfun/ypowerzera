const NAME = "Prime Arena";

/**
 * Marca Prime Arena, a partir da arte oficial (public/brand).
 *  - `full`: a arte oficial inteira, em tamanho reduzido, para o cabeçalho (`md`) e o rodapé (`lg`); `size` escolhe o tamanho.
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

  // logo original inteira (marca + PRIME ARENA), só reduzida: pequena na barra de cima, maior no rodapé
  const dim = { sm: { cls: "h-10 w-10", px: 40 }, md: { cls: "h-12 w-12 sm:h-14 sm:w-14", px: 56 }, lg: { cls: "h-28 w-28", px: 112 } }[size];
  return (
    <img
      src="/brand/prime-arena-art-256.webp"
      srcSet="/brand/prime-arena-art-128.webp 128w, /brand/prime-arena-art-256.webp 256w, /brand/prime-arena-art-512.webp 512w"
      sizes={`${dim.px}px`}
      width={969}
      height={969}
      alt={NAME}
      decoding="async"
      className={`aspect-square shrink-0 rounded-md ${dim.cls} ${className}`}
    />
  );
}
