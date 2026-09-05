/**
 * Production readiness gate.
 *
 * Verifies that this deployment is genuinely able to do the work it advertises.
 * Every check reports PASS, FAIL, WARN or SKIPPED — a SKIPPED check is never
 * counted as a PASS, and the process exits non-zero if anything FAILs.
 *
 *   npm run production:check
 */
import fs from "node:fs";
import path from "node:path";
import { loadEnv, envReport } from "@/lib/env";
import { pingDb, dbGuard, getDb, sql } from "@/lib/db";
import { isEncryptionConfigured, seal, open as openSealed } from "@/lib/security/crypto";
import { findFfmpeg, findFfprobe, ffprobeVersion } from "@/lib/render/ffmpeg";
import { getStorage } from "@/lib/storage";
import { providerMode } from "@/lib/ai/factory";
import { PROFILE_LIST } from "@/lib/render/profiles";

type Status = "PASS" | "FAIL" | "WARN" | "SKIPPED";
interface Result {
  name: string;
  status: Status;
  detail: string;
}

const results: Result[] = [];
function record(name: string, status: Status, detail: string) {
  results.push({ name, status, detail });
}

async function check(name: string, fn: () => Promise<[Status, string]>) {
  try {
    const [status, detail] = await fn();
    record(name, status, detail);
  } catch (e) {
    record(name, "FAIL", e instanceof Error ? e.message : String(e));
  }
}

async function main() {
  let env: ReturnType<typeof loadEnv>;
  try {
    env = loadEnv();
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    console.error("\nproduction:check FAILED — the environment is not valid.");
    process.exit(1);
  }

  const isProd = env.NODE_ENV === "production";

  await check("Environment schema", async () => ["PASS", JSON.stringify(envReport())]);

  await check("Demo mode disabled in production", async () => {
    if (!isProd) return ["SKIPPED", `NODE_ENV is ${env.NODE_ENV}; this check only applies to production.`];
    return env.DEMO_MODE ? ["FAIL", "DEMO_MODE is enabled in production."] : ["PASS", "DEMO_MODE is off."];
  });

  await check("Auth secret strength", async () => {
    const secret = process.env.AUTH_SECRET ?? "";
    if (secret.length < 32) {
      return [isProd ? "FAIL" : "WARN", `AUTH_SECRET is ${secret.length} chars; 32+ is required for production.`];
    }
    if (/dev|change|secret|password|test/i.test(secret) && isProd) {
      return ["FAIL", "AUTH_SECRET looks like a placeholder value."];
    }
    return ["PASS", "AUTH_SECRET is present and of adequate length."];
  });

  await check("Credential encryption", async () => {
    if (!isEncryptionConfigured()) {
      return [isProd ? "FAIL" : "WARN", "ENCRYPTION_KEY is not configured; user API keys cannot be stored."];
    }
    const probe = "sk-production-check-roundtrip";
    const sealed = seal(probe);
    if (JSON.stringify(sealed).includes(probe)) return ["FAIL", "Encryption output contains the plaintext."];
    if (openSealed(sealed) !== probe) return ["FAIL", "AES-256-GCM round-trip did not return the original value."];
    return ["PASS", "AES-256-GCM seal/open round-trip verified."];
  });

  await check("Database connectivity", async () => {
    const ok = await pingDb();
    return ok ? ["PASS", "Connected."] : ["FAIL", "The database is not reachable at DATABASE_URL."];
  });

  await check("Database migrations applied", async () => {
    const dir = path.join(process.cwd(), "migrations");
    const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort() : [];
    if (files.length === 0) return ["FAIL", "No migration files were found."];
    const applied = await dbGuard(() => sql<{ name: string }>`SELECT name FROM _migrations`.execute(getDb()));
    const appliedNames = new Set(applied.rows.map((r) => r.name));
    const missing = files.filter((f) => !appliedNames.has(f));
    return missing.length
      ? ["FAIL", `Pending migrations: ${missing.join(", ")}. Run \`npm run migrate\`.`]
      : ["PASS", `${files.length} migrations applied.`];
  });

  await check("Object storage writable", async () => {
    const storage = getStorage();
    const key = `healthcheck/production-check-${Date.now()}.txt`;
    const payload = Buffer.from("production-check", "utf8");
    await storage.put(key, payload, "text/plain");
    const exists = await storage.exists(key);
    const size = await storage.size(key);
    await storage.delete(key);
    if (!exists || size !== payload.byteLength) return ["FAIL", "A written object could not be read back correctly."];
    return ["PASS", `${env.STORAGE_PROVIDER} storage read/write/delete verified.`];
  });

  await check("FFmpeg available", async () => {
    const bin = findFfmpeg();
    return bin ? ["PASS", bin] : ["FAIL", "FFmpeg was not found. Video rendering is unavailable."];
  });

  await check("ffprobe available", async () => {
    const bin = findFfprobe();
    if (!bin) return ["FAIL", "ffprobe was not found. Renders cannot be validated."];
    const version = await ffprobeVersion().catch(() => null);
    return version ? ["PASS", `${bin} (${version})`] : ["FAIL", `${bin} could not be executed.`];
  });

  await check("Render profiles", async () => {
    const bad = PROFILE_LIST.filter((p) => p.width % 2 !== 0 || p.height % 2 !== 0);
    return bad.length
      ? ["FAIL", `Odd dimensions are not h264-encodable: ${bad.map((p) => p.key).join(", ")}`]
      : ["PASS", `${PROFILE_LIST.length} profiles, all even-dimensioned.`];
  });

  await check("AI provider mode", async () => {
    const mode = providerMode();
    if (isProd && mode === "demo") {
      return ["FAIL", "Production is running in demo mode; no real content would be generated."];
    }
    if (mode === "demo") return ["WARN", "Running in DEMO_MODE — generated content is mock and clearly labelled."];
    return ["PASS", "Real providers are enabled."];
  });

  await check("Secrets are not logged", async () => {
    const { redact } = await import("@/lib/services/audit");
    const out = JSON.stringify(redact({ apiKey: "sk-should-not-appear", nested: { authorization: "Bearer xyz" } }));
    if (out.includes("sk-should-not-appear") || out.includes("xyz")) return ["FAIL", "Redaction failed to remove a secret."];
    return ["PASS", "Audit redaction removes credentials."];
  });

  // ---- report ----
  const width = Math.max(...results.map((r) => r.name.length)) + 2;
  console.log("\nTIMEFRAME AI — production readiness\n");
  for (const r of results) {
    console.log(`  ${r.status.padEnd(8)} ${r.name.padEnd(width)} ${r.detail}`);
  }

  const failed = results.filter((r) => r.status === "FAIL");
  const warned = results.filter((r) => r.status === "WARN");
  const skipped = results.filter((r) => r.status === "SKIPPED");
  console.log(
    `\n  ${results.filter((r) => r.status === "PASS").length} passed, ${failed.length} failed, ${warned.length} warnings, ${skipped.length} skipped.\n`,
  );

  if (failed.length) {
    console.error("production:check FAILED — this deployment is not production ready.");
    process.exit(1);
  }
  console.log("production:check passed.");
  process.exit(0);
}

main().catch((e) => {
  console.error("production:check crashed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
