import { Readable } from "node:stream";
import { db, dbGuard } from "@/lib/db";
import { AppError } from "@/lib/errors";
import { getStorage } from "@/lib/storage";
import { requireUser } from "@/lib/security/auth";
import { errorResponse } from "@/lib/api/handler";
import { requestId as newRequestId } from "@/lib/core/ids";
import { assertSafeStorageKey } from "@/lib/security/sanitize";

export const dynamic = "force-dynamic";

/**
 * Authorised media delivery.
 *
 * Knowing a storage key is NEVER sufficient: every request re-verifies that the
 * signed-in user owns the project the object belongs to (IDOR protection).
 */
export async function GET(request: Request, route: { params: Promise<{ key: string[] }> }): Promise<Response> {
  const requestId = newRequestId();
  let userId: string | null = null;
  try {
    const user = await requireUser();
    userId = user.id;
    const { key: parts } = await route.params;
    const key = assertSafeStorageKey(parts.join("/"));

    const object = await dbGuard(() =>
      db.selectFrom("storage_objects").selectAll().where("key", "=", key).executeTakeFirst(),
    );
    if (!object) throw new AppError("NOT_FOUND", "That file does not exist.");
    if (object.user_id !== user.id) throw new AppError("NOT_FOUND", "That file does not exist.");
    if (object.project_id) {
      const project = await dbGuard(() =>
        db.selectFrom("projects").select(["user_id"]).where("id", "=", object.project_id!).executeTakeFirst(),
      );
      if (!project || project.user_id !== user.id) throw new AppError("NOT_FOUND", "That file does not exist.");
    }

    const storage = getStorage();
    if (!(await storage.exists(key))) {
      throw new AppError("STORAGE_ERROR", "That file is recorded but missing from storage.");
    }
    const size = await storage.size(key);
    const rangeHeader = request.headers.get("range");

    const baseHeaders: Record<string, string> = {
      "content-type": object.mime,
      "accept-ranges": "bytes",
      "cache-control": "private, max-age=3600",
      "content-security-policy": "default-src 'none'; sandbox",
      "x-content-type-options": "nosniff",
    };

    if (rangeHeader) {
      const match = /bytes=(\d*)-(\d*)/.exec(rangeHeader);
      if (match) {
        const start = match[1] ? Number(match[1]) : 0;
        const end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
        if (start >= size || end < start) {
          return new Response(null, { status: 416, headers: { "content-range": `bytes */${size}` } });
        }
        const nodeStream = await storage.stream(key, { start, end });
        return new Response(Readable.toWeb(nodeStream) as ReadableStream, {
          status: 206,
          headers: {
            ...baseHeaders,
            "content-range": `bytes ${start}-${end}/${size}`,
            "content-length": String(end - start + 1),
          },
        });
      }
    }

    const nodeStream = await storage.stream(key);
    return new Response(Readable.toWeb(nodeStream) as ReadableStream, {
      headers: { ...baseHeaders, "content-length": String(size) },
    });
  } catch (e) {
    return errorResponse(e, requestId, userId);
  }
}
