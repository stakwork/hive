"use client";

import React, { type ReactNode } from "react";

/**
 * Editorial chrome for the run report.
 *
 * The layout follows the generator's own viewer (`viewer.html`): a sticky
 * section rail, `§`-kickered section headings, a numeric hero, and dense
 * monospace metadata — an editorial report rather than a stack of cards.
 * The palette and primitives are Hive's, so it reads as part of the app.
 */

/** `§ SECTION NAME` eyebrow above each heading. */
export function Kicker({ children }: { children: ReactNode }) {
  return (
    <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground/70 mb-2">
      <span className="text-muted-foreground/40">§ </span>
      {children}
    </div>
  );
}

export function Section({
  id,
  kicker,
  title,
  lede,
  children,
}: {
  id: string;
  kicker: string;
  title: string;
  lede?: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-6 pt-14 first:pt-2" data-testid={`run-report-section-${id}`}>
      <Kicker>{kicker}</Kicker>
      <h2 className="text-2xl font-semibold tracking-tight mb-2">{title}</h2>
      {lede && <p className="text-sm text-muted-foreground max-w-[70ch] mb-3">{lede}</p>}
      {children}
    </section>
  );
}

/**
 * Stable DOM id for sidebar deep links (agent cards, failure panels).
 * Names can carry spaces/colons/dots ("ingest: protocol-v3.docx").
 */
export function anchorId(prefix: string, name: string): string {
  return `${prefix}-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")}`;
}

/** Bordered surface — the viewer's `.panel`. */
export function Panel({
  children,
  className = "",
  tone = "default",
}: {
  children: ReactNode;
  className?: string;
  tone?: "default" | "fail";
}) {
  const toneClass =
    tone === "fail"
      ? "border-destructive/35 bg-destructive/[0.04]"
      : "border-border bg-muted/20";
  return (
    <div className={`rounded-lg border ${toneClass} p-4 ${className}`}>{children}</div>
  );
}

export function EmptyPanel({ label }: { label: string }) {
  return (
    <Panel>
      <p className="text-sm text-muted-foreground italic">{label}</p>
    </Panel>
  );
}

/** Pill-shaped metadata chip — the viewer's `.chip`. */
export function Chip({ label, value }: { label: string; value: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-0.5 font-mono text-[11px] text-muted-foreground whitespace-nowrap">
      {label}
      <b className="font-medium text-foreground">{value}</b>
    </span>
  );
}

/** Uppercase mono status badge — the viewer's `.badge`. */
export function StatusBadge({
  kind,
  children,
}: {
  kind: "pass" | "fail" | "warn" | "muted";
  children: ReactNode;
}) {
  const styles: Record<typeof kind, string> = {
    pass: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/40",
    fail: "bg-destructive/15 text-destructive border-destructive/45",
    warn: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/45",
    muted: "bg-muted text-muted-foreground border-border",
  };
  return (
    <span
      className={`inline-block rounded font-mono text-[10px] uppercase tracking-[0.08em] px-2 py-0.5 border ${styles[kind]}`}
    >
      {children}
    </span>
  );
}

/** Small mono section label used inside panels — the viewer's `.mini-h`. */
export function MiniHeading({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`font-mono text-[9.5px] uppercase tracking-[0.14em] text-muted-foreground/70 mt-3 mb-1.5 ${className}`}
    >
      {children}
    </div>
  );
}

/** Definition grid — the viewer's `.kv`. */
export function KeyValues({ data }: { data: Record<string, unknown> }) {
  const entries = Object.entries(data);
  if (entries.length === 0) {
    return <p className="text-sm text-muted-foreground italic">No data for this run.</p>;
  }
  return (
    <dl className="grid grid-cols-[minmax(0,180px)_minmax(0,1fr)] gap-x-4 gap-y-1 text-[13px]">
      {entries.map(([key, value]) => (
        <React.Fragment key={key}>
          <dt className="font-mono text-[11px] text-muted-foreground/70 pt-0.5 truncate">{key}</dt>
          <dd className="break-all">{renderValue(value)}</dd>
        </React.Fragment>
      ))}
    </dl>
  );
}

/**
 * Recursively renders an unknown value as structured React nodes.
 *
 * - Primitives → `<span>`
 * - Arrays → `<ul>` with bullet items
 * - Objects → `<dl>` key/value list
 * - depth > 5 or non-serializable → `<pre>` fallback (never throws)
 */
export function renderValue(value: unknown, depth = 0): React.ReactNode {
  // Depth cap: prevents unbounded recursion on deeply nested structures.
  if (depth > 5) {
    return (
      <pre className="text-[11px] font-mono whitespace-pre-wrap break-all bg-muted/40 rounded p-1">
        {(() => {
          try {
            return JSON.stringify(value, null, 2);
          } catch {
            return "[unserializable]";
          }
        })()}
      </pre>
    );
  }

  // Primitives
  if (
    value === null ||
    value === undefined ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return <span>{String(value)}</span>;
  }

  // Arrays
  if (Array.isArray(value)) {
    return (
      <ul className="list-disc pl-4 space-y-0.5">
        {value.map((item, i) => (
          <li key={i}>{renderValue(item, depth + 1)}</li>
        ))}
      </ul>
    );
  }

  // Objects (non-null, non-array)
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    return (
      <dl className="ml-3 space-y-0.5 text-[11px]">
        {entries.map(([key, val]) => (
          <React.Fragment key={key}>
            <dt className="font-medium">{key}</dt>
            <dd>{renderValue(val, depth + 1)}</dd>
          </React.Fragment>
        ))}
      </dl>
    );
  }

  // Last-resort fallback
  return (
    <pre className="text-[11px] font-mono whitespace-pre-wrap break-all bg-muted/40 rounded p-1">
      {(() => {
        try {
          return JSON.stringify(value, null, 2);
        } catch {
          return "[unserializable]";
        }
      })()}
    </pre>
  );
}

export function stringify(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return "[unserializable]";
  }
}

// ── Section error boundary ────────────────────────────────────────────────────

interface SectionErrorBoundaryState {
  caught: boolean;
}

/**
 * Catches render errors inside a single report section and renders
 * `<EmptyPanel>` instead of unmounting the whole page. One bad section
 * degrades independently — the rest of the report stays alive.
 */
export class SectionErrorBoundary extends React.Component<
  { children: React.ReactNode },
  SectionErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { caught: false };
  }

  static getDerivedStateFromError(): SectionErrorBoundaryState {
    return { caught: true };
  }

  override render() {
    if (this.state.caught) {
      return (
        <EmptyPanel
          label="This section couldn't be rendered."
          data-testid="run-report-section-error"
        />
      );
    }
    return this.props.children;
  }
}

/** Native-`<details>` disclosure — the viewer's `details.fold`. */
export function Fold({
  summary,
  monospace,
  children,
}: {
  summary: string;
  monospace?: boolean;
  children: ReactNode;
}) {
  return (
    <details className="group rounded-lg border border-border bg-muted/20 mt-2">
      <summary
        className={`flex cursor-pointer items-center gap-1.5 px-3 py-2 text-[12px] text-muted-foreground list-none [&::-webkit-details-marker]:hidden hover:text-foreground ${
          monospace ? "font-mono" : ""
        }`}
      >
        <span className="text-muted-foreground/50 transition-transform group-open:rotate-90">▸</span>
        <span className="truncate">{summary}</span>
      </summary>
      <div className="px-4 pb-4 pt-1 max-h-[480px] overflow-y-auto">{children}</div>
    </details>
  );
}
