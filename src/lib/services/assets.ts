import { iso } from "@/lib/core/dates";
import sharp from "sharp";
import { db, dbGuard } from "@/lib/db";
import { newId } from "@/lib/core/ids";
import { sha256, contentHash } from "@/lib/core/hash";
import { AppError, isTransient } from "@/lib/errors";
import { getStorage, storageKey } from "@/lib/storage";
import { IMAGE_MIME, assertImageBuffer } from "@/lib/storage/validate";
import { getStyle } from "@/lib/domain/styles";
import type { QualityGate, VisualIntent } from "@/lib/domain/vocab";
import { buildVisualSpecification, compilePrompt } from "@/lib/visual/prompt-compiler";
import { resolveProvider } from "@/lib/ai/factory";
import { estimateCost, nearestSupportedSize } from "@/lib/ai/registry";
import { AiVisionQcSchema } from "@/lib/story/schema";
import { parseAiJson } from "@/lib/ai/json";
import { PROMPT_VERSIONS, visionQcSystemPrompt, visionQcUserPrompt } from "@/lib/ai/prompts";
import { preflight, recordCost } from "./cost";
import { audit } from "./audit";
import { markTimelinesStale } from "./stale";
import { trackStorage } from "./storage-usage";
import { latestVisualBible } from "./visual-bible";
import { allShots, latestStoryPlan, type ShotRecord } from "./story";
import type { ProjectRecord } from "./projects";

/** Maximum automatic regeneration attempts before a human is asked to look. */
export const MAX_AUTO_ATTEMPTS = 2;
const THUMB_WIDTH = 400;

export interface AssetVersionRecord {
  id: string;
  assetId: string;
  version: number;
  storageKey: string;
  thumbKey: string | null;
  mime: string;
  width: number;
  height: number;
  bytes: number;
  contentHash: string;
  provider: string;
  model: string;
  isMock: boolean;
  prompt: string;
  promptVersion: string;
  qcGate: QualityGate | null;
  qcScore: number | null;
  qcReport: Record<string, unknown> | null;
  createdAt: string;
}

export interface AssetRecord {
  id: string;
  projectId: string;
  shotId: string;
  status: string;
  attempts: number;
  selectedVersionId: string | null;
  versions: AssetVersionRecord[];
}

export async function listAssets(
  projectId: string,
  opts: { limit?: number; offset?: number; status?: string } = {},
): Promise<{ items: (AssetRecord & { shot: ShotRecord | null })[]; total: number }> {
  const limit = Math.min(200, Math.max(1, opts.limit ?? 60));
  const offset = Math.max(0, opts.offset ?? 0);

  let baseQuery = db
    .selectFrom("assets")
    .innerJoin("shots", "shots.id", "assets.shot_id")
    .select([
      "assets.id as id",
      "assets.project_id as project_id",
      "assets.shot_id as shot_id",
      "assets.status as status",
      "assets.attempts as attempts",
      "assets.selected_version_id as selected_version_id",
      "shots.start_ms as start_ms",
    ])
    .where("assets.project_id", "=", projectId);
  if (opts.status) baseQuery = baseQuery.where("assets.status", "=", opts.status);

  const rows = await dbGuard(() => baseQuery.orderBy("shots.start_ms").limit(limit).offset(offset).execute());

  let countQuery = db
    .selectFrom("assets")
    .select((eb) => eb.fn.countAll<string>().as("c"))
    .where("project_id", "=", projectId);
  if (opts.status) countQuery = countQuery.where("status", "=", opts.status);
  const total = Number((await dbGuard(() => countQuery.executeTakeFirst()))?.c ?? 0);

  const assetIds = rows.map((r) => r.id);
  const versions = assetIds.length
    ? await dbGuard(() =>
        db.selectFrom("asset_versions").selectAll().where("asset_id", "in", assetIds).orderBy("version", "desc").execute(),
      )
    : [];
  const byAsset = new Map<string, AssetVersionRecord[]>();
  for (const v of versions) {
    const list = byAsset.get(v.asset_id) ?? [];
    list.push(toVersion(v));
    byAsset.set(v.asset_id, list);
  }

  const shotIds = rows.map((r) => r.shot_id);
  const shots = shotIds.length
    ? await dbGuard(() => db.selectFrom("shots").selectAll().where("id", "in", shotIds).execute())
    : [];
  const shotMap = new Map(shots.map((s) => [s.id, s]));

  return {
    items: rows.map((r) => {
      const s = shotMap.get(r.shot_id);
      return {
        id: r.id,
        projectId: r.project_id,
        shotId: r.shot_id,
        status: r.status,
        attempts: r.attempts,
        selectedVersionId: r.selected_version_id,
        versions: byAsset.get(r.id) ?? [],
        shot: s
          ? ({
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
            } satisfies ShotRecord)
          : null,
      };
    }),
    total,
  };
}

