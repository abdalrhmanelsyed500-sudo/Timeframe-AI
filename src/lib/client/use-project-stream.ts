"use client";

import { useEffect, useRef, useState } from "react";

export interface StreamJob {
  id: string;
  type: string;
  status: string;
  progress: number;
  message: string;
  completed: number;
  total: number | null;
  failed: number;
  errorMessage: string | null;
}

export interface StreamRender {
  id: string;
  status: string;
  stage: string;
  progress: number;
}

export interface ProjectSnapshot {
  jobs: StreamJob[];
  renders: StreamRender[];
  assets: { totalShots: number; generated: number; selected: number; needsReview: number; complete: boolean };
  timelineVersion: number | null;
}

export type StreamStatus = "connecting" | "live" | "reconnecting" | "offline";

/**
 * Subscribes to the project's SSE stream.
 *
 * The stream is a transport over database state, never a source of truth: when
 * it drops we surface that honestly and let the caller refetch. There is no
 * polling fallback loop competing with SSE.
 */
export function useProjectStream(projectId: string, options: { enabled?: boolean; onSettled?: () => void } = {}) {
  const enabled = options.enabled !== false;
  const [snapshot, setSnapshot] = useState<ProjectSnapshot | null>(null);
  const [status, setStatus] = useState<StreamStatus>("connecting");
  const onSettledRef = useRef(options.onSettled);
  onSettledRef.current = options.onSettled;
  const busyRef = useRef(false);

  useEffect(() => {
    if (!enabled) {
      setStatus("offline");
      return;
    }

    let source: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let attempts = 0;
    let cancelled = false;

    const connect = () => {
      if (cancelled) return;
      source = new EventSource(`/api/v1/projects/${projectId}/events`);

      source.addEventListener("open", () => {
        attempts = 0;
        setStatus("live");
      });

      source.addEventListener("state", (e) => {
        try {
          const next = JSON.parse((e as MessageEvent).data) as ProjectSnapshot;
          setSnapshot(next);
          setStatus("live");

          // When work finishes, tell the caller so it can refetch the REST
          // snapshot (which carries far more detail than the stream).
          const busy = next.jobs.some((j) => j.status === "PROCESSING" || j.status === "QUEUED" || j.status === "RETRYING");
          if (busyRef.current && !busy) onSettledRef.current?.();
          busyRef.current = busy;
        } catch {
          /* a malformed frame must never break the page */
        }
      });

      source.onerror = () => {
        source?.close();
        source = null;
        if (cancelled) return;
        attempts += 1;
        setStatus(attempts > 5 ? "offline" : "reconnecting");
        // Exponential backoff, capped, so a dead server is not hammered.
        retry = setTimeout(connect, Math.min(15_000, 1000 * 2 ** Math.min(attempts, 4)));
      };
    };

    connect();

    return () => {
      cancelled = true;
      if (retry) clearTimeout(retry);
      source?.close();
    };
  }, [projectId, enabled]);

  return { snapshot, status };
}
