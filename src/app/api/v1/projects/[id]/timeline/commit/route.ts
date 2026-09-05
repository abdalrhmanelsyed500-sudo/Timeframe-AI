import { apiHandler } from "@/lib/api/handler";
import { requireProject } from "@/lib/services/projects";
import { commitDraft } from "@/lib/services/timeline";

export const POST = apiHandler({ rateLimit: "mutation" }, async ({ user, params }) => {
  const project = await requireProject(params.id, user.id);
  return commitDraft({ project, userId: user.id });
});
