/**
 * Unit tests for `components/system-map/SystemMapReport/model.ts`.
 *
 * Coverage:
 *   - parse: recognises the workflow's shape, keeps summary counts and
 *     version, drops malformed rows; rejects non-reports (string, markdown
 *     object, empty) so the generic renderer takes over.
 *   - tree: roots are the `Thing` children; a parent absent from the report
 *     makes an orphan a root; subtree counts roll up.
 *   - filter: verdict + text; ancestors of a match are kept; counts are
 *     recomputed over kept nodes only.
 *   - edges: grouped by relation in first-seen order with counts; filter
 *     applies; segments drop zero verdicts and keep fixed order.
 */

import { describe, it, expect } from "vitest";
import {
  buildTypeTree,
  filterTypeTree,
  groupEdges,
  parseSystemMapReport,
  verdictSegments,
  type Verdict,
} from "@/components/system-map/SystemMapReport/model";
import { REPORT_FIXTURE } from "./fixture";

const NO_FILTER = { verdicts: new Set<Verdict>(), query: "" };

describe("parseSystemMapReport", () => {
  it("recognises the workflow output and keeps the summary", () => {
    const report = parseSystemMapReport(REPORT_FIXTURE);
    expect(report).not.toBeNull();
    expect(report!.nodeTypes).toHaveLength(8);
    expect(report!.edges).toHaveLength(6);
    expect(report!.summary.counts).toEqual({ MATCH: 3, MISSING: 7, PARTIAL: 3, UNKNOWN: 1, CONFLICT: 0 });
    expect(report!.summary.consideredNodeTypes).toBe(8);
    expect(report!.ontologyVersion).toEqual({ hash: REPORT_FIXTURE.ontologyVersion.hash, typeCount: 144, edgeCount: 167 });
    expect(report!.swarmUrl).toBe("https://swarm38.sphinx.chat:3355");
    expect(report!.note).toMatch(/^Graph-only/);
  });

  it("drops malformed rows and derives counts when the summary is absent", () => {
    const report = parseSystemMapReport({
      nodeTypes: [
        { type: "SysA", parent: "Thing", verdict: "MATCH" },
        { type: "SysB", parent: "Thing", verdict: "nope" },
        { parent: "Thing", verdict: "MATCH" },
        "junk",
      ],
      edges: [{ edge_type: "CALLS", source_type: "SysA", target_type: "SysA", verdict: "MISSING", evidence: [1, "ok"] }],
    });
    expect(report!.nodeTypes.map((t) => t.type)).toEqual(["SysA"]);
    expect(report!.nodeTypes[0].evidence).toEqual([]);
    expect(report!.edges[0].evidence).toEqual(["ok"]);
    expect(report!.summary.counts).toEqual({ MATCH: 1, MISSING: 1, PARTIAL: 0, UNKNOWN: 0, CONFLICT: 0 });
    expect(report!.ontologyVersion).toBeNull();
  });

  it("returns null for anything that is not a report", () => {
    expect(parseSystemMapReport("# Map")).toBeNull();
    expect(parseSystemMapReport({ summary: "done", files: 3 })).toBeNull();
    expect(parseSystemMapReport({ nodeTypes: [], edges: [] })).toBeNull();
    expect(parseSystemMapReport(null)).toBeNull();
    expect(parseSystemMapReport([1, 2])).toBeNull();
  });
});

describe("buildTypeTree", () => {
  it("hangs families off Thing, roots orphans, and rolls counts up", () => {
    const report = parseSystemMapReport(REPORT_FIXTURE)!;
    const tree = buildTypeTree(report.nodeTypes);

    expect(tree.map((n) => n.item.type)).toEqual(["SysComponent", "SysTechnology", "SysFirewallComponent"]);
    const component = tree[0];
    expect(component.children.map((c) => c.item.type)).toEqual(["SysApplicationComponent"]);
    expect(component.children[0].children.map((c) => c.item.type)).toEqual(["SysWebApplication", "SysMobileApplication"]);
    // SysComponent (PARTIAL) + SysApplicationComponent (PARTIAL) + Web (MATCH) + Mobile (MISSING)
    expect(component.counts).toEqual({ MATCH: 1, PARTIAL: 2, MISSING: 1, UNKNOWN: 0, CONFLICT: 0 });
    expect(tree[2].counts.UNKNOWN).toBe(1);
  });
});

