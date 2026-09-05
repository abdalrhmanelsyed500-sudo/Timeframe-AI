import { apiHandler } from "@/lib/api/handler";
import { requireProject } from "@/lib/services/projects";
import { getDraft, latestTimeline, listTimelineVersions } from "@/lib/services/timeline";
import { validateTimeline } from "@/lib/timeline/validate";
import { enqueue } from "@/lib/services/jobs";
import { latestStoryPlan } from "@/lib/services/story";
import { AppError } from "@/lib/errors";
import { contentHash } from "@/lib/core/hash";

export const GET = apiHandler({ rateLimit: "read" }, async ({ user, params }) => {
  await requireProject(params.id, user.id);
  const timeline = await latestTimeline(params.id);
  return {
    timeline,
    draft: await getDraft(params.id),
    versions: await listTimelineVersions(params.id),
    validation: timeline ? validateTimeline(timeline.doc) : null,
  };
});

export const POST = apiHandler({ rateLimit: "mutation" }, async ({ user, params }) => {
  const project = await requireProject(params.id, user.id);
  const plan = await latestStoryPlan(project.id);
  if (!plan || plan.status !== "APPROVED") throw new AppError("STATE_ERROR", "Approve the story before building a timeline.");
  return enqueue({
    userId: user.id,
    projectId: project.id,
    type: "TIMELINE_GENERATE",
    idempotencyKey: `timeline:${contentHash({ p: project.id, s: plan.contentHash, t: Date.now() })}`,
    message: "Queued timeline build",
  });
});
