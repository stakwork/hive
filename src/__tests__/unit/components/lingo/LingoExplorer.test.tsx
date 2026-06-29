// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import React from "react";

// ─── IntersectionObserver must be stubbed before component import ─────────────
let intersectionCallback: ((entries: any[]) => void) | null = null;
const observeMock = vi.fn();
const disconnectMock = vi.fn();

const MockIntersectionObserver = vi.fn((cb: (entries: any[]) => void) => {
  intersectionCallback = cb;
  return { observe: observeMock, disconnect: disconnectMock, unobserve: vi.fn() };
});
vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);

// ─── Other mocks ──────────────────────────────────────────────────────────────

vi.mock("@/hooks/useWorkspace", () => ({
  useWorkspace: () => ({ workspace: { id: "ws-1" } }),
}));

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    error: vi.fn(),
    success: vi.fn(),
  }),
}));

vi.mock("@/components/ui/input", () => ({
  Input: ({ value, onChange, placeholder, ...props }: any) => (
    <input value={value} onChange={onChange} placeholder={placeholder} {...props} />
  ),
}));

vi.mock("@/app/w/[slug]/learn/lingo/components/LingoCard", () => ({
  LingoCard: ({ node, onClick }: any) => (
    <div data-testid={`lingo-card-${node.ref_id}`} onClick={onClick}>
      {node.name}
    </div>
  ),
  LingoCardSkeleton: () => <div data-testid="lingo-card-skeleton" />,
}));

vi.mock("@/app/w/[slug]/learn/lingo/components/NeighborView", () => ({
  NeighborView: ({ node, edges, onDeleteEdge, onDeleteNode, onNavigate, onAddEdge }: any) => (
    <div data-testid="neighbor-view">
      <span data-testid="detail-node-name">{node.name}</span>
      <button data-testid="delete-node-button" onClick={() => onDeleteNode(node.ref_id)}>
        Delete node
      </button>
      {edges.map((e: any) => (
        <div key={e.edge_ref_id}>
          <button
            data-testid={`delete-edge-${e.edge_ref_id}`}
            onClick={() => onDeleteEdge(e.edge_ref_id)}
          >
            delete
          </button>
          <button
            data-testid={`navigate-neighbor-${e.neighbor_node.ref_id}`}
            onClick={() => onNavigate(e.neighbor_node)}
          >
            {e.neighbor_node.name}
          </button>
        </div>
      ))}
      <button data-testid="add-edge-btn" onClick={onAddEdge}>
        Add connection
      </button>
    </div>
  ),
}));

vi.mock("@/app/w/[slug]/learn/lingo/components/Breadcrumb", () => ({
  LingoBreadcrumb: ({ items, onNavigate }: any) => (
    <nav data-testid="lingo-breadcrumb">
      <button data-testid="breadcrumb-home" onClick={() => onNavigate(-1)}>
        Home
      </button>
      {items.map((item: any, index: number) => (
        <button
          key={item.ref_id}
          data-testid={`breadcrumb-item-${index}`}
          onClick={() => onNavigate(index)}
        >
          {item.name}
        </button>
      ))}
    </nav>
  ),
}));

vi.mock("@/app/w/[slug]/learn/lingo/components/AddEdgePanel", () => ({
  AddEdgePanel: ({ isOpen, onClose, onEdgeCreated }: any) =>
    isOpen ? (
      <div data-testid="add-edge-panel">
        <button data-testid="close-panel" onClick={onClose}>
          Close
        </button>
        <button data-testid="trigger-edge-created" onClick={onEdgeCreated}>
          Edge Created
        </button>
      </div>
    ) : null,
}));

vi.mock("@/app/w/[slug]/learn/lingo/components/CreateLingoNodeDialog", () => ({
  CreateLingoNodeDialog: ({ isOpen, onClose, onCreated }: any) =>
    isOpen ? (
      <div data-testid="create-lingo-node-dialog">
        <button data-testid="close-create-dialog" onClick={onClose}>
          Cancel
        </button>
        <button
          data-testid="trigger-node-created"
          onClick={() => {
            onCreated({
              ref_id: "new-node-ref",
              name: "New Term",
              definition: "A new term",
              node_type: "Lingo",
              date_added_to_graph: Date.now() / 1000,
            });
            onClose();
          }}
        >
          Create
        </button>
      </div>
    ) : null,
}));

