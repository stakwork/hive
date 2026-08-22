"use client";
import React from "react";

import { useState, useMemo } from "react";
import { EditorAction } from "@/lib/docx-editor/use-docx-editor";
import { EditorState } from "@/lib/docx-editor/editor-state";
import { TrackChangeMark, TrackChangeType, TrackChangeStatus } from "@/lib/docx-engine/types/track-changes";
import { DocxParagraph, DocxTextRun, DocxInlineNode } from "@/lib/docx-engine/types/document";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Check, X, ChevronDown, Filter } from "lucide-react";

interface TrackedChangeEntry {
  mark: TrackChangeMark;
  preview: string;
  paraId?: string;
}

function extractTrackedChanges(state: EditorState): TrackedChangeEntry[] {
  const entries: TrackedChangeEntry[] = [];
  const seen = new Set<string>();

  function processRun(run: DocxInlineNode, paraId?: string) {
    if (run.kind === "hyperlink") {
      run.runs.forEach((r) => processRun(r, paraId));
      return;
    }
    const tc = run.trackChange;
    if (!tc || tc.status !== TrackChangeStatus.PENDING || seen.has(tc.id)) return;
    seen.add(tc.id);
    const preview =
      run.kind === "text"
        ? run.text.slice(0, 80) + (run.text.length > 80 ? "…" : "")
        : `[${run.kind}]`;
    entries.push({ mark: tc, preview, paraId });
  }

  for (const block of state.doc.blocks) {
    if (block.kind === "paragraph") {
      block.runs.forEach((r) => processRun(r, block.id));
    } else {
      block.rows.forEach((row) =>
        row.cells.forEach((cell) =>
          cell.paragraphs.forEach((para) => para.runs.forEach((r) => processRun(r, para.id)))
        )
      );
    }
  }
  return entries;
}

/** Simple hash to pick a consistent color from an author name */
function authorColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xffffffff;
  const colors = ["bg-blue-500", "bg-purple-500", "bg-pink-500", "bg-emerald-500", "bg-orange-500", "bg-teal-500"];
  return colors[Math.abs(h) % colors.length];
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

interface DocxTrackChangeBarProps {
  /** States for all open documents. */
  allStates: EditorState[];
  /** Index of the active document. */
  activeIndex: number;
  /** Dispatch to a specific document. */
  dispatch: (docIndex: number, action: EditorAction) => void;
}

