"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { Graph2DView } from "@/components/graph-explorer/Graph2DView";
import { mergeRawGraph, type RawGraph } from "@/components/graph-explorer/walkGraph";
import type { ConnectionGroup, ConnectionItem, NodeConnections } from "@/services/graph/workbench";
import { CanvasModeToggle } from "./CanvasModeToggle";
import { CONNECTION_PAGE, connectionPageQuery, connectionsQuery } from "./queries";
import { useWorkbench } from "./store";

/** Ids of the "+N more" stand-ins; they open the next page of their group. */
const MORE_PREFIX = "more|";

interface MoreRef {
  center: string;
  group: ConnectionGroup;
  shown: number;
}

const moreLabel = (rest: number, type: string) => `+${rest.toLocaleString()} ${type}`;

/** An edge between `center` and `other`, in the group's direction. */
const link = (center: string, other: string, g: ConnectionGroup) =>
  g.outgoing ? { source: center, target: other, label: g.edge } : { source: other, target: center, label: g.edge };

/** Neighbours in one group, linked to `center`. */
const neighbours = (center: string, g: ConnectionGroup, items: ConnectionItem[]): RawGraph => ({
  nodes: items.map((item) => ({ id: item.id, label: item.name, nodeType: item.type })),
  edges: items.map((item) => link(center, item.id, g)),
});

/** The node with a sample of every edge group, plus a "+N more" node for each group's rest. */
function starOf(c: NodeConnections, more: Map<string, MoreRef>): RawGraph {
  const center = c.node.id;
  const graph: RawGraph = { nodes: [{ id: center, label: c.node.name, nodeType: c.node.type }], edges: [] };
  for (const g of c.groups) {
    const sample = neighbours(center, g, g.items);
    graph.nodes.push(...sample.nodes);
    graph.edges.push(...sample.edges);
    const rest = g.count - g.items.length;
    if (rest > 0) {
      const id = `${MORE_PREFIX}${center}|${g.edge}|${g.outgoing}|${g.other}`;
      more.set(id, { center, group: g, shown: g.items.length });
      graph.nodes.push({ id, label: moreLabel(rest, g.other), nodeType: "More" });
      graph.edges.push(link(center, id, g));
    }
  }
  return graph;
}

/**
 * The Graph Explorer's 2D view, walked from the selected node: clicking a
 * node selects it and expands it, across every node and edge type.
 */
export function GraphCanvas() {
  const { slug, selectedId, rootId, select } = useWorkbench();
  const queryClient = useQueryClient();
  const start = selectedId ?? rootId;
  const [raw, setRaw] = useState<RawGraph>({ nodes: [], edges: [] });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const expanded = useRef(new Set<string>());
  const more = useRef(new Map<string, MoreRef>());

  const expand = useCallback(
    async (id: string, fresh: boolean) => {
      if (!fresh && expanded.current.has(id)) return;
      setLoading(true);
      setError(null);
      try {
        const connections = await queryClient.fetchQuery(connectionsQuery(slug, id));
        if (fresh) {
          expanded.current = new Set();
          more.current = new Map();
        }
        expanded.current.add(id);
        const star = starOf(connections, more.current);
        setRaw((prev) => (fresh ? star : mergeRawGraph(prev, star)));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't expand that node");
      } finally {
        setLoading(false);
      }
    },
    [slug, queryClient],
  );

  /** Swap a "+N more" stand-in for the next page of its group. */
  const loadMore = useCallback(
    async (moreId: string) => {
      const ref = more.current.get(moreId);
      if (!ref) return;
      setLoading(true);
      try {
        const items = await queryClient.fetchQuery(
          connectionPageQuery(slug, {
            refId: ref.center,
            edge: ref.group.edge,
            outgoing: ref.group.outgoing,
            other: ref.group.other,
            limit: ref.shown + CONNECTION_PAGE,
          }),
        );
        ref.shown = items.length;
        const rest = ref.group.count - items.length;
        setRaw((prev) => {
          const merged = mergeRawGraph(prev, neighbours(ref.center, ref.group, items));
          if (rest > 0)
            return {
              ...merged,
              nodes: merged.nodes.map((n) => (n.id === moreId ? { ...n, label: moreLabel(rest, ref.group.other) } : n)),
            };
          return {
            nodes: merged.nodes.filter((n) => n.id !== moreId),
            edges: merged.edges.filter((e) => e.source !== moreId && e.target !== moreId),
          };
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't load more");
      } finally {
        setLoading(false);
      }
    },
    [slug, queryClient],
  );

  // A node not yet drawn starts a fresh walk; one already drawn expands in place.
  useEffect(() => {
    if (!start) return;
    void expand(start, !raw.nodes.some((n) => n.id === start));
    // Only a new selection should move the walk.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [start]);

  const onNodeSelect = useCallback(
    (id: string) => (id.startsWith(MORE_PREFIX) ? void loadMore(id) : select(id)),
    [loadMore, select],
  );

  return (
    <div className="relative h-full w-full bg-muted/20" data-testid="graph-workbench-graph">
      <Graph2DView rawGraph={raw} onNodeSelect={onNodeSelect} />
      <div className="absolute left-3 top-3 z-10 flex items-center gap-1.5 rounded-md border bg-background/95 px-2 py-1 shadow-sm">
        <CanvasModeToggle />
        <span className="mx-1 h-4 w-px bg-border" />
        <span className="text-xs tabular-nums text-muted-foreground">{raw.nodes.length} nodes</span>
        <button
          type="button"
          onClick={() => start && void expand(start, true)}
          className="rounded px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          Reset
        </button>
        {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
      </div>
      {error && <p className="absolute left-3 top-14 z-10 text-xs text-muted-foreground">{error}</p>}
      <p className="absolute bottom-3 left-3 z-10 text-[11px] text-muted-foreground">
        Click a node to open and expand it · “+N more” loads the next {CONNECTION_PAGE}
      </p>
    </div>
  );
}
