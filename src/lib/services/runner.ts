import { db, dbGuard } from "@/lib/db";
import { AppError, isTransient, toAppError } from "@/lib/errors";
import { requireProject, setProjectStatus, type ProjectRecord } from "./projects";
import { analyzeStory } from "./story";
import { generateVisualBible } from "./visual-bible";
import { generateAssetForShot, pendingShots } from "./assets";
import { generateTimeline } from "./timeline";
import { runCinematicAnalysis } from "./cinematic";
import { executeRender } from "./render";
import { completeJob, failJob, jobCancelRequested, progress, type JobRecord } from "./jobs";
import { notify } from "./audit";

/**
 * Executes one job. Retries only transient failures; permanent failures
 * (validation, auth, schema) fail immediately rather than burning quota.
 */
const MAX_ATTEMPTS = 3;

export async function runJob(job: JobRecord): Promise<void> {
  try {
    const project = job.projectId ? await requireProject(job.projectId, job.userId) : null;
    const result = await withRetry(() => dispatch(job, project));
    await completeJob(job.id, result);
    await notifyCompletion(job, result);
  } catch (e) {
    await failJob(job.id, e, { userId: job.userId, projectId: job.projectId });
    await notify({
      userId: job.userId,
      projectId: job.projectId,
      level: "ERROR",
      title: `${humanJobType(job.type)} failed`,
      body: toAppError(e).message,
    }).catch(() => {});
  }
}

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e;
      if (!isTransient(e) || attempt === MAX_ATTEMPTS) throw e;
      // Exponential backoff with a deterministic ceiling.
      await sleep(Math.min(30_000, 1000 * 2 ** attempt));
    }
  }
  throw lastError;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function dispatch(job: JobRecord, project: ProjectRecord | null): Promise<Record<string, unknown>> {
  switch (job.type) {
    case "STORY_ANALYZE":
    case "STORY_REGENERATE": {
      const p = requireP(project);
      const plan = await analyzeStory({
        project: p,
        userId: job.userId,
        onProgress: (u) => progress(job.id, u),
      });
      return { storyPlanId: plan.id, version: plan.version, shots: plan.shotCount };
    }

    case "VISUAL_BIBLE_GENERATE": {
      const p = requireP(project);
      await progress(job.id, { message: "Designing the visual world", completed: 0, total: 1 });
      const bible = await generateVisualBible({ project: p, userId: job.userId });
      return { visualBibleId: bible.id, version: bible.version, entities: bible.entities.length };
    }

    case "ASSET_BATCH":
    case "ASSET_GENERATE": {
      const p = requireP(project);
      return runAssetBatch(job, p);
    }

    case "TIMELINE_GENERATE": {
      const p = requireP(project);
      await progress(job.id, { message: "Assembling the timeline", completed: 0, total: 1 });
      const { timeline, corrections, validation } = await generateTimeline({ project: p, userId: job.userId });
      return {
        timelineId: timeline.id,
        version: timeline.version,
        clips: timeline.doc.clips.length,
        corrections,
        valid: validation.valid,
      };
    }

    case "CINEMATIC_ANALYZE": {
      const p = requireP(project);
      await progress(job.id, { message: "Reviewing the edit", completed: 0, total: 1 });
      const report = await runCinematicAnalysis({ project: p, userId: job.userId });
      return { reportId: report.id, gate: report.gate, score: report.overallScore, issues: report.issues.length };
    }

    case "VIDEO_RENDER": {
      const p = requireP(project);
      const renderId = String(job.payload.renderId ?? "");
      if (!renderId) throw new AppError("VALIDATION_ERROR", "The render job is missing its render id.");
      await progress(job.id, { message: "Rendering video", completed: 0, total: 1 });
      const render = await executeRender({ renderId, project: p, userId: job.userId });
      return { renderId: render.id, status: render.status, artifactId: render.artifact?.id ?? null };
    }

    default:
      throw new AppError("VALIDATION_ERROR", `Job type ${job.type} is not available.`);
  }
}

