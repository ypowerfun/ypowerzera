import { NextResponse } from "next/server";
import { handleStripeWebhook } from "@/server/stripe-webhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const raw = await req.text(); // corpo BRUTO: a assinatura é calculada sobre ele
  const res = await handleStripeWebhook(raw, req.headers.get("stripe-signature"));
  return NextResponse.json(res.body, { status: res.status });
}
