import Link from "next/link";
import { requireUser } from "@/lib/security/auth";
import { requireProject } from "@/lib/services/projects";
import { getAudio } from "@/lib/services/audio";
import { getTranscript } from "@/lib/services/transcript";
import { latestStoryPlan } from "@/lib/services/story";
import { latestVisualBible } from "@/lib/services/visual-bible";
import { assetsReadyReport } from "@/lib/services/assets";
import { latestTimeline } from "@/lib/services/timeline";
import { latestReport } from "@/lib/services/cinematic";
import { latestCompletedRender, listRenders } from "@/lib/services/render";
import { listJobs } from "@/lib/services/jobs";
import { staleReport } from "@/lib/services/stale";
import { nextAction, type ProjectState } from "@/lib/domain/state";
import { formatShort } from "@/lib/core/timecode";
import { WORKFLOW, stepStatus } from "@/lib/workflow";
import { Panel, PanelHeader, LinkButton, Callout, Badge, KeyValue, cx } from "@/components/ui/primitives";
import { GateBadge, JobStatusBadge } from "@/components/status";
import { RelativeTime } from "@/components/relative-time";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const project = await requireProject(id, user.id).catch(() => null);
  return { title: project ? `${project.name} — Overview` : "Project" };
}

function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export default async function ProjectOverviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const project = await requireProject(id, user.id);

  const [audio, transcript, plan, bible, assets, timeline, qa, finalRender, renders, jobs, stale] = await Promise.all([
    getAudio(id),
    getTranscript(id),
    latestStoryPlan(id),
    latestVisualBible(id),
    assetsReadyReport(id),
    latestTimeline(id),
    latestReport(id),
    latestCompletedRender(id),
    listRenders(id, 5),
    listJobs({ userId: user.id, projectId: id, limit: 6 }),
    staleReport(id),
  ]);

  const state = project.status as ProjectState;
  const action = nextAction(state);
  const staleReasons = stale.reasons;

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        {staleReasons.length > 0 ? (
          <Callout tone="warn" title="Some stages are out of date">
            <ul className="list-disc space-y-1 pl-4">
              {staleReasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-ink-400">Rebuild the affected stages before rendering.</p>
          </Callout>
        ) : null}

        {state === "FAILED" ? (
          <Callout tone="danger" title="This project failed">
            Open the <Link href={`/projects/${id}/errors`} className="underline">error log</Link> to see exactly what went
            wrong, then retry the stage that failed.
          </Callout>
        ) : null}

        <Panel>
          <PanelHeader
            title="Production stages"
            description="Each stage writes an immutable version. Nothing downstream runs on stale input."
            actions={
              <LinkButton href={action.href(project.id)} variant="primary" size="sm">
                {action.label}
              </LinkButton>
            }
          />
          <ol className="divide-y divide-ink-800">
            {WORKFLOW.map((step, i) => {
              const status = stepStatus(step, state);
              const detail = stageDetail(step.key, { audio, transcript, plan, bible, assets, timeline, qa, finalRender });
              return (
                <li key={step.key}>
                  <Link href={step.href(project.id)} className="flex items-center gap-4 px-5 py-3 hover:bg-ink-850">
                    <span
                      aria-hidden="true"
                      className={cx(
                        "flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold tabular-nums",
                        status === "done"
                          ? "bg-ok/20 text-ok"
                          : status === "current"
                            ? "bg-amber-accent text-ink-950"
                            : "border border-ink-700 text-ink-500",
                      )}
                    >
                      {i + 1}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-ink-100">{step.label}</span>
                      <span className="mt-0.5 block truncate text-xs text-ink-500">{detail ?? "Not started"}</span>
                    </span>
                    {status === "done" ? <Badge tone="ok">Done</Badge> : status === "current" ? <Badge tone="accent">Now</Badge> : null}
                  </Link>
                </li>
              );
            })}
          </ol>
        </Panel>

        <Panel>
          <PanelHeader
            title="Recent activity"
            actions={
              <Link href={`/projects/${id}/jobs`} className="text-xs text-amber-accent hover:underline">
                All jobs
              </Link>
            }
          />
          {jobs.items.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-ink-500">No background work has run for this project yet.</p>
          ) : (
            <ul className="divide-y divide-ink-800">
              {jobs.items.map((job) => (
                <li key={job.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm text-ink-200">{job.message}</p>
                    <p className="mt-0.5 text-xs text-ink-500">
                      {job.type.replace(/_/g, " ").toLowerCase()} · <RelativeTime iso={job.createdAt} />
                    </p>
                  </div>
                  <JobStatusBadge status={job.status} />
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      <aside className="space-y-6">
        <Panel>
          <PanelHeader title="Project" />
          <div className="px-5 py-1">
            <KeyValue
              items={[
                ["Created", <RelativeTime key="c" iso={project.createdAt} />],
                ["Updated", <RelativeTime key="u" iso={project.updatedAt} />],
                ["Quality preset", project.qualityPreset],
                ["Resolution", `${project.width}×${project.height}`],
                ["Frame rate", `${project.fps} fps`],
                ["Duration", audio ? formatShort(audio.durationMs) : "—"],
              ]}
            />
          </div>
        </Panel>

        {audio ? (
          <Panel>
            <PanelHeader title="Master audio" description="The authoritative timeline." />
            <div className="px-5 py-1">
              <KeyValue
                items={[
                  ["File", <span key="f" className="max-w-[12rem] truncate">{audio.filename}</span>],
                  ["Duration", `${formatShort(audio.durationMs)} (${audio.durationMs} ms)`],
                  ["Codec", audio.codec ?? "—"],
                  ["Sample rate", audio.sampleRate ? `${audio.sampleRate} Hz` : "—"],
                  ["Size", bytes(audio.bytes)],
                ]}
              />
            </div>
          </Panel>
        ) : null}

        {qa ? (
          <Panel>
            <PanelHeader
              title="Cinematic QA"
              actions={<GateBadge gate={qa.gate} score={qa.overallScore} />}
            />
            <div className="px-5 py-4">
              <p className="text-xs text-ink-500">
                {qa.issues.length === 0
                  ? "No issues were raised on the current timeline."
                  : `${qa.issues.length} issue${qa.issues.length === 1 ? "" : "s"} recorded.`}
              </p>
              <LinkButton href={`/projects/${id}/qa`} size="sm" className="mt-3 w-full">
                Open QA report
              </LinkButton>
            </div>
          </Panel>
        ) : null}

        <Panel>
          <PanelHeader
            title="Renders"
            actions={
              <Link href={`/projects/${id}/render`} className="text-xs text-amber-accent hover:underline">
                Render center
              </Link>
            }
          />
          {renders.length === 0 ? (
            <p className="px-5 py-6 text-center text-xs text-ink-500">Nothing rendered yet.</p>
          ) : (
            <ul className="divide-y divide-ink-800">
              {renders.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3 px-5 py-2.5">
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-ink-200">{r.profile}</p>
                    <p className="text-xs text-ink-500">
                      <RelativeTime iso={r.createdAt} />
                    </p>
                  </div>
                  <Badge tone={r.status === "COMPLETED" ? "ok" : r.status === "FAILED" ? "danger" : "accent"}>{r.status}</Badge>
                </li>
              ))}
            </ul>
          )}
          {finalRender?.artifact ? (
            <div className="border-t border-ink-800 p-3">
              <LinkButton href={`/projects/${id}/video`} variant="primary" size="sm" className="w-full">
                Watch final video
              </LinkButton>
            </div>
          ) : null}
        </Panel>
      </aside>
    </div>
  );
}

type StageData = {
  audio: Awaited<ReturnType<typeof getAudio>>;
  transcript: Awaited<ReturnType<typeof getTranscript>>;
  plan: Awaited<ReturnType<typeof latestStoryPlan>>;
  bible: Awaited<ReturnType<typeof latestVisualBible>>;
  assets: Awaited<ReturnType<typeof assetsReadyReport>>;
  timeline: Awaited<ReturnType<typeof latestTimeline>>;
  qa: Awaited<ReturnType<typeof latestReport>>;
  finalRender: Awaited<ReturnType<typeof latestCompletedRender>>;
};

/** Every string below is derived from real persisted data, never invented. */
function stageDetail(key: string, d: StageData): string | null {
  switch (key) {
    case "audio":
      return d.audio ? `${d.audio.filename} · ${formatShort(d.audio.durationMs)}` : null;
    case "transcript":
      return d.transcript ? `${d.transcript.segmentCount} segments · ${d.transcript.source}` : null;
    case "story":
      return d.plan ? `v${d.plan.version} · ${d.plan.sections.length} sections, ${d.plan.shotCount} shots · ${d.plan.status}` : null;
    case "visual-bible":
      return d.bible ? `v${d.bible.version} · ${d.bible.entities.length} entities` : null;
    case "assets":
      return d.assets.totalShots > 0 ? `${d.assets.selected}/${d.assets.totalShots} shots have a selected image` : null;
    case "timeline":
      return d.timeline ? `v${d.timeline.version} · ${d.timeline.doc.clips.length} clips · ${d.timeline.status}` : null;
    case "qa":
      return d.qa ? `${d.qa.gate} · score ${d.qa.overallScore.toFixed(2)}` : null;
    case "render":
      return d.finalRender?.artifact
        ? `${d.finalRender.artifact.width}×${d.finalRender.artifact.height} · ${formatShort(d.finalRender.artifact.durationMs)}`
        : null;
    default:
      return null;
  }
}
