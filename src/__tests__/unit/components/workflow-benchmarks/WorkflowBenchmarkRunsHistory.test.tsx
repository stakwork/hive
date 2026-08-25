/**
 * @vitest-environment jsdom
 */
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

globalThis.React = React;
import { WorkflowBenchmarkRunsHistory } from "@/components/workflow-benchmarks/WorkflowBenchmarkRunsHistory";
import { WorkflowStatus } from "@prisma/client";

// ─── Static date mock ─────────────────────────────────────────────────────────

vi.mock("date-fns", () => ({
  formatDistanceToNow: () => "2 days ago",
}));

// ─── StakworkRunLink is not under test ────────────────────────────────────────

vi.mock("@/components/legal/StakworkRunLink", () => ({
  StakworkRunLink: () => null,
}));

// ─── Hook mocks — defined as vi.fn() so tests can call mockReturnValue ────────

const mockSetExpandedId = vi.fn();

const mockUseWorkflowBenchmarkRunList = vi.fn(() => ({
  runs: [] as ReturnType<typeof mockUseWorkflowBenchmarkRunList>["runs"],
  isLoading: false,
  error: null,
  setExpandedId: mockSetExpandedId,
}));

const mockUseWorkflowBenchmarkRubricsMap = vi.fn(() => new Map());

vi.mock("@/hooks/useWorkspace", () => ({
  useWorkspace: () => ({
    workspace: { id: "ws-1", slug: "test-ws" },
    isSuperAdmin: false,
  }),
}));

vi.mock("@/hooks/useWorkflowBenchmarkRunList", () => ({
  get useWorkflowBenchmarkRunList() {
    return mockUseWorkflowBenchmarkRunList;
  },
}));

vi.mock("@/hooks/useBenchmarkRubrics", () => ({
  get useWorkflowBenchmarkRubricsMap() {
    return mockUseWorkflowBenchmarkRubricsMap;
  },
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

type RunRow = {
  id: string;
  workspaceId: string;
  taskSlug: string;
  taskTitle: string;
  status: WorkflowStatus;
  createdAt: Date;
  updatedAt: Date;
  runType: "manual";
  projectId: null;
  n_passed?: number;
  n_total?: number;
  criteria_results?: undefined;
  judgeNotes?: undefined;
  requestedModel?: undefined;
};

/** Minimal completed run with a passing n_passed/n_total score. */
function makeRun(overrides: Partial<RunRow> = {}): RunRow {
  return {
    id: "run-1",
    workspaceId: "ws-1",
    taskSlug: "task-slug-a",
    taskTitle: "Task A",
    status: WorkflowStatus.COMPLETED,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    runType: "manual",
    projectId: null,
    n_passed: 8,
    n_total: 10,
    criteria_results: undefined,
    judgeNotes: undefined,
    requestedModel: undefined,
    ...overrides,
  };
}

type GraphRubric = { ref_id: string; id: string; name: string; contested: boolean };

// ─── Test suite ───────────────────────────────────────────────────────────────

describe("WorkflowBenchmarkRunsHistory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset to default idle state before each test.
    mockUseWorkflowBenchmarkRunList.mockReturnValue({
      runs: [],
      isLoading: false,
      error: null,
      setExpandedId: mockSetExpandedId,
    });
    mockUseWorkflowBenchmarkRubricsMap.mockReturnValue(new Map());
  });

  // ── 1. Contested criteria render rubric-breakdown-contested ────────────────

  it("renders rubric-breakdown-contested when the rubric roster has contested entries", () => {
    const contestedRoster: GraphRubric[] = [
      { ref_id: "r1", id: "crit-1", name: "Criterion One", contested: true },
      { ref_id: "r2", id: "crit-2", name: "Criterion Two", contested: true },
      { ref_id: "r3", id: "crit-3", name: "Criterion Three", contested: false },
    ];

    mockUseWorkflowBenchmarkRunList.mockReturnValue({
      runs: [makeRun()],
      isLoading: false,
      error: null,
      setExpandedId: mockSetExpandedId,
    });

    mockUseWorkflowBenchmarkRubricsMap.mockReturnValue(
      new Map([["task-slug-a", contestedRoster]])
    );

    render(<WorkflowBenchmarkRunsHistory />);

    // RubricBreakdownStrip (compact) must render the contested chip because
    // contested > 0 — this replaces the old ad-hoc annotation span.
    expect(screen.queryByTestId("rubric-breakdown-contested")).not.toBeNull();
  });

  // ── 2. No score → strip not rendered ──────────────────────────────────────

  it("does not render rubric-breakdown-fail when the run has no score data", () => {
    // A completed run with no n_passed / n_total — computeBenchmarkScore returns null.
    const runWithNoScore = makeRun({ n_passed: undefined, n_total: undefined });

    // Roster IS present so rubricsLoading stays false and we reach the score branch.
    const roster: GraphRubric[] = [
      { ref_id: "r1", id: "crit-1", name: "Criterion One", contested: false },
    ];

    mockUseWorkflowBenchmarkRunList.mockReturnValue({
      runs: [runWithNoScore],
      isLoading: false,
      error: null,
      setExpandedId: mockSetExpandedId,
    });

    mockUseWorkflowBenchmarkRubricsMap.mockReturnValue(
      new Map([["task-slug-a", roster]])
    );

    render(<WorkflowBenchmarkRunsHistory />);

    // Strip must be absent — ScoreCell renders a plain dash instead.
    expect(screen.queryByTestId("rubric-breakdown-fail")).toBeNull();
  });

  // ── 3. Computable breakdown → fail + disputed chips are present ────────────

  it("renders rubric-breakdown-fail and rubric-breakdown-disputed when the breakdown is computable", () => {
    const roster: GraphRubric[] = [
      { ref_id: "r1", id: "crit-1", name: "Criterion One", contested: false },
      { ref_id: "r2", id: "crit-2", name: "Criterion Two", contested: false },
      { ref_id: "r3", id: "crit-3", name: "Criterion Three", contested: false },
    ];

    // 8 of 10 pass → score is computable, strip is rendered.
    mockUseWorkflowBenchmarkRunList.mockReturnValue({
      runs: [makeRun()],
      isLoading: false,
      error: null,
      setExpandedId: mockSetExpandedId,
    });

    mockUseWorkflowBenchmarkRubricsMap.mockReturnValue(
      new Map([["task-slug-a", roster]])
    );

    render(<WorkflowBenchmarkRunsHistory />);

    expect(screen.queryByTestId("rubric-breakdown-fail")).not.toBeNull();
    expect(screen.queryByTestId("rubric-breakdown-disputed")).not.toBeNull();
  });
});
