"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { EXTRA_TABS, WORKFLOW, stepStatus } from "@/lib/workflow";
import type { ProjectState } from "@/lib/domain/state";
import { cx } from "@/components/ui/primitives";

function CheckIcon() {
  return (
    <svg viewBox="0 0 12 12" aria-hidden="true" className="size-3">
      <path d="M2 6.2 4.6 8.8 10 3.4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * Workflow rail. Every stage is always reachable — the backend decides what is
 * permitted, and each page explains what is still required. Nothing here is
 * disabled purely on a frontend guess.
 */
export function WorkflowNav({ projectId, state }: { projectId: string; state: ProjectState }) {
  const pathname = usePathname();

  return (
    <div className="mb-6 border-b border-ink-800">
      <nav aria-label="Production stages" className="-mb-px flex gap-1 overflow-x-auto pb-px">
        <ol className="flex min-w-max items-stretch gap-1">
          {WORKFLOW.map((step, i) => {
            const href = step.href(projectId);
            const active = pathname === href;
            const status = stepStatus(step, state);
            return (
              <li key={step.key} className="flex items-center">
                <Link
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={cx(
                    "group flex items-center gap-2 border-b-2 px-3 py-2.5 text-sm whitespace-nowrap transition-colors",
                    active
                      ? "border-amber-accent text-ink-50"
                      : "border-transparent text-ink-400 hover:border-ink-600 hover:text-ink-200",
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cx(
                      "flex size-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold tabular-nums",
                      status === "done"
                        ? "bg-ok/20 text-ok"
                        : status === "current"
                          ? "bg-amber-accent text-ink-950"
                          : "border border-ink-700 text-ink-500",
                    )}
                  >
                    {status === "done" ? <CheckIcon /> : i + 1}
                  </span>
                  <span className="hidden sm:inline">{step.label}</span>
                  <span className="sm:hidden">{step.shortLabel}</span>
                  <span className="sr-only">
                    {status === "done" ? " (complete)" : status === "current" ? " (current stage)" : " (not started)"}
                  </span>
                </Link>
              </li>
            );
          })}

          <li aria-hidden="true" className="mx-2 my-2 w-px shrink-0 bg-ink-800" />

          {EXTRA_TABS.map((tab) => {
            const href = tab.href(projectId);
            const active = pathname === href;
            return (
              <li key={tab.key} className="flex items-center">
                <Link
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={cx(
                    "border-b-2 px-3 py-2.5 text-sm whitespace-nowrap transition-colors",
                    active
                      ? "border-amber-accent text-ink-50"
                      : "border-transparent text-ink-500 hover:border-ink-600 hover:text-ink-200",
                  )}
                >
                  {tab.label}
                </Link>
              </li>
            );
          })}
        </ol>
      </nav>
    </div>
  );
}
