import { stableInt } from "@/lib/core/hash";
import type { StyleConfig } from "@/lib/domain/styles";
import type { Motion, VisualIntent } from "@/lib/domain/vocab";

/**
 * Deterministic motion engine.
 * Motion is selected from hash(shotId + duration + intent) — never Math.random —
 * so the same project always produces the same timeline.
 */

const SHORT_SHOT_MS = 800;

/** Intent → motions that read well cinematically for that framing. */
const PREFERRED: Partial<Record<VisualIntent, Motion[]>> = {
  ESTABLISHING: ["SLOW_ZOOM_IN", "PAN_RIGHT", "PAN_LEFT", "DRIFT_RIGHT"],
  WIDE: ["SLOW_ZOOM_IN", "PAN_LEFT", "PAN_RIGHT", "DRIFT_LEFT"],
  ENVIRONMENTAL: ["DRIFT_LEFT", "DRIFT_RIGHT", "SLOW_ZOOM_IN"],
  MEDIUM: ["SLOW_ZOOM_IN", "STATIC", "PUSH_IN"],
  CLOSE_UP: ["PUSH_IN", "SLOW_ZOOM_IN", "STATIC"],
  EXTREME_CLOSE_UP: ["STATIC", "PUSH_IN"],
  DETAIL: ["SLOW_ZOOM_IN", "STATIC"],
  OBJECT_FOCUS: ["SLOW_ZOOM_IN", "DRIFT_RIGHT", "STATIC"],
  CHARACTER_FOCUS: ["PUSH_IN", "STATIC", "SLOW_ZOOM_IN"],
  MAP: ["SLOW_ZOOM_IN", "PAN_UP", "STATIC"],
  DIAGRAM: ["STATIC", "SLOW_ZOOM_IN"],
  ABSTRACT: ["SLOW_ZOOM_OUT", "PULL_OUT", "DRIFT_LEFT"],
  ARCHIVAL: ["SLOW_ZOOM_IN", "STATIC"],
  TOP_DOWN: ["SLOW_ZOOM_OUT", "STATIC"],
  LOW_ANGLE: ["SLOW_ZOOM_IN", "STATIC"],
  HIGH_ANGLE: ["PULL_OUT", "SLOW_ZOOM_OUT"],
  OVER_SHOULDER: ["STATIC", "PUSH_IN"],
};

export interface MotionPlan {
  motion: Motion;
  /** Zoom factor at the start and end of the shot. */
  startScale: number;
  endScale: number;
  /** Pan offsets as a fraction of frame size, -1..1. */
  startPanX: number;
  endPanX: number;
  startPanY: number;
  endPanY: number;
}

export function selectMotion(params: {
  shotId: string;
  durationMs: number;
  visualIntent: VisualIntent;
  style: StyleConfig;
  /** Motion chosen upstream (AI/user). Honoured when the style allows it. */
  requested?: Motion | null;
  /** Previous shot's motion, so identical moves aren't repeated back-to-back. */
  previous?: Motion | null;
}): Motion {
  const allowed = params.style.motion.allowed;

  // Very short shots always hold: movement would read as a glitch.
  if (params.durationMs < SHORT_SHOT_MS) return "STATIC";

  if (params.requested && allowed.includes(params.requested)) return params.requested;

  const preferred = (PREFERRED[params.visualIntent] ?? ["SLOW_ZOOM_IN", "STATIC"]).filter((m) => allowed.includes(m));
  const pool = preferred.length ? preferred : allowed;
  const seed = stableInt(`${params.shotId}:${params.durationMs}:${params.visualIntent}`);
  let choice = pool[seed % pool.length];

  // Deterministic de-duplication against the previous shot.
  if (params.previous && choice === params.previous && pool.length > 1) {
    choice = pool[(seed + 1) % pool.length];
  }
  return choice;
}

/**
 * Convert a motion into concrete, style-bounded scale/pan keyframes.
 * Motion amplitude scales with duration so short shots move less.
 */
export function motionPlan(motion: Motion, durationMs: number, style: StyleConfig): MotionPlan {
  const { maxScale, maxPanFraction } = style.motion;
  // Full amplitude at 6s and above; proportionally gentler below that.
  const intensity = Math.max(0.25, Math.min(1, durationMs / 6000));
  const zoom = 1 + (maxScale - 1) * intensity;
  const pan = maxPanFraction * intensity;
  // A base overscan is always applied so panning never exposes the frame edge.
  const base = 1 + maxPanFraction * 2;

  const p: MotionPlan = {
    motion,
    startScale: base,
    endScale: base,
    startPanX: 0,
    endPanX: 0,
    startPanY: 0,
    endPanY: 0,
  };

  switch (motion) {
    case "STATIC":
      p.startScale = p.endScale = 1;
      break;
    case "SLOW_ZOOM_IN":
      p.startScale = 1;
      p.endScale = zoom;
      break;
    case "SLOW_ZOOM_OUT":
      p.startScale = zoom;
      p.endScale = 1;
      break;
    case "PUSH_IN":
      p.startScale = 1;
      p.endScale = 1 + (zoom - 1) * 1.4;
      break;
    case "PULL_OUT":
      p.startScale = 1 + (zoom - 1) * 1.4;
      p.endScale = 1;
      break;
    case "PAN_LEFT":
      p.startPanX = pan;
      p.endPanX = -pan;
      break;
    case "PAN_RIGHT":
      p.startPanX = -pan;
      p.endPanX = pan;
      break;
    case "PAN_UP":
      p.startPanY = pan;
      p.endPanY = -pan;
      break;
    case "PAN_DOWN":
      p.startPanY = -pan;
      p.endPanY = pan;
      break;
    case "DRIFT_LEFT":
      p.startPanX = pan * 0.5;
      p.endPanX = -pan * 0.5;
      p.startScale = p.endScale = base * 1.01;
      break;
    case "DRIFT_RIGHT":
      p.startPanX = -pan * 0.5;
      p.endPanX = pan * 0.5;
      p.startScale = p.endScale = base * 1.01;
      break;
  }

  // Enforce style safety limits absolutely.
  p.startScale = clamp(p.startScale, 1, Math.max(maxScale, base) * 1.5);
  p.endScale = clamp(p.endScale, 1, Math.max(maxScale, base) * 1.5);
  p.startPanX = clamp(p.startPanX, -maxPanFraction, maxPanFraction);
  p.endPanX = clamp(p.endPanX, -maxPanFraction, maxPanFraction);
  p.startPanY = clamp(p.startPanY, -maxPanFraction, maxPanFraction);
  p.endPanY = clamp(p.endPanY, -maxPanFraction, maxPanFraction);
  return p;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