export default function DocxTrackChangeBar({ allStates, activeIndex, dispatch }: DocxTrackChangeBarProps) {
  const [filterAuthors, setFilterAuthors] = useState<Set<string>>(new Set());
  const [fromDate, setFromDate] = useState<string>("");
  const [toDate, setToDate] = useState<string>("");

  const activeState = allStates[activeIndex];
  const allChanges = useMemo(() => (activeState ? extractTrackedChanges(activeState) : []), [activeState]);

  const authors = useMemo(() => [...new Set(allChanges.map((c) => c.mark.author))], [allChanges]);

  const filtered = useMemo(() => {
    return allChanges.filter((c) => {
      if (filterAuthors.size > 0 && !filterAuthors.has(c.mark.author)) return false;
      const d = new Date(c.mark.date).getTime();
      if (fromDate && d < new Date(fromDate).getTime()) return false;
      if (toDate && d > new Date(toDate + "T23:59:59").getTime()) return false;
      return true;
    });
  }, [allChanges, filterAuthors, fromDate, toDate]);

  const toggleAuthor = (a: string) => {
    setFilterAuthors((prev) => {
      const next = new Set(prev);
      if (next.has(a)) next.delete(a);
      else next.add(a);
      return next;
    });
  };

  const acceptOne = (changeId: string) => dispatch(activeIndex, { type: "ACCEPT_CHANGE", changeId });
  const rejectOne = (changeId: string) => dispatch(activeIndex, { type: "REJECT_CHANGE", changeId });
  const acceptAll = () => dispatch(activeIndex, { type: "ACCEPT_ALL_CHANGES" });
  const rejectAll = () => dispatch(activeIndex, { type: "REJECT_ALL_CHANGES" });
  const acceptAllDocs = () => allStates.forEach((_, i) => dispatch(i, { type: "ACCEPT_ALL_CHANGES" }));
  const rejectAllDocs = () => allStates.forEach((_, i) => dispatch(i, { type: "REJECT_ALL_CHANGES" }));

  const typeLabel = (type: TrackChangeType) => {
    if (type === TrackChangeType.INSERTION) return "Insert";
    if (type === TrackChangeType.DELETION) return "Delete";
    return "Replace";
  };

  const typeBadgeVariant = (type: TrackChangeType): "default" | "destructive" | "secondary" => {
    if (type === TrackChangeType.INSERTION) return "default";
    if (type === TrackChangeType.DELETION) return "destructive";
    return "secondary";
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-3 border-b space-y-2 flex-none">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Track Changes</span>
          <span className="text-xs text-muted-foreground">
            {filtered.length} of {allChanges.length}
          </span>
        </div>

        {/* Author filter chips */}
        {authors.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {authors.map((a) => (
              <button
                key={a}
                onClick={() => toggleAuthor(a)}
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium transition-colors border ${
                  filterAuthors.has(a)
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-muted text-muted-foreground border-transparent hover:border-muted-foreground"
                }`}
              >
                <span className={`inline-block w-2 h-2 rounded-full ${authorColor(a)}`} />
                {a}
              </button>
            ))}
          </div>
        )}

        {/* Date range */}
        <div className="flex gap-1 items-center">
          <input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            className="text-xs border rounded px-1.5 py-0.5 bg-background w-full"
            placeholder="From"
            aria-label="Filter from date"
          />
          <span className="text-muted-foreground text-xs">–</span>
          <input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            className="text-xs border rounded px-1.5 py-0.5 bg-background w-full"
            placeholder="To"
            aria-label="Filter to date"
          />
        </div>
      </div>

      {/* Change cards */}
      <ScrollArea className="flex-1">
        <div className="p-2 space-y-2">
          {filtered.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-6">No pending changes</p>
          )}
          {filtered.map(({ mark, preview }) => (
            <div key={mark.id} className="rounded-md border bg-card p-2 space-y-1.5">
              <div className="flex items-center gap-2">
                <span
                  className={`inline-flex items-center justify-center size-6 rounded-full text-white text-xs font-semibold shrink-0 ${authorColor(mark.author)}`}
                >
                  {mark.author.charAt(0).toUpperCase()}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium truncate">{mark.author}</p>
                  <p className="text-xs text-muted-foreground">{relativeTime(mark.date)}</p>
                </div>
                <Badge variant={typeBadgeVariant(mark.type)} className="text-xs shrink-0">
                  {typeLabel(mark.type)}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground line-clamp-2 font-mono bg-muted rounded px-1.5 py-1">
                {preview || "(empty)"}
              </p>
              <div className="flex gap-1">
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 px-2 text-xs text-green-600 hover:text-green-700 hover:bg-green-50 dark:hover:bg-green-950/30"
                  onClick={() => acceptOne(mark.id)}
                >
                  <Check className="size-3 mr-1" />
                  Accept
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 px-2 text-xs text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/30"
                  onClick={() => rejectOne(mark.id)}
                >
                  <X className="size-3 mr-1" />
                  Reject
                </Button>
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>

      {/* Footer */}
      <div className="border-t p-2 flex-none space-y-1">
        <div className="flex gap-1">
          <Button size="sm" variant="outline" className="flex-1 text-xs h-7 text-green-600 hover:text-green-700" onClick={acceptAll}>
            <Check className="size-3 mr-1" /> Accept All
          </Button>
          <Button size="sm" variant="outline" className="flex-1 text-xs h-7 text-red-600 hover:text-red-700" onClick={rejectAll}>
            <X className="size-3 mr-1" /> Reject All
          </Button>
        </div>
        {allStates.length > 1 && (
          <div className="flex gap-1">
            <Button size="sm" variant="ghost" className="flex-1 text-xs h-7 text-green-600 hover:text-green-700" onClick={acceptAllDocs}>
              <Check className="size-3 mr-1" /> All Docs
            </Button>
            <Button size="sm" variant="ghost" className="flex-1 text-xs h-7 text-red-600 hover:text-red-700" onClick={rejectAllDocs}>
              <X className="size-3 mr-1" /> All Docs
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
