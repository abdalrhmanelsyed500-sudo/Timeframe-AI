import { iso } from "@/lib/core/dates";
import { db, dbGuard } from "@/lib/db";
import { newId } from "@/lib/core/ids";
import { contentHash } from "@/lib/core/hash";
import { AppError } from "@/lib/errors";
import { getStyle } from "@/lib/domain/styles";
import { coerceEnum, MOTIONS, TRANSITIONS, OVERLAY_KINDS, type VisualIntent } from "@/lib/domain/vocab";
import { buildTimeline, type BuildShotInput } from "@/lib/timeline/build";
import { validateTimeline } from "@/lib/timeline/validate";
import { ClipSchema, OverlaySchema, TimelineDocSchema, type Clip, type Overlay, type TimelineDoc } from "@/lib/timeline/types";
import { cleanText } from "@/lib/security/sanitize";
import { audit } from "./audit";
import { advanceStatus, type ProjectRecord } from "./projects";
import { requireAudio } from "./audio";
import { latestStoryPlan } from "./story";

export interface TimelineRecord {
  id: string;
  projectId: string;
  version: number;
  status: string;
  stale: boolean;
  doc: TimelineDoc;
  contentHash: string;
  parentVersion: number | null;
  createdAt: string;
}

export async function latestTimeline(projectId: string): Promise<TimelineRecord | null> {
  const row = await dbGuard(() =>
    db.selectFrom("timelines").selectAll().where("project_id", "=", projectId).orderBy("version", "desc").executeTakeFirst(),
  );
  return row ? toRecord(row) : null;
}

export async function getTimelineVersion(projectId: string, version: number): Promise<TimelineRecord | null> {
  const row = await dbGuard(() =>
    db.selectFrom("timelines").selectAll().where("project_id", "=", projectId).where("version", "=", version).executeTakeFirst(),
  );
  return row ? toRecord(row) : null;
}

export async function listTimelineVersions(projectId: string) {
  const rows = await dbGuard(() =>
    db
      .selectFrom("timelines")
      .select(["id", "version", "status", "stale", "content_hash", "duration_ms", "parent_version", "created_at"])
      .where("project_id", "=", projectId)
      .orderBy("version", "desc")
      .execute(),
  );
  return rows.map((r) => ({
    id: r.id,
    version: r.version,
    status: r.status,
    stale: r.stale,
    contentHash: r.content_hash,
    durationMs: r.duration_ms,
    parentVersion: r.parent_version,
    createdAt: iso(r.created_at),
  }));
}

function toRecord(row: {
  id: string;
  project_id: string;
  version: number;
  status: string;
  stale: boolean;
  duration_ms: number;
  clips: unknown;
  overlays: unknown;
  content_hash: string;
  parent_version: number | null;
  created_at: unknown;
}): TimelineRecord {
  const doc = TimelineDocSchema.parse({
    durationMs: row.duration_ms,
    clips: row.clips,
    overlays: row.overlays ?? [],
  });
  return {
    id: row.id,
    projectId: row.project_id,
    version: row.version,
    status: row.status,
    stale: row.stale,
    doc,
    contentHash: row.content_hash,
    parentVersion: row.parent_version,
    createdAt: iso(row),
  };
}

/**
 * Deterministic timeline generation from the approved story + selected assets.
 * Always creates a NEW immutable version; historical versions are never mutated.
 */
