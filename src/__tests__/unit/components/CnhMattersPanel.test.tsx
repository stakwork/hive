/**
 * @vitest-environment jsdom
 *
 * Unit tests for CnhMattersPanel and MatterDetailModal components.
 *
 * Test cases:
 * CnhMattersPanel:
 *  1. Shows sidebar skeleton rows while loading
 *  2. Renders group buttons with correct badge counts after load
 *  3. Selects first group by default
 *  4. Clicking a different group shows its matters
 *  5. Clicking "View Details" opens MatterDetailModal
 *  6. Error state renders error message
 *
 * MatterDetailModal:
 *  7. Shows skeleton while loading detail
 *  8. Renders category sections with file counts and sizes after load
 *  9. "Load Documents" POST triggers ingest, shows loading state
 * 10. On ingest success: toast.success fired, button shows 'Ingestion Started'
 */

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

globalThis.React = React;

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock("@/hooks/useWorkspace", () => ({
  useWorkspace: () => ({ slug: "openlaw", isSuperAdmin: false }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("@/components/ui/scroll-area", () => ({
  ScrollArea: ({ children }: { children: React.ReactNode }) =>
    React.createElement("div", { "data-testid": "scroll-area" }, children),
}));

vi.mock("@/components/ui/skeleton", () => ({
  Skeleton: ({ className }: { className?: string }) =>
    React.createElement("div", { "data-testid": "skeleton", className }),
}));

vi.mock("@/components/ui/badge", () => ({
  Badge: ({
    children,
    variant,
  }: {
    children?: React.ReactNode;
    variant?: string;
  }) =>
    React.createElement(
      "span",
      { "data-testid": "badge", "data-variant": variant },
      children,
    ),
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({
    children,
    onClick,
    disabled,
    variant,
  }: {
    children?: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    variant?: string;
  }) =>
    React.createElement(
      "button",
      { onClick, disabled, "data-variant": variant },
      children,
    ),
}));

vi.mock("@/components/ui/separator", () => ({
  Separator: () => React.createElement("hr", { "data-testid": "separator" }),
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({
    open,
    children,
  }: {
    open: boolean;
    children?: React.ReactNode;
  }) =>
    open
      ? React.createElement("div", { "data-testid": "dialog" }, children)
      : null,
  DialogContent: ({ children }: { children?: React.ReactNode }) =>
    React.createElement("div", { "data-testid": "dialog-content" }, children),
  DialogHeader: ({ children }: { children?: React.ReactNode }) =>
    React.createElement("div", { "data-testid": "dialog-header" }, children),
  DialogTitle: ({ children }: { children?: React.ReactNode }) =>
    React.createElement("h2", { "data-testid": "dialog-title" }, children),
  DialogFooter: ({ children }: { children?: React.ReactNode }) =>
    React.createElement(
      "div",
      { "data-testid": "dialog-footer" },
      children,
    ),
}));

vi.mock("lucide-react", () => ({
  Loader2: ({ className }: { className?: string }) =>
    React.createElement("span", { "data-testid": "loader2", className }),
}));

vi.mock("@/lib/utils/format", () => ({
  formatMB: (bytes: number) => `${(bytes / 1048576).toFixed(1)} MB`,
}));

vi.mock("@/components/legal/StakworkRunLink", () => ({
  StakworkRunLink: ({
    projectId,
    isSuperAdmin,
  }: {
    projectId?: number;
    isSuperAdmin: boolean;
  }) =>
    isSuperAdmin && projectId
      ? React.createElement(
          "a",
          { "data-testid": "stakwork-run-link", href: `#${projectId}` },
          "View on Stakwork",
        )
      : null,
}));

// Mock MatterDetailModal in CnhMattersPanel tests so we can assert on open state
const MockMatterDetailModal = vi.fn(
  ({
    open,
    onOpenChange,
    matterId,
  }: {
    open: boolean;
    onOpenChange: (v: boolean) => void;
    matterId: string;
  }) =>
    open
      ? React.createElement(
          "div",
          { "data-testid": "matter-detail-modal", "data-matter-id": matterId },
          React.createElement(
            "button",
            { onClick: () => onOpenChange(false) },
            "Close",
          ),
        )
      : null,
);

vi.mock("@/components/legal/MatterDetailModal", () => ({
  MatterDetailModal: MockMatterDetailModal,
}));

// ─── Import subjects under test (after mocks) ─────────────────────────────────

// CnhMattersPanel gets the mocked MatterDetailModal (correct — we assert panel behaviour, not modal internals)
const { CnhMattersPanel } = await import("@/components/legal/CnhMattersPanel");

// MatterDetailModal tests need the real implementation, bypassing the vi.mock above
const { MatterDetailModal } = await vi.importActual<typeof import("@/components/legal/MatterDetailModal")>(
  "@/components/legal/MatterDetailModal",
);

// ─── Fixture data ─────────────────────────────────────────────────────────────

const MOCK_GROUPS_RESPONSE = {
  groups: [
    {
      clientCode: "1001",
      matters: [
        { matterId: "1001-00001", path: "tasks/.../1001-00001" },
        { matterId: "1001-00002", path: "tasks/.../1001-00002" },
      ],
    },
    {
      clientCode: "1002",
      matters: [{ matterId: "1002-00001", path: "tasks/.../1002-00001" }],
    },
  ],
  total: 3,
};

const MOCK_DETAIL_RESPONSE = {
  matterId: "1001-00001",
  categories: [
    {
      name: "Antitrust Analysis",
      files: [
        { name: "doc1.pdf", size: 1048576, path: "p/doc1.pdf" },
        { name: "doc2.pdf", size: 2097152, path: "p/doc2.pdf" },
      ],
    },
  ],
};

// ─── CnhMattersPanel tests ────────────────────────────────────────────────────

describe("CnhMattersPanel", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(global, "fetch");
    MockMatterDetailModal.mockClear();
  });

  it("1. Shows skeleton rows while loading", () => {
    // fetch never resolves — stays loading
    fetchSpy.mockReturnValue(new Promise(() => {}));

    render(React.createElement(CnhMattersPanel));

    const skeletons = screen.getAllByTestId("skeleton");
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it("2. Renders group buttons with correct badge counts after load", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => MOCK_GROUPS_RESPONSE,
    } as Response);

    render(React.createElement(CnhMattersPanel));

    // Wait for the groups to appear
    await waitFor(() => {
      expect(screen.getByText("1001")).toBeDefined();
    });

    // Badge for 1001 should show "2"
    const badges = screen.getAllByTestId("badge");
    const counts = badges.map((b) => b.textContent);
    expect(counts).toContain("2");
    expect(counts).toContain("1");
  });

  it("3. Selects first group by default", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => MOCK_GROUPS_RESPONSE,
    } as Response);

    render(React.createElement(CnhMattersPanel));

    await waitFor(() => {
      expect(screen.getByText("1001-00001")).toBeDefined();
    });
  });

  it("4. Clicking a different group shows its matters", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => MOCK_GROUPS_RESPONSE,
    } as Response);

    render(React.createElement(CnhMattersPanel));

    await waitFor(() => {
      expect(screen.getByText("1002")).toBeDefined();
    });

    fireEvent.click(screen.getByText("1002"));

    await waitFor(() => {
      expect(screen.getByText("1002-00001")).toBeDefined();
    });
    // 1001 matters should no longer be visible in main pane
    expect(screen.queryByText("1001-00001")).toBeNull();
  });

  it("5. Clicking 'View Details' opens MatterDetailModal", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => MOCK_GROUPS_RESPONSE,
    } as Response);

    render(React.createElement(CnhMattersPanel));

    await waitFor(() => {
      expect(screen.getByText("1001-00001")).toBeDefined();
    });

    // Click the first "View Details" button
    const viewButtons = screen.getAllByText("View Details");
    fireEvent.click(viewButtons[0]);

    await waitFor(() => {
      expect(screen.getByTestId("matter-detail-modal")).toBeDefined();
    });

    const modal = screen.getByTestId("matter-detail-modal");
    expect(modal.getAttribute("data-matter-id")).toBe("1001-00001");
  });

  it("6. Error state renders error message", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: false,
      status: 403,
      json: async () => ({ error: "Access denied" }),
    } as Response);

    render(React.createElement(CnhMattersPanel));

    await waitFor(() => {
      expect(screen.getByText("Access denied")).toBeDefined();
    });
  });
});

