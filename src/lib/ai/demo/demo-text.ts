import { stableInt } from "@/lib/core/hash";
import type { TextProvider, TextRequest, TextResponse, VisionProvider, VisionRequest, VisionResponse } from "@/lib/ai/types";
import { planStory, planVisualBible, type PlannerInput } from "./demo-planner";

/**
 * DEMO TEXT/VISION PROVIDERS — NOT AI MODELS.
 *
 * These run the deterministic heuristic planner locally. They are only reachable
 * when DEMO_MODE=true, and every result is flagged isMock: true.
 */

export interface DemoStoryPayload {
  kind: "story";
  input: PlannerInput;
}

export interface DemoVisualBiblePayload {
  kind: "visual_bible";
  input: Parameters<typeof planVisualBible>[0];
}

export type DemoPayload = DemoStoryPayload | DemoVisualBiblePayload;

export class DemoTextProvider implements TextProvider {
  readonly id = "demo";

  async generateText(req: TextRequest): Promise<TextResponse> {
    const payload = req.demoPayload as DemoPayload | undefined;
    if (!payload) {
      throw new Error("Demo text provider requires a structured demoPayload.");
    }
    let text: string;
    if (payload.kind === "story") text = JSON.stringify(planStory(payload.input));
    else text = JSON.stringify(planVisualBible(payload.input));
    return { text, provider: "demo", model: "demo-text-v1", isMock: true };
  }
}

export class DemoVisionProvider implements VisionProvider {
  readonly id = "demo";

  /**
   * Deterministic structural inspection of the real image bytes: it measures
   * actual byte entropy and size to derive stable, image-dependent scores.
   * It does NOT understand image content — it is explicitly labelled a mock.
   */
  async analyzeImage(req: VisionRequest): Promise<VisionResponse> {
    const buf = req.image;
    const sampleCount = Math.min(buf.length, 65_536);
    const histogram = new Array<number>(256).fill(0);
    const step = Math.max(1, Math.floor(buf.length / sampleCount));
    let sampled = 0;
    for (let i = 0; i < buf.length; i += step) {
      histogram[buf[i]]++;
      sampled++;
    }
    let entropy = 0;
    for (const c of histogram) {
      if (c === 0) continue;
      const p = c / sampled;
      entropy -= p * Math.log2(p);
    }
    const normEntropy = Math.min(1, entropy / 8);
    const seed = stableInt(req.seed ?? String(buf.length));
    const jitter = (n: number) => Math.max(0.5, Math.min(0.99, n + (((seed >> (n * 3)) % 11) - 5) / 100));

    const base = 0.68 + normEntropy * 0.28;
    const scores = {
      composition: jitter(base),
      subject: jitter(base - 0.02),
      style: jitter(base + 0.01),
      continuity: jitter(base - 0.01),
      quality: jitter(base),
      promptAdherence: jitter(base - 0.03),
    };
    const issues: string[] = [];
    if (normEntropy < 0.35) issues.push("Image appears visually flat with limited detail.");
    if (buf.length < 8_000) issues.push("Image file is unusually small for the requested resolution.");

    return {
      text: JSON.stringify({
        scores,
        artifacts: [],
        issues,
        recommendation: issues.length > 1 ? "REVIEW" : "ACCEPT",
      }),
      provider: "demo",
      model: "demo-vision-v1",
      isMock: true,
    };
  }
}
