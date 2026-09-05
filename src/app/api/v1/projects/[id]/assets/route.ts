import { apiHandler, pagination } from "@/lib/api/handler";
import { requireProject } from "@/lib/services/projects";
import { assetsReadyReport, listAssets } from "@/lib/services/assets";

export const GET = apiHandler({ rateLimit: "read" }, async ({ user, params, searchParams }) => {
  await requireProject(params.id, user.id);
  const { limit, offset } = pagination(searchParams, 60, 200);
  const status = searchParams.get("status") ?? undefined;
  return { ...(await listAssets(params.id, { limit, offset, status })), report: await assetsReadyReport(params.id) };
});
