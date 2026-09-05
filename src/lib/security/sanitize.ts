/**
 * All user-generated AND AI-generated text is untrusted.
 * These helpers make it safe for storage, prompts and FFmpeg filtergraphs.
 */

const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

/** Strip control characters and clamp length. Use for all stored text. */
export function cleanText(input: unknown, maxLen = 4000): string {
  if (typeof input !== "string") return "";
  return input.replace(CONTROL_CHARS, "").replace(/\s+/g, " ").trim().slice(0, maxLen);
}

/** Multi-line variant that preserves newlines. */
export function cleanMultiline(input: unknown, maxLen = 20_000): string {
  if (typeof input !== "string") return "";
  return input
    .replace(/\r\n/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .slice(0, maxLen);
}

/**
 * Prompt-injection containment. Transcript content is DATA, never instructions.
 * We fence it and neutralise fence-escape attempts; we do NOT try to detect
 * "malicious intent" — the model is instructed to treat the block as data.
 */
export function fenceUserData(tag: string, data: string): string {
  const safeTag = tag.replace(/[^a-z_]/gi, "").toLowerCase() || "data";
  const body = data.replace(new RegExp(`</?${safeTag}>`, "gi"), (m) => m.replace(/[<>]/g, ""));
  return `<${safeTag}>\n${body}\n</${safeTag}>`;
}

/** Escape text for use inside an FFmpeg drawtext filter value. */
export function escapeDrawText(input: string): string {
  return cleanText(input, 300)
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\u2019")
    .replace(/%/g, "\\%")
    .replace(/[[\]]/g, "");
}

/** Filesystem-safe filename component. Blocks traversal and hidden files. */
export function safeFilename(input: string, fallback = "file"): string {
  const base = input.split(/[\\/]/).pop() ?? "";
  const cleaned = base
    .normalize("NFKD")
    .replace(/[^\w.\- ]+/g, "_")
    .replace(/^\.+/, "")
    .trim()
    .slice(0, 120);
  return cleaned || fallback;
}

/** Reject storage keys that could escape the namespace. */
export function assertSafeStorageKey(key: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._\-/]{0,400}$/.test(key) || key.includes("..") || key.includes("//")) {
    throw new Error(`Unsafe storage key: ${key}`);
  }
  return key;
}
