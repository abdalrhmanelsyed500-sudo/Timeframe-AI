import { db, dbGuard } from "@/lib/db";
import { newId } from "@/lib/core/ids";

export type AuditAction =
  | "user.registered"
  | "user.login"
  | "project.created"
  | "project.renamed"
  | "project.duplicated"
  | "project.archived"
  | "project.deleted"
  | "audio.uploaded"
  | "transcript.imported"
  | "story.analyzed"
  | "story.approved"
  | "visual_bible.generated"
  | "assets.generated"
  | "asset.selected"
  | "asset.regenerated"
  | "timeline.created"
  | "timeline.approved"
  | "qa.analyzed"
  | "qa.fixes_applied"
  | "render.started"
  | "render.completed"
  | "render.failed"
  | "render.cancelled"
  | "credential.saved"
  | "credential.deleted";

export async function audit(params: {
  userId: string | null;
  projectId?: string | null;
  action: AuditAction;
  targetType?: string;
  targetId?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await dbGuard(() =>
    db
      .insertInto("audit_logs")
      .values({
        id: newId("audit"),
        user_id: params.userId,
        project_id: params.projectId ?? null,
        action: params.action,
        target_type: params.targetType ?? "",
        target_id: params.targetId ?? null,
        metadata: params.metadata ?? {},
      })
      .execute(),
  );
}

export async function notify(params: {
  userId: string;
  projectId?: string | null;
  level?: "INFO" | "SUCCESS" | "WARNING" | "ERROR";
  title: string;
  body?: string;
}): Promise<void> {
  await dbGuard(() =>
    db
      .insertInto("notifications")
      .values({
        id: newId("notif"),
        user_id: params.userId,
        project_id: params.projectId ?? null,
        level: params.level ?? "INFO",
        title: params.title,
        body: params.body ?? "",
      })
      .execute(),
  );
}

export async function recordError(params: {
  userId?: string | null;
  projectId?: string | null;
  jobId?: string | null;
  requestId?: string | null;
  code: string;
  message: string;
  context?: Record<string, unknown>;
}): Promise<void> {
  try {
    await db
      .insertInto("error_events")
      .values({
        id: newId("err"),
        user_id: params.userId ?? null,
        project_id: params.projectId ?? null,
        job_id: params.jobId ?? null,
        request_id: params.requestId ?? null,
        code: params.code,
        message: params.message,
        context: redact(params.context ?? {}),
      })
      .execute();
  } catch {
    // Error logging must never mask the original failure.
  }
}

const SECRET_KEYS = /(key|secret|token|password|authorization|credential|cookie)/i;

/** Never persist secrets in diagnostic context. */
export function redact(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    if (SECRET_KEYS.test(k)) out[k] = "[redacted]";
    else if (typeof v === "string") out[k] = v.slice(0, 2000);
    else if (v && typeof v === "object" && !Array.isArray(v)) out[k] = redact(v as Record<string, unknown>);
    else out[k] = v;
  }
  return out;
}
