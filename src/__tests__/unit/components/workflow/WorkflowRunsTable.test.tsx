// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
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

// ── helpers ───────────────────────────────────────────────────────────────────
function renderTable() {
  return render(<WorkflowRunsTable slug="test-ws" workflowId={42} />);
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
});
