"use client";
import React from "react";

import { useState, useCallback, useEffect, useRef } from "react";
import { toast } from "sonner";
import { EditorState } from "@/lib/docx-editor/editor-state";
import { findMatches, replaceInDocs, FindOpts } from "@/lib/docx-editor/find-replace";
import { EditorAction } from "@/lib/docx-editor/use-docx-editor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ChevronUp,
  ChevronDown,
  X,
  ChevronsUpDown,
  Replace,
} from "lucide-react";

type Scope = "active" | "all";

interface DocxFindReplaceProps {
  allStates: EditorState[];
  activeIndex: number;
  /** Called when the component wants to replace docs — caller updates state */
  onReplace: (newDocs: EditorState[]) => void;
  onClose: () => void;
}

export default function DocxFindReplace({
  allStates,
  activeIndex,
  onReplace,
  onClose,
}: DocxFindReplaceProps) {
  const [query, setQuery] = useState("");
  const [replacement, setReplacement] = useState("");
  const [showReplace, setShowReplace] = useState(false);
  const [scope, setScope] = useState<Scope>("active");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [matchIndex, setMatchIndex] = useState(0);
  const findInputRef = useRef<HTMLInputElement>(null);

  // Focus find input on mount
  useEffect(() => {
    findInputRef.current?.focus();
  }, []);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const opts: FindOpts = { caseSensitive };

  // Compute matches for the "N of M" counter
  const { total, matchDocIndex } = (() => {
    if (!query) return { total: 0, matchDocIndex: [] as number[] };
    const docs =
      scope === "active"
        ? [allStates[activeIndex]?.doc].filter(Boolean)
        : allStates.map((s) => s.doc);
    let t = 0;
    const indices: number[] = [];
    docs.forEach((doc, i) => {
      if (!doc) return;
      const m = findMatches(doc, query, opts, i);
      t += m.length;
      if (m.length > 0) indices.push(i);
    });
    return { total: t, matchDocIndex: indices };
  })();

  const safeMatchIndex = total > 0 ? ((matchIndex % total) + total) % total : 0;

  const handlePrev = () => setMatchIndex((i) => i - 1);
  const handleNext = () => setMatchIndex((i) => i + 1);

  const handleReplaceAll = useCallback(() => {
    if (!query) return;

    const targetDocs =
      scope === "active"
        ? allStates.map((s, i) => (i === activeIndex ? s.doc : s.doc))
        : allStates.map((s) => s.doc);

    const docsToReplace =
      scope === "active"
        ? [allStates[activeIndex]?.doc].filter(Boolean)
        : allStates.map((s) => s.doc);

    const { docs: newDocs, summary } = replaceInDocs(docsToReplace, query, replacement, opts);

    // Build updated EditorState array
    let newStates: EditorState[];
    if (scope === "active") {
      newStates = allStates.map((s, i) =>
        i === activeIndex && newDocs[0]
          ? { ...s, doc: newDocs[0], history: [...s.history, s.doc], future: [] }
          : s
      );
    } else {
      newStates = allStates.map((s, i) =>
        newDocs[i]
          ? { ...s, doc: newDocs[i], history: [...s.history, s.doc], future: [] }
          : s
      );
    }

    onReplace(newStates);

    if (summary.length === 0) {
      toast.info("No matches found");
      return;
    }

    // Show a toast per affected document
    summary.forEach(({ docIndex, count }) => {
      const doc =
        scope === "active" ? allStates[activeIndex]?.doc : allStates[docIndex]?.doc;
      const filename = doc?.filename ?? `Document ${docIndex + 1}`;
      toast.success(`${filename}: replaced ${count} occurrence${count !== 1 ? "s" : ""}`);
    });
  }, [query, replacement, scope, activeIndex, allStates, opts, onReplace]);

  return (
    <div
      className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 shadow-sm"
      role="search"
      aria-label="Find and replace"
    >
      <div className="flex items-center gap-2 px-3 py-2 flex-wrap">
        {/* Toggle replace row */}
        <Button
          size="icon-sm"
          variant="ghost"
          onClick={() => setShowReplace((v) => !v)}
          title={showReplace ? "Collapse replace" : "Expand replace"}
          className="shrink-0"
        >
          <ChevronsUpDown className="size-3.5" />
        </Button>

        {/* Find input */}
        <div className="flex items-center gap-1 flex-1 min-w-[160px]">
          <Input
            ref={findInputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setMatchIndex(0);
            }}
            placeholder="Find…"
            className="h-7 text-xs"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) handleNext();
              if (e.key === "Enter" && e.shiftKey) handlePrev();
            }}
          />
          {/* Case-sensitive toggle */}
          <button
            onClick={() => setCaseSensitive((v) => !v)}
            className={`px-1.5 py-0.5 text-xs rounded border font-mono transition-colors ${
              caseSensitive
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-transparent text-muted-foreground border-border hover:border-muted-foreground"
            }`}
            title="Case sensitive"
            aria-pressed={caseSensitive}
          >
            Aa
          </button>
        </div>

        {/* Match counter + navigation */}
        <div className="flex items-center gap-1 shrink-0">
          <span className="text-xs text-muted-foreground min-w-[4rem] text-right">
            {query ? (total === 0 ? "No results" : `${safeMatchIndex + 1} / ${total}`) : ""}
          </span>
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={handlePrev}
            disabled={total === 0}
            title="Previous match (Shift+Enter)"
          >
            <ChevronUp className="size-3.5" />
          </Button>
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={handleNext}
            disabled={total === 0}
            title="Next match (Enter)"
          >
            <ChevronDown className="size-3.5" />
          </Button>
        </div>

        {/* Scope toggle */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => setScope("active")}
            className={`px-2 py-0.5 text-xs rounded transition-colors border ${
              scope === "active"
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-transparent text-muted-foreground border-border hover:border-muted-foreground"
            }`}
          >
            This doc
          </button>
          <button
            onClick={() => setScope("all")}
            className={`px-2 py-0.5 text-xs rounded transition-colors border ${
              scope === "all"
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-transparent text-muted-foreground border-border hover:border-muted-foreground"
            }`}
          >
            All docs
          </button>
        </div>

        {/* Close */}
        <Button size="icon-sm" variant="ghost" onClick={onClose} title="Close (Esc)" className="shrink-0">
          <X className="size-3.5" />
        </Button>
      </div>

      {/* Replace row */}
      {showReplace && (
        <div className="flex items-center gap-2 px-3 pb-2 flex-wrap border-t pt-2">
          <div className="w-6 shrink-0" /> {/* spacer aligns with toggle button */}
          <Input
            value={replacement}
            onChange={(e) => setReplacement(e.target.value)}
            placeholder="Replace with…"
            className="h-7 text-xs flex-1 min-w-[160px]"
            onKeyDown={(e) => {
              if (e.key === "Enter") handleReplaceAll();
            }}
          />
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs shrink-0"
            onClick={handleReplaceAll}
            disabled={!query}
          >
            <Replace className="size-3 mr-1" />
            Replace All
          </Button>
        </div>
      )}
    </div>
  );
}
