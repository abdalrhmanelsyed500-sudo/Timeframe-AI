import crypto from "node:crypto";

const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

/** URL-safe, sortable-ish, collision-resistant id with a type prefix. */
export function newId(prefix: string): string {
  const bytes = crypto.randomBytes(16);
  let out = "";
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return `${prefix}_${out}`;
}

/** Deterministic id derived from stable inputs (for reproducible pipelines). */
export function derivedId(prefix: string, ...parts: string[]): string {
  const h = crypto.createHash("sha256").update(parts.join("\u0000")).digest("hex");
  return `${prefix}_${h.slice(0, 24)}`;
}

export function requestId(): string {
  return `req_${crypto.randomBytes(8).toString("hex")}`;
}
