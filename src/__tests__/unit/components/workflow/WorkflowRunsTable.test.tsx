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

      const tooltips = screen.getAllByTestId("tooltip-content");
      expect(tooltips.some((t) => t.textContent === LONG_NAME)).toBe(true);
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

  describe("row action buttons", () => {
    it("renders Open in Stak, Flag for eval, and Debug run actions per row", () => {
      setupRuns(MOCK_RUNS);
      renderTable();
      expect(screen.getAllByRole("link", { name: /open in stak/i })).toHaveLength(MOCK_RUNS.length);
      expect(screen.getAllByRole("button", { name: /flag for eval/i })).toHaveLength(MOCK_RUNS.length);
      expect(screen.getAllByRole("button", { name: /debug run/i })).toHaveLength(MOCK_RUNS.length);
    });

    it("uses a list layout with no tabular column headers", () => {
      setupRuns(MOCK_RUNS);
      renderTable();
      expect(screen.queryByRole("columnheader")).not.toBeInTheDocument();
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

    it("clicking an action does not propagate to the row (onRunSelect not called)", () => {
      setupRuns(MOCK_RUNS);
      const onRunSelect = vi.fn();
      renderTable({ onRunSelect });
      const row = screen.getAllByTestId("run-row")[0];
      fireEvent.click(within(row).getByRole("button", { name: /flag for eval/i }));
      expect(onRunSelect).not.toHaveBeenCalled();
    });

    describe("Flag for eval", () => {
      it("clicking Flag for eval opens FlagRunEvalModal for that run", () => {
        setupRuns(MOCK_RUNS);
        renderTable();
        fireEvent.click(screen.getAllByRole("button", { name: /flag for eval/i })[0]);
        expect(
          screen.getByTestId(`flag-modal-${MOCK_RUNS[0].id}`),
        ).toBeInTheDocument();
      });

      it("modal receives correct props (slug, workflowId, runId)", () => {
        setupRuns([MOCK_RUNS[0]]);
        renderTable();
        fireEvent.click(screen.getByRole("button", { name: /flag for eval/i }));
        expect(mockFlagRunEvalModal).toHaveBeenCalledWith(
          expect.objectContaining({
            slug: "test-ws",
            workflowId: "42",
            runId: String(MOCK_RUNS[0].id),
            open: true,
          }),
        );
      });

      it("after capture, the action shows 'Eval captured' and is disabled", () => {
        setupRuns([MOCK_RUNS[0]]);
        renderTable();

        fireEvent.click(screen.getByRole("button", { name: /flag for eval/i }));
        fireEvent.click(screen.getByTestId(`flag-modal-capture-${MOCK_RUNS[0].id}`));

        const captured = screen.getByRole("button", { name: /eval captured/i });
        expect(captured).toBeInTheDocument();
        expect(captured).toBeDisabled();
        expect(screen.queryByRole("button", { name: /flag for eval/i })).not.toBeInTheDocument();
      });

      it("calls onEvalCaptured prop when a capture is confirmed", () => {
        setupRuns([MOCK_RUNS[0]]);
        const onEvalCaptured = vi.fn();
        renderTable({ onEvalCaptured });

        fireEvent.click(screen.getByRole("button", { name: /flag for eval/i }));
        fireEvent.click(screen.getByTestId(`flag-modal-capture-${MOCK_RUNS[0].id}`));

        expect(onEvalCaptured).toHaveBeenCalledOnce();
      });

      it("modal closes without flagging when the close button is clicked", () => {
        setupRuns([MOCK_RUNS[0]]);
        const onEvalCaptured = vi.fn();
        renderTable({ onEvalCaptured });

        fireEvent.click(screen.getByRole("button", { name: /flag for eval/i }));
        expect(
          screen.getByTestId(`flag-modal-${MOCK_RUNS[0].id}`),
        ).toBeInTheDocument();

        fireEvent.click(screen.getByTestId(`flag-modal-close-${MOCK_RUNS[0].id}`));

        expect(
          screen.queryByTestId(`flag-modal-${MOCK_RUNS[0].id}`),
        ).not.toBeInTheDocument();
        expect(onEvalCaptured).not.toHaveBeenCalled();
        // "Flag for eval" action should be restored
        expect(screen.getByRole("button", { name: /flag for eval/i })).toBeInTheDocument();
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
          fireEvent.click(screen.getByRole("button", { name: /debug run/i }));
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
          fireEvent.click(screen.getByRole("button", { name: /debug run/i }));
        });

        expect(mockTab.close).toHaveBeenCalled();
        expect(mockToastError).toHaveBeenCalledWith("Failed to start debug session");
      });

      it("debug run click does not propagate to row (onRunSelect not called)", async () => {
        setupRuns([MOCK_RUNS[0]]);
        const onRunSelect = vi.fn();
        renderTable({ onRunSelect });
        const row = screen.getAllByTestId("run-row")[0];

        await act(async () => {
          fireEvent.click(within(row).getByRole("button", { name: /debug run/i }));
        });

        expect(onRunSelect).not.toHaveBeenCalled();
      });
    });
  });

  describe("row keyboard handler — target guard", () => {
    it("Space on the row itself calls onRunSelect", () => {
      setupRuns([MOCK_RUNS[0]]);
      const onRunSelect = vi.fn();
      renderTable({ onRunSelect });
      const row = screen.getAllByTestId("run-row")[0];
      fireEvent.keyDown(row, { key: " ", target: row });
      expect(onRunSelect).toHaveBeenCalledWith(MOCK_RUNS[0].id);
    });

    it("Enter on the row itself calls onRunSelect", () => {
      setupRuns([MOCK_RUNS[0]]);
      const onRunSelect = vi.fn();
      renderTable({ onRunSelect });
      const row = screen.getAllByTestId("run-row")[0];
      fireEvent.keyDown(row, { key: "Enter", target: row });
      expect(onRunSelect).toHaveBeenCalledWith(MOCK_RUNS[0].id);
    });

    it("Space bubbling from a child element does NOT call onRunSelect (regression: modal inputs)", () => {
      setupRuns([MOCK_RUNS[0]]);
      const onRunSelect = vi.fn();
      renderTable({ onRunSelect });
      const row = screen.getAllByTestId("run-row")[0];

      // Simulate a child element (e.g. a modal input) dispatching Space —
      // fire on the child so target !== currentTarget when the event reaches the row.
      const childInput = document.createElement("input");
      row.appendChild(childInput);
      fireEvent.keyDown(childInput, { key: " " });

      expect(onRunSelect).not.toHaveBeenCalled();
      row.removeChild(childInput);
    });
  });
});
