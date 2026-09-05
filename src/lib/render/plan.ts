import { motionPlan } from "@/lib/timeline/motion";
import type { StyleConfig } from "@/lib/domain/styles";
import type { Clip, Overlay, TimelineDoc } from "@/lib/timeline/types";
import { escapeDrawText } from "@/lib/security/sanitize";
import { msToSeconds } from "@/lib/core/timecode";
import type { RenderProfile } from "./profiles";
import { AppError } from "@/lib/errors";

/**
 * Render planner → FFmpeg argument builder.
 *
 * Every value below is produced from validated numeric data or from
 * escapeDrawText(). Arguments are emitted as an array and spawned without a
 * shell, so user/AI text can never become a command.
 */

export interface PlannedClip {
  clip: Clip;
  inputIndex: number;
  imagePath: string;
}

export interface RenderPlan {
  args: string[];
  outputPath: string;
  durationMs: number;
  clipCount: number;
}

export interface PlanInput {
  doc: TimelineDoc;
  style: StyleConfig;
  profile: RenderProfile;
  audioPath: string;
  /** shotId → absolute image path on disk. */
  imagePaths: Map<string, string>;
  outputPath: string;
  fontPath?: string | null;
  /** Render only this time window (used for chunked long-form rendering). */
  window?: { startMs: number; endMs: number };
}

const SCALE_OVERSCAN = 1.2;

export function planRender(input: PlanInput): RenderPlan {
  const { profile, style } = input;
  const window = input.window ?? { startMs: 0, endMs: input.doc.durationMs };
  const windowDurationMs = window.endMs - window.startMs;
  if (windowDurationMs <= 0) throw new AppError("RENDER_ERROR", "The render window is empty.");

  const clips = input.doc.clips
    .filter((c) => c.endMs > window.startMs && c.startMs < window.endMs)
    .sort((a, b) => a.startMs - b.startMs);
  if (clips.length === 0) throw new AppError("RENDER_ERROR", "There are no clips to render in this range.");

  // -progress emits machine-readable key=value progress on stdout. (-stats_period
  // is deliberately omitted: it does not exist in older FFmpeg builds and its
  // absence only changes the reporting cadence, not correctness.)
  const args: string[] = ["-y", "-hide_banner", "-nostdin", "-loglevel", "error", "-progress", "pipe:1"];
  const filters: string[] = [];
  const overlayW = Math.round(profile.width * SCALE_OVERSCAN);
  const overlayH = Math.round(profile.height * SCALE_OVERSCAN);

  // Input 0: black canvas covering the whole window (guarantees no transparent
  // gaps and provides the black for DIP_TO_BLACK).
  args.push(
    "-f",
    "lavfi",
    "-i",
    `color=c=black:s=${profile.width}x${profile.height}:r=${profile.fps}:d=${msToSeconds(windowDurationMs)}`,
  );

  let inputIndex = 1;
  const videoLabels: string[] = [];

  for (const clip of clips) {
    const imagePath = input.imagePaths.get(clip.shotId);
    if (!imagePath) {
      throw new AppError("RENDER_ERROR", `No image file is available for shot ${clip.shotId}.`, {
        context: { shotId: clip.shotId },
      });
    }

    const clipStart = Math.max(clip.startMs, window.startMs);
    const clipEnd = Math.min(clip.endMs, window.endMs);
    const durationMs = clipEnd - clipStart;
    if (durationMs <= 0) continue;
    const offsetMs = clipStart - window.startMs;
    const frames = Math.max(1, Math.round((durationMs / 1000) * profile.fps));

    args.push("-loop", "1", "-t", msToSeconds(durationMs), "-i", imagePath);

    const mp = motionPlan(clip.motion, durationMs, style);
    const zoomExpr = buildZoomExpr(mp.startScale, mp.endScale, frames);
    const { xExpr, yExpr } = buildPanExpr(mp, frames);

    // Alpha envelope: fade-in implements CROSSFADE / FADE / DIP_TO_BLACK.
    const fadeInMs = clip.transitionIn === "CUT" ? 0 : clip.transitionMs;
    const nextClip = clips[clips.indexOf(clip) + 1];
    // Only a true CROSSFADE requires the outgoing clip to fade under the incoming one.
    const fadeOutMs = nextClip && nextClip.transitionIn === "CROSSFADE" ? nextClip.transitionMs : 0;

    const chain = [
      `scale=${overlayW}:${overlayH}:force_original_aspect_ratio=increase`,
      `crop=${overlayW}:${overlayH}`,
      `zoompan=z='${zoomExpr}':x='${xExpr}':y='${yExpr}':d=${frames}:s=${profile.width}x${profile.height}:fps=${profile.fps}`,
      `trim=duration=${msToSeconds(durationMs)}`,
      "format=yuva420p",
    ];
    if (fadeInMs > 0) chain.push(`fade=t=in:st=0:d=${msToSeconds(fadeInMs)}:alpha=1`);
    if (fadeOutMs > 0) {
      chain.push(`fade=t=out:st=${msToSeconds(Math.max(0, durationMs - fadeOutMs))}:d=${msToSeconds(fadeOutMs)}:alpha=1`);
    }
    chain.push(`setpts=PTS-STARTPTS+${msToSeconds(offsetMs)}/TB`);

    const label = `v${inputIndex}`;
    filters.push(`[${inputIndex}:v]${chain.join(",")}[${label}]`);
    videoLabels.push(label);
    inputIndex++;
  }

  // Audio input, trimmed to the window.
  const audioInputIndex = inputIndex;
  args.push("-ss", msToSeconds(window.startMs), "-t", msToSeconds(windowDurationMs), "-i", input.audioPath);

  // Composite every clip onto the black canvas in timeline order.
  let current = "0:v";
  videoLabels.forEach((label, i) => {
    const out = i === videoLabels.length - 1 ? "vcomposite" : `t${i}`;
    filters.push(`[${current}][${label}]overlay=eof_action=pass:shortest=0[${out}]`);
    current = out;
  });

  // Text overlays are drawn last so they sit above the picture.
  let finalLabel = "vcomposite";
  const overlays = input.doc.overlays.filter((o) => o.endMs > window.startMs && o.startMs < window.endMs);
  if (overlays.length > 0 && input.fontPath) {
    const draws = overlays.map((o) => drawTextFilter(o, profile, window.startMs, input.fontPath as string));
    filters.push(`[${finalLabel}]${draws.join(",")}[vtext]`);
    finalLabel = "vtext";
  }

  filters.push(`[${finalLabel}]format=yuv420p,trim=duration=${msToSeconds(windowDurationMs)},setpts=PTS-STARTPTS[vout]`);

  args.push(
    "-filter_complex",
    filters.join(";"),
    "-map",
    "[vout]",
    "-map",
    `${audioInputIndex}:a`,
    "-c:v",
    "libx264",
    "-preset",
    profile.preset,
    "-crf",
    String(profile.crf),
    "-pix_fmt",
    "yuv420p",
    "-r",
    String(profile.fps),
    "-c:a",
    "aac",
    "-b:a",
    profile.audioBitrate,
    "-ar",
    "48000",
    "-ac",
    "2",
    "-movflags",
    "+faststart",
    "-shortest",
    "-t",
    msToSeconds(windowDurationMs),
    input.outputPath,
  );

  return { args, outputPath: input.outputPath, durationMs: windowDurationMs, clipCount: clips.length };
}

