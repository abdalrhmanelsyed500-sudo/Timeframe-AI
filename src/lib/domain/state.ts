import { AppError } from "@/lib/errors";

export const PROJECT_STATES = [
  "CREATED",
  "AUDIO_READY",
  "TRANSCRIPT_READY",
  "STORY_ANALYZING",
  "STORY_READY",
  "STORY_APPROVED",
  "VISUALS_GENERATING",
  "VISUALS_READY",
  "TIMELINE_READY",
  "QUALITY_REVIEW",
  "READY_TO_RENDER",
  "RENDERING",
  "COMPLETED",
  "FAILED",
  "CANCELLED",
  "STALE",
] as const;

export type ProjectState = (typeof PROJECT_STATES)[number];

/** Explicit, validated transition table. Invalid transitions are rejected. */
const TRANSITIONS: Record<ProjectState, ProjectState[]> = {
  CREATED: ["AUDIO_READY", "CANCELLED", "FAILED"],
  AUDIO_READY: ["AUDIO_READY", "TRANSCRIPT_READY", "CANCELLED", "FAILED"],
  TRANSCRIPT_READY: ["AUDIO_READY", "TRANSCRIPT_READY", "STORY_ANALYZING", "CANCELLED", "FAILED"],
  STORY_ANALYZING: ["STORY_READY", "TRANSCRIPT_READY", "FAILED", "CANCELLED"],
  STORY_READY: ["STORY_ANALYZING", "STORY_APPROVED", "TRANSCRIPT_READY", "STALE", "FAILED", "CANCELLED"],
  STORY_APPROVED: ["VISUALS_GENERATING", "STORY_ANALYZING", "STALE", "FAILED", "CANCELLED"],
  VISUALS_GENERATING: ["VISUALS_READY", "STORY_APPROVED", "FAILED", "CANCELLED"],
  VISUALS_READY: ["VISUALS_GENERATING", "TIMELINE_READY", "STALE", "FAILED", "CANCELLED"],
  TIMELINE_READY: ["QUALITY_REVIEW", "VISUALS_READY", "TIMELINE_READY", "STALE", "FAILED", "CANCELLED"],
  QUALITY_REVIEW: ["READY_TO_RENDER", "TIMELINE_READY", "QUALITY_REVIEW", "STALE", "FAILED", "CANCELLED"],
  READY_TO_RENDER: ["RENDERING", "QUALITY_REVIEW", "TIMELINE_READY", "STALE", "FAILED", "CANCELLED"],
  RENDERING: ["COMPLETED", "READY_TO_RENDER", "FAILED", "CANCELLED"],
  COMPLETED: ["RENDERING", "TIMELINE_READY", "QUALITY_REVIEW", "READY_TO_RENDER", "STALE", "CANCELLED"],
  FAILED: ["CREATED", "AUDIO_READY", "TRANSCRIPT_READY", "STORY_READY", "VISUALS_READY", "TIMELINE_READY", "READY_TO_RENDER", "CANCELLED"],
  CANCELLED: ["CREATED", "AUDIO_READY", "TRANSCRIPT_READY", "STORY_READY", "VISUALS_READY", "TIMELINE_READY", "READY_TO_RENDER"],
  STALE: ["TRANSCRIPT_READY", "STORY_ANALYZING", "STORY_READY", "STORY_APPROVED", "VISUALS_READY", "TIMELINE_READY", "FAILED", "CANCELLED"],
};

export function canTransition(from: ProjectState, to: ProjectState): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertTransition(from: ProjectState, to: ProjectState): void {
  if (from === to) return;
  if (!canTransition(from, to)) {
    throw new AppError("STATE_ERROR", `This action isn't available yet (project is ${humanState(from)}).`, {
      context: { from, to },
    });
  }
}

const LABELS: Record<ProjectState, string> = {
  CREATED: "Created",
  AUDIO_READY: "Audio uploaded",
  TRANSCRIPT_READY: "Transcript ready",
  STORY_ANALYZING: "Analysing story",
  STORY_READY: "Story ready for review",
  STORY_APPROVED: "Story approved",
  VISUALS_GENERATING: "Generating visuals",
  VISUALS_READY: "Visuals ready",
  TIMELINE_READY: "Timeline ready",
  QUALITY_REVIEW: "Cinematic QA",
  READY_TO_RENDER: "Ready to render",
  RENDERING: "Rendering",
  COMPLETED: "Completed",
  FAILED: "Failed",
  CANCELLED: "Cancelled",
  STALE: "Needs refresh",
};

export function humanState(s: ProjectState): string {
  return LABELS[s] ?? s;
}

export interface NextAction {
  label: string;
  href: (projectId: string) => string;
}

const NEXT: Partial<Record<ProjectState, NextAction>> = {
  CREATED: { label: "Upload voiceover", href: (id) => `/projects/${id}/audio` },
  AUDIO_READY: { label: "Import transcript", href: (id) => `/projects/${id}/transcript` },
  TRANSCRIPT_READY: { label: "Analyse story", href: (id) => `/projects/${id}/story` },
  STORY_ANALYZING: { label: "View progress", href: (id) => `/projects/${id}/jobs` },
  STORY_READY: { label: "Review & approve story", href: (id) => `/projects/${id}/story` },
  STORY_APPROVED: { label: "Generate visual bible", href: (id) => `/projects/${id}/visual-bible` },
  VISUALS_GENERATING: { label: "View progress", href: (id) => `/projects/${id}/assets` },
  VISUALS_READY: { label: "Build timeline", href: (id) => `/projects/${id}/timeline` },
  TIMELINE_READY: { label: "Run cinematic QA", href: (id) => `/projects/${id}/qa` },
  QUALITY_REVIEW: { label: "Review QA & approve", href: (id) => `/projects/${id}/qa` },
  READY_TO_RENDER: { label: "Render video", href: (id) => `/projects/${id}/render` },
  RENDERING: { label: "Open render center", href: (id) => `/projects/${id}/render` },
  COMPLETED: { label: "Watch final video", href: (id) => `/projects/${id}/video` },
  FAILED: { label: "Review errors", href: (id) => `/projects/${id}/errors` },
  STALE: { label: "Refresh downstream steps", href: (id) => `/projects/${id}` },
  CANCELLED: { label: "Open project", href: (id) => `/projects/${id}` },
};

export function nextAction(state: ProjectState): NextAction {
  return NEXT[state] ?? { label: "Open project", href: (id) => `/projects/${id}` };
}

/** Ordered pipeline used for progress display. */
export const PIPELINE: ProjectState[] = [
  "CREATED",
  "AUDIO_READY",
  "TRANSCRIPT_READY",
  "STORY_READY",
  "STORY_APPROVED",
  "VISUALS_READY",
  "TIMELINE_READY",
  "QUALITY_REVIEW",
  "READY_TO_RENDER",
  "COMPLETED",
];

export function pipelineProgress(state: ProjectState): number {
  const idx = PIPELINE.indexOf(state);
  if (idx >= 0) return Math.round((idx / (PIPELINE.length - 1)) * 100);
  if (state === "STORY_ANALYZING") return 25;
  if (state === "VISUALS_GENERATING") return 50;
  if (state === "RENDERING") return 92;
  return 0;
}
