"use client";

import { useRouter } from "next/navigation";
import { useProjectStream } from "@/lib/client/use-project-stream";
import { Badge, Dot } from "@/components/ui/primitives";

/**
 * Shows whether live updates are connected, and refreshes the server-rendered
 * page when background work finishes so the UI reflects real database state.
 */
export function LiveStatus({ projectId }: { projectId: string }) {
  const router = useRouter();
  const { snapshot, status } = useProjectStream(projectId, { onSettled: () => router.refresh() });

  const active = snapshot?.jobs.filter((j) => j.status === "PROCESSING" || j.status === "QUEUED" || j.status === "RETRYING") ?? [];

  if (active.length > 0) {
    const job = active[0];
    const pct = job.total ? Math.round((job.completed / job.total) * 100) : Math.round(job.progress * 100);
    return (
      <Badge tone="accent">
        <Dot tone="accent" pulse />
        <span className="max-w-[16rem] truncate">{job.message}</span>
        <span className="tabular-nums opacity-80">{pct}%</span>
      </Badge>
    );
  }

  if (status === "live") {
    return (
      <Badge tone="neutral">
        <Dot tone="ok" />
        Live
      </Badge>
    );
  }
  if (status === "reconnecting" || status === "connecting") {
    return (
      <Badge tone="neutral">
        <Dot tone="warn" pulse />
        {status === "connecting" ? "Connecting" : "Reconnecting"}
      </Badge>
    );
  }
  return (
    <Badge tone="warn" className="cursor-default" >
      <Dot tone="warn" />
      Live updates offline — refresh to resync
    </Badge>
  );
}
