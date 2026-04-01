import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";

// ── Mock D3 so SVG mutations don't blow up in jsdom ──────────────────────────
vi.mock("d3", () => {
  // Fully-chainable no-op: every property access returns a function that returns
  // the same proxy, so any d3.select(el).selectAll("*").remove() chain works.
  const handler: ProxyHandler<Record<string, unknown>> = {
    get(_t, _p) {
      return (..._args: unknown[]) => chainable;
    },
  };
  const chainable: Record<string, unknown> = new Proxy({}, handler);
  return {
    forceSimulation: () => chainable,
    forceLink: () => chainable,
    forceManyBody: () => chainable,
    forceCenter: () => chainable,
    forceCollide: () => chainable,
    zoom: () => chainable,
    drag: () => chainable,
    select: () => chainable,
    selectAll: () => chainable,
  };
});

// ── Mock shadcn Sheet so it renders children ──────────────────────────────────
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
  Tabs: ({ children, value, onValueChange }: { children: React.ReactNode; value: string; onValueChange: (v: string) => void }) => (
    <div data-testid="tabs" data-value={value} onClick={() => onValueChange("graph")}>{children}</div>
  ),
  TabsList: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  TabsTrigger: ({ children, value, ...props }: { children: React.ReactNode; value: string; [k: string]: unknown }) => (
    <button data-tab={value} {...(props as object)}>{children}</button>
  ),
  TabsContent: ({ children, value }: { children: React.ReactNode; value: string }) => (
    <div data-testid={`tab-content-${value}`}>{children}</div>
  ),
}));

vi.mock("@/components/ui/alert", () => ({
  Alert: ({ children, ...props }: { children: React.ReactNode; [k: string]: unknown }) => (
    <div role="alert" {...(props as object)}>{children}</div>
  ),
  AlertDescription: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

import { GraphExplorer } from "@/components/graph-explorer/GraphExplorer";

// ── helpers ───────────────────────────────────────────────────────────────────

const MOCK_RECORDS = [
  {
    n: { "@rid": "#1:0", "@class": "Function", name: "processData", file: "src/lib/data.ts" },
    r: { "@rid": "#20:0", "@class": "CALLS" },
    m: { "@rid": "#1:1", "@class": "Function", name: "validateInput", file: "src/lib/validation.ts" },
  },
  {
    n: { "@rid": "#1:0", "@class": "Function", name: "processData", file: "src/lib/data.ts" },
    r: { "@rid": "#20:1", "@class": "CALLS" },
    m: { "@rid": "#1:2", "@class": "Function", name: "logResult", file: "src/lib/logger.ts" },
  },
];

function mockFetch(response: { ok: boolean; status: number; body: unknown }) {
  return vi.fn().mockResolvedValue({
    ok: response.ok,
    status: response.status,
    json: () => Promise.resolve(response.body),
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
    // Never resolves → stays loading
    global.fetch = vi.fn().mockReturnValue(new Promise(() => {}));
    render(<GraphExplorer workspaceSlug="test-ws" />);

    await userEvent.click(screen.getByTestId("run-query-button"));

    expect(screen.getByTestId("loading-state")).toBeInTheDocument();
    expect(screen.getByTestId("run-query-button")).toBeDisabled();
  });

  // ── 3. Renders table rows from mock result data ─────────────────────────────
  test("renders table rows from mock result data", async () => {
    global.fetch = mockFetch({ ok: true, status: 200, body: { result: MOCK_RECORDS } });

    render(<GraphExplorer workspaceSlug="test-ws" />);
    await userEvent.click(screen.getByTestId("run-query-button"));

    await waitFor(() => {
      expect(screen.getByTestId("result-table")).toBeInTheDocument();
    });

    // Column headers should be derived from first record keys
    expect(screen.getByText("n")).toBeInTheDocument();
    expect(screen.getByText("r")).toBeInTheDocument();
    expect(screen.getByText("m")).toBeInTheDocument();
  });

  // ── 4. Shows error state on API failure ────────────────────────────────────
  test("shows error state on API failure", async () => {
    global.fetch = mockFetch({
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

  // ── 5. Shows "not configured" state on 400 response ───────────────────────
  test('shows "not configured" state on 400 response', async () => {
    global.fetch = mockFetch({
      ok: false,
      status: 400,
      body: { message: "Graph DB not configured for this workspace" },
    });

    render(<GraphExplorer workspaceSlug="test-ws" />);
    await userEvent.click(screen.getByTestId("run-query-button"));

    await waitFor(() => {
      expect(screen.getByTestId("not-configured-state")).toBeInTheDocument();
    });
  });

  // ── 6. Ctrl+Enter triggers query ──────────────────────────────────────────
  test("Ctrl+Enter triggers query", async () => {
    const fetchMock = mockFetch({ ok: true, status: 200, body: { result: [] } });
    global.fetch = fetchMock;

    render(<GraphExplorer workspaceSlug="test-ws" />);
    const textarea = screen.getByTestId("cypher-input");

    await userEvent.click(textarea);
    await userEvent.keyboard("{Control>}{Enter}{/Control}");

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  // ── 7. Shows empty state when result is empty array ───────────────────────
  test("shows empty state when result has no records", async () => {
    global.fetch = mockFetch({ ok: true, status: 200, body: { result: [] } });

    render(<GraphExplorer workspaceSlug="test-ws" />);
    await userEvent.click(screen.getByTestId("run-query-button"));

    await waitFor(() => {
      expect(screen.getByTestId("empty-state")).toBeInTheDocument();
    });
  });
});
