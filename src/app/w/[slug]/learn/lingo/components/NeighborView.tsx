"use client";

import React from "react";
import { Trash2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { JargonNode } from "@/app/api/mock/lingo/nodes";
import type { NeighborEdge, NeighborNode } from "@/app/api/mock/lingo/neighbors";

interface NeighborViewProps {
  node: JargonNode;
  edges: NeighborEdge[];
  deletedEdgeIds: Set<string>;
  onDeleteEdge: (edgeRefId: string) => void;
  onNavigate: (node: NeighborNode) => void;
  onAddEdge: () => void;
}

export function NeighborView({
  node,
  edges,
  deletedEdgeIds,
  onDeleteEdge,
  onNavigate,
  onAddEdge,
}: NeighborViewProps) {
  const visibleEdges = edges.filter((e) => !deletedEdgeIds.has(e.edge_ref_id));

  return (
    <div className="flex flex-col gap-4" data-testid="neighbor-view">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <h2 className="text-xl font-bold text-foreground truncate">{node.name}</h2>
          {(node.definition ?? node.jargon_context) && (
            <p className="mt-1 text-sm text-muted-foreground line-clamp-2">
              {node.definition ?? node.jargon_context}
            </p>
          )}
          {node.jargon_candidates?.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {node.jargon_candidates.map((c) => (
                <span
                  key={c}
                  className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium text-muted-foreground bg-muted"
                >
                  {c}
                </span>
              ))}
            </div>
          )}
        </div>
        <Button
          size="sm"
          variant="outline"
          className="shrink-0"
          onClick={onAddEdge}
          data-testid="add-connection-button"
        >
          <Plus className="w-4 h-4 mr-1.5" />
          Add connection
        </Button>
      </div>

      {/* Connections */}
      <div>
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-2">
          Connections ({visibleEdges.length})
        </h3>

        {visibleEdges.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center border rounded-lg">
            No connections yet. Add one to enrich the graph.
          </p>
        ) : (
          <ul className="divide-y rounded-lg border overflow-hidden" data-testid="neighbor-edge-list">
            {visibleEdges.map((edge) => (
              <li
                key={edge.edge_ref_id}
                className="flex items-center justify-between gap-3 px-4 py-3 bg-card hover:bg-accent/50 transition-colors"
                data-testid={`neighbor-edge-${edge.edge_ref_id}`}
              >
                <button
                  className="flex-1 min-w-0 text-left text-sm font-medium text-foreground hover:text-primary truncate"
                  onClick={() => onNavigate(edge.neighbor_node)}
                  data-testid={`navigate-neighbor-${edge.neighbor_node.ref_id}`}
                >
                  {edge.neighbor_node.name}
                </button>
                <span className="shrink-0 inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium text-muted-foreground bg-muted">
                  {edge.edge_type}
                </span>
                <button
                  onClick={() => onDeleteEdge(edge.edge_ref_id)}
                  className="shrink-0 p-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                  aria-label={`Delete edge to ${edge.neighbor_node.name}`}
                  data-testid={`delete-edge-${edge.edge_ref_id}`}
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
