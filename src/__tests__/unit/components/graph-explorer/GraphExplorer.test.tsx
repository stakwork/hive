import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";

// ── Mock graph-viz-kit (no Three.js / WebGL in tests) ────────────────────────
vi.mock("@/graph-viz-kit", () => ({
  buildGraph: (_nodes: unknown[], _edges: unknown[]) => ({
    nodes: [],
    edges: [],
    adj: [],
    outAdj: [],
    inAdj: [],
  }),
  extractInitialSubgraph: () => ({
    centerId: -1,
    depthMap: new Map(),
    neighborsByDepth: [],
    nodeIds: [],
    edges: [],
  }),
  computeRadialLayout: () => ({
    positions: new Map(),
    treeEdgeSet: new Set(),
    childrenOf: new Map(),
  }),
  extractSubgraph: () => ({
    centerId: 0,
    depthMap: new Map(),
    neighborsByDepth: [],
    nodeIds: [],
    edges: [],
  }),
  VIRTUAL_CENTER: -1,
}));

// ── Mock KGCanvas (dynamic import) ────────────────────────────────────────────
vi.mock("@/components/graph-explorer/KGCanvas", () => ({
  default: () => <div data-testid="kg-canvas" />,
}));

// ── Mock next/dynamic so the dynamic import is resolved synchronously ─────────
vi.mock("next/dynamic", () => ({
  default: (fn: () => Promise<{ default: React.ComponentType }>) => {
    // Return a component that renders the mock KGCanvas placeholder
    const Comp = () => <div data-testid="kg-canvas" />;
    Comp.displayName = "DynamicKGCanvas";
    void fn; // suppress unused warning
    return Comp;
  },
}));

// ── Mock shadcn Sheet ─────────────────────────────────────────────────────────
vi.mock("@/components/ui/sheet", () => ({
  Sheet: ({ children, open }: { children: React.ReactNode; open?: boolean }) =>
    open ? <div data-testid="sheet">{children}</div> : null,
  SheetContent: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="sheet-content">{children}</div>
  ),
  SheetHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  SheetTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
}));

vi.mock("@/components/ui/tabs", () => ({
  Tabs: ({
    children,
    value,
    onValueChange,
  }: {
    children: React.ReactNode;
    value: string;
    onValueChange: (v: string) => void;
  }) => (
    <div data-testid="tabs" data-value={value} onClick={() => onValueChange("graph")}>
      {children}
    </div>
  ),
  TabsList: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TabsTrigger: ({
    children,
    value,
    ...props
  }: {
    children: React.ReactNode;
    value: string;
    [k: string]: unknown;
  }) => (
    <button data-tab={value} {...(props as object)}>
      {children}
    </button>
  ),
  TabsContent: ({ children, value }: { children: React.ReactNode; value: string }) => (
    <div data-testid={`tab-content-${value}`}>{children}</div>
  ),
}));

