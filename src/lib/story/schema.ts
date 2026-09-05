import { z } from "zod";
import { CAMERAS, LENSES, PACINGS, TONES, TRANSITIONS, VISUAL_INTENTS, ENTITY_TYPES } from "@/lib/domain/vocab";

/**
 * Schemas for AI-produced structures. AI output is untrusted: it is parsed,
 * schema-validated, semantically validated and normalised before persistence.
 * Fields are permissive here (loose strings) and coerced onto the controlled
 * vocabulary during normalisation, so a single bad enum never discards a plan.
 */

export const AiShotSchema = z.object({
  startMs: z.union([z.number(), z.string()]),
  endMs: z.union([z.number(), z.string()]),
  narrationText: z.string().default(""),
  visualIntent: z.string().default("MEDIUM"),
  subject: z.string().default(""),
  action: z.string().default(""),
  environment: z.string().default(""),
  composition: z.string().default(""),
  camera: z.string().default("STATIC"),
  lens: z.string().default("35mm"),
  lighting: z.string().default(""),
  color: z.string().default(""),
  atmosphere: z.string().default(""),
  entities: z.array(z.string()).default([]),
  transition: z.string().default("CUT"),
});

export const AiSceneSchema = z.object({
  title: z.string().default("Scene"),
  purpose: z.string().default(""),
  location: z.string().default(""),
  era: z.string().default(""),
  tone: z.string().default("NEUTRAL"),
  pacing: z.string().default("MEDIUM"),
  visualStrategy: z.string().default(""),
  startMs: z.union([z.number(), z.string()]),
  endMs: z.union([z.number(), z.string()]),
  shots: z.array(AiShotSchema).min(1),
});

export const AiSectionSchema = z.object({
  title: z.string().default("Section"),
  purpose: z.string().default(""),
  startMs: z.union([z.number(), z.string()]),
  endMs: z.union([z.number(), z.string()]),
  scenes: z.array(AiSceneSchema).min(1),
});

export const AiStoryPlanSchema = z.object({
  summary: z.string().default(""),
  sections: z.array(AiSectionSchema).min(1),
});

export type AiStoryPlan = z.infer<typeof AiStoryPlanSchema>;
export type AiSection = z.infer<typeof AiSectionSchema>;
export type AiScene = z.infer<typeof AiSceneSchema>;
export type AiShot = z.infer<typeof AiShotSchema>;

export const AiEntitySchema = z.object({
  type: z.string().default("OBJECT"),
  name: z.string().min(1),
  description: z.string().default(""),
  appearance: z.string().default(""),
  visualAttributes: z.record(z.string(), z.string()).default({}),
  continuityAttributes: z.record(z.string(), z.string()).default({}),
});

export const AiVisualBibleSchema = z.object({
  world: z.string().default(""),
  era: z.string().default(""),
  geography: z.string().default(""),
  locations: z.array(z.string()).default([]),
  architecture: z.string().default(""),
  cinematography: z.string().default(""),
  lighting: z.string().default(""),
  color: z.string().default(""),
  atmosphere: z.string().default(""),
  style: z.string().default(""),
  continuityRules: z.array(z.string()).default([]),
  negativeRules: z.array(z.string()).default([]),
  entities: z.array(AiEntitySchema).default([]),
});

export type AiVisualBible = z.infer<typeof AiVisualBibleSchema>;

export const AiVisionQcSchema = z.object({
  scores: z.object({
    composition: z.number(),
    subject: z.number(),
    style: z.number(),
    continuity: z.number(),
    quality: z.number(),
    promptAdherence: z.number(),
  }),
  artifacts: z.array(z.string()).default([]),
  issues: z.array(z.string()).default([]),
  recommendation: z.string().default("ACCEPT"),
});

export type AiVisionQc = z.infer<typeof AiVisionQcSchema>;

/** Human-readable vocabulary listings injected into prompts. */
export const VOCAB_DOC = {
  visualIntent: VISUAL_INTENTS.join(" | "),
  camera: CAMERAS.join(" | "),
  lens: LENSES.join(" | "),
  transition: TRANSITIONS.join(" | "),
  tone: TONES.join(" | "),
  pacing: PACINGS.join(" | "),
  entityType: ENTITY_TYPES.join(" | "),
};
