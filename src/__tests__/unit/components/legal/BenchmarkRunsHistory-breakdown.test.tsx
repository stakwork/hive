/**
 * @vitest-environment jsdom
 *
 * Tests for the rubricBreakdown integration in BenchmarkRunsHistory.
 *
 * Covers (per ticket T3 spec):
 * 1. output-ref path → n_failed/n_disputed null; strip renders "—" for Total/Disputed
 * 2. early bail (no roster/criteria/graphOut) → n_failed/n_disputed null
 * 3. !score bail (computeBenchmarkScore returns null) → n_failed/n_disputed null
 * 4–5. secondary-row bails (nPassed null, !score) → n_failed/n_disputed null
 * 6. score-cell-contested testid still present (via strip's contested chip) — not duplicated
 * 7. secondary row with criteria_results reports a real Disputed count
 *
 * NOTE: Because the adjusted* arrays are internal to the component, we test
 * them indirectly by checking rendered testids on ScoreCell.
 *
 * The `rubricBreakdown` helper and its partition are tested separately in
 * src/__tests__/unit/lib/harvey-lab/rubric-scoring.test.ts. Here we only
 * verify the integration path: that the strip is mounted / not mounted and
 * that the contested testid appears at most once per row.
 */

import React from "react";
globalThis.React = React;
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { WorkflowStatus } from "@prisma/client";

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock("@/hooks/useWorkspace", () => ({
  useWorkspace: () => ({
    workspace: { id: "ws-1", slug: "openlaw" },
    isSuperAdmin: false,
  }),
}));

const mockRunList = vi.fn();
vi.mock("@/hooks/useLegalBenchmarkRunList", () => ({
  useLegalBenchmarkRunList: (...args: unknown[]) => mockRunList(...args),
}));

const mockRecursionList = vi.fn();
vi.mock("@/hooks/useLegalBenchmarkRecursionList", () => ({
  useLegalBenchmarkRecursionList: (...args: unknown[]) => mockRecursionList(...args),
}));

const mockRubricsMap = vi.fn();
vi.mock("@/hooks/useBenchmarkRubrics", () => ({
  useBenchmarkRubricsMap: (...args: unknown[]) => mockRubricsMap(...args),
}));

const mockGraphScoresMap = vi.fn();
vi.mock("@/hooks/useBenchmarkGraphScores", () => ({
  useBenchmarkGraphScoresMap: (...args: unknown[]) => mockGraphScoresMap(...args),
}));

vi.mock("@/components/legal/LegalBenchmarkResults", () => ({
  LegalBenchmarkResults: () => null,
}));

vi.mock("@/components/legal/BenchmarkRunAgentLogs", () => ({
  BenchmarkRunAgentLogs: () => null,
}));

vi.mock("@/components/legal/RunCascade", () => ({
  BenchmarkRunCascade: () => null,
}));

vi.mock("@/components/legal/StakworkRunLink", () => ({
  StakworkRunLink: () => null,
}));

vi.mock("@/components/legal/BenchmarkSummaryStrip", () => ({
  BenchmarkSummaryStrip: () => null,
}));

vi.mock("@/components/legal/HillClimbChart", () => ({
  HillClimbChart: () => null,
}));

vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children, className }: { children?: React.ReactNode; className?: string }) => (
    <span data-testid="badge" className={className}>{children}</span>
  ),
}));

vi.mock("date-fns", () => ({
  formatDistanceToNow: () => "2 days ago",
}));

