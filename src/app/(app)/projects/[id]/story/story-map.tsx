"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, errorMessage } from "@/lib/client/api";
import { formatTimecode, formatShort } from "@/lib/core/timecode";
import { CAMERAS, LENSES, VISUAL_INTENTS } from "@/lib/domain/vocab";
import { Badge, Button, Callout, Panel, Select, cx, type Tone } from "@/components/ui/primitives";

interface Shot {
  id: string;
  sceneId: string;
  idx: number;
  startMs: number;
  endMs: number;
  narrationText: string;
  visualIntent: string;
  subject: string;
  action: string;
  environment: string;
  composition: string;
  camera: string;
  lens: string;
  lighting: string;
  color: string;
  atmosphere: string;
  entityNames: string[];
  transition: string;
  motion: string;
}

interface Scene {
  id: string;
  idx: number;
  title: string;
  purpose: string;
  location: string;
  era: string;
  tone: string;
  pacing: string;
  visualStrategy: string;
  startMs: number;
  endMs: number;
  shots: Shot[];
}

interface Section {
  id: string;
  idx: number;
  title: string;
  purpose: string;
  startMs: number;
  endMs: number;
  scenes: Scene[];
}

type AssetState = { status: string; hasSelection: boolean };

const ASSET_TONE: Record<string, Tone> = {
  READY: "ok",
  NEEDS_REVIEW: "warn",
  FAILED: "danger",
  GENERATING: "accent",
  QUEUED: "neutral",
};

