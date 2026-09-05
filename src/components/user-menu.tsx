"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/client/api";
import { cx } from "@/components/ui/primitives";

export function UserMenu({ name, email }: { name: string; email: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function signOut() {
    setBusy(true);
    try {
      await api.post("/api/v1/auth/logout");
    } finally {
      router.replace("/login");
      router.refresh();
    }
  }

  const initials =
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase())
      .join("") || "?";

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex size-8 items-center justify-center rounded-full border border-ink-700 bg-ink-800 text-xs font-semibold text-ink-200 hover:border-ink-600"
      >
        <span className="sr-only">Account menu for {name}</span>
        <span aria-hidden="true">{initials}</span>
      </button>

      <div
        role="menu"
        className={cx(
          "absolute right-0 z-50 mt-2 w-60 origin-top-right rounded-xl border border-ink-700 bg-ink-850 p-1.5 shadow-2xl transition",
          open ? "visible opacity-100" : "invisible opacity-0",
        )}
      >
        <div className="border-b border-ink-800 px-3 py-2.5">
          <p className="truncate text-sm font-medium text-ink-100">{name}</p>
          <p className="truncate text-xs text-ink-500">{email}</p>
        </div>
        <Link
          href="/settings"
          role="menuitem"
          onClick={() => setOpen(false)}
          className="mt-1 block rounded-lg px-3 py-2 text-sm text-ink-300 hover:bg-ink-800 hover:text-ink-100"
        >
          Settings & providers
        </Link>
        <Link
          href="/jobs"
          role="menuitem"
          onClick={() => setOpen(false)}
          className="block rounded-lg px-3 py-2 text-sm text-ink-300 hover:bg-ink-800 hover:text-ink-100"
        >
          Background jobs
        </Link>
        <button
          type="button"
          role="menuitem"
          onClick={signOut}
          disabled={busy}
          className="mt-1 block w-full rounded-lg px-3 py-2 text-left text-sm text-danger hover:bg-ink-800 disabled:opacity-50"
        >
          {busy ? "Signing out…" : "Sign out"}
        </button>
      </div>
    </div>
  );
}
