import type { TimelineDoc } from "@/lib/timeline/types";
import type { StyleConfig } from "@/lib/domain/styles";
import type { QualityGate } from "@/lib/domain/vocab";

/**
 * Cinematic intelligence: scores the assembled timeline across weighted
 * dimensions and emits actionable, shot-addressed issues.
 * All weights live here — scoring logic is never scattered across the codebase.
 */

export const DIMENSIONS = [
  "visualQuality",
  "continuity",
  "diversity",
  "pacing",
  "motion",
  "transitions",
  "narrationAlignment",
  "composition",
] as const;

export type Dimension = (typeof DIMENSIONS)[number];

export const DEFAULT_WEIGHTS: Record<Dimension, number> = {
  visualQuality: 0.2,
  continuity: 0.12,
  diversity: 0.14,
  pacing: 0.14,
  motion: 0.1,
  transitions: 0.08,
  narrationAlignment: 0.14,
  composition: 0.08,
};

export const ISSUE_CODES = [
  "REPEATED_ASSET",
  "LOW_VISUAL_DIVERSITY",
  "PACING_TOO_FAST",
  "PACING_TOO_SLOW",
  "CONTINUITY_BREAK",
  "WEAK_COMPOSITION",
  "EXCESSIVE_MOTION",
  "WEAK_NARRATION_ALIGNMENT",
  "BAD_TRANSITION",
  "LOW_ASSET_QUALITY",
] as const;

export type IssueCode = (typeof ISSUE_CODES)[number];
export type Severity = "INFO" | "WARNING" | "ERROR";

export interface CinematicIssue {
  code: IssueCode;
  severity: Severity;
  message: string;
  shotId?: string;
  sceneId?: string;
  /** A safe fix may be applied automatically; unsafe fixes need a human. */
  fixSafe: boolean;
  fix?: { field: "motion" | "transitionIn"; value: string; reason: string };
}

export interface AssetQuality {
  shotId: string;
  qcScore: number | null;
  qcGate: string | null;
  contentHash: string | null;
}

export interface AnalysisResult {
  overallScore: number;
  gate: QualityGate;
  dimensions: Record<Dimension, number>;
  issues: CinematicIssue[];
}

