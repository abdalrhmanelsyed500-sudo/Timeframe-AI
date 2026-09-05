import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { iso } from "@/lib/core/dates";
import { db, dbGuard } from "@/lib/db";
import { newId } from "@/lib/core/ids";
import { sha256 } from "@/lib/core/hash";
import { AppError, toAppError } from "@/lib/errors";
import { getStorage, storageKey } from "@/lib/storage";
import { getStyle } from "@/lib/domain/styles";
import { runFfmpeg, findFfmpeg } from "@/lib/render/ffmpeg";
import { getProfile, type RenderProfile } from "@/lib/render/profiles";
import { planRender } from "@/lib/render/plan";
import { validateRenderOutput } from "@/lib/render/qc";
import { validateTimeline } from "@/lib/timeline/validate";
import { audit, notify, recordError } from "./audit";
import { advanceStatus, setProjectStatus, type ProjectRecord } from "./projects";
import { audioLocalPath, requireAudio } from "./audio";
import { latestTimeline } from "./timeline";
import { trackStorage } from "./storage-usage";

/** Long-form videos are rendered in chunks and concatenated. */
const CHUNK_MS = 10 * 60_000;
const FONT_CANDIDATES = [
  "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
  "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
  "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
  "/System/Library/Fonts/Helvetica.ttc",
];

function findFont(): string | null {
  return FONT_CANDIDATES.find((p) => existsSync(p)) ?? null;
}

export interface RenderRecord {
  id: string;
  projectId: string;
  timelineId: string;
  profile: string;
  status: string;
  progress: number;
  stage: string;
  errorCode: string | null;
  errorMessage: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  artifact: ArtifactRecord | null;
}

export interface ArtifactRecord {
  id: string;
  storageKey: string;
  mime: string;
  bytes: number;
  durationMs: number;
  width: number;
  height: number;
  fps: number;
  videoCodec: string;
  audioCodec: string | null;
  pixelFormat: string | null;
  avSyncMs: number;
  contentHash: string;
  status: string;
  createdAt: string;
}

export async function listRenders(projectId: string, limit = 20): Promise<RenderRecord[]> {
  const rows = await dbGuard(() =>
    db.selectFrom("renders").selectAll().where("project_id", "=", projectId).orderBy("created_at", "desc").limit(limit).execute(),
  );
  const ids = rows.map((r) => r.id);
  const artifacts = ids.length
    ? await dbGuard(() => db.selectFrom("render_artifacts").selectAll().where("render_id", "in", ids).execute())
    : [];
  const byRender = new Map(artifacts.map((a) => [a.render_id, a]));
  return rows.map((r) => toRender(r, byRender.get(r.id)));
}

export async function getRender(renderId: string, projectId: string): Promise<RenderRecord | null> {
  const row = await dbGuard(() =>
    db.selectFrom("renders").selectAll().where("id", "=", renderId).where("project_id", "=", projectId).executeTakeFirst(),
  );
  if (!row) return null;
  const artifact = await dbGuard(() => db.selectFrom("render_artifacts").selectAll().where("render_id", "=", row.id).executeTakeFirst());
  return toRender(row, artifact);
}

export async function latestCompletedRender(projectId: string): Promise<RenderRecord | null> {
  const row = await dbGuard(() =>
    db
      .selectFrom("renders")
      .selectAll()
      .where("project_id", "=", projectId)
      .where("status", "=", "COMPLETED")
      .orderBy("created_at", "desc")
      .executeTakeFirst(),
  );
  if (!row) return null;
  const artifact = await dbGuard(() => db.selectFrom("render_artifacts").selectAll().where("render_id", "=", row.id).executeTakeFirst());
  return toRender(row, artifact);
}

type RenderRow = {
  id: string;
  project_id: string;
  timeline_id: string;
  profile: string;
  status: string;
  progress: number;
  stage: string;
  error_code: string | null;
  error_message: string | null;
  started_at: unknown;
  finished_at: unknown;
  created_at: unknown;
};

