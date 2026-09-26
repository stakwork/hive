/**
 * Unit tests for `SystemMapReport/graph-model.ts` (feeds the shared d3
 * `GraphVisualization`).
 *
 * Coverage:
 *   - one node per type, coloured by verdict label; the filter removes
 *     misses but keeps a match's ancestors;
 *   - CHILD_OF edges become parent→child hierarchy edges; edges to unknown
 *     types are skipped;
 *   - MISSING relation edges are hidden and counted unless requested;
 *   - the edge label carries relation + verdict and styles decode from it.
 */

import { describe, it, expect } from "vitest";
import { parseSystemMapReport, type Verdict } from "@/components/system-map/SystemMapReport/model";
import {
  buildGraphElements,
  decodeEdgeLabel,
  edgeStyleForLabel,
  encodeEdgeLabel,
  VERDICT_COLOR_MAP,
  VERDICT_HEX,
} from "@/components/system-map/SystemMapReport/graph-model";
import { REPORT_FIXTURE } from "./fixture";

const report = parseSystemMapReport(REPORT_FIXTURE)!;
const NO_FILTER = { verdicts: new Set<Verdict>(), query: "" };

describe("buildGraphElements", () => {
  it("makes one node per type, typed by verdict label, and hides missing relations by default", () => {
    const out = buildGraphElements(report, { filter: NO_FILTER, showMissingRelations: false });
    expect(out.nodes).toHaveLength(8);
    const web = out.nodes.find((n) => n.id === "SysWebApplication")!;
    expect(web.name).toBe("WebApplication");
    expect(web.type).toBe("Match");
    expect(VERDICT_COLOR_MAP[web.type]).toBe(VERDICT_HEX.MATCH);
    // 3 CHILD_OF + CALLS (MATCH). USES_TECHNOLOGY (MISSING) hidden;
    // AUTHENTICATES_WITH points at SysResource, which the fixture does not declare.
    expect(out.edges.filter((e) => e.edgeType === "CHILD_OF")).toHaveLength(3);
    expect(out.edges.filter((e) => e.edgeType !== "CHILD_OF").map((e) => e.edgeType)).toEqual(["CALLS"]);
    expect(out.hiddenMissingRelations).toBe(1);
  });

  it("draws hierarchy edges parent→child", () => {
    const out = buildGraphElements(report, { filter: NO_FILTER, showMissingRelations: false });
    const web = out.edges.find((e) => e.target === "SysWebApplication")!;
    expect(web.source).toBe("SysApplicationComponent");
    expect(web.label).toBe(encodeEdgeLabel("CHILD_OF", "MISSING"));
  });

  it("includes missing relations on request", () => {
    const out = buildGraphElements(report, { filter: NO_FILTER, showMissingRelations: true });
    expect(out.edges.filter((e) => e.edgeType !== "CHILD_OF").map((e) => e.edgeType).sort()).toEqual(["CALLS", "USES_TECHNOLOGY"]);
    expect(out.hiddenMissingRelations).toBe(0);
  });

  it("removes what the filter misses but keeps a match's ancestors", () => {
    const out = buildGraphElements(report, {
      filter: { verdicts: new Set<Verdict>(["MATCH"]), query: "" },
      showMissingRelations: true,
    });
    expect(out.nodes.map((n) => n.id).sort()).toEqual([
      "SysApplicationComponent",
      "SysCacheTechnology",
      "SysComponent",
      "SysTechnology",
      "SysWebApplication",
    ]);
    // The MISSING relation is filtered out; the MATCH one stays.
    expect(out.edges.filter((e) => e.edgeType !== "CHILD_OF").map((e) => e.edgeType)).toEqual(["CALLS"]);
    // Hierarchy edges among kept nodes stay.
    expect(out.edges.filter((e) => e.edgeType === "CHILD_OF")).toHaveLength(3);
  });

  it("skips edges whose endpoints are not in the report", () => {
    const partial = parseSystemMapReport({
      nodeTypes: [{ type: "SysA", parent: "Thing", verdict: "MATCH" }],
      edges: [
        { edge_type: "CALLS", source_type: "SysA", target_type: "SysGhost", verdict: "MATCH" },
        { edge_type: "CHILD_OF", source_type: "SysGhost", target_type: "SysA", verdict: "MISSING" },
      ],
    })!;
    expect(buildGraphElements(partial, { filter: NO_FILTER, showMissingRelations: true }).edges).toEqual([]);
  });
});

describe("edge labels and styles", () => {
  it("round-trips relation and verdict through the label", () => {
    expect(decodeEdgeLabel(encodeEdgeLabel("USES_TECHNOLOGY", "PARTIAL"))).toEqual({ edgeType: "USES_TECHNOLOGY", verdict: "PARTIAL" });
    expect(decodeEdgeLabel("CALLS")).toEqual({ edgeType: "CALLS", verdict: "MISSING" });
  });

  it("styles hierarchy grey and dashed, relations in their verdict colour", () => {
    expect(edgeStyleForLabel(encodeEdgeLabel("CHILD_OF", "MISSING"))).toEqual({
      stroke: VERDICT_HEX.MISSING,
      strokeWidth: 1,
      strokeDasharray: "4 3",
    });
    expect(edgeStyleForLabel(encodeEdgeLabel("CHILD_OF", "MATCH")).strokeDasharray).toBeUndefined();
    expect(edgeStyleForLabel(encodeEdgeLabel("CALLS", "MATCH"))).toEqual({ stroke: VERDICT_HEX.MATCH, strokeWidth: 2.5, strokeDasharray: undefined });
    expect(edgeStyleForLabel(encodeEdgeLabel("CALLS", "MISSING")).strokeDasharray).toBe("4 3");
  });
});
