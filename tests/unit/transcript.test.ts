import { describe, expect, it } from "vitest";
import { detectFormat, normalizeSegments, parseTranscript } from "@/lib/transcript/parse";

const SRT = `1
00:00:00,000 --> 00:00:03,500
The first line of narration.

2
00:00:03,500 --> 00:00:07,000
The second line of narration.
`;

const VTT = `WEBVTT

00:00:00.000 --> 00:00:02.000
Hello there.

00:00:02.000 --> 00:00:04.000
General narration.
`;

describe("transcript parsing", () => {
  it("detects formats", () => {
    expect(detectFormat("a.srt", SRT)).toBe("srt");
    expect(detectFormat("a.vtt", VTT)).toBe("vtt");
    expect(detectFormat("unknown", VTT)).toBe("vtt");
    expect(detectFormat("unknown", SRT)).toBe("srt");
    expect(detectFormat("x.json", "[]")).toBe("json");
  });

  it("parses SRT", () => {
    const segs = parseTranscript(SRT, "srt", { audioDurationMs: 7000 });
    expect(segs).toHaveLength(2);
    expect(segs[0]).toEqual({ startMs: 0, endMs: 3500, text: "The first line of narration." });
  });

  it("parses VTT and strips the header", () => {
    const segs = parseTranscript(VTT, "vtt", { audioDurationMs: 4000 });
    expect(segs).toHaveLength(2);
    expect(segs[1].text).toBe("General narration.");
  });

  it("parses JSON with mixed key names", () => {
    const json = JSON.stringify([
      { start: "00:00:00,000", end: "00:00:01,000", text: "one" },
      { startMs: 1000, endMs: 2000, content: "two" },
    ]);
    const segs = parseTranscript(json, "json", { audioDurationMs: 2000 });
    expect(segs.map((s) => s.text)).toEqual(["one", "two"]);
  });

  it("parses CSV with a header row", () => {
    const csv = 'start,end,text\n0,1000,"Hello, world"\n1000,2000,Second\n';
    const segs = parseTranscript(csv, "csv", { audioDurationMs: 2000 });
    expect(segs).toHaveLength(2);
    expect(segs[0].text).toBe("Hello, world");
  });

  it("distributes plain text across the audio duration", () => {
    const segs = parseTranscript("One sentence. Two sentence. Three sentence.", "txt", { audioDurationMs: 9000 });
    expect(segs).toHaveLength(3);
    expect(segs[0].startMs).toBe(0);
    expect(segs[segs.length - 1].endMs).toBe(9000);
  });

  it("repairs overlaps deterministically", () => {
    const out = normalizeSegments(
      [
        { startMs: 0, endMs: 3000, text: "a" },
        { startMs: 2000, endMs: 5000, text: "b" },
      ],
      5000,
    );
    expect(out[0].endMs).toBeLessThanOrEqual(out[1].startMs);
    expect(out[1].endMs).toBe(5000);
  });

  it("clamps beyond the audio duration", () => {
    const out = normalizeSegments([{ startMs: 0, endMs: 99_000, text: "a" }], 5000);
    expect(out[0].endMs).toBe(5000);
  });

  it("merges a collapsed segment into its predecessor rather than dropping text", () => {
    const out = normalizeSegments(
      [
        { startMs: 0, endMs: 3000, text: "keep" },
        { startMs: 1000, endMs: 2000, text: "swallowed" },
      ],
      3000,
    );
    expect(out).toHaveLength(1);
    expect(out[0].text).toContain("swallowed");
  });

  it("throws instead of silently returning nothing", () => {
    expect(() => normalizeSegments([], 1000)).toThrow();
  });
});
