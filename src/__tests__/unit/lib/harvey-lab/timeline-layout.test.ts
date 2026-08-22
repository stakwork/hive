/**
 * Unit tests for buildTimelineLayout — the pure builder that derives the
 * 2D timeline column layout from an EvalSet subgraph.
 *
 * Fixture: buildRecursionNodes() / buildRecursionEdges() from recursion-fixture.ts
 *
 * Contracts under test:
 *   - Column 0 = baseline EvalTrigger; columns 1…N = ProposedFix BFS order
 *   - BFS multi-root sorting: roots ascending by date_added_to_graph
 *   - PRODUCED_BY first-valid-wins output selection (FIX_MULTI_EDGE_ID)
 *   - Score computation via normalizeOutput (not direct property reads)
 *   - scoreDelta = current − previous (null for column 0)
 *   - Null scorePct propagates as null
 *   - evalSetNode is present in result
 *   - partial flag is threaded through
 */

// @vitest-environment node

import { describe, it, expect } from "vitest";
import { buildTimelineLayout } from "@/lib/harvey-lab/timeline-layout";
import type { SubgraphNode, SubgraphEdge } from "@/lib/harvey-lab/hill-climb-series";
import {
  buildRecursionNodes,
  buildRecursionEdges,
  RECURSION_NODE_IDS,
} from "@/app/api/mock/jarvis/graph/recursion-fixture";

// The fixture returns JarvisNode[], which is structurally compatible with SubgraphNode[].
// We cast to satisfy TypeScript without widening the types.
function nodes(): SubgraphNode[] {
  return buildRecursionNodes() as unknown as SubgraphNode[];
}
function edges(): SubgraphEdge[] {
  return buildRecursionEdges() as unknown as SubgraphEdge[];
}

const {
  EVAL_SET_ID,
  BASELINE_TRIGGER_ID,
  BASELINE_OUTPUT_ID,
  FIX_ROOT_ID,
  FIX_ROOT_RERUN_OUTPUT_ID,
  FIX_DERIVED_ID,
  FIX_DERIVED_RERUN_OUTPUT_ID,
  FIX_MULTI_EDGE_ID,
  FIX_MULTI_EDGE_VALID_OUTPUT_ID,
  FIX_REJECTED_SCORED_ID,
  FIX_REJECTED_UNSCORED_ID,
} = RECURSION_NODE_IDS;

// ─── Basic structure ──────────────────────────────────────────────────────────

describe("buildTimelineLayout — basic structure", () => {
  it("returns empty columns when no nodes provided", () => {
    const result = buildTimelineLayout([], []);
    expect(result.columns).toHaveLength(0);
    expect(result.evalSetNode).toBeNull();
  });

  it("returns empty columns when no EvalSet found", () => {
    const noEvalSet = nodes().filter((n) => n.node_type !== "Evalset");
    const result = buildTimelineLayout(noEvalSet, edges());
    expect(result.columns).toHaveLength(0);
    expect(result.evalSetNode).toBeNull();
  });

  it("resolves the evalSetNode from the fixture", () => {
    const result = buildTimelineLayout(nodes(), edges());
    expect(result.evalSetNode).not.toBeNull();
    expect(result.evalSetNode?.ref_id).toBe(EVAL_SET_ID);
  });

  it("threads partial flag through to the result", () => {
    const resultFalse = buildTimelineLayout(nodes(), edges(), false);
    const resultTrue = buildTimelineLayout(nodes(), edges(), true);
    expect(resultFalse.partial).toBe(false);
    expect(resultTrue.partial).toBe(true);
  });

  it("returns baseline-only (column 0) when no HAS_PROPOSED_FIX edge exists", () => {
    // Strip all HAS_PROPOSED_FIX edges
    const filteredEdges = edges().filter((e) => e.edge_type !== "HAS_PROPOSED_FIX");
    const result = buildTimelineLayout(nodes(), filteredEdges);
    expect(result.columns).toHaveLength(1);
    expect(result.columns[0].runIndex).toBe(0);
    expect(result.columns[0].trigger?.ref_id).toBe(BASELINE_TRIGGER_ID);
    expect(result.columns[0].proposedFix).toBeNull();
  });
});

