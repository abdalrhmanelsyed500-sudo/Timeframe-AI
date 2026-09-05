import { apiHandler } from "@/lib/api/handler";
import { requireProject } from "@/lib/services/projects";
import { latestReport } from "@/lib/services/cinematic";

export const GET = apiHandler({ rateLimit: "read" }, async ({ user, params }) => {
  await requireProject(params.id, user.id);
  return { report: await latestReport(params.id) };
});