export async function generateTimeline(params: { project: ProjectRecord; userId: string }): Promise<{
  timeline: TimelineRecord;
  corrections: string[];
  validation: ReturnType<typeof validateTimeline>;
}> {
  const { project, userId } = params;
  const audio = await requireAudio(project.id);
  const plan = await latestStoryPlan(project.id);
  if (!plan) throw new AppError("STATE_ERROR", "Analyse and approve the story before building a timeline.");
  if (plan.status !== "APPROVED") throw new AppError("STATE_ERROR", "Approve the story before building a timeline.");

  const style = getStyle(project.styleKey);

  const assets = await dbGuard(() =>
    db
      .selectFrom("assets")
      .leftJoin("asset_versions", "asset_versions.id", "assets.selected_version_id")
      .select([
        "assets.id as asset_id",
        "assets.shot_id as shot_id",
        "asset_versions.id as version_id",
        "asset_versions.storage_key as storage_key",
      ])
      .where("assets.project_id", "=", project.id)
      .execute(),
  );
  const assetByShot = new Map(assets.map((a) => [a.shot_id, a]));

  const shots: BuildShotInput[] = plan.sections.flatMap((section) =>
    section.scenes.flatMap((scene) =>
      scene.shots.map((shot) => {
        const a = assetByShot.get(shot.id);
        return {
          shotId: shot.id,
          sceneId: scene.id,
          sectionId: section.id,
          idx: shot.idx,
          startMs: shot.startMs,
          endMs: shot.endMs,
          visualIntent: shot.visualIntent,
          narrationText: shot.narrationText,
          requestedMotion: null,
          requestedTransition: coerceEnum(shot.transition, TRANSITIONS, "CUT"),
          assetId: a?.asset_id ?? null,
          assetVersionId: a?.version_id ?? null,
          storageKey: a?.storage_key ?? null,
        };
      }),
    ),
  );

  const built = buildTimeline({ projectId: project.id, audioDurationMs: audio.durationMs, style, shots });
  const validation = validateTimeline(built.doc);
  const timeline = await saveVersion({ project, doc: built.doc, status: validation.valid ? "DRAFT" : "INVALID", parentVersion: null });

  await clearDraft(project.id);
  await advanceStatus(project, "TIMELINE_READY");
  await audit({
    userId,
    projectId: project.id,
    action: "timeline.created",
    metadata: { version: timeline.version, clips: built.doc.clips.length, corrections: built.corrections.length },
  });

  return { timeline, corrections: built.corrections, validation };
}

export async function saveVersion(params: {
  project: ProjectRecord;
  doc: TimelineDoc;
  status: string;
  parentVersion: number | null;
}): Promise<TimelineRecord> {
  const version =
    ((
      await dbGuard(() =>
        db
          .selectFrom("timelines")
          .select((eb) => eb.fn.max("version").as("v"))
          .where("project_id", "=", params.project.id)
          .executeTakeFirst(),
      )
    )?.v ?? 0) + 1;

  const id = newId("tl");
  await dbGuard(() =>
    db
      .insertInto("timelines")
      .values({
        id,
        project_id: params.project.id,
        version,
        status: params.status,
        stale: false,
        duration_ms: params.doc.durationMs,
        clips: params.doc.clips as unknown as unknown[],
        overlays: params.doc.overlays as unknown as unknown[],
        content_hash: contentHash(params.doc),
        parent_version: params.parentVersion,
      })
      .execute(),
  );
  const record = await getTimelineVersion(params.project.id, version);
  if (!record) throw new AppError("INTERNAL_ERROR", "The timeline could not be saved.");
  return record;
}

// ---------------------------------------------------------------------------
// Draft / autosave with optimistic concurrency
// ---------------------------------------------------------------------------

export interface DraftRecord {
  baseVersion: number;
  revision: number;
  doc: TimelineDoc;
  updatedAt: string;
}

export async function getDraft(projectId: string): Promise<DraftRecord | null> {
  const row = await dbGuard(() => db.selectFrom("timeline_drafts").selectAll().where("project_id", "=", projectId).executeTakeFirst());
  if (!row) return null;
  const base = await getTimelineVersion(projectId, row.base_version);
  return {
    baseVersion: row.base_version,
    revision: row.revision,
    doc: TimelineDocSchema.parse({
      durationMs: base?.doc.durationMs ?? 0,
      clips: row.clips,
      overlays: row.overlays ?? [],
    }),
    updatedAt: iso(row.updated_at),
  };
}

export async function clearDraft(projectId: string): Promise<void> {
  await dbGuard(() => db.deleteFrom("timeline_drafts").where("project_id", "=", projectId).execute());
}

/**
 * Autosave. `expectedRevision` implements conflict detection: if another tab
 * saved in the meantime the write is rejected rather than silently overwriting.
 */
