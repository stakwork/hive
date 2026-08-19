"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import {
  Play,
  Loader2,
  AlertCircle,
  DatabaseZap,
  Search,
  ChevronRight,
  MessageSquare,
  Plus,
  ArrowRight,
  ArrowLeft,
  Crosshair,
  X,
  ChevronDown,
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
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Alert, AlertDescription } from "@/components/ui/alert";

import { stakgraphToRawGraph } from "./stakgraphToRawGraph";
import { useKGGraph } from "./useKGGraph";
import { GraphChatSidebar, NewGraphChatModal } from "./chat";
import type { RawNode, RawEdge } from "@/graph-viz-kit";
import type {
  GraphNodeDetailResponse,
  GraphNodeNeighbor,
  GraphNodeType,
  GraphNodeTypesResponse,
  GraphSearchHit,
  GraphSearchResponse,
} from "@/types/graph-node";

// Dynamically import the 3D canvas — Three.js is browser-only
const KGCanvas = dynamic(() => import("./KGCanvas"), { ssr: false });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface StakgraphResult {
  columns: string[];
  rows: unknown[][];
}

/**
 * The node the sheet is showing. `label` is the optimistic title (from the
 * canvas / search result) so the panel can open before the fetch resolves;
 * once `nodeDetail` lands it supplies the real name.
 */
