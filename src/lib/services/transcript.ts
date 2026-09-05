import { db, dbGuard } from "@/lib/db";
import { newId } from "@/lib/core/ids";
import { contentHash } from "@/lib/core/hash";
import { AppError } from "@/lib/errors";
import { cleanText } from "@/lib/security/sanitize";
import { detectFormat, normalizeSegments, parseTranscript, type RawSegment } from "@/lib/transcript/parse";
import { audit } from "./audit";
import { markStoryStale } from "./stale";
import { advanceStatus, type ProjectRecord } from "./projects";
import { requireAudio } from "./audio";

export interface TranscriptSegment {
  id: string;
  idx: number;
  startMs: number;
  endMs: number;
  text: string;
}

export interface TranscriptRecord {
  id: string;
  projectId: string;
  source: string;
  language: string;
  contentHash: string;
  segmentCount: number;
}

export async function getTranscript(projectId: string): Promise<TranscriptRecord | null> {
  const row = await dbGuard(() =>
    db.selectFrom("transcripts").selectAll().where("project_id", "=", projectId).executeTakeFirst(),
  );
  if (!row) return null;
  const count = await dbGuard(() =>
    db
      .selectFrom("transcript_segments")
      .select((eb) => eb.fn.countAll<string>().as("c"))
      .where("transcript_id", "=", row.id)
      .executeTakeFirst(),
  );
  return {
    id: row.id,
    projectId: row.project_id,
    source: row.source,
    language: row.language,
    contentHash: row.content_hash,
    segmentCount: Number(count?.c ?? 0),
  };
}

export async function listSegments(
  transcriptId: string,
  opts: { limit?: number; offset?: number } = {},
): Promise<{ items: TranscriptSegment[]; total: number }> {
  const limit = Math.min(2000, Math.max(1, opts.limit ?? 500));
  const offset = Math.max(0, opts.offset ?? 0);
  const rows = await dbGuard(() =>
    db
      .selectFrom("transcript_segments")
      .selectAll()
      .where("transcript_id", "=", transcriptId)
      .orderBy("idx")
      .limit(limit)
      .offset(offset)
      .execute(),
  );
  const total = Number(
    (
      await dbGuard(() =>
        db
          .selectFrom("transcript_segments")
          .select((eb) => eb.fn.countAll<string>().as("c"))
          .where("transcript_id", "=", transcriptId)
          .executeTakeFirst(),
      )
    )?.c ?? 0,
  );
  return {
    items: rows.map((r) => ({ id: r.id, idx: r.idx, startMs: r.start_ms, endMs: r.end_ms, text: r.text })),
    total,
  };
}

export async function allSegments(projectId: string): Promise<TranscriptSegment[]> {
  const t = await getTranscript(projectId);
  if (!t) return [];
  const rows = await dbGuard(() =>
    db.selectFrom("transcript_segments").selectAll().where("transcript_id", "=", t.id).orderBy("idx").execute(),
  );
  return rows.map((r) => ({ id: r.id, idx: r.idx, startMs: r.start_ms, endMs: r.end_ms, text: r.text }));
}

export async function importTranscript(params: {
  project: ProjectRecord;
  userId: string;
  filename: string;
  content: string;
  source?: string;
  language?: string;
}): Promise<TranscriptRecord> {
  const audio = await requireAudio(params.project.id);
  const format = detectFormat(params.filename, params.content);
  const parsed = parseTranscript(params.content, format, { audioDurationMs: audio.durationMs });
  return persistSegments({
    project: params.project,
    userId: params.userId,
    segments: parsed,
    audioDurationMs: audio.durationMs,
    source: params.source ?? `import:${format}`,
    language: params.language ?? "en",
  });
}

export async function persistSegments(params: {
  project: ProjectRecord;
  userId: string;
  segments: RawSegment[];
  audioDurationMs: number;
  source: string;
  language?: string;
}): Promise<TranscriptRecord> {
  const normalized = normalizeSegments(params.segments, params.audioDurationMs).map((s) => ({
    ...s,
    text: cleanText(s.text, 2000),
  }));
  if (normalized.length === 0) throw new AppError("VALIDATION_ERROR", "The transcript contains no usable segments.");

  const hash = contentHash(normalized);
  const existing = await getTranscript(params.project.id);
  const transcriptId = existing?.id ?? newId("tr");

  await dbGuard(async () => {
    await db.transaction().execute(async (trx) => {
      await trx
        .insertInto("transcripts")
        .values({
          id: transcriptId,
          project_id: params.project.id,
          source: params.source,
          language: params.language ?? "en",
          content_hash: hash,
        })
        .onConflict((oc) =>
          oc.column("project_id").doUpdateSet({ source: params.source, content_hash: hash, updated_at: new Date() }),
        )
        .execute();

      await trx.deleteFrom("transcript_segments").where("transcript_id", "=", transcriptId).execute();

      const rows = normalized.map((s, i) => ({
        id: newId("seg"),
        transcript_id: transcriptId,
        idx: i,
        start_ms: s.startMs,
        end_ms: s.endMs,
        text: s.text,
      }));
      // Insert in batches so very long transcripts don't exceed parameter limits.
      for (let i = 0; i < rows.length; i += 500) {
        await trx.insertInto("transcript_segments").values(rows.slice(i, i + 500)).execute();
      }
    });
  });

  if (existing && existing.contentHash !== hash) await markStoryStale(params.project.id);

  await advanceStatus(params.project, "TRANSCRIPT_READY");
  await audit({
    userId: params.userId,
    projectId: params.project.id,
    action: "transcript.imported",
    metadata: { segments: normalized.length, source: params.source },
  });

  const result = await getTranscript(params.project.id);
  if (!result) throw new AppError("INTERNAL_ERROR", "The transcript could not be saved.");
  return result;
}

