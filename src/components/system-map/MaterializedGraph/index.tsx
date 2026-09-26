"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { MarkdownRenderer } from "@/components/MarkdownRenderer";
import { GraphVisualization } from "@/components/graph/GraphVisualization";
import type { GraphNode } from "@/components/graph/graphUtils";
import { nodeTypeColorMap, type MaterializedGraph as Graph, type MaterializedNode } from "./model";

const GRAPH_HEIGHT = 620;

function StatTile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border bg-muted/30 px-3 py-2" data-testid="materialized-stat">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-2xl font-semibold leading-tight">{value.toLocaleString()}</p>
    </div>
  );
}

function DetailPanel({ node, onClose }: { node: MaterializedNode; onClose: () => void }) {
  const entries = Object.entries(node.properties).filter(([, v]) => v !== null && v !== undefined && v !== "");
  return (
    <div
      className="absolute right-3 top-3 z-10 w-80 max-w-[70%] rounded-lg border bg-background/95 p-3 text-xs shadow-md backdrop-blur"
      data-testid="materialized-detail"
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium" title={node.name}>
            {node.name}
          </p>
          <p className="font-mono text-muted-foreground">{node.type}</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className="text-muted-foreground hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>
      {entries.length > 0 && (
        <dl className="mt-2 max-h-72 space-y-1 overflow-auto">
          {entries.map(([k, v]) => (
            <div key={k} className="grid grid-cols-[auto_1fr] gap-x-2">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="break-words font-mono text-[11px]">{typeof v === "string" ? v : JSON.stringify(v)}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

/**
 * The materialized graph: what the workflow wrote. Tiles for the counts,
 * the force-directed canvas coloured by node type, and node / edge tables
 * with a text filter. The canvas needs concrete pixels, so the container is
 * measured (the zero-size pass while the tab is hidden is ignored).
 */
export function MaterializedGraph({ graph }: { graph: Graph }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<number | null>(null);
  const [selected, setSelected] = useState<MaterializedNode | null>(null);
  const [query, setQuery] = useState("");

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

  const colorMap = useMemo(() => nodeTypeColorMap(graph.nodeTypes), [graph.nodeTypes]);
  const edgeStyle = useCallback(() => ({ stroke: "#94a3b8", strokeWidth: 1.5 }), []);
  const onNodeClick = useCallback((node: GraphNode) => setSelected(node as MaterializedNode), []);

  const q = query.trim().toLowerCase();
  const filteredNodes = useMemo(
    () => (q ? graph.nodes.filter((n) => [n.id, n.name, n.type].some((s) => s.toLowerCase().includes(q))) : graph.nodes),
    [graph.nodes, q],
  );
  const filteredEdges = useMemo(
    () =>
      q ? graph.edges.filter((e) => [e.source, e.target, e.label].some((s) => s.toLowerCase().includes(q))) : graph.edges,
    [graph.edges, q],
  );

  return (
    <div className="space-y-4" data-testid="materialized-graph">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatTile label="Nodes" value={graph.nodes.length} />
        <StatTile label="Edges" value={graph.edges.length} />
        {graph.stats.slice(0, 6).map((s) => (
          <StatTile key={s.label} label={s.label} value={s.value} />
        ))}
      </div>

      {graph.note && (
        <div className="text-sm">
          <MarkdownRenderer size="compact">{graph.note}</MarkdownRenderer>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 text-xs">
        {graph.nodeTypes.map(({ type, count }) => (
          <span key={type} className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5" data-testid="materialized-node-type">
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: colorMap[type] }} aria-hidden />
            {type}
            <span className="text-muted-foreground">{count}</span>
          </span>
        ))}
        {graph.edgeTypes.map(({ type, count }) => (
          <Badge key={`e-${type}`} variant="outline" className="font-mono text-[11px]" data-testid="materialized-edge-type">
            {type} <span className="ml-1 text-muted-foreground">{count}</span>
          </Badge>
        ))}
        {graph.danglingEdges > 0 && (
          <span className="text-muted-foreground">{graph.danglingEdges} edges reference nodes outside this output</span>
        )}
      </div>

      <Tabs defaultValue="canvas">
        <TabsList>
          <TabsTrigger value="canvas">Canvas</TabsTrigger>
          <TabsTrigger value="nodes">Nodes</TabsTrigger>
          <TabsTrigger value="edges">Edges</TabsTrigger>
        </TabsList>
        <TabsContent value="canvas" className="mt-3">
          <div
            ref={containerRef}
            className="relative w-full overflow-hidden rounded-lg border bg-muted/20"
            style={{ height: GRAPH_HEIGHT }}
            data-testid="materialized-canvas"
          >
            {width !== null && graph.nodes.length > 0 ? (
              <GraphVisualization
                nodes={graph.nodes}
                edges={graph.edges}
                width={width}
                height={GRAPH_HEIGHT}
                colorMap={colorMap}
                onNodeClick={onNodeClick}
                edgeStyleFn={edgeStyle}
              />
            ) : (
              <p className="p-6 text-sm text-muted-foreground">
                {graph.nodes.length === 0 ? "The workflow reported no nodes." : "Measuring…"}
              </p>
            )}
            {selected && <DetailPanel node={selected} onClose={() => setSelected(null)} />}
          </div>
        </TabsContent>
        <TabsContent value="nodes" className="mt-3 space-y-3">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by name, id or type"
            className="max-w-sm"
            data-testid="materialized-search"
          />
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Id</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredNodes.map((n) => (
                  <TableRow key={n.id} className="cursor-pointer" onClick={() => setSelected(n)} data-testid="materialized-node-row">
                    <TableCell className="text-sm">{n.name}</TableCell>
                    <TableCell>
                      <span className="inline-flex items-center gap-1.5 font-mono text-xs">
                        <span className="inline-block h-2 w-2 rounded-full" style={{ background: colorMap[n.type] }} aria-hidden />
                        {n.type}
                      </span>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{n.id}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>
        <TabsContent value="edges" className="mt-3 space-y-3">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by endpoint or relation"
            className="max-w-sm"
          />
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Source</TableHead>
                  <TableHead>Relation</TableHead>
                  <TableHead>Target</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredEdges.map((e, i) => (
                  <TableRow key={`${e.source}-${e.label}-${e.target}-${i}`} data-testid="materialized-edge-row">
                    <TableCell className="font-mono text-xs">{e.source}</TableCell>
                    <TableCell className="font-mono text-xs">{e.label}</TableCell>
                    <TableCell className="font-mono text-xs">{e.target}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
