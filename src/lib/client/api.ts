"use client";

/**
 * Browser API client.
 *
 * The UI never talks to the database or to a provider directly — every call
 * goes through /api/v1, which enforces auth, ownership and validation. This
 * module only handles transport, the CSRF header and error normalisation.
 */

export interface ApiFailure {
  code: string;
  message: string;
  requestId: string;
  retryable: boolean;
  details?: unknown;
}

export class ApiError extends Error {
  readonly code: string;
  readonly requestId: string;
  readonly retryable: boolean;
  readonly details?: unknown;
  readonly status: number;

  constructor(failure: ApiFailure, status: number) {
    super(failure.message);
    this.name = "ApiError";
    this.code = failure.code;
    this.requestId = failure.requestId;
    this.retryable = failure.retryable;
    this.details = failure.details;
    this.status = status;
  }
}

function csrfToken(): string {
  const match = document.cookie.match(/(?:^|;\s*)tf_csrf=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : "";
}

async function request<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const headers: Record<string, string> = { accept: "application/json" };
  let payload: BodyInit | undefined;

  if (body instanceof FormData) {
    payload = body;
  } else if (body !== undefined) {
    headers["content-type"] = "application/json";
    payload = JSON.stringify(body);
  }
  if (method !== "GET") headers["x-csrf-token"] = csrfToken();

  let response: Response;
  try {
    response = await fetch(path, { method, headers, body: payload, signal, credentials: "same-origin" });
  } catch (e) {
    if (signal?.aborted) throw e;
    throw new ApiError(
      { code: "NETWORK_ERROR", message: "The server could not be reached. Check your connection and try again.", requestId: "", retryable: true },
      0,
    );
  }

  if (response.status === 204) return undefined as T;

  let json: unknown;
  try {
    json = await response.json();
  } catch {
    throw new ApiError(
      { code: "INTERNAL_ERROR", message: "The server returned an unreadable response.", requestId: response.headers.get("x-request-id") ?? "", retryable: true },
      response.status,
    );
  }

  const envelope = json as { data?: T; error?: ApiFailure };
  if (!response.ok || envelope.error) {
    const failure = envelope.error ?? {
      code: "INTERNAL_ERROR",
      message: "Something went wrong.",
      requestId: response.headers.get("x-request-id") ?? "",
      retryable: response.status >= 500,
    };
    throw new ApiError(failure, response.status);
  }
  return envelope.data as T;
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal) => request<T>("GET", path, undefined, signal),
  post: <T>(path: string, body?: unknown, signal?: AbortSignal) => request<T>("POST", path, body, signal),
  patch: <T>(path: string, body?: unknown, signal?: AbortSignal) => request<T>("PATCH", path, body, signal),
  delete: <T>(path: string, body?: unknown, signal?: AbortSignal) => request<T>("DELETE", path, body, signal),
};

/** Human-readable message for anything thrown by the client. */
export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message;
  return "Something went wrong.";
}
