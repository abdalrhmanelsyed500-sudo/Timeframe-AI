import * as React from "react";
import Link from "next/link";

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

// ---------------------------------------------------------------------------
// Surfaces
// ---------------------------------------------------------------------------

export function Panel({
  children,
  className,
  as: Tag = "div",
}: {
  children: React.ReactNode;
  className?: string;
  as?: "div" | "section" | "article" | "aside";
}) {
  return (
    <Tag className={cx("rounded-[14px] border border-ink-800 bg-ink-900", className)}>{children}</Tag>
  );
}

export function PanelHeader({
  title,
  description,
  actions,
  id,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  id?: string;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4 border-b border-ink-800 px-5 py-4">
      <div className="min-w-0">
        <h2 id={id} className="text-sm font-semibold tracking-wide text-ink-100">
          {title}
        </h2>
        {description ? <p className="mt-1 text-sm text-ink-400">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md";

const BUTTON_BASE =
  "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50";

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-amber-accent text-ink-950 hover:bg-[#ffb840] disabled:hover:bg-amber-accent",
  secondary: "border border-ink-700 bg-ink-800 text-ink-100 hover:bg-ink-750 hover:border-ink-600",
  ghost: "text-ink-300 hover:bg-ink-850 hover:text-ink-100",
  danger: "border border-[#5c2626] bg-[#2a1414] text-danger hover:bg-[#3a1a1a]",
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: "px-3 py-1.5 text-xs",
  md: "px-4 py-2 text-sm",
};

export function buttonClass(variant: ButtonVariant = "secondary", size: ButtonSize = "md", className?: string) {
  return cx(BUTTON_BASE, BUTTON_VARIANTS[variant], BUTTON_SIZES[size], className);
}

export function Button({
  variant = "secondary",
  size = "md",
  className,
  loading,
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}) {
  return (
    <button {...rest} disabled={rest.disabled || loading} className={buttonClass(variant, size, className)}>
      {loading ? <Spinner /> : null}
      {children}
    </button>
  );
}

export function LinkButton({
  href,
  variant = "secondary",
  size = "md",
  className,
  children,
}: {
  href: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Link href={href} className={buttonClass(variant, size, className)}>
      {children}
    </Link>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cx("tf-spin inline-block size-3.5 rounded-full border-2 border-current border-t-transparent", className)}
    />
  );
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

export type Tone = "neutral" | "ok" | "warn" | "danger" | "info" | "accent";

const TONE_CLASSES: Record<Tone, string> = {
  neutral: "bg-ink-800 text-ink-300 border-ink-700",
  ok: "bg-[#10462f] text-ok border-[#1c6b49]",
  warn: "bg-[#4a3410] text-warn border-[#6b4c17]",
  danger: "bg-[#4a1a1a] text-danger border-[#6b2626]",
  info: "bg-[#16304f] text-info border-[#204a78]",
  accent: "bg-[#7a5210] text-amber-accent border-[#a06f16]",
};

export function Badge({ tone = "neutral", children, className }: { tone?: Tone; children: React.ReactNode; className?: string }) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap",
        TONE_CLASSES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Dot({ tone = "neutral", pulse }: { tone?: Tone; pulse?: boolean }) {
  const colors: Record<Tone, string> = {
    neutral: "bg-ink-500",
    ok: "bg-ok",
    warn: "bg-warn",
    danger: "bg-danger",
    info: "bg-info",
    accent: "bg-amber-accent",
  };
  return <span aria-hidden="true" className={cx("inline-block size-2 rounded-full", colors[tone], pulse && "tf-pulse")} />;
}

export function ProgressBar({
  value,
  tone = "accent",
  label,
  className,
}: {
  /** 0–1 */
  value: number;
  tone?: Tone;
  label?: string;
  className?: string;
}) {
  const pct = Math.max(0, Math.min(100, Math.round(value * 100)));
  const fill: Record<Tone, string> = {
    neutral: "bg-ink-500",
    ok: "bg-ok",
    warn: "bg-warn",
    danger: "bg-danger",
    info: "bg-info",
    accent: "bg-amber-accent",
  };
  return (
    <div
      className={cx("h-1.5 w-full overflow-hidden rounded-full bg-ink-800", className)}
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label ?? "Progress"}
    >
      <div className={cx("h-full rounded-full transition-[width] duration-500", fill[tone])} style={{ width: `${pct}%` }} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Forms
// ---------------------------------------------------------------------------

export function Field({
  label,
  hint,
  error,
  htmlFor,
  children,
  required,
}: {
  label: string;
  hint?: string;
  error?: string | null;
  htmlFor: string;
  children: React.ReactNode;
  required?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-xs font-medium text-ink-300">
        {label}
        {required ? <span className="ml-1 text-amber-accent">*</span> : null}
      </label>
      {children}
      {error ? (
        <p className="text-xs text-danger" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-ink-500">{hint}</p>
      ) : null}
    </div>
  );
}

export const INPUT_CLASS =
  "w-full rounded-lg border border-ink-700 bg-ink-850 px-3 py-2 text-sm text-ink-100 placeholder:text-ink-500 focus:border-amber-accent focus:outline-none disabled:opacity-50";

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx(INPUT_CLASS, props.className)} />;
}

export function Textarea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cx(INPUT_CLASS, "resize-y", props.className)} />;
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={cx(INPUT_CLASS, "pr-8", props.className)} />;
}

