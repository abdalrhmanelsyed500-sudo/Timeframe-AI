import { claimNextJob, recoverStaleJobs } from "./jobs";
import { runJob } from "./runner";

/**
 * Worker loop.
 *
 * The queue is backed by PostgreSQL with FOR UPDATE SKIP LOCKED, so N workers
 * scale horizontally without any coordination. A dedicated worker process is
 * started with `npm run worker`; in development an inline worker (WORKER_INLINE)
 * runs inside the app process so a single command is enough to use the product.
 */
export interface WorkerHandle {
  stop: () => void;
  running: () => boolean;
}

export function startWorker(opts: { pollMs?: number; concurrency?: number } = {}): WorkerHandle {
  const pollMs = opts.pollMs ?? 1000;
  const concurrency = Math.max(1, opts.concurrency ?? 2);
  let stopped = false;
  let active = 0;

  void recoverStaleJobs().catch(() => {});

  const loop = async () => {
    while (!stopped) {
      if (active >= concurrency) {
        await sleep(pollMs);
        continue;
      }
      let job = null;
      try {
        job = await claimNextJob();
      } catch {
        // Database unavailable: back off and try again rather than crashing.
        await sleep(Math.max(pollMs, 5000));
        continue;
      }
      if (!job) {
        await sleep(pollMs);
        continue;
      }
      active++;
      void runJob(job)
        .catch(() => {})
        .finally(() => {
          active--;
        });
    }
  };

  void loop();

  // Periodic recovery sweep for jobs orphaned by a crashed worker.
  const sweep = setInterval(() => {
    void recoverStaleJobs().catch(() => {});
  }, 5 * 60_000);
  if (typeof sweep === "object" && "unref" in sweep) sweep.unref();

  return {
    stop: () => {
      stopped = true;
      clearInterval(sweep);
    },
    running: () => !stopped,
  };
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

declare global {
  var __tf_worker: WorkerHandle | undefined;
}

/** Idempotently start the inline development worker. */
export function ensureInlineWorker(): void {
  if (globalThis.__tf_worker) return;
  globalThis.__tf_worker = startWorker({ pollMs: 800, concurrency: 2 });
}
