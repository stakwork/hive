"use client";

import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import * as d3 from "d3";
import { Play, Loader2, AlertCircle, DatabaseZap, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ArcadeRecord {
  [key: string]: ArcadeValue;
}

type ArcadeValue =
  | string
  | number
  | boolean
  | null
  | ArcadeNode
  | ArcadeEdge;

interface ArcadeNode {
  "@type"?: string;
  "@rid"?: string;
  "@class"?: string;
  [key: string]: ArcadeValue | undefined;
}

interface ArcadeEdge {
  "@type"?: string;
  "@rid"?: string;
  "@class"?: string;
  [key: string]: ArcadeValue | undefined;
}

interface QueryResult {
  result: ArcadeRecord[];
}

interface GraphNode extends d3.SimulationNodeDatum {
  id: string;
  label: string;
  type: string;
  properties: Record<string, unknown>;
}

interface GraphLink extends d3.SimulationLinkDatum<GraphNode> {
  id: string;
  type: string;
  source: string | GraphNode;
  target: string | GraphNode;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isArcadeObject(val: unknown): val is ArcadeNode {
  return typeof val === "object" && val !== null && "@rid" in val;
}

/** Extract graph-renderable nodes and links from ArcadeDB result records */
function extractGraph(records: ArcadeRecord[]): {
  nodes: GraphNode[];
  links: GraphLink[];
} {
  const nodeMap = new Map<string, GraphNode>();
  const links: GraphLink[] = [];

  const registerNode = (obj: ArcadeNode): string => {
    const id = obj["@rid"] as string;
    if (!nodeMap.has(id)) {
      const props: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(obj)) {
        if (!k.startsWith("@")) props[k] = v;
      }
      nodeMap.set(id, {
        id,
        label: (obj.name as string) || (obj["@class"] as string) || id,
        type: (obj["@class"] as string) || "Node",
        properties: props,
      });
    }
    return id;
  };

  records.forEach((record, idx) => {
    const values = Object.values(record);
    const nodeObjects = values.filter(isArcadeObject);

    // Heuristic: first and last object are nodes, middle objects are edges
    if (nodeObjects.length >= 2) {
      const src = nodeObjects[0];
      const tgt = nodeObjects[nodeObjects.length - 1];
      const srcId = registerNode(src);
      const tgtId = registerNode(tgt);

      // Process intermediate objects as edges
      const edgeObjects = nodeObjects.slice(1, -1);
      edgeObjects.forEach((edge, ei) => {
        links.push({
          id: (edge["@rid"] as string) || `link-${idx}-${ei}`,
          type: (edge["@class"] as string) || "REL",
          source: srcId,
          target: tgtId,
        });
      });

      // If only 2 node-like objects with no middle, create a generic link
      if (edgeObjects.length === 0 && nodeObjects.length === 2) {
        links.push({
          id: `link-${idx}`,
          type: "RELATED",
          source: srcId,
          target: tgtId,
        });
      }
    } else if (nodeObjects.length === 1) {
      registerNode(nodeObjects[0]);
    }
  });

  return { nodes: Array.from(nodeMap.values()), links };
}

/** Node-type → colour mapping */
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

// ---------------------------------------------------------------------------
// Force-directed graph component
// ---------------------------------------------------------------------------

interface ForceGraphProps {
  nodes: GraphNode[];
  links: GraphLink[];
  onNodeClick: (node: GraphNode) => void;
}

function ForceGraph({ nodes, links, onNodeClick }: ForceGraphProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!svgRef.current || !containerRef.current) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    const { width, height } = containerRef.current.getBoundingClientRect();
    const W = width || 800;
    const H = height || 500;

    svg.attr("viewBox", `0 0 ${W} ${H}`);

    // Defs: arrowhead marker
    const defs = svg.append("defs");
    defs
      .append("marker")
      .attr("id", "arrowhead")
      .attr("viewBox", "0 -4 8 8")
      .attr("refX", 20)
      .attr("refY", 0)
      .attr("markerWidth", 6)
      .attr("markerHeight", 6)
      .attr("orient", "auto")
      .append("path")
      .attr("d", "M0,-4L8,0L0,4")
      .attr("fill", "#94a3b8");

    const g = svg.append("g");

    // Zoom + pan
    const zoom = d3.zoom<SVGSVGElement, unknown>().scaleExtent([0.2, 4]).on("zoom", (event) => {
      g.attr("transform", event.transform);
    });
    svg.call(zoom);

    // Clone data so D3 can mutate positions
    const simNodes: GraphNode[] = nodes.map((n) => ({ ...n }));
    const nodeById = new Map(simNodes.map((n) => [n.id, n]));

    const simLinks: GraphLink[] = links.map((l) => ({
      ...l,
      source: nodeById.get(l.source as string) ?? (l.source as GraphNode),
      target: nodeById.get(l.target as string) ?? (l.target as GraphNode),
    }));

    const simulation = d3
      .forceSimulation<GraphNode>(simNodes)
      .force(
        "link",
        d3
          .forceLink<GraphNode, GraphLink>(simLinks)
          .id((d) => d.id)
          .distance(120)
      )
      .force("charge", d3.forceManyBody().strength(-300))
      .force("center", d3.forceCenter(W / 2, H / 2))
      .force("collision", d3.forceCollide(30));

    // Links
    const link = g
      .append("g")
      .selectAll("line")
      .data(simLinks)
      .join("line")
      .attr("stroke", "#94a3b8")
      .attr("stroke-width", 1.5)
      .attr("marker-end", "url(#arrowhead)");

    // Link labels
    const linkLabel = g
      .append("g")
      .selectAll("text")
      .data(simLinks)
      .join("text")
      .attr("font-size", "9px")
      .attr("fill", "#94a3b8")
      .attr("text-anchor", "middle")
      .text((d) => d.type);

    // Node groups
    const node = g
      .append("g")
      .selectAll<SVGGElement, GraphNode>("g")
      .data(simNodes)
      .join("g")
      .attr("cursor", "pointer")
      .call(
        d3
          .drag<SVGGElement, GraphNode>()
          .on("start", (event, d) => {
            if (!event.active) simulation.alphaTarget(0.3).restart();
            d.fx = d.x;
            d.fy = d.y;
          })
          .on("drag", (event, d) => {
            d.fx = event.x;
            d.fy = event.y;
          })
          .on("end", (event, d) => {
            if (!event.active) simulation.alphaTarget(0);
            d.fx = null;
            d.fy = null;
          })
      )
      .on("click", (_event, d) => onNodeClick(d));

    node
      .append("circle")
      .attr("r", 14)
      .attr("fill", (d) => nodeColor(d.type))
      .attr("stroke", "#fff")
      .attr("stroke-width", 2);

    node
      .append("text")
      .attr("dy", 28)
      .attr("text-anchor", "middle")
      .attr("font-size", "10px")
      .attr("fill", "currentColor")
      .attr("class", "select-none")
      .text((d) => (d.label.length > 18 ? d.label.slice(0, 16) + "…" : d.label));

    simulation.on("tick", () => {
      link
        .attr("x1", (d) => (d.source as GraphNode).x ?? 0)
        .attr("y1", (d) => (d.source as GraphNode).y ?? 0)
        .attr("x2", (d) => (d.target as GraphNode).x ?? 0)
        .attr("y2", (d) => (d.target as GraphNode).y ?? 0);

      linkLabel
        .attr(
          "x",
          (d) =>
            (((d.source as GraphNode).x ?? 0) + ((d.target as GraphNode).x ?? 0)) / 2
        )
        .attr(
          "y",
          (d) =>
            (((d.source as GraphNode).y ?? 0) + ((d.target as GraphNode).y ?? 0)) / 2
        );

      node.attr("transform", (d) => `translate(${d.x ?? 0},${d.y ?? 0})`);
    });

    return () => {
      simulation.stop();
    };
  }, [nodes, links, onNodeClick]);

  return (
    <div ref={containerRef} className="w-full h-full" data-testid="force-graph-container">
      <svg ref={svgRef} className="w-full h-full" data-testid="force-graph-svg" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Result table
// ---------------------------------------------------------------------------

function ResultTable({ records }: { records: ArcadeRecord[] }) {
  if (records.length === 0) return null;

  const columns = Object.keys(records[0]);

  const cellValue = (val: ArcadeValue): string => {
    if (val === null || val === undefined) return "—";
    if (typeof val === "object") {
      const obj = val as ArcadeNode;
      const name = obj.name ?? obj["@class"] ?? obj["@rid"] ?? "";
      return name ? String(name) : JSON.stringify(val);
    }
    return String(val);
  };

  return (
    <div className="overflow-auto h-full" data-testid="result-table">
      <Table>
        <TableHeader>
          <TableRow>
            {columns.map((col) => (
              <TableHead key={col} className="font-mono text-xs whitespace-nowrap">
                {col}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {records.map((row, i) => (
            <TableRow key={i}>
              {columns.map((col) => (
                <TableCell
                  key={col}
                  className="font-mono text-xs max-w-[240px] truncate"
                  title={cellValue(row[col])}
                >
                  {cellValue(row[col])}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// GraphExplorer
// ---------------------------------------------------------------------------

const DEFAULT_QUERY = "MATCH (n) RETURN n LIMIT 25";

interface GraphExplorerProps {
  workspaceSlug: string;
}

export function GraphExplorer({ workspaceSlug }: GraphExplorerProps) {
  const [query, setQuery] = useState(DEFAULT_QUERY);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notConfigured, setNotConfigured] = useState(false);
  const [records, setRecords] = useState<ArcadeRecord[] | null>(null);
  const [graphData, setGraphData] = useState<{
    nodes: GraphNode[];
    links: GraphLink[];
  } | null>(null);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [tab, setTab] = useState("table");

  const runQuery = useCallback(async () => {
    if (!query.trim()) return;
    setLoading(true);
    setError(null);
    setNotConfigured(false);
    setRecords(null);
    setGraphData(null);

    try {
      const res = await fetch(`/api/workspaces/${workspaceSlug}/graph/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, limit: 100 }),
      });

      if (res.status === 400) {
        setNotConfigured(true);
        return;
      }

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.message || `Request failed (${res.status})`);
        return;
      }

      const data: QueryResult = await res.json();
      const result = data.result ?? [];
      setRecords(result);
      setGraphData(extractGraph(result));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, [query, workspaceSlug]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      runQuery();
    }
  };

  const handleNodeClick = useCallback((node: GraphNode) => {
    setSelectedNode(node);
  }, []);

  return (
    <div className="flex flex-col gap-4 flex-1 min-h-0">
      {/* Query bar */}
      <div className="flex gap-2 items-start" data-testid="query-bar">
        <Textarea
          data-testid="cypher-input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={3}
          placeholder="MATCH (n) RETURN n LIMIT 25"
          className="font-mono text-sm resize-none flex-1"
          spellCheck={false}
        />
        <Button
          data-testid="run-query-button"
          onClick={runQuery}
          disabled={loading || !query.trim()}
          className="shrink-0"
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
          ) : (
            <Play className="h-4 w-4 mr-2" />
          )}
          Run
        </Button>
      </div>

      {/* Shortcut hint */}
      <p className="text-xs text-muted-foreground -mt-2">
        Press <kbd className="px-1 py-0.5 rounded border text-xs font-mono">Ctrl+Enter</kbd> to run
      </p>

      {/* States */}
      {notConfigured && (
        <div
          data-testid="not-configured-state"
          className="flex flex-col items-center justify-center py-16 text-center gap-3"
        >
          <DatabaseZap className="h-10 w-10 text-muted-foreground" />
          <p className="font-medium text-foreground">Graph DB not configured for this workspace</p>
          <p className="text-sm text-muted-foreground max-w-sm">
            Attach a swarm with a graph endpoint to start exploring.
          </p>
        </div>
      )}

      {error && (
        <Alert variant="destructive" data-testid="error-state">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {loading && (
        <div
          data-testid="loading-state"
          className="flex items-center justify-center py-16 gap-2 text-muted-foreground"
        >
          <Loader2 className="h-5 w-5 animate-spin" />
          <span>Running query…</span>
        </div>
      )}

      {!loading && records !== null && !error && !notConfigured && (
        <>
          {records.length === 0 ? (
            <div
              data-testid="empty-state"
              className="flex flex-col items-center justify-center py-16 gap-2 text-muted-foreground"
            >
              <Search className="h-8 w-8" />
              <p>No results returned.</p>
            </div>
          ) : (
            <Tabs value={tab} onValueChange={setTab} className="flex flex-col flex-1 min-h-0">
              <div className="flex items-center gap-3">
                <TabsList>
                  <TabsTrigger value="table" data-testid="tab-table">
                    Table
                  </TabsTrigger>
                  <TabsTrigger value="graph" data-testid="tab-graph">
                    Graph
                  </TabsTrigger>
                </TabsList>
                <span className="text-xs text-muted-foreground">
                  {records.length} record{records.length !== 1 ? "s" : ""}
                </span>
              </div>

              <TabsContent value="table" className="flex-1 min-h-0 mt-2 overflow-auto">
                <ResultTable records={records} />
              </TabsContent>

              <TabsContent
                value="graph"
                className="flex-1 min-h-0 mt-2 border rounded-md overflow-hidden"
                style={{ minHeight: 400 }}
              >
                {graphData && graphData.nodes.length > 0 ? (
                  <ForceGraph
                    nodes={graphData.nodes}
                    links={graphData.links}
                    onNodeClick={handleNodeClick}
                  />
                ) : (
                  <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                    No graph nodes found in these results.
                  </div>
                )}
              </TabsContent>
            </Tabs>
          )}
        </>
      )}

      {/* Node properties sheet */}
      <Sheet open={!!selectedNode} onOpenChange={(open) => !open && setSelectedNode(null)}>
        <SheetContent data-testid="node-properties-sheet">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <span
                className="inline-block w-3 h-3 rounded-full"
                style={{ background: nodeColor(selectedNode?.type ?? "") }}
              />
              {selectedNode?.label}
            </SheetTitle>
          </SheetHeader>
          {selectedNode && (
            <div className="mt-4 space-y-3">
              <div className="flex items-center gap-2">
                <Badge variant="secondary">{selectedNode.type}</Badge>
                <span className="text-xs text-muted-foreground font-mono">
                  {selectedNode.id}
                </span>
              </div>
              <div className="space-y-2">
                {Object.entries(selectedNode.properties).map(([k, v]) => (
                  <div key={k} className="flex flex-col gap-0.5">
                    <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                      {k}
                    </span>
                    <span className="text-sm break-all">
                      {v === null || v === undefined ? "—" : String(v)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
