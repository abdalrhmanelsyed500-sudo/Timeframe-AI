import { iso } from "@/lib/core/dates";
import { db, dbGuard, getDb, sql } from "@/lib/db";
import { newId } from "@/lib/core/ids";
import { AppError, toAppError } from "@/lib/errors";
import { recordError } from "./audit";

/**
 * Durable job records in PostgreSQL.
 *
 * The DATABASE is the source of truth for job state — SSE is only a transport.
 * A worker crash therefore never loses a job: it is picked up again by state.
 */
export const JOB_TYPES = [
  "TRANSCRIBE_AUDIO",
  "STORY_ANALYZE",
  "STORY_REGENERATE",
  "VISUAL_BIBLE_GENERATE",
  "ASSET_GENERATE",
  "ASSET_BATCH",
  "ASSET_QC",
  "TIMELINE_GENERATE",
  "CINEMATIC_ANALYZE",
  "VIDEO_RENDER",
  "VIDEO_QC",
] as const;

export type JobType = (typeof JOB_TYPES)[number];
export const JOB_STATES = ["QUEUED", "PROCESSING", "COMPLETED", "FAILED", "RETRYING", "CANCELLED"] as const;
export type JobState = (typeof JOB_STATES)[number];

export interface JobRecord {
  id: string;
  projectId: string | null;
  userId: string;
  type: JobType;
  status: JobState;
  progress: number;
  message: string;
  total: number | null;
  completed: number;
  failed: number;
  payload: Record<string, unknown>;
  result: Record<string, unknown> | null;
  errorCode: string | null;
  errorMessage: string | null;
  attempts: number;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  updatedAt: string;
}

type Row = {
  id: string;
  project_id: string | null;
  user_id: string;
  type: string;
  status: string;
  progress: number;
  message: string;
  total: number | null;
  completed: number;
  failed: number;
  payload: unknown;
  result: unknown;
  error_code: string | null;
  error_message: string | null;
  attempts: number;
  created_at: unknown;
  started_at: unknown;
  finished_at: unknown;
  updated_at: unknown;
};

function toJob(r: Row): JobRecord {
  return {
    id: r.id,
    projectId: r.project_id,
    userId: r.user_id,
    type: r.type as JobType,
    status: r.status as JobState,
    progress: r.progress,
    message: r.message,
    total: r.total,
    completed: r.completed,
    failed: r.failed,
    payload: (r.payload ?? {}) as Record<string, unknown>,
    result: (r.result ?? null) as Record<string, unknown> | null,
    errorCode: r.error_code,
    errorMessage: r.error_message,
    attempts: r.attempts,
    createdAt: iso(r.created_at),
    startedAt: r.started_at ? iso(r.started_at) : null,
    finishedAt: r.finished_at ? iso(r.finished_at) : null,
    updatedAt: iso(r.updated_at),
  };
}

/**
 * Idempotency: an identical logical request reuses the existing job instead of
 * creating a second one, so a duplicated click never charges or generates twice.
 */
export async function enqueue(params: {
  userId: string;
  projectId: string | null;
  type: JobType;
  payload?: Record<string, unknown>;
  total?: number;
  idempotencyKey?: string;
  message?: string;
}): Promise<{ job: JobRecord; created: boolean }> {
  if (params.idempotencyKey) {
    const existing = await dbGuard(() =>
      db.selectFrom("jobs").selectAll().where("idempotency_key", "=", params.idempotencyKey!).executeTakeFirst(),
    );
    if (existing) {
      const job = toJob(existing as unknown as Row);
      // Only an active or successful job blocks a new one; failures may be retried.
      if (job.status === "QUEUED" || job.status === "PROCESSING" || job.status === "COMPLETED") {
        return { job, created: false };
      }
      await dbGuard(() => db.deleteFrom("jobs").where("id", "=", job.id).execute());
    }
  }

  const id = newId("job");
  await dbGuard(() =>
    db
      .insertInto("jobs")
      .values({
        id,
        user_id: params.userId,
        project_id: params.projectId,
        type: params.type,
        status: "QUEUED",
        payload: params.payload ?? {},
        total: params.total ?? null,
        message: params.message ?? "Queued",
        idempotency_key: params.idempotencyKey ?? null,
        updated_at: new Date(),
      })
      .execute(),
  );
  const row = await dbGuard(() => db.selectFrom("jobs").selectAll().where("id", "=", id).executeTakeFirstOrThrow());
  return { job: toJob(row as unknown as Row), created: true };
}

export async function getJob(jobId: string, userId: string): Promise<JobRecord | null> {
  const row = await dbGuard(() => db.selectFrom("jobs").selectAll().where("id", "=", jobId).where("user_id", "=", userId).executeTakeFirst());
  return row ? toJob(row as unknown as Row) : null;
}

