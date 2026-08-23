/**
 * Unit tests for RecursionCard / RecursionBox (RecursionBox.tsx)
 *
 * Coverage:
 *   - useEvalRunHistory is NOT called while card is collapsed
 *   - canExpand is true when entry.fixChainDepth > 0, even before expansion
 *   - ScoreBadge renders summary score immediately on mount (no history loading)
 *   - useBenchmarkRubrics is NOT called until popover opened via onContestedClick
 *   - Popover shows skeleton when rosterRequested === true && rubrics === null
 *   - Expand toggle renders when entry.latestRun != null
 *   - After expansion, useEvalRunHistory is called with correct args
 */
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Hoisted mocks ──────────────────────────────────────────────────────────

const mockUseEvalRunHistory = vi.hoisted(() => vi.fn());
const mockUseBenchmarkRubrics = vi.hoisted(() => vi.fn());
const mockUseWorkspace = vi.hoisted(() => vi.fn());
const mockUseLegalBenchmarkRun = vi.hoisted(() => vi.fn());
const mockUseLegalBenchmarkRunList = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/useEvalRunHistory", () => ({
  useEvalRunHistory: mockUseEvalRunHistory,
}));

vi.mock("@/hooks/useBenchmarkRubrics", () => ({
  useBenchmarkRubrics: mockUseBenchmarkRubrics,
}));

vi.mock("@/hooks/useWorkspace", () => ({
  useWorkspace: mockUseWorkspace,
}));

vi.mock("@/hooks/useLegalBenchmarkRun", () => ({
  useLegalBenchmarkRun: mockUseLegalBenchmarkRun,
}));

vi.mock("@/hooks/useLegalBenchmarkRunList", () => ({
  useLegalBenchmarkRunList: mockUseLegalBenchmarkRunList,
}));

// Stub child components that would cause further imports
vi.mock("@/components/legal/RecursionActivityRail", () => ({
  RecursionActivityRail: () => <div data-testid="activity-rail" />,
  attemptReportHref: () => null,
}));

vi.mock("@/components/legal/HillClimbChart", () => ({
  HillClimbChart: () => <div data-testid="hill-climb-chart" />,
}));

vi.mock("@/components/legal/RecursionGraphPanel", () => ({
  RecursionGraphPanel: () => <div data-testid="recursion-graph-panel" />,
}));

vi.mock("@/components/run-report/NodePeek", () => ({
  graphExplorerHref: (slug: string, refId: string) => `/w/${slug}/context/graph?cypher=${refId}`,
}));

vi.mock("@/lib/run-report/types", () => ({
  canReadRunReport: () => true,
}));

vi.mock("@/lib/harvey-lab/rubric-scoring", () => ({
  rosterSummary: (rubrics: unknown[] | null) => {
    if (!rubrics || rubrics.length === 0) return null;
    const total = rubrics.length;
    const contested = (rubrics as Array<{ contested: boolean }>).filter((r) => r.contested).length;
    return { total, contested, denominator: total - contested };
  },
}));

import { RecursionList } from "@/components/legal/RecursionBox";
import type { RecursionEntry } from "@/hooks/useLegalBenchmarkRecursionList";

// ── Fixtures ───────────────────────────────────────────────────────────────

function makeEntry(overrides: Partial<RecursionEntry> = {}): RecursionEntry {
  return {
    refId: "evalset-ref-1",
    id: "task-slug-1",
    name: "Task 1",
    reason: "active",
    recursion: true,
    rubricCount: 10,
    contestedCount: 2,
    latestRun: null,
    fixChainDepth: 0,
    ...overrides,
  };
}

function setupHappyPathMocks() {
  mockUseWorkspace.mockReturnValue({
    workspace: { id: "workspace-1", slug: "openlaw" },
    role: "ADMIN",
  });

  // Default: no history (collapsed state)
  mockUseEvalRunHistory.mockReturnValue({
    attempts: [],
    attemptRows: [],
    partial: false,
    subgraphData: null,
    isLoading: false,
    error: null,
  });

  // Default: no rubrics loaded yet
  mockUseBenchmarkRubrics.mockReturnValue({ rubrics: null });

  // Default: no consolidated run
  mockUseLegalBenchmarkRun.mockReturnValue({ run: null });
  mockUseLegalBenchmarkRunList.mockReturnValue({ runs: [] });
}

beforeEach(() => {
  vi.clearAllMocks();
  setupHappyPathMocks();
});

