/**
 * Unit tests for timeline-layout.ts — buildTimelineLayout
 *
 * Covers:
 *   - empty subgraph → empty columns
 *   - no EvalSet → empty columns
 *   - baseline-only (no ProposedFix) → 1 column
 *   - single-root fix chain → correct column count + BFS order
 *   - multiple HAS_PROPOSED_FIX roots → sorted by date_added_to_graph, then BFS
 *   - PRODUCED_BY first-valid-wins (empty output skipped, valid output selected)
 *   - score delta computation via normalizeOutput (not raw properties)
 *   - null scorePct propagates (no delta when no score)
 *   - partial flag forwarded
 *   - evalSetNode returned correctly
 *
 * Fixture data from recursion-fixture.ts exercises:
 *   - eval_status contract
 *   - multi-edge PRODUCED_BY resolution (FIX_MULTI_EDGE_ID)
 */

import { describe, it, expect } from "vitest";
import { buildTimelineLayout } from "@/lib/harvey-lab/timeline-layout";
import type { SubgraphNode, SubgraphEdge } from "@/lib/harvey-lab/hill-climb-series";
import {
  buildRecursionNodes,
  buildRecursionEdges,
  RECURSION_NODE_IDS,
} from "@/app/api/mock/jarvis/graph/recursion-fixture";

// ── Inline helpers ────────────────────────────────────────────────────────────

let _seq = 0;
const uid = (p = "n") => `${p}-${++_seq}`;

