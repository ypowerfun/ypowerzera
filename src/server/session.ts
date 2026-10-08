import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getEnv } from "@/lib/env";
import { normalizeClientIp } from "@/lib/ip";
import { getUserBySessionToken, SESSION_DAYS, type SafeUser } from "./auth";
import type { Actor } from "./types";
import { getChatGPTUser } from "./chatgpt-auth";
import { findChatGPTProfile } from "./chatgpt-users";
import { AppError } from "@/lib/errors";

export const SESSION_COOKIE = "pam_session";

export const getCurrentUser = cache(async (): Promise<SafeUser | null> => {
  if (getEnv().authProvider === "chatgpt") {
    const identity = await getChatGPTUser();
    return identity ? findChatGPTProfile(identity) : null;
  }
  const store = await cookies();
  return getUserBySessionToken(store.get(SESSION_COOKIE)?.value);
});

export async function currentToken(): Promise<string | undefined> {
  return (await cookies()).get(SESSION_COOKIE)?.value;
}

export function toActor(u: SafeUser): Actor {
  return { id: u.id, role: u.role, email: u.email, emailVerifiedAt: u.emailVerifiedAt, displayName: u.displayName };
}

export async function requireUser(next?: string): Promise<SafeUser> {
  const u = await getCurrentUser();
  if (!u) {
    const target = getEnv().authProvider === "chatgpt" && await getChatGPTUser() ? "/cadastro" : "/entrar";
    redirect(`${target}${next ? `?next=${encodeURIComponent(next)}` : ""}`);
  }
  return u;
}

export async function requireActionUser(_next?: string): Promise<SafeUser> {
  const user = await getCurrentUser();
  if (!user) throw new AppError("Entre com sua conta e complete seu perfil para continuar.", "UNAUTHENTICATED");
  return user;
}

export async function requireAdmin(): Promise<SafeUser> {
  const u = await requireUser("/admin");
  if (u.role !== "ADMIN") redirect("/");
  return u;
}

export async function setSessionCookie(token: string, expiresAt: Date) {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: getEnv().isProd,
    path: "/",
    expires: expiresAt,
    maxAge: SESSION_DAYS * 86400,
  });
}

export async function clearSessionCookie() {
  (await cookies()).delete(SESSION_COOKIE);
}

/**
 * IP e user-agent para limitação de tentativas e auditoria.
 * Em produção o cabeçalho x-forwarded-for só é usado com TRUST_PROXY=true (proxy seu na frente, como o Caddy);
 * caso contrário o IP fica "unknown" — um balde único, que falha fechado em vez de poder ser forjado.
 */
export async function clientMeta(): Promise<{ ip: string; userAgent?: string }> {
  const h = await headers();
  const env = getEnv();
  const trusted = env.trustProxy ?? !env.isProd;
  // Último item de x-forwarded-for: é o que o SEU proxy anotou. O primeiro pode vir escrito pelo próprio cliente.
  const forwarded = trusted ? h.get("x-forwarded-for")?.split(",").map((x) => x.trim()).filter(Boolean).at(-1) || h.get("x-real-ip") : null;
  return { ip: forwarded ? normalizeClientIp(forwarded) : "unknown", userAgent: h.get("user-agent") ?? undefined };
}

export async function requireActionAdmin(): Promise<SafeUser> {
  const user = await requireActionUser();
  if (user.role !== "ADMIN") throw new AppError("Apenas administradores.", "FORBIDDEN");
  return user;
}
