import { z } from "zod";
import { apiHandler } from "@/lib/api/handler";
import { archiveProject, deleteProject, duplicateProject, requireProject, updateProject } from "@/lib/services/projects";
import { QUALITY_PRESETS } from "@/lib/domain/vocab";

const PatchSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(2000).optional(),
  styleKey: z.string().max(60).optional(),
  qualityPreset: z.enum(QUALITY_PRESETS).optional(),
  archived: z.boolean().optional(),
  duplicate: z.boolean().optional(),
});

export const GET = apiHandler({ rateLimit: "read" }, async ({ user, params }) => requireProject(params.id, user.id));

export const PATCH = apiHandler({ schema: PatchSchema, rateLimit: "mutation" }, async ({ user, params, body }) => {
  if (body.duplicate) return duplicateProject(params.id, user.id);
  if (body.archived !== undefined) {
    await archiveProject(params.id, user.id, body.archived);
    return requireProject(params.id, user.id);
  }
  return updateProject(params.id, user.id, body);
});

export const DELETE = apiHandler({ rateLimit: "mutation" }, async ({ user, params }) => {
  await deleteProject(params.id, user.id);
  return { deleted: true };
});
