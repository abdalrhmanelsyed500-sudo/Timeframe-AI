import { z } from "zod";
import { apiHandler } from "@/lib/api/handler";
import { requireProject } from "@/lib/services/projects";
import { restoreVersion } from "@/lib/services/timeline";

const Schema = z.object({ version: z.number().int().min(1) });

export const POST = apiHandler({ schema: Schema, rateLimit: "mutation" }, async ({ user, params, body }) => {
  const project = await requireProject(params.id, user.id);
  return restoreVersion({ project, userId: user.id, version: body.version });
});
