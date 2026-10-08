import { NextResponse } from "next/server";
import { BodyTooLargeError, readBodyLimited } from "@/lib/body";
import { handleStripeWebhook } from "@/server/stripe-webhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  // corpo BRUTO (a assinatura é calculada sobre ele), com teto de tamanho: o endereço é público
  let raw: string;
  try {
    raw = await readBodyLimited(req, 200_000);
  } catch (e) {
    if (e instanceof BodyTooLargeError) return NextResponse.json({ error: "too_large" }, { status: 413 });
    throw e;
  }
  const res = await handleStripeWebhook(raw, req.headers.get("stripe-signature"));
  return NextResponse.json(res.body, { status: res.status });
}
