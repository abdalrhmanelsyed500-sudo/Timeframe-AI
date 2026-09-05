import { apiHandler, pagination } from "@/lib/api/handler";
import { listJobs } from "@/lib/services/jobs";

export const GET = apiHandler({ rateLimit: "read" }, async ({ user, searchParams }) => {
  const { limit, offset } = pagination(searchParams, 25, 100);
  return { jobs: await listJobs({ userId: user.id, limit, offset, activeOnly: searchParams.get("active") === "true" }) };
});
