import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/security/auth";
import { AppShell } from "@/components/app-shell";
import { ensureInlineWorker } from "@/lib/services/worker";
import { loadEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // In single-process deployments the worker runs inside the app. In production
  // with WORKER_INLINE=false, `npm run worker` owns the queue instead.
  if (loadEnv().WORKER_INLINE) ensureInlineWorker();

  const user = await getCurrentUser().catch(() => null);
  if (!user) redirect("/login");

  return <AppShell user={user}>{children}</AppShell>;
}
