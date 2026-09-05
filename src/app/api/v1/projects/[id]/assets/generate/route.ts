import { z } from "zod";
import { apiHandler } from "@/lib/api/handler";
import { requireProject } from "@/lib/services/projects";
import { pendingShots } from "@/lib/services/assets";
import { latestStoryPlan } from "@/lib/services/story";
import { AppError } from "@/lib/errors";
import { enqueue } from "@/lib/services/jobs";
import { estimateCost, modelForPreset } from "@/lib/ai/registry";
import { preflight, DEFAULT_LIMITS } from "@/lib/services/cost";
import { providerMode } from "@/lib/ai/factory";
import { contentHash } from "@/lib/core/hash";

const Schema = z.object({
  shotIds: z.array(z.string().max(64)).max(250).optional(),
  regenerateFailed: z.boolean().optional(),
  /** Return the estimate without queueing anything. */
  dryRun: z.boolean().optional(),
});

export const POST = apiHandler({ schema: Schema, rateLimit: "assetGenerate" }, async ({ user, params, body }) => {
  const project = await requireProject(params.id, user.id);
  const plan = await latestStoryPlan(project.id);
  if (!plan || plan.status !== "APPROVED") throw new AppError("STATE_ERROR", "Approve the story before generating assets.");

  const shots = body.shotIds?.length
    ? body.shotIds
    : (await pendingShots(project.id, { regenerateFailed: body.regenerateFailed })).map((s) => s.id);

  const mode = providerMode();
  const isMock = mode === "demo";
  const spec = modelForPreset(isMock ? "demo" : "openai", "image", project.qualityPreset);
  if (!spec) throw new AppError("CONFIGURATION_ERROR", "No image model is registered.");
  const estimate = estimateCost(spec, Math.max(1, shots.length));

  if (shots.length > DEFAULT_LIMITS.batchSize) {
    throw new AppError("VALIDATION_ERROR", `A single batch is limited to ${DEFAULT_LIMITS.batchSize} shots.`);
  }
  await preflight({ userId: user.id, projectId: project.id, estimate, isMock, batchSize: shots.length });

  if (body.dryRun) {
    return { shotCount: shots.length, estimate, mode, willUseMock: isMock };
  }
  if (shots.length === 0) return { shotCount: 0, estimate, queued: false, message: "Every shot already has an image." };

  const key = contentHash({ p: project.id, shots: [...shots].sort(), regen: Boolean(body.regenerateFailed) });
  const result = await enqueue({
    userId: user.id,
    projectId: project.id,
    type: "ASSET_BATCH",
    payload: { shotIds: body.shotIds ?? null, regenerateFailed: Boolean(body.regenerateFailed) },
    total: shots.length,
    idempotencyKey: `assets:${key}`,
    message: `Queued ${shots.length} shots`,
  });
  return { ...result, shotCount: shots.length, estimate, mode, willUseMock: isMock };
});