function toVersion(v: {
  id: string;
  asset_id: string;
  version: number;
  storage_key: string;
  thumb_key: string | null;
  mime: string;
  width: number;
  height: number;
  bytes: string | number;
  content_hash: string;
  provider: string;
  model: string;
  is_mock: boolean;
  prompt: string;
  prompt_version: string;
  qc_gate: string | null;
  qc_score: number | null;
  qc_report: unknown;
  created_at: unknown;
}): AssetVersionRecord {
  return {
    id: v.id,
    assetId: v.asset_id,
    version: v.version,
    storageKey: v.storage_key,
    thumbKey: v.thumb_key,
    mime: v.mime,
    width: v.width,
    height: v.height,
    bytes: Number(v.bytes),
    contentHash: v.content_hash,
    provider: v.provider,
    model: v.model,
    isMock: v.is_mock,
    prompt: v.prompt,
    promptVersion: v.prompt_version,
    qcGate: v.qc_gate as QualityGate | null,
    qcScore: v.qc_score,
    qcReport: (v.qc_report ?? null) as Record<string, unknown> | null,
    createdAt: iso(v.created_at),
  };
}

export async function assetStats(projectId: string) {
  const rows = await dbGuard(() =>
    db
      .selectFrom("assets")
      .select(["status", (eb) => eb.fn.countAll<string>().as("c")])
      .where("project_id", "=", projectId)
      .groupBy("status")
      .execute(),
  );
  const byStatus: Record<string, number> = {};
  let total = 0;
  for (const r of rows) {
    byStatus[r.status] = Number(r.c);
    total += Number(r.c);
  }
  const selected = Number(
    (
      await dbGuard(() =>
        db
          .selectFrom("assets")
          .select((eb) => eb.fn.countAll<string>().as("c"))
          .where("project_id", "=", projectId)
          .where("selected_version_id", "is not", null)
          .executeTakeFirst(),
      )
    )?.c ?? 0,
  );
  return { total, selected, byStatus };
}

/** Build (and cache) the visual specification + canonical prompt for a shot. */
export async function ensureVisualSpec(project: ProjectRecord, shot: ShotRecord) {
  const existing = await dbGuard(() => db.selectFrom("visual_specs").selectAll().where("shot_id", "=", shot.id).executeTakeFirst());
  const style = getStyle(project.styleKey);
  const bible = await latestVisualBible(project.id);

  const entityRefs = (bible?.entities ?? [])
    .filter((e) => shot.entityNames.some((n) => n.toLowerCase() === e.name.toLowerCase()))
    .slice(0, 4)
    .map((e) => ({
      name: e.name,
      appearance: e.appearance,
      continuity: Object.values(e.continuityAttributes).filter((v): v is string => typeof v === "string").join(" "),
    }));

  const spec = buildVisualSpecification({
    shotId: shot.id,
    visualIntent: shot.visualIntent,
    subject: shot.subject,
    action: shot.action,
    environment: shot.environment || bible?.content.geography || "",
    era: bible?.content.era ?? "",
    composition: shot.composition,
    camera: shot.camera as never,
    lens: shot.lens as never,
    lighting: shot.lighting || bible?.content.lighting || "",
    color: shot.color || bible?.content.color || "",
    atmosphere: shot.atmosphere || bible?.content.atmosphere || "",
    entities: entityRefs,
    style,
    aspectRatio: project.aspectRatio,
    bibleNegativeRules: bible?.content.negativeRules,
  });
  const compiled = compilePrompt(spec, style);

  if (existing && existing.content_hash === compiled.hash) {
    return { spec, compiled };
  }

  await dbGuard(() =>
    db
      .insertInto("visual_specs")
      .values({
        id: existing?.id ?? newId("vspec"),
        project_id: project.id,
        shot_id: shot.id,
        spec: spec as unknown as Record<string, unknown>,
        canonical_prompt: compiled.canonical,
        negative_prompt: compiled.negative,
        prompt_version: compiled.promptVersion,
        content_hash: compiled.hash,
      })
      .onConflict((oc) =>
        oc.column("shot_id").doUpdateSet({
          spec: spec as unknown as Record<string, unknown>,
          canonical_prompt: compiled.canonical,
          negative_prompt: compiled.negative,
          prompt_version: compiled.promptVersion,
          content_hash: compiled.hash,
        }),
      )
      .execute(),
  );

  return { spec, compiled };
}

