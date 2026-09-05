import { iso } from "@/lib/core/dates";
import { db, dbGuard, jsonb } from "@/lib/db";
import { newId } from "@/lib/core/ids";
import { contentHash } from "@/lib/core/hash";
import { AppError } from "@/lib/errors";
import { cleanText } from "@/lib/security/sanitize";
import { coerceEnum, coerceLens, CAMERAS, PACINGS, TONES, TRANSITIONS, VISUAL_INTENTS, type VisualIntent } from "@/lib/domain/vocab";
import { getStyle } from "@/lib/domain/styles";
import { AiStoryPlanSchema, type AiStoryPlan } from "@/lib/story/schema";
import { parseAiJson } from "@/lib/ai/json";
import { PROMPT_VERSIONS, storySystemPrompt, storyUserPrompt } from "@/lib/ai/prompts";
import { resolveProvider } from "@/lib/ai/factory";
import { estimateCost } from "@/lib/ai/registry";
import { recordCost } from "./cost";
import { audit } from "./audit";
import { markVisualsStale } from "./stale";
import { advanceStatus, setProjectStatus, type ProjectRecord } from "./projects";
import { requireAudio } from "./audio";
import { allSegments } from "./transcript";
import type { PlannerInput } from "@/lib/ai/demo/demo-planner";

/**
 * Story Intelligence.
 *
 * Long-form transcripts are processed HIERARCHICALLY: the transcript is split
 * into overlapping-context windows, each planned with a running summary and the
 * entity registry so far, then the windows are stitched and re-validated
 * against the master audio timeline.
 */

const WINDOW_MS = 6 * 60_000; // plan at most 6 minutes of narration per model call

export interface ShotRecord {
  id: string;
  sceneId: string;
  idx: number;
  startMs: number;
  endMs: number;
  narrationText: string;
  visualIntent: VisualIntent;
  subject: string;
  action: string;
  environment: string;
  composition: string;
  camera: string;
  lens: string;
  lighting: string;
  color: string;
  atmosphere: string;
  entityNames: string[];
  transition: string;
  motion: string;
}

export interface SceneRecord {
  id: string;
  sectionId: string;
  idx: number;
  title: string;
  purpose: string;
  location: string;
  era: string;
  tone: string;
  pacing: string;
  visualStrategy: string;
  startMs: number;
  endMs: number;
  shots: ShotRecord[];
}

export interface SectionRecord {
  id: string;
  idx: number;
  title: string;
  purpose: string;
  startMs: number;
  endMs: number;
  scenes: SceneRecord[];
}

export interface StoryPlanRecord {
  id: string;
  projectId: string;
  version: number;
  status: string;
  stale: boolean;
  summary: string;
  provider: string;
  model: string;
  promptVersion: string;
  contentHash: string;
  createdAt: string;
  sections: SectionRecord[];
  shotCount: number;
}

export async function latestStoryPlan(projectId: string): Promise<StoryPlanRecord | null> {
  const plan = await dbGuard(() =>
    db.selectFrom("story_plans").selectAll().where("project_id", "=", projectId).orderBy("version", "desc").executeTakeFirst(),
  );
  if (!plan) return null;
  return hydratePlan(plan);
}

export async function getStoryPlanByVersion(projectId: string, version: number): Promise<StoryPlanRecord | null> {
  const plan = await dbGuard(() =>
    db.selectFrom("story_plans").selectAll().where("project_id", "=", projectId).where("version", "=", version).executeTakeFirst(),
  );
  return plan ? hydratePlan(plan) : null;
}

export async function listStoryVersions(projectId: string) {
  const rows = await dbGuard(() =>
    db
      .selectFrom("story_plans")
      .select(["id", "version", "status", "stale", "content_hash", "provider", "model", "prompt_version", "created_at"])
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
    provider: r.provider,
    model: r.model,
    promptVersion: r.prompt_version,
    createdAt: iso(r.created_at),
  }));
}

