import { NextResponse } from "next/server";
import type { ZodType } from "zod";
import { AppError, toAppError } from "@/lib/errors";
import { requestId as newRequestId } from "@/lib/core/ids";
import { assertCsrf, requireUser, type SessionUser } from "@/lib/security/auth";
import { rateLimit, type LimitName } from "@/lib/security/rate-limit";
import { recordError } from "@/lib/services/audit";
import { loadEnv } from "@/lib/env";

/**
 * Every protected operation follows: Authenticate → Authorize → Validate → Execute.
 * Errors are returned in one consistent shape and never leak stack traces.
 */
export interface ApiContext<TBody = unknown> {
  user: SessionUser;
  body: TBody;
  requestId: string;
  request: Request;
  params: Record<string, string>;
  searchParams: URLSearchParams;
}

export interface HandlerOptions<TBody> {
  auth?: boolean;
  csrf?: boolean;
  schema?: ZodType<TBody>;
  rateLimit?: LimitName;
}

/**
 * Next.js 15 always passes a context object whose `params` is a promise.
 * Routes with no dynamic segments receive an empty record.
 */
type RouteContext = { params: Promise<Record<string, string>> };

export function apiHandler<TBody = unknown>(
  options: HandlerOptions<TBody>,
  fn: (ctx: ApiContext<TBody>) => Promise<unknown>,
) {
  return async (request: Request, route: RouteContext): Promise<Response> => {
    const requestId = newRequestId();
    let user: SessionUser | null = null;
    try {
      if (options.csrf !== false) await assertCsrf(request);

      if (options.auth !== false) {
        user = await requireUser();
      }

      if (options.rateLimit) {
        await rateLimit(options.rateLimit, user?.id ?? clientKey(request));
      }

      let body: TBody = undefined as TBody;
      if (options.schema) {
        const raw = await readBody(request);
        const parsed = options.schema.safeParse(raw);
        if (!parsed.success) {
          throw new AppError("VALIDATION_ERROR", firstIssue(parsed.error.issues), {
            context: { issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) },
          });
        }
        body = parsed.data;
      }

      const params = route?.params ? await route.params : {};
      const url = new URL(request.url);

      const result = await fn({
        user: user as SessionUser,
        body,
        requestId,
        request,
        params,
        searchParams: url.searchParams,
      });

      if (result instanceof Response) return result;
      return NextResponse.json({ data: result ?? null, requestId }, { headers: { "x-request-id": requestId } });
    } catch (e) {
      return errorResponse(e, requestId, user?.id ?? null);
    }
  };
}

async function readBody(request: Request): Promise<unknown> {
  const contentType = request.headers.get("content-type") ?? "";
  if (request.method === "GET" || request.method === "HEAD") {
    return Object.fromEntries(new URL(request.url).searchParams);
  }
  if (contentType.includes("application/json")) {
    const text = await request.text();
    if (!text.trim()) return {};
    try {
      return JSON.parse(text);
    } catch {
      throw new AppError("VALIDATION_ERROR", "The request body is not valid JSON.");
    }
  }
  if (contentType.includes("multipart/form-data") || contentType.includes("application/x-www-form-urlencoded")) {
    const form = await request.formData();
    const out: Record<string, unknown> = {};
    for (const [k, v] of form.entries()) out[k] = v;
    return out;
  }
  return {};
}

function firstIssue(issues: { path: (string | number | symbol)[]; message: string }[]): string {
  const i = issues[0];
  if (!i) return "The request could not be validated.";
  const field = i.path.filter((p) => typeof p !== "symbol").join(".");
  return field ? `${field}: ${i.message}` : i.message;
}

export async function errorResponse(e: unknown, requestId: string, userId: string | null): Promise<Response> {
  const appError = toAppError(e);
  const env = safeEnv();

  // Log server-side diagnostics; never send them to the client.
  if (appError.status >= 500 || appError.code === "PROVIDER_ERROR") {
    await recordError({
      userId,
      requestId,
      code: appError.code,
      message: appError.message,
      context: appError.context,
    }).catch(() => {});
  }

  const payload: Record<string, unknown> = {
    error: {
      code: appError.code,
      message: appError.message,
      requestId,
      retryable: appError.retryable,
    },
  };

  // Non-sensitive detail arrays help the UI explain what to do next.
  if (Array.isArray(appError.context.blocking)) {
    (payload.error as Record<string, unknown>).details = appError.context.blocking;
  }
  if (Array.isArray(appError.context.issues) && appError.code === "VALIDATION_ERROR") {
    (payload.error as Record<string, unknown>).details = appError.context.issues;
  }

  if (env !== "production" && appError.status >= 500) {
    (payload.error as Record<string, unknown>).debug = appError.context.originalMessage ?? undefined;
  }

  return NextResponse.json(payload, { status: appError.status, headers: { "x-request-id": requestId } });
}

function safeEnv(): string {
  try {
    return loadEnv().NODE_ENV;
  } catch {
    return "production";
  }
}

function clientKey(request: Request): string {
  const fwd = request.headers.get("x-forwarded-for");
  return (fwd?.split(",")[0] ?? request.headers.get("x-real-ip") ?? "anonymous").trim();
}

export interface Page {
  limit: number;
  offset: number;
}

export function pagination(searchParams: URLSearchParams, defaultLimit = 25, maxLimit = 200): Page {
  const limit = Math.min(maxLimit, Math.max(1, Number(searchParams.get("limit") ?? defaultLimit) || defaultLimit));
  const page = Math.max(1, Number(searchParams.get("page") ?? 1) || 1);
  const offset = Number(searchParams.get("offset") ?? (page - 1) * limit) || 0;
  return { limit, offset: Math.max(0, offset) };
}