// ─── Import after mocks ────────────────────────────────────────────────────────

import { LingoExplorer } from "@/app/w/[slug]/learn/lingo/components/LingoExplorer";
import { toast } from "sonner";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const SLUG = "test-ws";

function makeNodes(count: number, startIndex = 1) {
  return Array.from({ length: count }, (_, i) => ({
    ref_id: `jargon-${startIndex + i}`,
    name: `Term ${startIndex + i}`,
    node_type: "Lingo",
    definition: `Definition for term ${startIndex + i}`,
    date_added_to_graph: Date.now() / 1000 - i * 1000,
  }));
}

function makeNeighborData(nodeId: string) {
  return {
    success: true,
    data: {
      node: {
        ref_id: nodeId,
        name: `Term from detail`,
        node_type: "Lingo",
        definition: "Detailed definition",
        date_added_to_graph: 1750000000,
      },
      edges: [
        {
          edge_ref_id: "edge-1",
          edge_type: "RELATED_TO",
          neighbor_node: { ref_id: "neighbor-1", name: "Neighbor Node", node_type: "Lingo" },
        },
      ],
    },
  };
}

let mockFetch: ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockFetch = vi.fn();
  vi.stubGlobal("fetch", mockFetch);
  intersectionCallback = null;
  observeMock.mockClear();
  disconnectMock.mockClear();
  MockIntersectionObserver.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe("LingoExplorer", () => {
  describe("Initial fetch", () => {
    it("calls fetch with limit=50 and offset=0 on mount", async () => {
      const nodes = makeNodes(5);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: { nodes, hasMore: false } }),
      });

      render(<LingoExplorer workspaceSlug={SLUG} />);

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(
          `/api/workspaces/${SLUG}/lingo/nodes?limit=50&offset=0`,
        );
      });
    });

    it("renders loaded cards", async () => {
      const nodes = makeNodes(3);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: { nodes, hasMore: false } }),
      });

      render(<LingoExplorer workspaceSlug={SLUG} />);

      await waitFor(() => {
        expect(screen.getByTestId("lingo-card-jargon-1")).toBeInTheDocument();
        expect(screen.getByTestId("lingo-card-jargon-2")).toBeInTheDocument();
        expect(screen.getByTestId("lingo-card-jargon-3")).toBeInTheDocument();
      });
    });

    it("shows 'No more terms' when hasMore is false and nodes exist", async () => {
      const nodes = makeNodes(3);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: { nodes, hasMore: false } }),
      });

      render(<LingoExplorer workspaceSlug={SLUG} />);

      await waitFor(() => {
        expect(screen.getByTestId("no-more-terms")).toBeInTheDocument();
      });
    });
  });

  describe("hasMore=false stops infinite scroll", () => {
    it("does not trigger second fetch when hasMore=false", async () => {
      const nodes = makeNodes(3);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: { nodes, hasMore: false } }),
      });

      render(<LingoExplorer workspaceSlug={SLUG} />);
      await waitFor(() => screen.getByTestId("lingo-card-jargon-1"));

      // Trigger intersection even though hasMore=false — should not fetch
      await act(async () => {
        intersectionCallback?.([{ isIntersecting: true }]);
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("sets hasMore=false when response returns fewer than 50 items", async () => {
      const nodes = makeNodes(10);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: { nodes, hasMore: false } }),
      });

      render(<LingoExplorer workspaceSlug={SLUG} />);

      await waitFor(() => {
        expect(screen.getByTestId("no-more-terms")).toBeInTheDocument();
      });
    });
  });

  describe("IntersectionObserver second page", () => {
    it("fetches next page with correct offset when sentinel is intersected", async () => {
      const page1 = makeNodes(50, 1);
      const page2 = makeNodes(5, 51);

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ success: true, data: { nodes: page1, hasMore: true } }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ success: true, data: { nodes: page2, hasMore: false } }),
        });

      render(<LingoExplorer workspaceSlug={SLUG} />);

      // Wait for first page to fully render (state settled, isLoadingMore=false)
      await waitFor(() => expect(screen.getByTestId("lingo-card-jargon-1")).toBeInTheDocument());

      // Trigger intersection observer — by now hasMore=true, isLoadingMore=false, offset=50
      await act(async () => {
        intersectionCallback?.([{ isIntersecting: true }]);
      });

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledTimes(2);
        expect(mockFetch).toHaveBeenNthCalledWith(
          2,
          `/api/workspaces/${SLUG}/lingo/nodes?limit=50&offset=50`,
        );
      });
    });
  });

  describe("Name filter", () => {
    it("filters visible cards by name", async () => {
      const nodes = [
        { ref_id: "n1", name: "Alpha Term", node_type: "Lingo", definition: "ctx", date_added_to_graph: 1750000003 },
        { ref_id: "n2", name: "Beta Term", node_type: "Lingo", definition: "ctx", date_added_to_graph: 1750000002 },
        { ref_id: "n3", name: "Alpha Extra", node_type: "Lingo", definition: "ctx", date_added_to_graph: 1750000001 },
      ];
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: { nodes, hasMore: false } }),
      });

      render(<LingoExplorer workspaceSlug={SLUG} />);
      await waitFor(() => screen.getByTestId("lingo-card-n1"));

      fireEvent.change(screen.getByTestId("name-filter-input"), {
        target: { value: "alpha" },
      });

      expect(screen.getByTestId("lingo-card-n1")).toBeInTheDocument();
      expect(screen.queryByTestId("lingo-card-n2")).not.toBeInTheDocument();
      expect(screen.getByTestId("lingo-card-n3")).toBeInTheDocument();
    });
  });

  describe("Detail navigation and breadcrumbs", () => {
    it("opens detail view on card click", async () => {
      const nodes = makeNodes(1);
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ success: true, data: { nodes, hasMore: false } }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(makeNeighborData("jargon-1")),
        });

      render(<LingoExplorer workspaceSlug={SLUG} />);
      await waitFor(() => screen.getByTestId("lingo-card-jargon-1"));

      fireEvent.click(screen.getByTestId("lingo-card-jargon-1"));

      await waitFor(() => {
        expect(screen.getByTestId("neighbor-view")).toBeInTheDocument();
      });
    });

    it("clicking Home breadcrumb returns to list view", async () => {
      const nodes = makeNodes(1);
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ success: true, data: { nodes, hasMore: false } }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(makeNeighborData("jargon-1")),
        });

      render(<LingoExplorer workspaceSlug={SLUG} />);
      await waitFor(() => screen.getByTestId("lingo-card-jargon-1"));

      fireEvent.click(screen.getByTestId("lingo-card-jargon-1"));
      await waitFor(() => screen.getByTestId("neighbor-view"));

      fireEvent.click(screen.getByTestId("breadcrumb-home"));

      await waitFor(() => {
        expect(screen.queryByTestId("neighbor-view")).not.toBeInTheDocument();
        expect(screen.getByTestId("lingo-card-jargon-1")).toBeInTheDocument();
      });
    });

    it("clicking breadcrumb step pops back to that node", async () => {
      const nodes = makeNodes(1);
      const neighborNodeData = makeNeighborData("jargon-1");
      const deepNeighborData = {
        success: true,
        data: {
          node: { ref_id: "neighbor-1", name: "Neighbor Node", node_type: "Lingo", definition: null, date_added_to_graph: 0 },
          edges: [],
        },
      };
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ success: true, data: { nodes, hasMore: false } }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(neighborNodeData),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(deepNeighborData),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(neighborNodeData),
        });

      render(<LingoExplorer workspaceSlug={SLUG} />);
      await waitFor(() => screen.getByTestId("lingo-card-jargon-1"));

      fireEvent.click(screen.getByTestId("lingo-card-jargon-1"));
      await waitFor(() => screen.getByTestId("neighbor-view"));

      fireEvent.click(screen.getByTestId("navigate-neighbor-neighbor-1"));
      await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(3));

      fireEvent.click(screen.getByTestId("breadcrumb-item-0"));

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledTimes(4);
      });
    });
  });

  describe("Optimistic edge delete", () => {
    async function setupDetailView() {
      const nodes = makeNodes(1);
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ success: true, data: { nodes, hasMore: false } }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(makeNeighborData("jargon-1")),
        });

      render(<LingoExplorer workspaceSlug={SLUG} />);
      await waitFor(() => screen.getByTestId("lingo-card-jargon-1"));
      fireEvent.click(screen.getByTestId("lingo-card-jargon-1"));
      await waitFor(() => screen.getByTestId("neighbor-view"));
    }

    it("shows toast when delete is triggered", async () => {
      await setupDetailView();

      fireEvent.click(screen.getByTestId("delete-edge-edge-1"));

      expect(toast).toHaveBeenCalledWith(
        "Connection removed",
        expect.objectContaining({ action: expect.objectContaining({ label: "Undo" }) }),
      );
    });

    it("calls PATCH on confirmed delete (onAutoClose)", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      });

      await setupDetailView();

      let capturedToastOptions: any;
      vi.mocked(toast).mockImplementationOnce((_msg: any, opts: any) => {
        capturedToastOptions = opts;
        return "toast-id";
      });

      fireEvent.click(screen.getByTestId("delete-edge-edge-1"));

      await act(async () => {
        capturedToastOptions?.onAutoClose?.();
      });

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(
          `/api/workspaces/${SLUG}/lingo/edges/edge-1`,
          expect.objectContaining({ method: "PATCH" }),
        );
      });
    });

    it("reverts optimistic delete when undo is clicked", async () => {
      await setupDetailView();

      let capturedToastOptions: any;
      vi.mocked(toast).mockImplementationOnce((_msg: any, opts: any) => {
        capturedToastOptions = opts;
        return "toast-id";
      });

      fireEvent.click(screen.getByTestId("delete-edge-edge-1"));

      act(() => {
        capturedToastOptions?.action?.onClick?.();
      });

      await act(async () => {
        capturedToastOptions?.onAutoClose?.();
      });

      // PATCH was never called because undone=true
      const patchCalls = mockFetch.mock.calls.filter(
        (c: any[]) => typeof c[0] === "string" && c[0].includes("/edges/edge-1"),
      );
      expect(patchCalls).toHaveLength(0);
    });
  });

  describe("Fetch failure", () => {
    it("renders Retry button after fetch failure", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: false, error: "Jarvis error" }),
      });

      render(<LingoExplorer workspaceSlug={SLUG} />);

      await waitFor(() => {
        expect(screen.getByTestId("retry-button")).toBeInTheDocument();
      });
    });

    it("calls toast.error with 'Failed to load Lingo nodes' on success: false response", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: false, error: "Jarvis down" }),
      });

      render(<LingoExplorer workspaceSlug={SLUG} />);

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith("Failed to load Lingo nodes");
      });

      // No node cards rendered (grid container may still exist but be empty)
      expect(screen.queryAllByTestId(/^lingo-card-(?!grid)/).length).toBe(0);
    });

    it("does not trigger second fetch when sentinel intersects after failure", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: false, error: "Jarvis error" }),
      });

      render(<LingoExplorer workspaceSlug={SLUG} />);
      await waitFor(() => screen.getByTestId("retry-button"));

      // Trigger intersection — hasMore should be false so no second fetch
      await act(async () => {
        intersectionCallback?.([{ isIntersecting: true }]);
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("reloads nodes and hides Retry button after successful retry", async () => {
      const nodes = makeNodes(3);

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ success: false, error: "Jarvis error" }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ success: true, data: { nodes, hasMore: false } }),
        });

      render(<LingoExplorer workspaceSlug={SLUG} />);
      await waitFor(() => screen.getByTestId("retry-button"));

      fireEvent.click(screen.getByTestId("retry-button"));

      await waitFor(() => {
        expect(screen.queryByTestId("retry-button")).not.toBeInTheDocument();
        expect(screen.getByTestId("lingo-card-jargon-1")).toBeInTheDocument();
      });
    });
  });

  describe("New Lingo Node button and dialog", () => {
    it("shows 'New Lingo Node' button in list view", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: { nodes: [], hasMore: false } }),
      });

      render(<LingoExplorer workspaceSlug={SLUG} />);
      await waitFor(() =>
        expect(screen.queryByTestId("lingo-card-skeleton")).not.toBeInTheDocument(),
      );

      expect(screen.getByTestId("new-lingo-node-button")).toBeInTheDocument();
    });

    it("opens CreateLingoNodeDialog when button is clicked", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: { nodes: [], hasMore: false } }),
      });

      render(<LingoExplorer workspaceSlug={SLUG} />);
      await waitFor(() =>
        expect(screen.queryByTestId("lingo-card-skeleton")).not.toBeInTheDocument(),
      );

      expect(screen.queryByTestId("create-lingo-node-dialog")).not.toBeInTheDocument();
      fireEvent.click(screen.getByTestId("new-lingo-node-button"));
      expect(screen.getByTestId("create-lingo-node-dialog")).toBeInTheDocument();
    });

    it("hides the button in detail view", async () => {
      const nodes = makeNodes(1);
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ success: true, data: { nodes, hasMore: false } }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(makeNeighborData("jargon-1")),
        });

      render(<LingoExplorer workspaceSlug={SLUG} />);
      await waitFor(() => screen.getByTestId("lingo-card-jargon-1"));

      fireEvent.click(screen.getByTestId("lingo-card-jargon-1"));
      await waitFor(() => screen.getByTestId("neighbor-view"));

      expect(screen.queryByTestId("new-lingo-node-button")).not.toBeInTheDocument();
    });

    it("renders without crash when a node is missing ref_id (key falls back to name)", async () => {
      mockFetch
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              success: true,
              data: {
                nodes: [
                  { ref_id: "valid-ref", name: "Valid Term", node_type: "Lingo", definition: null, date_added_to_graph: 1750000000 },
                  // malformed: no ref_id, but has name for key fallback
                  { name: "No Ref Term", node_type: "Lingo", definition: null, date_added_to_graph: 1749000000 },
                ],
                hasMore: false,
              },
            }),
            { status: 200 },
          ),
        );

      expect(() => render(<LingoExplorer workspaceSlug={SLUG} />)).not.toThrow();

      // Valid node still renders
      await waitFor(() =>
        expect(screen.getByTestId("lingo-card-valid-ref")).toBeInTheDocument(),
      );
    });

    it("handleNodeCreated prepends node to list and navigates to detail view", async () => {

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
              data: {
                node: {
                  ref_id: "new-node-ref",
                  name: "New Term",
                  node_type: "Lingo",
                  definition: null,
                  date_added_to_graph: Date.now() / 1000,
                },
                edges: [],
              },
            }),
        });

      render(<LingoExplorer workspaceSlug={SLUG} />);
      await waitFor(() =>
        expect(screen.queryByTestId("lingo-card-skeleton")).not.toBeInTheDocument(),
      );

      // Open dialog and trigger creation
      fireEvent.click(screen.getByTestId("new-lingo-node-button"));
      await waitFor(() => screen.getByTestId("create-lingo-node-dialog"));

      fireEvent.click(screen.getByTestId("trigger-node-created"));

      // Dialog closes and detail view opens
      await waitFor(() => {
        expect(screen.queryByTestId("create-lingo-node-dialog")).not.toBeInTheDocument();
        expect(screen.getByTestId("neighbor-view")).toBeInTheDocument();
      });
    });
  });

  describe("Optimistic node delete", () => {
    async function setupDetailView() {
      const nodes = makeNodes(2);
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ success: true, data: { nodes, hasMore: false } }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(makeNeighborData("jargon-1")),
        });

      render(<LingoExplorer workspaceSlug={SLUG} />);
      await waitFor(() => screen.getByTestId("lingo-card-jargon-1"));
      fireEvent.click(screen.getByTestId("lingo-card-jargon-1"));
      await waitFor(() => screen.getByTestId("neighbor-view"));
    }

    it("clicking delete button hides the node from the list and navigates back to list view", async () => {
      await setupDetailView();

      fireEvent.click(screen.getByTestId("delete-node-button"));

      // Navigates back to list view
      await waitFor(() => {
        expect(screen.queryByTestId("neighbor-view")).not.toBeInTheDocument();
        expect(screen.getByTestId("lingo-card-grid")).toBeInTheDocument();
      });

      // Node is hidden from list
      expect(screen.queryByTestId("lingo-card-jargon-1")).not.toBeInTheDocument();
      // Other node still visible
      expect(screen.getByTestId("lingo-card-jargon-2")).toBeInTheDocument();

      // Toast shown
      expect(toast).toHaveBeenCalledWith(
        "Node removed",
        expect.objectContaining({ action: expect.objectContaining({ label: "Undo" }) }),
      );
    });

    it("clicking Undo in the toast restores the node in the list", async () => {
      await setupDetailView();

      let capturedToastOptions: any;
      vi.mocked(toast).mockImplementationOnce((_msg: any, opts: any) => {
        capturedToastOptions = opts;
        return "toast-id";
      });

      fireEvent.click(screen.getByTestId("delete-node-button"));

      // Node hidden initially
      await waitFor(() =>
        expect(screen.queryByTestId("lingo-card-jargon-1")).not.toBeInTheDocument(),
      );

      // Undo
      act(() => {
        capturedToastOptions?.action?.onClick?.();
      });

      // Node reappears
      await waitFor(() => {
        expect(screen.getByTestId("lingo-card-jargon-1")).toBeInTheDocument();
      });

      // No DELETE fetch called
      const deleteCalls = mockFetch.mock.calls.filter(
        (c: any[]) => typeof c[0] === "string" && c[0].includes("/lingo/nodes/jargon-1") && c[1]?.method === "DELETE",
      );
      expect(deleteCalls).toHaveLength(0);
    });

    it("confirming (toast dismiss without undo) calls DELETE endpoint", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      });

      await setupDetailView();

      let capturedToastOptions: any;
      vi.mocked(toast).mockImplementationOnce((_msg: any, opts: any) => {
        capturedToastOptions = opts;
        return "toast-id";
      });

      fireEvent.click(screen.getByTestId("delete-node-button"));

      await act(async () => {
        capturedToastOptions?.onAutoClose?.();
      });

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(
          `/api/workspaces/${SLUG}/lingo/nodes/jargon-1`,
          expect.objectContaining({ method: "DELETE" }),
        );
      });
    });

    it("API failure reverts the optimistic hide and shows an error toast", async () => {
      await setupDetailView();

      let capturedToastOptions: any;
      vi.mocked(toast).mockImplementationOnce((_msg: any, opts: any) => {
        capturedToastOptions = opts;
        return "toast-id";
      });

      fireEvent.click(screen.getByTestId("delete-node-button"));

      // Node hidden initially
      await waitFor(() =>
        expect(screen.queryByTestId("lingo-card-jargon-1")).not.toBeInTheDocument(),
      );

      // Simulate API failure
      mockFetch.mockResolvedValueOnce({ ok: false });

      await act(async () => {
        capturedToastOptions?.onAutoClose?.();
      });

      // Node reappears after error
      await waitFor(() => {
        expect(screen.getByTestId("lingo-card-jargon-1")).toBeInTheDocument();
      });

      // Error toast shown
      expect(toast.error).toHaveBeenCalledWith("Failed to delete node");
    });
  });
});
