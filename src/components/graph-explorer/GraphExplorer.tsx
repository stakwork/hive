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
import { detailToRawGraph, mergeRawGraph, type RawGraph } from "./walkGraph";
import { useKGGraph } from "./useKGGraph";
import { GraphChatSidebar, NewGraphChatModal } from "./chat";
import { NodePanel } from "./NodePanel";
import { Graph2DView } from "./Graph2DView";
import type {
  GraphNodeDetailResponse,
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
 * The node the detail panel is showing. `label` is the optimistic title (from
 * the canvas / search result) so the panel can open before the fetch resolves;
 * once `nodeDetail` lands it supplies the real name.
 */
interface PanelTarget {
  refId: string;
  label: string;
}

/**
 * Id prefix for the stand-in center of a sidecar-drawn session star. The real
 * AgentSession node has a ref_id; this one does not exist in the graph at all,
 * so every lookup path has to treat it as inert.
 */
const SYNTHETIC_SESSION_PREFIX = "session:";

/** Minimum a chat thread has to tell us to draw its reads without the graph. */
export interface SessionConceptSeed {
  ref_id?: string;
  name?: string;
}

/** Multi-select node-type filter, shared by search and graph-walk expansion. */
function NodeTypeFilter({
  label,
  nodeTypes,
  selected,
  onToggle,
  onClear,
  testId,
}: {
  label: string;
  nodeTypes: GraphNodeType[];
  selected: string[];
  onToggle: (type: string) => void;
  onClear: () => void;
  testId: string;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          data-testid={`${testId}-button`}
          className="shrink-0 min-w-[130px] justify-between"
        >
          <span className="truncate">{label}</span>
          <ChevronDown className="h-4 w-4 ml-2 shrink-0" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-80 overflow-y-auto w-56">
        <DropdownMenuLabel>Node types</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem data-testid={`${testId}-all`} onSelect={onClear}>
          All types
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {nodeTypes.length === 0 ? (
          <DropdownMenuItem disabled>No types available</DropdownMenuItem>
        ) : (
          nodeTypes.map((nt) => (
            <DropdownMenuCheckboxItem
              key={nt.type}
              data-testid={`${testId}-option-${nt.type}`}
              checked={selected.includes(nt.type)}
              // Keep the menu open so several types can be picked at once.
              onSelect={(e) => e.preventDefault()}
              onCheckedChange={() => onToggle(nt.type)}
            >
              {nt.type}
            </DropdownMenuCheckboxItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Trigger label for a type filter: "All types" / "Concept" / "3 types". */
function typeFilterLabelFor(selected: string[]): string {
  if (selected.length === 0) return "All types";
  if (selected.length === 1) return selected[0];
  return `${selected.length} types`;
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
  /**
   * `?cypher=` deep link — pre-fill the query bar and run it on first load, so
   * callers that know a whole subgraph shape (e.g. the recursion card's loop
   * subgraph) can land on a rendered canvas instead of a single focused node.
   * `ref_id` wins when both are present. Same power as typing in the query bar:
   * the route is admin-gated and read-only, and the query stays visible/editable.
   */
  initialCypher?: string | null;
}

export function GraphExplorer({ workspaceSlug, initialRefId, initialCypher }: GraphExplorerProps) {
  // ── Cypher query state ────────────────────────────────────────────────────
  const [query, setQuery] = useState(DEFAULT_QUERY);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notConfigured, setNotConfigured] = useState(false);
  const [queryResult, setQueryResult] = useState<StakgraphResult | null>(null);
  const [tab, setTab] = useState("table");

  // ── Raw graph data fed to 3D canvas ──────────────────────────────────────
  // One piece of state, not two: graph-walk expansion appends to both halves
  // from the same `present?` decision, and splitting them invites a merge that
  // adds edges for nodes it didn't add.
  const [rawGraph, setRawGraph] = useState<RawGraph>({ nodes: [], edges: [] });
  const rawNodes = rawGraph.nodes;

  // ── Selected node for the docked detail panel ────────────────────────────
  const [panelTarget, setPanelTarget] = useState<PanelTarget | null>(null);
  const [nodeDetail, setNodeDetail] = useState<GraphNodeDetailResponse | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [traceText, setTraceText] = useState<string | null>(null);
  const [traceLoading, setTraceLoading] = useState(false);

  // ── Focused node (the `?ref_id=` deep link / graph-walk center) ───────────
  const [focusedNode, setFocusedNode] = useState<GraphNodeDetailResponse["node"] | null>(null);
  const [focusLoading, setFocusLoading] = useState(false);
  const [focusError, setFocusError] = useState<string | null>(null);
  /**
   * Neutral counterpart to `focusError`: the lookup worked and there is simply
   * nothing to draw. Kept separate so "this chat read no concepts" doesn't
   * render as a destructive alert.
   */
  const [focusNotice, setFocusNotice] = useState<string | null>(null);
  /** Guards against a slow detail fetch overwriting a newer one. */
  const detailRequestRef = useRef(0);

  /**
   * Walking is a distinct mode from running a Cypher query: the canvas shows an
   * accumulating neighborhood centered on the focused node rather than a query
   * result to drill into. The two are mutually exclusive by construction —
   * focusing clears `queryResult`, running a query clears `focusedNode`.
   */
  const walkMode = focusedNode !== null;

  // Re-root the layout on the focused node so each expansion re-centers.
  const centerIndex = focusedNode
    ? rawGraph.nodes.findIndex((n) => n.id === focusedNode.ref_id)
    : -1;

  // ── 3D graph hook ─────────────────────────────────────────────────────────
  const { graph, viewState, selectNode, goOverview, searchMatches, setSearchMatches } =
    useKGGraph(rawGraph.nodes, rawGraph.edges, centerIndex === -1 ? undefined : centerIndex);

  // ── Keyword search state ──────────────────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<GraphSearchHit[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);

  // ── Node-type filter ──────────────────────────────────────────────────────
  const [nodeTypes, setNodeTypes] = useState<GraphNodeType[]>([]);
  const [selectedTypes, setSelectedTypes] = useState<string[]>(DEFAULT_SEARCH_TYPES);
  /**
   * Neighbor types pulled in when expanding a node. Separate from the search
   * filter and unrestricted by default — narrowing it is what makes walking a
   * dense graph tractable ("show me only the Concepts this touches"), but
   * defaulting it would silently hide most of a node's real edges.
   */
  const [expandTypes, setExpandTypes] = useState<string[]>([]);

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
      setRawGraph({ nodes: [], edges: [] });
      setFocusedNode(null);
      setFocusError(null);
      setPanelTarget(null);
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
        setRawGraph({ nodes, edges });
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
    async (refId: string, types?: string[]): Promise<GraphNodeDetailResponse | null> => {
      const requestId = ++detailRequestRef.current;
      setDetailLoading(true);
      setDetailError(null);
      setNodeDetail(null);
      setTraceText(null);

      try {
        const query = types && types.length > 0 ? `?types=${encodeURIComponent(types.join(","))}` : "";
        const res = await fetch(
          `/api/workspaces/${workspaceSlug}/graph/node/${encodeURIComponent(refId)}${query}`
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
      setPanelTarget({ refId, label });
      void fetchNodeDetail(refId, expandTypes);
    },
    [fetchNodeDetail, expandTypes]
  );

  /**
   * Make `refId` the center of the canvas: load it with its neighbors, replace
   * the graph with that star, and open the panel. This is the deep-link entry
   * point and what neighbor rows / search results use.
   */
  const focusNode = useCallback(
    async (refId: string, label?: string): Promise<GraphNodeDetailResponse | null> => {
      setPanelTarget({ refId, label: label ?? refId });
      setFocusLoading(true);
      setFocusError(null);
      setFocusNotice(null);
      // Focusing clears the query result, so the Table tab is about to vanish —
      // move off it. "2d" is already a graph view, so leave that choice alone.
      setTab((t) => (t === "2d" ? t : "graph"));

      const detail = await fetchNodeDetail(refId, expandTypes);
      if (!detail) {
        setFocusLoading(false);
        setFocusError(`Could not load node ${refId}`);
        return null;
      }

      const star = detailToRawGraph(detail);
      // Focusing replaces the query result view — the canvas now shows the
      // node's neighborhood, not the rows the table is describing.
      setQueryResult(null);
      setError(null);
      setNotConfigured(false);
      setRawGraph((prev) => {
        // Expanding a node that's already on the canvas continues the walk, so
        // the trail stays visible. Jumping to an unrelated node (a search hit,
        // a deep link) starts a fresh one — accumulating there would leave a
        // disconnected island the radial layout can't place.
        const continuesWalk = prev.nodes.some((n) => n.id === detail.node.ref_id);
        return continuesWalk ? mergeRawGraph(prev, star) : star;
      });
      setFocusedNode(detail.node);
      setSearchMatches(null);
      setFocusLoading(false);
      return detail;
    },
    [fetchNodeDetail, expandTypes, setSearchMatches]
  );

  /** `?ref_id=` deep link — focus once on mount. */
  const deepLinkedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!initialRefId || deepLinkedRef.current === initialRefId) return;
    deepLinkedRef.current = initialRefId;
    void focusNode(initialRefId);
  }, [initialRefId, focusNode]);

  /** `?cypher=` deep link — run once on mount; `ref_id` takes precedence. */
  const deepLinkedCypher = useRef<string | null>(null);
  useEffect(() => {
    if (!initialCypher || initialRefId || deepLinkedCypher.current === initialCypher) return;
    deepLinkedCypher.current = initialCypher;
    setQuery(initialCypher);
    void runQuery(initialCypher);
  }, [initialCypher, initialRefId, runQuery]);

  /**
   * "Show on graph" from a chat thread. A session's Concept reads are already
   * in the graph as (AgentSession)-[:READ_CONCEPT]->(Concept) edges, so the
   * whole picture is one `focusNode` away — all we need is the session node's
   * ref_id, and the upsert sets `name = sessionId`, so it resolves by search.
   *
   * Stakgraph's edge sync is fire-and-forget and silently skips concepts it
   * can't match, so a missing session node is an ordinary outcome, not an
   * error: fall back to drawing the star from the reflection sidecar the chat
   * already holds. The sidecar is the source of truth; these edges are an
   * index over it.
   */
  const showSessionOnGraph = useCallback(
    async (sessionId: string, sidecarConcepts: SessionConceptSeed[]) => {
      setFocusError(null);
      setFocusNotice(null);
      setFocusLoading(true);

      let hit: GraphSearchHit | undefined;
      try {
        const params = new URLSearchParams({
          q: sessionId,
          types: "AgentSession",
          limit: "5",
        });
        const res = await fetch(
          `/api/workspaces/${workspaceSlug}/graph/nodes/search?${params.toString()}`,
        );
        if (res.ok) {
          const data: GraphSearchResponse = await res.json();
          // Fulltext search returns near-matches too — the session node is the
          // one whose name IS the session id, never a scoring runner-up.
          hit = data.results?.find((r) => r.name === sessionId);
        }
      } catch {
        // Fall through to the sidecar.
      }
      setFocusLoading(false);

      if (hit) {
        const star = await focusNode(hit.ref_id, hit.name);
        // The node exists but nothing hangs off it: this session read no
        // Concepts. A lone dot on the canvas doesn't say that, so spell it out.
        if (star && !star.neighbors.some((n) => n.edge_type === "READ_CONCEPT")) {
          setFocusNotice("This chat didn't read any concepts, so there's nothing to plot.");
        }
        return;
      }

      // ── Sidecar fallback ──
      // Only concepts carrying a ref_id can be drawn: a name-only read has
      // nothing to resolve on click, and it's the same filter stakgraph
      // applies before it writes edges at all.
      const linkable = sidecarConcepts.filter(
        (c): c is SessionConceptSeed & { ref_id: string } => Boolean(c.ref_id),
      );
      if (linkable.length === 0) {
        setFocusError("This chat's concept reads aren't in the graph yet.");
        return;
      }

      const centerId = `${SYNTHETIC_SESSION_PREFIX}${sessionId}`;
      setQueryResult(null);
      setError(null);
      setNotConfigured(false);
      setRawGraph({
        nodes: [
          { id: centerId, label: "This chat", nodeType: "AgentSession" },
          ...linkable.map((c) => ({
            id: c.ref_id,
            label: c.name || c.ref_id,
            nodeType: "Concept",
          })),
        ],
        edges: linkable.map((c) => ({
          source: centerId,
          target: c.ref_id,
          label: "READ_CONCEPT",
        })),
      });
      // Left as drill-down (not walk) mode deliberately: the center is
      // synthetic, so re-centering the walk on it would strand the layout.
      setFocusedNode(null);
      setSearchMatches(null);
      setTab((t) => (t === "2d" ? t : "graph"));
    },
    [workspaceSlug, focusNode, setSearchMatches],
  );

  // ── 3D canvas node click → open sheet ────────────────────────────────────
  const handleCanvasNodeClick = useCallback(
    (id: number) => {
      const node = graph.nodes[id];
      if (!node) return;
      // rawGraph.nodes and graph.nodes share indices (buildGraph preserves
      // order), so the ref_id is a direct lookup.
      const refId = rawNodes[id]?.id;
      if (!refId) return;
      // The sidecar star's center isn't a real node — nothing to open or walk.
      if (refId.startsWith(SYNTHETIC_SESSION_PREFIX)) return;

      if (walkMode) {
        // Walking: clicking a node expands it and re-centers, growing the map.
        // Staying in overview keeps every accumulated node visible — subgraph
        // mode hides anything outside the selected node's directed subtree.
        void focusNode(refId, node.label);
        return;
      }

      // Cypher-result mode keeps its drill-down behavior.
      selectNode(id);
      openNodeDetail(refId, node.label);
    },
    [graph.nodes, rawNodes, walkMode, focusNode, selectNode, openNodeDetail]
  );

  // The 2D view is keyed by ref_id, the 3D canvas by node index. Map across so
  // both clicks land in the same walk/drill-down behavior.
  const handle2DNodeClick = useCallback(
    (refId: string) => {
      const index = rawNodes.findIndex((n) => n.id === refId);
      if (index !== -1) handleCanvasNodeClick(index);
    },
    [rawNodes, handleCanvasNodeClick]
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

  const toggleExpandType = useCallback((type: string) => {
    setExpandTypes((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type],
    );
  }, []);

  // ── Semantic search (Jarvis hybrid keyword + vector) ──────────────────────
  /** Guards against a slow search response overwriting a newer one. */
  const searchRequestRef = useRef(0);

  const runSearch = useCallback(async () => {
    const q = searchQuery.trim();
    if (!q) return;
    const requestId = ++searchRequestRef.current;
    setSearchLoading(true);
    setSearchError(null);
    setSearchResults([]);
    setSearched(true);

    try {
      const params = new URLSearchParams({ q, limit: "25" });
      if (selectedTypes.length > 0) params.set("types", selectedTypes.join(","));

      const res = await fetch(
        `/api/workspaces/${workspaceSlug}/graph/nodes/search?${params.toString()}`
      );
      // A newer search superseded this one while it was in flight — drop it.
      if (requestId !== searchRequestRef.current) return;

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (requestId !== searchRequestRef.current) return;
        setSearchError((data as { message?: string }).message || `Search failed (${res.status})`);
        return;
      }
      const data: GraphSearchResponse = await res.json();
      if (requestId !== searchRequestRef.current) return;
      setSearchResults(Array.isArray(data?.results) ? data.results : []);
    } catch (err) {
      if (requestId !== searchRequestRef.current) return;
      setSearchError(err instanceof Error ? err.message : "Search failed");
    } finally {
      if (requestId === searchRequestRef.current) setSearchLoading(false);
    }
  }, [searchQuery, selectedTypes, workspaceSlug]);

  /** Pending debounced auto-search timer, cleared before any direct trigger. */
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Previous `selectedTypes` reference, used to tell a filter click apart from typing. */
  const prevSelectedTypesRef = useRef(selectedTypes);

  const clearPendingSearch = useCallback(() => {
    if (searchDebounceRef.current) {
      clearTimeout(searchDebounceRef.current);
      searchDebounceRef.current = null;
    }
  }, []);

  /** Manual trigger (Search button / Enter): cancels any pending debounce so it can't double-fire. */
  const triggerSearch = useCallback(() => {
    clearPendingSearch();
    void runSearch();
  }, [clearPendingSearch, runSearch]);

  /**
   * Live search: re-runs automatically whenever the type filter or the query
   * text changes, as long as there's a query to search for. A filter toggle is
   * a discrete click, so it re-runs immediately; free-typing is debounced so
   * we don't fire a request per keystroke.
   */
  useEffect(() => {
    const typesChanged = prevSelectedTypesRef.current !== selectedTypes;
    prevSelectedTypesRef.current = selectedTypes;

    clearPendingSearch();

    if (!searchQuery.trim()) return;

    if (typesChanged) {
      void runSearch();
      return;
    }

    searchDebounceRef.current = setTimeout(() => {
      searchDebounceRef.current = null;
      void runSearch();
    }, 300);

    return () => clearPendingSearch();
  }, [selectedTypes, searchQuery, runSearch, clearPendingSearch]);

  const typeFilterLabel = typeFilterLabelFor(selectedTypes);

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      triggerSearch();
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
      const refId = panelTarget?.refId;
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
    [panelTarget, workspaceSlug, graph.nodes, setSearchMatches]
  );
  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-1 min-h-0 gap-4">
      {/* The canvas column scrolls on its own so the graph can be nearly
          viewport-tall without pushing the docked panels off-screen. */}
      <div
        className="flex flex-col gap-4 flex-1 min-h-0 min-w-0 overflow-y-auto pr-1"
        data-testid="graph-explorer-main"
      >
        {/* ── Search panel ── */}
        <div className="flex gap-2 items-center shrink-0" data-testid="search-panel">
          <Input
            data-testid="search-input"
            placeholder="Semantic search…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={handleSearchKeyDown}
            className="flex-1"
          />
          <NodeTypeFilter
            label={typeFilterLabel}
            nodeTypes={nodeTypes}
            selected={selectedTypes}
            onToggle={toggleType}
            onClear={() => setSelectedTypes([])}
            testId="node-type-filter"
          />
          <Button
            data-testid="search-button"
            variant="secondary"
            onClick={triggerSearch}
            disabled={searchLoading || !searchQuery.trim()}
          >
            {searchLoading ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <Search className="h-4 w-4 mr-2" />
            )}
            Search
          </Button>
          {/* "New" lives in the chat panel's header — it only means anything
              once you're looking at chats. */}
          <Button
            data-testid="graph-chat-toggle-button"
            variant={chatOpen ? "secondary" : "outline"}
            onClick={() => setChatOpen((open) => !open)}
          >
            <MessageSquare className="h-4 w-4 mr-2" />
            Chat
          </Button>
        </div>

        {/* Search results */}
        {searchError && (
          <p className="text-xs text-destructive shrink-0" data-testid="search-error">
            {searchError}
          </p>
        )}
        {searched && !searchLoading && !searchError && searchResults.length === 0 && (
          <p className="text-xs text-muted-foreground shrink-0" data-testid="search-empty">
            No matches{selectedTypes.length > 0 ? ` in ${selectedTypes.join(", ")}` : ""}.
          </p>
        )}

        {searchResults.length > 0 && (
          <div
            className="flex flex-col gap-1 p-2 border rounded-md bg-muted/40 max-h-56 overflow-y-auto shrink-0"
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
        <div className="flex gap-2 items-start shrink-0" data-testid="query-bar">
          <Textarea
            data-testid="cypher-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={2}
            placeholder="MATCH (n) RETURN n LIMIT 25 — Ctrl+Enter to run"
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

        {focusNotice && (
          <Alert data-testid="focus-notice-state">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{focusNotice}</AlertDescription>
          </Alert>
        )}

        {focusError && (
          <Alert variant="destructive" data-testid="focus-error-state">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{focusError}</AlertDescription>
          </Alert>
        )}

        {/* ── Results ── */}
        {/* `focusLoading` deliberately does NOT gate this: expanding a node
            adds to the canvas, so blanking it for a spinner would throw away
            the map the user is walking. The spinner lives in the toolbar. */}
        {!loading && !error && !notConfigured &&
          (queryResult !== null || rawNodes.length > 0 || focusLoading) && (
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
              <Tabs value={tab} onValueChange={setTab} className="flex flex-col shrink-0">
                <div className="flex items-center gap-3 flex-wrap shrink-0">
                  <TabsList>
                    {queryResult !== null && (
                      <TabsTrigger value="table" data-testid="tab-table">
                        Table
                      </TabsTrigger>
                    )}
                    <TabsTrigger value="graph" data-testid="tab-graph">
                      Graph
                    </TabsTrigger>
                    <TabsTrigger value="2d" data-testid="tab-2d">
                      2D
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
                      {/* Grows as the walk accumulates — the signal that
                          expanding is adding to the map, not replacing it. */}
                      <span data-testid="walk-node-count">
                        · {rawGraph.nodes.length} node{rawGraph.nodes.length !== 1 ? "s" : ""}
                      </span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-5 w-5"
                        data-testid="clear-focus-button"
                        onClick={() => {
                          setFocusedNode(null);
                          setRawGraph({ nodes: [], edges: [] });
                          setPanelTarget(null);
                          setNodeDetail(null);
                        }}
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  )}
                  {focusLoading && (
                    <span
                      className="flex items-center gap-1.5 text-xs text-muted-foreground"
                      data-testid="focus-loading-state"
                    >
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Loading node…
                    </span>
                  )}
                  {walkMode && (
                    <div className="flex items-center gap-1.5" data-testid="expand-filter">
                      <span className="text-xs text-muted-foreground">Expand with</span>
                      <NodeTypeFilter
                        label={typeFilterLabelFor(expandTypes)}
                        nodeTypes={nodeTypes}
                        selected={expandTypes}
                        onToggle={toggleExpandType}
                        onClear={() => setExpandTypes([])}
                        testId="expand-type-filter"
                      />
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
                  <TabsContent
                    value="table"
                    className="mt-2 max-h-[60vh] overflow-auto shrink-0"
                  >
                    <ResultTable columns={queryResult.columns} rows={queryResult.rows} />
                  </TabsContent>
                )}

                {/* Sized off the viewport, not the leftover space: scrolling
                    this column down puts the canvas at effectively full screen. */}
                <TabsContent
                  value="graph"
                  className="mt-2 border rounded-md overflow-hidden flex-none h-[calc(100vh-12rem)] min-h-[420px]"
                >
                  {graph.nodes.length > 0 ? (
                    <KGCanvas
                      graph={graph}
                      viewState={viewState}
                      onNodeClick={handleCanvasNodeClick}
                      searchMatches={searchMatches}
                    />
                  ) : focusLoading ? (
                    <div className="flex items-center justify-center h-full gap-2 text-muted-foreground text-sm">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Loading node…
                    </div>
                  ) : (
                    <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
                      No graph nodes found in these results.
                    </div>
                  )}
                </TabsContent>

                {/* Flat 2D reading of the same graph — easier to scan than the
                    radial 3D walk when the result set is small. */}
                <TabsContent
                  value="2d"
                  className="mt-2 border rounded-md overflow-hidden flex-none h-[calc(100vh-12rem)] min-h-[420px]"
                >
                  {rawGraph.nodes.length > 0 ? (
                    <Graph2DView rawGraph={rawGraph} onNodeSelect={handle2DNodeClick} />
                  ) : focusLoading ? (
                    <div className="flex items-center justify-center h-full gap-2 text-muted-foreground text-sm">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Loading node…
                    </div>
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

      {/* ── Node detail panel: docked beside the canvas, never over it ── */}
      {panelTarget && (
        <NodePanel
          refId={panelTarget.refId}
          label={panelTarget.label}
          detail={nodeDetail}
          loading={detailLoading}
          error={detailError}
          traceText={traceText}
          traceLoading={traceLoading}
          onClose={() => {
            setPanelTarget(null);
            setNodeDetail(null);
            setDetailError(null);
          }}
          onFocusNeighbor={(refId, name) => void focusNode(refId, name)}
          onTrace={runTrace}
        />
      )}

      {/* ── Graph agent chat sidebar + new-chat modal ── */}
      {chatOpen && (
        <GraphChatSidebar
          workspaceSlug={workspaceSlug}
          activeSessionId={chatSessionId}
          onSelectThread={setChatSessionId}
          onNewChat={() => setNewChatOpen(true)}
          onShowOnGraph={showSessionOnGraph}
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
    </div>
  );
}
