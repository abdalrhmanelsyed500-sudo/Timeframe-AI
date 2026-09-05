import { apiHandler } from "@/lib/api/handler";
import { cancelJob } from "@/lib/services/jobs";

export const POST = apiHandler({ rateLimit: "mutation" }, async ({ user, params }) => {
  await cancelJob(params.jobId, user.id);
  return { cancelRequested: true };
});
