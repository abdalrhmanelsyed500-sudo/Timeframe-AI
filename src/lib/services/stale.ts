import { db, dbGuard } from "@/lib/db";

/**
 * Dependency graph:
 *   audio  → transcript → story → visual bible → assets → timeline → QA/render
 *
 * When an upstream artefact changes, downstream artefacts are marked STALE.
 * They are never deleted — history stays inspectable and recoverable.
 */

export async function markStoryStale(projectId: string): Promise<void> {
  await dbGuard(async () => {
    await db.updateTable("story_plans").set({ stale: true }).where("project_id", "=", projectId).execute();
    await db.updateTable("visual_bibles").set({ stale: true }).where("project_id", "=", projectId).execute();
    await db.updateTable("timelines").set({ stale: true }).where("project_id", "=", projectId).execute();
  });
}

export async function markVisualsStale(projectId: string): Promise<void> {
  await dbGuard(async () => {
    await db.updateTable("visual_bibles").set({ stale: true }).where("project_id", "=", projectId).execute();
    await db.updateTable("timelines").set({ stale: true }).where("project_id", "=", projectId).execute();
  });
}

export async function markTimelinesStale(projectId: string): Promise<void> {
  await dbGuard(() => db.updateTable("timelines").set({ stale: true }).where("project_id", "=", projectId).execute());
}

export interface StaleReport {
  storyStale: boolean;
  visualBibleStale: boolean;
  timelineStale: boolean;
  reasons: string[];
}

export async function staleReport(projectId: string): Promise<StaleReport> {
  const [story, bible, timeline] = await dbGuard(() =>
    Promise.all([
      db
        .selectFrom("story_plans")
        .select(["stale"])
        .where("project_id", "=", projectId)
        .orderBy("version", "desc")
        .executeTakeFirst(),
      db
        .selectFrom("visual_bibles")
        .select(["stale"])
        .where("project_id", "=", projectId)
        .orderBy("version", "desc")
        .executeTakeFirst(),
      db
        .selectFrom("timelines")
        .select(["stale"])
        .where("project_id", "=", projectId)
        .orderBy("version", "desc")
        .executeTakeFirst(),
    ]),
  );

  const reasons: string[] = [];
  if (story?.stale) reasons.push("The transcript or audio changed after the story was analysed.");
  if (bible?.stale) reasons.push("The story changed after the visual bible was generated.");
  if (timeline?.stale) reasons.push("The story or assets changed after the timeline was built.");

  return {
    storyStale: Boolean(story?.stale),
    visualBibleStale: Boolean(bible?.stale),
    timelineStale: Boolean(timeline?.stale),
    reasons,
  };
}
