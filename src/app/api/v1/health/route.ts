import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/** Liveness: the process is up. No dependency checks, no secrets. */
export async function GET() {
  return NextResponse.json({ status: "ok", service: "timeframe-ai", time: new Date().toISOString() });
}