function evalSetNode(ref_id: string, ts = "1700000000"): SubgraphNode {
  return { ref_id, node_type: "EvalSet", date_added_to_graph: ts, properties: { name: "Test EvalSet" } };
}
function triggerNode(ref_id: string, ts = "1700001000"): SubgraphNode {
  return { ref_id, node_type: "EvalTrigger", date_added_to_graph: ts, properties: {} };
}
function outputNode(ref_id: string, n_passed: number, n_total: number, ts?: string): SubgraphNode {
  return {
    ref_id,
    node_type: "EvalTriggerOutput",
    date_added_to_graph: ts ?? "1700002000",
    properties: { n_passed, n_total, result: "pass", score: n_passed / n_total },
  };
}
function fixNode(ref_id: string, ts = "1700003000"): SubgraphNode {
  return { ref_id, node_type: "ProposedFix", date_added_to_graph: ts, properties: { eval_status: "accepted" } };
}
function edge(source: string, target: string, edge_type: string): SubgraphEdge {
  return { source, target, edge_type };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("buildTimelineLayout", () => {
  it("returns empty columns for an empty subgraph", () => {
    const result = buildTimelineLayout([], []);
    expect(result.columns).toHaveLength(0);
    expect(result.evalSetNode).toBeNull();
    expect(result.partial).toBe(false);
  });

  it("returns empty columns when no EvalSet node exists", () => {
    const es = uid("es");
    const tr = uid("tr");
    const result = buildTimelineLayout(
      [triggerNode(tr)],
      [edge(es, tr, "HAS_BASELINE_TRIGGER")],
    );
    expect(result.columns).toHaveLength(0);
  });

  it("returns empty columns when no HAS_BASELINE_TRIGGER edge exists", () => {
    const es = uid("es");
    const result = buildTimelineLayout([evalSetNode(es)], []);
    expect(result.columns).toHaveLength(0);
    expect(result.evalSetNode?.ref_id).toBe(es);
  });

  it("returns 1 column for a baseline-only subgraph (no ProposedFix)", () => {
    const es = uid("es");
    const tr = uid("tr");
    const out = uid("out");
    const nodes: SubgraphNode[] = [evalSetNode(es), triggerNode(tr), outputNode(out, 30, 40)];
    const edges: SubgraphEdge[] = [
      edge(es, tr, "HAS_BASELINE_TRIGGER"),
      edge(tr, out, "HAS_OUTPUT"),
    ];
    const result = buildTimelineLayout(nodes, edges);
    expect(result.columns).toHaveLength(1);
    expect(result.columns[0].runIndex).toBe(0);
    expect(result.columns[0].trigger?.ref_id).toBe(tr);
    expect(result.columns[0].output?.ref_id).toBe(out);
    expect(result.columns[0].proposedFix).toBeNull();
    expect(result.columns[0].scoreDelta).toBeNull();
    expect(result.columns[0].scorePct).toBeCloseTo(30 / 40);
  });

  it("returns correct column count for a single ProposedFix chain", () => {
    const es = uid("es");
    const tr = uid("tr");
    const out0 = uid("out0");
    const fix1 = uid("fix1");
    const out1 = uid("out1");
    const fix2 = uid("fix2");
    const out2 = uid("out2");

    const nodes: SubgraphNode[] = [
      evalSetNode(es),
      triggerNode(tr),
      outputNode(out0, 50, 100),
      fixNode(fix1, "1700003001"),
      outputNode(out1, 60, 100),
      fixNode(fix2, "1700003002"),
      outputNode(out2, 70, 100),
    ];
    const edges: SubgraphEdge[] = [
      edge(es, tr, "HAS_BASELINE_TRIGGER"),
      edge(tr, out0, "HAS_OUTPUT"),
      edge(tr, fix1, "HAS_PROPOSED_FIX"),
      edge(fix1, out1, "PRODUCED_BY"),
      edge(fix2, fix1, "DERIVED_FROM"),
      edge(fix2, out2, "PRODUCED_BY"),
    ];

    const result = buildTimelineLayout(nodes, edges);
    expect(result.columns).toHaveLength(3); // baseline + fix1 + fix2
    expect(result.columns[0].trigger?.ref_id).toBe(tr);
    expect(result.columns[0].proposedFix).toBeNull();
    expect(result.columns[1].proposedFix?.ref_id).toBe(fix1);
    expect(result.columns[2].proposedFix?.ref_id).toBe(fix2);
  });

  it("computes scorePct correctly via normalizeOutput (not raw properties)", () => {
    const es = uid("es");
    const tr = uid("tr");
    const out0 = uid("out");

    // Use judge_notes only (legacy path) — normalizeOutput handles both paths
    const legacyOutput: SubgraphNode = {
      ref_id: out0,
      node_type: "EvalTriggerOutput",
      date_added_to_graph: "1700002000",
      properties: {
        result: "partial",
        score: 0,
        judge_notes: "36/60 criteria passed (baseline run)",
        // no n_passed / n_total properties — exercises the judge_notes parse path
      },
    };

    const nodes: SubgraphNode[] = [evalSetNode(es), triggerNode(tr), legacyOutput];
    const edges: SubgraphEdge[] = [
      edge(es, tr, "HAS_BASELINE_TRIGGER"),
      edge(tr, out0, "HAS_OUTPUT"),
    ];

    const result = buildTimelineLayout(nodes, edges);
    expect(result.columns).toHaveLength(1);
    expect(result.columns[0].scorePct).toBeCloseTo(36 / 60);
  });

  it("computes scoreDelta correctly vs the previous column", () => {
    const es = uid("es");
    const tr = uid("tr");
    const out0 = uid("out0");
    const fix1 = uid("fix1");
    const out1 = uid("out1");
    const fix2 = uid("fix2");
    const out2 = uid("out2");

    const nodes: SubgraphNode[] = [
      evalSetNode(es),
      triggerNode(tr),
      outputNode(out0, 50, 100),  // 50%
      fixNode(fix1, "1700003001"),
      outputNode(out1, 70, 100),  // 70% → delta +0.20
      fixNode(fix2, "1700003002"),
      outputNode(out2, 60, 100),  // 60% → delta -0.10 vs previous (70%)
    ];
    const edges: SubgraphEdge[] = [
      edge(es, tr, "HAS_BASELINE_TRIGGER"),
      edge(tr, out0, "HAS_OUTPUT"),
      edge(tr, fix1, "HAS_PROPOSED_FIX"),
      edge(fix1, out1, "PRODUCED_BY"),
      edge(fix2, fix1, "DERIVED_FROM"),
      edge(fix2, out2, "PRODUCED_BY"),
    ];

    const result = buildTimelineLayout(nodes, edges);
    expect(result.columns[0].scoreDelta).toBeNull(); // column 0 has no delta
    expect(result.columns[1].scoreDelta).toBeCloseTo(0.20, 5);
    expect(result.columns[2].scoreDelta).toBeCloseTo(-0.10, 5);
  });

  it("null scorePct propagates as null delta for that column", () => {
    const es = uid("es");
    const tr = uid("tr");
    const out0 = uid("out0");
    const fix1 = uid("fix1");
    // No PRODUCED_BY edge → output stays null → scorePct null → delta null

    const nodes: SubgraphNode[] = [
      evalSetNode(es),
      triggerNode(tr),
      outputNode(out0, 50, 100),
      fixNode(fix1, "1700003001"),
    ];
    const edges: SubgraphEdge[] = [
      edge(es, tr, "HAS_BASELINE_TRIGGER"),
      edge(tr, out0, "HAS_OUTPUT"),
      edge(tr, fix1, "HAS_PROPOSED_FIX"),
      // deliberately NO PRODUCED_BY edge
    ];

    const result = buildTimelineLayout(nodes, edges);
    expect(result.columns).toHaveLength(2);
    expect(result.columns[1].scorePct).toBeNull();
    expect(result.columns[1].scoreDelta).toBeNull();
  });

  it("PRODUCED_BY first-valid-wins: picks first edge with non-null n_passed/n_total", () => {
    const es = uid("es");
    const tr = uid("tr");
    const out0 = uid("out0");
    const fix1 = uid("fix1");
    // Two PRODUCED_BY edges: first has empty properties, second is valid
    const emptyOut: SubgraphNode = {
      ref_id: uid("empty"),
      node_type: "EvalTriggerOutput",
      date_added_to_graph: "1700002001",
      properties: { result: "", score: 0 }, // no n_passed / n_total
    };
    const validOut: SubgraphNode = outputNode(uid("valid"), 32, 33);

    const nodes: SubgraphNode[] = [
      evalSetNode(es),
      triggerNode(tr),
      outputNode(out0, 50, 100),
      fixNode(fix1, "1700003001"),
      emptyOut,
      validOut,
    ];
    const edges: SubgraphEdge[] = [
      edge(es, tr, "HAS_BASELINE_TRIGGER"),
      edge(tr, out0, "HAS_OUTPUT"),
      edge(tr, fix1, "HAS_PROPOSED_FIX"),
      edge(fix1, emptyOut.ref_id, "PRODUCED_BY"), // comes first in array
      edge(fix1, validOut.ref_id, "PRODUCED_BY"), // valid — must be picked
    ];

    const result = buildTimelineLayout(nodes, edges);
    expect(result.columns).toHaveLength(2);
    expect(result.columns[1].output?.ref_id).toBe(validOut.ref_id);
    expect(result.columns[1].scorePct).toBeCloseTo(32 / 33);
  });

  it("multiple HAS_PROPOSED_FIX roots are sorted by date_added_to_graph before BFS", () => {
    const es = uid("es");
    const tr = uid("tr");
    const out0 = uid("out0");
    // Two root fixes: fix-later was added AFTER fix-earlier
    const fixLater = fixNode(uid("fix-later"), "1700005000");
    const fixEarlier = fixNode(uid("fix-earlier"), "1700004000");
    const outLater = outputNode(uid("out-later"), 65, 100);
    const outEarlier = outputNode(uid("out-earlier"), 55, 100);

    const nodes: SubgraphNode[] = [
      evalSetNode(es),
      triggerNode(tr),
      outputNode(out0, 50, 100),
      fixLater,
      fixEarlier,
      outLater,
      outEarlier,
    ];
    const edges: SubgraphEdge[] = [
      edge(es, tr, "HAS_BASELINE_TRIGGER"),
      edge(tr, out0, "HAS_OUTPUT"),
      edge(tr, fixLater.ref_id, "HAS_PROPOSED_FIX"),  // listed first in edges
      edge(tr, fixEarlier.ref_id, "HAS_PROPOSED_FIX"),
      edge(fixLater.ref_id, outLater.ref_id, "PRODUCED_BY"),
      edge(fixEarlier.ref_id, outEarlier.ref_id, "PRODUCED_BY"),
    ];

    const result = buildTimelineLayout(nodes, edges);
    // Column 1 = fixEarlier (older date), column 2 = fixLater (newer date)
    expect(result.columns).toHaveLength(3);
    expect(result.columns[1].proposedFix?.ref_id).toBe(fixEarlier.ref_id);
    expect(result.columns[2].proposedFix?.ref_id).toBe(fixLater.ref_id);
  });

  it("partial flag is forwarded to the output", () => {
    const result = buildTimelineLayout([], [], true);
    expect(result.partial).toBe(true);
  });

  it("evalSetNode is returned in the layout", () => {
    const es = uid("es");
    const tr = uid("tr");
    const nodes: SubgraphNode[] = [evalSetNode(es), triggerNode(tr)];
    const edges: SubgraphEdge[] = [edge(es, tr, "HAS_BASELINE_TRIGGER")];
    const result = buildTimelineLayout(nodes, edges);
    expect(result.evalSetNode?.ref_id).toBe(es);
  });

  it("case-insensitive node_type matching (EvalSet casing variant)", () => {
    const es = uid("es");
    const tr = uid("tr");
    const out = uid("out");
    // Use casing variant to exercise isNodeType
    const nodes: SubgraphNode[] = [
      { ref_id: es, node_type: "Evalset", date_added_to_graph: "1700000000", properties: {} },
      triggerNode(tr),
      outputNode(out, 40, 50),
    ];
    const edges: SubgraphEdge[] = [
      edge(es, tr, "HAS_BASELINE_TRIGGER"),
      edge(tr, out, "HAS_OUTPUT"),
    ];
    const result = buildTimelineLayout(nodes, edges);
    expect(result.columns).toHaveLength(1);
    expect(result.evalSetNode?.ref_id).toBe(es);
  });
});

// ── Fixture-based tests ───────────────────────────────────────────────────────

describe("buildTimelineLayout — recursion fixture", () => {
  it("produces the correct number of columns from the fixture subgraph", () => {
    const nodes = buildRecursionNodes() as SubgraphNode[];
    const edges = buildRecursionEdges() as SubgraphEdge[];
    const result = buildTimelineLayout(nodes, edges);

    // Baseline (1) + FIX_ROOT (1) + FIX_DERIVED (1) + FIX_MULTI_EDGE (1)
    //   + FIX_REJECTED_SCORED (1) + FIX_REJECTED_UNSCORED (1)
    // = 6 columns total
    expect(result.columns).toHaveLength(6);
    expect(result.columns[0].trigger?.ref_id).toBeTruthy();
    expect(result.columns[0].proposedFix).toBeNull();
  });

  it("columns 1+ have proposedFix set and no trigger", () => {
    const nodes = buildRecursionNodes() as SubgraphNode[];
    const edges = buildRecursionEdges() as SubgraphEdge[];
    const result = buildTimelineLayout(nodes, edges);

    for (let i = 1; i < result.columns.length; i++) {
      expect(result.columns[i].proposedFix).not.toBeNull();
      expect(result.columns[i].trigger).toBeNull();
    }
  });

  it("multi-edge PRODUCED_BY: picks valid output (n_passed=32, n_total=33) over empty one", () => {
    const nodes = buildRecursionNodes() as SubgraphNode[];
    const edges = buildRecursionEdges() as SubgraphEdge[];
    const result = buildTimelineLayout(nodes, edges);

    // Find the column for FIX_MULTI_EDGE
    const multiEdgeCol = result.columns.find(
      (c) => c.proposedFix?.ref_id === RECURSION_NODE_IDS.FIX_MULTI_EDGE_ID,
    );
    expect(multiEdgeCol).toBeDefined();
    expect(multiEdgeCol!.output?.ref_id).toBe(RECURSION_NODE_IDS.FIX_MULTI_EDGE_VALID_OUTPUT_ID);
    expect(multiEdgeCol!.scorePct).toBeCloseTo(32 / 33);
  });

  it("evalSetNode has the EvalSet ref_id", () => {
    const nodes = buildRecursionNodes() as SubgraphNode[];
    const edges = buildRecursionEdges() as SubgraphEdge[];
    const result = buildTimelineLayout(nodes, edges);

    expect(result.evalSetNode?.ref_id).toBe(RECURSION_NODE_IDS.EVAL_SET_ID);
  });

  it("score delta is null on column 0", () => {
    const nodes = buildRecursionNodes() as SubgraphNode[];
    const edges = buildRecursionEdges() as SubgraphEdge[];
    const result = buildTimelineLayout(nodes, edges);
    expect(result.columns[0].scoreDelta).toBeNull();
  });

  it("score delta is a number on subsequent columns that have scores", () => {
    const nodes = buildRecursionNodes() as SubgraphNode[];
    const edges = buildRecursionEdges() as SubgraphEdge[];
    const result = buildTimelineLayout(nodes, edges);

    // Column 1 (FIX_ROOT: n_passed=54/74) has a non-null delta vs baseline 50/74
    const col1 = result.columns[1];
    if (col1.scorePct !== null) {
      expect(typeof col1.scoreDelta).toBe("number");
      expect(col1.scoreDelta).toBeCloseTo(54 / 74 - 50 / 74, 5);
    }
  });
});
