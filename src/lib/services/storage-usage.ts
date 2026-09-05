import { db, dbGuard, sql } from "@/lib/db";

/**
 * Storage accounting. What counts toward quota:
 *   source audio + every asset version + thumbnails + render artefacts.
 * Temporary working files are cleaned up and never counted.
 */
export type StorageCategory = "audio" | "asset" | "thumb" | "render";

export async function trackStorage(params: {
  key: string;
  userId: string;
  projectId: string | null;
  category: StorageCategory;
  bytes: number;
  mime: string;
}): Promise<void> {
  await dbGuard(() =>
    db
      .insertInto("storage_objects")
      .values({
        key: params.key,
        user_id: params.userId,
        project_id: params.projectId,
        category: params.category,
        bytes: params.bytes,
        mime: params.mime,
      })
      .onConflict((oc) => oc.column("key").doUpdateSet({ bytes: params.bytes, mime: params.mime }))
      .execute(),
  );
}

export async function untrackStorage(key: string): Promise<void> {
  await dbGuard(() => db.deleteFrom("storage_objects").where("key", "=", key).execute());
}

export interface StorageUsage {
  totalBytes: number;
  byCategory: Record<string, number>;
}

export async function storageUsage(userId: string, projectId?: string): Promise<StorageUsage> {
  let q = db
    .selectFrom("storage_objects")
    .select(["category", sql<string>`coalesce(sum(bytes),0)`.as("bytes")])
    .where("user_id", "=", userId)
    .groupBy("category");
  if (projectId) q = q.where("project_id", "=", projectId);
  const rows = await dbGuard(() => q.execute());
  const byCategory: Record<string, number> = {};
  let total = 0;
  for (const r of rows) {
    const n = Number(r.bytes);
    byCategory[r.category] = n;
    total += n;
  }
  return { totalBytes: total, byCategory };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 10 ? 0 : 1)} ${units[i]}`;
}