type ArtifactRow = {
  id: string;
  storage_key: string;
  mime: string;
  bytes: string | number;
  duration_ms: number;
  width: number;
  height: number;
  fps: number;
  video_codec: string;
  audio_codec: string | null;
  pixel_format: string | null;
  av_sync_ms: number;
  content_hash: string;
  status: string;
  created_at: unknown;
};

function toRender(r: RenderRow, a?: ArtifactRow): RenderRecord {
  return {
    id: r.id,
    projectId: r.project_id,
    timelineId: r.timeline_id,
    profile: r.profile,
    status: r.status,
    progress: r.progress,
    stage: r.stage,
    errorCode: r.error_code,
    errorMessage: r.error_message,
    startedAt: r.started_at ? iso(r.started_at) : null,
    finishedAt: r.finished_at ? iso(r.finished_at) : null,
    createdAt: iso(r.created_at),
    artifact: a
      ? {
          id: a.id,
          storageKey: a.storage_key,
          mime: a.mime,
          bytes: Number(a.bytes),
          durationMs: a.duration_ms,
          width: a.width,
          height: a.height,
          fps: a.fps,
          videoCodec: a.video_codec,
          audioCodec: a.audio_codec,
          pixelFormat: a.pixel_format,
          avSyncMs: a.av_sync_ms,
          contentHash: a.content_hash,
          status: a.status,
          createdAt: iso(a.created_at),
        }
      : null,
  };
}

/** Create the render row. Execution happens in a worker, never in the request. */
export async function queueRender(params: {
  project: ProjectRecord;
  userId: string;
  profileKey: string;
}): Promise<RenderRecord> {
  if (!findFfmpeg()) {
    throw new AppError("CONFIGURATION_ERROR", "Video rendering is unavailable because FFmpeg is not installed on the server.");
  }
  const timeline = await latestTimeline(params.project.id);
  if (!timeline) throw new AppError("STATE_ERROR", "Build and approve a timeline before rendering.");
  if (timeline.status !== "APPROVED") throw new AppError("STATE_ERROR", "Approve the timeline before rendering.");
  if (timeline.stale) throw new AppError("STATE_ERROR", "The timeline is out of date. Rebuild and re-approve it before rendering.");

  const validation = validateTimeline(timeline.doc);
  if (!validation.valid) {
    throw new AppError("QUALITY_ERROR", "This timeline cannot be rendered yet.", {
      context: { blocking: validation.blocking.map((v) => v.message) },
    });
  }

  const id = newId("rnd");
  await dbGuard(() =>
    db
      .insertInto("renders")
      .values({
        id,
        project_id: params.project.id,
        timeline_id: timeline.id,
        profile: getProfile(params.profileKey).key,
        status: "QUEUED",
        stage: "QUEUED",
        progress: 0,
      })
      .execute(),
  );
  await audit({ userId: params.userId, projectId: params.project.id, action: "render.started", targetId: id, metadata: { profile: params.profileKey } });
  const record = await getRender(id, params.project.id);
  if (!record) throw new AppError("INTERNAL_ERROR", "The render could not be queued.");
  return record;
}

export async function requestCancel(renderId: string, projectId: string, userId: string): Promise<void> {
  const render = await getRender(renderId, projectId);
  if (!render) throw new AppError("NOT_FOUND", "That render does not exist.");
  if (render.status === "COMPLETED" || render.status === "FAILED") return;
  await dbGuard(() => db.updateTable("renders").set({ cancel_requested: true }).where("id", "=", renderId).execute());
  await audit({ userId, projectId, action: "render.cancelled", targetId: renderId });
}

async function isCancelled(renderId: string): Promise<boolean> {
  const row = await dbGuard(() => db.selectFrom("renders").select(["cancel_requested"]).where("id", "=", renderId).executeTakeFirst());
  return Boolean(row?.cancel_requested);
}

async function updateRender(renderId: string, patch: Record<string, unknown>): Promise<void> {
  await dbGuard(() => db.updateTable("renders").set(patch).where("id", "=", renderId).execute());
}

/**
 * Execute a render. Runs in a background worker.
 * A COMPLETED status is only ever written after ffprobe validation passes.
 */
