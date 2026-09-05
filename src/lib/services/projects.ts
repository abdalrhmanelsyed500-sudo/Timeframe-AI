import { iso } from "@/lib/core/dates";
import { db, dbGuard } from "@/lib/db";
import { newId } from "@/lib/core/ids";
import { AppError } from "@/lib/errors";
import { assertTransition, type ProjectState } from "@/lib/domain/state";
import { cleanText } from "@/lib/security/sanitize";
import type { QualityPreset } from "@/lib/domain/vocab";
import { DEFAULT_STYLE_KEY, getStyle } from "@/lib/domain/styles";
import { audit } from "./audit";

export interface ProjectRecord {
  id: string;
  userId: string;
  name: string;
  description: string;
  status: ProjectState;
  styleKey: string;
  qualityPreset: QualityPreset;
  aspectRatio: string;
  width: number;
  height: number;
  fps: number;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

export const ASPECT_PRESETS: Record<string, { width: number; height: number }> = {
  "16:9": { width: 1920, height: 1080 },
  "9:16": { width: 1080, height: 1920 },
  "1:1": { width: 1080, height: 1080 },
  "4:5": { width: 1080, height: 1350 },
};

interface Row {
  id: string;
  user_id: string;
  name: string;
  description: string;
  status: string;
  style_key: string;
  quality_preset: string;
  aspect_ratio: string;
  width: number;
  height: number;
  fps: number;
  archived: boolean;
  created_at: Date;
  updated_at: Date;
}

function toRecord(r: Row): ProjectRecord {
  return {
    id: r.id,
    userId: r.user_id,
    name: r.name,
    description: r.description,
    status: r.status as ProjectState,
    styleKey: r.style_key,
    qualityPreset: r.quality_preset as QualityPreset,
    aspectRatio: r.aspect_ratio,
    width: r.width,
    height: r.height,
    fps: r.fps,
    archived: r.archived,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}

export async function createProject(params: {
  userId: string;
  name: string;
  description?: string;
  styleKey?: string;
  qualityPreset?: QualityPreset;
  aspectRatio?: string;
  fps?: number;
}): Promise<ProjectRecord> {
  const aspect = params.aspectRatio ?? "16:9";
  const dims = ASPECT_PRESETS[aspect];
  if (!dims) throw new AppError("VALIDATION_ERROR", `Unsupported aspect ratio: ${aspect}`);
  const style = getStyle(params.styleKey ?? DEFAULT_STYLE_KEY);

  const row = await dbGuard(() =>
    db
      .insertInto("projects")
      .values({
        id: newId("prj"),
        user_id: params.userId,
        name: cleanText(params.name, 120) || "Untitled project",
        description: cleanText(params.description ?? "", 2000),
        status: "CREATED",
        style_key: style.styleKey,
        quality_preset: params.qualityPreset ?? "BALANCED",
        aspect_ratio: aspect,
        width: dims.width,
        height: dims.height,
        fps: params.fps ?? 30,
      })
      .returningAll()
      .executeTakeFirstOrThrow(),
  );
  await audit({ userId: params.userId, projectId: row.id, action: "project.created", targetType: "project", targetId: row.id });
  return toRecord(row as unknown as Row);
}

/** Ownership check — the ONLY way to load a project for a request. */
export async function requireProject(projectId: string, userId: string): Promise<ProjectRecord> {
  const row = await dbGuard(() => db.selectFrom("projects").selectAll().where("id", "=", projectId).executeTakeFirst());
  if (!row) throw new AppError("NOT_FOUND", "That project does not exist.");
  if (row.user_id !== userId) {
    // Same message and status as NOT_FOUND would give: never confirm existence.
    throw new AppError("NOT_FOUND", "That project does not exist.", { context: { projectId, userId } });
  }
  return toRecord(row as unknown as Row);
}

export async function listProjects(userId: string, opts: { limit?: number; offset?: number; includeArchived?: boolean } = {}) {
  const limit = Math.min(100, Math.max(1, opts.limit ?? 20));
  const offset = Math.max(0, opts.offset ?? 0);
  let query = db.selectFrom("projects").selectAll().where("user_id", "=", userId);
  if (!opts.includeArchived) query = query.where("archived", "=", false);
  const rows = await dbGuard(() => query.orderBy("updated_at", "desc").limit(limit).offset(offset).execute());

  let countQuery = db
    .selectFrom("projects")
    .select((eb) => eb.fn.countAll<string>().as("count"))
    .where("user_id", "=", userId);
  if (!opts.includeArchived) countQuery = countQuery.where("archived", "=", false);
  const total = Number((await dbGuard(() => countQuery.executeTakeFirst()))?.count ?? 0);

  return { items: rows.map((r) => toRecord(r as unknown as Row)), total, limit, offset };
}

export async function setProjectStatus(projectId: string, from: ProjectState, to: ProjectState): Promise<void> {
  assertTransition(from, to);
  await dbGuard(() =>
    db.updateTable("projects").set({ status: to, updated_at: new Date() }).where("id", "=", projectId).execute(),
  );
}

/** Advance only if the target is further along than the current state. */
export async function advanceStatus(project: ProjectRecord, to: ProjectState): Promise<void> {
  if (project.status === to) return;
  await setProjectStatus(project.id, project.status, to);
}

export async function touchProject(projectId: string): Promise<void> {
  await dbGuard(() => db.updateTable("projects").set({ updated_at: new Date() }).where("id", "=", projectId).execute());
}

export async function updateProject(
  projectId: string,
  userId: string,
  patch: { name?: string; description?: string; styleKey?: string; qualityPreset?: QualityPreset; fps?: number },
): Promise<ProjectRecord> {
  await requireProject(projectId, userId);
  const set: Record<string, unknown> = { updated_at: new Date() };
  if (patch.name !== undefined) set.name = cleanText(patch.name, 120) || "Untitled project";
  if (patch.description !== undefined) set.description = cleanText(patch.description, 2000);
  if (patch.styleKey !== undefined) set.style_key = getStyle(patch.styleKey).styleKey;
  if (patch.qualityPreset !== undefined) set.quality_preset = patch.qualityPreset;
  if (patch.fps !== undefined) set.fps = patch.fps;
  await dbGuard(() => db.updateTable("projects").set(set).where("id", "=", projectId).execute());
  return requireProject(projectId, userId);
}

export async function archiveProject(projectId: string, userId: string, archived: boolean): Promise<void> {
  await requireProject(projectId, userId);
  await dbGuard(() =>
    db.updateTable("projects").set({ archived, updated_at: new Date() }).where("id", "=", projectId).execute(),
  );
  await audit({ userId, projectId, action: "project.archived", metadata: { archived } });
}

export async function deleteProject(projectId: string, userId: string): Promise<void> {
  await requireProject(projectId, userId);
  await dbGuard(() => db.deleteFrom("projects").where("id", "=", projectId).execute());
  await audit({ userId, projectId, action: "project.deleted" });
}

/** Duplicate only the configuration — never the derived artefacts. */
export async function duplicateProject(projectId: string, userId: string): Promise<ProjectRecord> {
  const src = await requireProject(projectId, userId);
  return createProject({
    userId,
    name: `${src.name} (copy)`,
    description: src.description,
    styleKey: src.styleKey,
    qualityPreset: src.qualityPreset,
    aspectRatio: src.aspectRatio,
    fps: src.fps,
  });
}
