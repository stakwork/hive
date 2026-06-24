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

vi.mock("@/app/w/[slug]/learn/lingo/components/JargonCard", () => ({
  JargonCard: ({ node, onClick }: any) => (
    <div data-testid={`jargon-card-${node.ref_id}`} onClick={onClick}>
      {node.name}
    </div>
  ),
  JargonCardSkeleton: () => <div data-testid="jargon-card-skeleton" />,
}));

vi.mock("@/app/w/[slug]/learn/lingo/components/NeighborView", () => ({
  NeighborView: ({ node, edges, onDeleteEdge, onNavigate, onAddEdge }: any) => (
    <div data-testid="neighbor-view">
      <span data-testid="detail-node-name">{node.name}</span>
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
              jargon_context: "",
              jargon_candidates: [],
              created_at: new Date().toISOString(),
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
    jargon_context: `Context for term ${startIndex + i}`,
    jargon_candidates: ["alias"],
    created_at: new Date(Date.now() - i * 1000).toISOString(),
  }));
}

function makeNeighborData(nodeId: string) {
  return {
    success: true,
    data: {
      node: {
        ref_id: nodeId,
        name: `Term from detail`,
        jargon_context: "Detailed context",
        jargon_candidates: [],
        created_at: "2026-01-01T00:00:00Z",
      },
      edges: [
        {
          edge_ref_id: "edge-1",
          edge_type: "RELATED_TO",
          neighbor_node: { ref_id: "neighbor-1", name: "Neighbor Node", node_type: "Jargon" },
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
        expect(screen.getByTestId("jargon-card-jargon-1")).toBeInTheDocument();
        expect(screen.getByTestId("jargon-card-jargon-2")).toBeInTheDocument();
        expect(screen.getByTestId("jargon-card-jargon-3")).toBeInTheDocument();
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
      await waitFor(() => screen.getByTestId("jargon-card-jargon-1"));

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
      await waitFor(() => expect(screen.getByTestId("jargon-card-jargon-1")).toBeInTheDocument());

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
        { ref_id: "n1", name: "Alpha Term", jargon_context: "ctx", jargon_candidates: [], created_at: "2026-01-01T00:00:00Z" },
        { ref_id: "n2", name: "Beta Term", jargon_context: "ctx", jargon_candidates: [], created_at: "2026-01-01T00:00:00Z" },
        { ref_id: "n3", name: "Alpha Extra", jargon_context: "ctx", jargon_candidates: [], created_at: "2026-01-01T00:00:00Z" },
      ];
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ success: true, data: { nodes, hasMore: false } }),
      });

      render(<LingoExplorer workspaceSlug={SLUG} />);
      await waitFor(() => screen.getByTestId("jargon-card-n1"));

      fireEvent.change(screen.getByTestId("name-filter-input"), {
        target: { value: "alpha" },
      });

      expect(screen.getByTestId("jargon-card-n1")).toBeInTheDocument();
      expect(screen.queryByTestId("jargon-card-n2")).not.toBeInTheDocument();
      expect(screen.getByTestId("jargon-card-n3")).toBeInTheDocument();
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
      await waitFor(() => screen.getByTestId("jargon-card-jargon-1"));

      fireEvent.click(screen.getByTestId("jargon-card-jargon-1"));

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
      await waitFor(() => screen.getByTestId("jargon-card-jargon-1"));

      fireEvent.click(screen.getByTestId("jargon-card-jargon-1"));
      await waitFor(() => screen.getByTestId("neighbor-view"));

      fireEvent.click(screen.getByTestId("breadcrumb-home"));

      await waitFor(() => {
        expect(screen.queryByTestId("neighbor-view")).not.toBeInTheDocument();
        expect(screen.getByTestId("jargon-card-jargon-1")).toBeInTheDocument();
      });
    });

    it("clicking breadcrumb step pops back to that node", async () => {
      const nodes = makeNodes(1);
      const neighborNodeData = makeNeighborData("jargon-1");
      const deepNeighborData = {
        success: true,
        data: {
          node: { ref_id: "neighbor-1", name: "Neighbor Node", jargon_context: "", jargon_candidates: [], created_at: "" },
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
      await waitFor(() => screen.getByTestId("jargon-card-jargon-1"));

      fireEvent.click(screen.getByTestId("jargon-card-jargon-1"));
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
      await waitFor(() => screen.getByTestId("jargon-card-jargon-1"));
      fireEvent.click(screen.getByTestId("jargon-card-jargon-1"));
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
        expect(screen.getByTestId("jargon-card-jargon-1")).toBeInTheDocument();
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
        expect(screen.queryByTestId("jargon-card-skeleton")).not.toBeInTheDocument(),
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
        expect(screen.queryByTestId("jargon-card-skeleton")).not.toBeInTheDocument(),
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
      await waitFor(() => screen.getByTestId("jargon-card-jargon-1"));

      fireEvent.click(screen.getByTestId("jargon-card-jargon-1"));
      await waitFor(() => screen.getByTestId("neighbor-view"));

      expect(screen.queryByTestId("new-lingo-node-button")).not.toBeInTheDocument();
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
                  jargon_context: "",
                  jargon_candidates: [],
                  created_at: new Date().toISOString(),
                },
                edges: [],
              },
            }),
        });

      render(<LingoExplorer workspaceSlug={SLUG} />);
      await waitFor(() =>
        expect(screen.queryByTestId("jargon-card-skeleton")).not.toBeInTheDocument(),
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
});
