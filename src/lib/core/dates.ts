/** Coerce a database timestamp (Date or ISO string) to an ISO string. */
export function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" || typeof value === "number") return new Date(value).toISOString();
  return new Date(0).toISOString();
}
