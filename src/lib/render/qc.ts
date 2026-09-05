import { ffprobe, parseFrameRate } from "./ffmpeg";
import { AppError } from "@/lib/errors";
import type { RenderProfile } from "./profiles";

export interface VideoQcResult {
  ok: boolean;
  durationMs: number;
  width: number;
  height: number;
  fps: number;
  videoCodec: string;
  audioCodec: string | null;
  pixelFormat: string | null;
  avSyncMs: number;
  problems: string[];
}

export const AV_SYNC_TOLERANCE_MS = 300;

/**
 * A render is only COMPLETED when the artefact provably matches the plan.
 * Anything short of that is a failure — never a "successful" artefact.
 */
export async function validateRenderOutput(
  filePath: string,
  expect: { profile: RenderProfile; durationMs: number; requireAudio: boolean },
): Promise<VideoQcResult> {
  const probe = await ffprobe(filePath);
  const problems: string[] = [];

  const video = probe.streams.find((s) => s.codec_type === "video");
  const audio = probe.streams.find((s) => s.codec_type === "audio");

  if (!video) throw new AppError("RENDER_ERROR", "The rendered file contains no video stream.");
  if (expect.requireAudio && !audio) {
    throw new AppError("RENDER_ERROR", "The rendered file contains no audio stream.");
  }

  const container = probe.format.format_name ?? "";
  if (!/mp4|mov|m4a|isom/i.test(container)) problems.push(`Unexpected container format: ${container}`);

  const durationSec = Number(probe.format.duration ?? 0);
  const durationMs = Math.round(durationSec * 1000);
  const durationDelta = Math.abs(durationMs - expect.durationMs);
  // Allow one second of container rounding on top of a 2% tolerance.
  const durationTolerance = Math.max(1000, Math.round(expect.durationMs * 0.02));
  if (durationDelta > durationTolerance) {
    problems.push(`Duration is ${durationMs}ms but ${expect.durationMs}ms was expected.`);
  }

  const width = video.width ?? 0;
  const height = video.height ?? 0;
  if (width !== expect.profile.width || height !== expect.profile.height) {
    problems.push(`Resolution is ${width}x${height} but ${expect.profile.width}x${expect.profile.height} was expected.`);
  }

  const fps = parseFrameRate(video.avg_frame_rate ?? video.r_frame_rate);
  if (Math.abs(fps - expect.profile.fps) > 0.5) {
    problems.push(`Frame rate is ${fps.toFixed(2)} but ${expect.profile.fps} was expected.`);
  }

  const videoCodec = video.codec_name ?? "";
  if (!/h264|hevc|avc/i.test(videoCodec)) problems.push(`Unexpected video codec: ${videoCodec}`);

  if (video.pix_fmt && video.pix_fmt !== "yuv420p") {
    problems.push(`Pixel format is ${video.pix_fmt}; yuv420p is required for broad playback.`);
  }

  let avSyncMs = 0;
  if (audio) {
    if (!/aac|mp3|opus/i.test(audio.codec_name ?? "")) problems.push(`Unexpected audio codec: ${audio.codec_name}`);
    const vStart = Number(video.start_time ?? 0);
    const aStart = Number(audio.start_time ?? 0);
    avSyncMs = Math.round(Math.abs(vStart - aStart) * 1000);
    if (avSyncMs > AV_SYNC_TOLERANCE_MS) {
      problems.push(`Audio and video start ${avSyncMs}ms apart, beyond the ${AV_SYNC_TOLERANCE_MS}ms tolerance.`);
    }
  }

  return {
    ok: problems.length === 0,
    durationMs,
    width,
    height,
    fps: Math.round(fps * 1000) / 1000,
    videoCodec,
    audioCodec: audio?.codec_name ?? null,
    pixelFormat: video.pix_fmt ?? null,
    avSyncMs,
    problems,
  };
}
