import Link from "next/link";
import type { SessionUser } from "@/lib/security/auth";
import { loadEnv } from "@/lib/env";
import { Badge } from "@/components/ui/primitives";
import { UserMenu } from "./user-menu";

const NAV = [
  { href: "/dashboard", label: "Projects" },
  { href: "/jobs", label: "Jobs" },
  { href: "/settings", label: "Settings" },
];

export function AppShell({ user, children }: { user: SessionUser; children: React.ReactNode }) {
  const env = loadEnv();

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-40 border-b border-ink-800 bg-ink-950/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center gap-6 px-4 py-3 sm:px-6">
          <Link href="/dashboard" className="flex shrink-0 items-center gap-2.5">
            <span aria-hidden="true" className="flex size-7 items-center justify-center rounded-md bg-amber-accent text-sm font-bold text-ink-950">
              T
            </span>
            <span className="hidden text-sm font-semibold tracking-tight sm:block">Timeframe AI</span>
          </Link>

          <nav aria-label="Main" className="flex flex-1 items-center gap-1 overflow-x-auto">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-lg px-3 py-1.5 text-sm text-ink-300 transition-colors hover:bg-ink-850 hover:text-ink-100"
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="flex shrink-0 items-center gap-3">
            {env.DEMO_MODE ? (
              <Badge tone="warn" className="hidden sm:inline-flex">
                Demo mode
              </Badge>
            ) : null}
            <UserMenu name={user.name} email={user.email} />
          </div>
        </div>
      </header>

      <main id="main" className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6">
        {children}
      </main>
    </div>
  );
}
