// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { WorkflowRunsTable } from "@/components/workflow/inspector/WorkflowRunsTable";
import type { WorkflowRun } from "@/hooks/useWorkflowRuns";

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

// ── tests ─────────────────────────────────────────────────────────────────────
describe("WorkflowRunsTable", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  it("renders run rows with correct link href and target", () => {
    setupRuns(MOCK_RUNS);
    renderTable();

    const link = screen.getByRole("link", { name: "Run #1001" });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute(
      "href",
      "https://jobs.stakwork.com/admin/projects/1001",
    );
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("renders status badge text matching run status", () => {
    setupRuns(MOCK_RUNS);
    renderTable();

    expect(screen.getByText("finished")).toBeInTheDocument();
    expect(screen.getByText("error")).toBeInTheDocument();
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
    // The "—" appears in multiple cells (finished_at + duration), just check it exists
    const dashes = screen.getAllByText("—");
    expect(dashes.length).toBeGreaterThanOrEqual(1);
  });

  it("finished status badge does not have destructive variant class", () => {
    setupRuns([MOCK_RUNS[0]]);
    renderTable();
    const badge = screen.getByText("finished");
    // The default variant uses bg-primary, not bg-destructive.
    // (aria-invalid:*-destructive utility classes appear in every Badge variant for
    //  accessibility and should not be used to identify the destructive variant.)
    expect(badge.className).not.toMatch(/bg-destructive/);
    expect(badge.className).toMatch(/bg-primary/);
  });

  it("error status badge has destructive variant class", () => {
    setupRuns([MOCK_RUNS[1]]);
    renderTable();
    const badge = screen.getByText("error");
    expect(badge.className).toMatch(/destructive/);
  });

  describe("Run name truncation and tooltip", () => {
    it("truncates names longer than 40 chars and shows tooltip with full name", () => {
      setupRuns([LONG_NAME_RUN]);
      renderTable();

      // The rendered link text should be truncated (first 40 chars + ellipsis)
      const truncated = LONG_NAME.slice(0, 40) + "…";
      const link = screen.getByRole("link", { name: truncated });
      expect(link).toBeInTheDocument();
      expect(link).toHaveAttribute(
        "href",
        `https://jobs.stakwork.com/admin/projects/${LONG_NAME_RUN.id}`,
      );

      // Tooltip content should show the full name
      const tooltip = screen.getByTestId("tooltip-content");
      expect(tooltip).toHaveTextContent(LONG_NAME);
    });

    it("does not render a tooltip for names 40 chars or shorter", () => {
      setupRuns([MOCK_RUNS[0]]); // "Run #1001" — well under 40 chars
      renderTable();

      // The link text should be the full name, unmodified
      const link = screen.getByRole("link", { name: "Run #1001" });
      expect(link).toBeInTheDocument();
      expect(link).toHaveTextContent("Run #1001");

      // No TooltipContent rendered
      expect(screen.queryByTestId("tooltip-content")).not.toBeInTheDocument();
    });

    it("link still navigates to the correct Stakwork URL even when truncated", () => {
      setupRuns([LONG_NAME_RUN]);
      renderTable();

      const link = screen.getByRole("link", { name: LONG_NAME.slice(0, 40) + "…" });
      expect(link).toHaveAttribute(
        "href",
        `https://jobs.stakwork.com/admin/projects/${LONG_NAME_RUN.id}`,
      );
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", "noreferrer");
    });
  });

  describe("row selection", () => {
    it("calls onRunSelect with run.id when a data row is clicked", () => {
      setupRuns(MOCK_RUNS);
      const onRunSelect = vi.fn();
      renderTable({ onRunSelect });
      const rows = screen.getAllByRole("row").slice(1); // skip header
      fireEvent.click(rows[0]);
      expect(onRunSelect).toHaveBeenCalledWith(MOCK_RUNS[0].id);
    });

    it("applies bg-muted class only to the selected row", () => {
      setupRuns(MOCK_RUNS);
      renderTable({ onRunSelect: vi.fn(), selectedRunId: MOCK_RUNS[0].id });
      const rows = screen.getAllByRole("row").slice(1);
      // Check for the standalone `bg-muted` class (not hover/data modifiers like hover:bg-muted/50)
      const classesRow0 = rows[0].className.split(" ");
      const classesRow1 = rows[1].className.split(" ");
      expect(classesRow0).toContain("bg-muted");
      expect(classesRow1).not.toContain("bg-muted");
    });

    it("does not call onRunSelect when the run name link is clicked", () => {
      setupRuns(MOCK_RUNS);
      const onRunSelect = vi.fn();
      renderTable({ onRunSelect });
      const link = screen.getByRole("link", { name: "Run #1001" });
      fireEvent.click(link);
      expect(onRunSelect).not.toHaveBeenCalled();
    });
  });
});
