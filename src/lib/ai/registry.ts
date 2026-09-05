import type { QualityPreset } from "@/lib/domain/vocab";

/**
 * Single source of truth for provider/model metadata.
 * Costs are published list prices used for ESTIMATES only — never presented
 * as actual billed amounts.
 */
export type Capability = "text" | "image" | "vision" | "stt";

export interface ModelSpec {
  provider: string;
  model: string;
  capability: Capability;
  /** USD per unit. Unit depends on capability. */
  unitCostUsd: number;
  unit: "per_image" | "per_1k_input_tokens" | "per_1k_output_tokens" | "per_call" | "per_audio_minute";
  supportedSizes?: { width: number; height: number }[];
  aspectRatios?: string[];
  maxConcurrency: number;
}

export const MODELS: ModelSpec[] = [
  {
    provider: "openai",
    model: "gpt-4o-mini",
    capability: "text",
    unitCostUsd: 0.0006,
    unit: "per_1k_output_tokens",
    maxConcurrency: 4,
  },
  {
    provider: "openai",
    model: "gpt-4o",
    capability: "text",
    unitCostUsd: 0.01,
    unit: "per_1k_output_tokens",
    maxConcurrency: 3,
  },
  {
    provider: "openai",
    model: "gpt-4o-mini",
    capability: "vision",
    unitCostUsd: 0.002,
    unit: "per_call",
    maxConcurrency: 4,
  },
  {
    provider: "openai",
    model: "gpt-image-1",
    capability: "image",
    unitCostUsd: 0.04,
    unit: "per_image",
    supportedSizes: [
      { width: 1024, height: 1024 },
      { width: 1536, height: 1024 },
      { width: 1024, height: 1536 },
    ],
    aspectRatios: ["1:1", "3:2", "2:3"],
    maxConcurrency: 3,
  },
  {
    provider: "openai",
    model: "whisper-1",
    capability: "stt",
    unitCostUsd: 0.006,
    unit: "per_audio_minute",
    maxConcurrency: 2,
  },
  {
    provider: "demo",
    model: "demo-text-v1",
    capability: "text",
    unitCostUsd: 0,
    unit: "per_call",
    maxConcurrency: 8,
  },
  {
    provider: "demo",
    model: "demo-image-v1",
    capability: "image",
    unitCostUsd: 0,
    unit: "per_image",
    maxConcurrency: 8,
  },
  {
    provider: "demo",
    model: "demo-vision-v1",
    capability: "vision",
    unitCostUsd: 0,
    unit: "per_call",
    maxConcurrency: 8,
  },
];

export function findModel(provider: string, capability: Capability, model?: string): ModelSpec | undefined {
  return MODELS.find(
    (m) => m.provider === provider && m.capability === capability && (model ? m.model === model : true),
  );
}

/** Preset → concrete model selection, per capability. Not hard-coded at call sites. */
const PRESET_MODELS: Record<QualityPreset, Partial<Record<Capability, string>>> = {
  FAST: { text: "gpt-4o-mini", image: "gpt-image-1", vision: "gpt-4o-mini", stt: "whisper-1" },
  BALANCED: { text: "gpt-4o-mini", image: "gpt-image-1", vision: "gpt-4o-mini", stt: "whisper-1" },
  QUALITY: { text: "gpt-4o", image: "gpt-image-1", vision: "gpt-4o", stt: "whisper-1" },
};

export function modelForPreset(provider: string, capability: Capability, preset: QualityPreset): ModelSpec | undefined {
  const wanted = PRESET_MODELS[preset]?.[capability];
  return findModel(provider, capability, wanted) ?? findModel(provider, capability);
}

/** Image dimensions the provider actually supports, closest to the target ratio. */
export function nearestSupportedSize(spec: ModelSpec, width: number, height: number): { width: number; height: number } {
  if (!spec.supportedSizes || spec.supportedSizes.length === 0) return { width, height };
  const target = width / height;
  let best = spec.supportedSizes[0];
  let bestDiff = Infinity;
  for (const s of spec.supportedSizes) {
    const diff = Math.abs(s.width / s.height - target);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = s;
    }
  }
  return best;
}

export interface CostEstimate {
  provider: string;
  model: string;
  units: number;
  estimatedCostUsd: number;
  basis: "ESTIMATED";
}

export function estimateCost(spec: ModelSpec, units: number): CostEstimate {
  const raw = spec.unitCostUsd * units;
  return {
    provider: spec.provider,
    model: spec.model,
    units,
    estimatedCostUsd: Math.round(raw * 1e6) / 1e6,
    basis: "ESTIMATED",
  };
}
