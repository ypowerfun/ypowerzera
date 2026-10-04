import { createHmac } from "node:crypto";
import { safeEqual } from "./crypto";

/**
 * Assinatura de webhook no formato `t=<unix>,v1=<hmac>`: HMAC-SHA256 de `${t}.${corpoBruto}`.
 * A tolerância de relógio impede reaproveitar (replay) uma notificação antiga.
 */
export function signPayload(rawBody: string, secret: string, nowMs = Date.now()): string {
  const t = Math.floor(nowMs / 1000);
  return `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex")}`;
}

export function verifySignature(rawBody: string, header: string | null | undefined, secret: string, toleranceSeconds = 300, nowMs = Date.now()): boolean {
  if (!header || !secret) return false;
  const parts = header.split(",").map((s) => s.trim().split("="));
  const t = parts.find(([k]) => k === "t")?.[1];
  const sigs = parts.filter(([k]) => k === "v1").map(([, v]) => v);
  if (!t || sigs.length === 0) return false;
  const ts = Number(t);
  if (!Number.isFinite(ts) || Math.abs(nowMs / 1000 - ts) > toleranceSeconds) return false;
  const expected = createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex");
  return sigs.some((s) => s.length === expected.length && safeEqual(s, expected));
}
