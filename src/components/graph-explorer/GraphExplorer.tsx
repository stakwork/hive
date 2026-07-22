"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import {
  Play,
  Loader2,
  AlertCircle,
  DatabaseZap,
  Search,
  ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

import { stakgraphToRawGraph } from "./stakgraphToRawGraph";
import { useKGGraph } from "./useKGGraph";
import type { RawNode, RawEdge } from "@/graph-viz-kit";

// Dynamically import the 3D canvas — Three.js is browser-only
const KGCanvas = dynamic(() => import("./KGCanvas"), { ssr: false });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface StakgraphResult {
  columns: string[];
  rows: unknown[][];
}

interface SearchResultItem {
  name: string;
  file: string;
  ref_id: string;
}

/** D3-style node used for the selected-node sheet (keeps existing properties) */
interface SelectedNodeInfo {
  id: number;       // index into graph.nodes
  label: string;
  type: string;
  ref_id?: string;
  properties: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Helpers — extract node type / colour (kept for sheet badge)
// ---------------------------------------------------------------------------

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

/** Parse the plain-text ASCII tree response for node labels */
function parseLabelsFromTree(text: string): string[] {
  const labels: string[] = [];
  for (const line of text.split("\n")) {
    // Lines look like:  ├── FunctionName (file.ts) or just  └── SomeName
    const match = line.match(/[├└─\s]+(.+?)(?:\s*\(|$)/);
    if (match) {
      const candidate = match[1].trim();
      if (candidate.length > 0) labels.push(candidate);
    }
  }
  return labels;
}

// ---------------------------------------------------------------------------
// Result table
// ---------------------------------------------------------------------------

function ResultTable({ columns, rows }: { columns: string[]; rows: unknown[][] }) {
  if (rows.length === 0) return null;

  const cellValue = (val: unknown): string => {
    if (val === null || val === undefined) return "—";
    if (typeof val === "object") {
      const obj = val as Record<string, unknown>;
      if (obj.name !== undefined) return String(obj.name);
      if (obj.id !== undefined) return `${obj.id}${obj.type ? ` (${obj.type})` : ""}`;
      return JSON.stringify(val);
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
          {rows.map((row, i) => (
            <TableRow key={i}>
              {columns.map((col, j) => (
                <TableCell
                  key={col}
                  className="font-mono text-xs max-w-[240px] truncate"
                  title={cellValue((row as unknown[])[j])}
                >
                  {cellValue((row as unknown[])[j])}
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
  // ── Cypher query state ────────────────────────────────────────────────────
  const [query, setQuery] = useState(DEFAULT_QUERY);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notConfigured, setNotConfigured] = useState(false);
  const [queryResult, setQueryResult] = useState<StakgraphResult | null>(null);
  const [tab, setTab] = useState("table");

  // ── Raw graph data fed to 3D canvas ──────────────────────────────────────
  const [rawNodes, setRawNodes] = useState<RawNode[]>([]);
  const [rawEdges, setRawEdges] = useState<RawEdge[]>([]);

  // ── 3D graph hook ─────────────────────────────────────────────────────────
  const { graph, viewState, selectNode, goOverview, searchMatches, setSearchMatches } =
    useKGGraph(rawNodes, rawEdges);

  // ── Selected node for the side sheet ─────────────────────────────────────
  const [selectedNode, setSelectedNode] = useState<SelectedNodeInfo | null>(null);
  const [traceText, setTraceText] = useState<string | null>(null);
  const [traceLoading, setTraceLoading] = useState(false);

  // ── Keyword search state ──────────────────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResultItem[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  // ── Update raw graph whenever query result changes ────────────────────────
  useEffect(() => {
    if (queryResult) {
      const { nodes, edges } = stakgraphToRawGraph(queryResult.columns, queryResult.rows);
      setRawNodes(nodes);
      setRawEdges(edges);
    } else {
      setRawNodes([]);
      setRawEdges([]);
    }
  }, [queryResult]);

  // ── Cypher query execution ────────────────────────────────────────────────
  const runQuery = useCallback(
    async (overrideQuery?: string) => {
      const q = overrideQuery ?? query;
      if (!q.trim()) return;
      setLoading(true);
      setError(null);
      setNotConfigured(false);
      setQueryResult(null);
      setSelectedNode(null);
      setTraceText(null);

      try {
        const res = await fetch(`/api/workspaces/${workspaceSlug}/graph/query`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: q, limit: 100 }),
        });

        if (res.status === 400) {
          setNotConfigured(true);
          return;
        }

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setError((data as { message?: string }).message || `Request failed (${res.status})`);
          return;
        }

        const data: StakgraphResult = await res.json();
        setQueryResult(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setLoading(false);
      }
    },
    [query, workspaceSlug]
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      runQuery();
    }
  };

  // ── 3D canvas node click → open sheet ────────────────────────────────────
  const handleCanvasNodeClick = useCallback(
    (id: number) => {
      const node = graph.nodes[id];
      if (!node) return;
      // Find original raw node to get ref_id if available
      const raw = rawNodes.find((n) => n.label === node.label);
      setSelectedNode({
        id,
        label: node.label,
        type: "Node",
        ref_id: raw?.id,           // stakgraph uses original id as ref_id proxy
        properties: {},
      });
      setTraceText(null);
      selectNode(id);
    },
    [graph.nodes, rawNodes, selectNode]
  );

  // ── Keyword search ────────────────────────────────────────────────────────
  const runSearch = useCallback(async () => {
    if (!searchQuery.trim()) return;
    setSearchLoading(true);
    setSearchError(null);
    setSearchResults([]);

    try {
      const params = new URLSearchParams({
        query: searchQuery.trim(),
        method: "hybrid",
        limit: "25",
        output: "json",
        concise: "true",
      });
      const res = await fetch(
        `/api/workspaces/${workspaceSlug}/graph/search?${params.toString()}`
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setSearchError((data as { message?: string }).message || `Search failed (${res.status})`);
        return;
      }
      const data = await res.json();
      setSearchResults(Array.isArray(data) ? data : []);
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : "Search failed");
    } finally {
      setSearchLoading(false);
    }
  }, [searchQuery, workspaceSlug]);

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      runSearch();
    }
  };

  /** Click a search result: select if in graph, otherwise load via Cypher */
  const handleSearchResultClick = useCallback(
    async (item: SearchResultItem) => {
      // Check if any node in current graph matches by label or ref_id
      const matchIdx = graph.nodes.findIndex(
        (n) => n.label === item.name || rawNodes[n.id]?.id === item.ref_id
      );
      if (matchIdx !== -1) {
        selectNode(matchIdx);
        setTab("graph");
        return;
      }
      // Load via Cypher
      const cypherQuery = `MATCH (n) WHERE n.ref_id = '${item.ref_id}' OPTIONAL MATCH (n)-[r]-(m) RETURN n, r, m LIMIT 50`;
      setQuery(cypherQuery);
      setTab("graph");
      await runQuery(cypherQuery);
      // After load, select the node (graph will rebuild, then select by label)
    },
    [graph.nodes, rawNodes, selectNode, runQuery]
  );

  // ── Path tracing ──────────────────────────────────────────────────────────
  const runTrace = useCallback(
    async (direction: "up" | "down" | "both") => {
      if (!selectedNode?.ref_id) return;
      setTraceLoading(true);
      setTraceText(null);
      setSearchMatches(null);

      try {
        const params = new URLSearchParams({
          ref_id: selectedNode.ref_id,
          direction,
          depth: "3",
        });
        const res = await fetch(
          `/api/workspaces/${workspaceSlug}/graph/map?${params.toString()}`
        );
        const text = await res.text();
        setTraceText(text);

        // Parse labels from the ASCII tree and highlight matched nodes
        const labels = parseLabelsFromTree(text);
        const labelSet = new Set(labels);
        const matchedIds = new Set<number>();
        for (const node of graph.nodes) {
          if (labelSet.has(node.label)) matchedIds.add(node.id);
        }
        setSearchMatches(matchedIds.size > 0 ? matchedIds : null);
      } catch (err) {
        setTraceText(err instanceof Error ? err.message : "Trace failed");
      } finally {
        setTraceLoading(false);
      }
    },
    [selectedNode, workspaceSlug, graph.nodes, setSearchMatches]
  );

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-4 flex-1 min-h-0">
      {/* ── Search panel ── */}
      <div className="flex gap-2 items-center" data-testid="search-panel">
        <Input
          data-testid="search-input"
          placeholder="Keyword / semantic search…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={handleSearchKeyDown}
          className="flex-1"
        />
        <Button
          data-testid="search-button"
          variant="secondary"
          onClick={runSearch}
          disabled={searchLoading || !searchQuery.trim()}
        >
          {searchLoading ? (
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
          ) : (
            <Search className="h-4 w-4 mr-2" />
          )}
          Search
        </Button>
      </div>

      {/* Search results */}
      {searchError && (
        <p className="text-xs text-destructive" data-testid="search-error">
          {searchError}
        </p>
      )}
      {searchResults.length > 0 && (
        <div
          className="flex flex-wrap gap-2 p-2 border rounded-md bg-muted/40"
          data-testid="search-results"
        >
          {searchResults.map((item) => (
            <button
              key={item.ref_id}
              data-testid={`search-result-${item.ref_id}`}
              onClick={() => handleSearchResultClick(item)}
              className="flex items-center gap-1 px-2 py-1 rounded border bg-background hover:bg-accent text-xs transition-colors"
            >
              <span className="font-medium">{item.name}</span>
              <ChevronRight className="h-3 w-3 text-muted-foreground" />
              <span className="text-muted-foreground truncate max-w-[140px]">{item.file}</span>
            </button>
          ))}
        </div>
      )}

      {/* ── Cypher query bar ── */}
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
          onClick={() => runQuery()}
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

      <p className="text-xs text-muted-foreground -mt-2">
        Press{" "}
        <kbd className="px-1 py-0.5 rounded border text-xs font-mono">Ctrl+Enter</kbd> to run
      </p>

      {/* ── Status states ── */}
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

      {/* ── Results ── */}
      {!loading && queryResult !== null && !error && !notConfigured && (
        <>
          {queryResult.rows.length === 0 ? (
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
                  {queryResult.rows.length} record{queryResult.rows.length !== 1 ? "s" : ""}
                </span>
                {viewState.mode === "subgraph" && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={goOverview}
                    data-testid="go-overview-button"
                    className="text-xs"
                  >
                    ← Overview
                  </Button>
                )}
              </div>

              <TabsContent value="table" className="flex-1 min-h-0 mt-2 overflow-auto">
                <ResultTable columns={queryResult.columns} rows={queryResult.rows} />
              </TabsContent>

              <TabsContent
                value="graph"
                className="flex-1 min-h-0 mt-2 border rounded-md overflow-hidden"
                style={{ minHeight: 400 }}
              >
                {graph.nodes.length > 0 ? (
                  <KGCanvas
                    graph={graph}
                    viewState={viewState}
                    onNodeClick={handleCanvasNodeClick}
                    searchMatches={searchMatches}
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

      {/* ── Node properties / path-tracing sheet ── */}
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
            <div className="mt-4 space-y-4">
              <div className="flex items-center gap-2">
                <Badge variant="secondary">{selectedNode.type}</Badge>
                {selectedNode.ref_id && (
                  <span className="text-xs text-muted-foreground font-mono">
                    {selectedNode.ref_id}
                  </span>
                )}
              </div>

              {/* Path-tracing actions */}
              {selectedNode.ref_id && (
                <div className="space-y-2">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Path Tracing
                  </p>
                  <div className="flex gap-2 flex-wrap">
                    <Button
                      size="sm"
                      variant="outline"
                      data-testid="trace-up-button"
                      onClick={() => runTrace("up")}
                      disabled={traceLoading}
                    >
                      {traceLoading ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
                      Trace Upstream
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      data-testid="trace-down-button"
                      onClick={() => runTrace("down")}
                      disabled={traceLoading}
                    >
                      Trace Downstream
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      data-testid="trace-both-button"
                      onClick={() => runTrace("both")}
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
              )}

              {/* Node properties */}
              {Object.keys(selectedNode.properties).length > 0 && (
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
              )}
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
