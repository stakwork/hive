// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act, within } from "@testing-library/react";
import { WorkflowRunsTable } from "@/components/workflow/inspector/WorkflowRunsTable";
import type { WorkflowRun } from "@/hooks/useWorkflowRuns";

// ── mock FlagRunEvalModal ─────────────────────────────────────────────────────
const mockFlagRunEvalModal = vi.fn();
vi.mock("@/components/evals/FlagRunEvalModal", () => ({
  FlagRunEvalModal: (props: {
    open: boolean;
    onOpenChange: (v: boolean) => void;
    slug: string;
    workflowId: string;
    runId: string;
    onCaptured: () => void;
  }) => {
    mockFlagRunEvalModal(props);
    return props.open ? (
      <div data-testid={`flag-modal-${props.runId}`}>
        <button
          data-testid={`flag-modal-capture-${props.runId}`}
          onClick={() => props.onCaptured()}
        >
          Capture
        </button>
        <button
          data-testid={`flag-modal-close-${props.runId}`}
          onClick={() => props.onOpenChange(false)}
        >
          Close
        </button>
      </div>
    ) : null;
  },
}));

// ── mock useWorkflowRuns ──────────────────────────────────────────────────────
const mockUseWorkflowRuns = vi.fn();

vi.mock("@/hooks/useWorkflowRuns", () => ({
  useWorkflowRuns: (...args: unknown[]) => mockUseWorkflowRuns(...args),
}));

// ── mock shadcn Skeleton ──────────────────────────────────────────────────────
vi.mock("@/components/ui/skeleton", () => ({
  Skeleton: ({ className }: { className?: string }) => (
    <div data-testid="skeleton" className={className} />
  ),
}));

// ── mock shadcn Tooltip ───────────────────────────────────────────────────────
vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children, asChild }: { children: React.ReactNode; asChild?: boolean }) =>
    asChild ? <>{children}</> : <span>{children}</span>,
  TooltipContent: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="tooltip-content">{children}</div>
  ),
}));

// ── mock DropdownMenu ─────────────────────────────────────────────────────────
vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="dropdown-menu">{children}</div>
  ),
  DropdownMenuTrigger: ({
    children,
    asChild,
    onClick,
  }: {
    children: React.ReactNode;
    asChild?: boolean;
    onClick?: React.MouseEventHandler;
  }) => (
    <div data-testid="dropdown-trigger" onClick={onClick}>
      {asChild ? children : <button>{children}</button>}
    </div>
  ),
  DropdownMenuContent: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="dropdown-content">{children}</div>
  ),
  DropdownMenuItem: ({
    children,
    onClick,
    disabled,
    asChild,
  }: {
    children: React.ReactNode;
    onClick?: React.MouseEventHandler;
    disabled?: boolean;
    asChild?: boolean;
  }) =>
    asChild ? (
      <div data-testid="dropdown-item">{children}</div>
    ) : (
      <button data-testid="dropdown-item" onClick={onClick} disabled={disabled}>
        {children}
      </button>
    ),
}));

// ── mock startDebugRun ────────────────────────────────────────────────────────
const mockStartDebugRun = vi.fn();
vi.mock("@/lib/workflow/debugRun", () => ({
  startDebugRun: (...args: unknown[]) => mockStartDebugRun(...args),
}));

// ── mock sonner toast ─────────────────────────────────────────────────────────
const mockToastError = vi.fn();
vi.mock("sonner", () => ({
  toast: { error: (...args: unknown[]) => mockToastError(...args) },
}));

// ── helpers ───────────────────────────────────────────────────────────────────
function renderTable(extraProps: Partial<React.ComponentProps<typeof WorkflowRunsTable>> = {}) {
  return render(<WorkflowRunsTable slug="test-ws" workflowId={42} {...extraProps} />);
}

function setupRuns(runs: WorkflowRun[], isLoading = false) {
  mockUseWorkflowRuns.mockReturnValue({ runs, isLoading, error: null, refetch: vi.fn() });
}