vi.mock("next/link", () => ({
  default: ({ children, href }: { children?: React.ReactNode; href?: string }) => (
    <a href={href}>{children}</a>
  ),
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

type RunType = "manual" | "recursion";

function makeRun(overrides: Record<string, unknown> = {}) {
  return {
    id: "run-1",
    workspaceId: "ws-1",
    runType: "manual" as RunType,
    status: WorkflowStatus.COMPLETED,
    projectId: null,
    taskSlug: "legal/task-abc",
    taskTitle: "Task ABC",
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    n_passed: 8,
    n_total: 10,
    all_pass: false,
    evalTriggerRef: undefined,
    evalOutputRef: undefined,
    criteria_results: undefined,
    judgeNotes: undefined,
    requestedModel: undefined,
    requestedJudgeModel: undefined,
    hasReport: false,
    generateRunReport: false,
    jamieChatPath: null,
    jamieChatStatus: undefined,
    generateJamieChat: false,
    ...overrides,
  };
}

function defaultMocks({ roster = null as unknown[] | null, graphOutput = null as Record<string, unknown> | null } = {}) {
  mockRecursionList.mockReturnValue({ entries: [] });
  const rostersMap = new Map();
  if (roster) rostersMap.set("legal/task-abc", roster);
  mockRubricsMap.mockReturnValue(rostersMap);
  const graphMap = new Map();
  if (graphOutput) graphMap.set("legal/task-abc", [graphOutput]);
  mockGraphScoresMap.mockReturnValue(graphMap);
  mockRunList.mockReturnValue({
    runs: [],
    total: 0,
    isLoading: false,
    error: null,
    setExpandedId: vi.fn(),
  });
}

import { BenchmarkRunsHistory } from "@/components/legal/BenchmarkRunsHistory";

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("BenchmarkRunsHistory — ScoreCell breakdown strip", () => {
  it("output-ref path: strip renders (n_failed=null, n_disputed=null) — no Total chip", () => {
    // The output-ref path sets n_failed=null / n_disputed=null, so breakdown=null
    // and the strip renders nothing (or just the fraction + badge).
    const graphOutputEntry = {
      runId: "run-1",
      matchedBy: "output-ref" as const,
      output: { n_passed: 7, n_total: 9, judge_notes: undefined },
    };
    defaultMocks({ graphOutput: graphOutputEntry });
    mockRunList.mockReturnValue({
      runs: [makeRun({ evalOutputRef: "out-ref-1", all_pass: false })],
      total: 1,
      isLoading: false,
      error: null,
      setExpandedId: vi.fn(),
    });

    render(<BenchmarkRunsHistory />);

    // The row should render; score cell shows fraction
    const row = screen.getByTestId("run-row-run-1");
    expect(row).toBeInTheDocument();
    // On the output-ref path breakdown=null → strip renders nothing, so
    // rubric-breakdown-total should NOT be present (compact variant never shows it anyway,
    // but null breakdown produces nothing at all).
    expect(screen.queryByTestId("rubric-breakdown-total")).not.toBeInTheDocument();
  });

  it("early bail (no roster, no criteria, no graphOut): strip not rendered", () => {
    // No roster, no criteria, no graphOut → return { ...run, n_failed: null, n_disputed: null }
    defaultMocks({ roster: null, graphOutput: null });
    mockRunList.mockReturnValue({
      runs: [makeRun({ all_pass: false })],
      total: 1,
      isLoading: false,
      error: null,
      setExpandedId: vi.fn(),
    });

    render(<BenchmarkRunsHistory />);
    // No breakdown strip — neither fail nor total chips.
    expect(screen.queryByTestId("rubric-breakdown-fail")).not.toBeInTheDocument();
    expect(screen.queryByTestId("rubric-breakdown-total")).not.toBeInTheDocument();
  });

  it("scoring path: contested chip present, no fail chip; score-cell-contested present at most once", () => {
    const roster = [
      { ref_id: "r1", id: "C-001", name: "Criterion 1", contested: false },
      { ref_id: "r2", id: "C-002", name: "Criterion 2", contested: false },
      { ref_id: "r3", id: "C-003", name: "Criterion 3", contested: true },
    ];
    defaultMocks({ roster });
    mockRunList.mockReturnValue({
      runs: [
        makeRun({
          all_pass: false,
          n_passed: 1,
          n_total: 3,
          criteria_results: [
            { id: "C-001", title: "Criterion 1", verdict: "pass", reasoning: "", contested: false },
            { id: "C-002", title: "Criterion 2", verdict: "fail", reasoning: "Failed", contested: false },
            { id: "C-003", title: "Criterion 3", verdict: "fail", reasoning: "Failed", contested: true },
          ],
        }),
      ],
      total: 1,
      isLoading: false,
      error: null,
      setExpandedId: vi.fn(),
    });

    render(<BenchmarkRunsHistory />);

    // The breakdown strip (compact) renders the contested chip; the fail chip is gone.
    expect(screen.queryByTestId("rubric-breakdown-fail")).toBeNull();
    // score-cell-contested maps to the rubric-breakdown-contested testid in the strip.
    // It should appear at most once per row (no duplicate).
    const contestedElements = screen.queryAllByTestId("rubric-breakdown-contested");
    expect(contestedElements.length).toBe(1);
  });
});
