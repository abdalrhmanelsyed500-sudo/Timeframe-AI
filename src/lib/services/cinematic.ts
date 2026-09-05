import { iso } from "@/lib/core/dates";
import { db, dbGuard } from "@/lib/db";
import { newId } from "@/lib/core/ids";
import { AppError } from "@/lib/errors";
import { getStyle } from "@/lib/domain/styles";
import type { QualityGate } from "@/lib/domain/vocab";
import { analyzeTimeline, type AnalysisResult, type Dimension } from "@/lib/cinematic/analyze";
import { validateTimeline } from "@/lib/timeline/validate";
import { audit } from "./audit";
import { advanceStatus, type ProjectRecord } from "./projects";
import { latestTimeline, saveVersion, type TimelineRecord } from "./timeline";

export interface StoredIssue {
  id: string;
  code: string;
  severity: string;
  message: string;
  shotId: string | null;
  sceneId: string | null;
  fixSafe: boolean;
  fix: { field: string; value: string; reason: string } | null;
}

export interface CinematicReportRecord {
  id: string;
  projectId: string;
  timelineId: string;
  overallScore: number;
  gate: QualityGate;
  dimensions: Record<Dimension, number>;
  issues: StoredIssue[];
  createdAt: string;
}

export async function latestReport(projectId: string): Promise<CinematicReportRecord | null> {
  const row = await dbGuard(() =>
    db.selectFrom("cinematic_reports").selectAll().where("project_id", "=", projectId).orderBy("created_at", "desc").executeTakeFirst(),
  );
  if (!row) return null;
  const issues = await dbGuard(() => db.selectFrom("cinematic_issues").selectAll().where("report_id", "=", row.id).execute());
  return {
    id: row.id,
    projectId: row.project_id,
    timelineId: row.timeline_id,
    overallScore: row.overall_score,
    gate: row.gate as QualityGate,
    dimensions: row.dimensions as unknown as Record<Dimension, number>,
    issues: issues.map((i) => ({
      id: i.id,
      code: i.code,
      severity: i.severity,
      message: i.message,
      shotId: i.shot_id,
      sceneId: i.scene_id,
      fixSafe: i.fix_safe,
      fix: (i.fix ?? null) as { field: string; value: string; reason: string } | null,
    })),
    createdAt: iso(row.created_at),
  };
}

export async function runCinematicAnalysis(params: { project: ProjectRecord; userId: string }): Promise<CinematicReportRecord> {
  const timeline = await latestTimeline(params.project.id);
  if (!timeline) throw new AppError("STATE_ERROR", "Build a timeline before running cinematic QA.");

  const analysis = await analyzeCurrent(params.project, timeline);
  const reportId = newId("cqa");

  await dbGuard(() =>
    db.transaction().execute(async (trx) => {
      await trx
        .insertInto("cinematic_reports")
        .values({
          id: reportId,
          project_id: params.project.id,
          timeline_id: timeline.id,
          overall_score: analysis.overallScore,
          gate: analysis.gate,
          dimensions: analysis.dimensions,
        })
        .execute();

      if (analysis.issues.length) {
        const rows = analysis.issues.map((i) => ({
          id: newId("iss"),
          report_id: reportId,
          code: i.code,
          severity: i.severity,
          message: i.message,
          shot_id: i.shotId ?? null,
          scene_id: i.sceneId ?? null,
          fix_safe: i.fixSafe,
          fix: (i.fix ?? null) as unknown as Record<string, unknown> | null,
        }));
        for (let i = 0; i < rows.length; i += 300) {
          await trx.insertInto("cinematic_issues").values(rows.slice(i, i + 300)).execute();
        }
      }
    }),
  );

  await advanceStatus(params.project, "QUALITY_REVIEW");
  await audit({
    userId: params.userId,
    projectId: params.project.id,
    action: "qa.analyzed",
    metadata: { gate: analysis.gate, score: analysis.overallScore, issues: analysis.issues.length },
  });

  const record = await latestReport(params.project.id);
  if (!record) throw new AppError("INTERNAL_ERROR", "The QA report could not be saved.");
  return record;
}