export async function saveDraft(params: {
  projectId: string;
  baseVersion: number;
  clips: unknown;
  overlays: unknown;
  expectedRevision: number | null;
}): Promise<DraftRecord> {
  const clips = ClipSchema.array().parse(params.clips);
  const overlays = OverlaySchema.array().parse(params.overlays ?? []);
  const current = await dbGuard(() =>
    db.selectFrom("timeline_drafts").selectAll().where("project_id", "=", params.projectId).executeTakeFirst(),
  );

  if (current && params.expectedRevision !== null && current.revision !== params.expectedRevision) {
    throw new AppError(
      "CONFLICT",
      "This timeline was changed in another tab or window. Reload to see the latest version before editing.",
      { context: { serverRevision: current.revision, clientRevision: params.expectedRevision } },
    );
  }

  const revision = (current?.revision ?? 0) + 1;
  await dbGuard(() =>
    db
      .insertInto("timeline_drafts")
      .values({
        project_id: params.projectId,
        base_version: params.baseVersion,
        clips: clips as unknown as unknown[],
        overlays: overlays as unknown as unknown[],
        revision,
        updated_at: new Date(),
      })
      .onConflict((oc) =>
        oc.column("project_id").doUpdateSet({
          base_version: params.baseVersion,
          clips: clips as unknown as unknown[],
          overlays: overlays as unknown as unknown[],
          revision,
          updated_at: new Date(),
        }),
      )
      .execute(),
  );

  const draft = await getDraft(params.projectId);
  if (!draft) throw new AppError("INTERNAL_ERROR", "The draft could not be saved.");
  return draft;
}

/** Promote the current draft to a new immutable version. */
export async function commitDraft(params: { project: ProjectRecord; userId: string }): Promise<TimelineRecord> {
  const draft = await getDraft(params.project.id);
  if (!draft) throw new AppError("STATE_ERROR", "There are no unsaved timeline changes.");
  const validation = validateTimeline(draft.doc);
  const record = await saveVersion({
    project: params.project,
    doc: draft.doc,
    status: validation.valid ? "DRAFT" : "INVALID",
    parentVersion: draft.baseVersion,
  });
  await clearDraft(params.project.id);
  await audit({ userId: params.userId, projectId: params.project.id, action: "timeline.created", metadata: { version: record.version, fromDraft: true } });
  return record;
}

// ---------------------------------------------------------------------------
// Editing primitives (applied to a doc, then autosaved as a draft)
// ---------------------------------------------------------------------------

export type ClipEdit =
  | { op: "setMotion"; clipId: string; motion: string }
  | { op: "setTransition"; clipId: string; transition: string }
  | { op: "setAsset"; clipId: string; assetId: string; assetVersionId: string; storageKey: string }
  | { op: "trim"; clipId: string; startMs?: number; endMs?: number }
  | { op: "addOverlay"; overlay: Omit<Overlay, "overlayId"> }
  | { op: "updateOverlay"; overlayId: string; patch: Partial<Omit<Overlay, "overlayId">> }
  | { op: "removeOverlay"; overlayId: string };

