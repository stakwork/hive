"use client";
import React from "react";

import { useEffect, useRef, useState } from "react";
import { detectClauses, ClauseEntry } from "@/lib/docx-editor/clause-detector";
import { EditorState } from "@/lib/docx-editor/editor-state";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ChevronRight } from "lucide-react";

interface DocxClauseNavProps {
  state: EditorState;
}

const DEPTH_INDENT = [0, 12, 24, 36, 48]; // px indent per depth

export default function DocxClauseNav({ state }: DocxClauseNavProps) {
  const clauses = detectClauses(state.doc);
  const [activeParaId, setActiveParaId] = useState<string | undefined>();
  const [openMap, setOpenMap] = useState<Record<string, boolean>>({});
  const observerRef = useRef<IntersectionObserver | null>(null);

  // Build IntersectionObserver to track which clause is in view
  useEffect(() => {
    if (observerRef.current) observerRef.current.disconnect();

    if (typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const id = (entry.target as HTMLElement).dataset.paraId;
            if (id) setActiveParaId(id);
          }
        }
      },
      { threshold: 0.3 }
    );

    observerRef.current = observer;
    clauses.forEach((c) => {
      const el = document.querySelector(`[data-para-id="${c.paraId}"]`);
      if (el) observer.observe(el);
    });

    return () => observer.disconnect();
  }, [clauses.length]);

  const scrollTo = (paraId: string) => {
    const el = document.querySelector(`[data-para-id="${paraId}"]`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    setActiveParaId(paraId);
  };

  const toggleOpen = (paraId: string) => {
    setOpenMap((prev) => ({ ...prev, [paraId]: !prev[paraId] }));
  };

  // Build tree: each top-level entry can have children
  // For simplicity, render a flat list with indentation
  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b flex-none">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Clause Navigator
        </span>
      </div>
      <ScrollArea className="flex-1">
        <div className="py-1">
          {clauses.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-6 px-3">
              No clauses detected
            </p>
          )}
          {clauses.map((entry) => {
            const indent = DEPTH_INDENT[Math.min(entry.depth, DEPTH_INDENT.length - 1)];
            const isActive = activeParaId === entry.paraId;
            const displayText =
              entry.text.length > 60 ? entry.text.slice(0, 60) + "…" : entry.text;

            return (
              <button
                key={entry.paraId}
                onClick={() => scrollTo(entry.paraId)}
                className={`w-full text-left px-3 py-1.5 text-xs transition-colors rounded-sm mx-1 ${
                  isActive
                    ? "bg-primary text-primary-foreground font-medium"
                    : "text-foreground hover:bg-muted"
                }`}
                style={{ paddingLeft: indent + 12 }}
                data-depth={entry.depth}
              >
                {displayText}
              </button>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}