async function analyzeCurrent(project: ProjectRecord, timeline: TimelineRecord): Promise<AnalysisResult> {
  const style = getStyle(project.styleKey);
  const rows = await dbGuard(() =>
    db
      .selectFrom("assets")
      .leftJoin("asset_versions", "asset_versions.id", "assets.selected_version_id")
      .select([
        "assets.shot_id as shot_id",
        "asset_versions.qc_score as qc_score",
        "asset_versions.qc_gate as qc_gate",
        "asset_versions.content_hash as content_hash",
      ])
      .where("assets.project_id", "=", project.id)
      .execute(),
  );

  const analysis = analyzeTimeline({
    doc: timeline.doc,
    style,
    assetQuality: rows.map((r) => ({
      shotId: r.shot_id,
      qcScore: r.qc_score,
      qcGate: r.qc_gate,
      contentHash: r.content_hash,
    })),
  });

  // Structural timeline violations are surfaced as QA issues too.
  const validation = validateTimeline(timeline.doc);
  if (!validation.valid) {
    for (const v of validation.blocking) {
      analysis.issues.push({
        code: v.code === "MISSING_ASSET" ? "LOW_ASSET_QUALITY" : "CONTINUITY_BREAK",
        severity: "ERROR",
        message: v.message,
        shotId: v.shotId,
        fixSafe: false,
      });
    }
    analysis.gate = "FAIL";
  }
  return analysis;
}

/**
 * Apply only fixes marked safe. Each application creates a NEW timeline version
 * and records a before/after audit trail.
 */
export async function applySafeFixes(params: { project: ProjectRecord; userId: string; issueIds?: string[] }): Promise<{
  timeline: TimelineRecord;
  applied: { issueId: string; reason: string }[];
  skipped: number;
}> {
  const report = await latestReport(params.project.id);
  if (!report) throw new AppError("STATE_ERROR", "Run cinematic QA before applying fixes.");
  const timeline = await latestTimeline(params.project.id);
  if (!timeline || timeline.id !== report.timelineId) {
    throw new AppError("STATE_ERROR", "The timeline changed since this QA report. Re-run cinematic QA.");
  }

  const wanted = params.issueIds?.length ? new Set(params.issueIds) : null;
  const candidates = report.issues.filter((i) => i.fixSafe && i.fix && i.shotId && (!wanted || wanted.has(i.id)));
  const skipped = report.issues.filter((i) => !i.fixSafe).length;
  if (candidates.length === 0) {
    return { timeline, applied: [], skipped };
  }

  const clips = timeline.doc.clips.map((c) => ({ ...c }));
  const applied: { issueId: string; reason: string }[] = [];
  const fixRows: {
    id: string;
    report_id: string;
    issue_id: string;
    before_value: unknown;
    after_value: unknown;
    reason: string;
  }[] = [];

  for (const issue of candidates) {
    const clip = clips.find((c) => c.shotId === issue.shotId);
    if (!clip || !issue.fix) continue;
    const field = issue.fix.field as "motion" | "transitionIn";
    const before = clip[field];
    if (before === issue.fix.value) continue;
    if (field === "motion") clip.motion = issue.fix.value as typeof clip.motion;
    else {
      clip.transitionIn = issue.fix.value as typeof clip.transitionIn;
      if (clip.transitionIn === "CUT") clip.transitionMs = 0;
    }
    applied.push({ issueId: issue.id, reason: issue.fix.reason });
    fixRows.push({
      id: newId("fix"),
      report_id: report.id,
      issue_id: issue.id,
      before_value: { [field]: before },
      after_value: { [field]: issue.fix.value },
      reason: issue.fix.reason,
    });
  }

  if (applied.length === 0) return { timeline, applied: [], skipped };

  const newTimeline = await saveVersion({
    project: params.project,
    doc: { ...timeline.doc, clips },
    status: "DRAFT",
    parentVersion: timeline.version,
  });

  await dbGuard(() =>
    db
      .insertInto("cinematic_fixes")
      .values(
        fixRows.map((f) => ({
          ...f,
          before_value: f.before_value as Record<string, unknown>,
          after_value: f.after_value as Record<string, unknown>,
        })),
      )
      .execute(),
  );
  await audit({
    userId: params.userId,
    projectId: params.project.id,
    action: "qa.fixes_applied",
    metadata: { applied: applied.length, skipped, newVersion: newTimeline.version },
  });

  return { timeline: newTimeline, applied, skipped };
}
