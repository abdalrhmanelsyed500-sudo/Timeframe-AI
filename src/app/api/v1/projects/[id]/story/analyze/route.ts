import { apiHandler } from "@/lib/api/handler";
import { requireProject } from "@/lib/services/projects";
import { requireAudio } from "@/lib/services/audio";
import { getTranscript } from "@/lib/services/transcript";
import { AppError } from "@/lib/errors";
import { enqueue } from "@/lib/services/jobs";
import { contentHash } from "@/lib/core/hash";

export const POST = apiHandler({ rateLimit: "storyAnalyze" }, async ({ user, params }) => {
  const project = await requireProject(params.id, user.id);
  await requireAudio(project.id);
  const transcript = await getTranscript(project.id);
  if (!transcript) throw new AppError("STATE_ERROR", "Import a transcript before analysing the story.");

  // Idempotent: the same transcript + settings will not queue a second analysis.
  const key = contentHash({ p: project.id, t: transcript.contentHash, s: project.styleKey, q: project.qualityPreset, op: "story" });
  return enqueue({
    userId: user.id,
    projectId: project.id,
    type: "STORY_ANALYZE",
    idempotencyKey: `story:${key}`,
    message: "Queued story analysis",
  });
});
