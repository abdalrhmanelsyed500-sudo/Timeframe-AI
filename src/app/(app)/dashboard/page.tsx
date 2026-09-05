import Link from "next/link";
import { requireUser } from "@/lib/security/auth";
import { listProjects } from "@/lib/services/projects";
import { costSummary } from "@/lib/services/cost";
import { listJobs } from "@/lib/services/jobs";
import { nextAction, type ProjectState } from "@/lib/domain/state";
import { getStyle } from "@/lib/domain/styles";
import { PageHeader, Panel, EmptyState, LinkButton, Stat, Badge } from "@/components/ui/primitives";
import { PipelineProgress, ProjectStateBadge, JobStatusBadge } from "@/components/status";
import { RelativeTime } from "@/components/relative-time";
import { NewProjectButton } from "./new-project";

export const metadata = { title: "Projects" };
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const user = await requireUser();
  const [projects, costs, jobs] = await Promise.all([
    listProjects(user.id, { limit: 50 }),
    costSummary(user.id),
    listJobs({ userId: user.id, limit: 5, activeOnly: true }),
  ]);

  const active = projects.items.filter((p) => !["COMPLETED", "FAILED", "CANCELLED"].includes(p.status)).length;
  const completed = projects.items.filter((p) => p.status === "COMPLETED").length;

  return (
    <>
      <PageHeader
        title="Projects"
        description="Each project turns one voiceover into one finished film."
        actions={<NewProjectButton />}
      />

      <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Projects" value={projects.total} />
        <Stat label="In progress" value={active} />
        <Stat label="Completed" value={completed} tone={completed > 0 ? "ok" : undefined} />
        <Stat label="Spend (today)" value={`$${costs.todayUsd.toFixed(2)}`} />
      </div>

      {jobs.items.length > 0 ? (
        <Panel className="mb-8">
          <div className="flex items-center justify-between border-b border-ink-800 px-5 py-3">
            <h2 className="text-sm font-semibold text-ink-100">Running now</h2>
            <Link href="/jobs" className="text-xs text-amber-accent hover:underline">
              All jobs
            </Link>
          </div>
          <ul className="divide-y divide-ink-800">
            {jobs.items.map((job) => (
              <li key={job.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm text-ink-200">{job.message}</p>
                  <p className="mt-0.5 text-xs text-ink-500">
                    {job.type.replace(/_/g, " ").toLowerCase()}
                    {job.total ? ` · ${job.completed}/${job.total}` : ""}
                  </p>
                </div>
                <JobStatusBadge status={job.status} />
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      {projects.items.length === 0 ? (
        <Panel>
          <EmptyState
            title="No projects yet"
            description="Start by creating a project, then upload the voiceover that will drive the whole film."
            action={<NewProjectButton />}
          />
        </Panel>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.items.map((project) => {
            const action = nextAction(project.status as ProjectState);
            return (
              <li key={project.id}>
                <Panel className="flex h-full flex-col transition-colors hover:border-ink-700">
                  <div className="flex-1 p-5">
                    <div className="flex items-start justify-between gap-3">
                      <Link href={`/projects/${project.id}`} className="min-w-0 flex-1">
                        <h3 className="truncate text-sm font-semibold text-ink-100 hover:text-amber-accent">{project.name}</h3>
                      </Link>
                      {project.archived ? <Badge tone="neutral">Archived</Badge> : null}
                    </div>
                    {project.description ? (
                      <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-ink-500">{project.description}</p>
                    ) : null}

                    <div className="mt-4">
                      <ProjectStateBadge state={project.status as ProjectState} />
                    </div>
                    <PipelineProgress state={project.status as ProjectState} className="mt-3" />

                    <dl className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-500">
                      <div className="flex gap-1.5">
                        <dt>Style</dt>
                        <dd className="text-ink-300">{getStyle(project.styleKey).name}</dd>
                      </div>
                      <div className="flex gap-1.5">
                        <dt>Format</dt>
                        <dd className="text-ink-300">
                          {project.aspectRatio} · {project.fps}fps
                        </dd>
                      </div>
                    </dl>
                  </div>

                  <div className="flex items-center justify-between gap-3 border-t border-ink-800 px-5 py-3">
                    <span className="text-xs text-ink-500">
                      Updated <RelativeTime iso={project.updatedAt} />
                    </span>
                    <LinkButton href={action.href(project.id)} size="sm" variant="secondary">
                      {action.label}
                    </LinkButton>
                  </div>
                </Panel>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
