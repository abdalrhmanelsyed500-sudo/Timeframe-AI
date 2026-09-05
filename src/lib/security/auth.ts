import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { cookies } from "next/headers";
import { loadEnv } from "@/lib/env";
import { AppError } from "@/lib/errors";
import { db, dbGuard } from "@/lib/db";

export const SESSION_COOKIE = "tf_session";
export const CSRF_COOKIE = "tf_csrf";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: string;
}

function secretKey(): Uint8Array {
  return new TextEncoder().encode(loadEnv().AUTH_SECRET);
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export async function createSessionToken(userId: string): Promise<string> {
  return new SignJWT({ sub: userId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setIssuer("timeframe-ai")
    .setAudience("timeframe-ai")
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(secretKey());
}

export async function readSessionToken(token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey(), { issuer: "timeframe-ai", audience: "timeframe-ai" });
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

export function newCsrfToken(): string {
  return crypto.randomBytes(24).toString("hex");
}

export async function startSession(userId: string): Promise<void> {
  const env = loadEnv();
  const jar = await cookies();
  const token = await createSessionToken(userId);
  const secure = env.NODE_ENV === "production";
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
  jar.set(CSRF_COOKIE, newCsrfToken(), {
    httpOnly: false, // readable by the app so it can echo it in a header
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

export async function endSession(): Promise<void> {
  const env = loadEnv();
  const jar = await cookies();
  const secure = env.NODE_ENV === "production";
  // The expiring cookie must carry the SAME attributes (httpOnly, sameSite,
  // secure, path) as the one it replaces, otherwise user agents treat it as a
  // different cookie and the session survives logout.
  jar.set(SESSION_COOKIE, "", { httpOnly: true, sameSite: "lax", secure, path: "/", maxAge: 0 });
  jar.set(CSRF_COOKIE, "", { httpOnly: false, sameSite: "lax", secure, path: "/", maxAge: 0 });
}

/** Returns the signed-in user or null. Never throws for anonymous visitors. */
export async function getCurrentUser(): Promise<SessionUser | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const userId = await readSessionToken(token);
  if (!userId) return null;
  const row = await dbGuard(() =>
    db.selectFrom("users").select(["id", "email", "name", "role"]).where("id", "=", userId).executeTakeFirst(),
  );
  return row ?? null;
}

export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) throw new AppError("AUTH_ERROR", "You must be signed in to do that.");
  return user;
}

/**
 * Double-submit CSRF check for state-changing requests.
 * The cookie value must match the X-CSRF-Token header.
 */
export async function assertCsrf(request: Request): Promise<void> {
  const method = request.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return;
  const jar = await cookies();
  const cookieToken = jar.get(CSRF_COOKIE)?.value;
  const headerToken = request.headers.get("x-csrf-token");
  if (!cookieToken || !headerToken) {
    throw new AppError("FORBIDDEN", "Missing CSRF token. Refresh the page and try again.");
  }
  const a = Buffer.from(cookieToken);
  const b = Buffer.from(headerToken);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    throw new AppError("FORBIDDEN", "Invalid CSRF token. Refresh the page and try again.");
  }
}
