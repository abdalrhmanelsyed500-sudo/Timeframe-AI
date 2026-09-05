import { parseTimecode } from "@/lib/core/timecode";
import { AppError } from "@/lib/errors";

export interface RawSegment {
  startMs: number;
  endMs: number;
  text: string;
}

export type TranscriptFormat = "srt" | "vtt" | "json" | "csv" | "txt";

export function detectFormat(filename: string, content: string): TranscriptFormat {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  if (ext === "srt") return "srt";
  if (ext === "vtt") return "vtt";
  if (ext === "json") return "json";
  if (ext === "csv") return "csv";
  if (ext === "txt") return "txt";
  const head = content.slice(0, 200).trim();
  if (head.startsWith("WEBVTT")) return "vtt";
  if (head.startsWith("[") || head.startsWith("{")) return "json";
  if (/^\d+\s*\r?\n\d{2}:\d{2}:\d{2}[,.]\d{3}\s*-->/m.test(content)) return "srt";
  return "txt";
}

export function parseTranscript(
  content: string,
  format: TranscriptFormat,
  opts: { audioDurationMs: number },
): RawSegment[] {
  switch (format) {
    case "srt":
      return parseCueBased(content, /-->/);
    case "vtt":
      return parseCueBased(stripVttHeader(content), /-->/);
    case "json":
      return parseJson(content);
    case "csv":
      return parseCsv(content);
    case "txt":
      return parsePlainText(content, opts.audioDurationMs);
  }
}

function stripVttHeader(content: string): string {
  return content.replace(/^\uFEFF?WEBVTT[^\n]*\n/, "").replace(/^NOTE[\s\S]*?\n\n/gm, "");
}

function parseCueBased(content: string, arrow: RegExp): RawSegment[] {
  const blocks = content.replace(/\r\n/g, "\n").replace(/\uFEFF/g, "").split(/\n{2,}/);
  const out: RawSegment[] = [];
  for (const block of blocks) {
    const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) continue;
    const timeIdx = lines.findIndex((l) => arrow.test(l));
    if (timeIdx === -1) continue;
    const [left, right] = lines[timeIdx].split("-->").map((s) => s.trim());
    if (!left || !right) continue;
    const startMs = parseTimecode(left.split(/\s+/)[0]);
    const endMs = parseTimecode(right.split(/\s+/)[0]);
    const text = lines.slice(timeIdx + 1).join(" ").trim();
    if (!text) continue;
    out.push({ startMs, endMs, text });
  }
  if (out.length === 0) throw new AppError("VALIDATION_ERROR", "No subtitle cues found in the file.");
  return out;
}

function parseJson(content: string): RawSegment[] {
  let data: unknown;
  try {
    data = JSON.parse(content);
  } catch {
    throw new AppError("VALIDATION_ERROR", "Transcript JSON is not valid.");
  }
  const arr = Array.isArray(data)
    ? data
    : typeof data === "object" && data !== null && Array.isArray((data as { segments?: unknown[] }).segments)
      ? (data as { segments: unknown[] }).segments
      : null;
  if (!arr) throw new AppError("VALIDATION_ERROR", "Transcript JSON must be an array or { segments: [...] }.");

  return arr.map((raw, i) => {
    const o = raw as Record<string, unknown>;
    const start = o.startMs ?? o.start_ms ?? o.start ?? o.from;
    const end = o.endMs ?? o.end_ms ?? o.end ?? o.to;
    const text = o.text ?? o.content ?? o.caption;
    if (start === undefined || end === undefined || typeof text !== "string") {
      throw new AppError("VALIDATION_ERROR", `Transcript segment ${i + 1} is missing start, end or text.`);
    }
    return {
      startMs: coerceMs(start),
      endMs: coerceMs(end),
      text: text.trim(),
    };
  });
}

function coerceMs(v: unknown): number {
  if (typeof v === "number") {
    // Heuristic: values under 10000 with decimals are seconds; integers are ms.
    return Number.isInteger(v) ? v : Math.round(v * 1000);
  }
  if (typeof v === "string") return parseTimecode(v);
  throw new AppError("VALIDATION_ERROR", "Invalid time value in transcript.");
}

function parseCsv(content: string): RawSegment[] {
  const rows = splitCsv(content);
  if (rows.length === 0) throw new AppError("VALIDATION_ERROR", "CSV transcript is empty.");
  let start = 0;
  const header = rows[0].map((c) => c.toLowerCase().trim());
  if (header.some((h) => /start/.test(h))) start = 1;
  const out: RawSegment[] = [];
  for (let i = start; i < rows.length; i++) {
    const r = rows[i];
    if (r.length < 3 || r.every((c) => !c.trim())) continue;
    out.push({ startMs: coerceMs(r[0].trim()), endMs: coerceMs(r[1].trim()), text: r.slice(2).join(",").trim() });
  }
  if (out.length === 0) throw new AppError("VALIDATION_ERROR", "No usable rows in CSV transcript.");
  return out;
}

function splitCsv(content: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const s = content.replace(/\r\n/g, "\n");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.length > 1 || r[0]?.trim());
}

/**
 * Plain text has no timing: distribute segments proportionally to their
 * character length across the authoritative audio duration.
 */
function parsePlainText(content: string, audioDurationMs: number): RawSegment[] {
  if (audioDurationMs <= 0) {
    throw new AppError("VALIDATION_ERROR", "Plain-text transcripts require an uploaded audio track for timing.");
  }
  const sentences = content
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (sentences.length === 0) throw new AppError("VALIDATION_ERROR", "Transcript text is empty.");
  const totalChars = sentences.reduce((a, s) => a + s.length, 0);
  let cursor = 0;
  return sentences.map((text, i) => {
    const share = Math.round((text.length / totalChars) * audioDurationMs);
    const startMs = cursor;
    const endMs = i === sentences.length - 1 ? audioDurationMs : Math.min(audioDurationMs, cursor + Math.max(400, share));
    cursor = endMs;
    return { startMs, endMs, text };
  });
}

/**
 * Normalise segments: sort, clamp to audio duration, remove empties,
 * repair overlaps deterministically, drop zero-length segments.
 */
export function normalizeSegments(segments: RawSegment[], audioDurationMs: number): RawSegment[] {
  const cleaned = segments
    .map((s) => ({
      startMs: Math.max(0, Math.round(s.startMs)),
      endMs: Math.max(0, Math.round(s.endMs)),
      text: s.text.replace(/\s+/g, " ").trim(),
    }))
    .filter((s) => s.text.length > 0)
    .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);

  const out: RawSegment[] = [];
  for (const seg of cleaned) {
    let { startMs, endMs } = seg;
    if (audioDurationMs > 0) {
      startMs = Math.min(startMs, audioDurationMs);
      endMs = Math.min(endMs, audioDurationMs);
    }
    const prev = out[out.length - 1];
    if (prev && startMs < prev.endMs) startMs = prev.endMs;
    if (endMs <= startMs) {
      // Overlap repair collapsed the segment: merge its text into the previous cue.
      if (prev) prev.text = `${prev.text} ${seg.text}`.trim();
      continue;
    }
    out.push({ startMs, endMs, text: seg.text });
  }
  if (out.length === 0) throw new AppError("VALIDATION_ERROR", "Transcript contains no usable segments after normalisation.");
  return out;
}
