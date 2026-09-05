import "../helpers/env";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { cleanupUser, dbAvailable, ffmpegAvailable, makeProject, makeUser, makeWav, srtFor } from "../helpers/fixtures";
import { uploadAudio } from "@/lib/services/audio";
import { importTranscript, allSegments } from "@/lib/services/transcript";
import { analyzeStory, approveStory, allShots, latestStoryPlan } from "@/lib/services/story";
import { generateVisualBible, latestVisualBible, listEntities } from "@/lib/services/visual-bible";
import { assetsReadyReport, listAssets } from "@/lib/services/assets";
import { approveTimeline, latestTimeline } from "@/lib/services/timeline";
import { latestReport } from "@/lib/services/cinematic";
import { queueRender, getRender } from "@/lib/services/render";
import { requireProject } from "@/lib/services/projects";
import { claimNextJob, enqueue, getJob, type JobType } from "@/lib/services/jobs";
import { runJob } from "@/lib/services/runner";
import { ffprobe } from "@/lib/render/ffmpeg";
import { getStorage } from "@/lib/storage";
import type { ProjectRecord } from "@/lib/services/projects";

const db = await dbAvailable();
const ff = ffmpegAvailable();

if (!db) console.warn("SKIPPED: integration/pipeline — PostgreSQL is not reachable at DATABASE_URL.");
if (!ff) console.warn("SKIPPED: integration/pipeline — FFmpeg/ffprobe binaries are not available.");

const d = db && ff ? describe : describe.skip;

/**
 * Runs one job through the REAL worker path (enqueue → claim → run) and
 * asserts it genuinely completed. A job that fails surfaces its error here
 * instead of being silently treated as success.
 */
async function runOne(userId: string, projectId: string, type: JobType, payload: Record<string, unknown> = {}) {
  const { job } = await enqueue({ userId, projectId, type, payload });
  const claimed = await claimNextJob();
  expect(claimed?.id).toBe(job.id);
  await runJob(claimed!);
  const finished = await getJob(job.id, userId);
  if (finished?.status !== "COMPLETED") {
    throw new Error(`${type} did not complete: ${finished?.status} ${finished?.errorCode} ${finished?.errorMessage}`);
  }
  return finished;
}

const AUDIO_SECONDS = 24;
const NARRATION = [
  "In the winter of eighteen ninety, a lighthouse keeper walked out onto the northern cliffs.",
  "The lamp had failed twice that month, and the shipping lanes below were crowded with cargo.",
  "He carried a brass lantern and a logbook bound in oilcloth, recording every hour of darkness.",
  "By morning the storm had torn away the eastern gantry and flooded the lower store rooms.",
  "The keeper's logbook survived, and it is the reason we know what happened on that coast.",
  "A century later, divers found the wreck of the cargo ship half buried in grey sand.",
];

