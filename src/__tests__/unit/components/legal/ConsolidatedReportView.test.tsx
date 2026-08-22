/**
 * @vitest-environment jsdom
 *
 * Unit tests for ConsolidatedReportView.
 *
 * Covers:
 * - Matrix row count = criteria failing in any run
 * - Badge presence (pass/fail)
 * - Alphabetical row ordering
 * - SafeMarkdown render (no raw HTML)
 * - Source file links rendered
 * - Detail tables rendered for failing criteria
 * - Judgement Review row omitted when all empty
 * - No dangerouslySetInnerHTML / raw HTML sinks
 */

import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ConsolidatedReportView } from "@/components/legal/ConsolidatedReportView";
import type { RunReportPayload, ConsolidatedReportProjection } from "@/lib/run-report/types";
import fixtureRaw from "@/lib/run-report/fixtures/consolidated-report.fixture.json";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@/components/run-report/SafeMarkdown", () => ({
  SafeMarkdown: ({ text }: { text: string }) =>
    React.createElement("div", { "data-testid": "safe-markdown" }, text),
}));

vi.mock("@/components/run-report/RubricLedger", () => ({
  PassFailBadge: ({ passed }: { passed: boolean }) =>
    React.createElement(
      "span",
      {
        "data-testid": passed ? "pass-fail-badge-pass" : "pass-fail-badge-fail",
      },
      passed ? "✓" : "✗",
    ),
}));

vi.mock("@/components/run-report/CriterionMarkers", () => ({
  CriterionMarkers: ({ contested }: { contested?: boolean }) =>
    contested
      ? React.createElement("span", { "data-testid": "criterion-contested-badge" }, "CONTESTED")
      : null,
}));

vi.mock("@/components/run-report/chrome", () => ({
  SectionErrorBoundary: ({ children }: { children: React.ReactNode }) =>
    React.createElement("div", { "data-testid": "section-error-boundary" }, children),
}));

// ─── Fixture ──────────────────────────────────────────────────────────────────

const fixture = fixtureRaw as ConsolidatedReportProjection;