/** Linear zoom ramp across the clip, expressed in zoompan's frame variable. */
function buildZoomExpr(startScale: number, endScale: number, frames: number): string {
  const s = round4(startScale);
  const e = round4(endScale);
  if (Math.abs(s - e) < 0.0005) return String(s);
  const delta = round6((e - s) / Math.max(1, frames - 1));
  const lo = round4(Math.min(s, e));
  const hi = round4(Math.max(s, e));
  return `max(${lo}\\,min(${hi}\\,${s}+${delta}*on))`;
}

/**
 * Pan expressions. zoompan's iw/ih are the *input* dimensions; the visible
 * window is iw/zoom. Centre-anchored, then offset by the pan fraction.
 */
function buildPanExpr(
  mp: ReturnType<typeof motionPlan>,
  frames: number,
): { xExpr: string; yExpr: string } {
  const build = (start: number, end: number, dim: "iw" | "ih") => {
    const centre = `(${dim}-${dim}/zoom)/2`;
    if (Math.abs(start) < 0.0005 && Math.abs(end) < 0.0005) return centre;
    const delta = round6((end - start) / Math.max(1, frames - 1));
    const offset = `((${round4(start)}+${delta}*on)*${dim})`;
    // Clamp so the crop window can never leave the source frame.
    return `max(0\\,min(${dim}-${dim}/zoom\\,${centre}+${offset}))`;
  };
  return {
    xExpr: build(mp.startPanX, mp.endPanX, "iw"),
    yExpr: build(mp.startPanY, mp.endPanY, "ih"),
  };
}

function drawTextFilter(overlay: Overlay, profile: RenderProfile, windowStartMs: number, fontPath: string): string {
  const text = escapeDrawText(overlay.text);
  const start = msToSeconds(Math.max(0, overlay.startMs - windowStartMs));
  const end = msToSeconds(Math.max(0, overlay.endMs - windowStartMs));
  const size =
    overlay.kind === "TITLE"
      ? Math.round(profile.height * 0.075)
      : overlay.kind === "EMPHASIS"
        ? Math.round(profile.height * 0.055)
        : Math.round(profile.height * 0.042);
  const y =
    overlay.position === "TOP"
      ? `${Math.round(profile.height * 0.08)}`
      : overlay.position === "CENTER"
        ? "(h-text_h)/2"
        : `h-text_h-${Math.round(profile.height * 0.08)}`;

  return [
    "drawtext=",
    `fontfile=${fontPath}`,
    `:text='${text}'`,
    `:fontsize=${size}`,
    ":fontcolor=white",
    ":borderw=2",
    ":bordercolor=black@0.7",
    ":box=1:boxcolor=black@0.35:boxborderw=14",
    ":x=(w-text_w)/2",
    `:y=${y}`,
    `:enable='between(t,${start},${end})'`,
  ].join("");
}

function round4(v: number): number {
  return Math.round(v * 1e4) / 1e4;
}
function round6(v: number): number {
  return Math.round(v * 1e6) / 1e6;
}
