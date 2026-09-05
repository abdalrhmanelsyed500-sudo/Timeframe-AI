import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool } from "pg";
import type { Database } from "./types";
import { loadEnv } from "@/lib/env";
import { AppError } from "@/lib/errors";

// pg returns BIGINT/NUMERIC as strings by default which is correct for precision.
// We keep that and convert explicitly at the edges.

declare global {
  // eslint-disable-next-line no-var
  var __tf_pool: Pool | undefined;
  // eslint-disable-next-line no-var
  var __tf_db: Kysely<Database> | undefined;
}

function createPool(): Pool {
  const env = loadEnv();
  const pool = new Pool({
    connectionString: env.DATABASE_URL,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
  pool.on("error", () => {
    // Connection-level errors are surfaced per-query; swallow here to avoid crashing the process.
  });
  return pool;
}

export function getPool(): Pool {
  if (!globalThis.__tf_pool) globalThis.__tf_pool = createPool();
  return globalThis.__tf_pool;
}

export function getDb(): Kysely<Database> {
  if (!globalThis.__tf_db) {
    globalThis.__tf_db = new Kysely<Database>({
      dialect: new PostgresDialect({ pool: getPool() }),
    });
  }
  return globalThis.__tf_db;
}

export const db = new Proxy({} as Kysely<Database>, {
  get(_t, prop) {
    const real = getDb() as unknown as Record<string | symbol, unknown>;
    const v = real[prop];
    return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(real) : v;
  },
});

/**
 * Database failures must never be silently converted into empty results.
 */
export async function dbGuard<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof AppError) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    if (/ECONNREFUSED|Connection terminated|timeout|too many clients|ENOTFOUND/i.test(msg)) {
      throw new AppError("DATABASE_ERROR", "The database is currently unavailable.", {
        context: { originalMessage: msg },
        retryable: true,
        cause: e,
      });
    }
    if (/duplicate key/i.test(msg)) {
      throw new AppError("CONFLICT", "That record already exists.", { context: { originalMessage: msg }, cause: e });
    }
    throw new AppError("DATABASE_ERROR", "A database error occurred.", {
      context: { originalMessage: msg },
      cause: e,
    });
  }
}

export async function pingDb(): Promise<boolean> {
  await sql`select 1`.execute(getDb());
  return true;
}

export { sql };
export type { Database };
