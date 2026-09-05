import { describe, expect, it } from "vitest";
import { planRender } from "@/lib/render/plan";
import { getProfile, PROFILE_LIST } from "@/lib/render/profiles";
import { buildTimeline, type BuildShotInput } from "@/lib/timeline/build";
import { CINEMATIC_DOCUMENTARY } from "@/lib/domain/styles";
import { AppError } from "@/lib/errors";

function shots(count: number, durationMs = 4000): BuildShotInput[] {
  return Array.from({ length: count }, (_, i) => ({
    shotId: `shot_${i}`,
    sceneId: "scene_0",
    sectionId: "section_0",
    idx: i,
    startMs: i * durationMs,
    endMs: (i + 1) * durationMs,
    visualIntent: "WIDE" as const,
    narrationText: `Line ${i}`,
    assetId: `asset_${i}`,
    assetVersionId: `av_${i}`,
    storageKey: `p/assets/${i}.png`,
  }));
}

function fixture(count = 4, durationMs = 4000) {
  const built = buildTimeline({
    projectId: "p1",
    audioDurationMs: count * durationMs,
    style: CINEMATIC_DOCUMENTARY,
    shots: shots(count, durationMs),
  });
  const imagePaths = new Map(built.doc.clips.map((c) => [c.shotId, `/tmp/tf/${c.shotId}.png`]));
  return { doc: built.doc, imagePaths };
}

describe("render planner", () => {
  it("builds an argv array with one input per clip plus the canvas and audio", () => {
    const { doc, imagePaths } = fixture();
    const plan = planRender({
      doc,
      style: CINEMATIC_DOCUMENTARY,
      profile: getProfile("FULL_HD"),
      audioPath: "/tmp/tf/voice.wav",
      imagePaths,
      outputPath: "/tmp/tf/out.mp4",
    });
    expect(Array.isArray(plan.args)).toBe(true);
    expect(plan.clipCount).toBe(doc.clips.length);
    expect(plan.args.filter((a) => a === "-i")).toHaveLength(doc.clips.length + 2);
    expect(plan.args).toContain("/tmp/tf/voice.wav");
    expect(plan.args.at(-1)).toBe("/tmp/tf/out.mp4");
  });

  it("encodes to the browser-safe h264/aac contract", () => {
    const { doc, imagePaths } = fixture();
    const args = planRender({
      doc,
      style: CINEMATIC_DOCUMENTARY,
      profile: getProfile("FULL_HD"),
      audioPath: "/tmp/tf/voice.wav",
      imagePaths,
      outputPath: "/tmp/tf/out.mp4",
    }).args;
    const joined = args.join(" ");
    expect(joined).toContain("libx264");
    expect(joined).toContain("yuv420p");
    expect(joined).toContain("aac");
    expect(joined).toContain("+faststart");
  });

  it("never emits xfade (unavailable in the bundled FFmpeg build)", () => {
    const { doc, imagePaths } = fixture();
    const joined = planRender({
      doc,
      style: CINEMATIC_DOCUMENTARY,
      profile: getProfile("FULL_HD"),
      audioPath: "/tmp/tf/voice.wav",
      imagePaths,
      outputPath: "/tmp/tf/out.mp4",
    }).args.join(" ");
    expect(joined).not.toContain("xfade");
    expect(joined).toContain("overlay");
  });

  it("reports progress on a parseable pipe", () => {
    const { doc, imagePaths } = fixture();
    const args = planRender({
      doc,
      style: CINEMATIC_DOCUMENTARY,
      profile: getProfile("FULL_HD"),
      audioPath: "/tmp/tf/voice.wav",
      imagePaths,
      outputPath: "/tmp/tf/out.mp4",
    }).args;
    expect(args).toContain("-progress");
    expect(args).toContain("pipe:1");
  });

  it("plans only the requested window when chunking", () => {
    const { doc, imagePaths } = fixture(10);
    const plan = planRender({
      doc,
      style: CINEMATIC_DOCUMENTARY,
      profile: getProfile("FULL_HD"),
      audioPath: "/tmp/tf/voice.wav",
      imagePaths,
      outputPath: "/tmp/tf/chunk.mp4",
      window: { startMs: 8000, endMs: 20_000 },
    });
    expect(plan.durationMs).toBe(12_000);
    expect(plan.clipCount).toBeLessThan(doc.clips.length);
  });

  it("refuses to render an empty window instead of producing a bogus file", () => {
    const { doc, imagePaths } = fixture();
    expect(() =>
      planRender({
        doc,
        style: CINEMATIC_DOCUMENTARY,
        profile: getProfile("FULL_HD"),
        audioPath: "/tmp/tf/voice.wav",
        imagePaths,
        outputPath: "/tmp/tf/out.mp4",
        window: { startMs: 5000, endMs: 5000 },
      }),
    ).toThrowError(AppError);
  });

  it("fails loudly when an image is missing rather than silently skipping a shot", () => {
    const { doc, imagePaths } = fixture();
    imagePaths.delete(doc.clips[1].shotId);
    expect(() =>
      planRender({
        doc,
        style: CINEMATIC_DOCUMENTARY,
        profile: getProfile("FULL_HD"),
        audioPath: "/tmp/tf/voice.wav",
        imagePaths,
        outputPath: "/tmp/tf/out.mp4",
      }),
    ).toThrowError(/shot_1/);
  });

  it("keeps shell metacharacters inert by passing them as discrete argv entries", () => {
    const { doc, imagePaths } = fixture();
    const evil = "/tmp/tf/a b;rm -rf $(echo x)`whoami`.mp4";
    const plan = planRender({
      doc,
      style: CINEMATIC_DOCUMENTARY,
      profile: getProfile("FULL_HD"),
      audioPath: "/tmp/tf/voice.wav",
      imagePaths,
      outputPath: evil,
    });
    // The path is exactly one argument; nothing is concatenated into a command string.
    expect(plan.args.filter((a) => a === evil)).toHaveLength(1);
    expect(plan.args.every((a) => typeof a === "string")).toBe(true);
  });

  it("is deterministic for identical input", () => {
    const { doc, imagePaths } = fixture();
    const mk = () =>
      planRender({
        doc,
        style: CINEMATIC_DOCUMENTARY,
        profile: getProfile("FULL_HD"),
        audioPath: "/tmp/tf/voice.wav",
        imagePaths,
        outputPath: "/tmp/tf/out.mp4",
      }).args;
    expect(mk()).toEqual(mk());
  });

  it("honours every registered render profile", () => {
    const { doc, imagePaths } = fixture();
    for (const profile of PROFILE_LIST) {
      const args = planRender({
        doc,
        style: CINEMATIC_DOCUMENTARY,
        profile,
        audioPath: "/tmp/tf/voice.wav",
        imagePaths,
        outputPath: "/tmp/tf/out.mp4",
      }).args.join(" ");
      expect(args).toContain(`${profile.width}x${profile.height}`);
    }
  });

  it("rejects an unknown profile key", () => {
    expect(() => getProfile("8k-holographic")).toThrowError(AppError);
  });
});
