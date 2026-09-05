import { z } from "zod";
import { apiHandler } from "@/lib/api/handler";
import { requireProject } from "@/lib/services/projects";
import { mergeSegment, splitSegment, updateSegment } from "@/lib/services/transcript";

const Schema = z.object({
  startMs: z.number().int().min(0).optional(),
  endMs: z.number().int().min(1).optional(),
  text: z.string().max(2000).optional(),
  op: z.enum(["update", "split", "merge"]).default("update"),
  atMs: z.number().int().min(0).optional(),
});

export const PATCH = apiHandler({ schema: Schema, rateLimit: "mutation" }, async ({ user, params, body }) => {
  await requireProject(params.id, user.id);
  if (body.op === "split") await splitSegment(params.id, params.segmentId, body.atMs ?? 0);
  else if (body.op === "merge") await mergeSegment(params.id, params.segmentId);
  else await updateSegment({ projectId: params.id, segmentId: params.segmentId, ...body });
  return { ok: true };
});
