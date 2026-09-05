import { AppError } from "@/lib/errors";

/**
 * Fixed-window rate limiter. In-process by default; a Redis-backed limiter can
 * be substituted for multi-instance deployments via setRateLimitBackend().
 */
export interface RateLimitBackend {
  incr(key: string, windowMs: number): Promise<number>;
}

const memory = new Map<string, { count: number; resetAt: number }>();

const inMemoryBackend: RateLimitBackend = {
  async incr(key, windowMs) {
    const now = Date.now();
    const entry = memory.get(key);
    if (!entry || entry.resetAt <= now) {
      memory.set(key, { count: 1, resetAt: now + windowMs });
      return 1;
    }
    entry.count += 1;
    return entry.count;
  },
};

let backend: RateLimitBackend = inMemoryBackend;
export function setRateLimitBackend(b: RateLimitBackend) {
  backend = b;
}

export const LIMITS = {
  login: { limit: 10, windowMs: 5 * 60_000 },
  register: { limit: 5, windowMs: 60 * 60_000 },
  storyAnalyze: { limit: 20, windowMs: 60 * 60_000 },
  assetGenerate: { limit: 60, windowMs: 60 * 60_000 },
  render: { limit: 20, windowMs: 60 * 60_000 },
  mutation: { limit: 300, windowMs: 60_000 },
  read: { limit: 1200, windowMs: 60_000 },
} as const;

export type LimitName = keyof typeof LIMITS;

export async function rateLimit(name: LimitName, identity: string): Promise<void> {
  const { limit, windowMs } = LIMITS[name];
  const bucket = Math.floor(Date.now() / windowMs);
  const count = await backend.incr(`${name}:${identity}:${bucket}`, windowMs);
  if (count > limit) {
    throw new AppError("RATE_LIMIT_ERROR", "Too many requests. Please wait a moment and try again.", {
      context: { name, identity, count, limit },
      retryable: true,
    });
  }
}

/** Periodic cleanup so the in-memory map cannot grow unbounded. */
if (typeof setInterval === "function") {
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of memory) if (v.resetAt <= now) memory.delete(k);
  }, 60_000);
  if (typeof timer === "object" && "unref" in timer) timer.unref();
}
