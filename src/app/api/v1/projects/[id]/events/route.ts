import { requireUser } from "@/lib/security/auth";
import { requireProject } from "@/lib/services/projects";
import { listJobs } from "@/lib/services/jobs";
import { latestTimeline } from "@/lib/services/timeline";
import { listRenders } from "@/lib/services/render";
import { assetsReadyReport } from "@/lib/services/assets";
import { errorResponse } from "@/lib/api/handler";
import { requestId as newRequestId } from "@/lib/core/ids";
import { contentHash } from "@/lib/core/hash";

export const dynamic = "force-dynamic";

/**
 * Live progress stream.
 *
 * SSE IS NOT THE SOURCE OF TRUTH — it is a push transport over the database
 * state. Clients that disconnect simply refetch the REST snapshot and
 * reconnect; no event is required for correctness.
 */
export async function GET(request: Request, route: { params: Promise<{ id: string }> }): Promise<Response> {
  const requestId = newRequestId();
  try {
    const user = await requireUser();
    const { id } = await route.params;
    const project = await requireProject(id, user.id);

    const encoder = new TextEncoder();
    let closed = false;

    const stream = new ReadableStream({
      async start(controller) {
        const send = (event: string, data: unknown) => {
          if (closed) return;
          try {
            controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
          } catch {
            closed = true;
          }
        };

        send("open", { projectId: project.id, requestId, note: "State in the database is authoritative." });

        let lastHash = "";
        const tick = async () => {
          if (closed) return;
          try {
            const [jobs, renders, assets, timeline] = await Promise.all([
              listJobs({ userId: user.id, projectId: project.id, limit: 10 }),
              listRenders(project.id, 3),
              assetsReadyReport(project.id),
              latestTimeline(project.id),
            ]);
            const snapshot = {
              jobs: jobs.map((j) => ({
                id: j.id,
                type: j.type,
                status: j.status,
                progress: j.progress,
                message: j.message,
                completed: j.completed,
                total: j.total,
                failed: j.failed,
                errorMessage: j.errorMessage,
              })),
              renders: renders.map((r) => ({ id: r.id, status: r.status, stage: r.stage, progress: r.progress })),
              assets,
              timelineVersion: timeline?.version ?? null,
            };
            const hash = contentHash(snapshot);
            if (hash !== lastHash) {
              lastHash = hash;
              send("state", snapshot);
            } else {
              send("ping", { t: Date.now() });
            }
          } catch {
            send("error", { message: "Live updates were interrupted. The page will keep working; refresh to resync." });
          }
        };

        await tick();
        const interval = setInterval(tick, 1500);

        const abort = () => {
          closed = true;
          clearInterval(interval);
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        };
        request.signal.addEventListener("abort", abort, { once: true });
      },
      cancel() {
        closed = true;
      },
    });

    return new Response(stream, {
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no",
      },
    });
  } catch (e) {
    return errorResponse(e, requestId, null);
  }
}
