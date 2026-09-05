"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api, errorMessage } from "@/lib/client/api";
import { formatTimecode, formatShort, parseTimecode } from "@/lib/core/timecode";
import { AudioPlayer, type AudioPlayerHandle } from "@/components/project/audio-player";
import { Button, Callout, Input, Panel, PanelHeader, Badge, cx, LinkButton } from "@/components/ui/primitives";

interface Segment {
  id: string;
  idx: number;
  startMs: number;
  endMs: number;
  text: string;
}

/**
 * Transcript workspace.
 *
 * Integer milliseconds are canonical everywhere in state; human timecodes are
 * only a display/entry format. Segment text is DATA — it is never interpreted
 * as an instruction here or downstream.
 */
export function TranscriptWorkspace({
  projectId,
  storageKey,
  audioDurationMs,
  initialSegments,
  source,
  language,
}: {
  projectId: string;
  storageKey: string;
  audioDurationMs: number;
  initialSegments: Segment[];
  source: string;
  language: string;
}) {
  const router = useRouter();
  const playerRef = useRef<AudioPlayerHandle>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const [segments, setSegments] = useState<Segment[]>(initialSegments);
  const [positionMs, setPositionMs] = useState(0);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [follow, setFollow] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setSegments(initialSegments), [initialSegments]);

  const activeId = useMemo(() => {
    const hit = segments.find((s) => positionMs >= s.startMs && positionMs < s.endMs);
    return hit?.id ?? null;
  }, [segments, positionMs]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return segments;
    return segments.filter((s) => s.text.toLowerCase().includes(q));
  }, [segments, query]);

  // Keep the playing segment in view, but never fight the user's own scrolling.
  useEffect(() => {
    if (!follow || !activeId || query) return;
    const el = listRef.current?.querySelector(`[data-seg="${activeId}"]`);
    el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [activeId, follow, query]);

  const onTimeUpdate = useCallback((ms: number) => setPositionMs(ms), []);

  async function patch(segmentId: string, body: Record<string, unknown>, optimistic?: (s: Segment) => Segment) {
    setError(null);
    setSaving(segmentId);
    const previous = segments;
    if (optimistic) setSegments((cur) => cur.map((s) => (s.id === segmentId ? optimistic(s) : s)));
    try {
      await api.patch(`/api/v1/projects/${projectId}/transcript/segments/${segmentId}`, body);
      router.refresh();
    } catch (e) {
      // The server rejected it — roll back rather than showing a false success.
      setSegments(previous);
      setError(errorMessage(e));
    } finally {
      setSaving(null);
    }
  }

  const gaps = useMemo(() => {
    const out: string[] = [];
    for (let i = 1; i < segments.length; i++) {
      if (segments[i].startMs < segments[i - 1].endMs) out.push(`Segments ${i} and ${i + 1} overlap.`);
    }
    if (segments.length && segments[segments.length - 1].endMs > audioDurationMs) {
      out.push("The last segment ends after the audio does.");
    }
    return out;
  }, [segments, audioDurationMs]);

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
      <div className="space-y-4">
        <Panel className="sticky top-[4.25rem] z-20">
          <div className="p-4">
            <AudioPlayer
              projectId={projectId}
              storageKey={storageKey}
              durationMs={audioDurationMs}
              onTimeUpdate={onTimeUpdate}
              handleRef={playerRef}
            />
          </div>
          <div className="flex flex-wrap items-center gap-3 border-t border-ink-800 px-4 py-2.5">
            <Input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search the narration…"
              aria-label="Search transcript"
              className="h-8 max-w-xs flex-1 py-1 text-xs"
            />
            <label className="flex cursor-pointer items-center gap-2 text-xs text-ink-400">
              <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} className="accent-[#f5a524]" />
              Follow playback
            </label>
            <span className="ml-auto text-xs text-ink-500 tabular-nums">
              {filtered.length}
              {query ? ` of ${segments.length}` : ""} segments
            </span>
          </div>
        </Panel>

        {error ? <Callout tone="danger">{error}</Callout> : null}
        {gaps.length > 0 ? (
          <Callout tone="warn" title="Timing problems">
            <ul className="list-disc space-y-0.5 pl-4">
              {gaps.map((g) => (
                <li key={g}>{g}</li>
              ))}
            </ul>
          </Callout>
        ) : null}

        {filtered.length === 0 ? (
          <Panel>
            <p className="px-5 py-10 text-center text-sm text-ink-500">
              No segments match “{query}”.
            </p>
          </Panel>
        ) : (
          <ul ref={listRef} className="space-y-1.5">
            {filtered.map((segment) => (
              <SegmentRow
                key={segment.id}
                segment={segment}
                active={segment.id === activeId}
                selected={segment.id === selectedId}
                saving={saving === segment.id}
                audioDurationMs={audioDurationMs}
                onSelect={() => setSelectedId((cur) => (cur === segment.id ? null : segment.id))}
                onSeek={() => {
                  playerRef.current?.seekMs(segment.startMs);
                  playerRef.current?.play();
                }}
                onSave={(body, optimistic) => patch(segment.id, body, optimistic)}
                canMerge={segment.idx > 0}
                playheadMs={positionMs}
              />
            ))}
          </ul>
        )}
      </div>

      <aside className="space-y-4">
        <Panel>
          <PanelHeader title="Transcript" />
          <dl className="divide-y divide-ink-800 px-5">
            {[
              ["Segments", String(segments.length)],
              ["Source", source],
              ["Language", language],
              ["Audio length", formatShort(audioDurationMs)],
              [
                "Coverage",
                segments.length
                  ? `${Math.round((segments.reduce((a, s) => a + (s.endMs - s.startMs), 0) / audioDurationMs) * 100)}%`
                  : "0%",
              ],
            ].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-3 py-2.5">
                <dt className="text-xs text-ink-500">{k}</dt>
                <dd className="text-xs font-medium text-ink-200">{v}</dd>
              </div>
            ))}
          </dl>
        </Panel>

        <Panel>
          <PanelHeader title="Next step" />
          <div className="space-y-3 p-5">
            <p className="text-xs leading-relaxed text-ink-400">
              Story analysis reads this narration as data and plans sections, scenes and shots against the audio clock.
            </p>
            <LinkButton href={`/projects/${projectId}/story`} variant="primary" size="sm" className="w-full">
              Go to story analysis
            </LinkButton>
          </div>
        </Panel>

        <Panel>
          <PanelHeader title="Editing" />
          <ul className="space-y-2 p-5 text-xs leading-relaxed text-ink-500">
            <li>Click a segment to edit its text and timing.</li>
            <li>Use the ▶ button to jump the voiceover to that moment.</li>
            <li>Split at the playhead to break a long segment in two.</li>
            <li>All times are stored as whole milliseconds.</li>
          </ul>
        </Panel>
      </aside>
    </div>
  );
}

