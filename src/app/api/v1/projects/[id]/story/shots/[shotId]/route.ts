import { z } from "zod";
import { apiHandler } from "@/lib/api/handler";
import { requireProject } from "@/lib/services/projects";
import { updateShot } from "@/lib/services/story";
import { CAMERAS, LENSES, VISUAL_INTENTS } from "@/lib/domain/vocab";

const Schema = z.object({
  subject: z.string().max(300).optional(),
  action: z.string().max(300).optional(),
  environment: z.string().max(300).optional(),
  narrationText: z.string().max(2000).optional(),
  visualIntent: z.enum(VISUAL_INTENTS).optional(),
  camera: z.enum(CAMERAS).optional(),
  lens: z.enum(LENSES).optional(),
});

export const PATCH = apiHandler({ schema: Schema, rateLimit: "mutation" }, async ({ user, params, body }) => {
  await requireProject(params.id, user.id);
  await updateShot({ projectId: params.id, shotId: params.shotId, patch: body });
  return { ok: true };
});
