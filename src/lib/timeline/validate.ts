import type { TimelineDoc } from "./types";

export interface TimelineViolation {
  code:
    | "NEGATIVE_START"
    | "INVALID_RANGE"
    | "EXCEEDS_DURATION"
    | "OVERLAP"
    | "GAP"
    | "MISSING_ASSET"
    | "EMPTY_TIMELINE"
    | "OVERLAY_OUT_OF_RANGE";
  message: string;
  clipId?: string;
  shotId?: string;
}

export interface ValidationResult {
  valid: boolean;
  violations: TimelineViolation[];
  /** Blocking violations prevent rendering entirely. */
  blocking: TimelineViolation[];
}

const BLOCKING = new Set(["NEGATIVE_START", "INVALID_RANGE", "EXCEEDS_DURATION", "OVERLAP", "GAP", "MISSING_ASSET", "EMPTY_TIMELINE"]);

/**
 * Timeline invariants:
 *   0 <= startMs, startMs < endMs, endMs <= audioDuration,
 *   clips are contiguous and ordered, every clip has a selected asset.
 */
export function validateTimeline(doc: TimelineDoc): ValidationResult {
  const violations: TimelineViolation[] = [];

  if (doc.clips.length === 0) {
    violations.push({ code: "EMPTY_TIMELINE", message: "The timeline contains no clips." });
  }

  const clips = [...doc.clips].sort((a, b) => a.startMs - b.startMs);
  let cursor = 0;

  for (const clip of clips) {
    if (clip.startMs < 0) {
      violations.push({ code: "NEGATIVE_START", message: "A clip starts before zero.", clipId: clip.clipId, shotId: clip.shotId });
    }
    if (clip.endMs <= clip.startMs) {
      violations.push({
        code: "INVALID_RANGE",
        message: `Clip for shot ${clip.shotId} ends at or before it starts.`,
        clipId: clip.clipId,
        shotId: clip.shotId,
      });
    }
    if (clip.endMs > doc.durationMs) {
      violations.push({
        code: "EXCEEDS_DURATION",
        message: `Clip for shot ${clip.shotId} extends past the end of the audio.`,
        clipId: clip.clipId,
        shotId: clip.shotId,
      });
    }
    if (clip.startMs < cursor) {
      violations.push({
        code: "OVERLAP",
        message: `Clip for shot ${clip.shotId} overlaps the previous clip by ${cursor - clip.startMs}ms.`,
        clipId: clip.clipId,
        shotId: clip.shotId,
      });
    } else if (clip.startMs > cursor) {
      violations.push({
        code: "GAP",
        message: `There is a ${clip.startMs - cursor}ms gap before the clip for shot ${clip.shotId}.`,
        clipId: clip.clipId,
        shotId: clip.shotId,
      });
    }
    if (!clip.assetVersionId || !clip.storageKey) {
      violations.push({
        code: "MISSING_ASSET",
        message: `No image is selected for shot ${clip.shotId}.`,
        clipId: clip.clipId,
        shotId: clip.shotId,
      });
    }
    cursor = Math.max(cursor, clip.endMs);
  }

  if (clips.length && cursor !== doc.durationMs) {
    violations.push({
      code: "GAP",
      message: `The timeline ends ${doc.durationMs - cursor}ms before the audio does.`,
    });
  }

  for (const o of doc.overlays) {
    if (o.startMs < 0 || o.endMs > doc.durationMs || o.endMs <= o.startMs) {
      violations.push({ code: "OVERLAY_OUT_OF_RANGE", message: `Overlay "${o.text.slice(0, 40)}" falls outside the timeline.` });
    }
  }

  const blocking = violations.filter((v) => BLOCKING.has(v.code));
  return { valid: blocking.length === 0, violations, blocking };
}
