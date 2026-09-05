"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { api, errorMessage } from "@/lib/client/api";
import { Button, Callout, Field, Textarea, cx } from "@/components/ui/primitives";
import { formatShort } from "@/lib/core/timecode";

const ACCEPT = ".srt,.vtt,.json,.csv,.txt";

const EXAMPLE = `1
00:00:00,000 --> 00:00:04,000
In the winter of eighteen ninety, a lighthouse keeper walked out onto the northern cliffs.

2
00:00:04,000 --> 00:00:08,000
The lamp had failed twice that month, and the shipping lanes below were crowded.`;

export function TranscriptImport({ projectId, audioDurationMs }: { projectId: string; audioDurationMs: number }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<"file" | "paste">("file");
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      if (mode === "file") {
        if (!file) throw new Error("Choose a transcript file first.");
        const form = new FormData();
        form.append("file", file);
        await api.post(`/api/v1/projects/${projectId}/transcript/import`, form);
      } else {
        if (!text.trim()) throw new Error("Paste some transcript text first.");
        await api.post(`/api/v1/projects/${projectId}/transcript/import`, { text, filename: "pasted.txt" });
      }
      router.refresh();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {error ? <Callout tone="danger">{error}</Callout> : null}

      <p className="text-xs text-ink-500">
        The voiceover is {formatShort(audioDurationMs)} long. Segments beyond that are clamped, overlaps are resolved, and
        plain text without timecodes is distributed across the audio by word weight.
      </p>

      <div role="tablist" aria-label="Import method" className="flex gap-1 rounded-lg border border-ink-800 bg-ink-850 p-1">
        {(["file", "paste"] as const).map((m) => (
          <button
            key={m}
            role="tab"
            type="button"
            aria-selected={mode === m}
            onClick={() => setMode(m)}
            disabled={busy}
            className={cx(
              "flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
              mode === m ? "bg-ink-750 text-ink-100" : "text-ink-400 hover:text-ink-200",
            )}
          >
            {m === "file" ? "Upload a file" : "Paste text"}
          </button>
        ))}
      </div>

      {mode === "file" ? (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            setFile(e.dataTransfer.files[0] ?? null);
          }}
          className={cx(
            "rounded-xl border-2 border-dashed p-8 text-center transition-colors",
            dragging ? "border-amber-accent bg-amber-accent/5" : "border-ink-700 bg-ink-850",
          )}
        >
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT}
            className="sr-only"
            disabled={busy}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          <p className="text-sm text-ink-300">
            {file ? <span className="font-medium text-ink-100">{file.name}</span> : "Drag a transcript here, or choose one"}
          </p>
          <p className="mt-1 text-xs text-ink-500">SRT, VTT, JSON, CSV or TXT</p>
          <Button type="button" size="sm" className="mt-4" onClick={() => inputRef.current?.click()} disabled={busy}>
            {file ? "Choose a different file" : "Choose file"}
          </Button>
        </div>
      ) : (
        <Field label="Transcript text" htmlFor="tx-paste" hint="Timecoded SRT/VTT is best. Plain prose also works.">
          <Textarea
            id="tx-paste"
            rows={12}
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={busy}
            placeholder={EXAMPLE}
            className="font-mono text-xs"
          />
        </Field>
      )}

      <div className="flex justify-end">
        <Button
          type="button"
          variant="primary"
          onClick={submit}
          loading={busy}
          disabled={mode === "file" ? !file : !text.trim()}
        >
          Import transcript
        </Button>
      </div>
    </div>
  );
}
