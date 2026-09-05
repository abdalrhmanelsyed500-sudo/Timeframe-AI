"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, errorMessage } from "@/lib/client/api";
import { Button, Callout, Badge } from "@/components/ui/primitives";

export function StoryActions({
  projectId,
  hasPlan,
  status,
  stale,
}: {
  projectId: string;
  hasPlan: boolean;
  status: string | null;
  stale: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<"analyze" | "approve" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [queued, setQueued] = useState(false);

  async function run(kind: "analyze" | "approve") {
    setError(null);
    setBusy(kind);
    try {
      if (kind === "analyze") {
        await api.post(`/api/v1/projects/${projectId}/story/analyze`);
        setQueued(true);
      } else {
        await api.post(`/api/v1/projects/${projectId}/story/approve`);
      }
      router.refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col items-end gap-2">
      {error ? <Callout tone="danger" className="max-w-md">{error}</Callout> : null}
      {queued ? <Badge tone="accent">Analysis queued — progress appears in the header</Badge> : null}

      <div className="flex flex-wrap items-center gap-2">
        {status === "APPROVED" ? <Badge tone="ok">Approved</Badge> : hasPlan ? <Badge tone="info">{status}</Badge> : null}

        <Button size="sm" onClick={() => run("analyze")} loading={busy === "analyze"} disabled={busy !== null}>
          {hasPlan ? "Re-analyse" : "Analyse story"}
        </Button>

        {hasPlan && status !== "APPROVED" ? (
          <Button
            size="sm"
            variant="primary"
            onClick={() => run("approve")}
            loading={busy === "approve"}
            disabled={busy !== null || stale}
            title={stale ? "Re-run the analysis first — this plan is out of date." : undefined}
          >
            Approve story
          </Button>
        ) : null}
      </div>
    </div>
  );
}