interface SheetTarget {
  refId: string;
  label: string;
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

/**
 * Turn a node-detail response into the star graph the 3D canvas renders: the
 * queried node first (so it lands at index 0 and wins `findBestRoot`), then one
 * node + edge per directly-linked neighbor.
 */
function detailToRawGraph(detail: GraphNodeDetailResponse): {
  nodes: RawNode[];
  edges: RawEdge[];
} {
  const seen = new Set<string>([detail.node.ref_id]);
  const nodes: RawNode[] = [
    { id: detail.node.ref_id, label: detail.node.name || detail.node.ref_id },
  ];
  const edges: RawEdge[] = [];

  for (const n of detail.neighbors) {
    if (!seen.has(n.ref_id)) {
      seen.add(n.ref_id);
      nodes.push({ id: n.ref_id, label: n.name || n.ref_id });
    }
    // `direction` is relative to the queried node: forward = it's the source.
    edges.push(
      n.direction === "forward"
        ? { source: detail.node.ref_id, target: n.ref_id, label: n.edge_type }
        : { source: n.ref_id, target: detail.node.ref_id, label: n.edge_type },
    );
  }

  return { nodes, edges };
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

/**
 * Semantic search starts scoped to Concepts — they're the layer people
 * actually reason about, and an unscoped search buries them under thousands of
 * Functions and Files. Dropped automatically if the workspace's ontology has no
 * Concept type (see the node-types effect), and freely changeable either way.
 */
const DEFAULT_SEARCH_TYPES = ["Concept"];

interface GraphExplorerProps {
  workspaceSlug: string;
  /** `?ref_id=` deep link — focus this node (and its neighbors) on first load. */
  initialRefId?: string | null;
}

export function GraphExplorer({ workspaceSlug, initialRefId }: GraphExplorerProps) {
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
  const [sheetTarget, setSheetTarget] = useState<SheetTarget | null>(null);
  const [nodeDetail, setNodeDetail] = useState<GraphNodeDetailResponse | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [traceText, setTraceText] = useState<string | null>(null);
  const [traceLoading, setTraceLoading] = useState(false);

  // ── Focused node (the `?ref_id=` deep link / neighbor-walk seed) ──────────
  const [focusedNode, setFocusedNode] = useState<GraphNodeDetailResponse["node"] | null>(null);
  const [focusLoading, setFocusLoading] = useState(false);
  const [focusError, setFocusError] = useState<string | null>(null);
  /** Ref_id to select once the rebuilt graph lands (see the effect below). */
  const pendingSelectRef = useRef<string | null>(null);
  /** Guards against a slow detail fetch overwriting a newer one. */
  const detailRequestRef = useRef(0);

  // ── Keyword search state ──────────────────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<GraphSearchHit[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);

  // ── Node-type filter ──────────────────────────────────────────────────────
  const [nodeTypes, setNodeTypes] = useState<GraphNodeType[]>([]);
  const [selectedTypes, setSelectedTypes] = useState<string[]>(DEFAULT_SEARCH_TYPES);

  // ── Graph agent chat state ────────────────────────────────────────────────
  const [chatOpen, setChatOpen] = useState(false);
  const [chatSessionId, setChatSessionId] = useState<string | null>(null);
  const [newChatOpen, setNewChatOpen] = useState(false);

  // ── Cypher query execution ────────────────────────────────────────────────
  const runQuery = useCallback(
    async (overrideQuery?: string) => {
      const q = overrideQuery ?? query;
      if (!q.trim()) return;
      setLoading(true);
      setError(null);
      setNotConfigured(false);
      setQueryResult(null);
      setRawNodes([]);
      setRawEdges([]);
      setFocusedNode(null);
      setFocusError(null);
      setSheetTarget(null);
      setNodeDetail(null);
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
        const { nodes, edges } = stakgraphToRawGraph(data.columns, data.rows);
        setRawNodes(nodes);
        setRawEdges(edges);
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

  // ── Node detail (Jarvis `/v2/nodes/{ref_id}?expand=edges`) ───────────────

  /**
   * Fetch one node plus its directly-linked neighbors. Stale responses are
   * dropped so a slow fetch can't overwrite a newer selection.
   */
  const fetchNodeDetail = useCallback(
    async (refId: string): Promise<GraphNodeDetailResponse | null> => {
      const requestId = ++detailRequestRef.current;
      setDetailLoading(true);
      setDetailError(null);
      setNodeDetail(null);
      setTraceText(null);

      try {
        const res = await fetch(
          `/api/workspaces/${workspaceSlug}/graph/node/${encodeURIComponent(refId)}`
        );
        if (requestId !== detailRequestRef.current) return null;

        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setDetailError(
            (data as { message?: string }).message || `Failed to load node (${res.status})`
          );
          return null;
        }

        const data: GraphNodeDetailResponse = await res.json();
        if (requestId !== detailRequestRef.current) return null;
        // Don't trust a 200 to be well-formed — the panel and the canvas both
        // dereference `node`/`neighbors` unconditionally.
        if (!data?.node?.ref_id || !Array.isArray(data.neighbors)) {
          setDetailError("Malformed node response");
          return null;
        }
        setNodeDetail(data);
        return data;
      } catch (err) {
        if (requestId !== detailRequestRef.current) return null;
        setDetailError(err instanceof Error ? err.message : "Failed to load node");
        return null;
      } finally {
        if (requestId === detailRequestRef.current) setDetailLoading(false);
      }
    },
    [workspaceSlug]
  );

  /** Open the side panel for a node already on the canvas (leaves the graph alone). */
  const openNodeDetail = useCallback(
    (refId: string, label: string) => {
      setSheetTarget({ refId, label });
      void fetchNodeDetail(refId);
    },
    [fetchNodeDetail]
  );

  /**
   * Make `refId` the center of the canvas: load it with its neighbors, replace
   * the graph with that star, and open the panel. This is the deep-link entry
   * point and what neighbor rows / search results use.
   */
  const focusNode = useCallback(
    async (refId: string, label?: string) => {
      setSheetTarget({ refId, label: label ?? refId });
      setFocusLoading(true);
      setFocusError(null);
      setTab("graph");

      const detail = await fetchNodeDetail(refId);
      if (!detail) {
        setFocusLoading(false);
        setFocusError(`Could not load node ${refId}`);
        return;
      }

      const { nodes, edges } = detailToRawGraph(detail);
      // Focusing replaces the query result view — the canvas now shows the
      // node's neighborhood, not the rows the table is describing.
      setQueryResult(null);
      setError(null);
      setNotConfigured(false);
      setRawNodes(nodes);
      setRawEdges(edges);
      setFocusedNode(detail.node);
      setSearchMatches(null);
      pendingSelectRef.current = detail.node.ref_id;
      setFocusLoading(false);
    },
    [fetchNodeDetail, setSearchMatches]
  );

  /**
   * Select the focused node once the graph has been rebuilt around it.
   * `useKGGraph` resets to overview whenever the data changes, and its effect
   * runs before this one, so selecting here wins.
   */
  useEffect(() => {
    const refId = pendingSelectRef.current;
    if (!refId) return;
    const index = rawNodes.findIndex((n) => n.id === refId);
    if (index === -1 || !graph.nodes[index]) return;
    pendingSelectRef.current = null;
    selectNode(index);
  }, [graph, rawNodes, selectNode]);

  /** `?ref_id=` deep link — focus once on mount. */
  const deepLinkedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!initialRefId || deepLinkedRef.current === initialRefId) return;
    deepLinkedRef.current = initialRefId;
    void focusNode(initialRefId);
  }, [initialRefId, focusNode]);