const MOCK_RUNS: WorkflowRun[] = [
  {
    id: 1001,
    name: "Run #1001",
    status: "finished",
    started_at: "2024-03-18T14:00:00.000Z",
    finished_at: "2024-03-18T14:32:10.000Z",
  },
  {
    id: 1002,
    name: "Run #1002",
    status: "error",
    started_at: "2024-03-17T09:00:00.000Z",
    finished_at: null,
  },
];

const LONG_NAME = "A".repeat(41); // 41 chars, exceeds MAX_RUN_NAME_LEN=40
const LONG_NAME_RUN: WorkflowRun = {
  id: 2001,
  name: LONG_NAME,
  status: "finished",
  started_at: "2024-04-01T10:00:00.000Z",
  finished_at: "2024-04-01T10:05:00.000Z",
};

const ACTIVE_RUN: WorkflowRun = {
  id: 1003,
  name: "Active Run",
  status: "active",
  started_at: "2024-04-01T10:00:00.000Z",
  finished_at: null,
};

const COMPLETED_RUN: WorkflowRun = {
  id: 1004,
  name: "Completed Run",
  status: "completed",
  started_at: "2024-03-16T08:00:00.000Z",
  finished_at: "2024-03-16T08:45:00.000Z",
};

// ── tests ─────────────────────────────────────────────────────────────────────
describe("WorkflowRunsTable", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStartDebugRun.mockResolvedValue("new-task-id");
  });

  it("shows skeletons while loading", () => {
    setupRuns([], true);
    renderTable();
    const skeletons = screen.getAllByTestId("skeleton");
    expect(skeletons.length).toBeGreaterThanOrEqual(3);
  });

  it("shows empty state when not loading and no runs", () => {
    setupRuns([], false);
    renderTable();
    expect(screen.getByText("No runs recorded yet.")).toBeInTheDocument();
  });

  it("renders status label text matching run status", () => {
    setupRuns(MOCK_RUNS);
    renderTable();

    expect(screen.getByText("Finished")).toBeInTheDocument();
    expect(screen.getByText("Error")).toBeInTheDocument();
  });

  it("shows duration as Xm Ys for runs with both start and finish times", () => {
    setupRuns(MOCK_RUNS);
    renderTable();
    // Run #1001: 32 min 10 sec duration
    expect(screen.getByText("32m 10s")).toBeInTheDocument();
  });

  it("shows '—' for duration when finished_at is null (active run)", () => {
    setupRuns(MOCK_RUNS);
    renderTable();
    // Run #1002 has finished_at: null → duration should be "—"
    const dashes = screen.getAllByText("—");
    expect(dashes.length).toBeGreaterThanOrEqual(1);
  });

  it("finished status label uses the success (emerald) color, not the error color", () => {
    setupRuns([MOCK_RUNS[0]]);
    renderTable();
    const label = screen.getByText("Finished");
    expect(label.className).toContain("text-emerald-600");
    expect(label.className).not.toContain("text-rose-600");
  });

  it("error status label uses the error (rose) color", () => {
    setupRuns([MOCK_RUNS[1]]);
    renderTable();
    const label = screen.getByText("Error");
    expect(label.className).toContain("text-rose-600");
  });

  describe("Run name + tooltip", () => {
    it("renders the full run name (CSS-truncated) and a tooltip carrying the full name", () => {
      setupRuns([LONG_NAME_RUN]);
      renderTable();

      // The name is present in full in the DOM; visual truncation is CSS-only.
      const truncatedEl = screen
        .getAllByText(LONG_NAME)
        .find((el) => el.className.includes("truncate"));
      expect(truncatedEl).toBeTruthy();

      const tooltip = screen.getByTestId("tooltip-content");
      expect(tooltip).toHaveTextContent(LONG_NAME);
    });

    it("renders the run name for short names too", () => {
      setupRuns([MOCK_RUNS[0]]); // "Run #1001"
      renderTable();
      expect(screen.getAllByText("Run #1001").length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("row selection", () => {
    it("calls onRunSelect with run.id when a data row is clicked", () => {
      setupRuns(MOCK_RUNS);
      const onRunSelect = vi.fn();
      renderTable({ onRunSelect });
      const rows = screen.getAllByTestId("run-row");
      fireEvent.click(rows[0]);
      expect(onRunSelect).toHaveBeenCalledWith(MOCK_RUNS[0].id);
    });

    it("applies bg-muted class only to the selected row", () => {
      setupRuns(MOCK_RUNS);
      renderTable({ onRunSelect: vi.fn(), selectedRunId: MOCK_RUNS[0].id });
      const rows = screen.getAllByTestId("run-row");
      // Token match so the unselected row's `hover:bg-muted/60` doesn't count
      expect(rows[0].className.split(" ")).toContain("bg-muted");
      expect(rows[1].className.split(" ")).not.toContain("bg-muted");
    });
  });

  describe("three-dot kebab menu", () => {
    it("renders a three-dot menu trigger per run row", () => {
      setupRuns(MOCK_RUNS);
      renderTable();
      const triggers = screen.getAllByRole("button", { name: /run actions/i });
      expect(triggers).toHaveLength(MOCK_RUNS.length);
    });

    it("exposes run actions via a kebab menu (one per row), not a table column", () => {
      setupRuns(MOCK_RUNS);
      renderTable();
      // List layout has no tabular column headers
      expect(screen.queryByRole("columnheader")).not.toBeInTheDocument();
      // One kebab trigger per run
      expect(screen.getAllByRole("button", { name: /run actions/i })).toHaveLength(
        MOCK_RUNS.length,
      );
    });

    it("menu contains Open in Stak, Flag for eval, and Debug run items", () => {
      setupRuns([MOCK_RUNS[0]]);
      renderTable();
      expect(screen.getByText("Open in Stak")).toBeInTheDocument();
      expect(screen.getByText("Flag for eval")).toBeInTheDocument();
      expect(screen.getByText("Debug run")).toBeInTheDocument();
    });

    it("Open in Stak link has correct href and target", () => {
      setupRuns([MOCK_RUNS[0]]);
      renderTable();
      const link = screen.getByRole("link", { name: /open in stak/i });
      expect(link).toHaveAttribute(
        "href",
        `https://jobs.stakwork.com/admin/projects/${MOCK_RUNS[0].id}`,
      );
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", "noreferrer");
    });

    it("Open in Stak link has correct href for truncated-name run", () => {
      setupRuns([LONG_NAME_RUN]);
      renderTable();
      const link = screen.getByRole("link", { name: /open in stak/i });
      expect(link).toHaveAttribute(
        "href",
        `https://jobs.stakwork.com/admin/projects/${LONG_NAME_RUN.id}`,
      );
    });

    it("menu trigger click does not propagate to row (onRunSelect not called)", () => {
      setupRuns(MOCK_RUNS);
      const onRunSelect = vi.fn();
      renderTable({ onRunSelect });
      const trigger = screen.getAllByTestId("dropdown-trigger")[0];
      fireEvent.click(trigger);
      expect(onRunSelect).not.toHaveBeenCalled();
    });

    describe("Flag for eval", () => {
      it("clicking Flag for eval opens FlagRunEvalModal for that run", () => {
        setupRuns(MOCK_RUNS);
        renderTable();
        // Each run has a "Flag for eval" dropdown item
        const flagItems = screen.getAllByText("Flag for eval");
        fireEvent.click(flagItems[0]);
        expect(
          screen.getByTestId(`flag-modal-${MOCK_RUNS[0].id}`),
        ).toBeInTheDocument();
      });

      it("modal receives correct props (slug, workflowId, runId)", () => {
        setupRuns([MOCK_RUNS[0]]);
        renderTable();
        fireEvent.click(screen.getByText("Flag for eval"));
        expect(mockFlagRunEvalModal).toHaveBeenCalledWith(
          expect.objectContaining({
            slug: "test-ws",
            workflowId: "42",
            runId: String(MOCK_RUNS[0].id),
            open: true,
          }),
        );
      });

      it("after capture, menu item shows 'Eval captured' and is disabled", () => {
        setupRuns([MOCK_RUNS[0]]);
        renderTable();

        // open modal via menu item
        fireEvent.click(screen.getByText("Flag for eval"));
        // simulate capture
        fireEvent.click(screen.getByTestId(`flag-modal-capture-${MOCK_RUNS[0].id}`));

        // menu item should now show "Eval captured" and be disabled
        expect(screen.getByText("Eval captured")).toBeInTheDocument();
        expect(screen.queryByText("Flag for eval")).not.toBeInTheDocument();
      });

      it("calls onEvalCaptured prop when a capture is confirmed", () => {
        setupRuns([MOCK_RUNS[0]]);
        const onEvalCaptured = vi.fn();
        renderTable({ onEvalCaptured });

        fireEvent.click(screen.getByText("Flag for eval"));
        fireEvent.click(screen.getByTestId(`flag-modal-capture-${MOCK_RUNS[0].id}`));

        expect(onEvalCaptured).toHaveBeenCalledOnce();
      });

      it("modal closes without flagging when the close button is clicked", () => {
        setupRuns([MOCK_RUNS[0]]);
        const onEvalCaptured = vi.fn();
        renderTable({ onEvalCaptured });

        fireEvent.click(screen.getByText("Flag for eval"));
        expect(
          screen.getByTestId(`flag-modal-${MOCK_RUNS[0].id}`),
        ).toBeInTheDocument();

        fireEvent.click(screen.getByTestId(`flag-modal-close-${MOCK_RUNS[0].id}`));

        expect(
          screen.queryByTestId(`flag-modal-${MOCK_RUNS[0].id}`),
        ).not.toBeInTheDocument();
        expect(onEvalCaptured).not.toHaveBeenCalled();
        // "Flag for eval" item should be restored
        expect(screen.getByText("Flag for eval")).toBeInTheDocument();
      });
    });

    describe("Debug run", () => {
      let mockTab: { location: { href: string }; close: ReturnType<typeof vi.fn> };

      beforeEach(() => {
        mockTab = { location: { href: "" }, close: vi.fn() };
        vi.spyOn(window, "open").mockReturnValue(mockTab as unknown as Window);
      });

      it("opens a blank tab synchronously then sets location to new task URL", async () => {
        setupRuns([MOCK_RUNS[0]]);
        renderTable();

        await act(async () => {
          fireEvent.click(screen.getByText("Debug run"));
        });

        expect(window.open).toHaveBeenCalledWith("", "_blank");
        expect(mockStartDebugRun).toHaveBeenCalledWith({
          slug: "test-ws",
          workflowId: 42,
          runId: MOCK_RUNS[0].id,
        });
        expect(mockTab.location.href).toBe(`/w/test-ws/task/new-task-id`);
      });

      it("error path closes the blank tab and shows a toast", async () => {
        mockStartDebugRun.mockRejectedValue(new Error("server error"));
        setupRuns([MOCK_RUNS[0]]);
        renderTable();

        await act(async () => {
          fireEvent.click(screen.getByText("Debug run"));
        });

        expect(mockTab.close).toHaveBeenCalled();
        expect(mockToastError).toHaveBeenCalledWith("Failed to start debug session");
      });

      it("debug run click does not propagate to row (onRunSelect not called)", async () => {
        setupRuns([MOCK_RUNS[0]]);
        const onRunSelect = vi.fn();
        renderTable({ onRunSelect });

        await act(async () => {
          fireEvent.click(screen.getByText("Debug run"));
        });

        expect(onRunSelect).not.toHaveBeenCalled();
      });
    });
  });
});
