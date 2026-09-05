export const ERROR_CODES = [
  "AUTH_ERROR",
  "FORBIDDEN",
  "NOT_FOUND",
  "VALIDATION_ERROR",
  "CONFLICT",
  "STATE_ERROR",
  "CONFIGURATION_ERROR",
  "DATABASE_ERROR",
  "PROVIDER_ERROR",
  "RATE_LIMIT_ERROR",
  "STORAGE_ERROR",
  "QUEUE_ERROR",
  "RENDER_ERROR",
  "QUALITY_ERROR",
  "COST_LIMIT_ERROR",
  "INTERNAL_ERROR",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

const STATUS: Record<ErrorCode, number> = {
  AUTH_ERROR: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  VALIDATION_ERROR: 400,
  CONFLICT: 409,
  STATE_ERROR: 409,
  CONFIGURATION_ERROR: 500,
  DATABASE_ERROR: 503,
  PROVIDER_ERROR: 502,
  RATE_LIMIT_ERROR: 429,
  STORAGE_ERROR: 503,
  QUEUE_ERROR: 503,
  RENDER_ERROR: 500,
  QUALITY_ERROR: 409,
  COST_LIMIT_ERROR: 402,
  INTERNAL_ERROR: 500,
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  /** Server-only diagnostic context. Never sent to clients. */
  readonly context: Record<string, unknown>;
  readonly retryable: boolean;

  constructor(
    code: ErrorCode,
    message: string,
    opts: { context?: Record<string, unknown>; retryable?: boolean; cause?: unknown } = {},
  ) {
    super(message, { cause: opts.cause });
    this.name = "AppError";
    this.code = code;
    this.status = STATUS[code];
    this.context = opts.context ?? {};
    this.retryable =
      opts.retryable ?? ["RATE_LIMIT_ERROR", "DATABASE_ERROR", "STORAGE_ERROR", "QUEUE_ERROR"].includes(code);
  }
}

export const err = (code: ErrorCode, message: string, ctx?: Record<string, unknown>) =>
  new AppError(code, message, { context: ctx });

/** Classify an unknown thrown value without leaking internals. */
export function toAppError(e: unknown): AppError {
  if (e instanceof AppError) return e;
  if (e instanceof Error) {
    return new AppError("INTERNAL_ERROR", "An unexpected internal error occurred.", {
      context: { originalMessage: e.message, stack: e.stack },
      cause: e,
    });
  }
  return new AppError("INTERNAL_ERROR", "An unexpected internal error occurred.", {
    context: { raw: String(e) },
  });
}

/** Only transient failures are retried. */
export function isTransient(e: unknown): boolean {
  const a = toAppError(e);
  return a.retryable;
}
