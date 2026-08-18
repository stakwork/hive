"use client";

import React, { type ReactNode } from "react";
import { ChevronRight, ChevronUp } from "lucide-react";

interface PillSectionProps {
  /** Pill / panel-header label, e.g. "Agents (12)". */
  label: ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
  testId: string;
}

/**
 * A section that starts life as a small pill (popping in once its data
 * confirms there is something to show) and expands into a full panel on
 * click — the expanded run row's pattern for the Agents and Traces sections,
 * so late-loading sections don't shove the layout around.
 */
export function PillSection({ label, open, onOpenChange, children, testId }: PillSectionProps) {
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => onOpenChange(true)}
        data-testid={`${testId}-pill`}
        className="inline-flex w-fit items-center gap-1.5 rounded-full border bg-card px-3 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-top-1"
      >
        <ChevronRight className="h-3 w-3" />
        {label}
      </button>
    );
  }
  return (
    <div className="w-full rounded-lg border bg-card" data-testid={testId}>
      <button
        type="button"
        onClick={() => onOpenChange(false)}
        data-testid={`${testId}-collapse`}
        className="flex w-full items-center justify-between border-b px-4 py-3 text-left transition-colors hover:bg-muted/40"
      >
        <span className="inline-flex items-center gap-2 text-sm font-semibold">{label}</span>
        <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground" />
      </button>
      {children}
    </div>
  );
}
