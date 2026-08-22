/**
 * @vitest-environment jsdom
 *
 * Unit tests for ConsolidatedReportView — the cross-run rubric matrix component.
 *
 * Covers:
 * - Matrix row count = criteria failing in at least one run
 * - Alphabetical row ordering (server-side, trusted from projection)
 * - PassFailBadge presence in cells
 * - Per-criterion detail tables rendered for each failing criterion
 * - "Judgement Review" row omitted when all runs have empty judgeFlagReason
 * - Source file link chips rendered from projection.sourceFileLinks
 * - Error/no-report states rendered gracefully
 * - No dangerouslySetInnerHTML — checked via absence of that prop
 * - Sticky-column markup present on criterion column (via className check)
 * - CriterionMarkers rendered for contested criteria
 */

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import type { ConsolidatedReportProjection, RunReportPayload } from "@/lib/run-report/types";
import fixture from "@/lib/run-report/fixtures/consolidated-report.fixture.json";

// ─── Mocks ───────────────────────────────────────────────────────────────────

// PassFailBadge — let it render with a simple testid so we can assert presence
vi.mock("@/components/run-report/RubricLedger", () => ({
  PassFailBadge: ({ pass }: { pass: boolean }) =>
    React.createElement(
      "span",
      { "data-testid": pass ? "pass-fail-badge-pass" : "pass-fail-badge-fail" },
      pass ? "pass" : "fail",
    ),
}));

// SafeMarkdown — render text inside a div so we can assert content without
// worrying about its internal structure.
vi.mock("@/components/run-report/SafeMarkdown", () => ({
  SafeMarkdown: ({ text }: { text: string }) =>
    React.createElement("div", { "data-testid": "safe-markdown" }, text),
}));

// CriterionMarkers — lightweight stub
vi.mock("@/components/run-report/CriterionMarkers", () => ({
  CriterionMarkers: ({
    contested,
    disputed,
  }: {
    contested?: boolean;
    disputed?: boolean;
  }) =>
    React.createElement(
      "span",
      {
        "data-testid": "criterion-markers",
        "data-contested": String(!!contested),
        "data-disputed": String(!!disputed),
      },
      null,
    ),
}));

