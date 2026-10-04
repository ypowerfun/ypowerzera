import { NextResponse } from "next/server";
import { cronAuthorized, runWalletCron } from "@/server/cron";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!cronAuthorized(req.headers.get("authorization"))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json(await runWalletCron());
}

export const GET = POST;
