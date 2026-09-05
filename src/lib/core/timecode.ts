import { AppError } from "@/lib/errors";

/**
 * The single canonical timecode parser for TIMEFRAME AI.
 * All authoritative timeline values are integer milliseconds.
 *
 * Supported inputs:
 *   00:00:01,250   (SRT)
 *   00:00:01.250   (VTT)
 *   00:01.250      (mm:ss.mmm)
 *   1.250          (seconds)
 *   1250ms
 */
const HMS = /^(\d{1,3}):([0-5]?\d):([0-5]?\d)([.,](\d{1,3}))?$/;
const MS_ONLY = /^(\d{1,3}):([0-5]?\d)([.,](\d{1,3}))?$/;
const SECONDS = /^(\d+)([.,](\d{1,6}))?$/;
const MILLIS = /^(\d+)\s*ms$/i;

export function parseTimecode(input: string): number {
  const raw = String(input).trim();
  if (!raw) throw new AppError("VALIDATION_ERROR", "Empty timecode.");

  const ms = MILLIS.exec(raw);
  if (ms) return int(ms[1]);

  const hms = HMS.exec(raw);
  if (hms) {
    return int(hms[1]) * 3_600_000 + int(hms[2]) * 60_000 + int(hms[3]) * 1000 + fraction(hms[5]);
  }

  const mmss = MS_ONLY.exec(raw);
  if (mmss) {
    return int(mmss[1]) * 60_000 + int(mmss[2]) * 1000 + fraction(mmss[4]);
  }

  const sec = SECONDS.exec(raw);
  if (sec) {
    return int(sec[1]) * 1000 + fraction(sec[3]);
  }

  throw new AppError("VALIDATION_ERROR", `Unrecognised timecode format: "${raw}"`);
}

function int(s: string): number {
  return Number.parseInt(s, 10);
}

/** Fractional seconds are padded/truncated to exactly milliseconds. */
function fraction(digits: string | undefined): number {
  if (!digits) return 0;
  const padded = (digits + "000").slice(0, 3);
  return Number.parseInt(padded, 10);
}

/** Format milliseconds as SRT timecode. */
export function formatSrt(ms: number): string {
  return format(ms, ",");
}

/** Format milliseconds as VTT / human timecode. */
export function formatTimecode(ms: number): string {
  return format(ms, ".");
}

function format(msTotal: number, sep: string): string {
  const ms = Math.max(0, Math.round(msTotal));
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const rem = ms % 1000;
  return `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)}${sep}${pad(rem, 3)}`;
}

/** Short display form, e.g. 4:07 or 1:04:07 */
export function formatShort(msTotal: number): string {
  const ms = Math.max(0, Math.round(msTotal));
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return h > 0 ? `${h}:${pad(m, 2)}:${pad(s, 2)}` : `${m}:${pad(s, 2)}`;
}

function pad(n: number, width: number): string {
  return String(n).padStart(width, "0");
}

/** Milliseconds → seconds string suitable for FFmpeg arguments. */
export function msToSeconds(ms: number): string {
  return (Math.round(ms) / 1000).toFixed(3);
}
