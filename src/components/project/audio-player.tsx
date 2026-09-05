"use client";

import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { formatTimecode } from "@/lib/core/timecode";
import { Button, cx } from "@/components/ui/primitives";

export interface AudioPlayerHandle {
  /** Seek to an absolute position in integer milliseconds. */
  seekMs: (ms: number) => void;
  play: () => void;
  pause: () => void;
}

/**
 * Voiceover player.
 *
 * Time is reported to callers in integer milliseconds; the HTML element's
 * floating-point seconds never escape this component.
 */
export function AudioPlayer({
  projectId,
  storageKey,
  durationMs,
  onTimeUpdate,
  onPlayingChange,
  handleRef,
  compact,
}: {
  projectId: string;
  storageKey: string;
  durationMs: number;
  onTimeUpdate?: (ms: number) => void;
  onPlayingChange?: (playing: boolean) => void;
  handleRef?: Ref<AudioPlayerHandle>;
  compact?: boolean;
}) {
  const ref = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [positionMs, setPositionMs] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [rate, setRate] = useState(1);

  useImperativeHandle(handleRef, () => ({
    seekMs: (ms: number) => {
      const el = ref.current;
      if (!el) return;
      el.currentTime = Math.max(0, ms) / 1000;
      setPositionMs(Math.max(0, Math.round(ms)));
    },
    play: () => void ref.current?.play().catch(() => {}),
    pause: () => ref.current?.pause(),
  }));

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let frame = 0;
    const tick = () => {
      const ms = Math.round(el.currentTime * 1000);
      setPositionMs(ms);
      onTimeUpdate?.(ms);
      frame = requestAnimationFrame(tick);
    };
    const onPlay = () => {
      setPlaying(true);
      onPlayingChange?.(true);
      frame = requestAnimationFrame(tick);
    };
    const onPause = () => {
      setPlaying(false);
      onPlayingChange?.(false);
      cancelAnimationFrame(frame);
    };
    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    el.addEventListener("ended", onPause);
    return () => {
      cancelAnimationFrame(frame);
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
      el.removeEventListener("ended", onPause);
    };
  }, [onTimeUpdate, onPlayingChange]);

  const src = `/api/v1/files/${storageKey}`;
  const pct = durationMs > 0 ? Math.min(100, (positionMs / durationMs) * 100) : 0;

  return (
    <div className="space-y-3">
      <audio
        ref={ref}
        src={src}
        preload="metadata"
        onError={() => setError("The audio file could not be loaded from storage.")}
        className="sr-only"
      >
        <track kind="captions" />
      </audio>

      {error ? (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : null}

      <div className="flex items-center gap-3">
        <Button
          type="button"
          variant="primary"
          size="sm"
          onClick={() => (playing ? ref.current?.pause() : void ref.current?.play().catch(() => {}))}
          aria-label={playing ? "Pause voiceover" : "Play voiceover"}
          className="size-9 shrink-0 !px-0"
        >
          <span aria-hidden="true">{playing ? "❚❚" : "▶"}</span>
        </Button>

        <div className="min-w-0 flex-1">
          <input
            type="range"
            min={0}
            max={Math.max(1, durationMs)}
            step={10}
            value={Math.min(positionMs, durationMs)}
            aria-label="Playback position"
            aria-valuetext={formatTimecode(positionMs)}
            onChange={(e) => {
              const ms = Number(e.target.value);
              if (ref.current) ref.current.currentTime = ms / 1000;
              setPositionMs(ms);
            }}
            className="w-full accent-[#f5a524]"
          />
          <div className="mt-1 flex justify-between font-mono text-[11px] tabular-nums text-ink-500">
            <span>{formatTimecode(positionMs)}</span>
            <span>{formatTimecode(durationMs)}</span>
          </div>
        </div>

        {!compact ? (
          <label className="flex shrink-0 items-center gap-1.5 text-xs text-ink-500">
            <span className="sr-only">Playback speed</span>
            <select
              value={rate}
              onChange={(e) => {
                const r = Number(e.target.value);
                setRate(r);
                if (ref.current) ref.current.playbackRate = r;
              }}
              className="rounded-md border border-ink-700 bg-ink-850 px-1.5 py-1 text-xs text-ink-200"
            >
              {[0.5, 0.75, 1, 1.25, 1.5, 2].map((r) => (
                <option key={r} value={r}>
                  {r}×
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>

      <div className={cx("h-1 w-full overflow-hidden rounded-full bg-ink-800", compact && "hidden")}>
        <div className="h-full bg-amber-accent transition-[width] duration-100" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
