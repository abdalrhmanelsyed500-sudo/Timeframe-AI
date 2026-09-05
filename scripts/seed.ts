/**
 * Development seed.
 *
 * Creates a demo user and a project that has been carried through the REAL
 * pipeline (real audio file, real transcript parse, real story analysis, real
 * generated images, real timeline). Nothing here is hand-written fake state.
 *
 * Requires DEMO_MODE=true — this script must never be pointed at a production
 * database or a real, billable provider.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { loadEnv } from "@/lib/env";
import { db, dbGuard, pingDb } from "@/lib/db";
import { newId } from "@/lib/core/ids";
import { hashPassword } from "@/lib/security/auth";
import { createProject, requireProject } from "@/lib/services/projects";
import { uploadAudio } from "@/lib/services/audio";
import { importTranscript } from "@/lib/services/transcript";
import { analyzeStory, approveStory } from "@/lib/services/story";
import { generateVisualBible } from "@/lib/services/visual-bible";
import { generateAssetForShot, pendingShots } from "@/lib/services/assets";
import { generateTimeline } from "@/lib/services/timeline";
import { runCinematicAnalysis } from "@/lib/services/cinematic";
import { findFfmpeg } from "@/lib/render/ffmpeg";

const EMAIL = process.env.SEED_EMAIL ?? "demo@timeframe.local";
const PASSWORD = process.env.SEED_PASSWORD ?? "demo-password-1234";

const NARRATION = [
  "In the winter of eighteen ninety, a lighthouse keeper walked out onto the northern cliffs.",
  "The lamp had failed twice that month, and the shipping lanes below were crowded with cargo.",
  "He carried a brass lantern and a logbook bound in oilcloth, recording every hour of darkness.",
  "The wind came in from the north east, and the sea broke white across the lower rocks.",
  "By morning the storm had torn away the eastern gantry and flooded the lower store rooms.",
  "The keeper's logbook survived, and it is the reason we know what happened on that coast.",
  "A century later, divers found the wreck of the cargo ship half buried in grey sand.",
  "The lighthouse still stands, automated now, its lamp turning without anyone to watch it.",
];
const AUDIO_SECONDS = 32;

function srtTimestamp(ms: number): string {
  const p = (n: number, len = 2) => String(n).padStart(len, "0");
  return `${p(Math.floor(ms / 3_600_000))}:${p(Math.floor(ms / 60_000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
}

function makeToneWav(seconds: number): Buffer {
  const ffmpeg = findFfmpeg();
  if (!ffmpeg) throw new Error("CONFIGURATION_ERROR: FFmpeg is required to build the seed audio file.");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tf-seed-"));
  const out = path.join(dir, "voiceover.wav");
  try {
    execFileSync(
      ffmpeg,
      ["-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", `sine=frequency=200:duration=${seconds}`, "-ar", "44100", "-ac", "1", out],
      { stdio: "ignore" },
    );
    return fs.readFileSync(out);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function main() {
  const env = loadEnv();
  if (!env.DEMO_MODE) {
    console.error("CONFIGURATION_ERROR: seeding requires DEMO_MODE=true. Refusing to seed with real providers enabled.");
    process.exit(1);
  }
  if (env.NODE_ENV === "production") {
    console.error("CONFIGURATION_ERROR: refusing to seed a production environment.");
    process.exit(1);
  }
  if (!(await pingDb())) {
    console.error("CONFIGURATION_ERROR: the database is not reachable. Run `npm run db:start` and `npm run migrate` first.");
    process.exit(1);
  }

  const existing = await dbGuard(() => db.selectFrom("users").selectAll().where("email", "=", EMAIL).executeTakeFirst());
  let userId: string;
  if (existing) {
    userId = existing.id;
    console.log(`Using existing demo user ${EMAIL}.`);
  } else {
    userId = newId("usr");
    await dbGuard(() =>
      db
        .insertInto("users")
        .values({ id: userId, email: EMAIL, name: "Demo Producer", password_hash: "", role: "USER" })
        .execute(),
    );
    console.log(`Created demo user ${EMAIL}.`);
  }
  // Always reset the password so the documented credentials are guaranteed to work.
  const passwordHash = await hashPassword(PASSWORD);
  await dbGuard(() => db.updateTable("users").set({ password_hash: passwordHash }).where("id", "=", userId).execute());

  let project = await createProject({
    userId,
    name: "The Northern Light",
    description: "A seeded demo documentary generated end to end in DEMO_MODE.",
    styleKey: "CINEMATIC_DOCUMENTARY",
    aspectRatio: "16:9",
  });
  console.log(`Created project ${project.id}.`);

  console.log("Uploading voiceover…");
  const audio = await uploadAudio({ project, userId, filename: "voiceover.wav", data: makeToneWav(AUDIO_SECONDS) });
  project = await requireProject(project.id, userId);
  console.log(`  audio duration ${audio.durationMs} ms`);

  console.log("Importing transcript…");
  const per = Math.floor((AUDIO_SECONDS * 1000) / NARRATION.length);
  const srt = NARRATION.map(
    (text, i) => `${i + 1}\n${srtTimestamp(i * per)} --> ${srtTimestamp((i + 1) * per - 60)}\n${text}\n`,
  ).join("\n");
  const transcript = await importTranscript({ project, userId, filename: "voiceover.srt", content: srt });
  project = await requireProject(project.id, userId);
  console.log(`  ${transcript.segmentCount} segments`);

  console.log("Analysing story…");
  const plan = await analyzeStory({ project, userId });
  project = await requireProject(project.id, userId);
  console.log(`  ${plan.sections.length} sections, ${plan.shotCount} shots`);

  await approveStory(project, userId);
  project = await requireProject(project.id, userId);

  console.log("Generating visual bible…");
  const bible = await generateVisualBible({ project, userId });
  project = await requireProject(project.id, userId);
  console.log(`  ${bible.entities.length} registered entities`);

  console.log("Generating images…");
  const shots = await pendingShots(project.id);
  for (const [i, shot] of shots.entries()) {
    const result = await generateAssetForShot({ project, userId, shot });
    console.log(`  ${i + 1}/${shots.length} ${shot.id} → ${result.gate} (${result.score.toFixed(2)})`);
  }
  project = await requireProject(project.id, userId);

  console.log("Building timeline…");
  const { timeline, corrections } = await generateTimeline({ project, userId });
  project = await requireProject(project.id, userId);
  console.log(`  v${timeline.version}, ${timeline.doc.clips.length} clips, ${corrections.length} corrections`);

  console.log("Running cinematic QA…");
  const report = await runCinematicAnalysis({ project, userId });
  console.log(`  ${report.gate} — score ${report.overallScore.toFixed(2)}, ${report.issues.length} issues`);

  console.log("");
  console.log("Seed complete. The project is ready to approve and render in the UI.");
  console.log(`  email:    ${EMAIL}`);
  console.log(`  password: ${PASSWORD}`);
  console.log(`  project:  /projects/${project.id}`);
  process.exit(0);
}

main().catch((e) => {
  console.error("Seeding failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
