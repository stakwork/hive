"use client";

import React, { useMemo, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertCircle, FileWarning } from "lucide-react";
import { SanitizedContent } from "./SanitizedContent";
import { flattenText, findHighlightRanges } from "@/lib/run-report/derive";
import type { ProjectedSourceDoc } from "@/lib/run-report/types";

/**
 * Source document viewer with token highlighting.
 *
 * Highlighting is a PURE TRANSFORM: the sanitized tree is flattened to a text
 * index, tokens are matched against that flattened string, and the resulting
 * ranges are mapped back onto node slices during render. It never mutates the
 * DOM — `DiagramViewer` documents that imperative mark/collect/focus helpers
 * needed a MutationObserver to survive re-renders, and this avoids that class
 * of problem entirely.
 *
 * Tokens come from the bundle, so they are attacker-influenced. They are
 * length- and count-capped and matched with `indexOf`; no `RegExp` is ever
 * constructed from them.
 */

interface Props {
  doc: ProjectedSourceDoc | null;
  tokens: string[];
  /** Projection was persisted truncated — document bodies were dropped. */
  partial: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function DocumentViewerModal({ doc, tokens, partial, open, onOpenChange }: Props) {
  const { highlights, matched } = useMemo(() => {
    if (!doc?.body || tokens.length === 0) return { highlights: [], matched: true };
    const index = flattenText(doc.body);
    const ranges = findHighlightRanges(index, tokens);
    return { highlights: ranges, matched: ranges.length > 0 };
  }, [doc, tokens]);

  // Scroll the first match into view via a ref callback rather than an effect
  // keyed on the node, so it fires exactly when the element mounts.
  const scrollToFirstMatch = useCallback((node: HTMLDivElement | null) => {
    if (!node) return;
    const first = node.querySelector("mark");
    if (first) first.scrollIntoView({ block: "center" });
    else node.scrollTop = 0;
  }, []);

  const bodyMissing = !doc?.body;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-4xl max-h-[85vh] flex flex-col"
        data-testid="run-report-document-modal"
      >
        <DialogHeader>
          <DialogTitle className="truncate">{doc?.title ?? "Document"}</DialogTitle>
        </DialogHeader>

        {partial && (
          <div
            className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200"
            data-testid="run-report-truncation-notice"
          >
            <FileWarning className="h-4 w-4 mt-0.5 shrink-0" />
            <span>
              This report was stored in truncated form because it exceeded the size limit.
              Document text is unavailable; titles and references are preserved.
            </span>
          </div>
        )}

        {!partial && !matched && tokens.length > 0 && (
          <div
            className="flex items-start gap-2 rounded-md border border-muted bg-muted/40 p-3 text-sm text-muted-foreground"
            data-testid="run-report-no-match-notice"
          >
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>
              Couldn&apos;t locate this passage in the document — it may have been reworded
              or split during conversion. Showing the document from the top.
            </span>
          </div>
        )}

        <div
          ref={scrollToFirstMatch}
          className="overflow-y-auto flex-1 prose prose-sm dark:prose-invert max-w-none [&_table]:block [&_table]:overflow-x-auto"
          data-testid="run-report-document-body"
        >
          {bodyMissing ? (
            <p className="text-sm text-muted-foreground italic">
              No document text available for this report.
            </p>
          ) : (
            <SanitizedContent nodes={doc.body!} highlights={highlights} />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