// ─── Column 0: Baseline ───────────────────────────────────────────────────────

describe("buildTimelineLayout — column 0 (baseline)", () => {
  it("column 0 has the baseline EvalTrigger and no ProposedFix", () => {
    const result = buildTimelineLayout(nodes(), edges());
    const col0 = result.columns[0];
    expect(col0.runIndex).toBe(0);
    expect(col0.trigger?.ref_id).toBe(BASELINE_TRIGGER_ID);
    expect(col0.proposedFix).toBeNull();
  });

  it("column 0 resolves the baseline EvalTriggerOutput via HAS_OUTPUT", () => {
    const result = buildTimelineLayout(nodes(), edges());
    const col0 = result.columns[0];
    expect(col0.output?.ref_id).toBe(BASELINE_OUTPUT_ID);
  });

  it("column 0 has scorePct derived from normalizeOutput (50/74 ≈ 0.676)", () => {
    const result = buildTimelineLayout(nodes(), edges());
    const col0 = result.columns[0];
    expect(col0.scorePct).not.toBeNull();
    expect(col0.scorePct!).toBeCloseTo(50 / 74, 5);
  });

  it("column 0 has scoreDelta = null (no predecessor)", () => {
    const result = buildTimelineLayout(nodes(), edges());
    expect(result.columns[0].scoreDelta).toBeNull();
  });
});

// ─── Column count and BFS ordering ───────────────────────────────────────────

describe("buildTimelineLayout — column count and BFS order", () => {
  it("produces one column per unique ProposedFix in the BFS chain + 1 for baseline", () => {
    const result = buildTimelineLayout(nodes(), edges());
    // Fixture BFS from FIX_ROOT_ID (baseline trigger's HAS_PROPOSED_FIX):
    //   col 1: FIX_ROOT
    //   col 2: FIX_DERIVED (DERIVED_FROM FIX_ROOT)
    //   col 3: FIX_MULTI_EDGE (DERIVED_FROM FIX_DERIVED)
    //   col 4: FIX_REJECTED_SCORED (DERIVED_FROM FIX_MULTI_EDGE)
    //   col 5: FIX_REJECTED_UNSCORED (DERIVED_FROM FIX_REJECTED_SCORED)
    // Total: 1 + 5 = 6 columns
    expect(result.columns).toHaveLength(6);
  });

  it("columns are 0-indexed and contiguous", () => {
    const result = buildTimelineLayout(nodes(), edges());
    result.columns.forEach((col, i) => {
      expect(col.runIndex).toBe(i);
    });
  });

  it("column 1 is the root ProposedFix (FIX_ROOT_ID)", () => {
    const result = buildTimelineLayout(nodes(), edges());
    expect(result.columns[1].proposedFix?.ref_id).toBe(FIX_ROOT_ID);
    expect(result.columns[1].trigger).toBeNull();
  });

  it("column 2 is the derived ProposedFix (FIX_DERIVED_ID)", () => {
    const result = buildTimelineLayout(nodes(), edges());
    expect(result.columns[2].proposedFix?.ref_id).toBe(FIX_DERIVED_ID);
  });

  it("column 3 is the multi-edge ProposedFix (FIX_MULTI_EDGE_ID)", () => {
    const result = buildTimelineLayout(nodes(), edges());
    expect(result.columns[3].proposedFix?.ref_id).toBe(FIX_MULTI_EDGE_ID);
  });

  it("column 4 is the rejected-scored ProposedFix", () => {
    const result = buildTimelineLayout(nodes(), edges());
    expect(result.columns[4].proposedFix?.ref_id).toBe(FIX_REJECTED_SCORED_ID);
  });

  it("column 5 is the rejected-unscored ProposedFix", () => {
    const result = buildTimelineLayout(nodes(), edges());
    expect(result.columns[5].proposedFix?.ref_id).toBe(FIX_REJECTED_UNSCORED_ID);
  });
});

// ─── Output pairing ───────────────────────────────────────────────────────────