export async function updateSegment(params: {
  projectId: string;
  segmentId: string;
  startMs?: number;
  endMs?: number;
  text?: string;
}): Promise<void> {
  const t = await getTranscript(params.projectId);
  if (!t) throw new AppError("NOT_FOUND", "This project has no transcript.");
  const seg = await dbGuard(() =>
    db
      .selectFrom("transcript_segments")
      .selectAll()
      .where("id", "=", params.segmentId)
      .where("transcript_id", "=", t.id)
      .executeTakeFirst(),
  );
  if (!seg) throw new AppError("NOT_FOUND", "That transcript segment does not exist.");

  const startMs = params.startMs ?? seg.start_ms;
  const endMs = params.endMs ?? seg.end_ms;
  if (endMs <= startMs) throw new AppError("VALIDATION_ERROR", "A segment must end after it starts.");

  await dbGuard(() =>
    db
      .updateTable("transcript_segments")
      .set({ start_ms: startMs, end_ms: endMs, text: cleanText(params.text ?? seg.text, 2000) })
      .where("id", "=", params.segmentId)
      .execute(),
  );
  await rehash(params.projectId, t.id);
  await markStoryStale(params.projectId);
}

export async function splitSegment(projectId: string, segmentId: string, atMs: number): Promise<void> {
  const segs = await allSegments(projectId);
  const target = segs.find((s) => s.id === segmentId);
  if (!target) throw new AppError("NOT_FOUND", "That transcript segment does not exist.");
  if (atMs <= target.startMs || atMs >= target.endMs) {
    throw new AppError("VALIDATION_ERROR", "The split point must fall inside the segment.");
  }
  const words = target.text.split(/\s+/);
  const ratio = (atMs - target.startMs) / (target.endMs - target.startMs);
  const cut = Math.max(1, Math.min(words.length - 1, Math.round(words.length * ratio)));
  const rebuilt: RawSegment[] = segs.flatMap((s) =>
    s.id === segmentId
      ? [
          { startMs: s.startMs, endMs: atMs, text: words.slice(0, cut).join(" ") },
          { startMs: atMs, endMs: s.endMs, text: words.slice(cut).join(" ") },
        ]
      : [{ startMs: s.startMs, endMs: s.endMs, text: s.text }],
  );
  await rewrite(projectId, rebuilt);
}

export async function mergeSegment(projectId: string, segmentId: string): Promise<void> {
  const segs = await allSegments(projectId);
  const idx = segs.findIndex((s) => s.id === segmentId);
  if (idx < 0) throw new AppError("NOT_FOUND", "That transcript segment does not exist.");
  if (idx === segs.length - 1) throw new AppError("VALIDATION_ERROR", "There is no following segment to merge with.");
  const rebuilt: RawSegment[] = [];
  for (let i = 0; i < segs.length; i++) {
    if (i === idx) {
      rebuilt.push({ startMs: segs[i].startMs, endMs: segs[i + 1].endMs, text: `${segs[i].text} ${segs[i + 1].text}`.trim() });
      i++;
    } else rebuilt.push({ startMs: segs[i].startMs, endMs: segs[i].endMs, text: segs[i].text });
  }
  await rewrite(projectId, rebuilt);
}

async function rewrite(projectId: string, segments: RawSegment[]): Promise<void> {
  const t = await getTranscript(projectId);
  if (!t) throw new AppError("NOT_FOUND", "This project has no transcript.");
  const audio = await requireAudio(projectId);
  const normalized = normalizeSegments(segments, audio.durationMs);
  await dbGuard(() =>
    db.transaction().execute(async (trx) => {
      await trx.deleteFrom("transcript_segments").where("transcript_id", "=", t.id).execute();
      const rows = normalized.map((s, i) => ({
        id: newId("seg"),
        transcript_id: t.id,
        idx: i,
        start_ms: s.startMs,
        end_ms: s.endMs,
        text: s.text,
      }));
      for (let i = 0; i < rows.length; i += 500) {
        await trx.insertInto("transcript_segments").values(rows.slice(i, i + 500)).execute();
      }
      await trx
        .updateTable("transcripts")
        .set({ content_hash: contentHash(normalized), updated_at: new Date() })
        .where("id", "=", t.id)
        .execute();
    }),
  );
  await markStoryStale(projectId);
}

async function rehash(projectId: string, transcriptId: string): Promise<void> {
  const segs = await allSegments(projectId);
  await dbGuard(() =>
    db
      .updateTable("transcripts")
      .set({ content_hash: contentHash(segs.map((s) => ({ startMs: s.startMs, endMs: s.endMs, text: s.text }))), updated_at: new Date() })
      .where("id", "=", transcriptId)
      .execute(),
  );
}
