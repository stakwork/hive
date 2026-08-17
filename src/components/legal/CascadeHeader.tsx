"use client";

import React from "react";
import { Chip } from "@/components/run-report/chrome";
import { formatTokens } from "@/components/legal/CascadeRow";
import type { CascadeSummary } from "@/lib/legal-cascade/types";

interface CascadeHeaderProps {
  summary: CascadeSummary;
  allExpanded: boolean;
  onToggleExpandAll: () => void;
}

/** Run-level summary strip above the stacked agent cascades. */
export function CascadeHeader({ summary, allExpanded, onToggleExpandAll }: CascadeHeaderProps) {
  return (
    <div
      className="flex flex-wrap items-center gap-2 px-4 py-3"
      data-testid="cascade-summary-strip"
    >
      {summary.running && (
        <span className="inline-flex items-center gap-1.5 font-mono text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
          <span className="h-2 w-2 rounded-full bg-emerald-500 motion-safe:animate-pulse" />
          running
        </span>
      )}
      <Chip label="agents" value={summary.agents} />
      <Chip label="sub-agents" value={summary.subAgents} />
      <Chip label="concepts" value={summary.concepts} />
      <Chip label="tool calls" value={summary.toolCalls} />
      <Chip label="tok" value={formatTokens(summary.totalTokens)} />
      <button
        type="button"
        onClick={onToggleExpandAll}
        data-testid="cascade-expand-all"
        className="ml-auto rounded-md border border-border px-3 py-1 font-mono text-[11px] tracking-wide text-muted-foreground transition-colors hover:border-muted-foreground/60 hover:text-foreground"
      >
        {allExpanded ? "collapse all" : "expand all"}
      </button>
    </div>
  );
}
