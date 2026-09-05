"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, errorMessage } from "@/lib/client/api";
import { Button, Callout, Field, Input, Select, Textarea } from "@/components/ui/primitives";

interface StyleOption {
  styleKey: string;
  name: string;
  description: string;
}

const ASPECTS = [
  { value: "16:9", label: "16:9 — widescreen" },
  { value: "9:16", label: "9:16 — vertical" },
  { value: "1:1", label: "1:1 — square" },
  { value: "4:5", label: "4:5 — portrait feed" },
];

const PRESETS = [
  { value: "DRAFT", label: "Draft — fastest, cheapest" },
  { value: "BALANCED", label: "Balanced — recommended" },
  { value: "HIGH", label: "High — best quality" },
];

export function NewProjectButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [styles, setStyles] = useState<StyleOption[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [styleKey, setStyleKey] = useState("");
  const [aspectRatio, setAspectRatio] = useState("16:9");
  const [qualityPreset, setQualityPreset] = useState("BALANCED");

  useEffect(() => {
    if (!open || styles) return;
    api
      .get<{ styles: StyleOption[] }>("/api/v1/styles")
      .then((d) => {
        setStyles(d.styles);
        setStyleKey((k) => k || d.styles[0]?.styleKey || "");
      })
      .catch((e) => setError(errorMessage(e)));
  }, [open, styles]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !busy && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, busy]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const project = await api.post<{ id: string }>("/api/v1/projects", {
        name,
        description: description || undefined,
        styleKey: styleKey || undefined,
        aspectRatio,
        qualityPreset,
      });
      router.push(`/projects/${project.id}/audio`);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}>
        New project
      </Button>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink-950/80 p-4 py-12 backdrop-blur-sm">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-project-title"
            className="w-full max-w-lg rounded-[14px] border border-ink-700 bg-ink-900 shadow-2xl"
          >
            <div className="border-b border-ink-800 px-5 py-4">
              <h2 id="new-project-title" className="text-sm font-semibold text-ink-100">
                New project
              </h2>
              <p className="mt-1 text-xs text-ink-500">You can change any of this later, before the visuals are generated.</p>
            </div>

            <form onSubmit={onSubmit} className="space-y-4 px-5 py-5">
              {error ? <Callout tone="danger">{error}</Callout> : null}

              <Field label="Project name" htmlFor="np-name" required>
                <Input id="np-name" required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} disabled={busy} autoFocus placeholder="The Northern Light" />
              </Field>

              <Field label="Description" htmlFor="np-desc" hint="Optional. Context for you, not for the model.">
                <Textarea id="np-desc" rows={2} maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} disabled={busy} />
              </Field>

              <Field label="Visual style" htmlFor="np-style" hint={styles?.find((s) => s.styleKey === styleKey)?.description}>
                <Select id="np-style" value={styleKey} onChange={(e) => setStyleKey(e.target.value)} disabled={busy || !styles}>
                  {styles ? (
                    styles.map((s) => (
                      <option key={s.styleKey} value={s.styleKey}>
                        {s.name}
                      </option>
                    ))
                  ) : (
                    <option>Loading styles…</option>
                  )}
                </Select>
              </Field>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Aspect ratio" htmlFor="np-aspect">
                  <Select id="np-aspect" value={aspectRatio} onChange={(e) => setAspectRatio(e.target.value)} disabled={busy}>
                    {ASPECTS.map((a) => (
                      <option key={a.value} value={a.value}>
                        {a.label}
                      </option>
                    ))}
                  </Select>
                </Field>

                <Field label="Quality" htmlFor="np-quality">
                  <Select id="np-quality" value={qualityPreset} onChange={(e) => setQualityPreset(e.target.value)} disabled={busy}>
                    {PRESETS.map((p) => (
                      <option key={p.value} value={p.value}>
                        {p.label}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>

              <div className="flex justify-end gap-2 border-t border-ink-800 pt-4">
                <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={busy}>
                  Cancel
                </Button>
                <Button type="submit" variant="primary" loading={busy} disabled={!name.trim()}>
                  Create project
                </Button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}