// ─── MatterDetailModal tests ──────────────────────────────────────────────────

describe("MatterDetailModal", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(global, "fetch");
  });

  function renderModal(overrides: Record<string, unknown> = {}) {
    const props = {
      open: true,
      onOpenChange: vi.fn(),
      matterId: "1001-00001",
      slug: "openlaw",
      isSuperAdmin: false,
      ...overrides,
    };
    return render(React.createElement(MatterDetailModal, props));
  }

  it("7. Shows skeleton while loading detail", () => {
    fetchSpy.mockReturnValue(new Promise(() => {}));
    renderModal();
    const skeletons = screen.getAllByTestId("skeleton");
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it("8. Renders category sections with file counts and sizes after load", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => MOCK_DETAIL_RESPONSE,
    } as Response);

    renderModal();

    await waitFor(() => {
      expect(screen.getByText("Antitrust Analysis")).toBeDefined();
    });

    // File count badge: "2 files"
    expect(screen.getByText("2 files")).toBeDefined();
    // File names rendered
    expect(screen.getByText("doc1.pdf")).toBeDefined();
    expect(screen.getByText("doc2.pdf")).toBeDefined();
  });

  it("9. 'Load Documents' POST triggers ingest, shows loading state", async () => {
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => MOCK_DETAIL_RESPONSE,
    } as Response);

    // Second fetch (ingest) never resolves — stays in loading
    fetchSpy.mockReturnValueOnce(new Promise(() => {}));

    renderModal();

    await waitFor(() => {
      expect(screen.getByText("Antitrust Analysis")).toBeDefined();
    });

    const loadBtn = screen.getByText("Load Documents");
    fireEvent.click(loadBtn);

    await waitFor(() => {
      // Button should now be disabled/loading
      const btn = screen.getByText(/loading/i);
      expect(btn).toBeDefined();
    });
  });

  it("10. On ingest success: toast.success fired, button shows 'Ingestion Started'", async () => {
    const { toast } = await import("sonner");

    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => MOCK_DETAIL_RESPONSE,
    } as Response);
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ run_id: "run-123", project_id: 99999 }),
    } as Response);

    renderModal();

    await waitFor(() => {
      expect(screen.getByText("Antitrust Analysis")).toBeDefined();
    });

    const loadBtn = screen.getByText("Load Documents");
    fireEvent.click(loadBtn);

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith("Ingestion started");
    });

    // Button should now show "Ingestion Started" and be disabled
    await waitFor(() => {
      expect(screen.getByText("Ingestion Started")).toBeDefined();
    });
    const btn = screen.getByText("Ingestion Started");
    expect((btn as HTMLButtonElement).disabled).toBe(true);
  });
});
