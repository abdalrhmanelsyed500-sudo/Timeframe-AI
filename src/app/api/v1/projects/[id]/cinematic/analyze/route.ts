import { apiHandler } from "@/lib/api/handler";
import { requireProject } from "@/lib/services/projects";
import { latestTimeline } from "@/lib/services/timeline";
import { AppError } from "@/lib/errors";
import { enqueue } from "@/lib/services/jobs";

export const POST = apiHandler({ rateLimit: "mutation" }, async ({ user, params }) => {
  const project = await requireProject(params.id, user.id);
  const timeline = await latestTimeline(project.id);
  if (!timeline) throw new AppError("STATE_ERROR", "Build a timeline before running cinematic QA.");
  return enqueue({
    userId: user.id,
    projectId: project.id,
    type: "CINEMATIC_ANALYZE",
    idempotencyKey: `qa:${timeline.contentHash}`,
    message: "Queued cinematic QA",
  });
});
