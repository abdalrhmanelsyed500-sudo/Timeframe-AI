import { z } from "zod";
import { apiHandler } from "@/lib/api/handler";
import { requireProject } from "@/lib/services/projects";
import { applySafeFixes } from "@/lib/services/cinematic";

const Schema = z.object({ issueIds: z.array(z.string().max(64)).max(500).optional() });

export const POST = apiHandler({ schema: Schema, rateLimit: "mutation" }, async ({ user, params, body }) => {
  const project = await requireProject(params.id, user.id);
  return applySafeFixes({ project, userId: user.id, issueIds: body.issueIds });
});
