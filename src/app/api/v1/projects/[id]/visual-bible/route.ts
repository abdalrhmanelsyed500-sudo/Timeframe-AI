import { apiHandler } from "@/lib/api/handler";
import { requireProject } from "@/lib/services/projects";
import { latestVisualBible, listVisualBibleVersions } from "@/lib/services/visual-bible";

export const GET = apiHandler({ rateLimit: "read" }, async ({ user, params }) => {
  await requireProject(params.id, user.id);
  return { bible: await latestVisualBible(params.id), versions: await listVisualBibleVersions(params.id) };
});
