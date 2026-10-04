import { ZodError } from "zod";
import { isAppError } from "./errors";

export type FormState = { error?: string; success?: string } | undefined;

/**
 * Executa uma ação de servidor e converte erros de regra de negócio em mensagem para a tela.
 * Erros inesperados são registrados no servidor e mostrados de forma genérica (sem vazar detalhes).
 * IMPORTANTE: chame `redirect()` FORA deste helper (o redirect do Next é uma exceção).
 */
export async function guard<T>(fn: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  try {
    return { ok: true, value: await fn() };
  } catch (e) {
    if (isAppError(e)) return { ok: false, error: e.message };
    if (e instanceof ZodError) return { ok: false, error: e.issues[0]?.message ?? "Dados inválidos." };
    console.error("[action] erro inesperado:", e);
    return { ok: false, error: "Ocorreu um erro inesperado. Tente novamente." };
  }
}

export const str = (fd: FormData, key: string): string => String(fd.get(key) ?? "").trim();
export const strRaw = (fd: FormData, key: string): string => String(fd.get(key) ?? "");
export const int = (fd: FormData, key: string): number => Number.parseInt(String(fd.get(key) ?? ""), 10);
export const bool = (fd: FormData, key: string): boolean => ["on", "true", "1"].includes(String(fd.get(key) ?? ""));

/** Só aceita caminhos internos (evita redirecionamento aberto: //evil.com, https://..., /\evil). */
export function safeNext(next: string | null | undefined, fallback = "/"): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\") || next.includes("://")) return fallback;
  return next;
}
