// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act, cleanup } from "@testing-library/react";
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
  // Default fallback: any unexpected/leftover fetch from a previous test resolves
  // to an empty-but-valid listing response so it never consumes error-state mocks.
  mockFetch.mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ success: true, data: { nodes: [], hasMore: false } }),
  });
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(async () => {
  // Unmount all components before restoring mocks so pending async chains
  // in still-mounted components don't consume the next test's mock calls.
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
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
// Uses real timers so the debounce+fetch chain fully completes before returning.
async function renderWithSearch(nodes: ReturnType<typeof makeNode>[]) {
  mockFetch
    .mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: true, data: { nodes: [], hasMore: false } }), // listing on open
    })
    .mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ success: true, data: nodes }), // search after typing
    });

  render(<AddEdgePanel {...defaultProps} />);
  await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1)); // listing settled

  fireEvent.change(screen.getByTestId("node-search-input"), {
    target: { value: "test" },
  });

  await waitFor(() => {
    expect(screen.getByTestId("search-results")).toBeInTheDocument();
  }, { timeout: 2000 });
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe("AddEdgePanel", () => {
  it("does not render when closed", () => {
    render(<AddEdgePanel {...defaultProps} isOpen={false} />);
    expect(screen.queryByTestId("sheet")).not.toBeInTheDocument();
  });

  describe("Empty query on open", () => {
    it("calls listing endpoint immediately on mount", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: { nodes: [], hasMore: false } }),
      });

      render(<AddEdgePanel {...defaultProps} />);

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(
          `/api/workspaces/${defaultProps.workspaceSlug}/lingo/nodes`,
        );
      });
      // No search call made
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("renders nodes from listing data.nodes", async () => {
      const node = makeNode({ ref_id: "listed-1", name: "Listed Node", node_type: "Lingo" });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: { nodes: [node], hasMore: false } }),
      });

      render(<AddEdgePanel {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByTestId("search-results")).toBeInTheDocument();
        expect(screen.getByTestId("search-result-listed-1")).toBeInTheDocument();
      });
    });

    it("re-fetches listing when input is cleared", async () => {
      // First open → listing
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: { nodes: [], hasMore: false } }),
      });
      // After typing → search
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: [] }),
      });
      // After clearing → listing again
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: { nodes: [], hasMore: false } }),
      });

      render(<AddEdgePanel {...defaultProps} />);
      await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));

      // Type something — debounce fires after 300ms
      fireEvent.change(screen.getByTestId("node-search-input"), { target: { value: "hello" } });
      await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2));

      // Clear input — listing fires immediately
      fireEvent.change(screen.getByTestId("node-search-input"), { target: { value: "" } });

      await waitFor(() => {
        const listingCalls = mockFetch.mock.calls.filter(
          (c) => (c[0] as string).endsWith("/lingo/nodes"),
        );
        expect(listingCalls.length).toBe(2);
      }, { timeout: 2000 });
    });
  });

  describe("Debounced search", () => {
    it("does not fire search before 300ms", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: { nodes: [], hasMore: false } }),
      });

      render(<AddEdgePanel {...defaultProps} />);
      // Drain the listing fetch fully with runAllTimersAsync
      await act(async () => { await vi.runAllTimersAsync(); });

      const input = screen.getByTestId("node-search-input");
      fireEvent.change(input, { target: { value: "test" } });

      // Advance only 200ms — debounce (300ms) should not fire yet
      act(() => { vi.advanceTimersByTime(200); });

      // Only the listing call, no search call yet
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Drain remaining timer so it doesn't leak into the next test
      await act(async () => { await vi.runAllTimersAsync(); });
    });

    it("renders search results after search fires", async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ success: true, data: { nodes: [], hasMore: false } }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              success: true,
              data: [makeNode({ ref_id: "result-1", name: "Result Node" })],
            }),
        });

      render(<AddEdgePanel {...defaultProps} />);
      await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
      fireEvent.change(screen.getByTestId("node-search-input"), {
        target: { value: "result" },
      });

      await waitFor(() => {
        expect(screen.getByTestId("search-result-result-1")).toBeInTheDocument();
      }, { timeout: 2000 });
    });
  });

  describe("Typed query", () => {
    it("search URL contains q= and no type= param", async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ success: true, data: { nodes: [], hasMore: false } }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ success: true, data: [] }),
        });

      render(<AddEdgePanel {...defaultProps} />);
      await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
      fireEvent.change(screen.getByTestId("node-search-input"), { target: { value: "pod" } });

      await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2), { timeout: 2000 });
      const searchUrl = mockFetch.mock.calls[1][0] as string;
      expect(searchUrl).toContain("q=pod");
      expect(searchUrl).not.toContain("type=");
    });

    it("result card shows node_type badge (span.font-mono) and ref_id (p.font-mono)", async () => {
      const node = makeNode({
        ref_id: "badge-test-1",
        name: "Badge Node",
        node_type: "HiveFeature",
        definition: null,
        date_added_to_graph: 1750000000,
      });

      await renderWithSearch([node]);

      const resultBtn = screen.getByTestId("search-result-badge-test-1");
      expect(resultBtn).toBeInTheDocument();

      // node_type badge — span.font-mono
      const badgeSpan = resultBtn.querySelector("span.font-mono");
      expect(badgeSpan).toBeInTheDocument();
      expect(badgeSpan).toHaveTextContent("HiveFeature");

      // ref_id — p.font-mono
      const refIdP = resultBtn.querySelector("p.font-mono");
      expect(refIdP).toBeInTheDocument();
      expect(refIdP).toHaveTextContent("badge-test-1");
    });
  });

  describe("Lingo → Lingo RELATED_TO", () => {
    it("selecting a Lingo target makes RELATED_TO available and HAS_DEFINITION absent", async () => {
      const lingoNode = makeNode({ ref_id: "lingo-target-1", name: "Lingo Target", node_type: "Lingo" });

      await renderWithSearch([lingoNode]);

      fireEvent.click(screen.getByTestId("search-result-lingo-target-1"));

      await waitFor(() => {
        expect(screen.getByTestId("select-item-RELATED_TO")).toBeInTheDocument();
        expect(screen.queryByTestId("select-item-HAS_DEFINITION")).not.toBeInTheDocument();
      });
    });
  });

  describe("Richer search result rows", () => {
    it("displays bold name, node_type badge, definition, and relative date in result row", async () => {
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
      // Should have ref_id p.font-mono and relative-date p, but no definition paragraph
      const paragraphs = resultBtn.querySelectorAll("p");
      // ref_id + date = 2 paragraphs; no definition
      expect(paragraphs).toHaveLength(2);
    });
  });

  describe("Context-aware edge type dropdown", () => {
    it("shows all COMMON_EDGE_TYPES when no target is selected", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: { nodes: [], hasMore: false } }),
      });

      render(<AddEdgePanel {...defaultProps} />);
      await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));

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
      const jdNode = makeNode({ ref_id: "jd-2", name: "Def Node", node_type: "JargonDefinition" });
      const lingoNode = makeNode({ ref_id: "lingo-2", name: "Lingo Node", node_type: "Lingo" });

      mockFetch
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ success: true, data: { nodes: [], hasMore: false } }) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ success: true, data: [jdNode, lingoNode] }) });

      render(<AddEdgePanel {...defaultProps} />);
      await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
      fireEvent.change(screen.getByTestId("node-search-input"), { target: { value: "node" } });

      await waitFor(() => screen.getByTestId("search-result-jd-2"), { timeout: 2000 });

      // Select JargonDefinition → edgeType should be HAS_DEFINITION
      fireEvent.click(screen.getByTestId("search-result-jd-2"));
      await waitFor(() => {
        const wrappers = screen.getAllByTestId("select-wrapper");
        expect(wrappers[0]).toHaveAttribute("data-value", "HAS_DEFINITION");
      });

      // Now select Lingo node → edgeType should reset to RELATED_TO
      fireEvent.click(screen.getByTestId("search-result-lingo-2"));
      await waitFor(() => {
        const wrappers = screen.getAllByTestId("select-wrapper");
        expect(wrappers[0]).toHaveAttribute("data-value", "RELATED_TO");
      });
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
        const paragraphs = targetBox.querySelectorAll("p");
        expect(paragraphs).toHaveLength(0);
      });
    });
  });

  describe("Search error state", () => {
    it("shows search-error when debounced search returns success:false", async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ success: true, data: { nodes: [], hasMore: false } }),
        })
        .mockResolvedValueOnce({
          ok: false,
          json: () => Promise.resolve({ success: false, error: "Search unavailable" }),
        });

      render(<AddEdgePanel {...defaultProps} />);
      await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));

      fireEvent.change(screen.getByTestId("node-search-input"), { target: { value: "fail" } });

      await waitFor(() => expect(screen.getByTestId("search-error")).toBeInTheDocument(), { timeout: 2000 });
      expect(screen.queryByTestId("no-results")).not.toBeInTheDocument();
    });

    it("shows search-error when debounced search fetch throws", async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ success: true, data: { nodes: [], hasMore: false } }),
        })
        .mockRejectedValueOnce(new Error("Network error"));

      render(<AddEdgePanel {...defaultProps} />);
      await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));

      fireEvent.change(screen.getByTestId("node-search-input"), { target: { value: "oops" } });

      await waitFor(() => expect(screen.getByTestId("search-error")).toBeInTheDocument(), { timeout: 2000 });
      expect(screen.queryByTestId("no-results")).not.toBeInTheDocument();
    });

    it("clears searchError when query changes after an error", async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ success: true, data: { nodes: [], hasMore: false } }),
        })
        .mockRejectedValueOnce(new Error("Network error"))
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ success: true, data: [] }),
        });

      render(<AddEdgePanel {...defaultProps} />);
      await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));

      // Trigger error
      fireEvent.change(screen.getByTestId("node-search-input"), { target: { value: "bad" } });
      await waitFor(() => expect(screen.getByTestId("search-error")).toBeInTheDocument(), { timeout: 2000 });

      // Change query — useEffect sets setSearchError(false) synchronously before debounce
      fireEvent.change(screen.getByTestId("node-search-input"), { target: { value: "new" } });
      await waitFor(() => expect(screen.queryByTestId("search-error")).not.toBeInTheDocument());
    });

    it("clears searchError when panel is closed", async () => {
      const onClose = vi.fn();

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ success: true, data: { nodes: [], hasMore: false } }),
        })
        .mockRejectedValueOnce(new Error("Network error"))
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ success: true, data: { nodes: [], hasMore: false } }),
        });

      const { rerender } = render(<AddEdgePanel {...defaultProps} onClose={onClose} />);
      await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));

      fireEvent.change(screen.getByTestId("node-search-input"), { target: { value: "bad" } });
      await waitFor(() => expect(screen.getByTestId("search-error")).toBeInTheDocument(), { timeout: 2000 });

      // Close the panel via Cancel button — handleClose sets searchError to false
      fireEvent.click(screen.getByText("Cancel"));

      // Re-open with fresh props
      rerender(<AddEdgePanel {...defaultProps} onClose={onClose} isOpen={true} />);
      await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(3));
      expect(screen.queryByTestId("search-error")).not.toBeInTheDocument();
    });

    it("shows search-error when listing endpoint (empty query) returns success:false", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: false, error: "Search unavailable" }),
      });

      render(<AddEdgePanel {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByTestId("search-error")).toBeInTheDocument();
        expect(screen.queryByTestId("no-results")).not.toBeInTheDocument();
      });
    });
  });

  describe("Confirm / POST edge", () => {
    it("confirm button is disabled when no target selected", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: { nodes: [], hasMore: false } }),
      });

      render(<AddEdgePanel {...defaultProps} />);

      await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
      expect(screen.getByTestId("confirm-add-edge")).toBeDisabled();
    });

    it("calls POST with correct body on confirm", async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ success: true, data: { nodes: [], hasMore: false } }), // listing on open
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              success: true,
              data: [makeNode({ ref_id: "target-node", name: "Target" })],
            }), // search
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ success: true }), // POST
        });

      const onEdgeCreated = vi.fn();
      const onClose = vi.fn();

      render(<AddEdgePanel {...defaultProps} onEdgeCreated={onEdgeCreated} onClose={onClose} />);
      await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));

      fireEvent.change(screen.getByTestId("node-search-input"), {
        target: { value: "target" },
      });

      await waitFor(() => screen.getByTestId("search-result-target-node"), { timeout: 2000 });
      fireEvent.click(screen.getByTestId("search-result-target-node"));
      expect(screen.getByTestId("selected-target")).toBeInTheDocument();

      fireEvent.click(screen.getByTestId("confirm-add-edge"));

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
    });

    it("shows error toast on POST failure", async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ success: true, data: { nodes: [], hasMore: false } }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              success: true,
              data: [makeNode({ ref_id: "t1", name: "T1" })],
            }),
        })
        .mockResolvedValueOnce({
          ok: false,
          json: () => Promise.resolve({ error: "Server error" }),
        });

      render(<AddEdgePanel {...defaultProps} />);
      await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
      fireEvent.change(screen.getByTestId("node-search-input"), { target: { value: "T1" } });

      await waitFor(() => screen.getByTestId("search-result-t1"), { timeout: 2000 });
      fireEvent.click(screen.getByTestId("search-result-t1"));

      fireEvent.click(screen.getByTestId("confirm-add-edge"));

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith("Server error");
      });
    });
  });
});
