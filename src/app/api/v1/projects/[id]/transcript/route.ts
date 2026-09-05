import { apiHandler, pagination } from "@/lib/api/handler";
import { requireProject } from "@/lib/services/projects";
import { getTranscript, listSegments } from "@/lib/services/transcript";

export const GET = apiHandler({ rateLimit: "read" }, async ({ user, params, searchParams }) => {
  await requireProject(params.id, user.id);
  const transcript = await getTranscript(params.id);
  if (!transcript) return { transcript: null, segments: { items: [], total: 0 } };
  const { limit, offset } = pagination(searchParams, 500, 2000);
  return { transcript, segments: await listSegments(transcript.id, { limit, offset }) };
});