describe("filterTypeTree", () => {
  const tree = buildTypeTree(parseSystemMapReport(REPORT_FIXTURE)!.nodeTypes);

  it("returns the same tree when nothing is filtered", () => {
    expect(filterTypeTree(tree, NO_FILTER)).toBe(tree);
  });

  it("keeps the ancestors of a verdict match and recounts over kept nodes", () => {
    const out = filterTypeTree(tree, { verdicts: new Set<Verdict>(["MATCH"]), query: "" });
    expect(out.map((n) => n.item.type)).toEqual(["SysComponent", "SysTechnology"]);
    const web = out[0].children[0].children;
    expect(web.map((c) => c.item.type)).toEqual(["SysWebApplication"]);
    // Ancestors are kept but not counted (they are PARTIAL, not MATCH).
    expect(out[0].counts).toEqual({ MATCH: 1, PARTIAL: 0, MISSING: 0, UNKNOWN: 0, CONFLICT: 0 });
  });

  it("matches text against type names, evidence and reason", () => {
    const byEvidence = filterTypeTree(tree, { verdicts: new Set(), query: "redis" });
    expect(byEvidence.map((n) => n.item.type)).toEqual(["SysTechnology"]);
    expect(byEvidence[0].children.map((c) => c.item.type)).toEqual(["SysCacheTechnology"]);

    const byReason = filterTypeTree(tree, { verdicts: new Set(), query: "networkpolicy" });
    expect(byReason.map((n) => n.item.type)).toEqual(["SysFirewallComponent"]);
  });

  it("combines verdict and text", () => {
    const out = filterTypeTree(tree, { verdicts: new Set<Verdict>(["MISSING"]), query: "tech" });
    expect(out.map((n) => n.item.type)).toEqual(["SysTechnology"]);
    expect(out[0].children.map((c) => c.item.type)).toEqual(["SysSearchTechnology"]);
  });
});

describe("groupEdges / verdictSegments", () => {
  const report = parseSystemMapReport(REPORT_FIXTURE)!;

  it("groups by relation in first-seen order with counts", () => {
    const groups = groupEdges(report.edges);
    expect(groups.map((g) => g.edgeType)).toEqual(["AUTHENTICATES_WITH", "CALLS", "CHILD_OF", "USES_TECHNOLOGY"]);
    expect(groups[2].edges).toHaveLength(3);
    expect(groups[2].counts.MISSING).toBe(3);
  });

  it("applies the filter and drops empty groups", () => {
    const groups = groupEdges(report.edges, { verdicts: new Set<Verdict>(["MATCH"]), query: "" });
    expect(groups.map((g) => g.edgeType)).toEqual(["CALLS"]);
    const byText = groupEdges(report.edges, { verdicts: new Set(), query: "webapplication" });
    expect(byText.map((g) => g.edgeType)).toEqual(["CHILD_OF"]);
    expect(byText[0].edges).toHaveLength(1);
  });

  it("builds segments in fixed verdict order without zeros", () => {
    const segments = verdictSegments({ MATCH: 1, PARTIAL: 0, MISSING: 3, UNKNOWN: 0, CONFLICT: 0 });
    expect(segments.map((s) => s.verdict)).toEqual(["MATCH", "MISSING"]);
    expect(segments[1].share).toBeCloseTo(0.75);
    expect(verdictSegments({ MATCH: 0, PARTIAL: 0, MISSING: 0, UNKNOWN: 0, CONFLICT: 0 })).toEqual([]);
  });
});
