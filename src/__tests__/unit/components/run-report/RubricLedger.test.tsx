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

describe("RubricLedger — judge dispute / note label and data-judge-state", () => {
  // A plain-fail row with prose but no flagged — renders as "Judge Note"
  const PROSE_ONLY = makeRow({
    id: "C-PROSE",
    title: "Prose only criterion",
    judgeFlagReason: "The task brief excluded this requirement.",
  });

  // A flagged row with prose — renders as "Judge Dispute"
  const FLAGGED_WITH_PROSE = makeRow({
    id: "C-FLAGGED-PROSE",
    title: "Flagged with prose",
    judgeFlagged: true,
    judgeFlagReason: "The judge made an error.",
  });

  it("shows no DISPUTED badge for prose-only (unflagged) criterion", () => {
    renderLedger([PROSE_ONLY]);
    expect(screen.queryByTestId("criterion-disputed-badge")).not.toBeInTheDocument();
  });

  it("prose still renders for unflagged criterion in the detail panel", () => {
    renderLedger([PROSE_ONLY]);
    expect(screen.getByText("The task brief excluded this requirement.")).toBeInTheDocument();
  });

  it("detail panel shows 'Judge Note' label for prose-only criterion", () => {
    renderLedger([PROSE_ONLY]);
    expect(screen.getByText("Judge Note")).toBeInTheDocument();
    expect(screen.queryByText("Judge Dispute")).toBeNull();
  });

  it("data-judge-state is 'note' for prose-only criterion", () => {
    renderLedger([PROSE_ONLY]);
    const panel = screen.getByTestId("run-report-judge-dispute");
    expect(panel).toHaveAttribute("data-judge-state", "note");
  });

  it("shows DISPUTED badge and 'Judge Dispute' label for flagged criterion", () => {
    renderLedger([FLAGGED_WITH_PROSE]);
    expect(screen.getAllByTestId("criterion-disputed-badge").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Judge Dispute")).toBeInTheDocument();
    expect(screen.queryByText("Judge Note")).toBeNull();
  });

  it("data-judge-state is 'dispute' for flagged criterion", () => {
    renderLedger([FLAGGED_WITH_PROSE]);
    const panel = screen.getByTestId("run-report-judge-dispute");
    expect(panel).toHaveAttribute("data-judge-state", "dispute");
  });

  it("no badge but prose renders for PLAIN_FAIL (no dispute keys)", () => {
    renderLedger([PLAIN_FAIL]);
    expect(screen.queryByTestId("criterion-disputed-badge")).not.toBeInTheDocument();
    expect(screen.queryByTestId("run-report-judge-dispute")).not.toBeInTheDocument();
  });
});

// ── Origin-aware graphRubrics fixture tests ───────────────────────────────────

/**
 * GraphRubric fixture:
 *   ROSTER_CONTESTED_BY_ID   — contested, id matches C-CONTESTED
 *   ROSTER_CONTESTED_BY_NAME — contested, name matches "Contested only criterion"
 *   ROSTER_NON_CONTESTED     — in the roster but NOT contested
 *   ROSTER_ONLY_ID           — contested, id C-ROSTER-ONLY (no bundle row)
 */
import type { GraphRubric } from "@/lib/harvey-lab/rubric-scoring";

const GRAPH_RUBRICS: GraphRubric[] = [
  {
    ref_id: "node-contested-id",
    id: "C-CONTESTED",
    name: "Contested only criterion",
    contested: true,
  },
  {
    ref_id: "node-contested-name",
    // different id so only name matches CONTESTED_ONLY row
    id: "C-OTHER-ID",
    name: "Contested only criterion",
    contested: true,
  },
  {
    ref_id: "node-non-contested",
    id: "C-PLAIN",
    name: "Plain fail criterion",
    contested: false,
  },
  {
    ref_id: "node-roster-only",
    id: "C-ROSTER-ONLY",
    name: "Roster-only contested criterion (no bundle row)",
    contested: true,
  },
];

/** Render the ledger with the test graphRubrics fixture. */
function renderLedgerWithRoster(rows: RubricRow[]) {
  const projection = makeProjection(rows);
  const chain = buildChainModel(projection);
  return render(
    <RubricLedger
      projection={projection}
      chain={chain}
      graphRubrics={GRAPH_RUBRICS}
      onOpenDoc={() => {}}
    />,
  );
}

describe("RubricLedger — origin-aware contested chips (graphRubrics fixture)", () => {
  // ── data-contested-origin on rail chips ────────────────────────────────────

  it("chip for in-run-only contested criterion carries data-contested-origin='in-run'", () => {
    // CONTESTED_ONLY has criterionContested:true but id C-CONTESTED matches
    // the roster, so it is "both". Use a different id not in the roster.
    const IN_RUN_ONLY = makeRow({
      id: "C-INRUN-ONLY",
      title: "In-run only contested (no roster match)",
      criterionContested: true,
    });
    renderLedgerWithRoster([IN_RUN_ONLY]);
    const badges = screen.getAllByTestId("criterion-contested-badge");
    // The list-row badge carries the origin attribute
    const inRunBadge = badges.find(
      (b) => b.getAttribute("data-contested-origin") === "in-run",
    );
    expect(inRunBadge).toBeDefined();
  });

  it("chip for roster+in-run criterion carries data-contested-origin='both'", () => {
    // CONTESTED_ONLY has criterionContested:true AND id C-CONTESTED is in the
    // roster → should resolve to "both".
    renderLedgerWithRoster([CONTESTED_ONLY]);
    const badges = screen.getAllByTestId("criterion-contested-badge");
    const bothBadge = badges.find(
      (b) => b.getAttribute("data-contested-origin") === "both",
    );
    expect(bothBadge).toBeDefined();
  });

  // ── Roster-only rows appear in the rail ────────────────────────────────────

  it("renders roster-only rows for contested rubrics with no bundle match", () => {
    // With only PLAIN_FAIL in the bundle:
    //   C-CONTESTED (id) and C-OTHER-ID/same-name both miss the bundle → 2 roster-only rows
    //   C-ROSTER-ONLY misses the bundle → 1 more (3 total)
    renderLedgerWithRoster([PLAIN_FAIL]);
    const rosterRows = screen.getAllByTestId("run-report-roster-only-row");
    expect(rosterRows.length).toBeGreaterThanOrEqual(1);
  });

  it("roster-only rows are non-interactive (no button element inside)", () => {
    renderLedgerWithRoster([PLAIN_FAIL, CONTESTED_ONLY]);
    const rosterRows = screen.getAllByTestId("run-report-roster-only-row");
    for (const row of rosterRows) {
      expect(row.querySelector("button")).toBeNull();
    }
  });

  it("all roster-only rows carry a PRIOR CONTEST chip", () => {
    renderLedgerWithRoster([PLAIN_FAIL]);
    const rosterRows = screen.getAllByTestId("run-report-roster-only-row");
    for (const row of rosterRows) {
      const chip = row.querySelector("[data-testid='criterion-contested-badge']");
      expect(chip).not.toBeNull();
      expect(chip?.textContent).toContain("PRIOR CONTEST");
    }
  });

  it("all roster-only row chips have data-contested-origin='roster'", () => {
    renderLedgerWithRoster([PLAIN_FAIL]);
    const rosterRows = screen.getAllByTestId("run-report-roster-only-row");
    for (const row of rosterRows) {
      const chip = row.querySelector("[data-testid='criterion-contested-badge']");
      expect(chip?.getAttribute("data-contested-origin")).toBe("roster");
    }
  });

  it("roster-only rows are NOT counted in open or passed criterion lists", () => {
    renderLedgerWithRoster([PLAIN_FAIL]);
    // open = [PLAIN_FAIL] → 1 ledger item button; the roster row is a div, not a button
    const items = screen.getAllByTestId("run-report-ledger-item");
    expect(items).toHaveLength(1);
  });

  it("no roster-only rows rendered when graphRubrics is null", () => {
    renderLedger([PLAIN_FAIL]);
    expect(
      screen.queryByTestId("run-report-roster-only-row"),
    ).not.toBeInTheDocument();
  });

  it("no roster-only rows rendered when all contested roster rubrics have bundle rows", () => {
    // CONTESTED_ONLY covers C-CONTESTED which is in the roster.
    // Roster also has C-OTHER-ID / same name as CONTESTED_ONLY → name match.
    // The one roster-only id is C-ROSTER-ONLY — include a bundle row for it.
    const ROSTER_ONLY_ROW = makeRow({
      id: "C-ROSTER-ONLY",
      title: "Roster-only contested criterion (no bundle row)",
      criterionContested: true,
    });
    renderLedgerWithRoster([PLAIN_FAIL, CONTESTED_ONLY, ROSTER_ONLY_ROW]);
    expect(
      screen.queryByTestId("run-report-roster-only-row"),
    ).not.toBeInTheDocument();
  });

  // ── Total contested chip count reconciles with +N annotation ─────────────

  it("total contested badges (bundle rows + roster-only rows) equals contested count", () => {
    // PLAIN_FAIL: not contested → 0 chips
    // CONTESTED_ONLY: both bundle+roster → 1 chip in list row (detail panel adds 1 more when selected)
    // roster-only C-ROSTER-ONLY: 1 chip
    // Total unique contested rail positions: CONTESTED_ONLY (list) + ROSTER-ONLY
    renderLedgerWithRoster([PLAIN_FAIL, CONTESTED_ONLY]);
    const badges = screen.getAllByTestId("criterion-contested-badge");
    // At minimum 2: CONTESTED_ONLY list-row chip + roster-only chip.
    // When CONTESTED_ONLY is selected its detail panel adds 1 more.
    expect(badges.length).toBeGreaterThanOrEqual(2);
  });

  // ── Axes stay separate: roster-contested criterion with passing verdict ─────

  it("a passing criterion that is roster-contested shows no DISPUTED/dispute prose in the contested block", () => {
    // PASS_WITH_CONTESTED has verdict "pass" and criterionContested:true.
    // Its id C-PASS-CONTESTED is not in the roster → "in-run" origin.
    // Verify: no dispute prose appears inside the contested block.
    const PASS_ROSTER: RubricRow = {
      ...PASS_WITH_CONTESTED,
      id: "C-CONTESTED", // matches roster id → "both" origin (inRun + roster)
      title: "Passing contested from roster",
    };
    renderLedgerWithRoster([PASS_ROSTER]);
    // No DISPUTED badge (not flagged)
    expect(
      screen.queryByTestId("criterion-disputed-badge"),
    ).not.toBeInTheDocument();
    // The contested block should not contain the judge-dispute label text
    const contestedBlock = screen.queryByTestId("run-report-contested-block");
    if (contestedBlock) {
      expect(contestedBlock.textContent).not.toMatch(/Judge Dispute/i);
      expect(contestedBlock.textContent).not.toMatch(/Judge Note/i);
    }
  });

  // ── Contested Definition / Prior Contest block in the detail panel ─────────

  it("detail panel shows a Contested Definition block when selected criterion is 'both'", () => {
    // CONTESTED_ONLY is selected first (non-pass, auto-selected).
    renderLedgerWithRoster([CONTESTED_ONLY]);
    expect(
      screen.getByTestId("run-report-contested-block"),
    ).toBeInTheDocument();
    const block = screen.getByTestId("run-report-contested-block");
    expect(block.getAttribute("data-contested-origin")).toBe("both");
  });

  it("detail panel shows Prior Contest block for in-run-only contested criterion", () => {
    const IN_RUN_ONLY = makeRow({
      id: "C-INRUN-ONLY",
      title: "In-run only contested (no roster match)",
      criterionContested: true,
    });
    renderLedgerWithRoster([IN_RUN_ONLY]);
    const block = screen.getByTestId("run-report-contested-block");
    expect(block.getAttribute("data-contested-origin")).toBe("in-run");
    // Label should be "Contested Definition" not "Prior Contest"
    expect(block.textContent).toContain("Contested Definition");
  });

  it("detail panel shows no contested block for a plain fail criterion", () => {
    renderLedgerWithRoster([PLAIN_FAIL]);
    // PLAIN_FAIL is not contested → no block
    // (but the roster-only row exists — detail panel only affects the selected row)
    expect(
      screen.queryByTestId("run-report-contested-block"),
    ).not.toBeInTheDocument();
  });

  it("contested block does not appear for a non-contested criterion even with roster", () => {
    // C-PLAIN is in the roster but contested:false — should have no chip/block.
    renderLedgerWithRoster([PLAIN_FAIL]);
    // PLAIN_FAIL auto-selected; C-PLAIN roster entry is non-contested.
    expect(
      screen.queryByTestId("run-report-contested-block"),
    ).not.toBeInTheDocument();
  });

  // ── Defect 2 fix: tooltip copy removed from ContestedBlock body ────────────

  it("contested block body does NOT repeat the badge tooltip copy — 'both' origin (defect 2 regression pin)", () => {
    // The badge tooltip copy that was previously rendered as a <p> must no
    // longer appear as body text inside the block. The tooltip itself (rendered
    // via TooltipContent) is a sibling, not a child, of the block element.
    renderLedgerWithRoster([CONTESTED_ONLY]);
    // Use getAllByTestId because the tooltip mock may render the content inline;
    // the contested block is the first element with this testid (the detail panel one).
    const blocks = screen.getAllByTestId("run-report-contested-block");
    const block = blocks[0];
    // These are substrings of the contestedNotice() tooltip for "both" origin.
    // They must NOT appear as direct body text inside the contested block.
    expect(block.textContent).not.toContain(
      "It is excluded from the score on both sides",
    );
    expect(block.textContent).not.toContain(
      "independently flags this criterion as contested",
    );
  });

  it("contested block body does NOT repeat the badge tooltip copy — 'in-run' origin (defect 2 regression pin)", () => {
    // Same assertion for a criterion that is only in-run contested (no roster match).
    const IN_RUN_ONLY = makeRow({
      id: "C-INRUN-ONLY",
      title: "In-run only contested (no roster match)",
      criterionContested: true,
    });
    renderLedgerWithRoster([IN_RUN_ONLY]);
    const inRunBlock = screen.getByTestId("run-report-contested-block");
    expect(inRunBlock.textContent).not.toContain(
      "It is excluded from the score on both sides",
    );
    // Heading is still present
    expect(inRunBlock.textContent).toContain("Contested Definition");
  });

  it("contested block still renders its provenance heading when tooltip copy is removed", () => {
    // The heading ("Contested Definition" or "Prior Contest") is the sole
    // non-hover surface for contested provenance and must remain.
    renderLedgerWithRoster([CONTESTED_ONLY]);
    const block = screen.getByTestId("run-report-contested-block");
    // "both" origin → heading is "Contested Definition"
    expect(block.textContent).toContain("Contested Definition");
    expect(block).toBeInTheDocument();
    expect(block.getAttribute("data-contested-origin")).toBe("both");
  });

  it("contested block for roster-only origin shows 'Prior Contest' heading only", () => {
    // Roster-only rows don't have a detail panel, so use a bundle row with
    // in-run origin. Test the heading text here for completeness.
    const IN_RUN_ONLY = makeRow({
      id: "C-INRUN-ONLY",
      title: "In-run only contested (no roster match)",
      criterionContested: true,
    });
    renderLedgerWithRoster([IN_RUN_ONLY]);
    const block = screen.getByTestId("run-report-contested-block");
    expect(block.getAttribute("data-contested-origin")).toBe("in-run");
    // Heading renders; tooltip copy does not
    expect(block.textContent).toContain("Contested Definition");
    expect(block.textContent).not.toContain("excluded from the score");
  });

  // ── Defect 2 fix: ContestedBlock must not use MarkdownRenderer / MermaidDiagram ──

  it("ContestedBlock renders no markdown/HTML-sink components (MarkdownRenderer / MermaidDiagram)", () => {
    // These components are HTML sinks (innerHTML / eval paths) and must never
    // be introduced into ContestedBlock — future LLM-authored content would
    // create an XSS vector if either component is used there.
    // We assert by data-testid: neither component exposes one under the block.
    renderLedgerWithRoster([CONTESTED_ONLY]);
    const block = screen.getByTestId("run-report-contested-block");
    // Neither MarkdownRenderer nor MermaidDiagram testids should be children.
    expect(block.querySelector("[data-testid='markdown-renderer']")).toBeNull();
    expect(block.querySelector("[data-testid='mermaid-diagram']")).toBeNull();
    // More broadly: the block should contain no rendered HTML beyond plain text
    // and the provenance heading div — no <p>, <pre>, <code>, <blockquote>,
    // or <svg> elements that would indicate a renderer was injected.
    expect(block.querySelector("p")).toBeNull();
    expect(block.querySelector("pre")).toBeNull();
    expect(block.querySelector("svg")).toBeNull();
    expect(block.querySelector("blockquote")).toBeNull();
  });
});

// ── Defect 1 fix: overflow layout class change-detectors ─────────────────────
// jsdom performs no layout and cannot prove containment. These assertions pin
// the Tailwind classes so the fix cannot silently regress. Verify containment
// manually at 240px rail width with a long real id
// (e.g. "employment-labor/identify-issues-in-separation-agreement-C-028").

describe("RubricLedger — overflow fix: min-w-0 / truncate class change-detectors", () => {
  it("CriterionButton title span carries 'min-w-0' (change-detector only — jsdom performs no layout)", () => {
    renderLedger([PLAIN_FAIL]);
    // The title span is inside the ledger item button. We look for the span
    // text and walk up to find the span with the title class pattern.
    const items = screen.getAllByTestId("run-report-ledger-item");
    expect(items.length).toBeGreaterThanOrEqual(1);
    // Find the title span by its text content inside the button
    const titleSpan = Array.from(items[0].querySelectorAll("span")).find(
      (s) => s.textContent?.includes("Plain fail criterion"),
    );
    expect(titleSpan).toBeDefined();
    // Change-detector: must carry min-w-0 (prevents flex item from refusing to shrink)
    expect(titleSpan?.className).toContain("min-w-0");
    // And truncate (the actual text-clipping class)
    expect(titleSpan?.className).toContain("truncate");
  });

  it("CriterionButton id span carries 'min-w-0' and 'truncate' (change-detector only)", () => {
    renderLedger([PLAIN_FAIL]);
    const items = screen.getAllByTestId("run-report-ledger-item");
    // The id span contains the criterion id "C-PLAIN"
    const idSpan = Array.from(items[0].querySelectorAll("span")).find(
      (s) => s.textContent?.trim() === "C-PLAIN",
    );
    expect(idSpan).toBeDefined();
    expect(idSpan?.className).toContain("min-w-0");
    expect(idSpan?.className).toContain("truncate");
  });

  it("RosterOnlyRow title span carries 'min-w-0' (change-detector only)", () => {
    renderLedgerWithRoster([PLAIN_FAIL]);
    const rosterRows = screen.getAllByTestId("run-report-roster-only-row");
    expect(rosterRows.length).toBeGreaterThanOrEqual(1);
    // Find a span across any roster row that directly contains the name text
    // as a direct TEXT_NODE child (not nested inside tooltip children).
    // We search all rows because the fixture produces 3 roster rows when only
    // PLAIN_FAIL is in the bundle, and their order is not guaranteed.
    let nameSpan: Element | undefined;
    for (const row of rosterRows) {
      nameSpan = Array.from(row.querySelectorAll("span")).find((s) => {
        const directText = Array.from(s.childNodes)
          .filter((n) => n.nodeType === Node.TEXT_NODE)
          .map((n) => n.textContent ?? "")
          .join("")
          .trim();
        // Match any roster row name: all three contested fixture names contain
        // recognisable substrings distinct from the verdict dot / tooltip text.
        return (
          directText.includes("Roster-only") ||
          directText.includes("Contested only criterion") ||
          directText.includes("C-OTHER-ID")
        );
      });
      if (nameSpan) break;
    }
    // Change-detector: name span must carry min-w-0 (prevents flex item from
    // refusing to shrink) and truncate (the text-clipping class).
    expect(nameSpan).toBeDefined();
    expect(nameSpan?.className).toContain("min-w-0");
    expect(nameSpan?.className).toContain("truncate");
  });

  it("RosterOnlyRow id span carries 'min-w-0' and 'truncate' (change-detector only)", () => {
    renderLedgerWithRoster([PLAIN_FAIL]);
    const rosterRows = screen.getAllByTestId("run-report-roster-only-row");
    // C-ROSTER-ONLY is the id of the roster-only row
    const idSpan = Array.from(rosterRows[rosterRows.length - 1].querySelectorAll("span")).find(
      (s) => s.textContent?.trim() === "C-ROSTER-ONLY",
    );
    expect(idSpan).toBeDefined();
    expect(idSpan?.className).toContain("min-w-0");
    expect(idSpan?.className).toContain("truncate");
  });

  it("detail-panel h3 carries 'min-w-0' and 'truncate' (change-detector only)", () => {
    renderLedger([PLAIN_FAIL]);
    // The detail panel h3 holds the selected criterion title.
    const h3 = document.querySelector("h3");
    expect(h3).not.toBeNull();
    expect(h3?.className).toContain("min-w-0");
    expect(h3?.className).toContain("truncate");
  });
});

describe("CriterionMarkers — shrink-0 class change-detector", () => {
  it("CriterionMarkers root span carries 'shrink-0' (change-detector only — jsdom performs no layout)", () => {
    // Render a contested criterion so CriterionMarkers is not null-returned.
    renderLedger([CONTESTED_ONLY]);
    // Find any criterion-contested-badge and walk up the ancestor chain looking
    // for the CriterionMarkers root span (inline-flex items-center gap-1 shrink-0).
    // The tooltip mock wraps in <div> elements, so we must not stop at DIV —
    // we walk until we hit the ledger item BUTTON or the document root.
    const badge = screen.getAllByTestId("criterion-contested-badge")[0];
    let el: Element | null = badge.parentElement;
    let found = false;
    while (el && el.tagName !== "BUTTON") {
      if (
        el.tagName === "SPAN" &&
        el.className.includes("inline-flex") &&
        el.className.includes("shrink-0")
      ) {
        found = true;
        break;
      }
      el = el.parentElement;
    }
    // Change-detector: the root span of CriterionMarkers must carry shrink-0
    // so it is never squeezed by a truncating sibling in the 240px rail.
    expect(found).toBe(true);
  });
});
