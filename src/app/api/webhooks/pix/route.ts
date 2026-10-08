import { NextResponse } from "next/server";
import { BodyTooLargeError, readBodyLimited } from "@/lib/body";
import { handlePixWebhook } from "@/server/pix-webhooks";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let raw: string;
  try {
    raw = await readBodyLimited(req, 100_000);
  } catch (e) {
    if (e instanceof BodyTooLargeError) return NextResponse.json({ error: "too_large" }, { status: 413 });
    throw e;
  }
  const res = await handlePixWebhook(req.headers, raw);
  return NextResponse.json(res.body, { status: res.status });
}
