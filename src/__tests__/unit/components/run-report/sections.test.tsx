import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { TracesSection, HealthSection } from "@/components/run-report/sections";
import type { RunReportProjection, SecurityFinding } from "@/lib/run-report/types";

// TracesSection uses readTraces(projection.analysis) which reads `analysis.traces[]`
// and readSummaries which reads `analysis.summaries[]`.
// HealthSection reads projection.pageData.security directly.

// Minimal base projection shared across tests.
function baseProjection(
  overrides: Partial<RunReportProjection> = {},
): RunReportProjection {
  return {
    generatedAtMs: null,
    pageData: {
      config: {},
      score: {
        score: 0, max_score: 0, all_pass: false, n_criteria: 0,
        n_passed: 0, judge_model: null, scored_at: null,
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
    rubricRows: [],
    stats: { passCount: null, failCount: 0, rubricCount: 0, sourceDocCount: 0, workfileCount: 0, agentCount: 0, stepCount: 0, traceCount: 0, noteCount: 0 },
    toolActivity: {
      present: false,
      schemaVersion: null,
      groups: [],
      nodeIdentities: [],
      orderingBasis: "position" as const,
      unidentifiedNodeCount: 0,
      unattributedRecordCount: 0,
      unknownToolNames: [],
      ambiguousIdentityCount: 0,
      withheldInputFieldCount: 0,
      allSurfacedHint: false,
      truncated: { groups: 0, callsPerAgent: [], nodesPerCall: 0 },
    },
    ...overrides,
  };
}

// Build a minimal analysis object with a single trace.
function analysisWithTrace(pathway: Array<{ station: string; status: string; evidence: unknown }>) {
  return {
    summaries: [],
    traces: [
      {
        rubric_id: "R-01",
        pathway,
        q_ingested_to_graph: null,
        q_knowable_or_derived: null,
        q_draft_got_it: null,
        q_verify_got_it: null,
        root_cause: "",
        classification: "",
        fix_suggestions: [],
      },
    ],
  };
}

// Build a projection with specific security findings.
function projectionWithSecurity(findings: SecurityFinding[]): RunReportProjection {
  return baseProjection({
    pageData: {
      config: {},
      score: {
        score: 0, max_score: 0, all_pass: false, n_criteria: 0,
        n_passed: 0, judge_model: null, scored_at: null,
      },
      rubrics: [],
      timeline: [],
      agents: [],
      documents: [],
      branches: [],
      healthNotes: [],
      wallClockMin: null,
      logStats: {},
      security: findings,
      outputs: {},
    },
  });
}

// ── TraceCard render tests (via TracesSection) ────────────────────────────────

describe("TraceCard — station.evidence rendering", () => {
  it("renders a plain string evidence as text content", () => {
    const projection = baseProjection({
      analysis: analysisWithTrace([
        { station: "graph-lookup", status: "pass", evidence: "Found in graph." },
      ]),
    });
    render(<TracesSection projection={projection} />);
    expect(screen.getByText("Found in graph.")).toBeInTheDocument();
  });

  it("renders an object evidence as a <dl>, wrapped in a <div> not a <span>", () => {
    const projection = baseProjection({
      analysis: analysisWithTrace([
        {
          station: "graph-lookup",
          status: "pass",
          evidence: { key: "value", nested: { deep: "data" } },
        },
      ]),
    });
    const { container } = render(<TracesSection projection={projection} />);

    // Should render a dl (object → dl)
    const dl = container.querySelector("dl");
    expect(dl).not.toBeNull();
    expect(dl!.textContent).toContain("key");
    expect(dl!.textContent).toContain("value");

    // The wrapper around evidence must be a div, not a span
    // Find the element that has class break-words and flex-1 alongside text-muted-foreground
    const wrapper = container.querySelector(".break-words.flex-1");
    expect(wrapper).not.toBeNull();
    expect(wrapper!.tagName.toLowerCase()).toBe("div");
  });

  it("renders an array evidence as a <ul>, wrapped in a <div> not a <span>", () => {
    const projection = baseProjection({
      analysis: analysisWithTrace([
        {
          station: "graph-lookup",
          status: "pass",
          evidence: ["item-alpha", "item-beta"],
        },
      ]),
    });
    const { container } = render(<TracesSection projection={projection} />);

    // The evidence wrapper must be a div
    const wrapper = container.querySelector(".break-words.flex-1");
    expect(wrapper).not.toBeNull();
    expect(wrapper!.tagName.toLowerCase()).toBe("div");

    // Content should have a ul with the items
    const ul = wrapper!.querySelector("ul");
    expect(ul).not.toBeNull();
    expect(ul!.textContent).toContain("item-alpha");
    expect(ul!.textContent).toContain("item-beta");
  });

  it("does not render raw JSON for object evidence", () => {
    const evidence = { a: 1, b: "two" };
    const projection = baseProjection({
      analysis: analysisWithTrace([
        { station: "s1", status: "pass", evidence },
      ]),
    });
    const { container } = render(<TracesSection projection={projection} />);
    // Raw JSON should not appear as a text node
    expect(container.textContent).not.toContain('{"a":1');
  });
});

// ── HealthSection render tests ────────────────────────────────────────────────

describe("HealthSection — security findings fallback chain", () => {
  it("shows finding.detail when present", () => {
    const projection = projectionWithSecurity([
      { severity: "low", detail: "SQL injection risk in login form." },
    ]);
    render(<HealthSection projection={projection} />);
    expect(screen.getByText("SQL injection risk in login form.")).toBeInTheDocument();
  });

  it("shows finding.where when detail is absent", () => {
    const projection = projectionWithSecurity([
      { severity: "medium", where: "/api/auth/login" },
    ]);
    render(<HealthSection projection={projection} />);
    expect(screen.getByText("/api/auth/login")).toBeInTheDocument();
  });

  it("shows finding.kind when both detail and where are absent", () => {
    const projection = projectionWithSecurity([
      { severity: "high", kind: "XSS" },
    ]);
    render(<HealthSection projection={projection} />);
    expect(screen.getByText("XSS")).toBeInTheDocument();
  });

  it("renders a <pre> block when detail, where, and kind are all absent — no raw JSON in text node", () => {
    const finding = { severity: "low", count: 3 } as SecurityFinding;
    const projection = projectionWithSecurity([finding]);
    const { container } = render(<HealthSection projection={projection} />);

    // Should have a <pre> element for the fallback
    const pre = container.querySelector("pre");
    expect(pre).not.toBeNull();

    // The <pre> should contain the JSON representation
    expect(pre!.textContent).toContain('"severity"');

    // The parent wrapper must be a div, not a span
    const wrapper = container.querySelector(".text-muted-foreground.flex-1");
    expect(wrapper).not.toBeNull();
    expect(wrapper!.tagName.toLowerCase()).toBe("div");
  });

  it("wrapper element is a <div> not a <span> for all finding display paths", () => {
    // Test with detail present (most common case)
    const projection = projectionWithSecurity([
      { severity: "info", detail: "Something suspicious." },
    ]);
    const { container } = render(<HealthSection projection={projection} />);
    const wrapper = container.querySelector(".text-muted-foreground.flex-1");
    expect(wrapper).not.toBeNull();
    expect(wrapper!.tagName.toLowerCase()).toBe("div");
  });
});