async function ensureAsset(projectId: string, shotId: string): Promise<string> {
  const existing = await dbGuard(() =>
    db.selectFrom("assets").select(["id"]).where("shot_id", "=", shotId).where("kind", "=", "IMAGE").executeTakeFirst(),
  );
  if (existing) return existing.id;
  const id = newId("asset");
  await dbGuard(() =>
    db
      .insertInto("assets")
      .values({ id, project_id: projectId, shot_id: shotId, kind: "IMAGE", status: "PENDING" })
      .onConflict((oc) => oc.columns(["shot_id", "kind"]).doNothing())
      .execute(),
  );
  const row = await dbGuard(() =>
    db.selectFrom("assets").select(["id"]).where("shot_id", "=", shotId).where("kind", "=", "IMAGE").executeTakeFirstOrThrow(),
  );
  return row.id;
}

export interface GenerateResult {
  assetId: string;
  versionId: string;
  gate: QualityGate;
  score: number;
  isMock: boolean;
  attempts: number;
}

/**
 * Generate → normalise → validate → store → thumbnail → Vision QC → version.
 * On a failing gate the asset is regenerated automatically, at most
 * MAX_AUTO_ATTEMPTS times, then handed to a human as NEEDS_REVIEW.
 */
export async function generateAssetForShot(params: {
  project: ProjectRecord;
  userId: string;
  shot: ShotRecord;
  force?: boolean;
  signal?: AbortSignal;
}): Promise<GenerateResult> {
  const { project, userId, shot } = params;
  const assetId = await ensureAsset(project.id, shot.id);
  const { spec, compiled } = await ensureVisualSpec(project, shot);
  const style = getStyle(project.styleKey);

  const existing = await dbGuard(() =>
    db.selectFrom("assets").selectAll().where("id", "=", assetId).executeTakeFirstOrThrow(),
  );

  // Idempotency: an accepted asset built from an identical prompt is not redone.
  if (!params.force && existing.selected_version_id) {
    const selected = await dbGuard(() =>
      db.selectFrom("asset_versions").selectAll().where("id", "=", existing.selected_version_id).executeTakeFirst(),
    );
    if (selected && selected.prompt === compiled.canonical) {
      const v = toVersion(selected);
      return { assetId, versionId: v.id, gate: (v.qcGate ?? "PASS") as QualityGate, score: v.qcScore ?? 1, isMock: v.isMock, attempts: existing.attempts };
    }
  }

  const imageResolved = await resolveProvider("image", { userId, preset: project.qualityPreset });
  if (!imageResolved.image) throw new AppError("CONFIGURATION_ERROR", "No image model is available.");
  const size = nearestSupportedSize(imageResolved.spec, project.width, project.height);

  await preflight({
    userId,
    projectId: project.id,
    estimate: estimateCost(imageResolved.spec, 1),
    isMock: imageResolved.mode === "demo",
  });

  await dbGuard(() => db.updateTable("assets").set({ status: "GENERATING" }).where("id", "=", assetId).execute());

  let lastResult: GenerateResult | null = null;
  let attempts = 0;

  for (let attempt = 0; attempt < MAX_AUTO_ATTEMPTS; attempt++) {
    if (params.signal?.aborted) throw new AppError("RENDER_ERROR", "Generation was cancelled.");
    attempts++;

    const image = await imageResolved.image.generateImage({
      prompt: compiled.canonical,
      negativePrompt: compiled.negative,
      width: size.width,
      height: size.height,
      // Attempt index varies the seed so a retry is not byte-identical.
      seed: `${project.id}:${shot.id}:${compiled.hash}:${attempt}`,
    });

    assertImageBuffer(image.data);

    // Normalise to the project's exact frame geometry.
    const normalized = await sharp(image.data)
      .resize(project.width, project.height, { fit: "cover", position: "attention" })
      .png({ compressionLevel: 9 })
      .toBuffer();
    const meta = await sharp(normalized).metadata();
    if (!meta.width || !meta.height) throw new AppError("PROVIDER_ERROR", "The generated image could not be read.");

    const hash = sha256(normalized);
    const key = storageKey({ projectId: project.id, category: "assets", scope: shot.id, contentHash: hash, ext: "png" });
    await getStorage().put(key, normalized, IMAGE_MIME.png);

    const thumb = await sharp(normalized).resize(THUMB_WIDTH).webp({ quality: 78 }).toBuffer();
    const thumbKey = storageKey({ projectId: project.id, category: "thumbs", scope: shot.id, contentHash: hash, ext: "webp" });
    await getStorage().put(thumbKey, thumb, "image/webp");

    await trackStorage({ key, userId, projectId: project.id, category: "asset", bytes: normalized.byteLength, mime: IMAGE_MIME.png });
    await trackStorage({ key: thumbKey, userId, projectId: project.id, category: "thumb", bytes: thumb.byteLength, mime: "image/webp" });

    const qc = await runVisionQc({
      project,
      userId,
      image: normalized,
      canonicalPrompt: compiled.canonical,
      styleName: style.name,
      shotIntent: spec.visualIntent,
      seed: hash,
    });

    const nextVersion =
      ((
        await dbGuard(() =>
          db
            .selectFrom("asset_versions")
            .select((eb) => eb.fn.max("version").as("v"))
            .where("asset_id", "=", assetId)
            .executeTakeFirst(),
        )
      )?.v ?? 0) + 1;

    const versionId = newId("av");
    await dbGuard(() =>
      db
        .insertInto("asset_versions")
        .values({
          id: versionId,
          asset_id: assetId,
          version: nextVersion,
          storage_key: key,
          thumb_key: thumbKey,
          mime: IMAGE_MIME.png,
          width: meta.width,
          height: meta.height,
          bytes: normalized.byteLength,
          content_hash: hash,
          provider: image.provider,
          model: image.model,
          is_mock: image.isMock,
          prompt: compiled.canonical,
          prompt_version: compiled.promptVersion,
          qc_gate: qc.gate,
          qc_score: qc.score,
          qc_report: qc.report,
        })
        .execute(),
    );

    await recordCost({
      userId,
      projectId: project.id,
      operationId: `asset:${versionId}`,
      operationType: "ASSET_GENERATE",
      estimate: estimateCost(imageResolved.spec, 1),
      isMock: image.isMock,
    });

    lastResult = { assetId, versionId, gate: qc.gate, score: qc.score, isMock: image.isMock, attempts };

    if (qc.gate === "PASS" || qc.gate === "WARNINGS") {
      await dbGuard(() =>
        db.updateTable("assets").set({ status: "READY", selected_version_id: versionId, attempts }).where("id", "=", assetId).execute(),
      );
      await markTimelinesStale(project.id);
      return lastResult;
    }
    // FAIL / NEEDS_REVIEW → try once more, up to the cap.
  }

  if (!lastResult) throw new AppError("PROVIDER_ERROR", "Image generation produced no result.");

  // Exhausted automatic attempts: keep the best version, flag for a human.
  const best = await dbGuard(() =>
    db.selectFrom("asset_versions").selectAll().where("asset_id", "=", assetId).orderBy("qc_score", "desc").executeTakeFirst(),
  );
  await dbGuard(() =>
    db
      .updateTable("assets")
      .set({ status: "NEEDS_REVIEW", selected_version_id: best?.id ?? lastResult.versionId, attempts })
      .where("id", "=", assetId)
      .execute(),
  );
  await markTimelinesStale(project.id);
  return { ...lastResult, gate: "NEEDS_REVIEW" };
}