// ---------------------------------------------------------------------------
// Feedback
// ---------------------------------------------------------------------------

export function Callout({
  tone = "info",
  title,
  children,
  className,
}: {
  tone?: Tone;
  title?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}) {
  const border: Record<Tone, string> = {
    neutral: "border-ink-700 bg-ink-850",
    ok: "border-[#1c6b49] bg-[#0e2f21]",
    warn: "border-[#6b4c17] bg-[#2e230c]",
    danger: "border-[#6b2626] bg-[#2e1212]",
    info: "border-[#204a78] bg-[#0f2136]",
    accent: "border-[#a06f16] bg-[#2e2109]",
  };
  return (
    <div className={cx("rounded-lg border px-4 py-3 text-sm", border[tone], className)} role={tone === "danger" ? "alert" : undefined}>
      {title ? <p className="font-semibold text-ink-100">{title}</p> : null}
      {children ? <div className={cx("text-ink-300", Boolean(title) && "mt-1")}>{children}</div> : null}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  icon?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
      {icon ? <div className="mb-4 text-ink-600">{icon}</div> : null}
      <p className="text-sm font-medium text-ink-200">{title}</p>
      {description ? <p className="mt-1.5 max-w-md text-sm text-ink-500">{description}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx("tf-skeleton rounded-md", className)} aria-hidden="true" />;
}

// ---------------------------------------------------------------------------
// Layout helpers
// ---------------------------------------------------------------------------

export function PageHeader({
  title,
  description,
  actions,
  breadcrumb,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  breadcrumb?: React.ReactNode;
}) {
  return (
    <header className="mb-6">
      {breadcrumb ? <div className="mb-2 text-xs text-ink-500">{breadcrumb}</div> : null}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold tracking-tight text-ink-50">{title}</h1>
          {description ? <p className="mt-1 text-sm text-ink-400">{description}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}

export function Stat({ label, value, tone }: { label: string; value: React.ReactNode; tone?: Tone }) {
  const color =
    tone === "ok" ? "text-ok" : tone === "warn" ? "text-warn" : tone === "danger" ? "text-danger" : "text-ink-100";
  return (
    <div className="rounded-lg border border-ink-800 bg-ink-850 px-4 py-3">
      <p className="text-xs text-ink-500">{label}</p>
      <p className={cx("mt-1 text-lg font-semibold tabular-nums", color)}>{value}</p>
    </div>
  );
}

export function KeyValue({ items }: { items: [string, React.ReactNode][] }) {
  return (
    <dl className="divide-y divide-ink-800">
      {items.map(([k, v]) => (
        <div key={k} className="flex items-start justify-between gap-4 py-2.5">
          <dt className="text-xs text-ink-500">{k}</dt>
          <dd className="text-right text-xs font-medium text-ink-200">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