  // ── 3D canvas node click → open sheet ────────────────────────────────────
  const handleCanvasNodeClick = useCallback(
    (id: number) => {
      const node = graph.nodes[id];
      if (!node) return;
      // rawNodes and graph.nodes share indices (buildGraph preserves order),
      // so the ref_id is a direct lookup.
      const refId = rawNodes[id]?.id;
      selectNode(id);
      if (!refId) return;
      openNodeDetail(refId, node.label);
    },
    [graph.nodes, rawNodes, selectNode, openNodeDetail]
  );

  // ── Node types for the search filter (Jarvis ontology) ────────────────────
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch(`/api/workspaces/${workspaceSlug}/graph/node-types`);
        if (!res.ok) return;
        const data: GraphNodeTypesResponse = await res.json();
        if (cancelled || !Array.isArray(data?.node_types)) return;

        setNodeTypes(data.node_types);
        // Concept is only a sensible default if this workspace has one —
        // otherwise fall back to searching every type rather than showing the
        // user an empty result set they have to debug.
        const hasDefaults = DEFAULT_SEARCH_TYPES.every((t) =>
          data.node_types.some((nt) => nt.type === t),
        );
        if (!hasDefaults) setSelectedTypes([]);
      } catch {
        // Non-fatal — the filter just stays empty and search covers all types.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [workspaceSlug]);

  const toggleType = useCallback((type: string) => {
    setSelectedTypes((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type],
    );
  }, []);

  // ── Semantic search (Jarvis hybrid keyword + vector) ──────────────────────
  const runSearch = useCallback(async () => {
    if (!searchQuery.trim()) return;
    setSearchLoading(true);
    setSearchError(null);
    setSearchResults([]);
    setSearched(true);

    try {
      const params = new URLSearchParams({ q: searchQuery.trim(), limit: "25" });
      if (selectedTypes.length > 0) params.set("types", selectedTypes.join(","));

      const res = await fetch(
        `/api/workspaces/${workspaceSlug}/graph/nodes/search?${params.toString()}`
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setSearchError((data as { message?: string }).message || `Search failed (${res.status})`);
        return;
      }
      const data: GraphSearchResponse = await res.json();
      setSearchResults(Array.isArray(data?.results) ? data.results : []);
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : "Search failed");
    } finally {
      setSearchLoading(false);
    }
  }, [searchQuery, selectedTypes, workspaceSlug]);

  const typeFilterLabel =
    selectedTypes.length === 0
      ? "All types"
      : selectedTypes.length === 1
        ? selectedTypes[0]
        : `${selectedTypes.length} types`;

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      runSearch();
    }
  };

  /** Click a search result: focus that node and its directly-linked neighbors. */
  const handleSearchResultClick = useCallback(
    (item: GraphSearchHit) => {
      void focusNode(item.ref_id, item.name);
    },
    [focusNode]
  );

  // ── Path tracing ──────────────────────────────────────────────────────────
  const runTrace = useCallback(
    async (direction: "up" | "down" | "both") => {
      const refId = sheetTarget?.refId;
      if (!refId) return;
      setTraceLoading(true);
      setTraceText(null);
      setSearchMatches(null);

      try {
        const params = new URLSearchParams({
          ref_id: refId,
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
    [sheetTarget, workspaceSlug, graph.nodes, setSearchMatches]
  );

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-1 min-h-0 gap-4">
      <div className="flex flex-col gap-4 flex-1 min-h-0 min-w-0">
        {/* ── Search panel ── */}
        <div className="flex gap-2 items-center" data-testid="search-panel">
          <Input
            data-testid="search-input"
            placeholder="Semantic search…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={handleSearchKeyDown}
            className="flex-1"
          />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                data-testid="node-type-filter-button"
                className="shrink-0 min-w-[130px] justify-between"
              >
                <span className="truncate">{typeFilterLabel}</span>
                <ChevronDown className="h-4 w-4 ml-2 shrink-0" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="max-h-80 overflow-y-auto w-56">
              <DropdownMenuLabel>Node types</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                data-testid="node-type-filter-all"
                onSelect={() => setSelectedTypes([])}
              >
                All types
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {nodeTypes.length === 0 ? (
                <DropdownMenuItem disabled>No types available</DropdownMenuItem>
              ) : (
                nodeTypes.map((nt) => (
                  <DropdownMenuCheckboxItem
                    key={nt.type}
                    data-testid={`node-type-option-${nt.type}`}
                    checked={selectedTypes.includes(nt.type)}
                    onSelect={(e) => e.preventDefault()}
                    onCheckedChange={() => toggleType(nt.type)}
                  >
                    {nt.type}
                  </DropdownMenuCheckboxItem>
                ))
              )}
            </DropdownMenuContent>
          </DropdownMenu>
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
          <Button
            data-testid="graph-chat-toggle-button"
            variant={chatOpen ? "secondary" : "outline"}
            onClick={() => setChatOpen((open) => !open)}
          >
            <MessageSquare className="h-4 w-4 mr-2" />
            Chat
          </Button>
          <Button
            data-testid="graph-chat-new-button"
            variant="outline"
            onClick={() => setNewChatOpen(true)}
          >
            <Plus className="h-4 w-4 mr-2" />
            New
          </Button>
        </div>

        {/* Search results */}
        {searchError && (
          <p className="text-xs text-destructive" data-testid="search-error">
            {searchError}
          </p>
        )}
        {searched && !searchLoading && !searchError && searchResults.length === 0 && (
          <p className="text-xs text-muted-foreground" data-testid="search-empty">
            No matches{selectedTypes.length > 0 ? ` in ${selectedTypes.join(", ")}` : ""}.
          </p>
        )}

        {searchResults.length > 0 && (
          <div
            className="flex flex-col gap-1 p-2 border rounded-md bg-muted/40 max-h-56 overflow-y-auto"
            data-testid="search-results"
          >
            {searchResults.map((item) => (
              <button
                key={item.ref_id}
                data-testid={`search-result-${item.ref_id}`}
                onClick={() => handleSearchResultClick(item)}
                className="flex items-center gap-2 px-2 py-1.5 rounded border bg-background hover:bg-accent text-xs text-left transition-colors"
                title={item.description || item.name}
              >
                <Badge variant="outline" className="text-xs shrink-0">
                  {item.node_type}
                </Badge>
                <span className="font-medium shrink-0 max-w-[220px] truncate">{item.name}</span>
                {item.description && (
                  <span className="text-muted-foreground truncate flex-1">
                    {item.description}
                  </span>
                )}
                <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />
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

        {focusLoading && (
          <div
            data-testid="focus-loading-state"
            className="flex items-center justify-center py-16 gap-2 text-muted-foreground"
          >
            <Loader2 className="h-5 w-5 animate-spin" />
            <span>Loading node…</span>
          </div>
        )}

        {focusError && (
          <Alert variant="destructive" data-testid="focus-error-state">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{focusError}</AlertDescription>
          </Alert>
        )}

        {/* ── Results ── */}
        {!loading && !focusLoading && !error && !notConfigured &&
          (queryResult !== null || rawNodes.length > 0) && (
          <>
            {queryResult !== null && queryResult.rows.length === 0 && rawNodes.length === 0 ? (
              <div
                data-testid="empty-state"
                className="flex flex-col items-center justify-center py-16 gap-2 text-muted-foreground"
              >
                <Search className="h-8 w-8" />
                <p>No results returned.</p>
              </div>
            ) : (
              <Tabs value={tab} onValueChange={setTab} className="flex flex-col flex-1 min-h-0">
                <div className="flex items-center gap-3 flex-wrap">
                  <TabsList>
                    {queryResult !== null && (
                      <TabsTrigger value="table" data-testid="tab-table">
                        Table
                      </TabsTrigger>
                    )}
                    <TabsTrigger value="graph" data-testid="tab-graph">
                      Graph
                    </TabsTrigger>
                  </TabsList>
                  {queryResult !== null && (
                    <span className="text-xs text-muted-foreground">
                      {queryResult.rows.length} record{queryResult.rows.length !== 1 ? "s" : ""}
                    </span>
                  )}
                  {focusedNode && (
                    <div
                      className="flex items-center gap-1.5 text-xs text-muted-foreground"
                      data-testid="focused-node-badge"
                    >
                      <Crosshair className="h-3 w-3" />
                      <span className="font-medium text-foreground truncate max-w-[220px]">
                        {focusedNode.name || focusedNode.ref_id}
                      </span>
                      <span>· {nodeDetail?.neighbors.length ?? 0} linked</span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-5 w-5"
                        data-testid="clear-focus-button"
                        onClick={() => {
                          setFocusedNode(null);
                          setRawNodes([]);
                          setRawEdges([]);
                          setSheetTarget(null);
                          setNodeDetail(null);
                        }}
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  )}
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

                {queryResult !== null && (
                  <TabsContent value="table" className="flex-1 min-h-0 mt-2 overflow-auto">
                    <ResultTable columns={queryResult.columns} rows={queryResult.rows} />
                  </TabsContent>
                )}

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
      </div>

      {/* ── Graph agent chat sidebar + new-chat modal ── */}
      {chatOpen && (
        <GraphChatSidebar
          workspaceSlug={workspaceSlug}
          activeSessionId={chatSessionId}
          onSelectThread={setChatSessionId}
          onClose={() => setChatOpen(false)}
        />
      )}
      <NewGraphChatModal
        workspaceSlug={workspaceSlug}
        open={newChatOpen}
        onOpenChange={setNewChatOpen}
        onCreated={(sessionId) => {
          setChatSessionId(sessionId);
          setChatOpen(true);
        }}
      />

      {/* ── Node detail sheet: properties + directly-linked nodes ── */}
      <Sheet
        open={!!sheetTarget}
        onOpenChange={(open) => {
          if (!open) {
            setSheetTarget(null);
            setNodeDetail(null);
            setDetailError(null);
          }
        }}
      >
        <SheetContent
          data-testid="node-properties-sheet"
          className="overflow-y-auto sm:max-w-md w-full"
        >
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2 text-left">
              <span
                className="inline-block w-3 h-3 rounded-full shrink-0"
                style={{ background: nodeColor(nodeDetail?.node.node_type ?? "") }}
              />
              <span className="truncate">
                {nodeDetail?.node.name || sheetTarget?.label}
              </span>
            </SheetTitle>
          </SheetHeader>

          {sheetTarget && (
            <div className="mt-4 space-y-5 px-4 pb-6">
              <div className="flex items-center gap-2 flex-wrap">
                {nodeDetail && (
                  <Badge variant="secondary" data-testid="node-type-badge">
                    {nodeDetail.node.node_type}
                  </Badge>
                )}
                <span className="text-xs text-muted-foreground font-mono break-all">
                  {sheetTarget.refId}
                </span>
              </div>

              {detailLoading && (
                <div
                  className="flex items-center gap-2 text-sm text-muted-foreground"
                  data-testid="node-detail-loading"
                >
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading node…
                </div>
              )}

              {detailError && (
                <Alert variant="destructive" data-testid="node-detail-error">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{detailError}</AlertDescription>
                </Alert>
              )}

              {/* Directly-linked nodes, grouped by edge type */}
              {nodeDetail && (
                <div className="space-y-2" data-testid="linked-nodes-section">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Linked Nodes ({nodeDetail.neighbors.length})
                  </p>
                  {nodeDetail.neighbors.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No directly-linked nodes.
                    </p>
                  ) : (
                    <div className="space-y-3">
                      {groupByEdgeType(nodeDetail.neighbors).map(([edgeType, group]) => (
                        <div key={edgeType} className="space-y-1">
                          <p className="text-xs font-mono text-muted-foreground">
                            {edgeType}
                          </p>
                          {group.map((neighbor) => (
                            <button
                              key={`${edgeType}-${neighbor.ref_id}`}
                              data-testid={`linked-node-${neighbor.ref_id}`}
                              onClick={() => focusNode(neighbor.ref_id, neighbor.name)}
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
              {nodeDetail && Object.keys(nodeDetail.node.properties).length > 0 && (
                <div className="space-y-2" data-testid="node-properties-section">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    Properties
                  </p>
                  {Object.entries(nodeDetail.node.properties).map(([k, v]) => (
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
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
