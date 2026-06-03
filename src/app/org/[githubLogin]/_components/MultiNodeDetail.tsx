"use client";

import React, { useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import type { CanvasNode } from "system-canvas";
import type { InternalEdge } from "../connections/OrgCanvasBackground";
import { LIVE_PREFIX_RE, LiveNodeBody, AuthoredNodeBody } from "./NodeDetail";

interface MultiNodeDetailProps {
  nodes: CanvasNode[];
  internalEdges: InternalEdge[];
  githubLogin: string;
}

/**
 * Right-panel summary for multi-node selections (Shift-click, Cmd+A,
 * or lasso). Shows a count + category breakdown, a scrollable node
 * list, and an optional internal-connections section for edges that
 * run between the selected nodes on the same canvas.
 *
 * Each row in the SELECTED list is an accordion: clicking it expands
 * an inline detail view (same content as the single-node Details
 * panel). Only one row can be open at a time.
 *
 * Mirrors `NodeDetail`'s layout exactly:
 *   – header: `px-4 pt-4 pb-3 border-b`
 *   – body: `flex-1 overflow-y-auto p-4`
 */
export function MultiNodeDetail({ nodes, internalEdges, githubLogin }: MultiNodeDetailProps) {
  const categoryBreakdown = buildCategoryBreakdown(nodes);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="px-4 pt-4 pb-3 border-b">
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
          MULTI-SELECT
        </div>
        <div className="font-medium mt-0.5">
          {nodes.length} nodes selected
        </div>
        {categoryBreakdown && (
          <div className="text-xs text-muted-foreground mt-1">
            {categoryBreakdown}
          </div>
        )}
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Node list */}
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-2">
            SELECTED
          </div>
          <ul className="space-y-1">
            {nodes.map((node) => {
              const isExpanded = expandedId === node.id;
              const isLive = LIVE_PREFIX_RE.test(node.id);
              return (
                <li key={node.id} className="rounded-md border border-transparent hover:border-border/50 overflow-hidden">
                  <button
                    type="button"
                    aria-expanded={isExpanded}
                    onClick={() => setExpandedId((prev) => prev === node.id ? null : node.id)}
                    className="w-full flex items-center gap-2 px-2 py-1.5 text-left hover:bg-muted/30 rounded-md transition-colors"
                  >
                    {isExpanded ? (
                      <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    )}
                    <span className="w-16 shrink-0 truncate text-[10px] uppercase text-muted-foreground">
                      {node.category ?? "node"}
                    </span>
                    <span className="truncate text-sm">
                      {node.text || node.id}
                    </span>
                  </button>
                  {isExpanded && (
                    <div className="border-t px-3 pb-3 pt-2">
                      {isLive ? (
                        <LiveNodeBody nodeId={node.id} githubLogin={githubLogin} />
                      ) : (
                        <AuthoredNodeBody node={node} />
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>

        {/* Internal connections — only rendered when ≥1 edge exists */}
        {internalEdges.length > 0 && (
          <div className="border-t pt-3">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-2">
              INTERNAL CONNECTIONS
            </div>
            <ul className="space-y-2">
              {internalEdges.map(({ edge, fromLabel, toLabel }) => (
                <li key={edge.id} className="min-w-0">
                  <div className="text-sm truncate">
                    {fromLabel}
                    <span className="mx-1 text-muted-foreground">→</span>
                    {toLabel}
                  </div>
                  {edge.label && (
                    <div className="text-xs text-muted-foreground truncate mt-0.5">
                      {edge.label}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Builds a human-readable category breakdown string.
 * e.g. "3 workspaces · 2 notes"
 */
function buildCategoryBreakdown(nodes: CanvasNode[]): string {
  const counts = nodes.reduce<Record<string, number>>((acc, node) => {
    const cat = node.category ?? "node";
    acc[cat] = (acc[cat] ?? 0) + 1;
    return acc;
  }, {});

  return Object.entries(counts)
    .map(([cat, count]) => `${count} ${pluralise(cat, count)}`)
    .join(" · ");
}

/** Simple English plural — appends "s" unless the word already ends in "s". */
function pluralise(word: string, count: number): string {
  if (count === 1) return word;
  return word.endsWith("s") ? word : `${word}s`;
}
