import { describe, expect, it } from "vitest";
import { buildTimeline, type BuildShotInput } from "@/lib/timeline/build";
import { validateTimeline } from "@/lib/timeline/validate";
import { motionPlan, selectMotion } from "@/lib/timeline/motion";
import { CINEMATIC_DOCUMENTARY, MINIMAL } from "@/lib/domain/styles";
import { analyzeTimeline } from "@/lib/cinematic/analyze";
import { contentHash } from "@/lib/core/hash";

function shots(count: number, durationMs = 4000): BuildShotInput[] {
  return Array.from({ length: count }, (_, i) => ({
    shotId: `shot_${i}`,
    sceneId: `scene_${Math.floor(i / 3)}`,
    sectionId: `section_${Math.floor(i / 9)}`,
    idx: i,
    startMs: i * durationMs,
    endMs: (i + 1) * durationMs,
    visualIntent: (["ESTABLISHING", "WIDE", "MEDIUM", "CLOSE_UP", "DETAIL"] as const)[i % 5],
    narrationText: `Narration for shot ${i}. It has a reasonable number of words in it.`,
    assetId: `asset_${i}`,
    assetVersionId: `av_${i}`,
    storageKey: `p/assets/${i}.png`,
  }));
}

describe("timeline builder", () => {
  it("produces a contiguous, valid timeline", () => {
    const built = buildTimeline({ projectId: "p1", audioDurationMs: 40_000, style: CINEMATIC_DOCUMENTARY, shots: shots(10) });
    const result = validateTimeline(built.doc);
    expect(result.valid).toBe(true);
    expect(result.blocking).toHaveLength(0);
    expect(built.doc.clips[0].startMs).toBe(0);
    expect(built.doc.clips.at(-1)!.endMs).toBe(40_000);
  });

  it("is fully deterministic across runs", () => {
    const input = { projectId: "p1", audioDurationMs: 40_000, style: CINEMATIC_DOCUMENTARY, shots: shots(10) };
    const a = buildTimeline(input);
    const b = buildTimeline(input);
    expect(a.contentHash).toBe(b.contentHash);
    expect(contentHash(a.doc)).toBe(contentHash(b.doc));
    expect(a.doc.clips.map((c) => c.motion)).toEqual(b.doc.clips.map((c) => c.motion));
  });

  it("closes gaps and records every correction", () => {
    const s = shots(3);
    s[1].startMs += 500; // introduce a gap
    const built = buildTimeline({ projectId: "p1", audioDurationMs: 12_000, style: CINEMATIC_DOCUMENTARY, shots: s });
    expect(built.corrections.length).toBeGreaterThan(0);
    expect(validateTimeline(built.doc).valid).toBe(true);
  });

  it("always extends the last clip to the audio duration", () => {
    const built = buildTimeline({ projectId: "p1", audioDurationMs: 50_000, style: CINEMATIC_DOCUMENTARY, shots: shots(10) });
    expect(built.doc.clips.at(-1)!.endMs).toBe(50_000);
    expect(validateTimeline(built.doc).valid).toBe(true);
  });

  it("flags a missing asset as blocking", () => {
    const s = shots(3);
    s[1].assetVersionId = null;
    s[1].storageKey = null;
    const built = buildTimeline({ projectId: "p1", audioDurationMs: 12_000, style: CINEMATIC_DOCUMENTARY, shots: s });
    const result = validateTimeline(built.doc);
    expect(result.valid).toBe(false);
    expect(result.blocking.some((v) => v.code === "MISSING_ASSET")).toBe(true);
  });

  it("never emits a transition longer than a third of the shot", () => {
    const built = buildTimeline({ projectId: "p1", audioDurationMs: 3000, style: CINEMATIC_DOCUMENTARY, shots: shots(3, 1000) });
    for (const clip of built.doc.clips) {
      expect(clip.transitionMs).toBeLessThanOrEqual(Math.floor((clip.endMs - clip.startMs) / 3));
    }
  });

  it("only uses transitions the style permits", () => {
    const built = buildTimeline({ projectId: "p1", audioDurationMs: 40_000, style: MINIMAL, shots: shots(10) });
    for (const clip of built.doc.clips) {
      expect(MINIMAL.transitions.allowed).toContain(clip.transitionIn);
    }
  });
});

