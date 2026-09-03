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

  // ── 1. Contested criteria render no chip in rows — the report carries it ───

  it("renders no contested chip even when the rubric roster has contested entries", () => {
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

    // Rows carry no breakdown chips — contested detail lives in the report.
    expect(screen.queryByTestId("rubric-breakdown-contested")).toBeNull();
  });

  // ── 2. No score → dash only ────────────────────────────────────────────────

  it("renders no breakdown chips when the run has no score data", () => {
    // A completed run with no n_passed / n_total — computeBenchmarkScore returns null.
    const runWithNoScore = makeRun({ n_passed: undefined, n_total: undefined });

    // The task's roster has resolved, so the cell reaches the score branch.
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

    // ScoreCell renders a plain dash — no chips.
    expect(screen.queryByTestId("rubric-breakdown-disputed")).toBeNull();
  });

  // ── 3. Computable breakdown → still no chips in rows ───────────────────────

  it("renders no disputed tag or fail chip even when the breakdown is computable", () => {
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

    expect(screen.queryByTestId("rubric-breakdown-fail")).toBeNull();
    expect(screen.queryByTestId("rubric-breakdown-disputed")).toBeNull();
  });

  // ── 4. PASS badge only on an all-pass run ──────────────────────────────────

  it("renders the green PASS badge on an all-pass run", () => {
    const roster: GraphRubric[] = [
      { ref_id: "r1", id: "crit-1", name: "Criterion One", contested: false },
      { ref_id: "r2", id: "crit-2", name: "Criterion Two", contested: false },
      { ref_id: "r3", id: "crit-3", name: "Criterion Three", contested: false },
    ];

    mockUseWorkflowBenchmarkRunList.mockReturnValue({
      runs: [makeRun({ n_passed: 3, n_total: 3 })],
      isLoading: false,
      error: null,
      setExpandedId: mockSetExpandedId,
    });

    mockUseWorkflowBenchmarkRubricsMap.mockReturnValue(
      new Map([["task-slug-a", roster]])
    );

    render(<WorkflowBenchmarkRunsHistory />);

    expect(screen.getByText("PASS")).toBeInTheDocument();
  });

  it("renders no PASS or FAIL badge on a non-perfect run", () => {
    const roster: GraphRubric[] = [
      { ref_id: "r1", id: "crit-1", name: "Criterion One", contested: false },
      { ref_id: "r2", id: "crit-2", name: "Criterion Two", contested: false },
      { ref_id: "r3", id: "crit-3", name: "Criterion Three", contested: false },
    ];

    // 2 of 3 pass — not all-pass.
    mockUseWorkflowBenchmarkRunList.mockReturnValue({
      runs: [makeRun({ n_passed: 2, n_total: 3 })],
      isLoading: false,
      error: null,
      setExpandedId: mockSetExpandedId,
    });

    mockUseWorkflowBenchmarkRubricsMap.mockReturnValue(
      new Map([["task-slug-a", roster]])
    );

    render(<WorkflowBenchmarkRunsHistory />);

    expect(screen.queryByText("PASS")).toBeNull();
    expect(screen.queryByText("FAIL")).toBeNull();
  });
});
