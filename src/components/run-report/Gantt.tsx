"use client";

import React from "react";
import {
  buildGantt,
  formatDuration,
  PHASE_CLASS,
  PHASE_LABEL,
  type WorkflowPhase,
} from "@/lib/run-report/derive";
import { EmptyPanel } from "./chrome";

/**
 * Pipeline timeline as a real gantt: steps positioned on a SHARED absolute time
 * axis, so concurrency shows as overlap and idle time shows as gaps. A chart of
 * per-step durations would hide both.
 *
 * Layout only — all arithmetic lives in `buildGantt`.
 */

interface Props {
  steps: Array<{ name: string; startMs: number | null; endMs: number | null }>;
}

export function Gantt({ steps }: Props) {
  const layout = buildGantt(steps);

  if (!layout) {
    return <EmptyPanel label="No timing data for this run." />;
  }

  const phasesPresent = [...new Set(layout.bars.map((b) => b.phase))] as WorkflowPhase[];

  return (
    <div className="rounded-lg border border-border bg-muted/20 overflow-hidden">
      <div className="overflow-x-auto">
        <div className="min-w-[720px] relative pt-7 pb-3">
          {/* Axis ticks behind the bars */}
          <div className="absolute inset-y-0 left-[200px] right-4 pointer-events-none">
            {layout.ticks.map((tick, i) => (
              <div
                key={i}
                className="absolute inset-y-0 border-l border-dashed border-border/60"
                style={{ left: `${tick.leftPct}%` }}
              >
                <span className="absolute top-1.5 left-1 font-mono text-[9px] text-muted-foreground/60 whitespace-nowrap">
                  {tick.label}
                </span>
              </div>
            ))}
          </div>

          {/* One row per step */}
          <div className="relative">
            {layout.bars.map((bar, i) => (
              <div key={`${bar.name}-${i}`} className="relative h-5 group">
                <div className="absolute left-0 w-[192px] top-0.5 text-right font-mono text-[10.5px] text-muted-foreground truncate pr-2">
                  {bar.name}
                </div>
                <div className="absolute left-[200px] right-4 top-0 bottom-0">
                  <div
                    className={`absolute top-1 h-3 rounded-sm ${PHASE_CLASS[bar.phase]} opacity-90 group-hover:opacity-100 transition-opacity`}
                    style={{ left: `${bar.leftPct}%`, width: `${bar.widthPct}%` }}
                    title={`${bar.name} · ${formatDuration(bar.durationMs)}`}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-4 border-t border-border px-4 py-2.5 font-mono text-[10.5px] text-muted-foreground">
        {phasesPresent.map((phase) => (
          <span key={phase} className="inline-flex items-center gap-1.5">
            <i className={`inline-block h-2.5 w-2.5 rounded-sm ${PHASE_CLASS[phase]}`} />
            {PHASE_LABEL[phase]}
          </span>
        ))}
        <span className="ml-auto">total {formatDuration(layout.totalMs)}</span>
      </div>
    </div>
  );
}
