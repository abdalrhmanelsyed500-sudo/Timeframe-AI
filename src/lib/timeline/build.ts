import { contentHash } from "@/lib/core/hash";
import { derivedId } from "@/lib/core/ids";
import type { StyleConfig } from "@/lib/domain/styles";
import type { Motion, Transition, VisualIntent } from "@/lib/domain/vocab";
import { selectMotion } from "./motion";
import type { Clip, Overlay, TimelineDoc } from "./types";

/**
 * Deterministic timeline builder.
 *
 * Given the same story, assets, audio duration and style, this always produces
 * a byte-identical timeline (and therefore an identical contentHash).
 * No Date.now(), no Math.random(), no unordered iteration.
 */

export interface BuildShotInput {
  shotId: string;
  sceneId: string;
  sectionId: string;
  idx: number;
  startMs: number;
  endMs: number;
  visualIntent: VisualIntent;
  narrationText: string;
  requestedMotion?: Motion | null;
  requestedTransition?: Transition | null;
  assetId: string | null;
  assetVersionId: string | null;
  storageKey: string | null;
}

export interface BuildInput {
  projectId: string;
  audioDurationMs: number;
  style: StyleConfig;
  shots: BuildShotInput[];
}

export interface BuildResult {
  doc: TimelineDoc;
  contentHash: string;
  corrections: string[];
}

export function buildTimeline(input: BuildInput): BuildResult {
  const corrections: string[] = [];
  const shots = [...input.shots].sort((a, b) => a.startMs - b.startMs || a.idx - b.idx);
  const clips: Clip[] = [];

  let prevSceneId: string | null = null;
  let prevSectionId: string | null = null;
  let prevMotion: Motion | null = null;
  let cursor = 0;

  for (let i = 0; i < shots.length; i++) {
    const shot = shots[i];
    let startMs = Math.max(0, Math.round(shot.startMs));
    let endMs = Math.round(shot.endMs);

    // Deterministic rounding corrections — always recorded, never silent.
    if (startMs !== cursor) {
      if (startMs > cursor) corrections.push(`Closed a ${startMs - cursor}ms gap before shot ${shot.shotId}.`);
      else corrections.push(`Resolved a ${cursor - startMs}ms overlap before shot ${shot.shotId}.`);
      startMs = cursor;
    }
    if (i === shots.length - 1) {
      if (endMs !== input.audioDurationMs) {
        corrections.push(`Extended the final shot to the audio duration (${input.audioDurationMs}ms).`);
        endMs = input.audioDurationMs;
      }
    }
    if (endMs > input.audioDurationMs) {
      corrections.push(`Clamped shot ${shot.shotId} to the audio duration.`);
      endMs = input.audioDurationMs;
    }
    if (endMs <= startMs) {
      corrections.push(`Dropped zero-length shot ${shot.shotId}.`);
      continue;
    }

    const durationMs = endMs - startMs;
    const motion = selectMotion({
      shotId: shot.shotId,
      durationMs,
      visualIntent: shot.visualIntent,
      style: input.style,
      requested: shot.requestedMotion ?? null,
      previous: prevMotion,
    });

    const transitionIn = pickTransition({
      index: i,
      style: input.style,
      requested: shot.requestedTransition ?? null,
      sceneChanged: prevSceneId !== null && prevSceneId !== shot.sceneId,
      sectionChanged: prevSectionId !== null && prevSectionId !== shot.sectionId,
    });

    // A transition can never be longer than the shorter of the two shots it joins.
    const prevDuration = clips.length ? clips[clips.length - 1].endMs - clips[clips.length - 1].startMs : durationMs;
    const maxTransition = Math.max(0, Math.floor(Math.min(durationMs, prevDuration) / 3));
    const transitionMs = transitionIn === "CUT" ? 0 : Math.min(input.style.transitions.durationMs, maxTransition);

    clips.push({
      clipId: derivedId("clip", input.projectId, shot.shotId, String(startMs)),
      shotId: shot.shotId,
      sceneId: shot.sceneId,
      sectionId: shot.sectionId,
      assetId: shot.assetId,
      assetVersionId: shot.assetVersionId,
      storageKey: shot.storageKey,
      startMs,
      endMs,
      motion,
      transitionIn: transitionMs === 0 && transitionIn !== "CUT" ? "CUT" : transitionIn,
      transitionMs,
      visualIntent: shot.visualIntent,
      narrationText: shot.narrationText,
    });

    cursor = endMs;
    prevSceneId = shot.sceneId;
    prevSectionId = shot.sectionId;
    prevMotion = motion;
  }

  if (clips.length && cursor < input.audioDurationMs) {
    const last = clips[clips.length - 1];
    corrections.push(`Extended the final clip by ${input.audioDurationMs - cursor}ms to reach the audio duration.`);
    last.endMs = input.audioDurationMs;
  }

  const doc: TimelineDoc = {
    durationMs: input.audioDurationMs,
    clips,
    overlays: [],
  };

  return { doc, contentHash: contentHash(doc), corrections };
}

function pickTransition(params: {
  index: number;
  style: StyleConfig;
  requested: Transition | null;
  sceneChanged: boolean;
  sectionChanged: boolean;
}): Transition {
  const allowed = params.style.transitions.allowed;
  if (params.index === 0) return allowed.includes("FADE") ? "FADE" : "CUT";
  if (params.requested && allowed.includes(params.requested)) return params.requested;
  if (params.sectionChanged) return fallback(params.style.transitions.defaultBetweenSections, allowed);
  if (params.sceneChanged) return fallback(params.style.transitions.defaultBetweenScenes, allowed);
  return fallback(params.style.transitions.defaultWithinScene, allowed);
}

function fallback(want: Transition, allowed: readonly Transition[]): Transition {
  return allowed.includes(want) ? want : "CUT";
}

export function withOverlays(doc: TimelineDoc, overlays: Overlay[]): TimelineDoc {
  return { ...doc, overlays: [...overlays].sort((a, b) => a.startMs - b.startMs) };
}