async function runAssetBatch(job: JobRecord, project: ProjectRecord): Promise<Record<string, unknown>> {
  const regenerateFailed = Boolean(job.payload.regenerateFailed);
  const explicitShotIds = Array.isArray(job.payload.shotIds) ? (job.payload.shotIds as string[]) : null;

  const all = await pendingShots(project.id, { regenerateFailed });
  const shots = explicitShotIds ? await shotsByIds(project.id, explicitShotIds) : all;

  if (shots.length === 0) {
    await setProjectStatus(project.id, project.status, "VISUALS_READY").catch(() => {});
    return { generated: 0, failed: 0, message: "Every shot already has an approved image." };
  }

  await setProjectStatus(project.id, project.status, "VISUALS_GENERATING").catch(() => {});
  await progress(job.id, { message: `Generating visual assets`, completed: 0, total: shots.length });

  // Bounded concurrency respecting the provider's declared limit.
  const concurrency = Math.max(1, Math.min(4, Number(job.payload.concurrency ?? 3)));
  let completed = 0;
  let failed = 0;
  const failures: { shotId: string; message: string }[] = [];
  let index = 0;

  async function worker() {
    for (;;) {
      const i = index++;
      if (i >= shots.length) return;
      if (await jobCancelRequested(job.id)) throw new AppError("RENDER_ERROR", "Generation was cancelled.");
      const shot = shots[i];
      try {
        await generateAssetForShot({ project, userId: job.userId, shot, force: regenerateFailed });
        completed++;
      } catch (e) {
        failed++;
        const err = toAppError(e);
        failures.push({ shotId: shot.id, message: err.message });
        // A non-transient provider/config failure aborts the whole batch:
        // burning quota on hundreds of doomed calls helps nobody.
        if (err.code === "CONFIGURATION_ERROR" || err.code === "COST_LIMIT_ERROR" || err.code === "AUTH_ERROR") throw e;
      }
      await progress(job.id, {
        message: `Generating visual assets — ${completed + failed} of ${shots.length} shots`,
        completed: completed + failed,
        total: shots.length,
        failed,
      });
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, shots.length) }, worker));

  const nextStatus = failed === 0 ? "VISUALS_READY" : "VISUALS_READY";
  await setProjectStatus(project.id, "VISUALS_GENERATING", nextStatus).catch(() => {});

  return {
    generated: completed,
    failed,
    total: shots.length,
    // Partial failures are reported explicitly, never hidden.
    failures: failures.slice(0, 25),
  };
}

async function shotsByIds(projectId: string, ids: string[]) {
  const rows = await dbGuard(() =>
    db.selectFrom("shots").selectAll().where("project_id", "=", projectId).where("id", "in", ids.slice(0, 250)).orderBy("start_ms").execute(),
  );
  return rows.map((s) => ({
    id: s.id,
    sceneId: s.scene_id,
    idx: s.idx,
    startMs: s.start_ms,
    endMs: s.end_ms,
    narrationText: s.narration_text,
    visualIntent: s.visual_intent as never,
    subject: s.subject,
    action: s.action,
    environment: s.environment,
    composition: s.composition,
    camera: s.camera,
    lens: s.lens,
    lighting: s.lighting,
    color: s.color,
    atmosphere: s.atmosphere,
    entityNames: Array.isArray(s.entity_names) ? (s.entity_names as string[]) : [],
    transition: s.transition,
    motion: s.motion,
  }));
}

function requireP(project: ProjectRecord | null): ProjectRecord {
  if (!project) throw new AppError("VALIDATION_ERROR", "This job requires a project.");
  return project;
}

export function humanJobType(type: string): string {
  const map: Record<string, string> = {
    STORY_ANALYZE: "Story analysis",
    STORY_REGENERATE: "Story regeneration",
    VISUAL_BIBLE_GENERATE: "Visual bible",
    ASSET_BATCH: "Asset generation",
    ASSET_GENERATE: "Asset generation",
    TIMELINE_GENERATE: "Timeline build",
    CINEMATIC_ANALYZE: "Cinematic QA",
    VIDEO_RENDER: "Render",
    TRANSCRIBE_AUDIO: "Transcription",
  };
  return map[type] ?? type;
}

async function notifyCompletion(job: JobRecord, result: Record<string, unknown>): Promise<void> {
  // Only meaningful milestones notify — no spam for micro-events.
  const notable = new Set(["STORY_ANALYZE", "ASSET_BATCH", "CINEMATIC_ANALYZE", "VIDEO_RENDER"]);
  if (!notable.has(job.type)) return;
  if (job.type === "VIDEO_RENDER") return; // the render service already notifies
  await notify({
    userId: job.userId,
    projectId: job.projectId,
    level: "SUCCESS",
    title: `${humanJobType(job.type)} finished`,
    body: summarize(job.type, result),
  }).catch(() => {});
}

function summarize(type: string, result: Record<string, unknown>): string {
  if (type === "STORY_ANALYZE") return `Planned ${result.shots ?? 0} shots.`;
  if (type === "ASSET_BATCH") return `Generated ${result.generated ?? 0} images${Number(result.failed ?? 0) > 0 ? `, ${result.failed} failed` : ""}.`;
  if (type === "CINEMATIC_ANALYZE") return `Quality gate: ${result.gate}, score ${Math.round(Number(result.score ?? 0) * 100)}%.`;
  return "";
}
