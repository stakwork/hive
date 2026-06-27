// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import React from "react";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    error: vi.fn(),
    success: vi.fn(),
  }),
}));

vi.mock("date-fns", () => ({
  formatDistanceToNow: () => "about 2 years ago",
}));

vi.mock("@/components/ui/sheet", () => ({
  Sheet: ({ open, children }: any) => (open ? <div data-testid="sheet">{children}</div> : null),
  SheetContent: ({ children }: any) => <div>{children}</div>,
  SheetHeader: ({ children }: any) => <div>{children}</div>,
  SheetTitle: ({ children }: any) => <h2>{children}</h2>,
}));

vi.mock("@/components/ui/select", () => ({
  Select: ({ value, onValueChange, children }: any) => (
    <div data-testid="select-wrapper" data-value={value}>
      {React.Children.map(children, (child) =>
        React.isValidElement(child)
          ? React.cloneElement(child as React.ReactElement<any>, { onValueChange })
          : child,
      )}
    </div>
  ),
  SelectTrigger: ({ children, "data-testid": testId }: any) => (
    <button data-testid={testId}>{children}</button>
  ),
  SelectValue: ({ placeholder }: any) => <span>{placeholder}</span>,
  SelectContent: ({ children, onValueChange }: any) => (
    <div data-testid="select-content">
      {React.Children.map(children, (child) =>
        React.isValidElement(child)
          ? React.cloneElement(child as React.ReactElement<any>, { onValueChange })
          : child,
      )}
    </div>
  ),
  SelectItem: ({ value, children, onValueChange }: any) => (
    <button data-testid={`select-item-${value}`} onClick={() => onValueChange?.(value)}>
      {children}
    </button>
  ),
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, onClick, disabled, "data-testid": testId }: any) => (
    <button data-testid={testId} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
}));

vi.mock("@/components/ui/input", () => ({
  Input: ({ value, onChange, placeholder, "data-testid": testId }: any) => (
    <input data-testid={testId} value={value} onChange={onChange} placeholder={placeholder} />
  ),
}));

// ─── Import after mocks ───────────────────────────────────────────────────────

import { AddEdgePanel } from "@/app/w/[slug]/learn/lingo/components/AddEdgePanel";
import { toast } from "sonner";

// ─── Helpers ──────────────────────────────────────────────────────────────────

let mockFetch: ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockFetch = vi.fn();
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const defaultProps = {
  sourceRefId: "source-node-1",
  workspaceSlug: "my-ws",
  workspaceId: "ws-id-1",
  isOpen: true,
  onClose: vi.fn(),
  onEdgeCreated: vi.fn(),
};

// Helper: make a LingoNode fixture
function makeNode(overrides: Partial<{
  ref_id: string;
  name: string;
  node_type: string;
  definition: string | null;
  date_added_to_graph: number;
}> = {}) {
  return {
    ref_id: "node-1",
    name: "Test Node",
    node_type: "Lingo",
    definition: null,
    date_added_to_graph: 1750000000,
    ...overrides,
  };
}

