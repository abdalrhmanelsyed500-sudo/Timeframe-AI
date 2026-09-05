import { z } from "zod";
import { apiHandler } from "@/lib/api/handler";
import { requireProject } from "@/lib/services/projects";
import { selectAssetVersion } from "@/lib/services/assets";

const Schema = z.object({
  selections: z.array(z.object({ assetId: z.string().max(64), versionId: z.string().max(64) })).min(1).max(200),
});

export const POST = apiHandler({ schema: Schema, rateLimit: "mutation" }, async ({ user, params, body }) => {
  await requireProject(params.id, user.id);
  const results: { assetId: string; ok: boolean; message?: string }[] = [];
  for (const s of body.selections) {
    try {
      await selectAssetVersion({ projectId: params.id, assetId: s.assetId, versionId: s.versionId, userId: user.id });
      results.push({ assetId: s.assetId, ok: true });
    } catch (e) {
      // Partial failure is reported explicitly rather than failing the whole batch.
      results.push({ assetId: s.assetId, ok: false, message: e instanceof Error ? e.message : "Failed" });
    }
  }
  return { results, succeeded: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length };
});
