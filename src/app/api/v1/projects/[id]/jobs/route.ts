import { apiHandler, pagination } from "@/lib/api/handler";
import { requireProject } from "@/lib/services/projects";
import { listJobs } from "@/lib/services/jobs";

export const GET = apiHandler({ rateLimit: "read" }, async ({ user, params, searchParams }) => {
  await requireProject(params.id, user.id);
  const { limit, offset } = pagination(searchParams, 25, 100);
  return { jobs: await listJobs({ userId: user.id, projectId: params.id, limit, offset }) };
});
