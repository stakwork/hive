"use client";

import React from "react";
import { type UnifiedDiff } from "@/lib/diff/unifiedLineDiff";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";

/** Section header style — consistent with "Features to attach" label in MilestoneMeta. */
export const SECTION_LABEL_CLASS =
  "text-[10px] uppercase tracking-wide text-muted-foreground font-medium";

/** Renders a {@link UnifiedDiff} as red/green rows with collapsed gaps. */
export function UnifiedDiffView({
  diff,
  emptyText = "No changes.",
}: {
  diff: UnifiedDiff;
  emptyText?: string;
}) {
  if (diff.unchanged || diff.hunks.length === 0) {
    return (
      <div className="px-1 py-2 text-xs text-muted-foreground italic">
        {emptyText}
      </div>
    );
  }
  return (
    <div className="overflow-hidden rounded border font-mono text-[11px] leading-relaxed">
      {diff.hunks.map((hunk, hi) => (
        <React.Fragment key={hi}>
          {hunk.gapBefore > 0 && (
            <div className="bg-muted/40 px-3 py-0.5 text-[10px] text-muted-foreground">
              ⋯ {hunk.gapBefore} unchanged line{hunk.gapBefore === 1 ? "" : "s"}
            </div>
          )}
          {hunk.rows.map((row, ri) => {
            const sign =
              row.type === "add" ? "+" : row.type === "del" ? "−" : " ";
            const rowClass =
              row.type === "add"
                ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                : row.type === "del"
                  ? "bg-rose-500/10 text-rose-700 dark:text-rose-300"
                  : "text-muted-foreground";
            return (
              <div key={ri} className={`flex ${rowClass}`}>
                <span className="w-4 flex-shrink-0 select-none px-1 text-center opacity-60">
                  {sign}
                </span>
                <pre className="min-w-0 flex-1 whitespace-pre-wrap break-words py-0.5 pr-2">
                  {row.text === "" ? " " : row.text}
                </pre>
              </div>
            );
          })}
        </React.Fragment>
      ))}
    </div>
  );
}

/** Diff modal for a concept documentation update (mirrors PromptDiffDialog). */
export function ConceptDiffDialog({
  open,
  onOpenChange,
  conceptName,
  diff,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conceptName?: string;
  diff: UnifiedDiff;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader className="min-w-0">
          <div className={SECTION_LABEL_CLASS}>Documentation changes</div>
          <DialogTitle className="text-base min-w-0 break-words [overflow-wrap:anywhere]">
            {conceptName ?? "Concept update"}
          </DialogTitle>
          <div className="mt-0.5 font-mono text-xs">
            <span className="text-emerald-600 dark:text-emerald-400">
              +{diff.added}
            </span>{" "}
            <span className="text-rose-600 dark:text-rose-400">
              −{diff.removed}
            </span>
          </div>
        </DialogHeader>

        <ScrollArea className="max-h-[65vh] min-w-0">
          <UnifiedDiffView diff={diff} />
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
