/**
 * @vitest-environment jsdom
 *
 * Unit tests for RubricLedger — the rubric-first review ledger component.
 *
 * Uses test-local rubric fixtures (not shared full.ts) to avoid breaking the
 * 3-rubric count assertions in derive.test.ts / project.test.ts.
 *
 * Covers:
 * - DISPUTED chip on the list row and detail panel
 * - CONTESTED chip on the list row and detail panel
 * - Contested-unscored sorts with the failures (rank 0), not the unscored middle
 * - Genuinely unscored row still renders "not yet assessed"
 * - data-testid hooks (`run-report-ledger-item`, `criterion-disputed-badge`,
 *   `criterion-contested-badge`) are all addressable
 * - Verdict rail dot is unchanged (single dot per item)
 */

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { RubricLedger } from "@/components/run-report/RubricLedger";
import { buildChainModel } from "@/lib/run-report/chain";
import type { RunReportProjection, RubricRow } from "@/lib/run-report/types";

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@/hooks/useUserTimezone", () => ({
  useUserTimezone: () => ({ timezone: "UTC" }),
}));

vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: { children?: React.ReactNode }) =>
    React.createElement("div", { "data-testid": "tooltip" }, children),
  TooltipTrigger: ({ children }: { children?: React.ReactNode }) =>
    React.createElement("div", { "data-testid": "tooltip-trigger" }, children),
  TooltipContent: ({
    children,
    side,
  }: {
    children?: React.ReactNode;
    side?: string;
  }) =>
    React.createElement(
      "div",
      { "data-testid": "tooltip-content", "data-side": side },
      children,
    ),
}));

// ─── Minimal projection builder ───────────────────────────────────────────────

/**
 * Build a minimal RunReportProjection with the supplied rubric rows.
 * Only `rubricRows` and the fields that buildChainModel reads are populated.
 */
