import Link from "next/link";
import { getCurrentUser } from "@/lib/security/auth";
import { loadEnv } from "@/lib/env";
import { findFfmpeg } from "@/lib/render/ffmpeg";
import { LinkButton, Badge, Panel } from "@/components/ui/primitives";

export const dynamic = "force-dynamic";

const PIPELINE = [
  { n: "01", title: "Voiceover", body: "Your narration audio is probed with ffprobe and becomes the authoritative master timeline. Every downstream timecode is an integer millisecond against it." },
  { n: "02", title: "Transcript", body: "SRT, VTT, JSON, CSV or plain text is parsed, normalised and aligned. Overlaps are resolved; nothing drifts out of the audio." },
  { n: "03", title: "Story analysis", body: "Long narration is planned hierarchically into sections, scenes and shots with a running summary — never one image per sentence." },
  { n: "04", title: "Visual bible", body: "A style guide and an entity registry keep people, places and objects consistent from the first shot to the last." },
  { n: "05", title: "Image generation", body: "A canonical prompt compiler produces provider-independent prompts. Every image is QC'd by a vision model and versioned immutably." },
  { n: "06", title: "Timeline", body: "A deterministic builder assigns motion, transitions and text. The same input always produces the same timeline hash." },
  { n: "07", title: "Cinematic QA", body: "Pacing, diversity, continuity, composition and narration alignment are scored before anything is rendered." },
  { n: "08", title: "Render", body: "FFmpeg encodes h264/aac in validated chunks. A render is only COMPLETED once ffprobe proves the file matches the plan." },
];

const PRINCIPLES = [
  { title: "No fake progress", body: "Every progress bar reflects a real row in the database. If a stage did not run, the UI says so." },
  { title: "No silent fallbacks", body: "A missing provider is a CONFIGURATION_ERROR, not a quiet switch to mock output. A failed encode never yields a 'finished' video." },
  { title: "Your keys, encrypted", body: "Provider credentials are sealed with AES-256-GCM and never sent to the browser — only the last four characters are ever shown." },
  { title: "Resumable by design", body: "State lives in PostgreSQL. Close the tab, restart the worker, come back tomorrow — the pipeline picks up where it stopped." },
];

export default async function LandingPage() {
  const user = await getCurrentUser().catch(() => null);
  const env = loadEnv();
  const renderAvailable = Boolean(findFfmpeg());

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-ink-800/80 bg-ink-950/85 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-4">
          <Link href="/" className="flex items-center gap-2.5">
            <span aria-hidden="true" className="flex size-7 items-center justify-center rounded-md bg-amber-accent text-sm font-bold text-ink-950">
              T
            </span>
            <span className="text-sm font-semibold tracking-tight">Timeframe AI</span>
          </Link>
          <nav className="flex items-center gap-2">
            {user ? (
              <LinkButton href="/dashboard" variant="primary" size="sm">
                Open dashboard
              </LinkButton>
            ) : (
              <>
                <LinkButton href="/login" variant="ghost" size="sm">
                  Sign in
                </LinkButton>
                <LinkButton href="/register" variant="primary" size="sm">
                  Create account
                </LinkButton>
              </>
            )}
          </nav>
        </div>
      </header>

      <main id="main">
        {/* Hero */}
        <section className="tf-grid border-b border-ink-800">
          <div className="mx-auto max-w-6xl px-6 py-20 sm:py-28">
            <div className="flex flex-wrap items-center gap-2">
              {env.DEMO_MODE ? (
                <Badge tone="warn">Demo mode — generated content is mock and clearly labelled</Badge>
              ) : (
                <Badge tone="ok">Live providers enabled</Badge>
              )}
              {renderAvailable ? <Badge tone="neutral">FFmpeg ready</Badge> : <Badge tone="danger">Rendering unavailable</Badge>}
            </div>

            <h1 className="mt-6 max-w-3xl text-4xl font-semibold leading-[1.1] tracking-tight text-ink-50 sm:text-6xl">
              A voiceover in.
              <br />
              A finished documentary out.
            </h1>
            <p className="mt-6 max-w-2xl text-base leading-relaxed text-ink-300 sm:text-lg">
              Timeframe AI reads your narration, plans the story, designs a consistent visual world, generates and
              quality-checks every frame, cuts a deterministic timeline and renders a real, validated MP4. No template.
              No stock montage. No fake progress bars.
            </p>

            <div className="mt-9 flex flex-wrap gap-3">
              <LinkButton href={user ? "/dashboard" : "/register"} variant="primary">
                {user ? "Open dashboard" : "Start a project"}
              </LinkButton>
              <LinkButton href={user ? "/settings" : "/login"} variant="secondary">
                {user ? "Configure providers" : "Sign in"}
              </LinkButton>
            </div>

            <dl className="mt-16 grid grid-cols-2 gap-px overflow-hidden rounded-[14px] border border-ink-800 bg-ink-800 sm:grid-cols-4">
              {[
                ["Master clock", "Voiceover audio"],
                ["Timecode precision", "1 ms integers"],
                ["Output", "h264 / aac MP4"],
                ["Validation", "ffprobe verified"],
              ].map(([label, value]) => (
                <div key={label} className="bg-ink-900 px-5 py-4">
                  <dt className="text-xs text-ink-500">{label}</dt>
                  <dd className="mt-1 text-sm font-semibold text-ink-100">{value}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        {/* Pipeline */}
        <section className="border-b border-ink-800">
          <div className="mx-auto max-w-6xl px-6 py-20">
            <h2 className="text-2xl font-semibold tracking-tight text-ink-50">The pipeline</h2>
            <p className="mt-2 max-w-2xl text-sm text-ink-400">
              Eight persistent, resumable stages. Each one writes an immutable version, so you can always see what
              changed, roll back, and rebuild only what went stale.
            </p>
            <div className="mt-10 grid gap-px overflow-hidden rounded-[14px] border border-ink-800 bg-ink-800 sm:grid-cols-2 lg:grid-cols-4">
              {PIPELINE.map((s) => (
                <div key={s.n} className="bg-ink-900 p-5">
                  <span className="font-mono text-xs text-amber-accent">{s.n}</span>
                  <h3 className="mt-2 text-sm font-semibold text-ink-100">{s.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-ink-400">{s.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Principles */}
        <section>
          <div className="mx-auto max-w-6xl px-6 py-20">
            <h2 className="text-2xl font-semibold tracking-tight text-ink-50">How it behaves under stress</h2>
            <p className="mt-2 max-w-2xl text-sm text-ink-400">
              The interesting part of an AI video tool is not the happy path — it is what happens when a provider is
              missing, a job dies, or an encode fails.
            </p>
            <div className="mt-10 grid gap-4 sm:grid-cols-2">
              {PRINCIPLES.map((p) => (
                <Panel key={p.title} className="p-5">
                  <h3 className="text-sm font-semibold text-ink-100">{p.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-ink-400">{p.body}</p>
                </Panel>
              ))}
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-ink-800">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-6 py-8 text-xs text-ink-500">
          <p>Timeframe AI — automated documentary production.</p>
          <p className="font-mono">{env.DEMO_MODE ? "DEMO_MODE=true" : "production providers"}</p>
        </div>
      </footer>
    </div>
  );
}
