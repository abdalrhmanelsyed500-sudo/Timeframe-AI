import "./env";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { db, dbGuard, pingDb } from "@/lib/db";
import { newId } from "@/lib/core/ids";
import { hashPassword } from "@/lib/security/auth";
import { createProject } from "@/lib/services/projects";
import { findFfmpeg, findFfprobe } from "@/lib/render/ffmpeg";

export async function dbAvailable(): Promise<boolean> {
  try {
    return await pingDb();
  } catch {
    return false;
  }
}

export function ffmpegAvailable(): boolean {
  return Boolean(findFfmpeg() && findFfprobe());
}

export const TEST_PASSWORD = "correct-horse-battery-staple";

// bcrypt is deliberately slow; every fixture user shares one computed hash.
let cachedHash: string | null = null;
async function fixtureHash(): Promise<string> {
  if (!cachedHash) cachedHash = await hashPassword(TEST_PASSWORD);
  return cachedHash;
}

export async function makeUser(prefix = "u"): Promise<{ id: string; email: string }> {
  const id = newId("usr");
  const email = `${prefix}-${id}@example.test`;
  const passwordHash = await fixtureHash();
  await dbGuard(() =>
    db.insertInto("users").values({ id, email, name: "Test User", password_hash: passwordHash, role: "USER" }).execute(),
  );
  return { id, email };
}

export async function makeProject(userId: string, name = "Integration project") {
  return createProject({ userId, name, styleKey: "CINEMATIC_DOCUMENTARY", aspectRatio: "16:9" });
}

/** Generates a REAL wav file with FFmpeg — no fake bytes, no stubbed durations. */
export function makeWav(durationSeconds: number): Buffer {
  const ffmpeg = findFfmpeg();
  if (!ffmpeg) throw new Error("ffmpeg unavailable");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tf-fixture-"));
  const out = path.join(dir, "tone.wav");
  try {
    execFileSync(
      ffmpeg,
      [
        "-y", "-hide_banner", "-loglevel", "error",
        "-f", "lavfi", "-i", `sine=frequency=220:duration=${durationSeconds}`,
        "-ar", "44100", "-ac", "1", out,
      ],
      { stdio: "ignore" },
    );
    return fs.readFileSync(out);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

export function srtFor(lines: { startMs: number; endMs: number; text: string }[]): string {
  const t = (ms: number) => {
    const h = String(Math.floor(ms / 3_600_000)).padStart(2, "0");
    const m = String(Math.floor(ms / 60_000) % 60).padStart(2, "0");
    const s = String(Math.floor(ms / 1000) % 60).padStart(2, "0");
    const x = String(ms % 1000).padStart(3, "0");
    return `${h}:${m}:${s},${x}`;
  };
  return lines.map((l, i) => `${i + 1}\n${t(l.startMs)} --> ${t(l.endMs)}\n${l.text}\n`).join("\n");
}

export async function cleanupUser(userId: string): Promise<void> {
  await dbGuard(() => db.deleteFrom("users").where("id", "=", userId).execute());
}