describe("buildTimelineLayout — output pairing", () => {
  it("column 1 (root fix) resolves output via PRODUCED_BY", () => {
    const result = buildTimelineLayout(nodes(), edges());
    expect(result.columns[1].output?.ref_id).toBe(FIX_ROOT_RERUN_OUTPUT_ID);
  });

  it("column 2 (derived fix) resolves output via PRODUCED_BY", () => {
    const result = buildTimelineLayout(nodes(), edges());
    expect(result.columns[2].output?.ref_id).toBe(FIX_DERIVED_RERUN_OUTPUT_ID);
  });

  it("column 3 (multi-edge fix) picks first-valid-wins PRODUCED_BY output (skipping empty)", () => {
    // FIX_MULTI_EDGE_ID has two PRODUCED_BY edges:
    //   → FIX_MULTI_EDGE_EMPTY_OUTPUT_ID (no n_passed/n_total — skip)
    //   → FIX_MULTI_EDGE_VALID_OUTPUT_ID (n_passed=32, n_total=33 — pick)
    const result = buildTimelineLayout(nodes(), edges());
    expect(result.columns[3].output?.ref_id).toBe(FIX_MULTI_EDGE_VALID_OUTPUT_ID);
  });

  it("column 5 (rejected-unscored fix) has null output (no PRODUCED_BY edge)", () => {
    const result = buildTimelineLayout(nodes(), edges());
    // FIX_REJECTED_UNSCORED has no PRODUCED_BY edge and no after_score
    // resolveOutputNode returns null → output is null
    expect(result.columns[5].output).toBeNull();
  });
});

// ─── Score computation via normalizeOutput ────────────────────────────────────

describe("buildTimelineLayout — score computation", () => {
  it("uses normalizeOutput (not direct property reads) for score computation", () => {
    const result = buildTimelineLayout(nodes(), edges());
    // column 1: FIX_ROOT output has n_passed=54, n_total=74
    const col1 = result.columns[1];
    expect(col1.scorePct).not.toBeNull();
    expect(col1.scorePct!).toBeCloseTo(54 / 74, 5);
  });

  it("column 3 (multi-edge valid output) has scorePct = 32/33", () => {
    const result = buildTimelineLayout(nodes(), edges());
    expect(result.columns[3].scorePct).not.toBeNull();
    expect(result.columns[3].scorePct!).toBeCloseTo(32 / 33, 5);
  });

  it("propagates null scorePct when output node has no n_passed/n_total", () => {
    const result = buildTimelineLayout(nodes(), edges());
    // column 5 has no output node → scorePct is null
    expect(result.columns[5].scorePct).toBeNull();
  });

  it("returns null scorePct for a column with null output", () => {
    // column 5 (FIX_REJECTED_UNSCORED) has no output
    const result = buildTimelineLayout(nodes(), edges());
    expect(result.columns[5].output).toBeNull();
    expect(result.columns[5].scorePct).toBeNull();
  });
});

// ─── Score delta ──────────────────────────────────────────────────────────────

describe("buildTimelineLayout — scoreDelta", () => {
  it("scoreDelta for column 1 = col1.scorePct − col0.scorePct", () => {
    const result = buildTimelineLayout(nodes(), edges());
    const col0Pct = result.columns[0].scorePct!;
    const col1Pct = result.columns[1].scorePct!;
    expect(result.columns[1].scoreDelta).toBeCloseTo(col1Pct - col0Pct, 5);
  });

  it("scoreDelta for column 2 = col2.scorePct − col1.scorePct", () => {
    const result = buildTimelineLayout(nodes(), edges());
    const col1Pct = result.columns[1].scorePct!;
    const col2Pct = result.columns[2].scorePct!;
    expect(result.columns[2].scoreDelta).toBeCloseTo(col2Pct - col1Pct, 5);
  });

  it("scoreDelta is null when current scorePct is null", () => {
    const result = buildTimelineLayout(nodes(), edges());
    // column 5 has null scorePct → scoreDelta is null
    expect(result.columns[5].scoreDelta).toBeNull();
  });

  it("scoreDelta is null when previous scorePct is null", () => {
    // Build a custom subgraph where column 0 has no output (so prevScorePct stays null)
    // and column 1 has an output. We do this by removing the HAS_OUTPUT edge from baseline.
    const filteredEdges = edges().filter(
      (e) => !(e.edge_type === "HAS_OUTPUT" && e.source === BASELINE_TRIGGER_ID),
    );
    const result = buildTimelineLayout(nodes(), filteredEdges);
    // col 0 has null output → null scorePct → col 1 delta is null
    expect(result.columns[0].scorePct).toBeNull();
    expect(result.columns[1].scoreDelta).toBeNull();
  });
});

