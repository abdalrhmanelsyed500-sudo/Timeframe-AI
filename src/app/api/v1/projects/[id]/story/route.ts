import { apiHandler } from "@/lib/api/handler";
import { requireProject } from "@/lib/services/projects";
import { latestStoryPlan, listStoryVersions } from "@/lib/services/story";
import { staleReport } from "@/lib/services/stale";

export const GET = apiHandler({ rateLimit: "read" }, async ({ user, params }) => {
  await requireProject(params.id, user.id);
  return {
    plan: await latestStoryPlan(params.id),
    versions: await listStoryVersions(params.id),
    stale: await staleReport(params.id),
  };
});