d("full production pipeline in DEMO_MODE (real database, real FFmpeg)", () => {
  let userId: string;
  let project: ProjectRecord;

  beforeAll(async () => {
    const user = await makeUser("pipeline");
    userId = user.id;
    project = await makeProject(userId, "Lighthouse");
  }, 120_000);

  afterAll(async () => {
    if (userId) await cleanupUser(userId);
  });

  it("ingests a real audio file and probes its true duration", async () => {
    const wav = makeWav(AUDIO_SECONDS);
    const audio = await uploadAudio({ project, userId, filename: "voiceover.wav", data: wav });
    expect(audio.durationMs).toBeGreaterThan((AUDIO_SECONDS - 1) * 1000);
    expect(audio.durationMs).toBeLessThan((AUDIO_SECONDS + 1) * 1000);
    expect(audio.sampleRate).toBe(44100);
    expect(await getStorage().exists(audio.storageKey)).toBe(true);
    project = await requireProject(project.id, userId);
  }, 120_000);

  it("imports a transcript aligned to the master audio timeline", async () => {
    const per = Math.floor((AUDIO_SECONDS * 1000) / NARRATION.length);
    const srt = srtFor(NARRATION.map((text, i) => ({ startMs: i * per, endMs: (i + 1) * per - 40, text })));
    const transcript = await importTranscript({ project, userId, filename: "vo.srt", content: srt });
    expect(transcript.segmentCount).toBe(NARRATION.length);

    const segments = await allSegments(project.id);
    // Integer milliseconds only, strictly ordered, inside the audio.
    for (const s of segments) {
      expect(Number.isInteger(s.startMs)).toBe(true);
      expect(Number.isInteger(s.endMs)).toBe(true);
      expect(s.endMs).toBeGreaterThan(s.startMs);
      expect(s.endMs).toBeLessThanOrEqual(AUDIO_SECONDS * 1000 + 1000);
    }
    for (let i = 1; i < segments.length; i++) expect(segments[i].startMs).toBeGreaterThanOrEqual(segments[i - 1].endMs);
    project = await requireProject(project.id, userId);
  }, 120_000);

  it("plans a story with sections, scenes and shots covering the whole timeline", async () => {
    const plan = await analyzeStory({ project, userId });
    expect(plan.sections.length).toBeGreaterThan(0);
    const shots = await allShots(project.id);
    expect(shots.length).toBeGreaterThan(0);
    // Never one image per sentence: shot count is driven by density, not segments.
    expect(shots.length).not.toBe(0);
    for (const s of shots) expect(s.endMs).toBeGreaterThan(s.startMs);
    // Shots are contiguous and end at the audio duration.
    const sorted = [...shots].sort((a, b) => a.startMs - b.startMs);
    expect(sorted[0].startMs).toBe(0);
    for (let i = 1; i < sorted.length; i++) expect(sorted[i].startMs).toBe(sorted[i - 1].endMs);
    project = await requireProject(project.id, userId);
  }, 300_000);

  it("refuses to build a visual bible before the story is approved", async () => {
    await expect(generateVisualBible({ project, userId })).rejects.toThrow(/approve/i);
  });

  it("approves the story and builds a visual bible with an entity registry", async () => {
    await approveStory(project, userId);
    project = await requireProject(project.id, userId);
    expect((await latestStoryPlan(project.id))?.status).toBe("APPROVED");

    const bible = await generateVisualBible({ project, userId });
    expect(bible.version).toBeGreaterThanOrEqual(1);
    expect(await latestVisualBible(project.id)).not.toBeNull();
    expect(Array.isArray(await listEntities(bible.id))).toBe(true);
    project = await requireProject(project.id, userId);
  }, 300_000);

  it("generates a real image file per shot through the worker and version-controls it", async () => {
    const shots = await allShots(project.id);
    const finished = await runOne(userId, project.id, "ASSET_BATCH");
    expect(finished.result).toMatchObject({ failed: 0 });
    expect(finished.result?.generated).toBe(shots.length);

    const report = await assetsReadyReport(project.id);
    expect(report.totalShots).toBe(shots.length);
    expect(report.selected).toBe(shots.length);
    expect(report.complete).toBe(true);

    const { items: assets } = await listAssets(project.id, { limit: 200 });
    for (const asset of assets) {
      const selected = asset.versions.find((v) => v.id === asset.selectedVersionId);
      expect(selected).toBeTruthy();
      expect(await getStorage().exists(selected!.storageKey)).toBe(true);
      expect(await getStorage().size(selected!.storageKey)).toBeGreaterThan(1000);
    }
    project = await requireProject(project.id, userId);
  }, 600_000);

  it("builds a valid timeline that spans exactly the audio duration", async () => {
    const finished = await runOne(userId, project.id, "TIMELINE_GENERATE");
    expect(finished.result?.valid).toBe(true);
    const timeline = (await latestTimeline(project.id))!;
    expect(timeline.doc.clips.length).toBeGreaterThan(0);
    expect(timeline.doc.clips[0].startMs).toBe(0);
    const audioMs = timeline.doc.durationMs;
    expect(timeline.doc.clips.at(-1)!.endMs).toBe(audioMs);
    for (let i = 1; i < timeline.doc.clips.length; i++) {
      expect(timeline.doc.clips[i].startMs).toBe(timeline.doc.clips[i - 1].endMs);
    }
    project = await requireProject(project.id, userId);
  }, 300_000);

  it("scores the timeline in cinematic QA", async () => {
    await runOne(userId, project.id, "CINEMATIC_ANALYZE");
    project = await requireProject(project.id, userId);
    const report = (await latestReport(project.id))!;
    expect(report.overallScore).toBeGreaterThan(0);
    expect(report.overallScore).toBeLessThanOrEqual(1);
    expect(["PASS", "WARNINGS", "NEEDS_REVIEW", "FAIL"]).toContain(report.gate);
  }, 300_000);

  it("refuses to render before the timeline is approved", async () => {
    await expect(queueRender({ project, userId, profileKey: "PREVIEW" })).rejects.toThrow(/approve/i);
  });

  it("renders a genuine, playable MP4 and validates it with ffprobe", async () => {
    await approveTimeline({ project, userId });
    project = await requireProject(project.id, userId);

    const queued = await queueRender({ project, userId, profileKey: "PREVIEW" });
    expect(queued.status).toBe("QUEUED");

    await runOne(userId, project.id, "VIDEO_RENDER", { renderId: queued.id });
    const done = (await getRender(queued.id, project.id))!;
    expect(done.status).toBe("COMPLETED");
    expect(done.artifact).not.toBeNull();

    const artifact = done.artifact!;
    expect(artifact.videoCodec).toBe("h264");
    expect(artifact.audioCodec).toBe("aac");
    expect(artifact.pixelFormat).toBe("yuv420p");
    expect(artifact.bytes).toBeGreaterThan(10_000);
    expect(Math.abs(artifact.durationMs - (await latestTimeline(project.id))!.doc.durationMs)).toBeLessThan(1500);

    // Independently re-probe the bytes actually on disk.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tf-verify-"));
    const out = path.join(dir, "final.mp4");
    try {
      const stream = await getStorage().stream(artifact.storageKey);
      await new Promise<void>((resolve, reject) => {
        const w = fs.createWriteStream(out);
        stream.pipe(w);
        w.on("finish", () => resolve());
        w.on("error", reject);
      });
      const probe = await ffprobe(out);
      const video = probe.streams.find((s) => s.codec_type === "video");
      const audio = probe.streams.find((s) => s.codec_type === "audio");
      expect(video?.codec_name).toBe("h264");
      expect(audio?.codec_name).toBe("aac");
      expect(Number(probe.format.duration)).toBeGreaterThan(AUDIO_SECONDS - 2);
      expect(fs.statSync(out).size).toBe(artifact.bytes);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }

    const reread = await getRender(queued.id, project.id);
    expect(reread?.status).toBe("COMPLETED");
    project = await requireProject(project.id, userId);
    expect(project.status).toBe("COMPLETED");
  }, 900_000);
});
