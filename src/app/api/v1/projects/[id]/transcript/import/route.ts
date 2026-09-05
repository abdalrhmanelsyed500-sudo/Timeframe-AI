import { apiHandler } from "@/lib/api/handler";
import { AppError } from "@/lib/errors";
import { requireProject } from "@/lib/services/projects";
import { importTranscript } from "@/lib/services/transcript";

const MAX_TRANSCRIPT_BYTES = 8 * 1024 * 1024;

export const POST = apiHandler({ rateLimit: "mutation" }, async ({ user, params, request }) => {
  const project = await requireProject(params.id, user.id);
  const contentType = request.headers.get("content-type") ?? "";

  let filename = "transcript.txt";
  let content = "";

  if (contentType.includes("multipart/form-data")) {
    const form = await request.formData();
    const file = form.get("file");
    if (file instanceof File) {
      if (file.size > MAX_TRANSCRIPT_BYTES) throw new AppError("VALIDATION_ERROR", "That transcript file is too large.");
      filename = file.name;
      content = await file.text();
    } else {
      content = String(form.get("text") ?? "");
      filename = String(form.get("filename") ?? "transcript.txt");
    }
  } else {
    const body = (await request.json().catch(() => ({}))) as { text?: string; filename?: string };
    content = body.text ?? "";
    filename = body.filename ?? "transcript.txt";
  }

  if (!content.trim()) throw new AppError("VALIDATION_ERROR", "The transcript is empty.");
  if (content.length > MAX_TRANSCRIPT_BYTES) throw new AppError("VALIDATION_ERROR", "That transcript is too large.");

  return importTranscript({ project, userId: user.id, filename, content });
});