async function hydratePlan(plan: {
  id: string;
  project_id: string;
  version: number;
  status: string;
  stale: boolean;
  summary: string;
  provider: string;
  model: string;
  prompt_version: string;
  content_hash: string;
  created_at: unknown;
}): Promise<StoryPlanRecord> {
  const sections = await dbGuard(() =>
    db.selectFrom("sections").selectAll().where("story_plan_id", "=", plan.id).orderBy("idx").execute(),
  );
  const sectionIds = sections.map((s) => s.id);
  const scenes = sectionIds.length
    ? await dbGuard(() => db.selectFrom("scenes").selectAll().where("section_id", "in", sectionIds).orderBy("idx").execute())
    : [];
  const sceneIds = scenes.map((s) => s.id);
  const shots = sceneIds.length
    ? await dbGuard(() => db.selectFrom("shots").selectAll().where("scene_id", "in", sceneIds).orderBy("idx").execute())
    : [];

  const shotsByScene = new Map<string, ShotRecord[]>();
  for (const s of shots) {
    const list = shotsByScene.get(s.scene_id) ?? [];
    list.push({
      id: s.id,
      sceneId: s.scene_id,
      idx: s.idx,
      startMs: s.start_ms,
      endMs: s.end_ms,
      narrationText: s.narration_text,
      visualIntent: s.visual_intent as VisualIntent,
      subject: s.subject,
      action: s.action,
      environment: s.environment,
      composition: s.composition,
      camera: s.camera,
      lens: s.lens,
      lighting: s.lighting,
      color: s.color,
      atmosphere: s.atmosphere,
      entityNames: Array.isArray(s.entity_names) ? (s.entity_names as string[]) : [],
      transition: s.transition,
      motion: s.motion,
    });
    shotsByScene.set(s.scene_id, list);
  }

  const scenesBySection = new Map<string, SceneRecord[]>();
  for (const sc of scenes) {
    const list = scenesBySection.get(sc.section_id) ?? [];
    list.push({
      id: sc.id,
      sectionId: sc.section_id,
      idx: sc.idx,
      title: sc.title,
      purpose: sc.purpose,
      location: sc.location,
      era: sc.era,
      tone: sc.tone,
      pacing: sc.pacing,
      visualStrategy: sc.visual_strategy,
      startMs: sc.start_ms,
      endMs: sc.end_ms,
      shots: (shotsByScene.get(sc.id) ?? []).sort((a, b) => a.idx - b.idx),
    });
    scenesBySection.set(sc.section_id, list);
  }

  const sectionRecords: SectionRecord[] = sections.map((s) => ({
    id: s.id,
    idx: s.idx,
    title: s.title,
    purpose: s.purpose,
    startMs: s.start_ms,
    endMs: s.end_ms,
    scenes: (scenesBySection.get(s.id) ?? []).sort((a, b) => a.idx - b.idx),
  }));

  return {
    id: plan.id,
    projectId: plan.project_id,
    version: plan.version,
    status: plan.status,
    stale: plan.stale,
    summary: plan.summary,
    provider: plan.provider,
    model: plan.model,
    promptVersion: plan.prompt_version,
    contentHash: plan.content_hash,
    createdAt: iso(plan.created_at),
    sections: sectionRecords,
    shotCount: shots.length,
  };
}

export async function allShots(projectId: string): Promise<ShotRecord[]> {
  const plan = await latestStoryPlan(projectId);
  if (!plan) return [];
  return plan.sections.flatMap((sec) => sec.scenes.flatMap((sc) => sc.shots));
}

export interface AnalyzeProgress {
  (update: { message: string; completed: number; total: number }): Promise<void> | void;
}

