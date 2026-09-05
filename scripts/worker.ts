/**
 * Dedicated worker process.
 *
 * Run one or more of these alongside the web app in production:
 *   npm run worker
 *
 * The queue is PostgreSQL-backed (FOR UPDATE SKIP LOCKED), so any number of
 * worker processes can run concurrently on any number of machines without
 * coordination. Set WORKER_INLINE=false on the web app when using this.
 */
import { loadEnv } from "@/lib/env";
import { pingDb } from "@/lib/db";
import { startWorker } from "@/lib/services/worker";

async function main() {
  const env = loadEnv();
  const concurrency = Math.max(1, Number(process.env.WORKER_CONCURRENCY ?? 2));

  if (!(await pingDb())) {
    console.error("CONFIGURATION_ERROR: the database is not reachable. The worker cannot start.");
    process.exit(1);
  }

  console.log(`Timeframe worker starting (env=${env.NODE_ENV}, concurrency=${concurrency}, demo=${env.DEMO_MODE}).`);
  const handle = startWorker({ pollMs: 1000, concurrency });

  const shutdown = (signal: string) => {
    console.log(`Received ${signal}; finishing in-flight jobs and stopping.`);
    handle.stop();
    // In-flight jobs left PROCESSING are recovered by recoverStaleJobs() on the
    // next worker start, so no work is ever lost.
    setTimeout(() => process.exit(0), 2000).unref();
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((e) => {
  console.error("The worker failed to start:", e instanceof Error ? e.message : e);
  process.exit(1);
});
