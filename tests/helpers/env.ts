import fs from "node:fs";
import path from "node:path";

/**
 * Loads .env for tests. Integration tests talk to a REAL PostgreSQL instance
 * and a REAL FFmpeg binary — they are never mocked. If either is missing the
 * suite reports SKIPPED, never PASS.
 */
const root = path.resolve(__dirname, "../..");

if (!process.env.DATABASE_URL) {
  const envPath = path.join(root, ".env");
  if (fs.existsSync(envPath)) {
    for (const raw of fs.readFileSync(envPath, "utf8").split("\n")) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      if (process.env[key] === undefined) process.env[key] = line.slice(eq + 1).trim();
    }
  }
}

// Tests must never be able to reach a paid provider.
process.env.DEMO_MODE = "true";
process.env.REAL_PROVIDER_ENABLED = "false";
process.env.WORKER_INLINE = "false"; // tests drive the worker loop explicitly

export const REPO_ROOT = root;
