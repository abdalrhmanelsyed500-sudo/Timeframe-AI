import { iso } from "@/lib/core/dates";
import { db, dbGuard } from "@/lib/db";
import { newId } from "@/lib/core/ids";
import { contentHash } from "@/lib/core/hash";
import { AppError } from "@/lib/errors";
import { cleanText } from "@/lib/security/sanitize";
import { coerceEnum, ENTITY_TYPES } from "@/lib/domain/vocab";
import { getStyle } from "@/lib/domain/styles";
import { AiVisualBibleSchema, type AiVisualBible } from "@/lib/story/schema";
import { parseAiJson } from "@/lib/ai/json";
import { PROMPT_VERSIONS, visualBibleSystemPrompt, visualBibleUserPrompt } from "@/lib/ai/prompts";
import { resolveProvider } from "@/lib/ai/factory";
import { estimateCost } from "@/lib/ai/registry";
import { recordCost } from "./cost";
import { audit } from "./audit";
import { latestStoryPlan } from "./story";
import type { ProjectRecord } from "./projects";

export interface EntityRecord {
  id: string;
  type: string;
  name: string;
  description: string;
  appearance: string;
  visualAttributes: Record<string, unknown>;
  continuityAttributes: Record<string, unknown>;
}

export interface VisualBibleRecord {
  id: string;
  projectId: string;
  version: number;
  stale: boolean;
  content: AiVisualBible;
  contentHash: string;
  provider: string;
  model: string;
  promptVersion: string;
  createdAt: string;
  entities: EntityRecord[];
}

export async function latestVisualBible(projectId: string): Promise<VisualBibleRecord | null> {
  const row = await dbGuard(() =>
    db.selectFrom("visual_bibles").selectAll().where("project_id", "=", projectId).orderBy("version", "desc").executeTakeFirst(),
  );
  if (!row) return null;
  const entities = await listEntities(projectId);
  return {
    id: row.id,
    projectId: row.project_id,
    version: row.version,
    stale: row.stale,
    content: row.content as unknown as AiVisualBible,
    contentHash: row.content_hash,
    provider: row.provider,
    model: row.model,
    promptVersion: row.prompt_version,
    createdAt: iso(row.created_at),
    entities,
  };
}

export async function listEntities(projectId: string): Promise<EntityRecord[]> {
  const rows = await dbGuard(() =>
    db.selectFrom("entities").selectAll().where("project_id", "=", projectId).orderBy("name").execute(),
  );
  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    name: r.name,
    description: r.description,
    appearance: r.appearance,
    visualAttributes: (r.visual_attrs ?? {}) as Record<string, unknown>,
    continuityAttributes: (r.continuity ?? {}) as Record<string, unknown>,
  }));
}

export async function listVisualBibleVersions(projectId: string) {
  const rows = await dbGuard(() =>
    db
      .selectFrom("visual_bibles")
      .select(["id", "version", "stale", "content_hash", "provider", "model", "prompt_version", "created_at"])
      .where("project_id", "=", projectId)
      .orderBy("version", "desc")
      .execute(),
  );
  return rows.map((r) => ({
    id: r.id,
    version: r.version,
    stale: r.stale,
    contentHash: r.content_hash,
    provider: r.provider,
    model: r.model,
    promptVersion: r.prompt_version,
    createdAt: iso(r.created_at),
  }));
}

export async function generateVisualBible(params: { project: ProjectRecord; userId: string }): Promise<VisualBibleRecord> {
  const { project, userId } = params;
  const plan = await latestStoryPlan(project.id);
  if (!plan) throw new AppError("STATE_ERROR", "Analyse and approve the story before generating the visual bible.");
  if (plan.status !== "APPROVED") throw new AppError("STATE_ERROR", "Approve the story before generating the visual bible.");

  const style = getStyle(project.styleKey);
  const resolved = await resolveProvider("text", { userId, preset: project.qualityPreset });
  if (!resolved.text) throw new AppError("CONFIGURATION_ERROR", "No text model is available.");

  // Hierarchical context: an outline, not the full transcript.
  const outline = plan.sections
    .map(
      (sec) =>
        `## ${sec.title} — ${sec.purpose}\n` +
        sec.scenes
          .map((sc) => `- ${sc.title} [${sc.location || "unspecified place"}${sc.era ? `, ${sc.era}` : ""}] ${sc.purpose}`)
          .join("\n"),
    )
    .join("\n\n")
    .slice(0, 12_000);

  const candidateEntities = [...new Set(plan.sections.flatMap((s) => s.scenes.flatMap((sc) => sc.shots.flatMap((sh) => sh.entityNames))))];
  const locations = [...new Set(plan.sections.flatMap((s) => s.scenes.map((sc) => sc.location).filter(Boolean)))];
  const eras = [...new Set(plan.sections.flatMap((s) => s.scenes.map((sc) => sc.era).filter(Boolean)))];

  const response = await resolved.text.generateText({
    system: visualBibleSystemPrompt(),
    user: visualBibleUserPrompt({ style, storyOutline: outline, candidateEntities }),
    jsonSchemaName: "VisualBible",
    temperature: 0.3,
    seed: project.id,
    demoPayload: {
      kind: "visual_bible",
      input: { storyText: outline, styleKey: style.styleKey, entityNames: candidateEntities, eras, locations },
    },
  });

  const parsed = parseAiJson(response.text, AiVisualBibleSchema, "the visual bible");
  const normalized = normalizeBible(parsed, style.styleKey);
  const record = await persistBible({ project, storyPlanId: plan.id, bible: normalized, provider: resolved.spec.provider, model: resolved.spec.model });

  await recordCost({
    userId,
    projectId: project.id,
    operationId: `bible:${record.id}`,
    operationType: "VISUAL_BIBLE_GENERATE",
    estimate: estimateCost(resolved.spec, Math.max(1, Math.round((response.usage?.outputTokens ?? 2000) / 1000))),
    isMock: resolved.mode === "demo",
  });
  await audit({
    userId,
    projectId: project.id,
    action: "visual_bible.generated",
    metadata: { version: record.version, entities: record.entities.length, mock: resolved.mode === "demo" },
  });
  return record;
}

