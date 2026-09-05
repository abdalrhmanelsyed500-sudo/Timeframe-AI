import { humanState, pipelineProgress, type ProjectState } from "@/lib/domain/state";
import type { QualityGate } from "@/lib/domain/vocab";
import { Badge, Dot, ProgressBar, type Tone } from "@/components/ui/primitives";

const STATE_TONE: Record<ProjectState, Tone> = {
  CREATED: "neutral",
  AUDIO_READY: "info",
  TRANSCRIPT_READY: "info",
  STORY_ANALYZING: "accent",
  STORY_READY: "info",
  STORY_APPROVED: "info",
  VISUALS_GENERATING: "accent",
  VISUALS_READY: "info",
  TIMELINE_READY: "info",
  QUALITY_REVIEW: "info",
  READY_TO_RENDER: "accent",
  RENDERING: "accent",
  COMPLETED: "ok",
  FAILED: "danger",
  CANCELLED: "neutral",
  STALE: "warn",
};

const BUSY_STATES: ProjectState[] = ["STORY_ANALYZING", "VISUALS_GENERATING", "RENDERING"];

export function ProjectStateBadge({ state }: { state: ProjectState }) {
  return (
    <Badge tone={STATE_TONE[state] ?? "neutral"}>
      <Dot tone={STATE_TONE[state] ?? "neutral"} pulse={BUSY_STATES.includes(state)} />
      {humanState(state)}
    </Badge>
  );
}

export function PipelineProgress({ state, className }: { state: ProjectState; className?: string }) {
  const pct = pipelineProgress(state);
  const tone: Tone = state === "FAILED" ? "danger" : state === "COMPLETED" ? "ok" : state === "STALE" ? "warn" : "accent";
  return <ProgressBar value={pct / 100} tone={tone} label={`Pipeline progress: ${humanState(state)}`} className={className} />;
}

const GATE_TONE: Record<QualityGate, Tone> = {
  PASS: "ok",
  WARNINGS: "warn",
  NEEDS_REVIEW: "warn",
  FAIL: "danger",
};

const GATE_LABEL: Record<QualityGate, string> = {
  PASS: "Pass",
  WARNINGS: "Pass with warnings",
  NEEDS_REVIEW: "Needs review",
  FAIL: "Fail",
};

export function GateBadge({ gate, score }: { gate: QualityGate | string; score?: number }) {
  const key = (gate as QualityGate) in GATE_TONE ? (gate as QualityGate) : "NEEDS_REVIEW";
  return (
    <Badge tone={GATE_TONE[key]}>
      {GATE_LABEL[key]}
      {typeof score === "number" ? <span className="tabular-nums opacity-80">{score.toFixed(2)}</span> : null}
    </Badge>
  );
}

const JOB_TONE: Record<string, Tone> = {
  QUEUED: "neutral",
  PROCESSING: "accent",
  RETRYING: "warn",
  COMPLETED: "ok",
  FAILED: "danger",
  CANCELLED: "neutral",
};

export function JobStatusBadge({ status }: { status: string }) {
  const tone = JOB_TONE[status] ?? "neutral";
  return (
    <Badge tone={tone}>
      <Dot tone={tone} pulse={status === "PROCESSING"} />
      {status.charAt(0) + status.slice(1).toLowerCase()}
    </Badge>
  );
}

export function StaleBadge({ reason }: { reason?: string | null }) {
  return (
    <Badge tone="warn" className="max-w-full">
      <span className="truncate">{reason ? `Out of date — ${reason}` : "Out of date"}</span>
    </Badge>
  );
}
