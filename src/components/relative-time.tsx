"use client";

import { useEffect, useState } from "react";

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 24 * 3600_000],
  ["month", 30 * 24 * 3600_000],
  ["day", 24 * 3600_000],
  ["hour", 3600_000],
  ["minute", 60_000],
  ["second", 1000],
];

function format(iso: string, now: number): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return "—";
  const diff = then - now;
  const abs = Math.abs(diff);
  if (abs < 45_000) return "just now";
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  for (const [unit, ms] of UNITS) {
    if (abs >= ms) return rtf.format(Math.round(diff / ms), unit);
  }
  return "just now";
}

/**
 * Rendered client-side only so the server and the browser can never disagree
 * about "now" (which would cause a hydration mismatch).
 */
export function RelativeTime({ iso, className }: { iso: string; className?: string }) {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const absolute = new Date(iso);
  const label = Number.isNaN(absolute.getTime()) ? "—" : absolute.toLocaleString();

  return (
    <time dateTime={iso} title={label} className={className} suppressHydrationWarning>
      {now === null ? label.split(",")[0] : format(iso, now)}
    </time>
  );
}
