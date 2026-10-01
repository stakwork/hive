"use client";

import React from "react";
import { Check, Circle, Loader2, X } from "lucide-react";
import type { OpenHealthStage, OpenHealthStageStatus } from "@/types/openhealth";

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

export function Stat({ label, value, emphasis }: { label: string; value: React.ReactNode; emphasis?: boolean }) {
  return (
    <div className="rounded-lg border bg-card px-4 py-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`tabular-nums ${emphasis ? "text-2xl font-semibold" : "text-lg font-medium"}`}>{value}</p>
    </div>
  );
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
