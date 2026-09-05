import { loadEnv } from "@/lib/env";
import { AppError } from "@/lib/errors";
import type { QualityPreset } from "@/lib/domain/vocab";
import { modelForPreset, type Capability, type ModelSpec } from "./registry";
import { resolveSecret } from "./credentials";
import type { ImageProvider, SpeechToTextProvider, TextProvider, VisionProvider } from "./types";
import { DemoImageProvider } from "./demo/demo-image";
import { DemoTextProvider, DemoVisionProvider } from "./demo/demo-text";
import {
  OpenAiImageProvider,
  OpenAiSttProvider,
  OpenAiTextProvider,
  OpenAiVisionProvider,
  type OpenAiConfig,
} from "./providers/openai";

/**
 * Provider resolution policy — the one place that decides real vs demo.
 *
 * - REAL_PROVIDER_ENABLED=true  → a real credential is REQUIRED. If it is
 *   missing we raise CONFIGURATION_ERROR. We never silently fall back to mocks.
 * - DEMO_MODE=true              → deterministic local mocks, always labelled.
 * - Neither                     → CONFIGURATION_ERROR.
 */
export type ProviderMode = "real" | "demo";

export interface ResolvedProviders {
  mode: ProviderMode;
  spec: ModelSpec;
  text?: TextProvider;
  image?: ImageProvider;
  vision?: VisionProvider;
  stt?: SpeechToTextProvider;
}

export function providerMode(): ProviderMode {
  const env = loadEnv();
  if (env.REAL_PROVIDER_ENABLED) return "real";
  if (env.DEMO_MODE) return "demo";
  throw new AppError(
    "CONFIGURATION_ERROR",
    "No AI provider is configured. Enable REAL_PROVIDER_ENABLED with credentials, or DEMO_MODE for deterministic demo output.",
  );
}

const REAL_PROVIDER = "openai";
const DEMO_PROVIDER = "demo";

async function openAiConfig(userId: string, preset: QualityPreset): Promise<OpenAiConfig> {
  const secret = await resolveSecret(userId, REAL_PROVIDER);
  if (!secret) {
    throw new AppError(
      "CONFIGURATION_ERROR",
      "Real AI generation is enabled but no provider credential is configured. Add an API key in Provider Settings.",
    );
  }
  return {
    apiKey: secret.apiKey,
    baseUrl: secret.baseUrl ?? undefined,
    textModel: modelForPreset(REAL_PROVIDER, "text", preset)?.model ?? "gpt-4o-mini",
    imageModel: modelForPreset(REAL_PROVIDER, "image", preset)?.model ?? "gpt-image-1",
    visionModel: modelForPreset(REAL_PROVIDER, "vision", preset)?.model ?? "gpt-4o-mini",
    sttModel: modelForPreset(REAL_PROVIDER, "stt", preset)?.model ?? "whisper-1",
  };
}

function demoSpec(capability: Capability): ModelSpec {
  const spec = modelForPreset(DEMO_PROVIDER, capability, "BALANCED");
  if (!spec) throw new AppError("CONFIGURATION_ERROR", `No demo model registered for ${capability}.`);
  return spec;
}

export async function resolveProvider(
  capability: Capability,
  ctx: { userId: string; preset: QualityPreset },
): Promise<ResolvedProviders> {
  const mode = providerMode();

  if (mode === "demo") {
    if (capability === "stt") {
      throw new AppError(
        "CONFIGURATION_ERROR",
        "Speech-to-text is unavailable in demo mode. Import an SRT/VTT transcript, or configure a real provider.",
      );
    }
    return {
      mode,
      spec: demoSpec(capability),
      text: capability === "text" ? new DemoTextProvider() : undefined,
      image: capability === "image" ? new DemoImageProvider() : undefined,
      vision: capability === "vision" ? new DemoVisionProvider() : undefined,
    };
  }

  const cfg = await openAiConfig(ctx.userId, ctx.preset);
  const spec = modelForPreset(REAL_PROVIDER, capability, ctx.preset);
  if (!spec) throw new AppError("CONFIGURATION_ERROR", `No model registered for ${capability}.`);
  return {
    mode,
    spec,
    text: capability === "text" ? new OpenAiTextProvider(cfg) : undefined,
    image: capability === "image" ? new OpenAiImageProvider(cfg) : undefined,
    vision: capability === "vision" ? new OpenAiVisionProvider(cfg) : undefined,
    stt: capability === "stt" ? new OpenAiSttProvider(cfg) : undefined,
  };
}

/** Safe, secret-free health view. */
export async function providerHealth(userId: string): Promise<{
  mode: ProviderMode | "unconfigured";
  realProviderConfigured: boolean;
  demoMode: boolean;
  sttAvailable: boolean;
}> {
  const env = loadEnv();
  let mode: ProviderMode | "unconfigured";
  try {
    mode = providerMode();
  } catch {
    mode = "unconfigured";
  }
  const secret = env.REAL_PROVIDER_ENABLED ? await resolveSecret(userId, REAL_PROVIDER).catch(() => null) : null;
  return {
    mode,
    realProviderConfigured: Boolean(secret),
    demoMode: Boolean(env.DEMO_MODE),
    sttAvailable: Boolean(secret),
  };
}