export function StoryMap({
  projectId,
  sections,
  assetByShot,
}: {
  projectId: string;
  sections: Section[];
  assetByShot: Record<string, AssetState>;
}) {
  const [openSections, setOpenSections] = useState<Set<string>>(() => new Set(sections.map((s) => s.id)));
  const [openScenes, setOpenScenes] = useState<Set<string>>(() => new Set());
  const [selected, setSelected] = useState<Shot | null>(null);

  function toggle(set: Set<string>, id: string, apply: (s: Set<string>) => void) {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    apply(next);
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => setOpenSections(new Set(sections.map((s) => s.id)))}>
            Expand sections
          </Button>
          <Button size="sm" onClick={() => setOpenSections(new Set())}>
            Collapse all
          </Button>
          <Button size="sm" onClick={() => setOpenScenes(new Set(sections.flatMap((s) => s.scenes.map((c) => c.id))))}>
            Expand every scene
          </Button>
        </div>

        {sections.map((section) => {
          const sectionOpen = openSections.has(section.id);
          const shotCount = section.scenes.reduce((a, s) => a + s.shots.length, 0);
          return (
            <Panel key={section.id}>
              <button
                type="button"
                onClick={() => toggle(openSections, section.id, setOpenSections)}
                aria-expanded={sectionOpen}
                className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-ink-850"
              >
                <span aria-hidden="true" className={cx("mt-1 text-ink-500 transition-transform", sectionOpen && "rotate-90")}>
                  ▸
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="text-[10px] font-mono uppercase tracking-wider text-amber-accent">
                      Section {section.idx + 1}
                    </span>
                    <span className="text-sm font-semibold text-ink-100">{section.title}</span>
                  </span>
                  <span className="mt-1 block text-xs text-ink-500">{section.purpose}</span>
                  <span className="mt-1 block font-mono text-[10px] tabular-nums text-ink-600">
                    {formatTimecode(section.startMs)} → {formatTimecode(section.endMs)} ·{" "}
                    {section.scenes.length} scenes · {shotCount} shots
                  </span>
                </span>
              </button>

              {sectionOpen ? (
                <ul className="border-t border-ink-800">
                  {section.scenes.map((scene) => {
                    const sceneOpen = openScenes.has(scene.id);
                    return (
                      <li key={scene.id} className="border-b border-ink-800 last:border-b-0">
                        <button
                          type="button"
                          onClick={() => toggle(openScenes, scene.id, setOpenScenes)}
                          aria-expanded={sceneOpen}
                          className="flex w-full items-start gap-3 py-2.5 pl-10 pr-4 text-left hover:bg-ink-850"
                        >
                          <span aria-hidden="true" className={cx("mt-0.5 text-xs text-ink-600 transition-transform", sceneOpen && "rotate-90")}>
                            ▸
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="flex flex-wrap items-center gap-2">
                              <span className="text-sm font-medium text-ink-200">{scene.title}</span>
                              <Badge tone="neutral">{scene.pacing}</Badge>
                              <Badge tone="neutral">{scene.tone}</Badge>
                            </span>
                            <span className="mt-0.5 block text-xs text-ink-500">{scene.purpose}</span>
                            <span className="mt-0.5 block font-mono text-[10px] tabular-nums text-ink-600">
                              {formatTimecode(scene.startMs)} → {formatTimecode(scene.endMs)} · {scene.shots.length} shots
                              {scene.location ? ` · ${scene.location}` : ""}
                              {scene.era ? ` · ${scene.era}` : ""}
                            </span>
                          </span>
                        </button>

                        {sceneOpen ? (
                          <ul className="space-y-1 bg-ink-950/40 px-3 pb-3 pl-10 pt-1">
                            {scene.shots.map((shot) => {
                              const asset = assetByShot[shot.id];
                              const isSelected = selected?.id === shot.id;
                              return (
                                <li key={shot.id}>
                                  <button
                                    type="button"
                                    onClick={() => setSelected(isSelected ? null : shot)}
                                    aria-pressed={isSelected}
                                    className={cx(
                                      "flex w-full items-center gap-3 rounded-md border px-3 py-2 text-left transition-colors",
                                      isSelected ? "border-amber-accent bg-amber-accent/5" : "border-ink-800 bg-ink-900 hover:border-ink-700",
                                    )}
                                  >
                                    <span className="w-16 shrink-0 font-mono text-[10px] tabular-nums text-ink-500">
                                      {formatTimecode(shot.startMs).slice(3, 12)}
                                    </span>
                                    <span className="min-w-0 flex-1">
                                      <span className="block truncate text-xs text-ink-200">
                                        {shot.subject || shot.narrationText.slice(0, 70)}
                                      </span>
                                      <span className="mt-0.5 block truncate text-[10px] text-ink-600">
                                        {shot.visualIntent} · {shot.camera} · {shot.lens} · {shot.motion} · {shot.transition}
                                      </span>
                                    </span>
                                    <span className="shrink-0 font-mono text-[10px] tabular-nums text-ink-600">
                                      {((shot.endMs - shot.startMs) / 1000).toFixed(1)}s
                                    </span>
                                    {asset ? (
                                      <Badge tone={ASSET_TONE[asset.status] ?? "neutral"}>{asset.status}</Badge>
                                    ) : (
                                      <Badge tone="neutral">No image</Badge>
                                    )}
                                  </button>
                                </li>
                              );
                            })}
                          </ul>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </Panel>
          );
        })}
      </div>

      <aside className="lg:sticky lg:top-[4.25rem] lg:self-start">
        <ShotInspector projectId={projectId} shot={selected} asset={selected ? assetByShot[selected.id] : undefined} />
      </aside>
    </div>
  );
}

function ShotInspector({
  projectId,
  shot,
  asset,
}: {
  projectId: string;
  shot: Shot | null;
  asset?: AssetState;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Partial<Shot>>({});

  if (!shot) {
    return (
      <Panel>
        <div className="px-5 py-12 text-center">
          <p className="text-sm text-ink-400">No shot selected</p>
          <p className="mt-1.5 text-xs text-ink-600">Expand a scene and choose a shot to inspect its visual specification.</p>
        </div>
      </Panel>
    );
  }

  const value = <K extends keyof Shot>(k: K): Shot[K] => (draft[k] !== undefined ? (draft[k] as Shot[K]) : shot[k]);
  const dirty = Object.keys(draft).length > 0;

  async function save() {
    setError(null);
    setBusy(true);
    try {
      await api.patch(`/api/v1/projects/${projectId}/story/shots/${shot!.id}`, draft);
      setDraft({});
      router.refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel>
      <div className="border-b border-ink-800 px-5 py-4">
        <p className="text-[10px] font-mono uppercase tracking-wider text-amber-accent">Shot {shot.idx + 1}</p>
        <p className="mt-1 font-mono text-xs tabular-nums text-ink-400">
          {formatTimecode(shot.startMs)} → {formatTimecode(shot.endMs)}
          <span className="ml-2 text-ink-600">{formatShort(shot.endMs - shot.startMs)}</span>
        </p>
        {asset ? (
          <div className="mt-2">
            <Badge tone={ASSET_TONE[asset.status] ?? "neutral"}>
              Image: {asset.status}
              {asset.hasSelection ? " · selected" : ""}
            </Badge>
          </div>
        ) : null}
      </div>

      <div className="max-h-[60vh] space-y-4 overflow-y-auto px-5 py-4">
        {error ? <Callout tone="danger">{error}</Callout> : null}

        <div>
          <p className="text-[10px] uppercase tracking-wide text-ink-500">Narration</p>
          <p className="mt-1 rounded-md border border-ink-800 bg-ink-850 p-2.5 text-xs leading-relaxed text-ink-300">
            {shot.narrationText || <span className="text-ink-600">No narration on this shot.</span>}
          </p>
        </div>

        <EditableField label="Subject" value={value("subject")} onChange={(v) => setDraft((d) => ({ ...d, subject: v }))} disabled={busy} />
        <EditableField label="Action" value={value("action")} onChange={(v) => setDraft((d) => ({ ...d, action: v }))} disabled={busy} />
        <EditableField label="Environment" value={value("environment")} onChange={(v) => setDraft((d) => ({ ...d, environment: v }))} disabled={busy} />

        <div className="grid grid-cols-2 gap-2">
          <label className="block">
            <span className="mb-1 block text-[10px] uppercase tracking-wide text-ink-500">Visual intent</span>
            <Select value={value("visualIntent")} onChange={(e) => setDraft((d) => ({ ...d, visualIntent: e.target.value }))} disabled={busy} className="h-8 py-1 text-xs">
              {VISUAL_INTENTS.map((v) => (
                <option key={v} value={v}>{v}</option>
              ))}
            </Select>
          </label>
          <label className="block">
            <span className="mb-1 block text-[10px] uppercase tracking-wide text-ink-500">Lens</span>
            <Select value={value("lens")} onChange={(e) => setDraft((d) => ({ ...d, lens: e.target.value }))} disabled={busy} className="h-8 py-1 text-xs">
              {LENSES.map((v) => (
                <option key={v} value={v}>{v}</option>
              ))}
            </Select>
          </label>
        </div>

        <label className="block">
          <span className="mb-1 block text-[10px] uppercase tracking-wide text-ink-500">Camera</span>
          <Select value={value("camera")} onChange={(e) => setDraft((d) => ({ ...d, camera: e.target.value }))} disabled={busy} className="h-8 py-1 text-xs">
            {CAMERAS.map((v) => (
              <option key={v} value={v}>{v}</option>
            ))}
          </Select>
        </label>

        {dirty ? (
          <div className="space-y-2">
            <p className="rounded-md border border-amber-accent/30 bg-amber-accent/5 p-2 text-[11px] leading-relaxed text-ink-400">
              Saving marks this shot&apos;s image and the timeline as out of date, so they can be regenerated from the new
              specification.
            </p>
            <div className="flex gap-2">
              <Button size="sm" variant="primary" onClick={save} loading={busy}>
                Save shot
              </Button>
              <Button size="sm" onClick={() => setDraft({})} disabled={busy}>
                Discard
              </Button>
            </div>
          </div>
        ) : null}

        <dl className="divide-y divide-ink-800 border-t border-ink-800 pt-1">
          {[
            ["Composition", shot.composition],
            ["Lighting", shot.lighting],
            ["Colour", shot.color],
            ["Atmosphere", shot.atmosphere],
            ["Motion", shot.motion],
            ["Transition", shot.transition],
            ["Entities", shot.entityNames.length ? shot.entityNames.join(", ") : "—"],
          ].map(([k, v]) => (
            <div key={k} className="py-2">
              <dt className="text-[10px] uppercase tracking-wide text-ink-500">{k}</dt>
              <dd className="mt-0.5 text-xs text-ink-300">{v || "—"}</dd>
            </div>
          ))}
        </dl>
      </div>
    </Panel>
  );
}

function EditableField({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[10px] uppercase tracking-wide text-ink-500">{label}</span>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        rows={2}
        maxLength={300}
        className="w-full resize-y rounded-md border border-ink-700 bg-ink-850 px-2.5 py-1.5 text-xs text-ink-100 focus:border-amber-accent focus:outline-none"
      />
    </label>
  );
}

