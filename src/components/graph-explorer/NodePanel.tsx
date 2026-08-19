"use client";

import React from "react";
import { AlertCircle, ArrowLeft, ArrowRight, Loader2, X } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { GraphNodeDetailResponse, GraphNodeNeighbor } from "@/types/graph-node";

const TYPE_COLORS: Record<string, string> = {
  Function: "#3b82f6",
  Class: "#8b5cf6",
  Variable: "#10b981",
  Interface: "#f59e0b",
  Method: "#6366f1",
  Module: "#ec4899",
  Default: "#64748b",
};

function nodeColor(type: string): string {
  return TYPE_COLORS[type] ?? TYPE_COLORS.Default;
}

/** Group neighbors by edge type, preserving the importance order Jarvis returned. */
function groupByEdgeType(
  neighbors: GraphNodeNeighbor[],
): Array<[string, GraphNodeNeighbor[]]> {
  const groups = new Map<string, GraphNodeNeighbor[]>();
  for (const n of neighbors) {
    const existing = groups.get(n.edge_type);
    if (existing) existing.push(n);
    else groups.set(n.edge_type, [n]);
  }
  return [...groups.entries()];
}

/** Property values can be objects/arrays — render those as JSON, not "[object Object]". */
function formatPropertyValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "object") return JSON.stringify(value, null, 2);
  return String(value);
}

/**
 * Node inspector for the Graph Explorer — a docked column, not an overlay, so
 * the canvas stays visible and clicking a linked node re-centers the graph the
 * user can still see. Mirrors GraphChatSidebar's shape on purpose: the two are
 * interchangeable neighbors of the canvas.
 */
export function NodePanel({
  refId,
  label,
  detail,
  loading,
  error,
  traceText,
  traceLoading,
  onClose,
  onFocusNeighbor,
  onTrace,
}: {
  refId: string;
  /** Optimistic title from the canvas / search hit, shown until `detail` lands. */
  label: string;
  detail: GraphNodeDetailResponse | null;
  loading: boolean;
  error: string | null;
  traceText: string | null;
  traceLoading: boolean;
  onClose: () => void;
  onFocusNeighbor: (refId: string, name: string) => void;
  onTrace: (direction: "up" | "down" | "both") => void;
}) {
  return (
    <aside
      className="flex w-[360px] shrink-0 flex-col border-l bg-background min-h-0"
      data-testid="node-detail-panel"
    >
      {/* ── Header ── */}
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <span
          className="inline-block w-3 h-3 rounded-full shrink-0"
          style={{ background: nodeColor(detail?.node.node_type ?? "") }}
        />
        <span className="text-sm font-medium truncate flex-1">
          {detail?.node.name || label}
        </span>
        {loading && (
          <Loader2
            className="h-3.5 w-3.5 animate-spin text-muted-foreground shrink-0"
            data-testid="node-detail-loading"
          />
        )}
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={onClose}
          data-testid="node-detail-close-button"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* ── Body ── */}
      <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-5">
        <div className="flex items-center gap-2 flex-wrap">
          {detail && (
            <Badge variant="secondary" data-testid="node-type-badge">
              {detail.node.node_type}
            </Badge>
          )}
          <span className="text-xs text-muted-foreground font-mono break-all">
            {refId}
          </span>
        </div>

        {error && (
          <Alert variant="destructive" data-testid="node-detail-error">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {/* Directly-linked nodes, grouped by edge type */}
        {detail && (
          <div className="space-y-2" data-testid="linked-nodes-section">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Linked Nodes ({detail.neighbors.length})
            </p>
            {detail.neighbors.length === 0 ? (
              <p className="text-sm text-muted-foreground">No directly-linked nodes.</p>
            ) : (
              <div className="space-y-3">
                {groupByEdgeType(detail.neighbors).map(([edgeType, group]) => (
                  <div key={edgeType} className="space-y-1">
                    <p className="text-xs font-mono text-muted-foreground">{edgeType}</p>
                    {group.map((neighbor) => (
                      <button
                        key={`${edgeType}-${neighbor.ref_id}`}
                        data-testid={`linked-node-${neighbor.ref_id}`}
                        onClick={() => onFocusNeighbor(neighbor.ref_id, neighbor.name)}
                        className="w-full flex items-center gap-2 px-2 py-1.5 rounded border bg-background hover:bg-accent text-left transition-colors"
                        title={`Focus ${neighbor.name || neighbor.ref_id}`}
                      >
                        {neighbor.direction === "forward" ? (
                          <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground" />
                        ) : (
                          <ArrowLeft className="h-3 w-3 shrink-0 text-muted-foreground" />
                        )}
                        <span className="text-sm truncate flex-1">
                          {neighbor.name || neighbor.ref_id}
                        </span>
                        <Badge variant="outline" className="text-xs shrink-0">
                          {neighbor.node_type}
                        </Badge>
                      </button>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Node properties */}
        {detail && Object.keys(detail.node.properties).length > 0 && (
          <div className="space-y-2" data-testid="node-properties-section">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Properties
            </p>
            {Object.entries(detail.node.properties).map(([k, v]) => (
              <div key={k} className="flex flex-col gap-0.5">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  {k}
                </span>
                <span className="text-sm break-all whitespace-pre-wrap">
                  {formatPropertyValue(v)}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Path-tracing actions */}
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Path Tracing
          </p>
          <div className="flex gap-2 flex-wrap">
            <Button
              size="sm"
              variant="outline"
              data-testid="trace-up-button"
              onClick={() => onTrace("up")}
              disabled={traceLoading}
            >
              {traceLoading ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
              Trace Upstream
            </Button>
            <Button
              size="sm"
              variant="outline"
              data-testid="trace-down-button"
              onClick={() => onTrace("down")}
              disabled={traceLoading}
            >
              Trace Downstream
            </Button>
            <Button
              size="sm"
              variant="outline"
              data-testid="trace-both-button"
              onClick={() => onTrace("both")}
              disabled={traceLoading}
            >
              Trace Both
            </Button>
          </div>

          {traceText && (
            <pre
              data-testid="trace-result"
              className="text-xs bg-muted p-3 rounded-md overflow-auto max-h-64 whitespace-pre-wrap"
            >
              {traceText}
            </pre>
          )}
        </div>
      </div>
    </aside>
  );
}
