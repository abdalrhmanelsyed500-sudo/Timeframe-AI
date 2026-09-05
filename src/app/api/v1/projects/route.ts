import { z } from "zod";
import { apiHandler, pagination } from "@/lib/api/handler";
import { createProject, listProjects } from "@/lib/services/projects";
import { QUALITY_PRESETS } from "@/lib/domain/vocab";
import { listStyles } from "@/lib/domain/styles";

const CreateSchema = z.object({
  name: z.string().min(1, "Please give the project a name").max(120),
  description: z.string().max(2000).optional(),
  styleKey: z.enum(listStyles().map((s) => s.styleKey) as [string, ...string[]]).optional(),
  qualityPreset: z.enum(QUALITY_PRESETS).optional(),
  aspectRatio: z.enum(["16:9", "9:16", "1:1", "4:5"]).optional(),
  fps: z.union([z.literal(24), z.literal(25), z.literal(30)]).optional(),
});

export const GET = apiHandler({ rateLimit: "read" }, async ({ user, searchParams }) => {
  const { limit, offset } = pagination(searchParams, 20, 100);
  return listProjects(user.id, { limit, offset, includeArchived: searchParams.get("archived") === "true" });
});

export const POST = apiHandler({ schema: CreateSchema, rateLimit: "mutation" }, async ({ user, body }) =>
  createProject({ userId: user.id, ...body }),
);
