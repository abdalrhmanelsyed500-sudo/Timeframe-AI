import { spawn } from "node:child_process";
import fs from "node:fs";
import { loadEnv } from "@/lib/env";
import { AppError } from "@/lib/errors";

/**
 * FFmpeg/FFprobe process layer.
 * Commands are ALWAYS executable + args[]. No shell, ever — user and AI text
 * can therefore never be interpreted as shell syntax.
 */

function resolveBinary(kind: "ffmpeg" | "ffprobe"): string | null {
  const env = loadEnv();
  const explicit = kind === "ffmpeg" ? env.FFMPEG_PATH : env.FFPROBE_PATH;
  if (explicit && fs.existsSync(explicit)) return explicit;
  try {
     
    const mod = require(kind === "ffmpeg" ? "@ffmpeg-installer/ffmpeg" : "@ffprobe-installer/ffprobe") as {
      path: string;
    };
    if (mod?.path && fs.existsSync(mod.path)) return mod.path;
  } catch {
    /* installer package unavailable */
  }
  for (const p of [`/usr/bin/${kind}`, `/usr/local/bin/${kind}`, `/opt/homebrew/bin/${kind}`]) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

let ffmpegPath: string | null | undefined;
let ffprobePath: string | null | undefined;

export function findFfmpeg(): string | null {
  if (ffmpegPath === undefined) ffmpegPath = resolveBinary("ffmpeg");
  return ffmpegPath;
}

export function findFfprobe(): string | null {
  if (ffprobePath === undefined) ffprobePath = resolveBinary("ffprobe");
  return ffprobePath;
}

export function requireFfmpeg(): string {
  const p = findFfmpeg();
  if (!p) throw new AppError("CONFIGURATION_ERROR", "FFmpeg is not available. Set FFMPEG_PATH or install FFmpeg.");
  return p;
}

export function requireFfprobe(): string {
  const p = findFfprobe();
  if (!p) throw new AppError("CONFIGURATION_ERROR", "FFprobe is not available. Set FFPROBE_PATH or install FFmpeg.");
  return p;
}

export interface RunOptions {
  timeoutMs?: number;
  onStderr?: (chunk: string) => void;
  signal?: AbortSignal;
}

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

export function runProcess(bin: string, args: string[], opts: RunOptions = {}): Promise<RunResult> {
  const timeoutMs = opts.timeoutMs ?? 30 * 60_000;
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        child.kill("SIGKILL");
        reject(new AppError("RENDER_ERROR", "The media process timed out.", { context: { bin, timeoutMs } }));
      }
    }, timeoutMs);

    const onAbort = () => {
      if (!settled) {
        settled = true;
        child.kill("SIGKILL");
        clearTimeout(timer);
        reject(new AppError("RENDER_ERROR", "The media process was cancelled.", { context: { bin } }));
      }
    };
    opts.signal?.addEventListener("abort", onAbort, { once: true });

    child.stdout.on("data", (d: Buffer) => {
      stdout += d.toString();
      if (stdout.length > 4_000_000) stdout = stdout.slice(-2_000_000);
    });
    child.stderr.on("data", (d: Buffer) => {
      const text = d.toString();
      stderr += text;
      if (stderr.length > 4_000_000) stderr = stderr.slice(-2_000_000);
      opts.onStderr?.(text);
    });
    child.on("error", (e) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
      reject(new AppError("RENDER_ERROR", "The media process could not be started.", { cause: e, context: { bin } }));
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

export async function runFfmpeg(args: string[], opts: RunOptions = {}): Promise<RunResult> {
  const res = await runProcess(requireFfmpeg(), args, opts);
  if (res.code !== 0) {
    throw new AppError("RENDER_ERROR", "FFmpeg failed while processing the video.", {
      context: { code: res.code, stderrTail: res.stderr.slice(-4000) },
    });
  }
  return res;
}

export interface ProbeStream {
  index: number;
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  pix_fmt?: string;
  sample_rate?: string;
  channels?: number;
  duration?: string;
  start_time?: string;
  r_frame_rate?: string;
  avg_frame_rate?: string;
  bit_rate?: string;
}

export interface ProbeResult {
  format: {
    format_name?: string;
    duration?: string;
    size?: string;
    bit_rate?: string;
  };
  streams: ProbeStream[];
}

export async function ffprobe(filePath: string): Promise<ProbeResult> {
  const res = await runProcess(
    requireFfprobe(),
    ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", filePath],
    { timeoutMs: 120_000 },
  );
  if (res.code !== 0) {
    throw new AppError("RENDER_ERROR", "The media file could not be inspected (ffprobe failed).", {
      context: { code: res.code, stderrTail: res.stderr.slice(-2000) },
    });
  }
  try {
    return JSON.parse(res.stdout) as ProbeResult;
  } catch (e) {
    throw new AppError("RENDER_ERROR", "ffprobe returned an unreadable response.", { cause: e });
  }
}

export function parseFrameRate(value: string | undefined): number {
  if (!value) return 0;
  const [n, d] = value.split("/").map(Number);
  if (!d) return n || 0;
  return n / d;
}

/** Extract authoritative audio metadata. Duration is rounded to whole ms. */
export async function probeAudio(filePath: string): Promise<{
  durationMs: number;
  sampleRate: number | null;
  channels: number | null;
  codec: string | null;
}> {
  const probe = await ffprobe(filePath);
  const audio = probe.streams.find((s) => s.codec_type === "audio");
  if (!audio) throw new AppError("VALIDATION_ERROR", "The uploaded file contains no audio stream.");
  const durationSec = Number(probe.format.duration ?? audio.duration ?? 0);
  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    throw new AppError("VALIDATION_ERROR", "The audio duration could not be determined; the file may be corrupt.");
  }
  return {
    durationMs: Math.round(durationSec * 1000),
    sampleRate: audio.sample_rate ? Number(audio.sample_rate) : null,
    channels: audio.channels ?? null,
    codec: audio.codec_name ?? null,
  };
}
