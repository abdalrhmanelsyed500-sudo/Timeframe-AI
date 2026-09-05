import type { ProjectState } from "@/lib/domain/state";

/**
 * The single frontend description of the production workflow.
 *
 * This is presentation metadata ONLY — which tab exists, what it is called and
 * which state marks it complete. All authority over whether an action is
 * permitted stays in the backend state machine (assertTransition) and the
 * services; the UI never decides that on its own.
 */
export interface WorkflowStep {
  key: string;
  label: string;
  shortLabel: string;
  href: (projectId: string) => string;
  /** Project state at which this step counts as done. */
  completedAt: ProjectState[];
}

export const WORKFLOW: WorkflowStep[] = [
  {
    key: "audio",
    label: "Voiceover",
    shortLabel: "Audio",
    href: (id) => `/projects/${id}/audio`,
    completedAt: [
      "AUDIO_READY", "TRANSCRIPT_READY", "STORY_ANALYZING", "STORY_READY", "STORY_APPROVED",
      "VISUALS_GENERATING", "VISUALS_READY", "TIMELINE_READY", "QUALITY_REVIEW", "READY_TO_RENDER",
      "RENDERING", "COMPLETED",
    ],
  },
  {
    key: "transcript",
    label: "Transcript",
    shortLabel: "Transcript",
    href: (id) => `/projects/${id}/transcript`,
    completedAt: [
      "TRANSCRIPT_READY", "STORY_ANALYZING", "STORY_READY", "STORY_APPROVED", "VISUALS_GENERATING",
      "VISUALS_READY", "TIMELINE_READY", "QUALITY_REVIEW", "READY_TO_RENDER", "RENDERING", "COMPLETED",
    ],
  },
  {
    key: "story",
    label: "Story map",
    shortLabel: "Story",
    href: (id) => `/projects/${id}/story`,
    completedAt: [
      "STORY_APPROVED", "VISUALS_GENERATING", "VISUALS_READY", "TIMELINE_READY", "QUALITY_REVIEW",
      "READY_TO_RENDER", "RENDERING", "COMPLETED",
    ],
  },
  {
    key: "visual-bible",
    label: "Visual bible",
    shortLabel: "Bible",
    href: (id) => `/projects/${id}/visual-bible`,
    completedAt: [
      "VISUALS_GENERATING", "VISUALS_READY", "TIMELINE_READY", "QUALITY_REVIEW", "READY_TO_RENDER",
      "RENDERING", "COMPLETED",
    ],
  },
  {
    key: "assets",
    label: "Assets",
    shortLabel: "Assets",
    href: (id) => `/projects/${id}/assets`,
    completedAt: ["VISUALS_READY", "TIMELINE_READY", "QUALITY_REVIEW", "READY_TO_RENDER", "RENDERING", "COMPLETED"],
  },
  {
    key: "timeline",
    label: "Timeline",
    shortLabel: "Timeline",
    href: (id) => `/projects/${id}/timeline`,
    completedAt: ["TIMELINE_READY", "QUALITY_REVIEW", "READY_TO_RENDER", "RENDERING", "COMPLETED"],
  },
  {
    key: "qa",
    label: "Cinematic QA",
    shortLabel: "QA",
    href: (id) => `/projects/${id}/qa`,
    completedAt: ["READY_TO_RENDER", "RENDERING", "COMPLETED"],
  },
  {
    key: "render",
    label: "Render",
    shortLabel: "Render",
    href: (id) => `/projects/${id}/render`,
    completedAt: ["COMPLETED"],
  },
];

export type StepStatus = "done" | "current" | "todo";

export function stepStatus(step: WorkflowStep, state: ProjectState): StepStatus {
  if (step.completedAt.includes(state)) return "done";
  const firstIncomplete = WORKFLOW.find((s) => !s.completedAt.includes(state));
  return firstIncomplete?.key === step.key ? "current" : "todo";
}

/** Secondary destinations that are not pipeline stages. */
export const EXTRA_TABS = [
  { key: "entities", label: "Entities", href: (id: string) => `/projects/${id}/entities` },
  { key: "video", label: "Final video", href: (id: string) => `/projects/${id}/video` },
  { key: "history", label: "History", href: (id: string) => `/projects/${id}/history` },
  { key: "jobs", label: "Jobs", href: (id: string) => `/projects/${id}/jobs` },
  { key: "errors", label: "Errors", href: (id: string) => `/projects/${id}/errors` },
];
