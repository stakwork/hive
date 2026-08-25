/**
 * @vitest-environment jsdom
 *
 * Unit tests for ReportHeader breakdown wiring.
 *
 * Acceptance criteria:
 * - When rubricRows are present, rubricBreakdown computes and the strip renders.
 * - When score is null (empty rubricRows), fallback stats are used and NO strip renders.
 * - failCount is derived from breakdown.fail, not score.denominator - score.passed.
 * - {passCount} / {denominator} fraction is preserved unchanged.
 * - run-report-contested-annotation is preserved when annotation exists.
 */

import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ReportHeader } from "@/components/run-report/ReportHeader";
import type { RunReportProjection, RubricRow } from "@/lib/run-report/types";
import { buildChainModel } from "@/lib/run-report/chain";
import type { GraphRubric } from "@/lib/harvey-lab/rubric-scoring";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("@/hooks/useUserTimezone", () => ({
  useUserTimezone: () => ({ timezone: "UTC" }),
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  DialogContent: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

// ── Fixture helpers ───────────────────────────────────────────────────────────

function makeRubricRow(overrides: Partial<RubricRow> = {}): RubricRow {
  return {
    id: "R1",
    title: "A test criterion",
    verdict: "pass",
    passed: true,
    reasoning: "Looked good.",
    ...overrides,
  };
}

function makeProjection(rubricRows: RubricRow[] = []): RunReportProjection {
  return {
    generatedAtMs: null,
    pageData: {
      config: { task_slug: "test/task-01", task_goal: "Perform analysis." },
      score: {
        score: null,
        max_score: null,
        all_pass: null,
        n_criteria: null,
        n_passed: null,
        judge_model: null,
        scored_at: null,
      },
      rubrics: [],
      timeline: [],
      agents: [],
      documents: [],
      branches: [],
      healthNotes: [],
      wallClockMin: null,
      logStats: {},
      security: [],
      outputs: {},
    },
    stats: {
      passCount: 1,
      failCount: 2,
      rubricCount: 3,
    },
    rubricRows,
    sourceDocs: [],
    workfiles: [],
    rubricLinks: {},
    analysis: { summaries: [], traces: [] },
    concepts: {},
    toolActivity: {
      present: false,
      calls: [],
      totalCalls: 0,
      totalNodes: 0,
      capsApplied: false,
    },
    fixSnapshot: null,
    contractNotes: { unexpected: [] },
  };
}

function makeGraphRubric(id: string, name: string, contested = false): GraphRubric {
  return { ref_id: `req-${id}`, id, name, contested };
}

function renderHeader(
  rubricRows: RubricRow[] = [],
  graphRubrics: GraphRubric[] | null = null,
  statOverrides?: Partial<RunReportProjection["stats"]>,
) {
  const projection = makeProjection(rubricRows);
  if (statOverrides) {
    Object.assign(projection.stats, statOverrides);
  }
  const chain = buildChainModel(projection);
  return render(
    <ReportHeader
      projection={projection}
      chain={chain}
      taskTitle="Test Task"
      timezone="UTC"
      workspaceSlug={null}
      graphRubrics={graphRubrics}
      onOpenDoc={() => {}}
    />,
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("ReportHeader", () => {
  describe("breakdown path (rubricRows present)", () => {
    it("renders the rubric-breakdown-fail chip when rubric rows are present", () => {
      renderHeader([
        makeRubricRow({ verdict: "pass" }),
        makeRubricRow({ id: "R2", verdict: "fail", passed: false }),
      ]);
      expect(screen.getByTestId("rubric-breakdown-fail")).toBeDefined();
    });

    it("renders the rubric-breakdown-pass chip in full variant", () => {
      renderHeader([
        makeRubricRow({ verdict: "pass" }),
        makeRubricRow({ id: "R2", verdict: "fail", passed: false }),
      ]);
      expect(screen.getByTestId("rubric-breakdown-pass")).toBeDefined();
    });

    it("renders the rubric-breakdown-total chip in full variant", () => {
      renderHeader([
        makeRubricRow({ verdict: "pass" }),
        makeRubricRow({ id: "R2", verdict: "fail", passed: false }),
      ]);
      expect(screen.getByTestId("rubric-breakdown-total")).toBeDefined();
    });

    it("renders rubric-breakdown-disputed as — when no judge-dispute fields present", () => {
      renderHeader([
        makeRubricRow({ verdict: "pass" }),
        makeRubricRow({ id: "R2", verdict: "fail", passed: false }),
      ]);
      const disputedChip = screen.getByTestId("rubric-breakdown-disputed");
      expect(disputedChip.textContent).toContain("—");
    });

    it("renders rubric-breakdown-disputed with a count when judgeFlagged is set", () => {
      renderHeader([
        makeRubricRow({ verdict: "pass" }),
        makeRubricRow({
          id: "R2",
          verdict: "fail",
          passed: false,
          judgeFlagged: true,
          judgeFlagReason: "Criterion too vague.",
        }),
      ]);
      const disputedChip = screen.getByTestId("rubric-breakdown-disputed");
      // Disputed should be a non-null count (1 flagged criterion)
      expect(disputedChip.textContent).not.toContain("—");
      expect(disputedChip.textContent).toContain("1");
    });

    it("derives failCount from breakdown.fail, not score.denominator - score.passed", () => {
      // 1 pass + 1 contested + 2 fail = 4 total with graph roster
      const graphRubrics = [
        makeGraphRubric("R1", "Criterion 1"),
        makeGraphRubric("R2", "Criterion 2"),
        makeGraphRubric("R3", "Criterion 3", true), // contested
        makeGraphRubric("R4", "Criterion 4"),
      ];
      renderHeader(
        [
          makeRubricRow({ id: "R1", verdict: "pass" }),
          makeRubricRow({ id: "R2", verdict: "fail", passed: false }),
          makeRubricRow({ id: "R3", verdict: "fail", passed: false, criterionContested: true }),
          makeRubricRow({ id: "R4", verdict: "fail", passed: false }),
        ],
        graphRubrics,
      );
      // breakdown.fail = scorable(4-1=3) - pass(1) = 2
      const failBadge = screen.getByTestId("run-report-header").querySelector('[data-testid="rubric-breakdown-fail"]');
      expect(failBadge?.textContent).toContain("2");
    });

    it("preserves the passCount / denominator fraction display", () => {
      renderHeader([
        makeRubricRow({ verdict: "pass" }),
        makeRubricRow({ id: "R2", verdict: "fail", passed: false }),
        makeRubricRow({ id: "R3", verdict: "fail", passed: false }),
      ]);
      // Should show "1 / 3" (1 pass, 3 total scorable)
      const header = screen.getByTestId("run-report-header");
      expect(header.textContent).toMatch(/1\s*\/\s*3/);
    });

    it("preserves the run-report-contested-annotation when annotation exists", () => {
      // contested criteria produce an annotation
      const graphRubrics = [
        makeGraphRubric("R1", "Criterion 1"),
        makeGraphRubric("R2", "Criterion 2", true), // contested
      ];
      renderHeader(
        [
          makeRubricRow({ id: "R1", verdict: "pass" }),
          makeRubricRow({ id: "R2", verdict: "fail", passed: false, criterionContested: true }),
        ],
        graphRubrics,
      );
      // formatBenchmarkScore annotation says "+1 contested · 2 total"
      expect(screen.getByTestId("run-report-contested-annotation")).toBeDefined();
    });
  });

  describe("score=null fallback path (empty rubricRows)", () => {
    it("renders no rubric-breakdown-fail chip when rubricRows is empty", () => {
      const { queryByTestId } = renderHeader([], null, {
        passCount: 3,
        failCount: 2,
        rubricCount: 5,
      });
      expect(queryByTestId("rubric-breakdown-fail")).toBeNull();
    });

    it("renders no rubric-breakdown-total chip when rubricRows is empty", () => {
      const { queryByTestId } = renderHeader([], null);
      expect(queryByTestId("rubric-breakdown-total")).toBeNull();
    });

    it("does not throw or render NaN when stats are present", () => {
      expect(() =>
        renderHeader([], null, {
          passCount: 3,
          failCount: 2,
          rubricCount: 5,
        }),
      ).not.toThrow();
      const header = screen.getByTestId("run-report-header");
      expect(header.textContent).not.toContain("NaN");
    });
  });
});