function SegmentRow({
  segment,
  active,
  selected,
  saving,
  audioDurationMs,
  playheadMs,
  canMerge,
  onSelect,
  onSeek,
  onSave,
}: {
  segment: Segment;
  active: boolean;
  selected: boolean;
  saving: boolean;
  audioDurationMs: number;
  playheadMs: number;
  canMerge: boolean;
  onSelect: () => void;
  onSeek: () => void;
  onSave: (body: Record<string, unknown>, optimistic?: (s: Segment) => Segment) => void;
}) {
  const [text, setText] = useState(segment.text);
  const [start, setStart] = useState(formatTimecode(segment.startMs));
  const [end, setEnd] = useState(formatTimecode(segment.endMs));
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    setText(segment.text);
    setStart(formatTimecode(segment.startMs));
    setEnd(formatTimecode(segment.endMs));
  }, [segment.text, segment.startMs, segment.endMs]);

  const dirty = text !== segment.text || start !== formatTimecode(segment.startMs) || end !== formatTimecode(segment.endMs);

  function save() {
    setLocalError(null);
    let startMs: number;
    let endMs: number;
    try {
      startMs = parseTimecode(start);
      endMs = parseTimecode(end);
    } catch {
      setLocalError("Use the format HH:MM:SS.mmm");
      return;
    }
    if (endMs <= startMs) {
      setLocalError("The end must come after the start.");
      return;
    }
    if (endMs > audioDurationMs) {
      setLocalError("The end is beyond the audio duration.");
      return;
    }
    onSave({ op: "update", text, startMs, endMs }, (s) => ({ ...s, text, startMs, endMs }));
  }

  const canSplit = playheadMs > segment.startMs + 100 && playheadMs < segment.endMs - 100;

  return (
    <li data-seg={segment.id}>
      <div
        className={cx(
          "rounded-lg border transition-colors",
          active ? "border-amber-accent/60 bg-amber-accent/5" : selected ? "border-ink-600 bg-ink-850" : "border-ink-800 bg-ink-900 hover:border-ink-700",
        )}
      >
        <div className="flex items-start gap-3 p-3">
          <button
            type="button"
            onClick={onSeek}
            aria-label={`Play from ${formatTimecode(segment.startMs)}`}
            className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md border border-ink-700 bg-ink-800 text-[10px] text-ink-300 hover:border-amber-accent hover:text-amber-accent"
          >
            <span aria-hidden="true">▶</span>
          </button>

          <button type="button" onClick={onSelect} className="min-w-0 flex-1 text-left" aria-expanded={selected}>
            <div className="flex items-center gap-2 font-mono text-[10px] tabular-nums text-ink-500">
              <span>#{segment.idx + 1}</span>
              <span>{formatTimecode(segment.startMs)}</span>
              <span aria-hidden="true">→</span>
              <span>{formatTimecode(segment.endMs)}</span>
              <span className="text-ink-600">({segment.endMs - segment.startMs} ms)</span>
              {active ? <Badge tone="accent">Playing</Badge> : null}
            </div>
            <p className="mt-1 text-sm leading-relaxed text-ink-200">{segment.text}</p>
          </button>
        </div>

        {selected ? (
          <div className="space-y-3 border-t border-ink-800 p-3">
            {localError ? (
              <p role="alert" className="text-xs text-danger">
                {localError}
              </p>
            ) : null}

            <div className="grid gap-2 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-[10px] text-ink-500">Start</span>
                <Input value={start} onChange={(e) => setStart(e.target.value)} className="h-8 py-1 font-mono text-xs" disabled={saving} />
              </label>
              <label className="block">
                <span className="mb-1 block text-[10px] text-ink-500">End</span>
                <Input value={end} onChange={(e) => setEnd(e.target.value)} className="h-8 py-1 font-mono text-xs" disabled={saving} />
              </label>
            </div>

            <label className="block">
              <span className="mb-1 block text-[10px] text-ink-500">Narration</span>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={3}
                disabled={saving}
                maxLength={2000}
                className="w-full resize-y rounded-lg border border-ink-700 bg-ink-850 px-3 py-2 text-sm text-ink-100 focus:border-amber-accent focus:outline-none"
              />
            </label>

            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="primary" onClick={save} disabled={!dirty || saving} loading={saving}>
                Save changes
              </Button>
              <Button
                size="sm"
                onClick={() => onSave({ op: "split", atMs: Math.round(playheadMs) })}
                disabled={!canSplit || saving}
                title={canSplit ? `Split at ${formatTimecode(playheadMs)}` : "Move the playhead inside this segment to split it"}
              >
                Split at playhead
              </Button>
              <Button size="sm" onClick={() => onSave({ op: "merge" })} disabled={!canMerge || saving}>
                Merge with previous
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </li>
  );
}