export async function listJobs(params: { userId: string; projectId?: string; limit?: number; offset?: number; activeOnly?: boolean }) {
  const limit = Math.min(100, Math.max(1, params.limit ?? 25));
  const offset = Math.max(0, params.offset ?? 0);
  let q = db.selectFrom("jobs").selectAll().where("user_id", "=", params.userId);
  if (params.projectId) q = q.where("project_id", "=", params.projectId);
  if (params.activeOnly) q = q.where("status", "in", ["QUEUED", "PROCESSING", "RETRYING"]);
  const rows = await dbGuard(() => q.orderBy("created_at", "desc").limit(limit).offset(offset).execute());
  return rows.map((r) => toJob(r as unknown as Row));
}

export async function markProcessing(jobId: string): Promise<void> {
  await dbGuard(() =>
    db
      .updateTable("jobs")
      .set({ status: "PROCESSING", started_at: new Date(), updated_at: new Date(), message: "Starting" })
      .where("id", "=", jobId)
      .execute(),
  );
}

export async function progress(jobId: string, update: { message?: string; completed?: number; total?: number; failed?: number }): Promise<void> {
  const set: Record<string, unknown> = { updated_at: new Date() };
  if (update.message !== undefined) set.message = update.message;
  if (update.completed !== undefined) set.completed = update.completed;
  if (update.total !== undefined) set.total = update.total;
  if (update.failed !== undefined) set.failed = update.failed;
  if (update.completed !== undefined && update.total) set.progress = Math.min(1, update.completed / update.total);
  await dbGuard(() => db.updateTable("jobs").set(set).where("id", "=", jobId).execute());
}

export async function completeJob(jobId: string, result: Record<string, unknown>): Promise<void> {
  await dbGuard(() =>
    db
      .updateTable("jobs")
      .set({ status: "COMPLETED", progress: 1, result, finished_at: new Date(), updated_at: new Date(), message: "Completed" })
      .where("id", "=", jobId)
      .execute(),
  );
}

export async function failJob(jobId: string, e: unknown, ctx: { userId?: string; projectId?: string | null }): Promise<void> {
  const appError = toAppError(e);
  await dbGuard(() =>
    db
      .updateTable("jobs")
      .set({
        status: /cancelled/i.test(appError.message) ? "CANCELLED" : "FAILED",
        error_code: appError.code,
        error_message: appError.message,
        finished_at: new Date(),
        updated_at: new Date(),
        message: appError.message,
      })
      .where("id", "=", jobId)
      .execute(),
  );
  await recordError({
    userId: ctx.userId ?? null,
    projectId: ctx.projectId ?? null,
    jobId,
    code: appError.code,
    message: appError.message,
    context: appError.context,
  });
}

export async function cancelJob(jobId: string, userId: string): Promise<void> {
  const job = await getJob(jobId, userId);
  if (!job) throw new AppError("NOT_FOUND", "That job does not exist.");
  if (job.status === "COMPLETED" || job.status === "FAILED") return;
  await dbGuard(() =>
    db.updateTable("jobs").set({ cancel_requested: true, updated_at: new Date() }).where("id", "=", jobId).execute(),
  );
}

export async function jobCancelRequested(jobId: string): Promise<boolean> {
  const row = await dbGuard(() => db.selectFrom("jobs").select(["cancel_requested"]).where("id", "=", jobId).executeTakeFirst());
  return Boolean(row?.cancel_requested);
}

/**
 * Worker recovery: jobs left PROCESSING by a crashed worker are requeued.
 * Called at worker startup and periodically.
 */
export async function recoverStaleJobs(staleAfterMs = 15 * 60_000): Promise<number> {
  const cutoff = new Date(Date.now() - staleAfterMs);
  const rows = await dbGuard(() =>
    db
      .updateTable("jobs")
      .set({ status: "QUEUED", message: "Requeued after a worker restart", updated_at: new Date() })
      .where("status", "=", "PROCESSING")
      .where("updated_at", "<", cutoff)
      .returning(["id"])
      .execute(),
  );
  return rows.length;
}

/** Atomically claim the next queued job (safe with many concurrent workers). */
export async function claimNextJob(): Promise<JobRecord | null> {
  // FOR UPDATE SKIP LOCKED guarantees two workers never take the same job.
  const result = await dbGuard(() =>
    sql<Row>`
      UPDATE jobs SET status = 'PROCESSING', started_at = now(), updated_at = now()
      WHERE id = (
        SELECT id FROM jobs
        WHERE status IN ('QUEUED','RETRYING') AND cancel_requested = false
        ORDER BY created_at
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      RETURNING *
    `.execute(getDb()),
  );
  const row = result.rows[0];
  return row ? toJob(row) : null;
}
