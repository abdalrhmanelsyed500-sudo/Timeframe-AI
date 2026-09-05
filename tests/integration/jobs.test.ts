import "../helpers/env";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cleanupUser, dbAvailable, makeProject, makeUser } from "../helpers/fixtures";
import {
  cancelJob,
  claimNextJob,
  completeJob,
  enqueue,
  failJob,
  getJob,
  jobCancelRequested,
  listJobs,
  markProcessing,
  progress,
  recoverStaleJobs,
} from "@/lib/services/jobs";
import { db, dbGuard } from "@/lib/db";
import { AppError } from "@/lib/errors";

const available = await dbAvailable();
const d = available ? describe : describe.skip;
if (!available) {
  console.warn("SKIPPED: integration/jobs — PostgreSQL is not reachable at DATABASE_URL.");
}

d("job queue (real PostgreSQL)", () => {
  let userId: string;
  let projectId: string;

  beforeAll(async () => {
    const user = await makeUser("jobs");
    userId = user.id;
    projectId = (await makeProject(userId)).id;
  });

  afterAll(async () => {
    if (userId) await cleanupUser(userId);
  });

  it("persists a queued job that survives a fresh read", async () => {
    const { job, created } = await enqueue({ userId, projectId, type: "STORY_ANALYZE", total: 5 });
    expect(created).toBe(true);
    expect(job.status).toBe("QUEUED");
    const reread = await getJob(job.id, userId);
    expect(reread?.id).toBe(job.id);
    expect(reread?.total).toBe(5);
  });

  it("is idempotent for the same idempotency key", async () => {
    const key = `idem-${Date.now()}`;
    const a = await enqueue({ userId, projectId, type: "TIMELINE_GENERATE", idempotencyKey: key });
    const b = await enqueue({ userId, projectId, type: "TIMELINE_GENERATE", idempotencyKey: key });
    expect(b.created).toBe(false);
    expect(b.job.id).toBe(a.job.id);
  });

  it("allows a retry after a failure with the same key", async () => {
    const key = `idem-fail-${Date.now()}`;
    const a = await enqueue({ userId, projectId, type: "ASSET_BATCH", idempotencyKey: key });
    await failJob(a.job.id, new AppError("VALIDATION_ERROR", "nope"), { userId, projectId });
    const b = await enqueue({ userId, projectId, type: "ASSET_BATCH", idempotencyKey: key });
    expect(b.created).toBe(true);
    expect(b.job.id).not.toBe(a.job.id);
  });

  it("claims each job exactly once under concurrency", async () => {
    // Drain anything already queued so the count is exact.
    while (await claimNextJob()) { /* drain */ }
    const ids = new Set<string>();
    for (let i = 0; i < 6; i++) {
      const { job } = await enqueue({ userId, projectId, type: "ASSET_GENERATE", payload: { i } });
      ids.add(job.id);
    }
    const claimed = await Promise.all(Array.from({ length: 10 }, () => claimNextJob()));
    const claimedIds = claimed.filter(Boolean).map((j) => j!.id);
    expect(new Set(claimedIds).size).toBe(claimedIds.length); // no double-claim
    expect(new Set(claimedIds)).toEqual(ids);
    expect(claimed.filter((j) => j === null).length).toBe(4);
  });

  it("records progress durably in the database", async () => {
    const { job } = await enqueue({ userId, projectId, type: "ASSET_BATCH", total: 10 });
    await markProcessing(job.id);
    await progress(job.id, { completed: 4, message: "Generating visuals" });
    const row = await getJob(job.id, userId);
    expect(row?.status).toBe("PROCESSING");
    expect(row?.completed).toBe(4);
    expect(row?.message).toBe("Generating visuals");
  });

  it("stores a completion result", async () => {
    const { job } = await enqueue({ userId, projectId, type: "VIDEO_QC" });
    await completeJob(job.id, { ok: true, frames: 120 });
    const row = await getJob(job.id, userId);
    expect(row?.status).toBe("COMPLETED");
    expect(row?.result).toMatchObject({ ok: true, frames: 120 });
  });

  it("stores a failure with a safe message and no stack trace", async () => {
    const { job } = await enqueue({ userId, projectId, type: "VIDEO_RENDER" });
    await failJob(job.id, new AppError("RENDER_ERROR", "FFmpeg exited with status 1"), { userId, projectId });
    const row = await getJob(job.id, userId);
    expect(row?.status).toBe("FAILED");
    expect(row?.errorMessage).toContain("FFmpeg");
    expect(row?.errorCode).toBe("RENDER_ERROR");
    expect(JSON.stringify(row)).not.toContain("at Object.");
  });

  it("honours a cancellation request", async () => {
    const { job } = await enqueue({ userId, projectId, type: "ASSET_BATCH" });
    await markProcessing(job.id);
    await cancelJob(job.id, userId);
    expect(await jobCancelRequested(job.id)).toBe(true);
  });

  it("requeues jobs abandoned by a dead worker", async () => {
    const { job } = await enqueue({ userId, projectId, type: "CINEMATIC_ANALYZE" });
    await markProcessing(job.id);
    await dbGuard(() =>
      db
        .updateTable("jobs")
        .set({ updated_at: new Date(Date.now() - 60 * 60_000) })
        .where("id", "=", job.id)
        .execute(),
    );
    const recovered = await recoverStaleJobs(15 * 60_000);
    expect(recovered).toBeGreaterThanOrEqual(1);
    expect((await getJob(job.id, userId))?.status).toBe("QUEUED");
  });

  it("never leaks another user's job", async () => {
    const other = await makeUser("jobs-other");
    try {
      const { job } = await enqueue({ userId, projectId, type: "STORY_ANALYZE" });
      expect(await getJob(job.id, other.id)).toBeNull();
      const theirs = await listJobs({ userId: other.id });
      expect(theirs.items.every((j) => j.userId === other.id)).toBe(true);
      await expect(cancelJob(job.id, other.id)).rejects.toThrowError(AppError);
    } finally {
      await cleanupUser(other.id);
    }
  });

  it("paginates the job list", async () => {
    const page = await listJobs({ userId, limit: 3, offset: 0 });
    expect(page.items.length).toBeLessThanOrEqual(3);
    expect(page.total).toBeGreaterThan(0);
  });
});
