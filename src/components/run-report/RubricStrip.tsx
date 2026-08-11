"use client";

import React from "react";
import type { RubricRow } from "@/lib/run-report/derive";

/**
 * Rubric scoreboard as a heat-strip: one cell per criterion, coloured by
 * verdict, clickable to jump to the detail below.
 *
 * The whole point is that a reader sees the shape of the run — 1 of 3, with the
 * failures clustered — before reading a single word. A list of rows cannot do
 * that at a glance.
 */

interface Props {
  rows: RubricRow[];
  onSelect: (rubricId: string) => void;
}

export function RubricStrip({ rows, onSelect }: Props) {
  if (rows.length === 0) return null;

  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(56px,1fr))] gap-1.5 my-4">
      {rows.map((row) => (
        <button
          key={row.id}
          type="button"
          onClick={() => onSelect(row.id)}
          title={`${row.id} — ${row.title}`}
          data-testid="run-report-rubric-cell"
          className={`aspect-[1.35] rounded-md border flex flex-col items-center justify-center font-mono transition-transform hover:-translate-y-0.5 ${
            row.passed
              ? "bg-emerald-500/10 border-emerald-500/35 text-emerald-600 dark:text-emerald-400"
              : "bg-destructive/15 border-destructive/50 text-destructive"
          }`}
        >
          <span className="text-[13px] font-semibold">{row.passed ? "✓" : "✕"}</span>
          <span className="text-[8.5px] opacity-75 mt-0.5 truncate max-w-full px-1">{row.id}</span>
        </button>
      ))}
    </div>
  );
}

/** All / Passed / Failed filter pills — the viewer's `.fbtn`. */
export function FilterPills({
  value,
  onChange,
  counts,
}: {
  value: "all" | "pass" | "fail";
  onChange: (next: "all" | "pass" | "fail") => void;
  counts: { all: number; pass: number; fail: number };
}) {
  const options: Array<{ key: "all" | "pass" | "fail"; label: string }> = [
    { key: "all", label: `All ${counts.all}` },
    { key: "pass", label: `Passed ${counts.pass}` },
    { key: "fail", label: `Failed ${counts.fail}` },
  ];

  return (
    <div className="flex gap-2 mb-3">
      {options.map((option) => (
        <button
          key={option.key}
          type="button"
          onClick={() => onChange(option.key)}
          data-testid={`run-report-filter-${option.key}`}
          className={`font-mono text-[11px] px-3 py-1 rounded-full border transition-colors ${
            value === option.key
              ? "border-primary/60 bg-primary/10 text-primary"
              : "border-border text-muted-foreground hover:text-foreground"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
