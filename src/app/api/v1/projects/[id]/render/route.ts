import { z } from "zod";
import { apiHandler } from "@/lib/api/handler";
import { requireProject } from "@/lib/services/projects";
import { listRenders, queueRender } from "@/lib/services/render";
import { PROFILE_LIST } from "@/lib/render/profiles";
import { enqueue } from "@/lib/services/jobs";
import { findFfmpeg } from "@/lib/render/ffmpeg";

const Schema = z.object({ profile: z.enum(PROFILE_LIST.map((p) => p.key) as [string, ...string[]]).default("FULL_HD") });

export const GET = apiHandler({ rateLimit: "read" }, async ({ user, params }) => {
  await requireProject(params.id, user.id);
  return { renders: await listRenders(params.id), profiles: PROFILE_LIST, ffmpegAvailable: Boolean(findFfmpeg()) };
});

export const POST = apiHandler({ schema: Schema, rateLimit: "render" }, async ({ user, params, body }) => {
  const project = await requireProject(params.id, user.id);
  const render = await queueRender({ project, userId: user.id, profileKey: body.profile });
  const job = await enqueue({
    userId: user.id,
    projectId: project.id,
    type: "VIDEO_RENDER",
    payload: { renderId: render.id },
    idempotencyKey: `render:${render.id}`,
    message: "Queued render",
  });
  return { render, job: job.job };
});
