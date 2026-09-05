import dns from "node:dns/promises";
import net from "node:net";
import { AppError } from "@/lib/errors";

/**
 * SSRF guard. Regex alone is never sufficient — we resolve DNS and classify
 * every resulting IP, and we re-validate after each redirect.
 */
const ALLOWED_PROTOCOLS = new Set(["https:", "http:"]);
const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "metadata.google.internal",
  "metadata.goog",
  "instance-data",
]);

export function isBlockedIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const p = ip.split(".").map(Number);
    if (p[0] === 0) return true; // 0.0.0.0/8
    if (p[0] === 10) return true; // RFC1918
    if (p[0] === 127) return true; // loopback
    if (p[0] === 169 && p[1] === 254) return true; // link-local + cloud metadata
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true; // RFC1918
    if (p[0] === 192 && p[1] === 168) return true; // RFC1918
    if (p[0] === 192 && p[1] === 0 && p[2] === 0) return true; // IETF protocol
    if (p[0] === 192 && p[1] === 0 && p[2] === 2) return true; // TEST-NET-1
    if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return true; // CGNAT
    if (p[0] === 198 && (p[1] === 18 || p[1] === 19)) return true; // benchmarking
    if (p[0] >= 224) return true; // multicast + reserved + broadcast
    return false;
  }
  if (net.isIPv6(ip)) {
    const v = ip.toLowerCase().replace(/^\[|\]$/g, "");
    if (v === "::" || v === "::1") return true;
    if (v.startsWith("fe80") || v.startsWith("fec0")) return true; // link/site local
    if (/^f[cd]/.test(v)) return true; // unique local
    if (v.startsWith("ff")) return true; // multicast
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v);
    if (mapped) return isBlockedIp(mapped[1]);
    return false;
  }
  return true;
}

export async function assertUrlIsSafe(rawUrl: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new AppError("VALIDATION_ERROR", "Invalid URL.");
  }
  if (!ALLOWED_PROTOCOLS.has(url.protocol)) {
    throw new AppError("VALIDATION_ERROR", `Protocol not allowed: ${url.protocol}`);
  }
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (BLOCKED_HOSTNAMES.has(host)) {
    throw new AppError("VALIDATION_ERROR", "This host is not allowed.");
  }
  if (net.isIP(host)) {
    if (isBlockedIp(host)) throw new AppError("VALIDATION_ERROR", "This address range is not allowed.");
    return url;
  }
  let addresses: string[];
  try {
    const records = await dns.lookup(host, { all: true, verbatim: true });
    addresses = records.map((r) => r.address);
  } catch {
    throw new AppError("VALIDATION_ERROR", "Host could not be resolved.");
  }
  if (addresses.length === 0) throw new AppError("VALIDATION_ERROR", "Host could not be resolved.");
  for (const addr of addresses) {
    if (isBlockedIp(addr)) throw new AppError("VALIDATION_ERROR", "This host resolves to a restricted address.");
  }
  return url;
}

/** fetch() with manual redirect handling; every hop is re-validated. */
export async function safeFetch(
  rawUrl: string,
  init: RequestInit = {},
  opts: { maxRedirects?: number; timeoutMs?: number } = {},
): Promise<Response> {
  const maxRedirects = opts.maxRedirects ?? 3;
  const timeoutMs = opts.timeoutMs ?? 60_000;
  let current = rawUrl;

  for (let hop = 0; hop <= maxRedirects; hop++) {
    const url = await assertUrlIsSafe(current);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let res: Response;
    try {
      res = await fetch(url, { ...init, redirect: "manual", signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      if (!location) return res;
      current = new URL(location, url).toString();
      continue;
    }
    return res;
  }
  throw new AppError("VALIDATION_ERROR", "Too many redirects.");
}
