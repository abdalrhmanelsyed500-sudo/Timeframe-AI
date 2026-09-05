import { z } from "zod";
import { apiHandler, pagination } from "@/lib/api/handler";
import { db, dbGuard } from "@/lib/db";
import { iso } from "@/lib/core/dates";

export const GET = apiHandler({ rateLimit: "read" }, async ({ user, searchParams }) => {
  const { limit, offset } = pagination(searchParams, 20, 100);
  const rows = await dbGuard(() =>
    db.selectFrom("notifications").selectAll().where("user_id", "=", user.id).orderBy("created_at", "desc").limit(limit).offset(offset).execute(),
  );
  return {
    notifications: rows.map((r) => ({
      id: r.id,
      projectId: r.project_id,
      level: r.level,
      title: r.title,
      body: r.body,
      read: r.read,
      createdAt: iso(r.created_at),
    })),
  };
});

const Schema = z.object({ ids: z.array(z.string().max(64)).max(200).optional(), allRead: z.boolean().optional() });

export const PATCH = apiHandler({ schema: Schema, rateLimit: "mutation" }, async ({ user, body }) => {
  let q = db.updateTable("notifications").set({ read: true }).where("user_id", "=", user.id);
  if (body.ids?.length) q = q.where("id", "in", body.ids);
  await dbGuard(() => q.execute());
  return { ok: true };
});
