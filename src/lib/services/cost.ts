import { iso } from "@/lib/core/dates";
import { db, dbGuard, sql } from "@/lib/db";
import { newId } from "@/lib/core/ids";
import { AppError } from "@/lib/errors";
import type { CostEstimate } from "@/lib/ai/registry";

/**
 * Cost accounting.
 *
 * We record ESTIMATES computed from published list prices. We never claim an
 * actual billed amount, because providers do not return per-request billing.
 * `basis` distinguishes ESTIMATED from RECORDED for every row.
 */

export const DEFAULT_LIMITS = {
  dailyUsd: 25,
  projectUsd: 50,
  batchSize: 250,
} as const;

export async function recordCost(params: {
  userId: string;
  projectId: string | null;
  operationId: string;
  operationType: string;
  estimate: CostEstimate;
  isMock: boolean;
  status?: string;
}): Promise<void> {
  await dbGuard(() =>
    db
      .insertInto("cost_records")
      .values({
        id: newId("cost"),
        user_id: params.userId,
        project_id: params.projectId,
        operation_id: params.operationId,
        provider: params.estimate.provider,
        model: params.estimate.model,
        operation_type: params.operationType,
        units: params.estimate.units,
        estimated_cost: params.isMock ? 0 : params.estimate.estimatedCostUsd,
        recorded_cost: null,
        currency: "USD",
        // Demo output costs nothing and is labelled as such.
        basis: params.isMock ? "MOCK_NO_COST" : "ESTIMATED",
        status: params.status ?? "OK",
      })
      .execute(),
  );
}

export interface CostSummary {
  todayUsd: number;
  projectUsd: number;
  totalUsd: number;
  operations: number;
  basisNote: string;
}

export async function costSummary(userId: string, projectId?: string): Promise<CostSummary> {
  const [today, project, total] = await dbGuard(() =>
    Promise.all([
      db
        .selectFrom("cost_records")
        .select(sql<string>`coalesce(sum(estimated_cost),0)`.as("sum"))
        .where("user_id", "=", userId)
        .where(sql<boolean>`created_at >= date_trunc('day', now())`)
        .executeTakeFirst(),
      projectId
        ? db
            .selectFrom("cost_records")
            .select(sql<string>`coalesce(sum(estimated_cost),0)`.as("sum"))
            .where("user_id", "=", userId)
            .where("project_id", "=", projectId)
            .executeTakeFirst()
        : Promise.resolve({ sum: "0" }),
      db
        .selectFrom("cost_records")
        .select([sql<string>`coalesce(sum(estimated_cost),0)`.as("sum"), sql<string>`count(*)`.as("n")])
        .where("user_id", "=", userId)
        .executeTakeFirst(),
    ]),
  );
  return {
    todayUsd: Number(today?.sum ?? 0),
    projectUsd: Number(project?.sum ?? 0),
    totalUsd: Number(total?.sum ?? 0),
    operations: Number(total?.n ?? 0),
    basisNote: "Figures are estimates based on published provider list prices, not actual billed amounts.",
  };
}

export async function listCostRecords(userId: string, opts: { projectId?: string; limit?: number; offset?: number } = {}) {
  const limit = Math.min(200, Math.max(1, opts.limit ?? 50));
  const offset = Math.max(0, opts.offset ?? 0);
  let q = db.selectFrom("cost_records").selectAll().where("user_id", "=", userId);
  if (opts.projectId) q = q.where("project_id", "=", opts.projectId);
  const rows = await dbGuard(() => q.orderBy("created_at", "desc").limit(limit).offset(offset).execute());
  return rows.map((r) => ({
    id: r.id,
    projectId: r.project_id,
    provider: r.provider,
    model: r.model,
    operationType: r.operation_type,
    units: r.units,
    estimatedCost: Number(r.estimated_cost),
    basis: r.basis,
    status: r.status,
    createdAt: iso(r.created_at),
  }));
}

/** Preflight → estimate → quota check → execute. */
export async function preflight(params: {
  userId: string;
  projectId: string | null;
  estimate: CostEstimate;
  isMock: boolean;
  batchSize?: number;
  limits?: Partial<typeof DEFAULT_LIMITS>;
}): Promise<{ estimatedCostUsd: number; withinLimits: true }> {
  const limits = { ...DEFAULT_LIMITS, ...params.limits };
  if (params.batchSize !== undefined && params.batchSize > limits.batchSize) {
    throw new AppError("VALIDATION_ERROR", `A single batch is limited to ${limits.batchSize} items.`);
  }
  // Demo output costs nothing, so quota checks do not apply.
  if (params.isMock) return { estimatedCostUsd: 0, withinLimits: true };

  const summary = await costSummary(params.userId, params.projectId ?? undefined);
  const cost = params.estimate.estimatedCostUsd;
  if (summary.todayUsd + cost > limits.dailyUsd) {
    throw new AppError(
      "COST_LIMIT_ERROR",
      `This would exceed your daily spending limit of $${limits.dailyUsd.toFixed(2)}. You have used about $${summary.todayUsd.toFixed(2)} today.`,
      { context: { todayUsd: summary.todayUsd, cost } },
    );
  }
  if (params.projectId && summary.projectUsd + cost > limits.projectUsd) {
    throw new AppError(
      "COST_LIMIT_ERROR",
      `This would exceed the per-project limit of $${limits.projectUsd.toFixed(2)}.`,
      { context: { projectUsd: summary.projectUsd, cost } },
    );
  }
  return { estimatedCostUsd: cost, withinLimits: true };
}
