"use client";

import React from "react";
import { Check, Circle, Loader2, X } from "lucide-react";
import type { OpenHealthStage, OpenHealthStageStatus } from "@/types/openhealth";
import { formatScore } from "./format";

/** Pieces the run viewer and the climb viewer share. */

export function StageIcon({ status }: { status: OpenHealthStageStatus }) {
  if (status === "done") return <Check className="h-4 w-4 text-green-600" />;
  if (status === "running") return <Loader2 className="h-4 w-4 animate-spin text-blue-600" />;
  if (status === "failed") return <X className="h-4 w-4 text-destructive" />;
  return <Circle className="h-4 w-4 text-muted-foreground/40" />;
}

export function Stages({ stages }: { stages: OpenHealthStage[] }) {
  return (
    <ol className="flex flex-wrap gap-x-6 gap-y-2" data-testid="openhealth-run-stages">
      {stages.map((stage) => (
        <li key={stage.key} className="flex items-center gap-2 text-sm" data-status={stage.status}>
          <StageIcon status={stage.status} />
          <span className={stage.status === "pending" ? "text-muted-foreground" : ""}>{stage.label}</span>
          {stage.total !== undefined && stage.total > 0 && (
            <span className="tabular-nums text-muted-foreground">
              {stage.done ?? 0}/{stage.total}
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}

/** The stage a run is at, in a few words: the one running, else the last done. */
export function describeStage(stages: OpenHealthStage[]): string | null {
  const active = stages.find((s) => s.status === "running") ?? [...stages].reverse().find((s) => s.status === "done");
  if (!active) return null;
  return active.total
    ? `${active.label.toLowerCase()} ${active.done ?? 0}/${active.total}`
    : active.label.toLowerCase();
}

export function Stat({
  label,
  value,
  sub,
  emphasis,
}: {
  label: string;
  value: React.ReactNode;
  /** A line under the value: what qualifies it. */
  sub?: React.ReactNode;
  emphasis?: boolean;
}) {
  return (
    <div className="rounded-lg border bg-card px-4 py-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`tabular-nums ${emphasis ? "text-2xl font-semibold" : "text-lg font-medium"}`}>{value}</p>
      {sub && <p className="text-xs">{sub}</p>}
    </div>
  );
}

/** The one tone for contested gold across the page, the same violet the rubric surfaces use. */
export const CONTESTED_TEXT = "text-violet-600 dark:text-violet-400";
export const CONTESTED_BADGE = "border-violet-500/40 bg-violet-500/10 text-violet-700 dark:text-violet-400";

/** The plural-safe count of contested answer-key items. */
export function contestedLabel(count: number): string {
  return `${count} contested`;
}

/** What a contested score means, for a title. */
export function contestedTitle(count: number, official: number | null): string {
  const base =
    count === 1
      ? "1 answer-key item is contested: the chart contradicts it, so it is excluded from the score."
      : `${count} answer-key items are contested: the chart contradicts them, so they are excluded from the score.`;
  return official === null ? base : `${base} The untouched benchmark score is ${formatScore(official)}.`;
}

/**
 * The note beside a score that excludes contested answer-key items: the
 * untouched score and how many were excluded. Nothing when none were.
 */
export function ContestedNote({
  official,
  contested,
  className = "",
}: {
  official: number | null;
  contested: number;
  className?: string;
}) {
  if (contested <= 0) return null;
  return (
    <span
      className={`whitespace-nowrap text-xs font-normal tabular-nums ${CONTESTED_TEXT} ${className}`}
      title={contestedTitle(contested, official)}
      data-testid="openhealth-contested-note"
    >
      {official !== null && `${formatScore(official)} official · `}
      {contestedLabel(contested)}
    </span>
  );
}

/** A score with its contested note under it, for a table cell. */
export function ScoreCell({
  value,
  official,
  contested,
}: {
  value: string;
  official: number | null;
  contested: number;
}) {
  return (
    <span className="inline-flex flex-col items-end">
      <span>{value}</span>
      <ContestedNote official={official} contested={contested} />
    </span>
  );
}

/** `must_include_findings` → "must include findings", for a gold list's name. */
export function describeGoldList(list: string): string {
  return list.replace(/_/g, " ");
}

export function DiagnosisList({
  title,
  hint,
  items,
  testId,
}: {
  title: string;
  hint: string;
  items: React.ReactNode[];
  testId: string;
}) {
  return (
    <div className="rounded-lg border bg-card" data-testid={testId}>
      <div className="border-b px-4 py-2">
        <p className="text-sm font-semibold">
          {title} <span className="font-normal tabular-nums text-muted-foreground">{items.length}</span>
        </p>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      {items.length === 0 ? (
        <p className="px-4 py-3 text-sm text-muted-foreground">None</p>
      ) : (
        <ul className="divide-y text-sm">
          {items.map((item, index) => (
            <li key={index} className="px-4 py-2">
              {item}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
