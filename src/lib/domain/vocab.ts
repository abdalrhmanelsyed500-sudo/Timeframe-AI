import { z } from "zod";

/** Controlled vocabularies. The AI may never invent values outside these sets. */

export const VISUAL_INTENTS = [
  "ESTABLISHING",
  "WIDE",
  "MEDIUM",
  "CLOSE_UP",
  "EXTREME_CLOSE_UP",
  "OVER_SHOULDER",
  "TOP_DOWN",
  "LOW_ANGLE",
  "HIGH_ANGLE",
  "DETAIL",
  "ENVIRONMENTAL",
  "ABSTRACT",
  "ARCHIVAL",
  "MAP",
  "DIAGRAM",
  "OBJECT_FOCUS",
  "CHARACTER_FOCUS",
] as const;

export const CAMERAS = [
  "STATIC",
  "PAN_LEFT",
  "PAN_RIGHT",
  "TILT_UP",
  "TILT_DOWN",
  "DOLLY_IN",
  "DOLLY_OUT",
  "TRACKING",
  "CRANE",
  "HANDHELD",
  "ORBIT",
] as const;

export const LENSES = ["24mm", "28mm", "35mm", "50mm", "85mm", "100mm", "135mm"] as const;

export const MOTIONS = [
  "STATIC",
  "SLOW_ZOOM_IN",
  "SLOW_ZOOM_OUT",
  "PAN_LEFT",
  "PAN_RIGHT",
  "PAN_UP",
  "PAN_DOWN",
  "PUSH_IN",
  "PULL_OUT",
  "DRIFT_LEFT",
  "DRIFT_RIGHT",
] as const;

/** Only transitions the renderer actually implements are exposed. */
export const TRANSITIONS = ["CUT", "FADE", "DIP_TO_BLACK", "CROSSFADE"] as const;

export const ENTITY_TYPES = [
  "CHARACTER",
  "LOCATION",
  "BUILDING",
  "VEHICLE",
  "OBJECT",
  "CREATURE",
  "ORGANIZATION",
  "LANDMARK",
] as const;

export const TONES = ["NEUTRAL", "SOMBRE", "HOPEFUL", "TENSE", "TRIUMPHANT", "REFLECTIVE", "URGENT", "WONDROUS"] as const;

export const PACINGS = ["SLOW", "MEDIUM", "FAST"] as const;

export const QUALITY_PRESETS = ["FAST", "BALANCED", "QUALITY"] as const;

export const QUALITY_GATES = ["PASS", "WARNINGS", "NEEDS_REVIEW", "FAIL"] as const;

export const OVERLAY_KINDS = ["TITLE", "SUBTITLE", "LABEL", "EMPHASIS", "ANNOTATION"] as const;

export type VisualIntent = (typeof VISUAL_INTENTS)[number];
export type Camera = (typeof CAMERAS)[number];
export type Lens = (typeof LENSES)[number];
export type Motion = (typeof MOTIONS)[number];
export type Transition = (typeof TRANSITIONS)[number];
export type EntityType = (typeof ENTITY_TYPES)[number];
export type Tone = (typeof TONES)[number];
export type Pacing = (typeof PACINGS)[number];
export type QualityPreset = (typeof QUALITY_PRESETS)[number];
export type QualityGate = (typeof QUALITY_GATES)[number];
export type OverlayKind = (typeof OVERLAY_KINDS)[number];

export const zVisualIntent = z.enum(VISUAL_INTENTS);
export const zCamera = z.enum(CAMERAS);
export const zLens = z.enum(LENSES);
export const zMotion = z.enum(MOTIONS);
export const zTransition = z.enum(TRANSITIONS);
export const zEntityType = z.enum(ENTITY_TYPES);
export const zTone = z.enum(TONES);
export const zPacing = z.enum(PACINGS);
export const zQualityPreset = z.enum(QUALITY_PRESETS);
export const zQualityGate = z.enum(QUALITY_GATES);

/** Coerce an arbitrary AI string onto the nearest allowed vocabulary value. */
export function coerceEnum<T extends readonly string[]>(value: unknown, allowed: T, fallback: T[number]): T[number] {
  if (typeof value !== "string") return fallback;
  const norm = value.trim().toUpperCase().replace(/[\s-]+/g, "_");
  const direct = allowed.find((a) => a.toUpperCase() === norm);
  if (direct) return direct;
  const partial = allowed.find((a) => norm.includes(a.toUpperCase()) || a.toUpperCase().includes(norm));
  return partial ?? fallback;
}

export function coerceLens(value: unknown): Lens {
  if (typeof value === "string") {
    const m = /(\d{2,3})\s*mm/i.exec(value);
    if (m) {
      const n = Number(m[1]);
      let best: Lens = LENSES[0];
      let bestDiff = Infinity;
      for (const l of LENSES) {
        const diff = Math.abs(Number(l.replace("mm", "")) - n);
        if (diff < bestDiff) {
          bestDiff = diff;
          best = l;
        }
      }
      return best;
    }
  }
  return "35mm";
}