export function applyEdits(doc: TimelineDoc, edits: ClipEdit[]): TimelineDoc {
  let clips: Clip[] = doc.clips.map((c) => ({ ...c }));
  let overlays: Overlay[] = doc.overlays.map((o) => ({ ...o }));

  for (const edit of edits) {
    switch (edit.op) {
      case "setMotion": {
        clips = clips.map((c) => (c.clipId === edit.clipId ? { ...c, motion: coerceEnum(edit.motion, MOTIONS, "STATIC") } : c));
        break;
      }
      case "setTransition": {
        clips = clips.map((c) =>
          c.clipId === edit.clipId ? { ...c, transitionIn: coerceEnum(edit.transition, TRANSITIONS, "CUT") } : c,
        );
        break;
      }
      case "setAsset": {
        clips = clips.map((c) =>
          c.clipId === edit.clipId
            ? { ...c, assetId: edit.assetId, assetVersionId: edit.assetVersionId, storageKey: edit.storageKey }
            : c,
        );
        break;
      }
      case "trim": {
        const i = clips.findIndex((c) => c.clipId === edit.clipId);
        if (i < 0) break;
        const clip = clips[i];
        const prev = clips[i - 1];
        const next = clips[i + 1];
        // Trimming stays contiguous: the neighbour absorbs the change.
        if (edit.startMs !== undefined && prev) {
          const bound = Math.max(prev.startMs + 400, Math.min(edit.startMs, clip.endMs - 400));
          prev.endMs = bound;
          clip.startMs = bound;
        }
        if (edit.endMs !== undefined && next) {
          const bound = Math.max(clip.startMs + 400, Math.min(edit.endMs, next.endMs - 400));
          clip.endMs = bound;
          next.startMs = bound;
        }
        break;
      }
      case "addOverlay": {
        overlays.push({
          ...edit.overlay,
          overlayId: newId("ov"),
          text: cleanText(edit.overlay.text, 200),
          kind: coerceEnum(edit.overlay.kind, OVERLAY_KINDS, "LABEL"),
        });
        break;
      }
      case "updateOverlay": {
        overlays = overlays.map((o) =>
          o.overlayId === edit.overlayId
            ? { ...o, ...edit.patch, text: cleanText(edit.patch.text ?? o.text, 200), overlayId: o.overlayId }
            : o,
        );
        break;
      }
      case "removeOverlay": {
        overlays = overlays.filter((o) => o.overlayId !== edit.overlayId);
        break;
      }
    }
  }

  return {
    durationMs: doc.durationMs,
    clips: clips.sort((a, b) => a.startMs - b.startMs),
    overlays: overlays.sort((a, b) => a.startMs - b.startMs),
  };
}

export async function approveTimeline(params: { project: ProjectRecord; userId: string; override?: boolean }): Promise<TimelineRecord> {
  const timeline = await latestTimeline(params.project.id);
  if (!timeline) throw new AppError("STATE_ERROR", "Build a timeline before approving it.");
  if (timeline.stale) throw new AppError("STATE_ERROR", "The story or assets changed. Rebuild the timeline before approving it.");

  const validation = validateTimeline(timeline.doc);
  if (!validation.valid) {
    throw new AppError("QUALITY_ERROR", "This timeline cannot be approved yet.", {
      context: { blocking: validation.blocking.map((v) => v.message) },
    });
  }

  const report = await dbGuard(() =>
    db
      .selectFrom("cinematic_reports")
      .selectAll()
      .where("timeline_id", "=", timeline.id)
      .orderBy("created_at", "desc")
      .executeTakeFirst(),
  );
  if (!report) throw new AppError("STATE_ERROR", "Run cinematic QA before approving the timeline.");
  if (report.gate === "FAIL" && !params.override) {
    throw new AppError(
      "QUALITY_ERROR",
      "Cinematic QA failed this timeline. Fix the flagged issues, or approve with an explicit override.",
      { context: { gate: report.gate, score: report.overall_score } },
    );
  }

  await dbGuard(() => db.updateTable("timelines").set({ status: "APPROVED" }).where("id", "=", timeline.id).execute());
  await advanceStatus(params.project, "READY_TO_RENDER");
  await audit({
    userId: params.userId,
    projectId: params.project.id,
    action: "timeline.approved",
    metadata: { version: timeline.version, gate: report.gate, override: Boolean(params.override) },
  });
  const updated = await getTimelineVersion(params.project.id, timeline.version);
  return updated ?? timeline;
}

/** Restore an old version by creating a NEW version from it (never editing history). */
export async function restoreVersion(params: { project: ProjectRecord; userId: string; version: number }): Promise<TimelineRecord> {
  const source = await getTimelineVersion(params.project.id, params.version);
  if (!source) throw new AppError("NOT_FOUND", "That timeline version does not exist.");
  return saveVersion({ project: params.project, doc: source.doc, status: "DRAFT", parentVersion: source.version });
}

export type { VisualIntent };
