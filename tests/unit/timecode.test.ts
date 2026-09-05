import { describe, expect, it } from "vitest";
import { formatSrt, formatShort, formatTimecode, msToSeconds, parseTimecode } from "@/lib/core/timecode";
import { AppError } from "@/lib/errors";

describe("timecode parser", () => {
  it("parses SRT comma form", () => {
    expect(parseTimecode("00:00:01,250")).toBe(1250);
    expect(parseTimecode("01:02:03,004")).toBe(3_723_004);
  });

  it("parses VTT dot form", () => {
    expect(parseTimecode("00:00:01.250")).toBe(1250);
  });

  it("parses bare seconds", () => {
    expect(parseTimecode("1.250")).toBe(1250);
    expect(parseTimecode("90")).toBe(90_000);
  });

  it("parses mm:ss", () => {
    expect(parseTimecode("02:30.500")).toBe(150_500);
  });

  it("parses explicit milliseconds", () => {
    expect(parseTimecode("4200ms")).toBe(4200);
  });

  it("pads short fractional parts correctly", () => {
    expect(parseTimecode("00:00:01,5")).toBe(1500);
    expect(parseTimecode("00:00:01,05")).toBe(1050);
  });

  it("truncates over-long fractions to milliseconds", () => {
    expect(parseTimecode("1.999999")).toBe(1999);
  });

  it("rejects garbage", () => {
    expect(() => parseTimecode("not a time")).toThrow(AppError);
    expect(() => parseTimecode("")).toThrow(AppError);
  });

  it("round-trips through formatting", () => {
    for (const ms of [0, 1, 999, 1000, 61_000, 3_600_000, 7_384_213]) {
      expect(parseTimecode(formatSrt(ms))).toBe(ms);
      expect(parseTimecode(formatTimecode(ms))).toBe(ms);
    }
  });

  it("formats short display form", () => {
    expect(formatShort(65_000)).toBe("1:05");
    expect(formatShort(3_725_000)).toBe("1:02:05");
  });

  it("emits FFmpeg-safe seconds", () => {
    expect(msToSeconds(1500)).toBe("1.500");
    expect(msToSeconds(0)).toBe("0.000");
  });
});
