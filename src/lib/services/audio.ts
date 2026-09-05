import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { db, dbGuard } from "@/lib/db";
import { newId } from "@/lib/core/ids";
import { sha256 } from "@/lib/core/hash";
import { AppError } from "@/lib/errors";
import { loadEnv } from "@/lib/env";
import { getStorage, storageKey } from "@/lib/storage";
import { AUDIO_MIME, assertAudioBuffer } from "@/lib/storage/validate";
import { probeAudio } from "@/lib/render/ffmpeg";
import { safeFilename } from "@/lib/security/sanitize";
import { audit } from "./audit";
import { markStoryStale } from "./stale";
import type { ProjectRecord } from "./projects";
import { advanceStatus } from "./projects";
import { trackStorage, untrackStorage } from "./storage-usage";

export interface AudioRecord {
  id: string;
  projectId: string;
  filename: string;
  mime: string;
  bytes: number;
  durationMs: number;
  sampleRate: number | null;
  channels: number | null;
  codec: string | null;
  storageKey: string;
  contentHash: string;
}

export async function getAudio(projectId: string): Promise<AudioRecord | null> {
  const row = await dbGuard(() => db.selectFrom("audios").selectAll().where("project_id", "=", projectId).executeTakeFirst());
  if (!row) return null;
  return {
    id: row.id,
    projectId: row.project_id,
    filename: row.filename,
    mime: row.mime,
    bytes: Number(row.bytes),
    durationMs: row.duration_ms,
    sampleRate: row.sample_rate,
    channels: row.channels,
    codec: row.codec,
    storageKey: row.storage_key,
    contentHash: row.content_hash,
  };
}

export async function requireAudio(projectId: string): Promise<AudioRecord> {
  const audio = await getAudio(projectId);
  if (!audio) throw new AppError("STATE_ERROR", "Upload a voiceover before continuing.");
  return audio;
}

/**
 * Upload pipeline: signature check → probe with ffprobe → store → persist.
 * The probed duration becomes the project's authoritative timeline length.
 */
export async function uploadAudio(params: {
  project: ProjectRecord;
  userId: string;
  filename: string;
  data: Buffer;
}): Promise<AudioRecord> {
  const env = loadEnv();
  const format = assertAudioBuffer(params.data, env.MAX_UPLOAD_BYTES);
  const hash = sha256(params.data);
  const cleanName = safeFilename(params.filename, `audio.${format}`);

  // ffprobe needs a real path; write to a temp file, always cleaned up.
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "tf-audio-"));
  const tmpPath = path.join(tmpDir, `probe.${format}`);
  let meta: Awaited<ReturnType<typeof probeAudio>>;
  try {
    await fs.writeFile(tmpPath, params.data);
    meta = await probeAudio(tmpPath);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }

  if (meta.durationMs < 1000) {
    throw new AppError("VALIDATION_ERROR", "The voiceover must be at least one second long.");
  }

  const key = storageKey({ projectId: params.project.id, category: "audio", contentHash: hash, ext: format });
  await getStorage().put(key, params.data, AUDIO_MIME[format]);

  const existing = await getAudio(params.project.id);
  if (existing && existing.storageKey !== key) {
    await getStorage().delete(existing.storageKey);
    await untrackStorage(existing.storageKey);
  }

  await dbGuard(() =>
    db
      .insertInto("audios")
      .values({
        id: existing?.id ?? newId("aud"),
        project_id: params.project.id,
        storage_key: key,
        filename: cleanName,
        mime: AUDIO_MIME[format],
        bytes: params.data.byteLength,
        duration_ms: meta.durationMs,
        sample_rate: meta.sampleRate,
        channels: meta.channels,
        codec: meta.codec,
        content_hash: hash,
      })
      .onConflict((oc) =>
        oc.column("project_id").doUpdateSet({
          storage_key: key,
          filename: cleanName,
          mime: AUDIO_MIME[format],
          bytes: params.data.byteLength,
          duration_ms: meta.durationMs,
          sample_rate: meta.sampleRate,
          channels: meta.channels,
          codec: meta.codec,
          content_hash: hash,
        }),
      )
      .execute(),
  );

  await trackStorage({
    key,
    userId: params.userId,
    projectId: params.project.id,
    category: "audio",
    bytes: params.data.byteLength,
    mime: AUDIO_MIME[format],
  });

  // Changing the audio invalidates every downstream artefact.
  if (existing && existing.contentHash !== hash) await markStoryStale(params.project.id);

  await advanceStatus(params.project, "AUDIO_READY");
  await audit({
    userId: params.userId,
    projectId: params.project.id,
    action: "audio.uploaded",
    metadata: { durationMs: meta.durationMs, bytes: params.data.byteLength },
  });

  return requireAudio(params.project.id);
}

/** Materialise the audio to a local path FFmpeg can read. */
export async function audioLocalPath(audio: AudioRecord): Promise<{ path: string; cleanup: () => Promise<void> }> {
  const storage = getStorage();
  const local = storage.localPath(audio.storageKey);
  if (local) return { path: local, cleanup: async () => {} };
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "tf-aud-"));
  const p = path.join(dir, path.basename(audio.storageKey));
  await fs.writeFile(p, await storage.get(audio.storageKey));
  return { path: p, cleanup: () => fs.rm(dir, { recursive: true, force: true }) };
}
