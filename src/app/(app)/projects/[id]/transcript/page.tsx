import { requireUser } from "@/lib/security/auth";
import { requireProject } from "@/lib/services/projects";
import { getAudio } from "@/lib/services/audio";
import { getTranscript, allSegments } from "@/lib/services/transcript";
import { latestStoryPlan } from "@/lib/services/story";
import { Panel, PanelHeader, Callout, LinkButton } from "@/components/ui/primitives";
import { TranscriptWorkspace } from "./workspace";
import { TranscriptImport } from "./import";

export const metadata = { title: "Transcript" };
export const dynamic = "force-dynamic";

export default async function TranscriptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  await requireProject(id, user.id);

  const audio = await getAudio(id);

  if (!audio) {
    return (
      <Panel>
        <PanelHeader title="Transcript" />
        <div className="p-8 text-center">
          <p className="text-sm text-ink-300">The voiceover has to be uploaded first.</p>
          <p className="mx-auto mt-2 max-w-md text-xs text-ink-500">
            Transcript segments are aligned against the audio duration, so there is nothing to align to yet.
          </p>
          <LinkButton href={`/projects/${id}/audio`} variant="primary" size="sm" className="mt-5">
            Upload voiceover
          </LinkButton>
        </div>
      </Panel>
    );
  }

  const [transcript, plan] = await Promise.all([getTranscript(id), latestStoryPlan(id)]);
  const segments = transcript ? await allSegments(id) : [];

  if (!transcript) {
    return (
      <div className="mx-auto max-w-3xl">
        <Panel>
          <PanelHeader
            title="Import a transcript"
            description="SRT, WebVTT, JSON, CSV or plain text. Timecodes are normalised to integer milliseconds and clamped to the audio."
          />
          <div className="p-5">
            <TranscriptImport projectId={id} audioDurationMs={audio.durationMs} />
          </div>
        </Panel>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {plan ? (
        <Callout tone="warn" title="The story has already been analysed">
          Editing segments now marks the story plan out of date; you will need to re-run the analysis so the shots match
          the corrected narration.
        </Callout>
      ) : null}

      <TranscriptWorkspace
        projectId={id}
        storageKey={audio.storageKey}
        audioDurationMs={audio.durationMs}
        initialSegments={segments}
        source={transcript.source}
        language={transcript.language}
      />
    </div>
  );
}