function normalizeBible(bible: AiVisualBible, styleKey: string): AiVisualBible {
  const seen = new Set<string>();
  const entities = [];
  for (const e of bible.entities) {
    const name = cleanText(e.name, 80);
    if (!name) continue;
    const key = name.toLowerCase();
    // Entity names are unique within a project.
    if (seen.has(key)) continue;
    seen.add(key);
    entities.push({
      type: coerceEnum(e.type, ENTITY_TYPES, "OBJECT"),
      name,
      description: cleanText(e.description, 800),
      appearance: cleanText(e.appearance, 800),
      visualAttributes: mapClean(e.visualAttributes),
      continuityAttributes: mapClean(e.continuityAttributes),
    });
    if (entities.length >= 120) break;
  }
  return {
    world: cleanText(bible.world, 1200),
    era: cleanText(bible.era, 120),
    geography: cleanText(bible.geography, 1200),
    locations: bible.locations.map((l) => cleanText(l, 120)).filter(Boolean).slice(0, 40),
    architecture: cleanText(bible.architecture, 800),
    cinematography: cleanText(bible.cinematography, 800),
    lighting: cleanText(bible.lighting, 800),
    color: cleanText(bible.color, 800),
    atmosphere: cleanText(bible.atmosphere, 800),
    style: styleKey,
    continuityRules: bible.continuityRules.map((r) => cleanText(r, 300)).filter(Boolean).slice(0, 24),
    negativeRules: bible.negativeRules.map((r) => cleanText(r, 300)).filter(Boolean).slice(0, 24),
    entities,
  };
}

function mapClean(input: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of Object.keys(input).sort().slice(0, 12)) out[cleanText(k, 40)] = cleanText(input[k], 300);
  return out;
}

async function persistBible(params: {
  project: ProjectRecord;
  storyPlanId: string;
  bible: AiVisualBible;
  provider: string;
  model: string;
}): Promise<VisualBibleRecord> {
  const version =
    ((
      await dbGuard(() =>
        db
          .selectFrom("visual_bibles")
          .select((eb) => eb.fn.max("version").as("v"))
          .where("project_id", "=", params.project.id)
          .executeTakeFirst(),
      )
    )?.v ?? 0) + 1;

  const id = newId("vb");
  await dbGuard(() =>
    db.transaction().execute(async (trx) => {
      await trx
        .insertInto("visual_bibles")
        .values({
          id,
          project_id: params.project.id,
          story_plan_id: params.storyPlanId,
          version,
          stale: false,
          content: params.bible as unknown as Record<string, unknown>,
          content_hash: contentHash(params.bible),
          provider: params.provider,
          model: params.model,
          prompt_version: PROMPT_VERSIONS.visualBible,
        })
        .execute();

      for (const e of params.bible.entities) {
        await trx
          .insertInto("entities")
          .values({
            id: newId("ent"),
            project_id: params.project.id,
            visual_bible_id: id,
            type: e.type,
            name: e.name,
            description: e.description,
            appearance: e.appearance,
            visual_attrs: e.visualAttributes,
            continuity: e.continuityAttributes,
          })
          .onConflict((oc) =>
            oc.columns(["project_id", "name"]).doUpdateSet({
              visual_bible_id: id,
              type: e.type,
              description: e.description,
              appearance: e.appearance,
              visual_attrs: e.visualAttributes,
              continuity: e.continuityAttributes,
            }),
          )
          .execute();
      }
    }),
  );

  const record = await latestVisualBible(params.project.id);
  if (!record) throw new AppError("INTERNAL_ERROR", "The visual bible could not be saved.");
  return record;
}
