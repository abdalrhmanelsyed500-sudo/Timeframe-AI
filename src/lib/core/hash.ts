import crypto from "node:crypto";

export function sha256(input: string | Buffer | Uint8Array): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

/**
 * Deterministic JSON serialisation: object keys are sorted recursively so the
 * same logical value always yields the same hash regardless of key order.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortValue);
  if (v && typeof v === "object" && !(v instanceof Date)) {
    const src = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(src).sort()) out[k] = sortValue(src[k]);
    return out;
  }
  if (v instanceof Date) return v.toISOString();
  return v;
}

export function contentHash(value: unknown): string {
  return sha256(canonicalJson(value));
}

/** Stable 32-bit integer from a string — used for deterministic selection. */
export function stableInt(seed: string): number {
  const h = crypto.createHash("sha256").update(seed).digest();
  return h.readUInt32BE(0);
}

/** Deterministically pick an element from a list using a seed. */
export function stablePick<T>(seed: string, items: readonly T[]): T {
  if (items.length === 0) throw new Error("stablePick: empty list");
  return items[stableInt(seed) % items.length];
}