export async function analyzeStory(params: {
  project: ProjectRecord;
  userId: string;
  onProgress?: AnalyzeProgress;
}): Promise<StoryPlanRecord> {
  const { project, userId } = params;
  const audio = await requireAudio(project.id);
  const segments = await allSegments(project.id);
  if (segments.length === 0) throw new AppError("STATE_ERROR", "Import a transcript before analysing the story.");

  const style = getStyle(project.styleKey);
  const resolved = await resolveProvider("text", { userId, preset: project.qualityPreset });
  if (!resolved.text) throw new AppError("CONFIGURATION_ERROR", "No text model is available.");

  await setProjectStatus(project.id, project.status, "STORY_ANALYZING");

  const windows = splitWindows(segments, audio.durationMs);
  const merged: AiStoryPlan = { summary: "", sections: [] };
  const knownEntities = new Set<string>();
  let runningSummary = "";
  let totalOutputTokens = 0;

  try {
    for (let i = 0; i < windows.length; i++) {
      const w = windows[i];
      await params.onProgress?.({
        message: `Analysing narration ${i + 1} of ${windows.length}`,
        completed: i,
        total: windows.length,
      });

      const plannerInput: PlannerInput = {
        segments: w.segments.map((s) => ({ startMs: s.startMs, endMs: s.endMs, text: s.text })),
        audioDurationMs: w.endMs - w.startMs,
        styleKey: style.styleKey,
        projectName: project.name,
      };

      const response = await resolved.text.generateText({
        system: storySystemPrompt(),
        user: storyUserPrompt({
          projectName: project.name,
          styleName: style.name,
          styleDescription: style.description,
          windowStartMs: w.startMs,
          windowEndMs: w.endMs,
          audioDurationMs: audio.durationMs,
          priorSummary: runningSummary,
          knownEntities: [...knownEntities].slice(0, 30),
          segments: w.segments,
        }),
        jsonSchemaName: "StoryPlan",
        temperature: 0.4,
        seed: `${project.id}:${i}`,
        demoPayload: { kind: "story", input: plannerInput },
      });

      totalOutputTokens += response.usage?.outputTokens ?? 0;
      const parsed = parseAiJson(response.text, AiStoryPlanSchema, "the story plan");

      // Demo planner works in window-relative time; shift back onto the master timeline.
      const offset = resolved.mode === "demo" ? w.startMs : 0;
      for (const section of parsed.sections) {
        merged.sections.push(shiftSection(section, offset));
        for (const scene of section.scenes) for (const shot of scene.shots) for (const e of shot.entities) knownEntities.add(e);
      }
      runningSummary = `${runningSummary} ${parsed.summary}`.trim().slice(-1500);
      merged.summary = runningSummary;
    }

    const normalized = normalizePlan(merged, audio.durationMs);
    const spec = resolved.spec;
    const record = await persistPlan({
      project,
      plan: normalized,
      provider: spec.provider,
      model: spec.model,
      inputHash: contentHash({ segments, styleKey: style.styleKey, v: PROMPT_VERSIONS.story }),
    });

    await recordCost({
      userId,
      projectId: project.id,
      operationId: `story:${record.id}`,
      operationType: "STORY_ANALYZE",
      estimate: estimateCost(spec, Math.max(1, Math.round(totalOutputTokens / 1000) || windows.length)),
      isMock: resolved.mode === "demo",
    });

    await setProjectStatus(project.id, "STORY_ANALYZING", "STORY_READY");
    await markVisualsStale(project.id);
    await audit({
      userId,
      projectId: project.id,
      action: "story.analyzed",
      metadata: { version: record.version, shots: record.shotCount, provider: spec.provider, mock: resolved.mode === "demo" },
    });
    return record;
  } catch (e) {
    await setProjectStatus(project.id, "STORY_ANALYZING", "TRANSCRIPT_READY").catch(() => {});
    throw e;
  }
}

interface Window {
  startMs: number;
  endMs: number;
  segments: { startMs: number; endMs: number; text: string }[];
}

function splitWindows(
  segments: { startMs: number; endMs: number; text: string }[],
  audioDurationMs: number,
): Window[] {
  if (audioDurationMs <= WINDOW_MS) {
    return [{ startMs: 0, endMs: audioDurationMs, segments: segments.map((s) => ({ ...s })) }];
  }
  const windows: Window[] = [];
  let bucket: typeof segments = [];
  let windowStart = 0;
  for (const seg of segments) {
    bucket.push(seg);
    if (seg.endMs - windowStart >= WINDOW_MS) {
      windows.push({ startMs: windowStart, endMs: seg.endMs, segments: bucket });
      windowStart = seg.endMs;
      bucket = [];
    }
  }
  if (bucket.length) {
    windows.push({ startMs: windowStart, endMs: audioDurationMs, segments: bucket });
  } else if (windows.length) {
    windows[windows.length - 1].endMs = audioDurationMs;
  }
  // Demo planner receives window-relative times.
  return windows.map((w) => ({
    ...w,
    segments: w.segments.map((s) => ({ ...s })),
  }));
}

function shiftSection(section: AiStoryPlan["sections"][number], offset: number) {
  if (offset === 0) return section;
  const n = (v: number | string) => Number(v) + offset;
  return {
    ...section,
    startMs: n(section.startMs),
    endMs: n(section.endMs),
    scenes: section.scenes.map((sc) => ({
      ...sc,
      startMs: n(sc.startMs),
      endMs: n(sc.endMs),
      shots: sc.shots.map((sh) => ({ ...sh, startMs: n(sh.startMs), endMs: n(sh.endMs) })),
    })),
  };
}

/**
 * Semantic validation + normalisation.
 * Coerces vocabulary, enforces monotonic contiguous time across the whole plan,
 * and guarantees the plan exactly spans the master audio duration.
 */
