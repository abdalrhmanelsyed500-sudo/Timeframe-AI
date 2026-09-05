import { z } from "zod";
import { apiHandler } from "@/lib/api/handler";
import { requireProject } from "@/lib/services/projects";
import { approveTimeline } from "@/lib/services/timeline";

const Schema = z.object({ override: z.boolean().optional() });

export const POST = apiHandler({ schema: Schema, rateLimit: "mutation" }, async ({ user, params, body }) => {
  const project = await requireProject(params.id, user.id);
  return approveTimeline({ project, userId: user.id, override: body.override });
});
