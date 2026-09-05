import { z } from "zod";
import { apiHandler } from "@/lib/api/handler";
import { requireProject } from "@/lib/services/projects";
import { applyEdits, getDraft, latestTimeline, saveDraft } from "@/lib/services/timeline";
import { AppError } from "@/lib/errors";
import { validateTimeline } from "@/lib/timeline/validate";

const EditSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("setMotion"), clipId: z.string().max(64), motion: z.string().max(40) }),
  z.object({ op: z.literal("setTransition"), clipId: z.string().max(64), transition: z.string().max(40) }),
  z.object({
    op: z.literal("setAsset"),
    clipId: z.string().max(64),
    assetId: z.string().max(64),
    assetVersionId: z.string().max(64),
    storageKey: z.string().max(400),
  }),
  z.object({ op: z.literal("trim"), clipId: z.string().max(64), startMs: z.number().int().min(0).optional(), endMs: z.number().int().min(1).optional() }),
  z.object({
    op: z.literal("addOverlay"),
    overlay: z.object({
      kind: z.enum(["TITLE", "SUBTITLE", "LABEL", "EMPHASIS", "ANNOTATION"]),
      text: z.string().min(1).max(200),
      startMs: z.number().int().min(0),
      endMs: z.number().int().min(1),
      position: z.enum(["TOP", "CENTER", "BOTTOM"]).default("BOTTOM"),
    }),
  }),
  z.object({ op: z.literal("updateOverlay"), overlayId: z.string().max(64), patch: z.record(z.string(), z.unknown()) }),
  z.object({ op: z.literal("removeOverlay"), overlayId: z.string().max(64) }),
]);

const Schema = z.object({
  edits: z.array(EditSchema).min(1).max(100),
  expectedRevision: z.number().int().nullable().default(null),
});

export const POST = apiHandler({ schema: Schema, rateLimit: "mutation" }, async ({ user, params, body }) => {
  await requireProject(params.id, user.id);
  const timeline = await latestTimeline(params.id);
  if (!timeline) throw new AppError("STATE_ERROR", "Build a timeline before editing it.");

  const existing = await getDraft(params.id);
  const base = existing?.doc ?? timeline.doc;
  const next = applyEdits(base, body.edits as never);

  const draft = await saveDraft({
    projectId: params.id,
    baseVersion: existing?.baseVersion ?? timeline.version,
    clips: next.clips,
    overlays: next.overlays,
    expectedRevision: body.expectedRevision,
  });
  return { draft, validation: validateTimeline(draft.doc) };
});
