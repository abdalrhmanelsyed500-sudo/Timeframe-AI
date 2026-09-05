import { z } from "zod";
import { zMotion, zTransition, OVERLAY_KINDS } from "@/lib/domain/vocab";

export const ClipSchema = z.object({
  clipId: z.string(),
  shotId: z.string(),
  sceneId: z.string(),
  sectionId: z.string(),
  assetId: z.string().nullable(),
  assetVersionId: z.string().nullable(),
  storageKey: z.string().nullable(),
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().positive(),
  motion: zMotion,
  transitionIn: zTransition,
  transitionMs: z.number().int().nonnegative(),
  visualIntent: z.string(),
  narrationText: z.string().default(""),
});

export type Clip = z.infer<typeof ClipSchema>;

export const OverlaySchema = z.object({
  overlayId: z.string(),
  kind: z.enum(OVERLAY_KINDS),
  text: z.string(),
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().positive(),
  position: z.enum(["TOP", "CENTER", "BOTTOM"]).default("BOTTOM"),
});

export type Overlay = z.infer<typeof OverlaySchema>;

export const TimelineDocSchema = z.object({
  durationMs: z.number().int().positive(),
  clips: z.array(ClipSchema),
  overlays: z.array(OverlaySchema).default([]),
});

export type TimelineDoc = z.infer<typeof TimelineDocSchema>;
