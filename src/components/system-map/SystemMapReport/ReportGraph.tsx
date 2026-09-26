"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { GraphVisualization } from "@/components/graph/GraphVisualization";
import type { GraphNode } from "@/components/graph/graphUtils";
import { VERDICTS, type ReportFilter, type ReportNodeType, type SystemMapReport } from "./model";
import { buildGraphElements, edgeStyleForLabel, VERDICT_COLOR_MAP, VERDICT_HEX, type ReportGraphNode } from "./graph-model";
import { VerdictBadge, VERDICT_STYLE } from "./verdict";

const GRAPH_HEIGHT = 620;

function DetailPanel({ item, onClose }: { item: ReportNodeType; onClose: () => void }) {
  return (
    <div
      className="absolute right-3 top-3 z-10 w-72 max-w-[70%] rounded-lg border bg-background/95 p-3 text-xs shadow-md backdrop-blur"
      data-testid="system-map-graph-detail"
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate font-mono text-sm" title={item.type}>
            {item.type}
          </p>
          {item.parent && <p className="text-muted-foreground">child of {item.parent}</p>}
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className="text-muted-foreground hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="mt-2">
        <VerdictBadge verdict={item.verdict} />
      </div>
      {item.reason && <p className="mt-2 italic text-muted-foreground">{item.reason}</p>}
      {item.evidence.length > 0 && (
        <ul className="mt-2 space-y-1">
          {item.evidence.map((line, i) => (
            <li key={i} className="break-words font-mono text-[11px] leading-snug text-muted-foreground">
              {line}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {VERDICTS.map((v) => {
        const Icon = VERDICT_STYLE[v].icon;
        return (
          <span key={v} className="inline-flex items-center gap-1">
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: VERDICT_HEX[v] }} aria-hidden />
            <Icon className={cn("h-3.5 w-3.5", VERDICT_STYLE[v].text)} aria-hidden />
            {VERDICT_STYLE[v].label}
          </span>
        );
      })}
      <span className="inline-flex items-center gap-1.5">
        <svg width="28" height="6" aria-hidden>
          <line x1="0" y1="3" x2="28" y2="3" stroke={VERDICT_HEX.MISSING} strokeWidth="1" strokeDasharray="4 3" />
        </svg>
        child of
      </span>
      <span className="inline-flex items-center gap-1.5">
        <svg width="28" height="6" aria-hidden>
          <line x1="0" y1="3" x2="28" y2="3" stroke={VERDICT_HEX.MATCH} strokeWidth="2.5" />
        </svg>
        relation
      </span>
    </div>
  );
}

/**
 * The report as a force-directed graph — the same canvas the Graph
 * Explorer's 2D view uses. `GraphVisualization` needs concrete pixels, so
 * the container is measured (as `Graph2DView` does) and the zero-size pass
 * while the tab is hidden is ignored.
 */
export function ReportGraph({ report, filter }: { report: SystemMapReport; filter: ReportFilter }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<number | null>(null);
  const [showMissingRelations, setShowMissingRelations] = useState(false);
  const [selected, setSelected] = useState<ReportNodeType | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      const w = Math.round(entry.contentRect.width);
      if (w < 1) return;
      setWidth((prev) => (prev !== null && Math.abs(prev - w) < 1 ? prev : w));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const elements = useMemo(
    () => buildGraphElements(report, { filter, showMissingRelations }),
    [report, filter, showMissingRelations],
  );

  const onNodeClick = useCallback((node: GraphNode) => setSelected((node as ReportGraphNode).item), []);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-4">
        <Legend />
        <label className="ml-auto inline-flex items-center gap-2 text-xs text-muted-foreground">
          <Checkbox
            checked={showMissingRelations}
            onCheckedChange={(v) => setShowMissingRelations(v === true)}
            data-testid="system-map-graph-missing-toggle"
          />
          <Label className="cursor-pointer text-xs font-normal">
            Show missing relations
            {elements.hiddenMissingRelations > 0 && ` (${elements.hiddenMissingRelations})`}
          </Label>
        </label>
        <p className="text-xs text-muted-foreground" data-testid="system-map-graph-count">
          {elements.nodes.length} types · {elements.edges.length} edges
        </p>
      </div>
      <div
        ref={containerRef}
        className="relative w-full overflow-hidden rounded-lg border bg-muted/20"
        style={{ height: GRAPH_HEIGHT }}
        data-testid="system-map-graph"
      >
        {width !== null && elements.nodes.length > 0 ? (
          <GraphVisualization
            nodes={elements.nodes}
            edges={elements.edges}
            width={width}
            height={GRAPH_HEIGHT}
            colorMap={VERDICT_COLOR_MAP}
            onNodeClick={onNodeClick}
            edgeStyleFn={edgeStyleForLabel}
          />
        ) : (
          <p className="p-6 text-sm text-muted-foreground">
            {elements.nodes.length === 0 ? "No node types match the current filter." : "Measuring…"}
          </p>
        )}
        {selected && <DetailPanel item={selected} onClose={() => setSelected(null)} />}
      </div>
    </div>
  );
}
