import { apiHandler } from "@/lib/api/handler";
import { requireProject } from "@/lib/services/projects";
import { approveStory } from "@/lib/services/story";

export const POST = apiHandler({ rateLimit: "mutation" }, async ({ user, params }) => {
  const project = await requireProject(params.id, user.id);
  await approveStory(project, user.id);
  return { approved: true };
});