async function runVisionQc(params: {
  project: ProjectRecord;
  userId: string;
  image: Buffer;
  canonicalPrompt: string;
  styleName: string;
  shotIntent: string;
  seed: string;
}): Promise<{ gate: QualityGate; score: number; report: Record<string, unknown> }> {
  try {
    const resolved = await resolveProvider("vision", { userId: params.userId, preset: params.project.qualityPreset });
    if (!resolved.vision) throw new AppError("CONFIGURATION_ERROR", "No vision model is available.");

    const response = await resolved.vision.analyzeImage({
      image: params.image,
      mime: "image/png",
      system: visionQcSystemPrompt(),
      user: visionQcUserPrompt({
        canonicalPrompt: params.canonicalPrompt,
        styleName: params.styleName,
        shotIntent: params.shotIntent,
      }),
      seed: params.seed,
    });

    const parsed = parseAiJson(response.text, AiVisionQcSchema, "the quality control report");
    const values = Object.values(parsed.scores).map((v) => Math.max(0, Math.min(1, Number(v) || 0)));
    const score = values.reduce((a, b) => a + b, 0) / values.length;

    const gate: QualityGate =
      score < 0.5 || parsed.recommendation === "REGENERATE"
        ? "FAIL"
        : score < 0.68 || parsed.recommendation === "REVIEW"
          ? "NEEDS_REVIEW"
          : parsed.issues.length > 0 || parsed.artifacts.length > 0
            ? "WARNINGS"
            : "PASS";

    await recordCost({
      userId: params.userId,
      projectId: params.project.id,
      operationId: `qc:${params.seed.slice(0, 16)}`,
      operationType: "ASSET_QC",
      estimate: estimateCost(resolved.spec, 1),
      isMock: resolved.mode === "demo",
    });

    return {
      gate,
      score: Math.round(score * 1000) / 1000,
      report: {
        promptVersion: PROMPT_VERSIONS.visionQc,
        provider: response.provider,
        model: response.model,
        isMock: response.isMock,
        scores: parsed.scores,
        issues: parsed.issues,
        artifacts: parsed.artifacts,
        recommendation: parsed.recommendation,
      },
    };
  } catch (e) {
    // QC failure must not be reported as a pass. The asset is flagged for review.
    return {
      gate: "NEEDS_REVIEW",
      score: 0.5,
      report: {
        promptVersion: PROMPT_VERSIONS.visionQc,
        error: e instanceof AppError ? e.code : "INTERNAL_ERROR",
        message: "Quality control could not be completed for this image.",
        retryable: isTransient(e),
      },
    };
  }
}

