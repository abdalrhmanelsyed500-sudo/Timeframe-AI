import { AppError } from "@/lib/errors";
import type { ZodType } from "zod";

/**
 * AI output is untrusted data. Parse defensively, then schema-validate.
 * We never eval, never execute and never trust embedded URLs or markup.
 */
export function extractJson(raw: string): unknown {
  const text = raw.trim();

  const candidates: string[] = [];
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  if (fenced) candidates.push(fenced[1].trim());
  candidates.push(text);

  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) candidates.push(text.slice(firstBrace, lastBrace + 1));
  const firstBracket = text.indexOf("[");
  const lastBracket = text.lastIndexOf("]");
  if (firstBracket >= 0 && lastBracket > firstBracket) candidates.push(text.slice(firstBracket, lastBracket + 1));

  for (const c of candidates) {
    try {
      return JSON.parse(c);
    } catch {
      try {
        // Tolerate trailing commas, a common model artefact.
        return JSON.parse(c.replace(/,\s*([}\]])/g, "$1"));
      } catch {
        continue;
      }
    }
  }
  throw new AppError("PROVIDER_ERROR", "The AI response was not valid JSON.", {
    context: { preview: text.slice(0, 800) },
  });
}

export function parseAiJson<T>(raw: string, schema: ZodType<T>, what: string): T {
  const data = extractJson(raw);
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new AppError("PROVIDER_ERROR", `The AI response for ${what} did not match the expected structure.`, {
      context: {
        issues: result.error.issues.slice(0, 20).map((i) => `${i.path.join(".")}: ${i.message}`),
      },
    });
  }
  return result.data;
}