// Helper: render open panel, listing returns empty, search returns given nodes
async function renderWithSearch(nodes: ReturnType<typeof makeNode>[]) {
  vi.useFakeTimers({ shouldAdvanceTime: true });

  mockFetch
    .mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: { nodes: [], hasMore: false } }), // listing on open
    })
    .mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: nodes }), // search after typing
    });

  render(<AddEdgePanel {...defaultProps} />);
  await act(async () => { await Promise.resolve(); }); // let listing fetch settle
  fireEvent.change(screen.getByTestId("node-search-input"), {
    target: { value: "test" },
  });

  await act(async () => {
    vi.advanceTimersByTime(300);
    await Promise.resolve();
  });

  await waitFor(() => {
    expect(screen.getByTestId("search-results")).toBeInTheDocument();
  });

  vi.useRealTimers();
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe("AddEdgePanel", () => {
  it("does not render when closed", () => {
    render(<AddEdgePanel {...defaultProps} isOpen={false} />);
    expect(screen.queryByTestId("sheet")).not.toBeInTheDocument();
  });

  describe("Empty query on open", () => {
    it("calls listing endpoint immediately on mount with isOpen: true", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: { nodes: [], hasMore: false } }),
      });

      render(<AddEdgePanel {...defaultProps} />);

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(
          `/api/workspaces/${defaultProps.workspaceSlug}/lingo/nodes`,
        );
      });
    });

    it("does not call schema endpoint", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: { nodes: [], hasMore: false } }),
      });

      render(<AddEdgePanel {...defaultProps} />);
      await act(async () => { await Promise.resolve(); });

      const calls = mockFetch.mock.calls.map((c) => c[0] as string);
      expect(calls.every((url) => !url.includes("schema"))).toBe(true);
    });

    it("renders results from listing data.nodes", async () => {
      const node = makeNode({ ref_id: "listed-1", name: "Listed Node" });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: { nodes: [node], hasMore: false } }),
      });

      render(<AddEdgePanel {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByTestId("search-result-listed-1")).toBeInTheDocument();
      });
    });

    it("re-fetches listing when input is cleared back to empty", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ data: { nodes: [], hasMore: false } }), // initial open
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ data: [] }), // search call
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ data: { nodes: [], hasMore: false } }), // re-fetch listing on clear
        });

      render(<AddEdgePanel {...defaultProps} />);
      await act(async () => { await Promise.resolve(); });

      // Type something to trigger search
      fireEvent.change(screen.getByTestId("node-search-input"), { target: { value: "foo" } });
      await act(async () => { vi.advanceTimersByTime(300); await Promise.resolve(); });

      // Clear input → should re-fetch listing
      fireEvent.change(screen.getByTestId("node-search-input"), { target: { value: "" } });
      await act(async () => { await Promise.resolve(); });

      const listingCalls = mockFetch.mock.calls.filter((c) =>
        (c[0] as string).endsWith("/lingo/nodes"),
      );
      expect(listingCalls.length).toBeGreaterThanOrEqual(2);

      vi.useRealTimers();
    });
  });

  describe("Debounced search", () => {
    it("does not fire search before 300ms", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: { nodes: [], hasMore: false } }),
      });

      render(<AddEdgePanel {...defaultProps} />);
      await act(async () => { await Promise.resolve(); });

      const input = screen.getByTestId("node-search-input");
      fireEvent.change(input, { target: { value: "test" } });

      act(() => { vi.advanceTimersByTime(200); });

      // Only the listing call; no search yet
      expect(mockFetch).toHaveBeenCalledTimes(1);

      vi.useRealTimers();
    });

    it("fires search after 300ms debounce with q= and no type= param", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ data: { nodes: [], hasMore: false } }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ data: [] }),
        });

      render(<AddEdgePanel {...defaultProps} />);
      await act(async () => { await Promise.resolve(); });

      fireEvent.change(screen.getByTestId("node-search-input"), { target: { value: "pod" } });

      await act(async () => {
        vi.advanceTimersByTime(300);
        await Promise.resolve();
      });

      await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));
      const searchUrl = mockFetch.mock.calls[1][0] as string;
      expect(searchUrl).toContain("q=pod");
      expect(searchUrl).not.toContain("type=");

      vi.useRealTimers();
    });

    it("renders search results after search fires", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ data: { nodes: [], hasMore: false } }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              data: [makeNode({ ref_id: "result-1", name: "Result Node" })],
            }),
        });

      render(<AddEdgePanel {...defaultProps} />);
      await act(async () => { await Promise.resolve(); });

      fireEvent.change(screen.getByTestId("node-search-input"), {
        target: { value: "result" },
      });

      await act(async () => {
        vi.advanceTimersByTime(300);
        await Promise.resolve();
      });

      await waitFor(() => {
        expect(screen.getByTestId("search-result-result-1")).toBeInTheDocument();
      });

      vi.useRealTimers();
    });

    it("result card shows node_type badge (span.font-mono) and ref_id (p.font-mono)", async () => {
      const node = makeNode({
        ref_id: "badge-1",
        name: "Badge Node",
        node_type: "HiveFeature",
        definition: null,
        date_added_to_graph: 1750000000,
      });

      await renderWithSearch([node]);

      const resultBtn = screen.getByTestId("search-result-badge-1");

      // node_type badge is a span with font-mono
      const badgeSpan = resultBtn.querySelector("span.font-mono");
      expect(badgeSpan).toBeInTheDocument();
      expect(badgeSpan).toHaveTextContent("HiveFeature");

      // ref_id is a p with font-mono
      const refIdP = resultBtn.querySelector("p.font-mono");
      expect(refIdP).toBeInTheDocument();
      expect(refIdP).toHaveTextContent("badge-1");
    });
  });

  describe("Richer search result rows", () => {
    it("displays bold name, node_type badge, ref_id, definition, and relative date in result row", async () => {
      const node = makeNode({
        ref_id: "rich-1",
        name: "Rich Node",
        node_type: "HiveFeature",
        definition: "A short definition",
        date_added_to_graph: 1750000000,
      });

      await renderWithSearch([node]);

      const resultBtn = screen.getByTestId("search-result-rich-1");
      expect(resultBtn).toBeInTheDocument();

      // Bold name
      const nameSpan = resultBtn.querySelector("span.font-semibold");
      expect(nameSpan).toBeInTheDocument();
      expect(nameSpan).toHaveTextContent("Rich Node");

      // node_type badge
      const badgeSpan = resultBtn.querySelector("span.font-mono");
      expect(badgeSpan).toBeInTheDocument();
      expect(badgeSpan).toHaveTextContent("HiveFeature");

      // ref_id
      const refIdP = resultBtn.querySelector("p.font-mono");
      expect(refIdP).toBeInTheDocument();
      expect(refIdP).toHaveTextContent("rich-1");

      // Definition text
      expect(resultBtn).toHaveTextContent("A short definition");

      // Relative date (mocked to "about 2 years ago")
      expect(resultBtn).toHaveTextContent("about 2 years ago");
    });

    it("truncates definition longer than 80 chars with ellipsis", async () => {
      const longDef = "A".repeat(90);
      const node = makeNode({
        ref_id: "long-def-1",
        name: "Long Def Node",
        node_type: "Lingo",
        definition: longDef,
        date_added_to_graph: 1750000000,
      });

      await renderWithSearch([node]);

      const resultBtn = screen.getByTestId("search-result-long-def-1");
      expect(resultBtn).toHaveTextContent("A".repeat(80) + "…");
    });

    it("does not render definition paragraph when definition is null", async () => {
      const node = makeNode({ ref_id: "no-def-1", definition: null });

      await renderWithSearch([node]);

      const resultBtn = screen.getByTestId("search-result-no-def-1");
      // p.font-mono is ref_id; the non-mono p is relative date; no definition p
      const allParagraphs = resultBtn.querySelectorAll("p");
      // ref_id (font-mono) + relative date = 2 paragraphs, no definition
      expect(allParagraphs).toHaveLength(2);
    });
  });

  describe("Lingo → Lingo RELATED_TO", () => {
    it("RELATED_TO is available when a Lingo node is selected as target", async () => {
      const lingoNode = makeNode({ ref_id: "lingo-target-1", name: "Lingo Target", node_type: "Lingo" });
      await renderWithSearch([lingoNode]);

      fireEvent.click(screen.getByTestId("search-result-lingo-target-1"));

      await waitFor(() => {
        expect(screen.getByTestId("select-item-RELATED_TO")).toBeInTheDocument();
      });
    });

    it("HAS_DEFINITION is absent when a Lingo node is selected (EDGE_TYPE_MAP filtering)", async () => {
      const lingoNode = makeNode({ ref_id: "lingo-target-2", name: "Lingo Target 2", node_type: "Lingo" });
      await renderWithSearch([lingoNode]);

      fireEvent.click(screen.getByTestId("search-result-lingo-target-2"));

      await waitFor(() => {
        expect(screen.queryByTestId("select-item-HAS_DEFINITION")).not.toBeInTheDocument();
      });
    });
  });

  describe("Context-aware edge type dropdown", () => {
    it("shows all COMMON_EDGE_TYPES when no target is selected", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: { nodes: [], hasMore: false } }),
      });

      render(<AddEdgePanel {...defaultProps} />);
      await act(async () => { await Promise.resolve(); });

      const commonEdgeTypes = ["RELATED_TO", "PART_OF", "DEPENDS_ON", "SYNONYM_OF", "EXTENDS", "HAS_DEFINITION", "SUPERSEDES"];
      for (const t of commonEdgeTypes) {
        expect(screen.getByTestId(`select-item-${t}`)).toBeInTheDocument();
      }
    });

    it("filters edge types to HAS_DEFINITION only when JargonDefinition target selected", async () => {
      const node = makeNode({ ref_id: "jd-1", name: "Def Node", node_type: "JargonDefinition" });
      await renderWithSearch([node]);

      fireEvent.click(screen.getByTestId("search-result-jd-1"));

      await waitFor(() => {
        expect(screen.getByTestId("select-item-HAS_DEFINITION")).toBeInTheDocument();
        expect(screen.queryByTestId("select-item-RELATED_TO")).not.toBeInTheDocument();
      });
    });

    it("filters edge types to RELATED_TO and HAS_TASK when HiveTask target selected", async () => {
      const node = makeNode({ ref_id: "ht-1", name: "Task Node", node_type: "HiveTask" });
      await renderWithSearch([node]);

      fireEvent.click(screen.getByTestId("search-result-ht-1"));

      await waitFor(() => {
        expect(screen.getByTestId("select-item-RELATED_TO")).toBeInTheDocument();
        expect(screen.getByTestId("select-item-HAS_TASK")).toBeInTheDocument();
        expect(screen.queryByTestId("select-item-PART_OF")).not.toBeInTheDocument();
      });
    });

    it("resets edgeType to first valid type when targetNode changes", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });

      const jdNode = makeNode({ ref_id: "jd-2", name: "Def Node", node_type: "JargonDefinition" });
      const lingoNode = makeNode({ ref_id: "lingo-2", name: "Lingo Node", node_type: "Lingo" });

      mockFetch
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ data: { nodes: [], hasMore: false } }) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ data: [jdNode, lingoNode] }) });

      render(<AddEdgePanel {...defaultProps} />);
      await act(async () => { await Promise.resolve(); });

      fireEvent.change(screen.getByTestId("node-search-input"), { target: { value: "node" } });

      await act(async () => {
        vi.advanceTimersByTime(300);
        await Promise.resolve();
      });
      await waitFor(() => screen.getByTestId("search-result-jd-2"));

      // Select JargonDefinition → edgeType should be HAS_DEFINITION
      fireEvent.click(screen.getByTestId("search-result-jd-2"));
      await waitFor(() => {
        const wrappers = screen.getAllByTestId("select-wrapper");
        const edgeWrapper = wrappers[0]; // only one select now (edge-type)
        expect(edgeWrapper).toHaveAttribute("data-value", "HAS_DEFINITION");
      });

      // Now select Lingo node → edgeType should reset to RELATED_TO
      fireEvent.click(screen.getByTestId("search-result-lingo-2"));
      await waitFor(() => {
        const wrappers = screen.getAllByTestId("select-wrapper");
        const edgeWrapper = wrappers[0];
        expect(edgeWrapper).toHaveAttribute("data-value", "RELATED_TO");
      });

      vi.useRealTimers();
    });
  });

  describe("Selected target box enrichment", () => {
    it("shows node_type badge and definition in the selected-target box", async () => {
      const node = makeNode({
        ref_id: "enriched-1",
        name: "Enriched Node",
        node_type: "HiveFeature",
        definition: "A meaningful definition for enrichment",
        date_added_to_graph: 1750000000,
      });

      await renderWithSearch([node]);
      fireEvent.click(screen.getByTestId("search-result-enriched-1"));

      await waitFor(() => {
        const targetBox = screen.getByTestId("selected-target");
        expect(targetBox).toBeInTheDocument();
        expect(targetBox).toHaveTextContent("HiveFeature");
        expect(targetBox).toHaveTextContent("A meaningful definition for enrichment");
      });
    });

    it("truncates definition > 80 chars in selected-target box", async () => {
      const longDef = "B".repeat(90);
      const node = makeNode({
        ref_id: "enriched-2",
        name: "Long Def",
        node_type: "Lingo",
        definition: longDef,
        date_added_to_graph: 1750000000,
      });

      await renderWithSearch([node]);
      fireEvent.click(screen.getByTestId("search-result-enriched-2"));

      await waitFor(() => {
        const targetBox = screen.getByTestId("selected-target");
        expect(targetBox).toHaveTextContent("B".repeat(80) + "…");
      });
    });

    it("does not render definition in selected-target box when definition is null", async () => {
      const node = makeNode({ ref_id: "no-def-target", name: "No Def", definition: null });

      await renderWithSearch([node]);
      fireEvent.click(screen.getByTestId("search-result-no-def-target"));

      await waitFor(() => {
        const targetBox = screen.getByTestId("selected-target");
        expect(targetBox).toBeInTheDocument();
        // Should not have a <p> for definition
        const paragraphs = targetBox.querySelectorAll("p");
        expect(paragraphs).toHaveLength(0);
      });
    });
  });

  describe("Confirm / POST edge", () => {
    it("confirm button is disabled when no target selected", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: { nodes: [], hasMore: false } }),
      });

      render(<AddEdgePanel {...defaultProps} />);
      await act(async () => { await Promise.resolve(); });

      expect(screen.getByTestId("confirm-add-edge")).toBeDisabled();
    });

    it("calls POST with correct body on confirm", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ data: { nodes: [], hasMore: false } }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              data: [makeNode({ ref_id: "target-node", name: "Target" })],
            }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ success: true }),
        })
        // handleClose resets searchQuery → "" → re-fetches listing
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ data: { nodes: [], hasMore: false } }),
        });

      const onEdgeCreated = vi.fn();
      const onClose = vi.fn();

      render(<AddEdgePanel {...defaultProps} onEdgeCreated={onEdgeCreated} onClose={onClose} />);
      await act(async () => { await Promise.resolve(); });

      fireEvent.change(screen.getByTestId("node-search-input"), {
        target: { value: "target" },
      });

      await act(async () => {
        vi.advanceTimersByTime(300);
        await Promise.resolve();
      });

      await waitFor(() => screen.getByTestId("search-result-target-node"));
      fireEvent.click(screen.getByTestId("search-result-target-node"));

      expect(screen.getByTestId("selected-target")).toBeInTheDocument();

      await act(async () => {
        fireEvent.click(screen.getByTestId("confirm-add-edge"));
      });

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(
          `/api/workspaces/${defaultProps.workspaceSlug}/lingo/edges`,
          expect.objectContaining({
            method: "POST",
            body: JSON.stringify({
              source_ref_id: defaultProps.sourceRefId,
              target_ref_id: "target-node",
              edge_type: "RELATED_TO",
            }),
          }),
        );
        expect(onEdgeCreated).toHaveBeenCalled();
      });

      vi.useRealTimers();
    });

    it("shows error toast on POST failure", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ data: { nodes: [], hasMore: false } }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              data: [makeNode({ ref_id: "t1", name: "T1" })],
            }),
        })
        .mockResolvedValueOnce({
          ok: false,
          json: () => Promise.resolve({ error: "Server error" }),
        });

      render(<AddEdgePanel {...defaultProps} />);
      await act(async () => { await Promise.resolve(); });

      fireEvent.change(screen.getByTestId("node-search-input"), { target: { value: "T1" } });

      await act(async () => {
        vi.advanceTimersByTime(300);
        await Promise.resolve();
      });

      await waitFor(() => screen.getByTestId("search-result-t1"));
      fireEvent.click(screen.getByTestId("search-result-t1"));

      await act(async () => {
        fireEvent.click(screen.getByTestId("confirm-add-edge"));
      });

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith("Server error");
      });

      vi.useRealTimers();
    });
  });
});