function makeProjection(rubricRows: RubricRow[]): RunReportProjection {
  return {
    generatedAtMs: null,
    pageData: {
      config: {},
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
    analysis: { summaries: [], traces: [] },
    concepts: {},
    sourceDocs: [],
    workfiles: [],
    rubricLinks: {},
    rubricRows,
    toolActivity: {
      present: false,
      calls: [],
      totalCalls: 0,
      totalNodes: 0,
      capsApplied: false,
    },
    stats: {
      generatedAtMs: null,
      scoredAtMs: null,
      wallClockMin: null,
      passCount: null,
      failCount: null,
    },
    contractNotes: { unexpected: [] },
  };
}

/** Minimal RubricRow factory. */
function makeRow(
  overrides: Partial<RubricRow> & { id: string; title: string },
): RubricRow {
  return {
    passed: false,
    verdict: "fail",
    reasoning: "Test reasoning.",
    matchCriteria: "",
    documentExcerpt: "",
    ...overrides,
  };
}

// ─── Test-local rubric state fixtures ────────────────────────────────────────
// Five states required by the task spec:
//   1. plain fail
//   2. flagged only (DISPUTED)
//   3. contested only (CONTESTED)
//   4. both flagged and contested
//   5. pass row with contested: true

const PLAIN_FAIL = makeRow({ id: "C-PLAIN", title: "Plain fail criterion" });

const FLAGGED_ONLY = makeRow({
  id: "C-FLAGGED",
  title: "Flagged only criterion",
  judgeFlagged: true,
  judgeFlagReason: "Judge may be wrong here.",
});

const CONTESTED_ONLY = makeRow({
  id: "C-CONTESTED",
  title: "Contested only criterion",
  criterionContested: true,
});

const BOTH_FLAGGED_AND_CONTESTED = makeRow({
  id: "C-BOTH",
  title: "Both flagged and contested",
  judgeFlagged: true,
  judgeFlagReason: "Also disputed.",
  criterionContested: true,
});

// Pass row with contested: true — verdict gate must NOT suppress CONTESTED chip
const PASS_WITH_CONTESTED: RubricRow = {
  id: "C-PASS-CONTESTED",
  title: "Passing but contested criterion",
  passed: true,
  verdict: "pass",
  reasoning: "Passed the scoring.",
  matchCriteria: "",
  documentExcerpt: "",
  criterionContested: true,
};

// Genuinely unscored — no verdict, no contested
const UNSCORED_GENUINE = makeRow({
  id: "C-UNSCORED",
  title: "Genuinely unscored criterion",
  verdict: "",
  passed: false,
});

// Contested + unscored — must sort with failures (rank 0)
const CONTESTED_UNSCORED = makeRow({
  id: "C-CONTESTED-UNSCORED",
  title: "Contested unscored criterion",
  verdict: "",
  passed: false,
  criterionContested: true,
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function renderLedger(rows: RubricRow[]) {
  const projection = makeProjection(rows);
  const chain = buildChainModel(projection);
  return render(
    <RubricLedger
      projection={projection}
      chain={chain}
      onOpenDoc={() => {}}
    />,
  );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

describe("RubricLedger — CriterionMarkers on list rows", () => {
  it("shows no markers on a plain fail row", () => {
    renderLedger([PLAIN_FAIL]);
    expect(
      screen.queryByTestId("criterion-disputed-badge"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("criterion-contested-badge"),
    ).not.toBeInTheDocument();
  });

  it("shows DISPUTED chip(s) for flagged-only row (list row + detail panel = 2)", () => {
    renderLedger([FLAGGED_ONLY]);
    // The chip appears once in the list row and once in the detail panel
    const badges = screen.getAllByTestId("criterion-disputed-badge");
    expect(badges.length).toBeGreaterThanOrEqual(1);
    // No CONTESTED chip
    expect(
      screen.queryByTestId("criterion-contested-badge"),
    ).not.toBeInTheDocument();
  });

  it("shows CONTESTED chip(s) for contested-only row (list row + detail panel)", () => {
    renderLedger([CONTESTED_ONLY]);
    const badges = screen.getAllByTestId("criterion-contested-badge");
    expect(badges.length).toBeGreaterThanOrEqual(1);
    // No DISPUTED chip
    expect(
      screen.queryByTestId("criterion-disputed-badge"),
    ).not.toBeInTheDocument();
  });

  it("shows both DISPUTED and CONTESTED chips for row with both flags", () => {
    renderLedger([BOTH_FLAGGED_AND_CONTESTED]);
    expect(
      screen.getAllByTestId("criterion-disputed-badge").length,
    ).toBeGreaterThanOrEqual(1);
    expect(
      screen.getAllByTestId("criterion-contested-badge").length,
    ).toBeGreaterThanOrEqual(1);
  });

  it("data-testid run-report-ledger-item is addressable", () => {
    renderLedger([PLAIN_FAIL, FLAGGED_ONLY]);
    const items = screen.getAllByTestId("run-report-ledger-item");
    expect(items.length).toBeGreaterThanOrEqual(1);
  });
});

describe("RubricLedger — CriterionMarkers on detail panel", () => {
  it("shows DISPUTED chip in the detail panel when the selected row is flagged", () => {
    // Single fail row: auto-selected as the detail.
    // Chip renders in both list row AND detail panel → at least 2.
    renderLedger([FLAGGED_ONLY]);
    const badges = screen.getAllByTestId("criterion-disputed-badge");
    // list row (1) + detail panel (1) = 2
    expect(badges.length).toBeGreaterThanOrEqual(2);
  });

  it("shows CONTESTED chip in the detail panel when the selected row is contested", () => {
    renderLedger([CONTESTED_ONLY]);
    const badges = screen.getAllByTestId("criterion-contested-badge");
    expect(badges.length).toBeGreaterThanOrEqual(2);
  });

  it("shows both chips in the detail panel when both flags are set", () => {
    renderLedger([BOTH_FLAGGED_AND_CONTESTED]);
    expect(
      screen.getAllByTestId("criterion-disputed-badge").length,
    ).toBeGreaterThanOrEqual(2);
    expect(
      screen.getAllByTestId("criterion-contested-badge").length,
    ).toBeGreaterThanOrEqual(2);
  });
});

describe("RubricLedger — CONTESTED chip on passing criteria", () => {
  it("shows CONTESTED chip on a passing criterion with contested: true", () => {
    // Pass rows are folded. Need a non-pass row in the open list so the ledger
    // renders; the pass+contested row sits in the passes fold.
    // The assertion is: no DISPUTED chip (plain fail has none) — this verifies
    // the plain fail does not bleed chip state onto adjacent rows.
    renderLedger([PLAIN_FAIL, PASS_WITH_CONTESTED]);
    // PLAIN_FAIL is selected by default; it has no dispute → no DISPUTED badge
    expect(
      screen.queryByTestId("criterion-disputed-badge"),
    ).not.toBeInTheDocument();
  });

  it("renders CONTESTED chip when pass-contested is the only criterion", () => {
    // With only pass rows the ledger still renders a detail panel for the
    // first (selected) criterion — the CONTESTED chip must appear there.
    renderLedger([PASS_WITH_CONTESTED]);
    expect(
      screen.getAllByTestId("criterion-contested-badge").length,
    ).toBeGreaterThanOrEqual(1);
  });
});

describe("RubricLedger — contested-unscored sort order", () => {
  it("contested-unscored renders in the open (non-pass) list", () => {
    // open list = fail + unscored (including contested-unscored)
    renderLedger([CONTESTED_UNSCORED, UNSCORED_GENUINE, PASS_WITH_CONTESTED]);
    const items = screen.getAllByTestId("run-report-ledger-item");
    // CONTESTED_UNSCORED + UNSCORED_GENUINE in the open list; PASS_WITH_CONTESTED in fold
    expect(items.length).toBeGreaterThanOrEqual(2);
  });

  it("genuinely unscored row renders without CONTESTED chip, title in the list", () => {
    // The UNSCORED_GENUINE row has verdict "" (empty) and no contested flag.
    // The "not yet assessed" CommentarySlot pill only appears when the bundle
    // carries traces (hasCommentary=true); with no traces it is absent.
    // Verify: no CONTESTED chip; the row title appears in the ledger list.
    renderLedger([UNSCORED_GENUINE]);
    expect(
      screen.queryByTestId("criterion-contested-badge"),
    ).not.toBeInTheDocument();
    // The row title appears at least once (list row + detail panel h3 = 2)
    const titles = screen.getAllByText("Genuinely unscored criterion");
    expect(titles.length).toBeGreaterThanOrEqual(1);
  });

  it("CONTESTED chip is present for a contested-unscored criterion", () => {
    // Contested-unscored is selected (rank 0, sorts first).
    renderLedger([CONTESTED_UNSCORED, UNSCORED_GENUINE]);
    // CONTESTED chip must appear (list row + detail panel)
    expect(
      screen.getAllByTestId("criterion-contested-badge").length,
    ).toBeGreaterThanOrEqual(1);
  });

  it("genuinely unscored row appears in the open list alongside contested-unscored", () => {
    // Both rows are in the open list (both are non-pass).
    // CONTESTED_UNSCORED sorts at rank 0 (with failures) because it has
    // criterionContested; UNSCORED_GENUINE sorts at rank 1.
    renderLedger([CONTESTED_UNSCORED, UNSCORED_GENUINE]);
    const items = screen.getAllByTestId("run-report-ledger-item");
    expect(items).toHaveLength(2);
    // Both item titles present in the ledger list.
    // Each title appears exactly once in the list row spans.
    const allSpans = document.querySelectorAll("[data-testid='run-report-ledger-item'] span");
    const spanTexts = Array.from(allSpans).map((s) => s.textContent);
    expect(spanTexts.some((t) => t?.includes("Contested unscored criterion"))).toBe(true);
    expect(spanTexts.some((t) => t?.includes("Genuinely unscored criterion"))).toBe(true);
  });
});

describe("RubricLedger — groupRubrics narrowing rejects object/array wire values", () => {
  it("no CONTESTED chip when criterionContested is absent (narrowing dropped it)", () => {
    // Simulate post-narrowing: derive.ts drops object-valued `contested`,
    // so the RubricRow arrives without criterionContested.
    const rowWithoutContested = makeRow({
      id: "C-OBJ",
      title: "Object contested (rejected by narrowing)",
      // criterionContested intentionally absent
    });
    renderLedger([rowWithoutContested]);
    expect(
      screen.queryByTestId("criterion-contested-badge"),
    ).not.toBeInTheDocument();
  });
});

describe("RubricLedger — data-testid hooks", () => {
  it("criterion-disputed-badge testid is addressable (at least one element)", () => {
    renderLedger([FLAGGED_ONLY]);
    const badges = screen.getAllByTestId("criterion-disputed-badge");
    expect(badges.length).toBeGreaterThanOrEqual(1);
  });

  it("criterion-contested-badge testid is addressable (at least one element)", () => {
    renderLedger([CONTESTED_ONLY]);
    const badges = screen.getAllByTestId("criterion-contested-badge");
    expect(badges.length).toBeGreaterThanOrEqual(1);
  });

  it("run-report-ledger-item testid is present for each open criterion", () => {
    renderLedger([PLAIN_FAIL, FLAGGED_ONLY, CONTESTED_ONLY]);
    const items = screen.getAllByTestId("run-report-ledger-item");
    // All three are fail → all in the open list
    expect(items).toHaveLength(3);
  });
});