describe("motion engine", () => {
  it("forces STATIC on very short shots", () => {
    expect(
      selectMotion({ shotId: "s1", durationMs: 500, visualIntent: "WIDE", style: CINEMATIC_DOCUMENTARY }),
    ).toBe("STATIC");
  });

  it("is deterministic for the same seed", () => {
    const args = { shotId: "s1", durationMs: 4000, visualIntent: "WIDE" as const, style: CINEMATIC_DOCUMENTARY };
    expect(selectMotion(args)).toBe(selectMotion(args));
  });

  it("only selects motions the style permits", () => {
    for (let i = 0; i < 50; i++) {
      const m = selectMotion({ shotId: `s${i}`, durationMs: 4000, visualIntent: "ABSTRACT", style: MINIMAL });
      expect(MINIMAL.motion.allowed).toContain(m);
    }
  });

  it("respects style scale and pan safety limits", () => {
    for (const motion of CINEMATIC_DOCUMENTARY.motion.allowed) {
      const plan = motionPlan(motion, 8000, CINEMATIC_DOCUMENTARY);
      expect(Math.abs(plan.startPanX)).toBeLessThanOrEqual(CINEMATIC_DOCUMENTARY.motion.maxPanFraction + 1e-9);
      expect(Math.abs(plan.endPanY)).toBeLessThanOrEqual(CINEMATIC_DOCUMENTARY.motion.maxPanFraction + 1e-9);
      expect(plan.startScale).toBeGreaterThanOrEqual(1);
      expect(plan.endScale).toBeGreaterThanOrEqual(1);
    }
  });

  it("scales motion amplitude down for shorter shots", () => {
    const short = motionPlan("SLOW_ZOOM_IN", 1500, CINEMATIC_DOCUMENTARY);
    const long = motionPlan("SLOW_ZOOM_IN", 8000, CINEMATIC_DOCUMENTARY);
    expect(long.endScale).toBeGreaterThan(short.endScale);
  });
});

describe("cinematic analysis", () => {
  it("scores a healthy timeline well", () => {
    const built = buildTimeline({ projectId: "p1", audioDurationMs: 40_000, style: CINEMATIC_DOCUMENTARY, shots: shots(10) });
    const result = analyzeTimeline({
      doc: built.doc,
      style: CINEMATIC_DOCUMENTARY,
      assetQuality: built.doc.clips.map((c, i) => ({ shotId: c.shotId, qcScore: 0.85, qcGate: "PASS", contentHash: `h${i}` })),
    });
    expect(result.overallScore).toBeGreaterThan(0.6);
    expect(["PASS", "WARNINGS"]).toContain(result.gate);
  });

  it("detects repeated assets", () => {
    const built = buildTimeline({ projectId: "p1", audioDurationMs: 40_000, style: CINEMATIC_DOCUMENTARY, shots: shots(10) });
    const result = analyzeTimeline({
      doc: built.doc,
      style: CINEMATIC_DOCUMENTARY,
      assetQuality: built.doc.clips.map((c) => ({ shotId: c.shotId, qcScore: 0.85, qcGate: "PASS", contentHash: "same" })),
    });
    expect(result.issues.some((i) => i.code === "REPEATED_ASSET")).toBe(true);
    expect(result.dimensions.diversity).toBeLessThan(0.6);
  });

  it("flags flicker-length shots and offers a safe fix", () => {
    const built = buildTimeline({ projectId: "p1", audioDurationMs: 2000, style: CINEMATIC_DOCUMENTARY, shots: shots(4, 500) });
    const result = analyzeTimeline({
      doc: built.doc,
      style: CINEMATIC_DOCUMENTARY,
      assetQuality: built.doc.clips.map((c, i) => ({ shotId: c.shotId, qcScore: 0.8, qcGate: "PASS", contentHash: `h${i}` })),
    });
    expect(result.issues.some((i) => i.code === "PACING_TOO_FAST")).toBe(true);
  });

  it("fails an empty timeline rather than scoring it", () => {
    const result = analyzeTimeline({
      doc: { durationMs: 1000, clips: [], overlays: [] },
      style: CINEMATIC_DOCUMENTARY,
      assetQuality: [],
    });
    expect(result.gate).toBe("FAIL");
    expect(result.overallScore).toBe(0);
  });

  it("is deterministic", () => {
    const built = buildTimeline({ projectId: "p1", audioDurationMs: 40_000, style: CINEMATIC_DOCUMENTARY, shots: shots(10) });
    const q = built.doc.clips.map((c, i) => ({ shotId: c.shotId, qcScore: 0.8, qcGate: "PASS", contentHash: `h${i}` }));
    const a = analyzeTimeline({ doc: built.doc, style: CINEMATIC_DOCUMENTARY, assetQuality: q });
    const b = analyzeTimeline({ doc: built.doc, style: CINEMATIC_DOCUMENTARY, assetQuality: q });
    expect(contentHash(a)).toBe(contentHash(b));
  });
});
