import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { TracesSection, HealthSection, ToolActivitySection, ConceptsSection } from "@/components/run-report/sections";
import type { RunReportProjection, SecurityFinding, ToolActivityProjection } from "@/lib/run-report/types";
import type { NormalizedToolCall, NormalizedNode, ToolActivityGroup } from "@/lib/run-report/tool-activity";

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

// ── ToolActivitySection tests ────────────────────────────────────────────────

function makeCall(overrides: Partial<NormalizedToolCall> = {}): NormalizedToolCall {
  return {
    toolName: "graph_search",
    rawToolName: "graph_search",
    input: { query: "test" },
    nodes: [],
    status: "ok",
    position: 0,
    nodesTruncated: false,
    nodesDroppedCount: 0,
    withheldInputFieldCount: 0,
    isUnknownTool: false,
    ...overrides,
  };
}

function makeNode(overrides: Partial<NormalizedNode> = {}): NormalizedNode {
  return {
    name: "test-node",
    nodeType: "Concept",
    hasContent: false,
    ...overrides,
  };
}

function toolActivityProjection(overrides: Partial<ToolActivityProjection> = {}): ToolActivityProjection {
  return {
    present: true,
    schemaVersion: 2,
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
    ...overrides,
  };
}

describe("ToolActivitySection", () => {
  it("renders nothing when toolActivity.present is false", () => {
    const projection = baseProjection(); // toolActivity.present: false
    const { container } = render(<ToolActivitySection projection={projection} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when groups is empty even if present is true", () => {
    const projection = baseProjection({
      toolActivity: toolActivityProjection({ present: true, groups: [] }),
    });
    const { container } = render(<ToolActivitySection projection={projection} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders groups when present", () => {
    const group: ToolActivityGroup = {
      agentKey: "cross_check_agent",
      agentName: "cross_check_agent",
      isUnattributed: false,
      calls: [
        makeCall({ toolName: "graph_search", rawToolName: "graph_search", nodes: [
          makeNode({ name: "termination_clause", nodeType: "Concept", identity: "node-A" }),
        ], status: "ok" }),
      ],
    };
    const projection = baseProjection({
      toolActivity: toolActivityProjection({ groups: [group] }),
    });
    render(<ToolActivitySection projection={projection} />);
    expect(screen.getByText(/cross_check_agent/)).toBeInTheDocument();
    // graph_search appears in both the per-tool count row and the Fold summary
    expect(screen.getAllByText(/graph_search/).length).toBeGreaterThanOrEqual(1);
  });

  it("renders error and empty call rows as visibly distinct badges", () => {
    const group: ToolActivityGroup = {
      agentKey: "agent-a",
      agentName: "agent-a",
      isUnattributed: false,
      calls: [
        makeCall({ toolName: "graph_search", status: "error", nodes: [] }),
        makeCall({ toolName: "graph_get", status: "empty", nodes: [] }),
      ],
    };
    const projection = baseProjection({
      toolActivity: toolActivityProjection({ groups: [group] }),
    });
    render(<ToolActivitySection projection={projection} />);
    expect(screen.getByText("ERROR")).toBeInTheDocument();
    expect(screen.getByText("EMPTY")).toBeInTheDocument();
  });

  it("zero-node call from unrecognized non-node tool renders ok with no badge", () => {
    // A call with status ok and zero nodes and isUnknownTool false → no badge, just "no nodes returned"
    const group: ToolActivityGroup = {
      agentKey: "agent-a",
      agentName: "agent-a",
      isUnattributed: false,
      calls: [
        makeCall({ toolName: "graph_ontology", status: "ok", nodes: [], isUnknownTool: false }),
      ],
    };
    const projection = baseProjection({
      toolActivity: toolActivityProjection({ groups: [group] }),
    });
    render(<ToolActivitySection projection={projection} />);
    // Should render "no nodes returned" text, not an ERROR or EMPTY badge
    expect(screen.queryByText("ERROR")).toBeNull();
    expect(screen.queryByText("EMPTY")).toBeNull();
    expect(screen.getByText("no nodes returned")).toBeInTheDocument();
  });

  it("shows data-quality counters when present", () => {
    const group: ToolActivityGroup = {
      agentKey: "agent-a",
      agentName: "agent-a",
      isUnattributed: false,
      calls: [makeCall()],
    };
    const projection = baseProjection({
      toolActivity: toolActivityProjection({
        groups: [group],
        unknownToolNames: ["mystery_tool"],
        unidentifiedNodeCount: 3,
        withheldInputFieldCount: 2,
      }),
    });
    render(<ToolActivitySection projection={projection} />);
    expect(screen.getByText(/mystery_tool/)).toBeInTheDocument();
    expect(screen.getByText(/3 node\(s\) with no identity/)).toBeInTheDocument();
    expect(screen.getByText(/2 input field\(s\) withheld/)).toBeInTheDocument();
  });
});

// ── ConceptsSection — Graph nodes used block ──────────────────────────────────

describe("ConceptsSection", () => {
  it("shows 'Graph nodes used' block when toolActivity has nodeIdentities", () => {
    const group: ToolActivityGroup = {
      agentKey: "cross_check_agent",
      agentName: "cross_check_agent",
      isUnattributed: false,
      calls: [
        makeCall({
          toolName: "graph_search",
          nodes: [
            makeNode({
              name: "termination_clause",
              nodeType: "Concept",
              identity: "node-A",
              identityKind: "ref_id",
              canonicalKey: "ref_id:node-A",
              retrievalBasis: "content",
              hasContent: true,
            }),
          ],
          status: "ok",
        }),
      ],
    };
    const projection = baseProjection({
      toolActivity: toolActivityProjection({
        groups: [group],
        nodeIdentities: [{
          canonicalKey: "ref_id:node-A",
          identity: "node-A",
          identityKind: "ref_id",
          name: "termination_clause",
          nodeType: "Concept",
          runStatus: "retrieved",
          runBasis: "content",
          agents: [{ agentKey: "cross_check_agent", agentName: "cross_check_agent", count: 1, status: "retrieved", basis: "content" }],
          hasOffScreenEvidence: false,
        }],
      }),
      concepts: { synthesis: { overall_narrative: "Test narrative" } },
    });
    render(<ConceptsSection projection={projection} />);
    expect(screen.getByText(/Graph nodes used/)).toBeInTheDocument();
    expect(screen.getByText("termination_clause")).toBeInTheDocument();
    expect(screen.getByText("retrieved")).toBeInTheDocument();
  });

  it("still shows synthesis-not-run panel for bundle without synthesis", () => {
    const projection = baseProjection({
      concepts: {},
    });
    render(<ConceptsSection projection={projection} />);
    expect(screen.getByText(/Concept synthesis was not run/i)).toBeInTheDocument();
  });

  it("renders synthesis narrative when present", () => {
    const projection = baseProjection({
      concepts: { synthesis: { overall_narrative: "The concept narrative text." } },
    });
    render(<ConceptsSection projection={projection} />);
    expect(screen.getByTestId("run-report-concept-narrative")).toHaveTextContent("The concept narrative text.");
  });
});

// ── CopyableId ────────────────────────────────────────────────────────────────

describe("CopyableId", () => {
  it("renders and click doesn't throw", async () => {
    // Import directly from chrome since it's already available
    const { CopyableId } = await import("@/components/run-report/chrome");
    const { container } = render(<CopyableId identity="node-A" />);
    expect(container.textContent).toContain("node-A");
    // Click should not throw (copy may fail in test env but not throw)
    const btn = container.querySelector("button");
    if (btn) {
      expect(() => fireEvent.click(btn)).not.toThrow();
    }
  });
});
