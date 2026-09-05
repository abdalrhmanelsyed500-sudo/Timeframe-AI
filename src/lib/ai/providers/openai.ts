import { AppError } from "@/lib/errors";
import { safeFetch } from "@/lib/security/ssrf";
import type {
  ImageProvider,
  ImageRequest,
  ImageResponse,
  SpeechToTextProvider,
  TextProvider,
  TextRequest,
  TextResponse,
  TranscribeRequest,
  TranscribeResponse,
  VisionProvider,
  VisionRequest,
  VisionResponse,
} from "@/lib/ai/types";

/**
 * Real OpenAI-compatible provider (works with any OpenAI-compatible base URL).
 * The API key is passed in-memory per call and never logged or persisted here.
 */
export interface OpenAiConfig {
  apiKey: string;
  baseUrl?: string;
  textModel: string;
  imageModel: string;
  visionModel: string;
  sttModel: string;
}

const DEFAULT_BASE = "https://api.openai.com/v1";

function classify(status: number, body: string): AppError {
  if (status === 401 || status === 403) {
    return new AppError("PROVIDER_ERROR", "The AI provider rejected your credentials.", {
      context: { status, bodyTail: body.slice(0, 500) },
      retryable: false,
    });
  }
  if (status === 429) {
    return new AppError("RATE_LIMIT_ERROR", "The AI provider is rate limiting requests.", {
      context: { status },
      retryable: true,
    });
  }
  if (status >= 500) {
    return new AppError("PROVIDER_ERROR", "The AI provider is temporarily unavailable.", {
      context: { status, bodyTail: body.slice(0, 500) },
      retryable: true,
    });
  }
  return new AppError("PROVIDER_ERROR", "The AI provider rejected the request.", {
    context: { status, bodyTail: body.slice(0, 500) },
    retryable: false,
  });
}

async function call(cfg: OpenAiConfig, path: string, body: unknown): Promise<unknown> {
  const url = `${(cfg.baseUrl ?? DEFAULT_BASE).replace(/\/$/, "")}${path}`;
  const res = await safeFetch(
    url,
    {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify(body),
    },
    { timeoutMs: 180_000 },
  );
  const text = await res.text();
  if (!res.ok) throw classify(res.status, text);
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new AppError("PROVIDER_ERROR", "The AI provider returned an unreadable response.", { cause: e });
  }
}

export class OpenAiTextProvider implements TextProvider {
  readonly id = "openai";
  constructor(private cfg: OpenAiConfig) {}

  async generateText(req: TextRequest): Promise<TextResponse> {
    const json = (await call(this.cfg, "/chat/completions", {
      model: this.cfg.textModel,
      messages: [
        { role: "system", content: req.system },
        { role: "user", content: req.user },
      ],
      response_format: req.jsonSchemaName ? { type: "json_object" } : undefined,
      temperature: req.temperature ?? 0.4,
      max_tokens: req.maxOutputTokens ?? 8000,
    })) as {
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const content = json.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) {
      throw new AppError("PROVIDER_ERROR", "The AI provider returned an empty response.");
    }
    return {
      text: content,
      provider: "openai",
      model: this.cfg.textModel,
      isMock: false,
      usage: { inputTokens: json.usage?.prompt_tokens, outputTokens: json.usage?.completion_tokens },
    };
  }
}

export class OpenAiImageProvider implements ImageProvider {
  readonly id = "openai";
  constructor(private cfg: OpenAiConfig) {}

  async generateImage(req: ImageRequest): Promise<ImageResponse> {
    const prompt = req.negativePrompt ? `${req.prompt}\n\nAvoid: ${req.negativePrompt}` : req.prompt;
    const json = (await call(this.cfg, "/images/generations", {
      model: this.cfg.imageModel,
      prompt,
      size: `${req.width}x${req.height}`,
      n: 1,
    })) as { data?: { b64_json?: string; url?: string }[] };

    const first = json.data?.[0];
    if (!first) throw new AppError("PROVIDER_ERROR", "The image provider returned no image.");

    let buf: Buffer;
    if (first.b64_json) {
      buf = Buffer.from(first.b64_json, "base64");
    } else if (first.url) {
      const res = await safeFetch(first.url, {}, { timeoutMs: 120_000 });
      if (!res.ok) throw new AppError("PROVIDER_ERROR", "The generated image could not be downloaded.");
      buf = Buffer.from(await res.arrayBuffer());
    } else {
      throw new AppError("PROVIDER_ERROR", "The image provider returned an unusable payload.");
    }

    return {
      data: buf,
      mime: "image/png",
      width: req.width,
      height: req.height,
      provider: "openai",
      model: this.cfg.imageModel,
      isMock: false,
    };
  }
}

export class OpenAiVisionProvider implements VisionProvider {
  readonly id = "openai";
  constructor(private cfg: OpenAiConfig) {}

  async analyzeImage(req: VisionRequest): Promise<VisionResponse> {
    const dataUrl = `data:${req.mime};base64,${req.image.toString("base64")}`;
    const json = (await call(this.cfg, "/chat/completions", {
      model: this.cfg.visionModel,
      messages: [
        { role: "system", content: req.system },
        {
          role: "user",
          content: [
            { type: "text", text: req.user },
            { type: "image_url", image_url: { url: dataUrl } },
          ],
        },
      ],
      response_format: { type: "json_object" },
      temperature: 0,
      max_tokens: 1200,
    })) as { choices?: { message?: { content?: string } }[] };
    const content = json.choices?.[0]?.message?.content;
    if (typeof content !== "string") throw new AppError("PROVIDER_ERROR", "The vision provider returned no result.");
    return { text: content, provider: "openai", model: this.cfg.visionModel, isMock: false };
  }
}

export class OpenAiSttProvider implements SpeechToTextProvider {
  readonly id = "openai";
  constructor(private cfg: OpenAiConfig) {}

  async transcribeAudio(req: TranscribeRequest): Promise<TranscribeResponse> {
    const url = `${(this.cfg.baseUrl ?? DEFAULT_BASE).replace(/\/$/, "")}/audio/transcriptions`;
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(req.audio)], { type: req.mime }), req.filename);
    form.append("model", this.cfg.sttModel);
    form.append("response_format", "verbose_json");
    form.append("timestamp_granularities[]", "segment");
    if (req.language) form.append("language", req.language);

    const res = await safeFetch(
      url,
      { method: "POST", headers: { authorization: `Bearer ${this.cfg.apiKey}` }, body: form },
      { timeoutMs: 600_000 },
    );
    const text = await res.text();
    if (!res.ok) throw classify(res.status, text);
    const json = JSON.parse(text) as { segments?: { start: number; end: number; text: string }[]; text?: string };
    if (!json.segments?.length) {
      throw new AppError("PROVIDER_ERROR", "The transcription provider returned no timed segments.");
    }
    return {
      segments: json.segments.map((s) => ({
        startMs: Math.round(s.start * 1000),
        endMs: Math.round(s.end * 1000),
        text: s.text.trim(),
      })),
      provider: "openai",
      model: this.cfg.sttModel,
      isMock: false,
    };
  }
}
