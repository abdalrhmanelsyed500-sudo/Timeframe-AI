import { apiHandler, pagination } from "@/lib/api/handler";
import { costSummary, listCostRecords, DEFAULT_LIMITS } from "@/lib/services/cost";
import { storageUsage } from "@/lib/services/storage-usage";

export const GET = apiHandler({ rateLimit: "read" }, async ({ user, searchParams }) => {
  const { limit, offset } = pagination(searchParams, 50, 200);
  const projectId = searchParams.get("projectId") ?? undefined;
  return {
    summary: await costSummary(user.id, projectId),
    records: await listCostRecords(user.id, { projectId, limit, offset }),
    limits: DEFAULT_LIMITS,
    storage: await storageUsage(user.id, projectId),
  };
});
