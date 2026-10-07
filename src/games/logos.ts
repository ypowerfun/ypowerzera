/**
 * Logos dos jogos (public/games/<id>-128|256|512.webp). Arquivo separado e sem dependências de propósito:
 * os componentes de interface o importam sem puxar o catálogo inteiro de jogos para o navegador.
 */
const WITH_LOGO = new Set(["apex", "bf6", "cs2", "eafc", "fortnite", "lol", "sf6", "tft", "valorant", "warzone"]);

export const hasGameLogo = (id: string): boolean => WITH_LOGO.has(id);

export function gameLogoProps(id: string): { src: string; srcSet: string } | null {
  if (!WITH_LOGO.has(id)) return null;
  const f = (n: number) => `/games/${id}-${n}.webp`;
  return { src: f(256), srcSet: `${f(128)} 128w, ${f(256)} 256w, ${f(512)} 512w` };
}
