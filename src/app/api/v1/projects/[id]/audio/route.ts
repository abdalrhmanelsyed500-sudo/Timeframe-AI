import { apiHandler } from "@/lib/api/handler";
import { AppError } from "@/lib/errors";
import { requireProject } from "@/lib/services/projects";
import { getAudio, uploadAudio } from "@/lib/services/audio";
import { loadEnv } from "@/lib/env";

export const GET = apiHandler({ rateLimit: "read" }, async ({ user, params }) => {
  await requireProject(params.id, user.id);
  return { audio: await getAudio(params.id) };
});

export const POST = apiHandler({ rateLimit: "mutation" }, async ({ user, params, request }) => {
  const project = await requireProject(params.id, user.id);
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw new AppError("VALIDATION_ERROR", "Please choose an audio file to upload.");
  const max = loadEnv().MAX_UPLOAD_BYTES;
  if (file.size > max) throw new AppError("VALIDATION_ERROR", `The file exceeds the ${Math.round(max / 1024 / 1024)} MB limit.`);
  const data = Buffer.from(await file.arrayBuffer());
  return uploadAudio({ project, userId: user.id, filename: file.name, data });
});
