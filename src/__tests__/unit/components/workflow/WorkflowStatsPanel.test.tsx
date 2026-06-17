// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { WorkflowStatsPanel } from "@/components/workflow/inspector/WorkflowStatsPanel";
import type { WorkflowStats } from "@/hooks/useWorkflowRunStats";

// ── mock useWorkflowRunStats ──────────────────────────────────────────────────
const mockUseWorkflowRunStats = vi.fn();

vi.mock("@/hooks/useWorkflowRunStats", () => ({
  useWorkflowRunStats: (...args: unknown[]) => mockUseWorkflowRunStats(...args),
}));

// ── mock shadcn Skeleton ──────────────────────────────────────────────────────
vi.mock("@/components/ui/skeleton", () => ({
  Skeleton: ({ className }: { className?: string }) => (
    <div data-testid="skeleton" className={className} />
  ),
}));

// ── helpers ───────────────────────────────────────────────────────────────────
function renderPanel() {
  return render(<WorkflowStatsPanel slug="test-ws" workflowId={42} />);
}

function setupStats(stats: WorkflowStats | null, isLoading = false) {
  mockUseWorkflowRunStats.mockReturnValue({ stats, isLoading, error: null });
}

// ── tests ─────────────────────────────────────────────────────────────────────
describe("WorkflowStatsPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows skeletons while loading", () => {
    setupStats(null, true);
    renderPanel();
    expect(screen.getAllByTestId("skeleton").length).toBeGreaterThanOrEqual(3);
  });

  it("shows unavailable message when stats is null", () => {
    setupStats(null);
    renderPanel();
    expect(
      screen.getByText(/run statistics unavailable/i),
    ).toBeInTheDocument();
  });

  it("shows unavailable message when available is false", () => {
    setupStats({ available: false });
    renderPanel();
    expect(
      screen.getByText(/run statistics unavailable/i),
    ).toBeInTheDocument();
  });

  describe("empty-state guard (total_runs === 0 && active_runs === 0)", () => {
    it("renders empty-state when total_runs=0 and active_runs=0", () => {
      setupStats({ available: true, total_runs: 0, active_runs: 0 });
      renderPanel();
      expect(
        screen.getByText(/no runs recorded yet/i),
      ).toBeInTheDocument();
    });

    it("renders empty-state when total_runs=0 and active_runs is undefined", () => {
      setupStats({ available: true, total_runs: 0 });
      renderPanel();
      expect(
        screen.getByText(/no runs recorded yet/i),
      ).toBeInTheDocument();
    });

    it("renders stats grid when total_runs=0 but active_runs=1", () => {
      setupStats({ available: true, total_runs: 0, active_runs: 1, error_rate: 0 });
      renderPanel();
      expect(screen.queryByText(/no runs recorded yet/i)).not.toBeInTheDocument();
      expect(screen.getByText(/total runs/i)).toBeInTheDocument();
    });

    it("renders stats grid when total_runs=5 and active_runs=0", () => {
      setupStats({ available: true, total_runs: 5, active_runs: 0, error_rate: 0.05 });
      renderPanel();
      expect(screen.queryByText(/no runs recorded yet/i)).not.toBeInTheDocument();
      expect(screen.getByText(/total runs/i)).toBeInTheDocument();
    });

    it("renders stats grid when total_runs=5 and active_runs is undefined", () => {
      setupStats({ available: true, total_runs: 5, error_rate: 0 });
      renderPanel();
      expect(screen.queryByText(/no runs recorded yet/i)).not.toBeInTheDocument();
      expect(screen.getByText(/total runs/i)).toBeInTheDocument();
    });
  });

  describe("stats grid content", () => {
    it("renders Last Run, Total Runs and Error Rate tiles", () => {
      setupStats({
        available: true,
        total_runs: 10,
        active_runs: 2,
        last_run_at: "2024-06-01T12:00:00.000Z",
        error_rate: 0.05,
      });
      renderPanel();
      expect(screen.getByText(/last run/i)).toBeInTheDocument();
      expect(screen.getByText(/total runs/i)).toBeInTheDocument();
      expect(screen.getByText(/error rate/i)).toBeInTheDocument();
    });

    it("shows — for missing last_run_at", () => {
      setupStats({ available: true, total_runs: 3, error_rate: 0 });
      renderPanel();
      expect(screen.getByText("—")).toBeInTheDocument();
    });

    it("highlights error rate in red when > 10%", () => {
      setupStats({ available: true, total_runs: 3, error_rate: 0.15 });
      renderPanel();
      const errorEl = screen.getByText("15.0%");
      expect(errorEl.className).toContain("text-rose-600");
    });

    it("does not highlight error rate as an error when <= 10%", () => {
      setupStats({ available: true, total_runs: 3, error_rate: 0.05 });
      renderPanel();
      const errorEl = screen.getByText("5.0%");
      expect(errorEl.className).not.toContain("text-rose-600");
    });
  });
});