export function normalizePlan(plan: AiStoryPlan, audioDurationMs: number): AiStoryPlan {
  const sections = plan.sections
    .map((s) => ({
      ...s,
      startMs: num(s.startMs),
      endMs: num(s.endMs),
      scenes: s.scenes
        .map((sc) => ({
          ...sc,
          startMs: num(sc.startMs),
          endMs: num(sc.endMs),
          shots: sc.shots.map((sh) => ({ ...sh, startMs: num(sh.startMs), endMs: num(sh.endMs) })).sort((a, b) => a.startMs - b.startMs),
        }))
        .sort((a, b) => a.startMs - b.startMs),
    }))
    .sort((a, b) => a.startMs - b.startMs);

  if (sections.length === 0) throw new AppError("PROVIDER_ERROR", "The story plan contained no sections.");

  let cursor = 0;
  for (const section of sections) {
    section.startMs = cursor;
    for (const scene of section.scenes) {
      scene.startMs = cursor;
      const shots = scene.shots.filter((sh) => num(sh.endMs) > num(sh.startMs) || true);
      for (const shot of shots) {
        shot.startMs = cursor;
        let end = Math.min(num(shot.endMs), audioDurationMs);
        if (end <= cursor) end = Math.min(cursor + 1500, audioDurationMs);
        shot.endMs = end;
        cursor = end;

        shot.visualIntent = coerceEnum(shot.visualIntent, VISUAL_INTENTS, "MEDIUM");
        shot.camera = coerceEnum(shot.camera, CAMERAS, "STATIC");
        shot.lens = coerceLens(shot.lens);
        shot.transition = coerceEnum(shot.transition, TRANSITIONS, "CUT");
        shot.subject = cleanText(shot.subject, 300);
        shot.action = cleanText(shot.action, 300);
        shot.environment = cleanText(shot.environment, 300);
        shot.composition = cleanText(shot.composition, 300);
        shot.lighting = cleanText(shot.lighting, 200);
        shot.color = cleanText(shot.color, 200);
        shot.atmosphere = cleanText(shot.atmosphere, 200);
        shot.narrationText = cleanText(shot.narrationText, 2000);
        shot.entities = [...new Set(shot.entities.map((e) => cleanText(e, 80)).filter(Boolean))].slice(0, 6);
      }
      scene.shots = shots.filter((sh) => num(sh.endMs) > num(sh.startMs));
      scene.endMs = cursor;
      scene.tone = coerceEnum(scene.tone, TONES, "NEUTRAL");
      scene.pacing = coerceEnum(scene.pacing, PACINGS, "MEDIUM");
      scene.title = cleanText(scene.title, 160) || "Scene";
      scene.purpose = cleanText(scene.purpose, 500);
      scene.location = cleanText(scene.location, 160);
      scene.era = cleanText(scene.era, 80);
      scene.visualStrategy = cleanText(scene.visualStrategy, 500);
    }
    section.scenes = section.scenes.filter((sc) => sc.shots.length > 0);
    section.endMs = cursor;
    section.title = cleanText(section.title, 160) || "Section";
    section.purpose = cleanText(section.purpose, 500);
  }

  const kept = sections.filter((s) => s.scenes.length > 0);
  if (kept.length === 0) throw new AppError("PROVIDER_ERROR", "The story plan contained no usable shots.");

  // The plan must span exactly the master audio duration.
  const lastSection = kept[kept.length - 1];
  const lastScene = lastSection.scenes[lastSection.scenes.length - 1];
  const lastShot = lastScene.shots[lastScene.shots.length - 1];
  lastShot.endMs = audioDurationMs;
  lastScene.endMs = audioDurationMs;
  lastSection.endMs = audioDurationMs;

  return { summary: cleanText(plan.summary, 2000), sections: kept };
}

function num(v: number | string): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
}

