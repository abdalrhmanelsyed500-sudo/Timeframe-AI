import { apiHandler } from "@/lib/api/handler";
import { requireProject } from "@/lib/services/projects";
import { getRender } from "@/lib/services/render";
import { AppError } from "@/lib/errors";

export const GET = apiHandler({ rateLimit: "read" }, async ({ user, params }) => {
  await requireProject(params.id, user.id);
  const render = await getRender(params.renderId, params.id);
  if (!render) throw new AppError("NOT_FOUND", "That render does not exist.");
  return render;
});
