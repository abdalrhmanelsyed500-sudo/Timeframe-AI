import { requireUser } from "@/lib/security/auth";
import { requireProject } from "@/lib/services/projects";
import { getTranscript } from "@/lib/services/transcript";
import { latestStoryPlan, listStoryVersions } from "@/lib/services/story";
import { listAssets } from "@/lib/services/assets";
import { staleReport } from "@/lib/services/stale";
import { Panel, PanelHeader, LinkButton, Callout } from "@/components/ui/primitives";
import { StoryMap } from "./story-map";
import { StoryActions } from "./actions";

export const metadata = { title: "Story map" };
export const dynamic = "force-dynamic";

export default async function StoryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  await requireProject(id, user.id);

  const transcript = await getTranscript(id);

  if (!transcript) {
    return (
      <Panel>
        <PanelHeader title="Story map" />
        <div className="p-8 text-center">
          <p className="text-sm text-ink-300">There is no transcript to analyse yet.</p>
          <p className="mx-auto mt-2 max-w-md text-xs text-ink-500">
            Story analysis reads the narration and plans sections, scenes and shots against the audio clock.
          </p>
          <LinkButton href={`/projects/${id}/transcript`} variant="primary" size="sm" className="mt-5">
            Import transcript
          </LinkButton>
        </div>
      </Panel>
    );
  }

  const [plan, versions, stale, assets] = await Promise.all([
    latestStoryPlan(id),
    listStoryVersions(id),
    staleReport(id),
    listAssets(id, { limit: 200 }),
  ]);

  // shotId -> asset status, so the map can show real generation state.
  const assetByShot = new Map(assets.items.map((a) => [a.shotId, { status: a.status, hasSelection: Boolean(a.selectedVersionId) }]));

  if (!plan) {
    return (
      <div className="mx-auto max-w-2xl">
        <Panel>
          <PanelHeader
            title="Analyse the story"
            description="The narration is planned hierarchically — sections, then scenes, then shots — never one image per sentence."
          />
          <div className="space-y-4 p-5">
            <p className="text-sm text-ink-400">
              {transcript.segmentCount} transcript segments are ready. Analysis runs as a background job; you can leave
              this page and come back.
            </p>
            <StoryActions projectId={id} hasPlan={false} status={null} stale={false} />
          </div>
        </Panel>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {stale.storyStale ? (
        <Callout tone="warn" title="This story plan is out of date">
          The transcript or audio changed after it was generated. Re-run the analysis so the shots match the current
          narration.
        </Callout>
      ) : null}

      <Panel>
        <PanelHeader
          title={`Story plan v${plan.version}`}
          description={plan.summary || undefined}
          actions={<StoryActions projectId={id} hasPlan status={plan.status} stale={plan.stale} />}
        />
        <dl className="grid grid-cols-2 gap-px border-b border-ink-800 bg-ink-800 sm:grid-cols-5">
          {[
            ["Status", plan.status],
            ["Sections", String(plan.sections.length)],
            ["Scenes", String(plan.sections.reduce((a, s) => a + s.scenes.length, 0))],
            ["Shots", String(plan.shotCount)],
            ["Versions", String(versions.length)],
          ].map(([k, v]) => (
            <div key={k} className="bg-ink-900 px-4 py-3">
              <dt className="text-[10px] uppercase tracking-wide text-ink-500">{k}</dt>
              <dd className="mt-0.5 text-sm font-semibold text-ink-100">{v}</dd>
            </div>
          ))}
        </dl>
        <div className="flex flex-wrap gap-x-6 gap-y-1 px-5 py-3 text-[11px] text-ink-500">
          <span>
            Model: <span className="text-ink-300">{plan.provider}/{plan.model}</span>
          </span>
          <span>
            Prompt: <span className="text-ink-300">{plan.promptVersion}</span>
          </span>
          <span>
            Hash: <code className="font-mono text-ink-300">{plan.contentHash.slice(0, 16)}…</code>
          </span>
        </div>
      </Panel>

      <StoryMap projectId={id} sections={plan.sections} assetByShot={Object.fromEntries(assetByShot)} />
    </div>
  );
}
