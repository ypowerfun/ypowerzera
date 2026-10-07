const NAME = "Prime Arena";

/**
 * Logo Prime Arena: a arte oficial (PNG com fundo transparente), só sem as margens vazias e redimensionada.
 * `size` escolhe a altura: `md` para o cabeçalho, `lg` para o rodapé. A largura acompanha (proporção 1248:1001).
 */
export function Logo({ size = "md", className = "" }: { size?: "sm" | "md" | "lg"; className?: string }) {
  const dim = { sm: { cls: "h-9", h: 36 }, md: { cls: "h-12 sm:h-14", h: 56 }, lg: { cls: "h-28 sm:h-32", h: 128 } }[size];
  const w = Math.round(dim.h * (1248 / 1001));
  return (
    <img
      src="/brand/prime-arena-logo-320.webp"
      srcSet="/brand/prime-arena-logo-160.webp 160w, /brand/prime-arena-logo-320.webp 320w, /brand/prime-arena-logo-640.webp 640w"
      sizes={`${w}px`}
      width={1248}
      height={1001}
      alt={NAME}
      decoding="async"
      className={`w-auto shrink-0 ${dim.cls} ${className}`}
    />
  );
}
