export interface ProviderIdentity {
  provider: string;
  model: string;
  /** True when the output came from a deterministic local mock, not a real model. */
  isMock: boolean;
}

export interface TextRequest {
  system: string;
  user: string;
  /** JSON schema name for structured output; providers that support it will enforce it. */
  jsonSchemaName?: string;
  maxOutputTokens?: number;
  temperature?: number;
  /** Deterministic seed for reproducible mock output. */
  seed?: string;
  /**
   * Structured input for the deterministic demo planner. Real providers ignore
   * this entirely — they only ever see `system` and `user`.
   */
  demoPayload?: unknown;
}

export interface TextResponse extends ProviderIdentity {
  text: string;
  usage?: { inputTokens?: number; outputTokens?: number };
}

export interface ImageRequest {
  prompt: string;
  negativePrompt?: string;
  width: number;
  height: number;
  seed?: string;
}

export interface ImageResponse extends ProviderIdentity {
  data: Buffer;
  mime: string;
  width: number;
  height: number;
}

export interface VisionRequest {
  image: Buffer;
  mime: string;
  system: string;
  user: string;
  seed?: string;
}

export interface VisionResponse extends ProviderIdentity {
  text: string;
}

export interface TranscribeRequest {
  audio: Buffer;
  mime: string;
  filename: string;
  language?: string;
}

export interface TranscribeResponse extends ProviderIdentity {
  segments: { startMs: number; endMs: number; text: string }[];
}

export interface TextProvider {
  readonly id: string;
  generateText(req: TextRequest): Promise<TextResponse>;
}

export interface ImageProvider {
  readonly id: string;
  generateImage(req: ImageRequest): Promise<ImageResponse>;
}

export interface VisionProvider {
  readonly id: string;
  analyzeImage(req: VisionRequest): Promise<VisionResponse>;
}

export interface SpeechToTextProvider {
  readonly id: string;
  transcribeAudio(req: TranscribeRequest): Promise<TranscribeResponse>;
}
