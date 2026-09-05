import { apiHandler } from "@/lib/api/handler";
import { requireProject } from "@/lib/services/projects";
import { latestStoryPlan } from "@/lib/services/story";
import { AppError } from "@/lib/errors";
import { enqueue } from "@/lib/services/jobs";

export const POST = apiHandler({ rateLimit: "storyAnalyze" }, async ({ user, params }) => {
  const project = await requireProject(params.id, user.id);
  const plan = await latestStoryPlan(project.id);
  if (!plan) throw new AppError("STATE_ERROR", "Analyse the story first.");
  if (plan.status !== "APPROVED") throw new AppError("STATE_ERROR", "Approve the story before generating the visual bible.");
  return enqueue({
    userId: user.id,
    projectId: project.id,
    type: "VISUAL_BIBLE_GENERATE",
    idempotencyKey: `bible:${plan.contentHash}`,
    message: "Queued visual bible",
  });
});
