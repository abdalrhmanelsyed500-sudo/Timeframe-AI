"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { Button, Callout, ProgressBar, cx } from "@/components/ui/primitives";

const ACCEPT = ".mp3,.wav,.m4a,.aac,.flac,audio/*";
const KNOWN_EXTENSIONS = ["mp3", "wav", "m4a", "aac", "flac"];

type Phase = "idle" | "uploading" | "processing" | "done" | "error";

export function AudioUploader({
  projectId,
  maxBytes,
  disabled,
  hasExisting,
  hasTranscript,
}: {
  projectId: string;
  maxBytes: number;
  disabled?: boolean;
  hasExisting: boolean;
  hasTranscript: boolean;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const xhrRef = useRef<XMLHttpRequest | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const busy = phase === "uploading" || phase === "processing";

  function choose(next: File | null) {
    setError(null);
    if (!next) {
      setFile(null);
      return;
    }
    if (next.size > maxBytes) {
      setError(`"${next.name}" is ${(next.size / 1024 / 1024).toFixed(1)} MB, over the ${Math.round(maxBytes / 1024 / 1024)} MB limit.`);
      setFile(null);
      return;
    }
    if (next.size === 0) {
      setError(`"${next.name}" is empty.`);
      setFile(null);
      return;
    }
    const ext = next.name.split(".").pop()?.toLowerCase() ?? "";
    if (!KNOWN_EXTENSIONS.includes(ext) && !next.type.startsWith("audio/")) {
      // The server re-checks the real magic bytes; this is only a fast hint.
      setError(`"${next.name}" does not look like an audio file. Accepted: ${KNOWN_EXTENSIONS.join(", ").toUpperCase()}.`);
      setFile(null);
      return;
    }
    setFile(next);
    setPhase("idle");
    setProgress(0);
  }

  function upload() {
    if (!file) return;
    setError(null);
    setPhase("uploading");
    setProgress(0);

    // XHR (not fetch) because it is the only way to report real upload progress.
    const xhr = new XMLHttpRequest();
    xhrRef.current = xhr;
    const form = new FormData();
    form.append("file", file);

    xhr.upload.addEventListener("progress", (e) => {
      if (e.lengthComputable) setProgress(e.loaded / e.total);
    });
    xhr.upload.addEventListener("load", () => {
      // Bytes are all sent; the server is now sniffing and probing them.
      setPhase("processing");
    });
    xhr.addEventListener("load", () => {
      xhrRef.current = null;
      let payload: { data?: unknown; error?: { message: string } } = {};
      try {
        payload = JSON.parse(xhr.responseText);
      } catch {
        /* handled below */
      }
      if (xhr.status >= 200 && xhr.status < 300 && payload.data) {
        setPhase("done");
        setProgress(1);
        router.refresh();
      } else {
        setPhase("error");
        setError(payload.error?.message ?? "The upload failed. Please try again.");
      }
    });
    xhr.addEventListener("error", () => {
      xhrRef.current = null;
      setPhase("error");
      setError("The upload could not reach the server. Check your connection and try again.");
    });
    xhr.addEventListener("abort", () => {
      xhrRef.current = null;
      setPhase("idle");
      setProgress(0);
    });

    xhr.open("POST", `/api/v1/projects/${projectId}/audio`);
    const csrf = document.cookie.match(/(?:^|;\s*)tf_csrf=([^;]+)/);
    if (csrf) xhr.setRequestHeader("x-csrf-token", decodeURIComponent(csrf[1]));
    xhr.send(form);
  }

  function cancel() {
    xhrRef.current?.abort();
  }

  return (
    <div className="space-y-4">
      {hasExisting && hasTranscript ? (
        <Callout tone="warn" title="Replacing the audio invalidates downstream work">
          The transcript, story, timeline and any renders were aligned to the current audio. Uploading a different file
          marks them out of date and they will need to be rebuilt.
        </Callout>
      ) : null}

      {error ? <Callout tone="danger">{error}</Callout> : null}
      {phase === "done" ? <Callout tone="ok">Audio uploaded and measured. The master timeline is set.</Callout> : null}

      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled && !busy) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (disabled || busy) return;
          choose(e.dataTransfer.files[0] ?? null);
        }}
        className={cx(
          "rounded-xl border-2 border-dashed p-8 text-center transition-colors",
          dragging ? "border-amber-accent bg-amber-accent/5" : "border-ink-700 bg-ink-850",
          (disabled || busy) && "opacity-60",
        )}
      >
        <input
          ref={inputRef}
          id="audio-file"
          type="file"
          accept={ACCEPT}
          className="sr-only"
          disabled={disabled || busy}
          onChange={(e) => choose(e.target.files?.[0] ?? null)}
        />
        <p className="text-sm text-ink-300">
          {file ? (
            <span className="font-medium text-ink-100">{file.name}</span>
          ) : (
            "Drag an audio file here, or choose one"
          )}
        </p>
        {file ? <p className="mt-1 text-xs text-ink-500">{(file.size / 1024 / 1024).toFixed(2)} MB</p> : null}
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <Button type="button" onClick={() => inputRef.current?.click()} disabled={disabled || busy} size="sm">
            {file ? "Choose a different file" : "Choose file"}
          </Button>
          {file && !busy ? (
            <Button type="button" variant="primary" size="sm" onClick={upload} disabled={disabled}>
              {hasExisting ? "Replace voiceover" : "Upload voiceover"}
            </Button>
          ) : null}
          {busy ? (
            <Button type="button" variant="danger" size="sm" onClick={cancel} disabled={phase === "processing"}>
              Cancel
            </Button>
          ) : null}
        </div>
      </div>

      {busy ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs text-ink-400">
            <span>{phase === "uploading" ? "Uploading…" : "Verifying and measuring the file…"}</span>
            {phase === "uploading" ? <span className="tabular-nums">{Math.round(progress * 100)}%</span> : null}
          </div>
          <ProgressBar value={phase === "processing" ? 1 : progress} tone={phase === "processing" ? "info" : "accent"} label="Upload progress" />
          {phase === "processing" ? (
            <p className="text-xs text-ink-500">
              The server is checking the file signature and probing its duration with ffprobe. This cannot be cancelled.
            </p>
          ) : null}
        </div>
      ) : null}

      {phase === "error" ? (
        <Button type="button" size="sm" onClick={upload} disabled={!file}>
          Retry upload
        </Button>
      ) : null}
    </div>
  );
}
