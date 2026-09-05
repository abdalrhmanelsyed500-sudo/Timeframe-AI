import { z } from "zod";

/**
 * Environment configuration schema.
 * Secrets are NEVER printed. Only presence/absence is ever reported.
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  REDIS_URL: z.string().optional(),
  STORAGE_PROVIDER: z.enum(["local", "s3"]).default("local"),
  STORAGE_ROOT: z.string().default(".tf-storage"),
  STORAGE_BUCKET: z.string().optional(),
  ENCRYPTION_KEY: z.string().optional(),
  AUTH_SECRET: z.string().min(16, "AUTH_SECRET must be at least 16 chars"),
  DEMO_MODE: z
    .string()
    .optional()
    .transform((v) => v === "true" || v === "1"),
  REAL_PROVIDER_ENABLED: z
    .string()
    .optional()
    .transform((v) => v === "true" || v === "1"),
  FFMPEG_PATH: z.string().optional(),
  FFPROBE_PATH: z.string().optional(),
  WORKER_INLINE: z
    .string()
    .optional()
    .transform((v) => v !== "false"),
  MAX_UPLOAD_BYTES: z.coerce.number().int().positive().default(200 * 1024 * 1024),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | null = null;

export function loadEnv(): Env {
  if (cached) return cached;
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`);
    throw new Error(`CONFIGURATION_ERROR: invalid environment\n - ${issues.join("\n - ")}`);
  }
  const env = parsed.data;
  if (env.NODE_ENV === "production") {
    if (env.DEMO_MODE) {
      throw new Error("CONFIGURATION_ERROR: DEMO_MODE must be disabled in production");
    }
    if (!env.ENCRYPTION_KEY) {
      throw new Error("CONFIGURATION_ERROR: ENCRYPTION_KEY is required in production");
    }
  }
  cached = env;
  return env;
}

/** Safe, secret-free report of configuration state. */
export function envReport(): Record<string, string> {
  const env = loadEnv();
  return {
    NODE_ENV: env.NODE_ENV,
    DATABASE_URL: env.DATABASE_URL ? "set" : "missing",
    REDIS_URL: env.REDIS_URL ? "set" : "missing",
    STORAGE_PROVIDER: env.STORAGE_PROVIDER,
    ENCRYPTION_KEY: env.ENCRYPTION_KEY ? "set" : "missing",
    AUTH_SECRET: env.AUTH_SECRET ? "set" : "missing",
    DEMO_MODE: String(env.DEMO_MODE),
    REAL_PROVIDER_ENABLED: String(env.REAL_PROVIDER_ENABLED),
  };
}