async function persistPlan(params: {
  project: ProjectRecord;
  plan: AiStoryPlan;
  provider: string;
  model: string;
  inputHash: string;
}): Promise<StoryPlanRecord> {
  const { project, plan } = params;
  const version =
    ((
      await dbGuard(() =>
        db
          .selectFrom("story_plans")
          .select((eb) => eb.fn.max("version").as("v"))
          .where("project_id", "=", project.id)
          .executeTakeFirst(),
      )
    )?.v ?? 0) + 1;

  const planId = newId("story");
  const hash = contentHash(plan);

  await dbGuard(() =>
    db.transaction().execute(async (trx) => {
      await trx
        .insertInto("story_plans")
        .values({
          id: planId,
          project_id: project.id,
          version,
          status: "DRAFT",
          stale: false,
          input_hash: params.inputHash,
          content_hash: hash,
          provider: params.provider,
          model: params.model,
          prompt_version: PROMPT_VERSIONS.story,
          summary: plan.summary,
        })
        .execute();

      for (let si = 0; si < plan.sections.length; si++) {
        const section = plan.sections[si];
        const sectionId = newId("sec");
        await trx
          .insertInto("sections")
          .values({
            id: sectionId,
            story_plan_id: planId,
            idx: si,
            title: section.title,
            purpose: section.purpose,
            start_ms: num(section.startMs),
            end_ms: num(section.endMs),
          })
          .execute();

        for (let ci = 0; ci < section.scenes.length; ci++) {
          const scene = section.scenes[ci];
          const sceneId = newId("scn");
          await trx
            .insertInto("scenes")
            .values({
              id: sceneId,
              section_id: sectionId,
              idx: ci,
              title: scene.title,
              purpose: scene.purpose,
              location: scene.location,
              era: scene.era,
              tone: scene.tone,
              pacing: scene.pacing,
              visual_strategy: scene.visualStrategy,
              start_ms: num(scene.startMs),
              end_ms: num(scene.endMs),
            })
            .execute();

          const shotRows = scene.shots.map((shot, shi) => ({
            id: newId("shot"),
            scene_id: sceneId,
            project_id: project.id,
            idx: shi,
            start_ms: num(shot.startMs),
            end_ms: num(shot.endMs),
            narration_text: shot.narrationText,
            visual_intent: shot.visualIntent,
            subject: shot.subject,
            action: shot.action,
            environment: shot.environment,
            composition: shot.composition,
            camera: shot.camera,
            lens: shot.lens,
            lighting: shot.lighting,
            color: shot.color,
            atmosphere: shot.atmosphere,
            entity_names: jsonb(shot.entities),
            transition: shot.transition,
            motion: "STATIC",
          }));
          for (let i = 0; i < shotRows.length; i += 300) {
            await trx.insertInto("shots").values(shotRows.slice(i, i + 300)).execute();
          }
        }
      }
    }),
  );

  const record = await getStoryPlanByVersion(project.id, version);
  if (!record) throw new AppError("INTERNAL_ERROR", "The story plan could not be saved.");
  return record;
}

export async function approveStory(project: ProjectRecord, userId: string): Promise<void> {
  const plan = await latestStoryPlan(project.id);
  if (!plan) throw new AppError("STATE_ERROR", "Analyse the story before approving it.");
  if (plan.stale) {
    throw new AppError("STATE_ERROR", "The transcript changed after this story was generated. Re-run the analysis first.");
  }
  await dbGuard(() => db.updateTable("story_plans").set({ status: "APPROVED" }).where("id", "=", plan.id).execute());
  await advanceStatus(project, "STORY_APPROVED");
  await audit({ userId, projectId: project.id, action: "story.approved", metadata: { version: plan.version } });
}

export async function updateShot(params: {
  projectId: string;
  shotId: string;
  patch: Partial<Pick<ShotRecord, "subject" | "action" | "environment" | "visualIntent" | "camera" | "lens" | "narrationText">>;
}): Promise<void> {
  const shot = await dbGuard(() =>
    db.selectFrom("shots").selectAll().where("id", "=", params.shotId).where("project_id", "=", params.projectId).executeTakeFirst(),
  );
  if (!shot) throw new AppError("NOT_FOUND", "That shot does not exist.");
  const set: Record<string, unknown> = {};
  const p = params.patch;
  if (p.subject !== undefined) set.subject = cleanText(p.subject, 300);
  if (p.action !== undefined) set.action = cleanText(p.action, 300);
  if (p.environment !== undefined) set.environment = cleanText(p.environment, 300);
  if (p.narrationText !== undefined) set.narration_text = cleanText(p.narrationText, 2000);
  if (p.visualIntent !== undefined) set.visual_intent = coerceEnum(p.visualIntent, VISUAL_INTENTS, "MEDIUM");
  if (p.camera !== undefined) set.camera = coerceEnum(p.camera, CAMERAS, "STATIC");
  if (p.lens !== undefined) set.lens = coerceLens(p.lens);
  if (Object.keys(set).length === 0) return;
  await dbGuard(() => db.updateTable("shots").set(set).where("id", "=", params.shotId).execute());
  await markVisualsStale(params.projectId);
}
