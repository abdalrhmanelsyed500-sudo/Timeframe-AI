/**
 * Release smoke test — the real-provider gate.
 *
 * This exercises the pipeline against LIVE, BILLABLE providers. It is the only
 * place in the codebase that is allowed to do so, and it never runs by default.
 *
 *   REAL_PROVIDER_ENABLED=true SMOKE_USER_EMAIL=you@example.com npm run test:release
 *
 * Contract:
 *   - If real providers are not configured, every provider step reports SKIPPED.
 *   - A SKIPPED step is NEVER reported as a PASS and never turns the run green.
 *   - The exit code is 0 only if nothing FAILED; the summary always states how
 *     many steps were skipped so a skipped run can never be mistaken for a
 *     verified one.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { loadEnv } from "@/lib/env";
import { db, dbGuard, pingDb } from "@/lib/db";
import { findFfmpeg, findFfprobe, ffprobe } from "@/lib/render/ffmpeg";
import { providerMode } from "@/lib/ai/factory";
import { listPublicCredentials } from "@/lib/ai/credentials";
import { newId } from "@/lib/core/ids";
import { createProject, requireProject, deleteProject } from "@/lib/services/projects";
import { uploadAudio } from "@/lib/services/audio";
import { importTranscript } from "@/lib/services/transcript";
import { analyzeStory, approveStory, allShots } from "@/lib/services/story";
import { generateVisualBible } from "@/lib/services/visual-bible";
import { generateAssetForShot } from "@/lib/services/assets";
import { generateTimeline, approveTimeline } from "@/lib/services/timeline";
import { runCinematicAnalysis } from "@/lib/services/cinematic";
import { queueRender, executeRender } from "@/lib/services/render";

type Status = "PASS" | "FAIL" | "SKIPPED";
const steps: { name: string; status: Status; detail: string }[] = [];
function step(name: string, status: Status, detail: string) {
  steps.push({ name, status, detail });
  console.log(`  ${status.padEnd(8)} ${name} — ${detail}`);
}

const NARRATION = [
  "A single lighthouse stands on the northern cliffs, its lamp turning through the winter dark.",
  "The keeper recorded every hour of that storm in a logbook bound in oilcloth.",
  "By morning the eastern gantry was gone and the lower rooms were full of seawater.",
  "A century later, divers found the wreck of the cargo ship half buried in grey sand.",
];
const SECONDS = 16;

function srtTimestamp(ms: number): string {
  const p = (n: number, len = 2) => String(n).padStart(len, "0");
  return `${p(Math.floor(ms / 3_600_000))}:${p(Math.floor(ms / 60_000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
}

async function main() {
  const env = loadEnv();
  console.log("\nTIMEFRAME AI — release smoke test\n");

  if (!(await pingDb())) {
    step("Database", "FAIL", "The database is not reachable.");
    return finish();
  }
  step("Database", "PASS", "Connected.");

  const ffmpeg = findFfmpeg();
  const ffprobeBin = findFfprobe();
  if (!ffmpeg || !ffprobeBin) {
    step("FFmpeg toolchain", "SKIPPED", "FFmpeg/ffprobe are not installed; rendering cannot be verified.");
  } else {
    step("FFmpeg toolchain", "PASS", ffmpeg);
  }

  // ---- real provider gate -------------------------------------------------
  const email = process.env.SMOKE_USER_EMAIL;
  const user = email
    ? await dbGuard(() => db.selectFrom("users").selectAll().where("email", "=", email).executeTakeFirst())
    : undefined;

  if (!env.REAL_PROVIDER_ENABLED) {
    step("Real provider pipeline", "SKIPPED", "REAL_PROVIDER_ENABLED is not true. No live provider was called.");
    return finish();
  }
  if (env.DEMO_MODE) {
    step("Real provider pipeline", "FAIL", "DEMO_MODE and REAL_PROVIDER_ENABLED are both on; refusing to claim a real run.");
    return finish();
  }
  if (!email) {
    step("Real provider pipeline", "SKIPPED", "SMOKE_USER_EMAIL is not set, so no user credentials can be loaded.");
    return finish();
  }
  if (!user) {
    step("Real provider pipeline", "FAIL", `No user exists with email ${email}.`);
    return finish();
  }
  const credentials = await listPublicCredentials(user.id);
  if (credentials.length === 0) {
    step("Real provider pipeline", "SKIPPED", `User ${email} has no stored provider credentials.`);
    return finish();
  }
  if (providerMode() !== "real") {
    step("Real provider pipeline", "SKIPPED", "The provider factory did not resolve to real mode.");
    return finish();
  }
  step("Provider credentials", "PASS", credentials.map((c) => `${c.provider} (…${c.lastFour})`).join(", "));

  // ---- live run -----------------------------------------------------------
  const userId = user.id;
  let projectId: string | null = null;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tf-smoke-"));

  try {
    let project = await createProject({
      userId,
      name: `Release smoke ${newId("run")}`,
      styleKey: "CINEMATIC_DOCUMENTARY",
      aspectRatio: "16:9",
    });
    projectId = project.id;

    const wav = path.join(dir, "vo.wav");
    execFileSync(ffmpeg!, ["-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", `sine=frequency=210:duration=${SECONDS}`, "-ar", "44100", "-ac", "1", wav], { stdio: "ignore" });
    const audio = await uploadAudio({ project, userId, filename: "vo.wav", data: fs.readFileSync(wav) });
    project = await requireProject(project.id, userId);
    step("Audio ingest", "PASS", `${audio.durationMs} ms probed`);

    const per = Math.floor((SECONDS * 1000) / NARRATION.length);
    const srt = NARRATION.map((t, i) => `${i + 1}\n${srtTimestamp(i * per)} --> ${srtTimestamp((i + 1) * per - 60)}\n${t}\n`).join("\n");
    const transcript = await importTranscript({ project, userId, filename: "vo.srt", content: srt });
    project = await requireProject(project.id, userId);
    step("Transcript", "PASS", `${transcript.segmentCount} segments`);

    const plan = await analyzeStory({ project, userId });
    project = await requireProject(project.id, userId);
    step("Story analysis (live text model)", "PASS", `${plan.sections.length} sections, ${plan.shotCount} shots`);

    await approveStory(project, userId);
    project = await requireProject(project.id, userId);

    const bible = await generateVisualBible({ project, userId });
    project = await requireProject(project.id, userId);
    step("Visual bible (live text model)", "PASS", `${bible.entities.length} entities`);

    const shots = await allShots(project.id);
    let mockSeen = false;
    for (const shot of shots) {
      const result = await generateAssetForShot({ project, userId, shot });
      if (result.isMock) mockSeen = true;
    }
    project = await requireProject(project.id, userId);
    if (mockSeen) {
      step("Image generation (live image model)", "FAIL", "A mock image was produced during a real-provider run.");
    } else {
      step("Image generation (live image model)", "PASS", `${shots.length} real images generated and QC'd`);
    }

    const { timeline, validation } = await generateTimeline({ project, userId });
    project = await requireProject(project.id, userId);
    step("Timeline", validation.valid ? "PASS" : "FAIL", `v${timeline.version}, ${timeline.doc.clips.length} clips`);

    const report = await runCinematicAnalysis({ project, userId });
    project = await requireProject(project.id, userId);
    step("Cinematic QA", "PASS", `${report.gate}, score ${report.overallScore.toFixed(2)}`);

    if (!ffmpeg || !ffprobeBin) {
      step("Render", "SKIPPED", "FFmpeg is unavailable; no video was produced.");
    } else {
      await approveTimeline({ project, userId });
      project = await requireProject(project.id, userId);
      const queued = await queueRender({ project, userId, profileKey: "PREVIEW" });
      const done = await executeRender({ renderId: queued.id, project, userId });
      if (done.status !== "COMPLETED" || !done.artifact) {
        step("Render", "FAIL", `Render finished as ${done.status}.`);
      } else {
        const out = path.join(dir, "final.mp4");
        const { getStorage } = await import("@/lib/storage");
        const stream = await getStorage().stream(done.artifact.storageKey);
        await new Promise<void>((resolve, reject) => {
          const w = fs.createWriteStream(out);
          stream.pipe(w);
          w.on("finish", () => resolve());
          w.on("error", reject);
        });
        const probe = await ffprobe(out);
        const v = probe.streams.find((s) => s.codec_type === "video");
        const a = probe.streams.find((s) => s.codec_type === "audio");
        if (v?.codec_name === "h264" && a?.codec_name === "aac") {
          step("Render", "PASS", `${done.artifact.bytes} bytes, ${done.artifact.durationMs} ms, h264/aac`);
        } else {
          step("Render", "FAIL", `Unexpected codecs: ${v?.codec_name}/${a?.codec_name}`);
        }
      }
    }
  } catch (e) {
    step("Live pipeline", "FAIL", e instanceof Error ? e.message : String(e));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    if (projectId && process.env.SMOKE_KEEP !== "true") {
      await deleteProject(projectId, userId).catch(() => {});
    }
  }

  return finish();
}

function finish(): never {
  const failed = steps.filter((s) => s.status === "FAIL").length;
  const skipped = steps.filter((s) => s.status === "SKIPPED").length;
  const passed = steps.filter((s) => s.status === "PASS").length;

  console.log(`\n  ${passed} passed, ${failed} failed, ${skipped} skipped.`);
  if (failed > 0) {
    console.error("\ntest:release FAILED.");
    process.exit(1);
  }
  if (skipped > 0) {
    // Explicitly refuse to describe a skipped run as a verified one.
    console.log("\ntest:release completed with SKIPPED steps — real providers were NOT verified.");
    process.exit(0);
  }
  console.log("\ntest:release PASSED against live providers.");
  process.exit(0);
}

main().catch((e) => {
  console.error("test:release crashed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