// ─── Multiple HAS_PROPOSED_FIX roots — BFS date sort ─────────────────────────

describe("buildTimelineLayout — multiple HAS_PROPOSED_FIX roots sorted by date", () => {
  /**
   * Build a minimal subgraph with TWO HAS_PROPOSED_FIX roots attached to the
   * baseline trigger. Root B has an earlier date_added_to_graph than root A.
   * BFS should visit B first (lower timestamp → earlier column).
   */
  function buildMultiRootFixture(): { ns: SubgraphNode[]; es: SubgraphEdge[] } {
    const ts = (offset: number) => String(1720000000 + offset);
    const ns: SubgraphNode[] = [
      { ref_id: "evalset", node_type: "EvalSet", date_added_to_graph: ts(0), properties: {} },
      { ref_id: "trigger", node_type: "EvalTrigger", date_added_to_graph: ts(0), properties: {} },
      {
        ref_id: "output-base",
        node_type: "EvalTriggerOutput",
        date_added_to_graph: ts(0),
        properties: { n_passed: 10, n_total: 20, attempt_number: 1, result: "partial", score: 0.5 },
      },
      // Root A: later timestamp
      {
        ref_id: "fix-root-a",
        node_type: "ProposedFix",
        date_added_to_graph: ts(2000),
        properties: { eval_status: "accepted" },
      },
      {
        ref_id: "output-a",
        node_type: "EvalTriggerOutput",
        date_added_to_graph: ts(2000),
        properties: { n_passed: 15, n_total: 20, attempt_number: 2, result: "partial", score: 0.75 },
      },
      // Root B: earlier timestamp (should appear first after sort)
      {
        ref_id: "fix-root-b",
        node_type: "ProposedFix",
        date_added_to_graph: ts(1000),
        properties: { eval_status: "accepted" },
      },
      {
        ref_id: "output-b",
        node_type: "EvalTriggerOutput",
        date_added_to_graph: ts(1000),
        properties: { n_passed: 12, n_total: 20, attempt_number: 2, result: "partial", score: 0.6 },
      },
    ];
    const es: SubgraphEdge[] = [
      { source: "evalset", target: "trigger", edge_type: "HAS_BASELINE_TRIGGER" },
      { source: "trigger", target: "output-base", edge_type: "HAS_OUTPUT" },
      // Two HAS_PROPOSED_FIX roots, intentionally listed A before B in edges
      { source: "trigger", target: "fix-root-a", edge_type: "HAS_PROPOSED_FIX" },
      { source: "trigger", target: "fix-root-b", edge_type: "HAS_PROPOSED_FIX" },
      { source: "fix-root-a", target: "output-a", edge_type: "PRODUCED_BY" },
      { source: "fix-root-b", target: "output-b", edge_type: "PRODUCED_BY" },
    ];
    return { ns, es };
  }

  it("visits the root with the earlier date_added_to_graph first (fix-root-b before fix-root-a)", () => {
    const { ns, es } = buildMultiRootFixture();
    const result = buildTimelineLayout(ns, es);
    // Columns: 0=baseline, 1=fix-root-b (ts 1000), 2=fix-root-a (ts 2000)
    expect(result.columns).toHaveLength(3);
    expect(result.columns[1].proposedFix?.ref_id).toBe("fix-root-b");
    expect(result.columns[2].proposedFix?.ref_id).toBe("fix-root-a");
  });

  it("assigns correct scorePct values for each root", () => {
    const { ns, es } = buildMultiRootFixture();
    const result = buildTimelineLayout(ns, es);
    expect(result.columns[1].scorePct).toBeCloseTo(12 / 20, 5); // fix-root-b: 12/20
    expect(result.columns[2].scorePct).toBeCloseTo(15 / 20, 5); // fix-root-a: 15/20
  });
});
