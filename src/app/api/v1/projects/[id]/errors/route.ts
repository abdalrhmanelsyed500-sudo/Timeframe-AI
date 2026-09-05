import { apiHandler, pagination } from "@/lib/api/handler";
import { requireProject } from "@/lib/services/projects";
import { db, dbGuard } from "@/lib/db";
import { iso } from "@/lib/core/dates";

export const GET = apiHandler({ rateLimit: "read" }, async ({ user, params, searchParams }) => {
  await requireProject(params.id, user.id);
  const { limit, offset } = pagination(searchParams, 25, 100);
  const rows = await dbGuard(() =>
    db
      .selectFrom("error_events")
      .select(["id", "code", "message", "job_id", "request_id", "created_at", "acknowledged"])
      .where("project_id", "=", params.id)
      .where("user_id", "=", user.id)
      .orderBy("created_at", "desc")
      .limit(limit)
      .offset(offset)
      .execute(),
  );
  // Diagnostic context is deliberately NOT returned to the browser.
  return {
    errors: rows.map((r) => ({
      id: r.id,
      code: r.code,
      message: r.message,
      jobId: r.job_id,
      requestId: r.request_id,
      acknowledged: r.acknowledged,
      createdAt: iso(r.created_at),
    })),
  };
});