export async function executeRender(params: { renderId: string; project: ProjectRecord; userId: string }): Promise<RenderRecord> {
  const { renderId, project, userId } = params;
  const render = await getRender(renderId, project.id);
  if (!render) throw new AppError("NOT_FOUND", "That render does not exist.");

  const profile = getProfile(render.profile);
  const timeline = await latestTimeline(project.id);
  if (!timeline || timeline.id !== render.timelineId) {
    await failRender(renderId, project, userId, new AppError("STATE_ERROR", "The timeline changed after this render was queued."));
    throw new AppError("STATE_ERROR", "The timeline changed after this render was queued.");
  }

  const audio = await requireAudio(project.id);
  const style = getStyle(project.styleKey);
  const storage = getStorage();
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "tf-render-"));
  let audioCleanup: (() => Promise<void>) | null = null;

  try {
    await updateRender(renderId, { status: "PROCESSING", stage: "PREPARING", started_at: new Date(), progress: 0.01 });
    await setProjectStatus(project.id, project.status, "RENDERING").catch(() => {});

    // Materialise every referenced image locally, verifying each one exists.
    const imagePaths = new Map<string, string>();
    for (const clip of timeline.doc.clips) {
      if (!clip.storageKey) {
        throw new AppError("RENDER_ERROR", `Shot ${clip.shotId} has no selected image.`, { context: { shotId: clip.shotId } });
      }
      if (imagePaths.has(clip.shotId)) continue;
      const local = storage.localPath(clip.storageKey);
      if (local && existsSync(local)) {
        imagePaths.set(clip.shotId, local);
      } else {
        const buf = await storage.get(clip.storageKey);
        const p = path.join(workDir, `${clip.shotId}.png`);
        await fs.writeFile(p, buf);
        imagePaths.set(clip.shotId, p);
      }
    }

    const audioLocal = await audioLocalPath(audio);
    audioCleanup = audioLocal.cleanup;

    const totalMs = timeline.doc.durationMs;
    const chunks: { startMs: number; endMs: number }[] = [];
    for (let start = 0; start < totalMs; start += CHUNK_MS) {
      chunks.push({ startMs: start, endMs: Math.min(totalMs, start + CHUNK_MS) });
    }

    const chunkFiles: string[] = [];
    const font = findFont();

    for (let i = 0; i < chunks.length; i++) {
      if (await isCancelled(renderId)) throw new AppError("RENDER_ERROR", "The render was cancelled.");

      const chunk = chunks[i];
      const outPath = path.join(workDir, `chunk-${String(i).padStart(4, "0")}.mp4`);
      const plan = planRender({
        doc: timeline.doc,
        style,
        profile,
        audioPath: audioLocal.path,
        imagePaths,
        outputPath: outPath,
        fontPath: font,
        window: chunks.length > 1 ? chunk : undefined,
      });

      const chunkDurationMs = chunk.endMs - chunk.startMs;
      const chunkBase = chunk.startMs / totalMs;
      const chunkSpan = chunkDurationMs / totalMs;

      await updateRender(renderId, {
        stage: chunks.length > 1 ? `ENCODING_CHUNK_${i + 1}_OF_${chunks.length}` : "ENCODING",
        progress: Math.max(0.02, chunkBase * 0.9),
      });

      // Progress is throttled so a long render does not hammer the database.
      let lastWrite = 0;
      await runFfmpeg(plan.args, {
        timeoutMs: 6 * 60 * 60_000,
        onProgress: ({ outTimeMs }) => {
          const now = Date.now();
          if (now - lastWrite < 1000) return;
          lastWrite = now;
          const withinChunk = Math.min(1, outTimeMs / Math.max(1, chunkDurationMs));
          void updateRender(renderId, {
            progress: Math.min(0.9, (chunkBase + chunkSpan * withinChunk) * 0.9),
          }).catch(() => {});
        },
      }).catch((e) => {
        throw toAppError(e);
      });
      // Every chunk is validated before it is allowed into the concatenation.
      const chunkQc = await validateRenderOutput(outPath, {
        profile,
        durationMs: chunkDurationMs,
        requireAudio: true,
      });
      if (!chunkQc.ok) {
        throw new AppError("RENDER_ERROR", "A rendered segment failed validation.", { context: { problems: chunkQc.problems, chunk: i } });
      }
      chunkFiles.push(outPath);
      await updateRender(renderId, { progress: Math.min(0.9, (chunkBase + chunkSpan) * 0.9) });
    }

    // Concatenate chunks (stream copy — no re-encode, no quality loss).
    let finalPath: string;
    if (chunkFiles.length === 1) {
      finalPath = chunkFiles[0];
    } else {
      await updateRender(renderId, { stage: "CONCATENATING", progress: 0.92 });
      const listPath = path.join(workDir, "concat.txt");
      await fs.writeFile(listPath, chunkFiles.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join("\n"));
      finalPath = path.join(workDir, "final.mp4");
      await runFfmpeg(["-y", "-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", "-movflags", "+faststart", finalPath]);
    }

    if (await isCancelled(renderId)) throw new AppError("RENDER_ERROR", "The render was cancelled.");

    // Final ffprobe validation of the delivered artefact.
    await updateRender(renderId, { stage: "VALIDATING", progress: 0.95 });
    const qc = await validateRenderOutput(finalPath, { profile, durationMs: totalMs, requireAudio: true });
    if (!qc.ok) {
      throw new AppError("RENDER_ERROR", "The finished video failed validation.", { context: { problems: qc.problems } });
    }

    const data = await fs.readFile(finalPath);
    const hash = sha256(data);
    const key = storageKey({ projectId: project.id, category: "renders", scope: renderId, contentHash: hash, ext: "mp4" });
    await storage.put(key, data, "video/mp4");
    await trackStorage({ key, userId, projectId: project.id, category: "render", bytes: data.byteLength, mime: "video/mp4" });

    await dbGuard(() =>
      db
        .insertInto("render_artifacts")
        .values({
          id: newId("art"),
          render_id: renderId,
          storage_key: key,
          mime: "video/mp4",
          bytes: data.byteLength,
          duration_ms: qc.durationMs,
          width: qc.width,
          height: qc.height,
          fps: qc.fps,
          video_codec: qc.videoCodec,
          audio_codec: qc.audioCodec,
          pixel_format: qc.pixelFormat,
          av_sync_ms: qc.avSyncMs,
          content_hash: hash,
          status: "VALID",
        })
        .execute(),
    );

    await updateRender(renderId, { status: "COMPLETED", stage: "COMPLETED", progress: 1, finished_at: new Date(), error_code: null, error_message: null });
    await advanceStatus({ ...project, status: "RENDERING" }, "COMPLETED");
    await audit({ userId, projectId: project.id, action: "render.completed", targetId: renderId, metadata: { profile: profile.key, bytes: data.byteLength } });
    await notify({ userId, projectId: project.id, level: "SUCCESS", title: "Your video is ready", body: `${project.name} finished rendering at ${profile.name}.` });

    const result = await getRender(renderId, project.id);
    if (!result) throw new AppError("INTERNAL_ERROR", "The render record disappeared.");
    return result;
  } catch (e) {
    await failRender(renderId, project, userId, e);
    throw e;
  } finally {
    await audioCleanup?.().catch(() => {});
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function failRender(renderId: string, project: ProjectRecord, userId: string, e: unknown): Promise<void> {
  const appError = toAppError(e);
  const cancelled = /cancelled/i.test(appError.message);
  await updateRender(renderId, {
    status: cancelled ? "CANCELLED" : "FAILED",
    stage: cancelled ? "CANCELLED" : "FAILED",
    finished_at: new Date(),
    error_code: appError.code,
    error_message: appError.message,
  }).catch(() => {});
  await setProjectStatus(project.id, "RENDERING", cancelled ? "READY_TO_RENDER" : "FAILED").catch(() => {});
  await recordError({
    userId,
    projectId: project.id,
    code: appError.code,
    message: appError.message,
    context: appError.context,
  });
  if (!cancelled) {
    await audit({ userId, projectId: project.id, action: "render.failed", targetId: renderId, metadata: { code: appError.code } });
    await notify({ userId, projectId: project.id, level: "ERROR", title: "Render failed", body: appError.message });
  }
}

export type { RenderProfile };
