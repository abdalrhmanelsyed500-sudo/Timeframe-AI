import { apiHandler } from "@/lib/api/handler";
import { requireProject } from "@/lib/services/projects";
import { requestCancel } from "@/lib/services/render";

export const POST = apiHandler({ rateLimit: "mutation" }, async ({ user, params }) => {
  await requireProject(params.id, user.id);
  await requestCancel(params.renderId, params.id, user.id);
  return { cancelRequested: true };
});
