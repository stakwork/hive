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

// Helper: render open panel, schema returns empty, search returns given nodes
async function renderWithSearch(nodes: ReturnType<typeof makeNode>[]) {
  vi.useFakeTimers({ shouldAdvanceTime: true });

  mockFetch
    .mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ node_types: [] }),
    })
    .mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ data: nodes }),
    });

  render(<AddEdgePanel {...defaultProps} />);
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
  describe("Schema loading", () => {
    it("fetches schema on open", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ node_types: ["Jargon", "Feature", "Task"] }),
      });

      render(<AddEdgePanel {...defaultProps} />);

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(
          `/api/swarm/jarvis/schema?id=${defaultProps.workspaceId}`,
        );
      });
    });

    it("does not render when closed", () => {
      render(<AddEdgePanel {...defaultProps} isOpen={false} />);
      expect(screen.queryByTestId("sheet")).not.toBeInTheDocument();
    });

    it("populates node type dropdown with schema types", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ node_types: ["Jargon", "Feature"] }),
      });

      render(<AddEdgePanel {...defaultProps} />);

      await waitFor(() => {
        expect(screen.getByTestId("select-item-Feature")).toBeInTheDocument();
      });
    });
  });

  describe("Default 'All types' state", () => {
    it("node-type select defaults to empty string (All types)", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ node_types: [] }),
      });

      render(<AddEdgePanel {...defaultProps} />);

      // The first select-wrapper rendered is the node-type select
      const wrappers = screen.getAllByTestId("select-wrapper");
      expect(wrappers[0]).toHaveAttribute("data-value", "");
    });

    it("renders 'All types' SelectItem with empty value", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ node_types: [] }),
      });

      render(<AddEdgePanel {...defaultProps} />);

      await waitFor(() => {
        const allTypesItem = screen.getByTestId("select-item-");
        expect(allTypesItem).toBeInTheDocument();
        expect(allTypesItem).toHaveTextContent("All types");
      });
    });

    it("search does not include type= param when selectedType is empty", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ node_types: [] }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ data: [] }),
        });

      render(<AddEdgePanel {...defaultProps} />);
      fireEvent.change(screen.getByTestId("node-search-input"), {
        target: { value: "pod" },
      });

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
  });

  describe("Debounced search", () => {
    it("fires search after 300ms debounce with type when selectedType is set", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ node_types: ["Jargon"] }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              data: [makeNode({ ref_id: "n1", name: "Pod" })],
            }),
        });

      render(<AddEdgePanel {...defaultProps} />);

      // Select "Lingo" type explicitly
      await waitFor(() => screen.getByTestId("select-item-Lingo"));
      fireEvent.click(screen.getByTestId("select-item-Lingo"));

      const input = screen.getByTestId("node-search-input");
      fireEvent.change(input, { target: { value: "pod" } });

      await act(async () => {
        vi.advanceTimersByTime(300);
        await Promise.resolve();
      });

      await waitFor(() => {
        const searchCall = mockFetch.mock.calls.find((c) =>
          (c[0] as string).includes("lingo/nodes/search"),
        );
        expect(searchCall).toBeDefined();
        expect(searchCall![0]).toContain("type=Lingo");
      });

      vi.useRealTimers();
    });

    it("does not fire search before 300ms", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ node_types: [] }),
      });

      render(<AddEdgePanel {...defaultProps} />);
      const input = screen.getByTestId("node-search-input");
      fireEvent.change(input, { target: { value: "test" } });

      act(() => { vi.advanceTimersByTime(200); });

      expect(mockFetch).toHaveBeenCalledTimes(1); // only schema

      vi.useRealTimers();
    });

    it("renders search results after search fires", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ node_types: [] }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              data: [makeNode({ ref_id: "result-1", name: "Result Node" })],
            }),
        });

      render(<AddEdgePanel {...defaultProps} />);
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
      // Should have name and relative date but no definition <p>
      const paragraphs = resultBtn.querySelectorAll("p");
      // Only the relative date paragraph, no definition paragraph
      expect(paragraphs).toHaveLength(1);
    });
  });

  describe("Context-aware edge type dropdown", () => {
    it("shows all COMMON_EDGE_TYPES when no target is selected", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ node_types: [] }),
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
      vi.useFakeTimers({ shouldAdvanceTime: true });

      const jdNode = makeNode({ ref_id: "jd-2", name: "Def Node", node_type: "JargonDefinition" });
      const lingoNode = makeNode({ ref_id: "lingo-2", name: "Lingo Node", node_type: "Lingo" });

      mockFetch
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ node_types: [] }) })
        .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ data: [jdNode, lingoNode] }) });

      render(<AddEdgePanel {...defaultProps} />);
      fireEvent.change(screen.getByTestId("node-search-input"), { target: { value: "node" } });

      await act(async () => {
        vi.advanceTimersByTime(300);
        await Promise.resolve();
      });
      await waitFor(() => screen.getByTestId("search-result-jd-2"));

      // Select JargonDefinition → edgeType should be HAS_DEFINITION
      fireEvent.click(screen.getByTestId("search-result-jd-2"));
      await waitFor(() => {
        // edge type select-wrapper (second one) should have value HAS_DEFINITION
        const wrappers = screen.getAllByTestId("select-wrapper");
        const edgeWrapper = wrappers[1];
        expect(edgeWrapper).toHaveAttribute("data-value", "HAS_DEFINITION");
      });

      // Now select Lingo node → edgeType should reset to RELATED_TO
      fireEvent.click(screen.getByTestId("search-result-lingo-2"));
      await waitFor(() => {
        const wrappers = screen.getAllByTestId("select-wrapper");
        const edgeWrapper = wrappers[1];
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
        json: () => Promise.resolve({ node_types: [] }),
      });

      render(<AddEdgePanel {...defaultProps} />);

      await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
      expect(screen.getByTestId("confirm-add-edge")).toBeDisabled();
    });

    it("calls POST with correct body on confirm", async () => {
      vi.useFakeTimers({ shouldAdvanceTime: true });

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ node_types: [] }),
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
        });

      const onEdgeCreated = vi.fn();
      const onClose = vi.fn();

      render(<AddEdgePanel {...defaultProps} onEdgeCreated={onEdgeCreated} onClose={onClose} />);

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
          json: () => Promise.resolve({ node_types: [] }),
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