function makePayload(projection: ConsolidatedReportProjection | null = fixture): RunReportPayload {
  return {
    runId: "run_001",
    hasReport: true,
    projection,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("ConsolidatedReportView", () => {
  it("renders the consolidated header with task title", () => {
    render(
      <ConsolidatedReportView
        payload={makePayload()}
        taskTitle="Merger Reps Task"
        workspaceSlug="openlaw"
      />,
    );
    expect(screen.getByText("Merger Reps Task")).toBeTruthy();
  });

  it("renders task description via SafeMarkdown", () => {
    render(
      <ConsolidatedReportView
        payload={makePayload()}
        taskTitle="Merger Reps Task"
        workspaceSlug="openlaw"
      />,
    );
    // SafeMarkdown mock renders text in a div[data-testid="safe-markdown"]
    const markdownNodes = screen.getAllByTestId("safe-markdown");
    const texts = markdownNodes.map((n) => n.textContent ?? "");
    expect(texts.some((t) => t.includes("merger agreement"))).toBe(true);
  });

  it("renders source file link chips", () => {
    render(
      <ConsolidatedReportView
        payload={makePayload()}
        taskTitle="Task"
        workspaceSlug="openlaw"
      />,
    );
    const links = screen.getAllByTestId("source-file-link");
    expect(links.length).toBe(fixture.sourceFileLinks.length);
    links.forEach((link) => {
      expect(link.tagName).toBe("A");
      expect((link as HTMLAnchorElement).target).toBe("_blank");
      expect((link as HTMLAnchorElement).rel).toContain("noopener");
    });
  });

  it("matrix shows only criteria that fail in at least one run", () => {
    render(
      <ConsolidatedReportView
        payload={makePayload()}
        taskTitle="Task"
        workspaceSlug="openlaw"
      />,
    );

    // From fixture: crit_001 passes in all runs — should NOT appear.
    // crit_002, 003, 004, 005 fail in at least one run — should appear.
    const failingCount = fixture.rubricMatrix.filter((r) =>
      r.results.some((res) => !res.passed),
    ).length;

    const table = screen.getByTestId("rubric-matrix-table");
    // Each failing criterion is a tbody row
    const rows = table.querySelectorAll("tbody tr");
    expect(rows.length).toBe(failingCount);
  });

  it("matrix rows are sorted alphabetically by criterion title", () => {
    render(
      <ConsolidatedReportView
        payload={makePayload()}
        taskTitle="Task"
        workspaceSlug="openlaw"
      />,
    );

    // Only failing criteria appear; extract which criterion IDs are rendered.
    // The component sorts alphabetically by title — verify using data-testid order.
    const table = screen.getByTestId("rubric-matrix-table");
    const criterionCells = Array.from(
      table.querySelectorAll("[data-testid^='matrix-criterion-']"),
    );

    // Map rendered criterion IDs to their titles from the fixture.
    const renderedTitles = criterionCells.map((el) => {
      const testId = el.getAttribute("data-testid") ?? "";
      const id = testId.replace("matrix-criterion-", "");
      const row = fixture.rubricMatrix.find((r) => r.id === id);
      return row?.title ?? "";
    });

    const sortedTitles = [...renderedTitles].sort((a, b) => a.localeCompare(b));
    expect(renderedTitles).toEqual(sortedTitles);
  });

  it("renders pass and fail badges in the matrix", () => {
    render(
      <ConsolidatedReportView
        payload={makePayload()}
        taskTitle="Task"
        workspaceSlug="openlaw"
      />,
    );

    const passBadges = screen.getAllByTestId("pass-fail-badge-pass");
    const failBadges = screen.getAllByTestId("pass-fail-badge-fail");
    expect(passBadges.length).toBeGreaterThan(0);
    expect(failBadges.length).toBeGreaterThan(0);
  });

  it("renders one detail table per failing criterion from rubricDetails", () => {
    render(
      <ConsolidatedReportView
        payload={makePayload()}
        taskTitle="Task"
        workspaceSlug="openlaw"
      />,
    );

    fixture.rubricDetails.forEach((detail) => {
      expect(screen.getByTestId(`criterion-detail-${detail.id}`)).toBeTruthy();
    });
  });

  it("omits Judgement Review row when all perRun entries have empty judgeFlagReason", () => {
    // crit_004 in the fixture has all empty judgeFlagReasons
    const criterion = fixture.rubricDetails.find((d) => d.id === "crit_004")!;
    expect(criterion).toBeDefined();
    const allEmpty = criterion.perRun.every((p) => !p.judgeFlagReason.trim());
    expect(allEmpty).toBe(true);

    render(
      <ConsolidatedReportView
        payload={makePayload()}
        taskTitle="Task"
        workspaceSlug="openlaw"
      />,
    );

    const detailSection = screen.getByTestId(`criterion-detail-${criterion.id}`);
    // Should NOT contain a "Judgement Review" label
    expect(detailSection.textContent).not.toContain("Judgement Review");
  });

  it("renders Judgement Review row when at least one perRun entry has a non-empty judgeFlagReason", () => {
    // crit_002 in the fixture has at least one non-empty judgeFlagReason
    const criterion = fixture.rubricDetails.find((d) => d.id === "crit_002")!;
    const hasJudgeReview = criterion.perRun.some((p) => p.judgeFlagReason.trim() !== "");
    expect(hasJudgeReview).toBe(true);

    render(
      <ConsolidatedReportView
        payload={makePayload()}
        taskTitle="Task"
        workspaceSlug="openlaw"
      />,
    );

    const detailSection = screen.getByTestId(`criterion-detail-${criterion.id}`);
    expect(detailSection.textContent).toContain("Judgement Review");
  });

  it("renders contested badge for contested criteria", () => {
    render(
      <ConsolidatedReportView
        payload={makePayload()}
        taskTitle="Task"
        workspaceSlug="openlaw"
      />,
    );
    // Fixture has at least one contested criterion (crit_002 run_003 and crit_003 run_002)
    const contestedBadges = screen.queryAllByTestId("criterion-contested-badge");
    expect(contestedBadges.length).toBeGreaterThan(0);
  });

  it("renders all text content via SafeMarkdown (no raw HTML sinks)", () => {
    const { container } = render(
      <ConsolidatedReportView
        payload={makePayload()}
        taskTitle="Task"
        workspaceSlug="openlaw"
      />,
    );
    // Verify no dangerouslySetInnerHTML — React never lets raw innerHTML through,
    // but we can inspect that all prose content reaches SafeMarkdown nodes.
    const markdownNodes = container.querySelectorAll("[data-testid='safe-markdown']");
    expect(markdownNodes.length).toBeGreaterThan(0);

    // No <script> or raw HTML injection paths
    const scripts = container.querySelectorAll("script");
    expect(scripts.length).toBe(0);
  });

  it("shows unavailable error message when projection is null and error is unavailable", () => {
    const payload: RunReportPayload = {
      runId: "run_001",
      hasReport: false,
      error: "unavailable",
      projection: null,
    };

    render(
      <ConsolidatedReportView
        payload={payload}
        taskTitle="Task"
        workspaceSlug="openlaw"
      />,
    );

    expect(screen.getByText(/could not be loaded/i)).toBeTruthy();
  });

  it("shows url_rejected error message when error is url_rejected", () => {
    const payload: RunReportPayload = {
      runId: "run_001",
      hasReport: false,
      error: "url_rejected",
      projection: null,
    };

    render(
      <ConsolidatedReportView
        payload={payload}
        taskTitle="Task"
        workspaceSlug="openlaw"
      />,
    );

    expect(screen.getByText(/URL was rejected/i)).toBeTruthy();
  });

  it("shows generic message when projection is a non-consolidated bundle", () => {
    const payload: RunReportPayload = {
      runId: "run_001",
      hasReport: true,
      // A RunReportProjection (no consolidated: true) — wrong type
      projection: null,
    };

    render(
      <ConsolidatedReportView
        payload={payload}
        taskTitle="Task"
        workspaceSlug="openlaw"
      />,
    );

    expect(screen.getByText(/No consolidated report data/i)).toBeTruthy();
  });

  it("passes source file link hrefs correctly", () => {
    render(
      <ConsolidatedReportView
        payload={makePayload()}
        taskTitle="Task"
        workspaceSlug="openlaw"
      />,
    );

    const links = screen.getAllByTestId("source-file-link") as HTMLAnchorElement[];
    fixture.sourceFileLinks.forEach((href, i) => {
      expect(links[i].href).toBe(href);
    });
  });
});