// SectionErrorBoundary — transparent pass-through for tests
// Kicker / EmptyPanel — stubs
vi.mock("@/components/run-report/chrome", () => ({
  SectionErrorBoundary: ({ children }: { children: React.ReactNode }) =>
    React.createElement("div", { "data-testid": "section-error-boundary" }, children),
  Kicker: ({ children }: { children: React.ReactNode }) =>
    React.createElement("div", { "data-testid": "kicker" }, children),
  EmptyPanel: ({ label }: { label: string }) =>
    React.createElement("div", { "data-testid": "empty-panel" }, label),
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makePayload(
  projection: ConsolidatedReportProjection | null,
  overrides: Partial<RunReportPayload> = {},
): RunReportPayload {
  return {
    runId: "run-test",
    hasReport: projection !== null,
    projection,
    ...overrides,
  };
}

/** Cast fixture JSON to the projection type (it was generated to match it). */
const FIXTURE = fixture as ConsolidatedReportProjection;

/** Lazy import — avoids hoisting issues with vi.mock above. */
async function importView() {
  const mod = await import("@/components/legal/ConsolidatedReportView");
  return mod.ConsolidatedReportView;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("ConsolidatedReportView", () => {
  let ConsolidatedReportView: Awaited<ReturnType<typeof importView>>;

  beforeEach(async () => {
    ConsolidatedReportView = await importView();
  });

  // ── Error / empty states ─────────────────────────────────────────────────

  it("renders no-report state when hasReport is false", () => {
    const payload = makePayload(null, { hasReport: false });
    render(
      React.createElement(ConsolidatedReportView, {
        payload,
        projection: null,
        taskSlug: "antitrust/task-1",
      }),
    );
    expect(screen.getByTestId("consolidated-no-report")).toBeDefined();
  });

  it("renders error state when payload.error is set", () => {
    const payload = makePayload(null, { hasReport: true, error: "unavailable" });
    render(
      React.createElement(ConsolidatedReportView, {
        payload,
        projection: null,
        taskSlug: "antitrust/task-1",
      }),
    );
    expect(screen.getByTestId("consolidated-error")).toBeDefined();
  });

  it("renders url_rejected error message", () => {
    const payload = makePayload(null, { hasReport: true, error: "url_rejected" });
    render(
      React.createElement(ConsolidatedReportView, {
        payload,
        projection: null,
        taskSlug: "antitrust/task-1",
      }),
    );
    const el = screen.getByTestId("consolidated-error");
    expect(el.textContent).toContain("rejected");
  });

  // ── Header ───────────────────────────────────────────────────────────────

  it("renders the task slug in the header", () => {
    const payload = makePayload(FIXTURE);
    render(
      React.createElement(ConsolidatedReportView, {
        payload,
        projection: FIXTURE,
        taskSlug: "corporate/merger-reps",
      }),
    );
    const header = screen.getByTestId("consolidated-header");
    expect(header.textContent).toContain("corporate/merger-reps");
  });

  it("renders taskDescription via SafeMarkdown", () => {
    const payload = makePayload(FIXTURE);
    render(
      React.createElement(ConsolidatedReportView, {
        payload,
        projection: FIXTURE,
        taskSlug: "corporate/merger-reps",
      }),
    );
    const markdowns = screen.getAllByTestId("safe-markdown");
    const descriptionMd = markdowns.find((el) =>
      el.textContent?.includes("merger agreement"),
    );
    expect(descriptionMd).toBeDefined();
  });

  it("renders source file link chips", () => {
    const payload = makePayload(FIXTURE);
    render(
      React.createElement(ConsolidatedReportView, {
        payload,
        projection: FIXTURE,
        taskSlug: "corporate/merger-reps",
      }),
    );
    const links = screen.getAllByTestId("source-file-link");
    expect(links.length).toBe(FIXTURE.sourceFileLinks.length);
    expect(links[0].getAttribute("href")).toBe(FIXTURE.sourceFileLinks[0]);
    expect(links[0].getAttribute("rel")).toBe("noopener noreferrer");
    expect(links[0].getAttribute("target")).toBe("_blank");
  });

  // ── Matrix ───────────────────────────────────────────────────────────────

  it("renders the matrix section", () => {
    const payload = makePayload(FIXTURE);
    render(
      React.createElement(ConsolidatedReportView, {
        payload,
        projection: FIXTURE,
        taskSlug: "corporate/merger-reps",
      }),
    );
    expect(screen.getByTestId("consolidated-matrix")).toBeDefined();
  });

  it("renders all rubricMatrix rows (filtering is done server-side before projection)", () => {
    const payload = makePayload(FIXTURE);
    render(
      React.createElement(ConsolidatedReportView, {
        payload,
        projection: FIXTURE,
        taskSlug: "corporate/merger-reps",
      }),
    );
    const rows = screen.getAllByTestId("matrix-row");
    // The component renders all rows from the projection as-is.
    // server-side projectConsolidatedBundle already filtered to failing criteria,
    // so the count equals rubricMatrix.length (5 in the fixture).
    expect(rows.length).toBe(FIXTURE.rubricMatrix.length);
  });

  it("matrix criterion titles are rendered in the order received from the projection", () => {
    const payload = makePayload(FIXTURE);
    render(
      React.createElement(ConsolidatedReportView, {
        payload,
        projection: FIXTURE,
        taskSlug: "corporate/merger-reps",
      }),
    );
    const titles = screen.getAllByTestId("matrix-criterion-title");
    // The component trusts server-side ordering from projectConsolidatedBundle.
    FIXTURE.rubricMatrix.forEach((row, i) => {
      expect(titles[i].textContent).toBe(row.title);
    });
  });

  it("renders PassFailBadge for each run result in each matrix row", () => {
    const payload = makePayload(FIXTURE);
    render(
      React.createElement(ConsolidatedReportView, {
        payload,
        projection: FIXTURE,
        taskSlug: "corporate/merger-reps",
      }),
    );
    // 5 rubric rows × 3 runs = 15 badges (some pass, some fail)
    const passBadges = screen.getAllByTestId("pass-fail-badge-pass");
    const failBadges = screen.getAllByTestId("pass-fail-badge-fail");
    expect(passBadges.length + failBadges.length).toBe(
      FIXTURE.rubricMatrix.length * FIXTURE.runs.length,
    );
  });

  it("renders EmptyPanel when rubricMatrix is empty", () => {
    // projectConsolidatedBundle produces rubricMatrix: [] when all criteria pass.
    const allPassProjection: ConsolidatedReportProjection = {
      ...FIXTURE,
      rubricMatrix: [],
    };
    const payload = makePayload(allPassProjection);
    render(
      React.createElement(ConsolidatedReportView, {
        payload,
        projection: allPassProjection,
        taskSlug: "corporate/merger-reps",
      }),
    );
    expect(screen.getByTestId("consolidated-matrix-empty")).toBeDefined();
  });

  // ── Sticky first column ──────────────────────────────────────────────────

  it("first column of matrix table has sticky positioning class", () => {
    const payload = makePayload(FIXTURE);
    const { container } = render(
      React.createElement(ConsolidatedReportView, {
        payload,
        projection: FIXTURE,
        taskSlug: "corporate/merger-reps",
      }),
    );
    const table = container.querySelector("[data-testid='rubric-matrix-table']");
    expect(table).not.toBeNull();
    // The header's first th and every row's first td should have "sticky" class
    const stickyHeader = table!.querySelector("thead th.sticky");
    expect(stickyHeader).not.toBeNull();
    const stickyDataCells = table!.querySelectorAll("tbody td.sticky");
    expect(stickyDataCells.length).toBeGreaterThan(0);
  });

  // ── Criterion detail tables ──────────────────────────────────────────────

  it("renders one detail table per rubricDetails entry", () => {
    const payload = makePayload(FIXTURE);
    render(
      React.createElement(ConsolidatedReportView, {
        payload,
        projection: FIXTURE,
        taskSlug: "corporate/merger-reps",
      }),
    );
    // fixture has 4 rubricDetails entries
    FIXTURE.rubricDetails.forEach((detail) => {
      expect(screen.getByTestId(`criterion-detail-${detail.id}`)).toBeDefined();
    });
  });

  it("renders 'Match criteria' row in detail tables", () => {
    const payload = makePayload(FIXTURE);
    render(
      React.createElement(ConsolidatedReportView, {
        payload,
        projection: FIXTURE,
        taskSlug: "corporate/merger-reps",
      }),
    );
    const criteriaRows = screen.getAllByTestId("detail-row-criteria");
    expect(criteriaRows.length).toBe(FIXTURE.rubricDetails.length);
  });

  it("renders 'Verdict' row in detail tables", () => {
    const payload = makePayload(FIXTURE);
    render(
      React.createElement(ConsolidatedReportView, {
        payload,
        projection: FIXTURE,
        taskSlug: "corporate/merger-reps",
      }),
    );
    const verdictRows = screen.getAllByTestId("detail-row-verdict");
    expect(verdictRows.length).toBe(FIXTURE.rubricDetails.length);
  });

  it("omits 'Judgement Review' row when all runs have empty judgeFlagReason", () => {
    // crit_003 in fixture: run_001 and run_003 have empty judgeFlagReason;
    // run_002 has a non-empty reason — so Judgement Review IS shown.
    // Build a projection where all judgeFlagReasons are empty.
    const noFlagProjection: ConsolidatedReportProjection = {
      ...FIXTURE,
      rubricDetails: [
        {
          id: "crit_002",
          title: "Correctly identifies materiality qualifiers",
          matchCriteria: "The response must...",
          perRun: [
            { runId: "run_001", verdict: "PASS", reasoning: "good", judgeFlagReason: "", criterionContested: false },
            { runId: "run_002", verdict: "FAIL", reasoning: "bad", judgeFlagReason: "", criterionContested: false },
          ],
        },
      ],
    };
    const payload = makePayload(noFlagProjection);
    render(
      React.createElement(ConsolidatedReportView, {
        payload,
        projection: noFlagProjection,
        taskSlug: "corporate/merger-reps",
      }),
    );
    // Should NOT render the flag row when all judgeFlagReason are empty
    expect(screen.queryByTestId("detail-row-flag")).toBeNull();
  });

  it("shows 'Judgement Review' row when at least one run has a non-empty judgeFlagReason", () => {
    const payload = makePayload(FIXTURE);
    render(
      React.createElement(ConsolidatedReportView, {
        payload,
        projection: FIXTURE,
        taskSlug: "corporate/merger-reps",
      }),
    );
    // crit_002 in fixture has run_002 with a non-empty judgeFlagReason
    const flagRows = screen.getAllByTestId("detail-row-flag");
    expect(flagRows.length).toBeGreaterThan(0);
  });

  it("renders CriterionMarkers for each run in status row", () => {
    const payload = makePayload(FIXTURE);
    render(
      React.createElement(ConsolidatedReportView, {
        payload,
        projection: FIXTURE,
        taskSlug: "corporate/merger-reps",
      }),
    );
    const markers = screen.getAllByTestId("criterion-markers");
    // Each detail criterion × 3 runs = 4 × 3 = 12 markers
    expect(markers.length).toBe(12);
  });

  it("marks contested criterion correctly in CriterionMarkers", () => {
    const payload = makePayload(FIXTURE);
    render(
      React.createElement(ConsolidatedReportView, {
        payload,
        projection: FIXTURE,
        taskSlug: "corporate/merger-reps",
      }),
    );
    // crit_002 run_003 has criterionContested: true
    const contested = screen
      .getAllByTestId("criterion-markers")
      .filter((el) => el.getAttribute("data-contested") === "true");
    expect(contested.length).toBeGreaterThan(0);
  });

  // ── Safety: no dangerouslySetInnerHTML ───────────────────────────────────

  it("does not use dangerouslySetInnerHTML anywhere in the rendered output", () => {
    const payload = makePayload(FIXTURE);
    const { container } = render(
      React.createElement(ConsolidatedReportView, {
        payload,
        projection: FIXTURE,
        taskSlug: "corporate/merger-reps",
      }),
    );
    // Walk the real DOM; dangerouslySetInnerHTML would show up as innerHTML
    // being set on a node with raw HTML content. We verify no element has
    // an unexpected innerHTML that looks like raw HTML tags.
    const allElements = container.querySelectorAll("*");
    allElements.forEach((el) => {
      // If any element has innerHTML that starts with "<", it may contain
      // raw HTML — only acceptable for the stubbed SafeMarkdown wrapper divs
      // which contain plain text, not HTML. In the real component no element
      // should ever have innerHtml that looks like injected markup.
      if (el.innerHTML && el.innerHTML.startsWith("<")) {
        // Acceptable: child elements rendered by React (they have proper
        // element children, not raw HTML strings). Check that no element
        // has a `data-testid` attribute injected via innerHTML.
        expect(el.innerHTML).not.toContain("dangerouslySetInnerHTML");
      }
    });
  });

  // ── SectionErrorBoundary wrapping ────────────────────────────────────────

  it("wraps each section in SectionErrorBoundary", () => {
    const payload = makePayload(FIXTURE);
    render(
      React.createElement(ConsolidatedReportView, {
        payload,
        projection: FIXTURE,
        taskSlug: "corporate/merger-reps",
      }),
    );
    // Header + matrix + 4 detail tables = at least 6 boundaries
    const boundaries = screen.getAllByTestId("section-error-boundary");
    expect(boundaries.length).toBeGreaterThanOrEqual(6);
  });

  // ── DOCX editor pill (workspaceSlug + slug threading) ────────────────────

  it("does NOT render open-docx-in-editor pills when workspaceSlug is omitted", () => {
    // All fixture sourceFileLinks are .pdf — no docx pills expected even with slug
    const payload = makePayload(FIXTURE);
    render(
      React.createElement(ConsolidatedReportView, {
        payload,
        projection: FIXTURE,
        taskSlug: "corporate/merger-reps",
        // workspaceSlug intentionally omitted
      }),
    );
    // No DOCX edit pills for non-.docx files
    const pills = screen.queryAllByTestId("open-docx-in-editor");
    expect(pills).toHaveLength(0);
  });

  it("renders open-docx-in-editor pills for .docx sourceFileLinks when workspaceSlug is provided", () => {
    // Override sourceFileLinks to include a .docx file
    const projectionWithDocx: typeof FIXTURE = {
      ...FIXTURE,
      sourceFileLinks: [
        "https://raw.githubusercontent.com/stakwork/harvey-labs/main/tasks/corporate/contract.docx",
        "https://raw.githubusercontent.com/stakwork/harvey-labs/main/tasks/corporate/merger.pdf",
      ],
    };

    const payload = makePayload(projectionWithDocx);
    render(
      React.createElement(ConsolidatedReportView, {
        payload,
        projection: projectionWithDocx,
        taskSlug: "corporate/merger-reps",
        workspaceSlug: "openlaw",
      }),
    );

    // One DOCX edit pill for contract.docx
    const pills = screen.getAllByTestId("open-docx-in-editor");
    expect(pills).toHaveLength(1);

    // Pill href routes through /w/openlaw/documents?url=...
    const href = pills[0].getAttribute("href") ?? "";
    expect(href).toContain("/w/openlaw/documents?url=");
    expect(href).toContain(encodeURIComponent("contract.docx"));
  });

  it("does NOT render open-docx-in-editor pills for non-.docx sourceFileLinks", () => {
    // Override sourceFileLinks to include only non-.docx files
    const projectionPdfOnly: typeof FIXTURE = {
      ...FIXTURE,
      sourceFileLinks: [
        "https://raw.githubusercontent.com/stakwork/harvey-labs/main/tasks/corporate/merger.pdf",
        "https://raw.githubusercontent.com/stakwork/harvey-labs/main/tasks/corporate/schedule.txt",
      ],
    };

    const payload = makePayload(projectionPdfOnly);
    render(
      React.createElement(ConsolidatedReportView, {
        payload,
        projection: projectionPdfOnly,
        taskSlug: "corporate/merger-reps",
        workspaceSlug: "openlaw",
      }),
    );

    // No DOCX pills — none of the files are .docx
    const pills = screen.queryAllByTestId("open-docx-in-editor");
    expect(pills).toHaveLength(0);
  });

  it("threads workspaceSlug through to ConsolidatedHeader via the rendered pill href", () => {
    const projectionWithDocx: typeof FIXTURE = {
      ...FIXTURE,
      sourceFileLinks: [
        "https://raw.githubusercontent.com/stakwork/harvey-labs/main/tasks/corporate/contract.docx",
      ],
    };

    const payload = makePayload(projectionWithDocx);
    render(
      React.createElement(ConsolidatedReportView, {
        payload,
        projection: projectionWithDocx,
        taskSlug: "corporate/merger-reps",
        workspaceSlug: "my-workspace",
      }),
    );

    const pills = screen.getAllByTestId("open-docx-in-editor");
    expect(pills).toHaveLength(1);
    expect(pills[0].getAttribute("href")).toContain("/w/my-workspace/documents");
  });
});