export function analyzeTimeline(params: {
  doc: TimelineDoc;
  style: StyleConfig;
  assetQuality: AssetQuality[];
  weights?: Partial<Record<Dimension, number>>;
}): AnalysisResult {
  const { doc, style } = params;
  const clips = [...doc.clips].sort((a, b) => a.startMs - b.startMs);
  const issues: CinematicIssue[] = [];
  const qualityByShot = new Map(params.assetQuality.map((q) => [q.shotId, q]));

  if (clips.length === 0) {
    return {
      overallScore: 0,
      gate: "FAIL",
      dimensions: Object.fromEntries(DIMENSIONS.map((d) => [d, 0])) as Record<Dimension, number>,
      issues: [{ code: "LOW_ASSET_QUALITY", severity: "ERROR", message: "The timeline is empty.", fixSafe: false }],
    };
  }

  // ---- Visual quality ------------------------------------------------------
  const scores = clips.map((c) => qualityByShot.get(c.shotId)?.qcScore ?? null);
  const known = scores.filter((s): s is number => s !== null);
  const visualQuality = known.length ? avg(known) : 0.5;
  for (const clip of clips) {
    const q = qualityByShot.get(clip.shotId);
    if (q?.qcScore !== null && q?.qcScore !== undefined && q.qcScore < 0.55) {
      issues.push({
        code: "LOW_ASSET_QUALITY",
        severity: q.qcScore < 0.4 ? "ERROR" : "WARNING",
        message: `The image for this shot scored ${(q.qcScore * 100).toFixed(0)}% in quality control.`,
        shotId: clip.shotId,
        sceneId: clip.sceneId,
        fixSafe: false,
      });
    }
  }

  // ---- Diversity (repeated images) ----------------------------------------
  const hashCounts = new Map<string, string[]>();
  for (const clip of clips) {
    const h = qualityByShot.get(clip.shotId)?.contentHash;
    if (!h) continue;
    const list = hashCounts.get(h) ?? [];
    list.push(clip.shotId);
    hashCounts.set(h, list);
  }
  let repeated = 0;
  for (const [, shotIds] of [...hashCounts.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (shotIds.length > 1) {
      repeated += shotIds.length - 1;
      for (const shotId of shotIds.slice(1)) {
        issues.push({
          code: "REPEATED_ASSET",
          severity: "WARNING",
          message: "This shot reuses an image that already appears elsewhere in the film.",
          shotId,
          fixSafe: false,
        });
      }
    }
  }
  const uniqueRatio = clips.length ? 1 - repeated / clips.length : 1;
  const intents = new Set(clips.map((c) => c.visualIntent));
  const intentVariety = Math.min(1, intents.size / Math.min(8, Math.max(3, Math.round(clips.length / 4))));
  const diversity = clamp01(uniqueRatio * 0.65 + intentVariety * 0.35);
  if (diversity < 0.6) {
    issues.push({
      code: "LOW_VISUAL_DIVERSITY",
      severity: "WARNING",
      message: "The film relies on a narrow range of images and framings.",
      fixSafe: false,
    });
  }

  // ---- Pacing --------------------------------------------------------------
  const durations = clips.map((c) => c.endMs - c.startMs);
  const meanDuration = avg(durations);
  let fast = 0;
  let slow = 0;
  for (const clip of clips) {
    const d = clip.endMs - clip.startMs;
    if (d < 1200) {
      fast++;
      issues.push({
        code: "PACING_TOO_FAST",
        severity: d < 700 ? "ERROR" : "WARNING",
        message: `This shot is only ${d}ms long and will feel like a flicker.`,
        shotId: clip.shotId,
        sceneId: clip.sceneId,
        fixSafe: d < 800 && clip.motion !== "STATIC",
        fix: d < 800 && clip.motion !== "STATIC" ? { field: "motion", value: "STATIC", reason: "Shots under 800ms should hold still." } : undefined,
      });
    } else if (d > 14_000) {
      slow++;
      issues.push({
        code: "PACING_TOO_SLOW",
        severity: "WARNING",
        message: `This shot holds for ${(d / 1000).toFixed(1)}s, which risks losing the viewer.`,
        shotId: clip.shotId,
        sceneId: clip.sceneId,
        fixSafe: false,
      });
    }
  }
  const idealMean = 5000;
  const meanPenalty = Math.min(1, Math.abs(meanDuration - idealMean) / 9000);
  const extremePenalty = Math.min(1, (fast * 1.5 + slow) / Math.max(1, clips.length));
  const pacing = clamp01(1 - meanPenalty * 0.5 - extremePenalty * 0.7);

  // ---- Motion --------------------------------------------------------------
  let motionIssues = 0;
  let movingCount = 0;
  for (let i = 0; i < clips.length; i++) {
    const clip = clips[i];
    const d = clip.endMs - clip.startMs;
    if (clip.motion !== "STATIC") movingCount++;
    if (!style.motion.allowed.includes(clip.motion)) {
      motionIssues++;
      issues.push({
        code: "EXCESSIVE_MOTION",
        severity: "WARNING",
        message: `The motion "${clip.motion}" is not part of the ${style.name} style.`,
        shotId: clip.shotId,
        fixSafe: true,
        fix: { field: "motion", value: "STATIC", reason: `Reset to a motion permitted by the ${style.name} style.` },
      });
    }
    if (d < 800 && clip.motion !== "STATIC") {
      motionIssues++;
      issues.push({
        code: "EXCESSIVE_MOTION",
        severity: "WARNING",
        message: "Camera movement on a shot this short will read as a glitch.",
        shotId: clip.shotId,
        fixSafe: true,
        fix: { field: "motion", value: "STATIC", reason: "Shots under 800ms should hold still." },
      });
    }
    const prev = clips[i - 1];
    if (prev && prev.motion === clip.motion && clip.motion !== "STATIC") {
      const next = clips[i + 1];
      if (next && next.motion === clip.motion) {
        motionIssues++;
        issues.push({
          code: "EXCESSIVE_MOTION",
          severity: "INFO",
          message: "Three consecutive shots use the same camera move.",
          shotId: clip.shotId,
          fixSafe: false,
        });
      }
    }
  }
  const movingRatio = movingCount / clips.length;
  const ratioPenalty = movingRatio > 0.85 ? (movingRatio - 0.85) * 2 : 0;
  const motion = clamp01(1 - motionIssues / Math.max(1, clips.length) - ratioPenalty);

  // ---- Transitions ---------------------------------------------------------
  let badTransitions = 0;
  for (let i = 0; i < clips.length; i++) {
    const clip = clips[i];
    if (!style.transitions.allowed.includes(clip.transitionIn)) {
      badTransitions++;
      issues.push({
        code: "BAD_TRANSITION",
        severity: "WARNING",
        message: `The transition "${clip.transitionIn}" is not part of the ${style.name} style.`,
        shotId: clip.shotId,
        fixSafe: true,
        fix: { field: "transitionIn", value: "CUT", reason: `Reset to a transition permitted by the ${style.name} style.` },
      });
      continue;
    }
    const d = clip.endMs - clip.startMs;
    if (clip.transitionMs > 0 && clip.transitionMs > d / 2) {
      badTransitions++;
      issues.push({
        code: "BAD_TRANSITION",
        severity: "WARNING",
        message: "The transition is longer than half of the shot it opens.",
        shotId: clip.shotId,
        fixSafe: true,
        fix: { field: "transitionIn", value: "CUT", reason: "The shot is too short to carry a dissolve." },
      });
    }
    const prev = clips[i - 1];
    if (prev && prev.transitionIn !== "CUT" && clip.transitionIn !== "CUT" && d < 2500) {
      badTransitions++;
      issues.push({
        code: "BAD_TRANSITION",
        severity: "INFO",
        message: "Back-to-back dissolves on short shots muddy the cut.",
        shotId: clip.shotId,
        fixSafe: true,
        fix: { field: "transitionIn", value: "CUT", reason: "Avoid consecutive dissolves on short shots." },
      });
    }
  }
  const transitions = clamp01(1 - badTransitions / Math.max(1, clips.length));

  // ---- Narration alignment -------------------------------------------------
  let unaligned = 0;
  let covered = 0;
  for (const clip of clips) {
    const d = clip.endMs - clip.startMs;
    covered += d;
    const wordCount = clip.narrationText.trim() ? clip.narrationText.trim().split(/\s+/).length : 0;
    if (wordCount === 0 && d > 3000) {
      unaligned++;
      issues.push({
        code: "WEAK_NARRATION_ALIGNMENT",
        severity: "INFO",
        message: "This shot holds for several seconds with no narration attached.",
        shotId: clip.shotId,
        fixSafe: false,
      });
    } else if (wordCount > 0) {
      const wpm = wordCount / (d / 60_000);
      if (wpm > 260) {
        unaligned++;
        issues.push({
          code: "WEAK_NARRATION_ALIGNMENT",
          severity: "WARNING",
          message: "This shot carries far more narration than its length comfortably supports.",
          shotId: clip.shotId,
          fixSafe: false,
        });
      }
    }
  }
  const coverage = Math.min(1, covered / Math.max(1, doc.durationMs));
  const narrationAlignment = clamp01(coverage * (1 - unaligned / Math.max(1, clips.length)));

  // ---- Continuity ----------------------------------------------------------
  let continuityBreaks = 0;
  const sceneOrder: string[] = [];
  for (const clip of clips) {
    if (sceneOrder[sceneOrder.length - 1] !== clip.sceneId) sceneOrder.push(clip.sceneId);
  }
  const seen = new Set<string>();
  for (const sceneId of sceneOrder) {
    if (seen.has(sceneId)) {
      continuityBreaks++;
      issues.push({
        code: "CONTINUITY_BREAK",
        severity: "WARNING",
        message: "Shots from the same scene are split apart in the timeline.",
        sceneId,
        fixSafe: false,
      });
    }
    seen.add(sceneId);
  }
  const continuity = clamp01(1 - continuityBreaks / Math.max(1, sceneOrder.length));

  // ---- Composition ---------------------------------------------------------
  let weakComposition = 0;
  for (let i = 1; i < clips.length; i++) {
    if (clips[i].visualIntent === clips[i - 1].visualIntent && clips[i].sceneId === clips[i - 1].sceneId) {
      const runStart = i - 1;
      let run = 1;
      while (i < clips.length && clips[i].visualIntent === clips[runStart].visualIntent) {
        run++;
        i++;
      }
      if (run >= 4) {
        weakComposition++;
        issues.push({
          code: "WEAK_COMPOSITION",
          severity: "INFO",
          message: `${run} consecutive shots share the same framing, flattening the scene.`,
          shotId: clips[runStart].shotId,
          sceneId: clips[runStart].sceneId,
          fixSafe: false,
        });
      }
    }
  }
  const composition = clamp01(1 - weakComposition / Math.max(1, sceneOrder.length));

  const dimensions: Record<Dimension, number> = {
    visualQuality: round2(visualQuality),
    continuity: round2(continuity),
    diversity: round2(diversity),
    pacing: round2(pacing),
    motion: round2(motion),
    transitions: round2(transitions),
    narrationAlignment: round2(narrationAlignment),
    composition: round2(composition),
  };

  const weights = { ...DEFAULT_WEIGHTS, ...params.weights };
  const totalWeight = DIMENSIONS.reduce((a, d) => a + weights[d], 0);
  const overallScore = round2(DIMENSIONS.reduce((a, d) => a + dimensions[d] * weights[d], 0) / totalWeight);

  const errors = issues.filter((i) => i.severity === "ERROR").length;
  const warnings = issues.filter((i) => i.severity === "WARNING").length;
  const gate: QualityGate =
    overallScore < 0.5 || errors > Math.max(2, clips.length * 0.1)
      ? "FAIL"
      : overallScore < 0.65 || errors > 0
        ? "NEEDS_REVIEW"
        : warnings > 0
          ? "WARNINGS"
          : "PASS";

  return { overallScore, gate, dimensions, issues };
}

function avg(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}
function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}
function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
