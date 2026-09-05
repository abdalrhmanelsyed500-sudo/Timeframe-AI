import { requireUser } from "@/lib/security/auth";
import { requireProject } from "@/lib/services/projects";
import { getAudio } from "@/lib/services/audio";
import { getTranscript } from "@/lib/services/transcript";
import { loadEnv } from "@/lib/env";
import { findFfprobe } from "@/lib/render/ffmpeg";
import { Panel, PanelHeader, Callout, LinkButton, KeyValue } from "@/components/ui/primitives";
import { formatShort } from "@/lib/core/timecode";
import { AudioUploader } from "./uploader";
import { AudioPlayer } from "@/components/project/audio-player";

export const metadata = { title: "Voiceover" };
export const dynamic = "force-dynamic";

function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export default async function AudioPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  await requireProject(id, user.id);

  const [audio, transcript] = await Promise.all([getAudio(id), getTranscript(id)]);
  const env = loadEnv();
  const probeAvailable = Boolean(findFfprobe());

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        {!probeAvailable ? (
          <Callout tone="danger" title="Audio analysis is unavailable">
            ffprobe was not found on the server, so uploaded audio cannot be measured. Uploading is disabled because the
            duration it produces is what the entire timeline is built on.
          </Callout>
        ) : null}

        <Panel>
          <PanelHeader
            title={audio ? "Replace the voiceover" : "Upload the voiceover"}
            description="This audio becomes the master timeline. Every shot, transition and render is measured against it."
          />
          <div className="p-5">
            <AudioUploader
              projectId={id}
              maxBytes={env.MAX_UPLOAD_BYTES}
              disabled={!probeAvailable}
              hasExisting={Boolean(audio)}
              hasTranscript={Boolean(transcript)}
            />
          </div>
        </Panel>

        {audio ? (
          <Panel>
            <PanelHeader title="Preview" description="Played from your own storage, streamed with range requests." />
            <div className="p-5">
              <AudioPlayer projectId={id} storageKey={audio.storageKey} durationMs={audio.durationMs} />
            </div>
          </Panel>
        ) : null}
      </div>

      <aside className="space-y-6">
        {audio ? (
          <>
            <Panel>
              <PanelHeader title="Master audio" />
              <div className="px-5 py-1">
                <KeyValue
                  items={[
                    ["File", <span key="f" className="max-w-[11rem] truncate">{audio.filename}</span>],
                    ["Duration", formatShort(audio.durationMs)],
                    ["Exact length", `${audio.durationMs} ms`],
                    ["Codec", audio.codec ?? "unknown"],
                    ["Sample rate", audio.sampleRate ? `${audio.sampleRate} Hz` : "unknown"],
                    ["Channels", audio.channels ?? "unknown"],
                    ["Size", bytes(audio.bytes)],
                    ["Content hash", <code key="h" className="font-mono text-[10px]">{audio.contentHash.slice(0, 16)}…</code>],
                  ]}
                />
              </div>
            </Panel>

            <Panel>
              <PanelHeader title="Next step" />
              <div className="space-y-3 p-5">
                <p className="text-xs text-ink-400">
                  {transcript
                    ? `A transcript with ${transcript.segmentCount} segments is already aligned to this audio.`
                    : "Import a transcript so the narration can be aligned to the audio."}
                </p>
                <LinkButton href={`/projects/${id}/transcript`} variant="primary" size="sm" className="w-full">
                  {transcript ? "Open transcript" : "Import transcript"}
                </LinkButton>
              </div>
            </Panel>
          </>
        ) : (
          <Panel>
            <PanelHeader title="Requirements" />
            <div className="space-y-3 p-5 text-xs leading-relaxed text-ink-400">
              <p>Accepted formats: MP3, WAV, M4A, AAC and FLAC.</p>
              <p>Maximum size: {Math.round(env.MAX_UPLOAD_BYTES / 1024 / 1024)} MB.</p>
              <p>Minimum length: one second.</p>
              <p className="text-ink-500">
                Files are checked by their actual magic bytes, not their extension, and probed with ffprobe before anything
                is stored.
              </p>
            </div>
          </Panel>
        )}
      </aside>
    </div>
  );
}