export async function selectAssetVersion(params: {
  projectId: string;
  assetId: string;
  versionId: string;
  userId: string;
}): Promise<void> {
  const asset = await dbGuard(() =>
    db.selectFrom("assets").selectAll().where("id", "=", params.assetId).where("project_id", "=", params.projectId).executeTakeFirst(),
  );
  if (!asset) throw new AppError("NOT_FOUND", "That asset does not exist.");
  const version = await dbGuard(() =>
    db.selectFrom("asset_versions").selectAll().where("id", "=", params.versionId).where("asset_id", "=", params.assetId).executeTakeFirst(),
  );
  if (!version) throw new AppError("NOT_FOUND", "That asset version does not exist.");
  // Data integrity: never select a version whose file is missing.
  if (!(await getStorage().exists(version.storage_key))) {
    throw new AppError("STORAGE_ERROR", "The image file for that version is missing from storage.");
  }

  await dbGuard(() =>
    db.updateTable("assets").set({ selected_version_id: params.versionId, status: "READY" }).where("id", "=", params.assetId).execute(),
  );
  await markTimelinesStale(params.projectId);
  await audit({ userId: params.userId, projectId: params.projectId, action: "asset.selected", targetId: params.assetId });
}

/** Shots that still need an image. Used to plan a batch. */
export async function pendingShots(projectId: string, opts: { regenerateFailed?: boolean } = {}): Promise<ShotRecord[]> {
  const shots = await allShots(projectId);
  const assets = await dbGuard(() => db.selectFrom("assets").selectAll().where("project_id", "=", projectId).execute());
  const byShot = new Map(assets.map((a) => [a.shot_id, a]));
  return shots.filter((s) => {
    const a = byShot.get(s.id);
    if (!a) return true;
    if (!a.selected_version_id) return true;
    if (opts.regenerateFailed && a.status === "NEEDS_REVIEW") return true;
    return false;
  });
}

export async function assetsReadyReport(projectId: string) {
  const plan = await latestStoryPlan(projectId);
  const totalShots = plan?.shotCount ?? 0;
  const stats = await assetStats(projectId);
  return {
    totalShots,
    generated: stats.total,
    selected: stats.selected,
    needsReview: stats.byStatus.NEEDS_REVIEW ?? 0,
    complete: totalShots > 0 && stats.selected >= totalShots,
  };
}

export function assetContentHashes(versions: AssetVersionRecord[]): string {
  return contentHash(versions.map((v) => v.contentHash).sort());
}