vi.mock("@/components/ui/alert", () => ({
  Alert: ({
    children,
    ...props
  }: {
    children: React.ReactNode;
    [k: string]: unknown;
  }) => (
    <div role="alert" {...(props as object)}>
      {children}
    </div>
  ),
  AlertDescription: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

import { GraphExplorer } from "@/components/graph-explorer/GraphExplorer";

// ── helpers ───────────────────────────────────────────────────────────────────

const MOCK_COLUMNS = ["n", "r", "m"];
const MOCK_ROWS: unknown[][] = [
  [
    { ref_id: "ref-1", name: "processData", node_type: "Function", file: "src/lib/data.ts" },
    { type: "CALLS" },
    { ref_id: "ref-2", name: "validateInput", node_type: "Function", file: "src/lib/validation.ts" },
  ],
  [
    { ref_id: "ref-1", name: "processData", node_type: "Function", file: "src/lib/data.ts" },
    { type: "CALLS" },
    { ref_id: "ref-3", name: "logResult", node_type: "Function", file: "src/lib/logger.ts" },
  ],
];

const MOCK_SEARCH_RESULTS = {
  results: [
    {
      ref_id: "ref-1",
      node_type: "Concept",
      name: "processData",
      description: "How raw records get normalized.",
    },
    {
      ref_id: "ref-2",
      node_type: "Concept",
      name: "validateInput",
      description: "Input validation rules.",
    },
  ],
};

/** ref-2's own neighborhood, reached by walking from ref-1. */
const MOCK_NODE_DETAIL_REF2 = {
  node: {
    ref_id: "ref-2",
    node_type: "Function",
    name: "validateInput",
    properties: {},
  },
  neighbors: [
    {
      ref_id: "ref-9",
      node_type: "File",
      name: "validation.ts",
      edge_type: "CONTAINS",
      direction: "reverse" as const,
    },
  ],
};

const MOCK_NODE_TYPES = {
  node_types: [
    { type: "Concept", domain: "knowledge", description: "A documented idea." },
    { type: "Function", domain: "code", description: "A function." },
    { type: "File", domain: "code", description: "A source file." },
  ],
};

const MOCK_NODE_DETAIL = {
  node: {
    ref_id: "ref-1",
    node_type: "Function",
    name: "processData",
    properties: { name: "processData", file: "src/lib/data.ts" },
  },
  neighbors: [
    {
      ref_id: "ref-2",
      node_type: "Function",
      name: "validateInput",
      edge_type: "CALLS",
      direction: "forward" as const,
      importance: 0.8,
    },
    {
      ref_id: "ref-3",
      node_type: "File",
      name: "src/lib/data.ts",
      edge_type: "CONTAINS",
      direction: "reverse" as const,
    },
  ],
};

type FetchMockArgs = { ok: boolean; status: number; body?: unknown; text?: string };

function makeFetch({ ok, status, body, text }: FetchMockArgs) {
  return vi.fn().mockResolvedValue({
    ok,
    status,
    json: () => Promise.resolve(body ?? {}),
    text: () => Promise.resolve(text ?? ""),
  });
}

/**
 * Route fetch responses by URL substring. The component fires a node-types
 * request on mount, so index-based sequencing is too brittle — match on the
 * endpoint instead. Unmatched URLs resolve to an empty 200.
 */
type RouteSpec = FetchMockArgs & { match: string };

function makeRoutedFetch(routes: RouteSpec[]) {
  return vi.fn().mockImplementation((url: string) => {
    const cfg = routes.find((r) => url.includes(r.match));
    return Promise.resolve({
      ok: cfg?.ok ?? true,
      status: cfg?.status ?? 200,
      json: () => Promise.resolve(cfg?.body ?? {}),
      text: () => Promise.resolve(cfg?.text ?? ""),
    });
  });
}

/** Default route set: the ontology every render requests. */
const NODE_TYPES_ROUTE: RouteSpec = {
  match: "/graph/node-types",
  ok: true,
  status: 200,
  body: MOCK_NODE_TYPES,
};

/** URLs the mock was called with that contain `substring`. */
function urlsFor(fetchMock: ReturnType<typeof vi.fn>, substring: string): string[] {
  return fetchMock.mock.calls
    .map((c) => String(c[0]))
    .filter((u) => u.includes(substring));
}

// Helper: set global.fetch to handle multiple calls in sequence
function makeSequentialFetch(calls: FetchMockArgs[]) {
  let i = 0;
  return vi.fn().mockImplementation(() => {
    const cfg = calls[Math.min(i++, calls.length - 1)];
    return Promise.resolve({
      ok: cfg.ok,
      status: cfg.status,
      json: () => Promise.resolve(cfg.body ?? {}),
      text: () => Promise.resolve(cfg.text ?? ""),
    });
  });
}

describe("GraphExplorer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  // ── 1. Renders query input and Run button ───────────────────────────────────
  test("renders query input and Run button", () => {
    global.fetch = vi.fn();
    render(<GraphExplorer workspaceSlug="test-ws" />);

    expect(screen.getByTestId("cypher-input")).toBeInTheDocument();
    expect(screen.getByTestId("run-query-button")).toBeInTheDocument();
    expect(screen.getByDisplayValue("MATCH (n) RETURN n LIMIT 25")).toBeInTheDocument();
  });

  // ── 2. Shows loading state while fetching ──────────────────────────────────
  test("shows loading state while fetching", async () => {
    global.fetch = vi.fn().mockReturnValue(new Promise(() => {}));
    render(<GraphExplorer workspaceSlug="test-ws" />);

    await userEvent.click(screen.getByTestId("run-query-button"));

    expect(screen.getByTestId("loading-state")).toBeInTheDocument();
    expect(screen.getByTestId("run-query-button")).toBeDisabled();
  });

  // ── 3. Renders table rows from mock result data ─────────────────────────────
  test("renders table rows from mock result data", async () => {
    global.fetch = makeFetch({
      ok: true,
      status: 200,
      body: { columns: MOCK_COLUMNS, rows: MOCK_ROWS },
    });

    render(<GraphExplorer workspaceSlug="test-ws" />);
    await userEvent.click(screen.getByTestId("run-query-button"));

    await waitFor(() => {
      expect(screen.getByTestId("result-table")).toBeInTheDocument();
    });

    expect(screen.getByText("n")).toBeInTheDocument();
    expect(screen.getByText("r")).toBeInTheDocument();
    expect(screen.getByText("m")).toBeInTheDocument();
  });

  // ── 4. Shows error state on API failure ────────────────────────────────────
  test("shows error state on API failure", async () => {
    global.fetch = makeFetch({
      ok: false,
      status: 500,
      body: { message: "Internal server error" },
    });

    render(<GraphExplorer workspaceSlug="test-ws" />);
    await userEvent.click(screen.getByTestId("run-query-button"));

    await waitFor(() => {
      expect(screen.getByTestId("error-state")).toBeInTheDocument();
      expect(screen.getByText("Internal server error")).toBeInTheDocument();
    });
  });

  // ── 5. Shows "not configured" state on 400 ────────────────────────────────
  test('shows "not configured" state on 400 response', async () => {
    global.fetch = makeFetch({
      ok: false,
      status: 400,
      body: { message: "Graph DB not configured" },
    });

    render(<GraphExplorer workspaceSlug="test-ws" />);
    await userEvent.click(screen.getByTestId("run-query-button"));

    await waitFor(() => {
      expect(screen.getByTestId("not-configured-state")).toBeInTheDocument();
    });
  });

  // ── 6. Ctrl+Enter triggers query ──────────────────────────────────────────
  test("Ctrl+Enter triggers query", async () => {
    const fetchMock = makeFetch({ ok: true, status: 200, body: { columns: [], rows: [] } });
    global.fetch = fetchMock;

    render(<GraphExplorer workspaceSlug="test-ws" />);
    const textarea = screen.getByTestId("cypher-input");

    await userEvent.click(textarea);
    await userEvent.keyboard("{Control>}{Enter}{/Control}");

    await waitFor(() => {
      expect(urlsFor(fetchMock, "/graph/query")).toHaveLength(1);
    });
  });

  // ── 7. Shows empty state when result has no rows ───────────────────────────
  test("shows empty state when result has no rows", async () => {
    global.fetch = makeFetch({ ok: true, status: 200, body: { columns: [], rows: [] } });

    render(<GraphExplorer workspaceSlug="test-ws" />);
    await userEvent.click(screen.getByTestId("run-query-button"));

    await waitFor(() => {
      expect(screen.getByTestId("empty-state")).toBeInTheDocument();
    });
  });

  // ── 8. Renders search panel (input + button) ───────────────────────────────
  test("renders search panel with input and button", () => {
    global.fetch = vi.fn();
    render(<GraphExplorer workspaceSlug="test-ws" />);

    expect(screen.getByTestId("search-panel")).toBeInTheDocument();
    expect(screen.getByTestId("search-input")).toBeInTheDocument();
    expect(screen.getByTestId("search-button")).toBeInTheDocument();
  });

  // ── 9. Search calls the Jarvis node search and shows results ──────────────
  test("search panel calls /graph/nodes/search and renders results", async () => {
    const fetchMock = makeRoutedFetch([
      NODE_TYPES_ROUTE,
      { match: "/graph/nodes/search", ok: true, status: 200, body: MOCK_SEARCH_RESULTS },
    ]);
    global.fetch = fetchMock;

    render(<GraphExplorer workspaceSlug="test-ws" />);

    await userEvent.type(screen.getByTestId("search-input"), "processData");
    await userEvent.click(screen.getByTestId("search-button"));

    await waitFor(() => {
      expect(screen.getByTestId("search-results")).toBeInTheDocument();
    });

    expect(urlsFor(fetchMock, "/api/workspaces/test-ws/graph/nodes/search")).toHaveLength(1);

    // Both hits appear, each labelled with its node type
    expect(screen.getByTestId("search-result-ref-1")).toBeInTheDocument();
    expect(screen.getByTestId("search-result-ref-2")).toBeInTheDocument();
    expect(screen.getByText("processData")).toBeInTheDocument();
    expect(screen.getByText("validateInput")).toBeInTheDocument();
    expect(screen.getByTestId("search-result-ref-1")).toHaveTextContent("Concept");
  });

  // ── 10. Search defaults to the Concept type filter ────────────────────────
  test("search defaults to types=Concept", async () => {
    const fetchMock = makeRoutedFetch([NODE_TYPES_ROUTE]);
    global.fetch = fetchMock;

    render(<GraphExplorer workspaceSlug="test-ws" />);
    await waitFor(() => expect(urlsFor(fetchMock, "/graph/node-types")).toHaveLength(1));

    expect(screen.getByTestId("node-type-filter-button")).toHaveTextContent("Concept");

    await userEvent.type(screen.getByTestId("search-input"), "authService");
    await userEvent.click(screen.getByTestId("search-button"));

    await waitFor(() => expect(urlsFor(fetchMock, "/graph/nodes/search")).toHaveLength(1));

    const url = urlsFor(fetchMock, "/graph/nodes/search")[0];
    expect(url).toContain("q=authService");
    expect(url).toContain("types=Concept");
    expect(url).toContain("/api/workspaces/test-ws/graph/nodes/search");
  });

  // ── 10b. The type filter is selectable ────────────────────────────────────
  test("selecting another node type changes the types param", async () => {
    const fetchMock = makeRoutedFetch([NODE_TYPES_ROUTE]);
    global.fetch = fetchMock;

    render(<GraphExplorer workspaceSlug="test-ws" />);
    await waitFor(() => expect(urlsFor(fetchMock, "/graph/node-types")).toHaveLength(1));

    // Options come from the workspace's own ontology
    await userEvent.click(screen.getByTestId("node-type-filter-button"));
    await waitFor(() => screen.getByTestId("node-type-filter-option-Function"));
    await userEvent.click(screen.getByTestId("node-type-filter-option-Function"));

    // Checkbox items keep the menu open so several types can be picked at once.
    await userEvent.keyboard("{Escape}");

    await userEvent.type(screen.getByTestId("search-input"), "auth");
    await userEvent.click(screen.getByTestId("search-button"));

    await waitFor(() => expect(urlsFor(fetchMock, "/graph/nodes/search")).toHaveLength(1));
    expect(urlsFor(fetchMock, "/graph/nodes/search")[0]).toContain(
      `types=${encodeURIComponent("Concept,Function")}`,
    );
  });

  // ── 10c. "All types" clears the filter ────────────────────────────────────
  test("choosing All types drops the types param", async () => {
    const fetchMock = makeRoutedFetch([NODE_TYPES_ROUTE]);
    global.fetch = fetchMock;

    render(<GraphExplorer workspaceSlug="test-ws" />);
    await waitFor(() => expect(urlsFor(fetchMock, "/graph/node-types")).toHaveLength(1));

    await userEvent.click(screen.getByTestId("node-type-filter-button"));
    await waitFor(() => screen.getByTestId("node-type-filter-all"));
    await userEvent.click(screen.getByTestId("node-type-filter-all"));

    expect(screen.getByTestId("node-type-filter-button")).toHaveTextContent("All types");

    await userEvent.type(screen.getByTestId("search-input"), "auth");
    await userEvent.click(screen.getByTestId("search-button"));

    await waitFor(() => expect(urlsFor(fetchMock, "/graph/nodes/search")).toHaveLength(1));
    expect(urlsFor(fetchMock, "/graph/nodes/search")[0]).not.toContain("types=");
  });

  // ── 10d. No Concept type in the ontology → search everything ──────────────
  test("falls back to all types when the ontology has no Concept", async () => {
    const fetchMock = makeRoutedFetch([
      {
        match: "/graph/node-types",
        ok: true,
        status: 200,
        body: { node_types: [{ type: "File", domain: "code", description: "A file." }] },
      },
    ]);
    global.fetch = fetchMock;

    render(<GraphExplorer workspaceSlug="test-ws" />);

    await waitFor(() =>
      expect(screen.getByTestId("node-type-filter-button")).toHaveTextContent("All types"),
    );

    await userEvent.type(screen.getByTestId("search-input"), "auth");
    await userEvent.click(screen.getByTestId("search-button"));

    await waitFor(() => expect(urlsFor(fetchMock, "/graph/nodes/search")).toHaveLength(1));
    expect(urlsFor(fetchMock, "/graph/nodes/search")[0]).not.toContain("types=");
  });

  // ── 11. Search Enter key triggers search ──────────────────────────────────
  test("pressing Enter in search input triggers search", async () => {
    const fetchMock = makeRoutedFetch([NODE_TYPES_ROUTE]);
    global.fetch = fetchMock;

    render(<GraphExplorer workspaceSlug="test-ws" />);
    await userEvent.type(screen.getByTestId("search-input"), "foo");
    await userEvent.keyboard("{Enter}");

    await waitFor(() => expect(urlsFor(fetchMock, "/graph/nodes/search")).toHaveLength(1));
  });

  // ── 12. Clicking a result loads that node from Jarvis ─────────────────────
  test("clicking a search result fetches the node detail", async () => {
    const fetchMock = makeRoutedFetch([
      NODE_TYPES_ROUTE,
      { match: "/graph/nodes/search", ok: true, status: 200, body: MOCK_SEARCH_RESULTS },
      { match: "/graph/node/", ok: true, status: 200, body: MOCK_NODE_DETAIL },
    ]);
    global.fetch = fetchMock;

    render(<GraphExplorer workspaceSlug="test-ws" />);
    await userEvent.type(screen.getByTestId("search-input"), "processData");
    await userEvent.click(screen.getByTestId("search-button"));

    await waitFor(() => screen.getByTestId("search-results"));
    await userEvent.click(screen.getByTestId("search-result-ref-1"));

    await waitFor(() => expect(urlsFor(fetchMock, "/graph/node/")).toHaveLength(1));
    expect(urlsFor(fetchMock, "/graph/node/")[0]).toBe(
      "/api/workspaces/test-ws/graph/node/ref-1",
    );
  });

  // ── 13. Node panel shows type, properties and directly-linked nodes ───────
  test("node panel renders node type, properties and linked nodes", async () => {
    global.fetch = makeRoutedFetch([
      NODE_TYPES_ROUTE,
      { match: "/graph/nodes/search", ok: true, status: 200, body: MOCK_SEARCH_RESULTS },
      { match: "/graph/node/", ok: true, status: 200, body: MOCK_NODE_DETAIL },
    ]);

    render(<GraphExplorer workspaceSlug="test-ws" />);
    await userEvent.type(screen.getByTestId("search-input"), "processData");
    await userEvent.click(screen.getByTestId("search-button"));
    await waitFor(() => screen.getByTestId("search-results"));
    await userEvent.click(screen.getByTestId("search-result-ref-1"));

    await waitFor(() => screen.getByTestId("node-type-badge"));

    // Real node_type, not the hardcoded "Node" placeholder
    expect(screen.getByTestId("node-type-badge")).toHaveTextContent("Function");
    expect(screen.getByTestId("node-type-badge")).not.toHaveTextContent("Node");

    // Properties from Jarvis
    const props = screen.getByTestId("node-properties-section");
    expect(props).toHaveTextContent("file");
    expect(props).toHaveTextContent("src/lib/data.ts");

    // Directly-linked nodes, grouped by edge type
    const linked = screen.getByTestId("linked-nodes-section");
    expect(linked).toHaveTextContent("Linked Nodes (2)");
    expect(linked).toHaveTextContent("CALLS");
    expect(linked).toHaveTextContent("CONTAINS");
    expect(screen.getByTestId("linked-node-ref-2")).toBeInTheDocument();
    expect(screen.getByTestId("linked-node-ref-3")).toBeInTheDocument();
  });

  // ── 14. Clicking a linked node walks to it ────────────────────────────────
  test("clicking a linked node loads that neighbor", async () => {
    const fetchMock = makeRoutedFetch([
      NODE_TYPES_ROUTE,
      { match: "/graph/nodes/search", ok: true, status: 200, body: MOCK_SEARCH_RESULTS },
      { match: "/graph/node/ref-2", ok: true, status: 200, body: { ...MOCK_NODE_DETAIL, neighbors: [] } },
      { match: "/graph/node/", ok: true, status: 200, body: MOCK_NODE_DETAIL },
    ]);
    global.fetch = fetchMock;

    render(<GraphExplorer workspaceSlug="test-ws" />);
    await userEvent.type(screen.getByTestId("search-input"), "processData");
    await userEvent.click(screen.getByTestId("search-button"));
    await waitFor(() => screen.getByTestId("search-results"));
    await userEvent.click(screen.getByTestId("search-result-ref-1"));

    await waitFor(() => screen.getByTestId("linked-node-ref-2"));
    await userEvent.click(screen.getByTestId("linked-node-ref-2"));

    await waitFor(() => expect(urlsFor(fetchMock, "/graph/node/ref-2")).toHaveLength(1));
    expect(urlsFor(fetchMock, "/graph/node/ref-2")[0]).toBe(
      "/api/workspaces/test-ws/graph/node/ref-2",
    );
  });

  // ── 15. Trace Upstream calls /graph/map with the focused node ─────────────
  test("Trace Upstream button calls /graph/map with direction=up", async () => {
    const fetchMock = makeRoutedFetch([
      NODE_TYPES_ROUTE,
      { match: "/graph/nodes/search", ok: true, status: 200, body: MOCK_SEARCH_RESULTS },
      { match: "/graph/node/", ok: true, status: 200, body: MOCK_NODE_DETAIL },
      { match: "/graph/map", ok: true, status: 200, text: "├── functionA (src/a.ts)" },
    ]);
    global.fetch = fetchMock;

    render(<GraphExplorer workspaceSlug="test-ws" />);
    await userEvent.type(screen.getByTestId("search-input"), "processData");
    await userEvent.click(screen.getByTestId("search-button"));
    await waitFor(() => screen.getByTestId("search-results"));
    await userEvent.click(screen.getByTestId("search-result-ref-1"));

    await waitFor(() => screen.getByTestId("trace-up-button"));
    await userEvent.click(screen.getByTestId("trace-up-button"));

    await waitFor(() => expect(urlsFor(fetchMock, "/graph/map")).toHaveLength(1));
    const traceUrl = urlsFor(fetchMock, "/graph/map")[0];
    expect(traceUrl).toContain("ref_id=ref-1");
    expect(traceUrl).toContain("direction=up");
    expect(traceUrl).toContain("depth=3");
  });

  // ── 15b. `?ref_id=` deep link opens that node on mount ────────────────────
  test("initialRefId deep link loads the node on mount", async () => {
    const fetchMock = makeRoutedFetch([
      NODE_TYPES_ROUTE,
      { match: "/graph/node/", ok: true, status: 200, body: MOCK_NODE_DETAIL },
    ]);
    global.fetch = fetchMock;

    render(<GraphExplorer workspaceSlug="test-ws" initialRefId="ref-1" />);

    await waitFor(() => expect(urlsFor(fetchMock, "/graph/node/")).toHaveLength(1));
    expect(urlsFor(fetchMock, "/graph/node/")[0]).toBe(
      "/api/workspaces/test-ws/graph/node/ref-1",
    );

    // Panel opens, and the canvas is seeded with the node + its neighbors
    await waitFor(() => screen.getByTestId("node-type-badge"));
    expect(screen.getByTestId("focused-node-badge")).toHaveTextContent("processData");
    // The graph tab is rendered without any Cypher result behind it
    expect(screen.getByTestId("tab-content-graph")).toBeInTheDocument();
  });

  // ── 15c. A malformed 200 surfaces an error instead of crashing ────────────
  test("malformed node response shows an error", async () => {
    global.fetch = makeRoutedFetch([
      NODE_TYPES_ROUTE,
      { match: "/graph/node/", ok: true, status: 200, body: { unexpected: true } },
    ]);

    render(<GraphExplorer workspaceSlug="test-ws" initialRefId="ref-1" />);

    await waitFor(() => screen.getByTestId("node-detail-error"));
    expect(screen.getByTestId("node-detail-error")).toHaveTextContent(
      "Malformed node response",
    );
  });

  // ── 15d. Walking accumulates instead of replacing ─────────────────────────
  test("expanding a linked node accumulates onto the existing walk", async () => {
    global.fetch = makeRoutedFetch([
      NODE_TYPES_ROUTE,
      { match: "/graph/node/ref-2", ok: true, status: 200, body: MOCK_NODE_DETAIL_REF2 },
      { match: "/graph/node/", ok: true, status: 200, body: MOCK_NODE_DETAIL },
    ]);

    render(<GraphExplorer workspaceSlug="test-ws" initialRefId="ref-1" />);

    // ref-1 plus its two neighbors
    await waitFor(() =>
      expect(screen.getByTestId("walk-node-count")).toHaveTextContent("3 nodes"),
    );

    await userEvent.click(screen.getByTestId("linked-node-ref-2"));

    // ref-9 joins; ref-1 and ref-3 are still there rather than being replaced
    await waitFor(() =>
      expect(screen.getByTestId("walk-node-count")).toHaveTextContent("4 nodes"),
    );
    expect(screen.getByTestId("focused-node-badge")).toHaveTextContent("validateInput");
  });

  // ── 15e. Jumping somewhere unrelated starts a fresh walk ──────────────────
  test("focusing a node outside the current walk resets the graph", async () => {
    global.fetch = makeRoutedFetch([
      NODE_TYPES_ROUTE,
      {
        match: "/graph/nodes/search",
        ok: true,
        status: 200,
        body: {
          results: [
            {
              ref_id: "ref-99",
              node_type: "Concept",
              name: "Unrelated",
              description: "Somewhere else entirely.",
            },
          ],
        },
      },
      {
        match: "/graph/node/ref-99",
        ok: true,
        status: 200,
        body: {
          node: { ref_id: "ref-99", node_type: "Concept", name: "Unrelated", properties: {} },
          neighbors: [],
        },
      },
      { match: "/graph/node/", ok: true, status: 200, body: MOCK_NODE_DETAIL },
    ]);

    render(<GraphExplorer workspaceSlug="test-ws" initialRefId="ref-1" />);
    await waitFor(() =>
      expect(screen.getByTestId("walk-node-count")).toHaveTextContent("3 nodes"),
    );

    await userEvent.type(screen.getByTestId("search-input"), "unrelated");
    await userEvent.click(screen.getByTestId("search-button"));
    await waitFor(() => screen.getByTestId("search-result-ref-99"));
    await userEvent.click(screen.getByTestId("search-result-ref-99"));

    // A disconnected node can't be laid out alongside the old walk, so the
    // canvas starts over rather than accumulating an unreachable island.
    await waitFor(() =>
      expect(screen.getByTestId("walk-node-count")).toHaveTextContent("1 node"),
    );
  });

  // ── 15f. Expansion can be limited to chosen node types ────────────────────
  test("the expand filter limits which neighbor types are pulled in", async () => {
    const fetchMock = makeRoutedFetch([
      NODE_TYPES_ROUTE,
      { match: "/graph/node/", ok: true, status: 200, body: MOCK_NODE_DETAIL },
    ]);
    global.fetch = fetchMock;

    render(<GraphExplorer workspaceSlug="test-ws" initialRefId="ref-1" />);
    await waitFor(() => screen.getByTestId("expand-filter"));

    // Unfiltered by default — expanding shouldn't silently hide real edges
    expect(urlsFor(fetchMock, "/graph/node/")[0]).not.toContain("types=");
    expect(screen.getByTestId("expand-type-filter-button")).toHaveTextContent("All types");

    await userEvent.click(screen.getByTestId("expand-type-filter-button"));
    await waitFor(() => screen.getByTestId("expand-type-filter-option-Concept"));
    await userEvent.click(screen.getByTestId("expand-type-filter-option-Concept"));
    await userEvent.keyboard("{Escape}");

    await userEvent.click(screen.getByTestId("linked-node-ref-2"));

    await waitFor(() => expect(urlsFor(fetchMock, "/graph/node/")).toHaveLength(2));
    expect(urlsFor(fetchMock, "/graph/node/")[1]).toContain("types=Concept");
  });

  // ── 16. Search shows error message on failure ──────────────────────────────
  test("search shows error on failure", async () => {
    global.fetch = makeRoutedFetch([
      NODE_TYPES_ROUTE,
      { match: "/graph/nodes/search", ok: false, status: 500, body: { message: "Search failed" } },
    ]);

    render(<GraphExplorer workspaceSlug="test-ws" />);
    await userEvent.type(screen.getByTestId("search-input"), "query");
    await userEvent.click(screen.getByTestId("search-button"));

    await waitFor(() => {
      expect(screen.getByTestId("search-error")).toBeInTheDocument();
    });
    expect(screen.getByText("Search failed")).toBeInTheDocument();
  });

  // ── 17. Search button is disabled when input is empty ─────────────────────
  test("search button is disabled when input is empty", () => {
    global.fetch = vi.fn();
    render(<GraphExplorer workspaceSlug="test-ws" />);
    expect(screen.getByTestId("search-button")).toBeDisabled();
  });
});

// ── extractGraph / stakgraphToRawGraph integration via table ─────────────────
describe("ResultTable rendering", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("renders column headers from columns prop", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          columns: ["n", "r", "m"],
          rows: [
            [
              { ref_id: "ref_process_data", name: "processData", node_type: "Function" },
              { type: "CALLS" },
              { ref_id: "ref_validate_input", name: "validateInput", node_type: "Function" },
            ],
          ],
        }),
    });

    render(<GraphExplorer workspaceSlug="test-ws" />);
    await userEvent.click(screen.getByTestId("run-query-button"));

    await waitFor(() => {
      expect(screen.getByTestId("result-table")).toBeInTheDocument();
    });

    expect(screen.getByText("n")).toBeInTheDocument();
    expect(screen.getByText("r")).toBeInTheDocument();
    expect(screen.getByText("m")).toBeInTheDocument();
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });
});
