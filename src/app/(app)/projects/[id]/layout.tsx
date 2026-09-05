import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/security/auth";
import { requireProject } from "@/lib/services/projects";
import { AppError } from "@/lib/errors";
import type { ProjectState } from "@/lib/domain/state";
import { getStyle } from "@/lib/domain/styles";
import { ProjectStateBadge } from "@/components/status";
import { WorkflowNav } from "@/components/project/workflow-nav";
import { LiveStatus } from "@/components/project/live-status";

export const dynamic = "force-dynamic";

export default async function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requireUser();

  let project;
  try {
    project = await requireProject(id, user.id);
  } catch (e) {
    // A project belonging to someone else is indistinguishable from one that
    // does not exist — the service already enforces that.
    if (e instanceof AppError && e.code === "NOT_FOUND") notFound();
    throw e;
  }

  const style = getStyle(project.styleKey);

  return (
    <>
      <header className="mb-5">
        <nav aria-label="Breadcrumb" className="mb-2 text-xs text-ink-500">
          <Link href="/dashboard" className="hover:text-ink-300">
            Projects
          </Link>
          <span aria-hidden="true" className="mx-1.5">/</span>
          <span className="text-ink-400">{project.name}</span>
        </nav>

        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold tracking-tight text-ink-50">{project.name}</h1>
            <p className="mt-1 text-xs text-ink-500">
              {style.name} · {project.aspectRatio} · {project.width}×{project.height} · {project.fps} fps
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <LiveStatus projectId={project.id} />
            <ProjectStateBadge state={project.status as ProjectState} />
          </div>
        </div>
      </header>

      <WorkflowNav projectId={project.id} state={project.status as ProjectState} />

      {children}
    </>
  );
}
