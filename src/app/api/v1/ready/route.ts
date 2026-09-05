import { NextResponse } from "next/server";
import { pingDb } from "@/lib/db";
import { getStorage } from "@/lib/storage";
import { isEncryptionConfigured } from "@/lib/security/crypto";
import { findFfmpeg, findFfprobe } from "@/lib/render/ffmpeg";
import { loadEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

/** Readiness: dependencies verified. Reports state only — never secret values. */
export async function GET() {
  const checks: Record<string, { ok: boolean; detail: string }> = {};

  try {
    await pingDb();
    checks.database = { ok: true, detail: "reachable" };
  } catch {
    checks.database = { ok: false, detail: "unreachable" };
  }

  try {
    const storage = getStorage();
    const probeKey = "healthcheck/ready.txt";
    await storage.put(probeKey, Buffer.from("ok"), "text/plain");
    const ok = await storage.exists(probeKey);
    await storage.delete(probeKey);
    checks.storage = { ok, detail: ok ? `writable (${storage.name})` : "not writable" };
  } catch {
    checks.storage = { ok: false, detail: "not writable" };
  }

  checks.encryption = isEncryptionConfigured()
    ? { ok: true, detail: "configured" }
    : { ok: false, detail: "ENCRYPTION_KEY not configured" };

  const ffmpeg = Boolean(findFfmpeg());
  const ffprobe = Boolean(findFfprobe());
  checks.ffmpeg = { ok: ffmpeg && ffprobe, detail: ffmpeg && ffprobe ? "available" : "missing — rendering is unavailable" };

  try {
    const env = loadEnv();
    const configured = env.REAL_PROVIDER_ENABLED || env.DEMO_MODE;
    checks.provider = {
      ok: Boolean(configured),
      detail: env.REAL_PROVIDER_ENABLED ? "real provider mode" : env.DEMO_MODE ? "demo mode (mock output)" : "no provider configured",
    };
    checks.config = { ok: true, detail: "valid" };
  } catch {
    checks.provider = { ok: false, detail: "unknown" };
    checks.config = { ok: false, detail: "invalid environment configuration" };
  }

  const ready = Object.values(checks).every((c) => c.ok);
  return NextResponse.json({ ready, checks }, { status: ready ? 200 : 503 });
}