function renderRecursionList(entries: RecursionEntry[]) {
  return render(
    <RecursionList
      entries={entries}
      isLoading={false}
      error={null}
      refetch={async () => {}}
    />,
  );
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("RecursionCard — useEvalRunHistory gating", () => {
  it("does NOT call useEvalRunHistory with real args while card is collapsed", () => {
    const entry = makeEntry({ fixChainDepth: 3, latestRun: null });
    renderRecursionList([entry]);

    // While collapsed, useEvalRunHistory should be called with empty slug / undefined refId
    // so the hook's existing guard makes it a no-op.
    const calls = mockUseEvalRunHistory.mock.calls;
    expect(calls.length).toBeGreaterThan(0);

    // Every call while collapsed should have slug="" and refId=undefined
    const collapsedCall = calls[calls.length - 1][0];
    expect(collapsedCall.slug).toBe("");
    expect(collapsedCall.refId).toBeUndefined();
  });

  it("calls useEvalRunHistory with real args after the user expands the card", async () => {
    const entry = makeEntry({
      fixChainDepth: 3,
      latestRun: { n_passed: 7, n_total: 10, runAt: "1700000000" },
    });
    renderRecursionList([entry]);

    // Expand the card
    const expandBtn = screen.getByTestId("expand-toggle");
    fireEvent.click(expandBtn);

    await waitFor(() => {
      const calls = mockUseEvalRunHistory.mock.calls;
      const afterExpandCall = calls[calls.length - 1][0];
      // After expansion, the real refId and slug should be passed
      expect(afterExpandCall.refId).toBe("evalset-ref-1");
      expect(afterExpandCall.slug).toBe("task-slug-1");
    });
  });
});

describe("RecursionCard — canExpand derivation", () => {
  it("expand toggle is visible when entry.fixChainDepth > 0, even before expansion", () => {
    const entry = makeEntry({ fixChainDepth: 3, latestRun: null });
    renderRecursionList([entry]);

    expect(screen.getByTestId("expand-toggle")).toBeTruthy();
  });

  it("expand toggle is visible when entry.latestRun is not null, even before expansion", () => {
    const entry = makeEntry({
      fixChainDepth: 0,
      latestRun: { n_passed: 7, n_total: 10, runAt: "1700000000" },
    });
    renderRecursionList([entry]);

    expect(screen.getByTestId("expand-toggle")).toBeTruthy();
  });

  it("expand toggle is NOT rendered when fixChainDepth=0 and latestRun=null", () => {
    const entry = makeEntry({ fixChainDepth: 0, latestRun: null });
    renderRecursionList([entry]);

    expect(screen.queryByTestId("expand-toggle")).toBeNull();
  });
});

describe("RecursionCard — ScoreBadge summary score on mount", () => {
  it("renders summary score immediately without waiting for useEvalRunHistory", () => {
    const entry = makeEntry({
      latestRun: { n_passed: 7, n_total: 10, runAt: "1700000000" },
      rubricCount: 10,
      contestedCount: 0,
    });
    renderRecursionList([entry]);

    // Score should be visible immediately (from summary data, no loading state)
    const scoreEl = screen.getByTestId("score-display");
    expect(scoreEl.textContent).toContain("7");
    expect(scoreEl.textContent).toContain("10");
  });

  it("renders no-runs when latestRun is null and history not loaded", () => {
    const entry = makeEntry({ latestRun: null, fixChainDepth: 0, rubricCount: 0 });
    renderRecursionList([entry]);

    expect(screen.getByTestId("score-no-runs")).toBeTruthy();
  });

  it("uses entry.rubricCount as n_total fallback when latestRun.n_total is null", () => {
    const entry = makeEntry({
      latestRun: { n_passed: 5, n_total: null, runAt: null },
      rubricCount: 12,
      contestedCount: 0,
    });
    renderRecursionList([entry]);

    // n_total should fall back to rubricCount (12)
    const scoreEl = screen.getByTestId("score-display");
    expect(scoreEl.textContent).toContain("5");
    expect(scoreEl.textContent).toContain("12");
  });
});

describe("RecursionCard — useBenchmarkRubrics gating", () => {
  it("does NOT call useBenchmarkRubrics with a real taskSlug on mount", () => {
    const entry = makeEntry({ rubricCount: 10, contestedCount: 2 });
    renderRecursionList([entry]);

    const calls = mockUseBenchmarkRubrics.mock.calls;
    // Should be called (hooks can't be conditionally called), but with undefined slug
    // so the hook's skip guard makes it a no-op
    for (const call of calls) {
      expect(call[0]).toBeUndefined();
    }
  });

  it("calls useBenchmarkRubrics with the real taskSlug after onContestedClick fires", async () => {
    const entry = makeEntry({
      rubricCount: 10,
      contestedCount: 2,
      latestRun: { n_passed: 7, n_total: 8, runAt: null },
    });
    renderRecursionList([entry]);

    // The contested annotation button should be visible (roster from summary data)
    const contestedBtn = screen.getByTestId("score-contested-annotation");
    expect(contestedBtn).toBeTruthy();

    // Click to open the popover and trigger rosterRequested
    fireEvent.click(contestedBtn);

    await waitFor(() => {
      const calls = mockUseBenchmarkRubrics.mock.calls;
      const lastCall = calls[calls.length - 1][0];
      expect(lastCall).toBe("task-slug-1");
    });
  });

  it("shows skeleton/spinner in popover when rosterRequested=true but rubrics=null", async () => {
    // rubrics stays null (still loading)
    mockUseBenchmarkRubrics.mockReturnValue({ rubrics: null });

    const entry = makeEntry({
      rubricCount: 10,
      contestedCount: 2,
      latestRun: { n_passed: 7, n_total: 8, runAt: null },
    });
    renderRecursionList([entry]);

    // Open the contested popover
    const contestedBtn = screen.getByTestId("score-contested-annotation");
    fireEvent.click(contestedBtn);

    await waitFor(() => {
      // Should show the loading skeleton, not an empty popover
      expect(screen.getByTestId("contested-rubric-skeleton")).toBeTruthy();
    });
  });

  it("shows rubric list after rubrics resolve", async () => {
    // Start with null, then resolve
    mockUseBenchmarkRubrics
      .mockReturnValueOnce({ rubrics: null })
      .mockReturnValue({
        rubrics: [
          { ref_id: "rub-1", id: "CRIT-1", name: "First criterion", contested: true },
          { ref_id: "rub-2", id: "CRIT-2", name: "Second criterion", contested: true },
        ],
      });

    const entry = makeEntry({
      rubricCount: 10,
      contestedCount: 2,
      latestRun: { n_passed: 7, n_total: 8, runAt: null },
    });
    renderRecursionList([entry]);

    const contestedBtn = screen.getByTestId("score-contested-annotation");
    fireEvent.click(contestedBtn);

    await waitFor(() => {
      // After rubrics resolve, the list should be shown (not skeleton)
      expect(screen.getByTestId("contested-rubric-list")).toBeTruthy();
    });
  });
});

describe("RecursionCard — contested annotation from summary", () => {
  it("renders +N contested badge immediately from entry.contestedCount without rubric fetch", () => {
    const entry = makeEntry({
      rubricCount: 10,
      contestedCount: 3,
      latestRun: { n_passed: 7, n_total: 7, runAt: null },
    });
    renderRecursionList([entry]);

    // Should show "+3 contested" immediately
    const annotationBtn = screen.getByTestId("score-contested-annotation");
    expect(annotationBtn.textContent).toContain("3");
    expect(annotationBtn.textContent).toContain("contested");

    // useBenchmarkRubrics should NOT have been called with a real slug yet
    for (const call of mockUseBenchmarkRubrics.mock.calls) {
      expect(call[0]).toBeUndefined();
    }
  });

  it("does NOT show contested annotation when contestedCount is 0", () => {
    const entry = makeEntry({
      rubricCount: 10,
      contestedCount: 0,
      latestRun: { n_passed: 10, n_total: 10, runAt: null },
    });
    renderRecursionList([entry]);

    expect(screen.queryByTestId("score-contested-annotation")).toBeNull();
  });
});

describe("RecursionList — loading and error states", () => {
  it("renders loading spinner when isLoading is true", () => {
    render(
      <RecursionList
        entries={[]}
        isLoading={true}
        error={null}
        refetch={async () => {}}
      />,
    );

    // Should show a spinner; check no card is rendered
    expect(screen.queryByTestId("recursion-toggle")).toBeNull();
  });

  it("renders error message when error is set", () => {
    render(
      <RecursionList
        entries={[]}
        isLoading={false}
        error="Failed to fetch"
        refetch={async () => {}}
      />,
    );

    expect(screen.getByText("Failed to fetch")).toBeTruthy();
  });

  it("renders empty state when entries array is empty", () => {
    render(
      <RecursionList
        entries={[]}
        isLoading={false}
        error={null}
        refetch={async () => {}}
      />,
    );

    expect(screen.getByText("No tasks enrolled in recursion.")).toBeTruthy();
  });

  it("renders one card per entry", () => {
    const entries = [
      makeEntry({ refId: "ref-1", id: "task-1", name: "Task 1" }),
      makeEntry({ refId: "ref-2", id: "task-2", name: "Task 2" }),
    ];
    renderRecursionList(entries);

    const toggles = screen.getAllByTestId("recursion-toggle");
    expect(toggles).toHaveLength(2);
  });
});
