/** Só devolve o link se for http(s). `javascript:`, `data:` e `vbscript:` num href seriam XSS guardado no banco. */
export function safeHttpUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const u = new URL(value);
    return u.protocol === "https:" || u.protocol === "http:" ? u.href : null;
  } catch {
    return null;
  }
}

/** Número de página vindo da URL (?pagina=): inteiro finito entre 1 e 10 000. "1.1", "1e999" e "abc" não podem quebrar a consulta. */
export function clampPage(value: unknown): number {
  const n = Math.trunc(Number(value));
  return Number.isFinite(n) ? Math.min(10_000, Math.max(1, n)) : 1;
}

/**
 * Parâmetros da URL (?q=a&q=b) chegam como lista quando o nome se repete; as páginas esperam texto. Fica o primeiro valor,
 * então um parâmetro repetido não derruba a página com erro 500.
 */
export function flatParams<T extends object>(params: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(params)) out[k] = Array.isArray(v) ? v[0] : v;
  return out as T;
}
