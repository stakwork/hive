// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

// ─── IntersectionObserver stub (jsdom doesn't implement it) ──────────────────
vi.stubGlobal(
  "IntersectionObserver",
  vi.fn(() => ({ observe: vi.fn(), disconnect: vi.fn(), unobserve: vi.fn() })),
);

// ─── Mocks ────────────────────────────────────────────────────────────────────

const { mockToast, mockToastError } = vi.hoisted(() => ({
  mockToast: vi.fn(),
  mockToastError: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: Object.assign(mockToast, { error: mockToastError }),
}));

vi.mock("@/hooks/useWorkspace", () => ({
  useWorkspace: vi.fn(),
}));

vi.mock("@/hooks/useWorkspaceAccess", () => ({
  useWorkspaceAccess: vi.fn(),
}));

// Stub out child components to keep tests focused on the top-bar behaviour
vi.mock(
  "@/app/w/[slug]/lingo/components/LingoCard",
  () => ({
    LingoCard: () => <div data-testid="lingo-card" />,
    LingoCardSkeleton: () => <div data-testid="lingo-card-skeleton" />,
  }),
);

vi.mock(
  "@/app/w/[slug]/lingo/components/NeighborView",
  () => ({
    NeighborView: () => <div data-testid="neighbor-view" />,
  }),
);

vi.mock(
  "@/app/w/[slug]/lingo/components/Breadcrumb",
  () => ({
    LingoBreadcrumb: () => <div data-testid="lingo-breadcrumb" />,
  }),
);

vi.mock(
  "@/app/w/[slug]/lingo/components/AddEdgePanel",
  () => ({
    AddEdgePanel: () => <div data-testid="add-edge-panel" />,
  }),
);

vi.mock(
  "@/app/w/[slug]/lingo/components/CreateLingoNodeDialog",
  () => ({
    CreateLingoNodeDialog: () => <div data-testid="create-lingo-node-dialog" />,
  }),
);

// ─── Import after mocks ───────────────────────────────────────────────────────

import { useWorkspace } from "@/hooks/useWorkspace";
import { useWorkspaceAccess } from "@/hooks/useWorkspaceAccess";
import { LingoExplorer } from "@/app/w/[slug]/lingo/components/LingoExplorer";

const mockUseWorkspace = useWorkspace as ReturnType<typeof vi.fn>;
const mockUseWorkspaceAccess = useWorkspaceAccess as ReturnType<typeof vi.fn>;

// ─── fetch stub ───────────────────────────────────────────────────────────────

const mockFetch = vi.fn();
global.fetch = mockFetch;

// ─── Helpers ──────────────────────────────────────────────────────────────────

const SLUG = "my-workspace";

function setupWriteAccess(canWrite = true) {
  mockUseWorkspaceAccess.mockReturnValue({ canWrite });
}

function setupWorkspace() {
  mockUseWorkspace.mockReturnValue({
    workspace: { id: "ws-1", slug: SLUG },
  });
}

function setupNodesFetch(nodes: object[] = []) {
  mockFetch.mockResolvedValue({
    ok: true,
    json: async () => ({ success: true, data: { nodes, hasMore: false } }),
  });
}

function renderExplorer() {
  return render(<LingoExplorer workspaceSlug={SLUG} />);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("LingoExplorer (/w/[slug]/lingo) — Run Extraction button", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupWorkspace();
    setupNodesFetch();
  });

  it("shows run-extraction-button in list view for write-capable members", async () => {
    setupWriteAccess(true);
    renderExplorer();

    await waitFor(() => {
      expect(
        screen.getByTestId("run-extraction-button"),
      ).toBeInTheDocument();
    });
  });

  it("shows run-extraction-button in detail view (not hidden by list guard)", async () => {
    setupWriteAccess(true);

    // First fetch: nodes list; second fetch: node detail
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            nodes: [
              { ref_id: "node-1", name: "Alpha", node_type: "Lingo", date_added_to_graph: 0 },
            ],
            hasMore: false,
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            node: {
              ref_id: "node-1",
              name: "Alpha",
              node_type: "Lingo",
              date_added_to_graph: 0,
            },
            edges: [],
          },
        }),
      });

    renderExplorer();

    // Wait for list to render
    await waitFor(() =>
      expect(screen.getByTestId("lingo-card-grid")).toBeInTheDocument(),
    );

    // Navigate to detail view
    const card = await screen.findByTestId("lingo-card");
    await act(async () => {
      fireEvent.click(card);
    });

    // Button must still be present in detail view
    await waitFor(() => {
      expect(screen.getByTestId("run-extraction-button")).toBeInTheDocument();
    });
  });

  it("hides run-extraction-button when canWrite is false (VIEWER/STAKEHOLDER role)", async () => {
    setupWriteAccess(false);
    renderExplorer();

    await waitFor(() => {
      expect(
        screen.queryByTestId("run-extraction-button"),
      ).not.toBeInTheDocument();
    });
  });

  it("disables the button while the POST is in-flight", async () => {
    setupWriteAccess(true);

    // Nodes fetch resolves immediately; extraction fetch hangs
    let resolveExtract!: (value: unknown) => void;
    const hangingExtract = new Promise((res) => {
      resolveExtract = res;
    });

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: { nodes: [], hasMore: false } }),
      })
      .mockReturnValueOnce(hangingExtract as Promise<Response>);

    renderExplorer();

    const button = await screen.findByTestId("run-extraction-button");

    await act(async () => {
      fireEvent.click(button);
    });

    expect(button).toBeDisabled();

    // Clean up the hanging promise
    resolveExtract({
      ok: true,
      json: async () => ({ success: true, runs: [] }),
    });
  });

  it("shows success toast on 200 response", async () => {
    setupWriteAccess(true);

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: { nodes: [], hasMore: false } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          runs: [{ id: "run-1", janitorType: "LINGO_EXTRACTION", status: "IN_PROGRESS" }],
        }),
      });

    renderExplorer();
    const button = await screen.findByTestId("run-extraction-button");

    await act(async () => {
      fireEvent.click(button);
    });

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        "Extraction started",
        expect.objectContaining({ description: "Lingo nodes will update shortly." }),
      );
    });
  });

  it("shows error toast with parsed error field from non-2xx response", async () => {
    setupWriteAccess(true);

    const serverErrorMessage =
      "Lingo extraction is not enabled for this workspace. Contact your admin to enable it.";

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: { nodes: [], hasMore: false } }),
      })
      .mockResolvedValueOnce({
        ok: false,
        json: async () => ({ error: serverErrorMessage }),
      });

    renderExplorer();
    const button = await screen.findByTestId("run-extraction-button");

    await act(async () => {
      fireEvent.click(button);
    });

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith(
        "Extraction failed",
        expect.objectContaining({ description: serverErrorMessage }),
      );
    });

    // Must show the parsed error field, not a generic raw string
    const call = mockToastError.mock.calls[0];
    expect(call[1].description).toBe(serverErrorMessage);
  });

  it("re-enables the button after the request completes", async () => {
    setupWriteAccess(true);

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: { nodes: [], hasMore: false } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          runs: [{ id: "run-1", janitorType: "LINGO_EXTRACTION", status: "IN_PROGRESS" }],
        }),
      });

    renderExplorer();
    const button = await screen.findByTestId("run-extraction-button");

    await act(async () => {
      fireEvent.click(button);
    });

    await waitFor(() => {
      expect(button).not.toBeDisabled();
    });
  });
});
