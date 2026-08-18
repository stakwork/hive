/**
 * Unit tests for buildEvalOutputSeries.
 *
 * The flat per-EvalTriggerOutput series that carries the chart when an eval set
 * has been re-run via concepts (no ProposedFix nodes anywhere).
 *
 * Covers:
 *  - triggers collected from the EvalSet AND from EvalSet -HAS_REQUIREMENT->
 *    EvalRequirement -HAS_TRIGGER->
 *  - a bare HAS_TRIGGER from an unrelated source is ignored
 *  - the same trigger reachable by two paths is counted once
 *  - outputs with no n_passed/n_total are dropped
 *  - the `judge_notes: "0/0 criteria passed"` shape is dropped, not charted
 *  - date ordering, id-suffix fallback, and the ref_id tie-break producing
 *    identical output for a shuffled input (the non-determinism guard)
 *  - baseline pinned to index 0 even when its timestamp is the latest
 *  - labels r1…rN with no `base` when there is no baseline trigger
 *  - mixed n_total normalized to the max with numerators clamped
 *  - the line follows a decreasing score (no monotonic best-so-far)
 *  - zero ProposedFix still yields N points
 */

// @vitest-environment node

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { buildEvalOutputSeries } from "@/lib/harvey-lab/eval-output-series";
import type { Subgraph, SubgraphEdge, SubgraphNode } from "@/lib/harvey-lab/hill-climb-series";
import {
  buildConceptOnlyEdges,
  buildConceptOnlyNodes,
  CONCEPT_ONLY_BASELINE_OUTPUT_ID,
  CONCEPT_ONLY_DEGENERATE_OUTPUT_ID,
} from "@/app/api/mock/jarvis/graph/recursion-fixture";

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// `sortAttemptsChronologically` console.warns on its id-suffix fallback path.
let warnSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  warnSpy.mockRestore();
});

// ── Builders ──────────────────────────────────────────────────────────────────

const EVAL_SET = "evalset-1";

function evalSetNode(ref_id = EVAL_SET): SubgraphNode {
  return { ref_id, node_type: "EvalSet", properties: {} };
}

function triggerNode(ref_id: string, node_type = "EvalTrigger"): SubgraphNode {
  return {
    ref_id,
    node_type,
    properties: { agent: "a", start_point: "s", end_point: "e" },
  };
}

function outputNode(
  ref_id: string,
  props: Record<string, unknown>,
  date?: string,
): SubgraphNode {
  return {
    ref_id,
    node_type: "EvalTriggerOutput",
    ...(date != null ? { date_added_to_graph: date } : {}),
    properties: { result: "partial", score: 0, ...props },
  };
}

function edge(source: string, target: string, edge_type: string): SubgraphEdge {
  return { source, target, edge_type };
}

/**
 * One EvalSet-hosted trigger + its single output, in one call.
 * `edgeType` picks the host edge (HAS_BASELINE_TRIGGER vs HAS_TRIGGER).
 */
function evalSetRun(
  name: string,
  edgeType: string,
  outProps: Record<string, unknown>,
  date?: string,
): { nodes: SubgraphNode[]; edges: SubgraphEdge[] } {
  const t = `trigger-${name}`;
  const o = `output-${name}`;
  return {
    nodes: [triggerNode(t), outputNode(o, outProps, date)],
    edges: [edge(EVAL_SET, t, edgeType), edge(t, o, "HAS_OUTPUT")],
  };
}

function merge(...parts: Array<{ nodes: SubgraphNode[]; edges: SubgraphEdge[] }>): Subgraph {
  return {
    nodes: [evalSetNode(), ...parts.flatMap((p) => p.nodes)],
    edges: parts.flatMap((p) => p.edges),
  };
}

const scoresOf = (points: Array<{ actualPassed?: number | null }>) =>
  points.map((p) => p.actualPassed);
const labelsOf = (points: Array<{ label?: string }>) => points.map((p) => p.label);

// ── Trigger collection ────────────────────────────────────────────────────────

describe("buildEvalOutputSeries — trigger collection", () => {
  it("collects triggers hosted directly on the EvalSet, both edge types", () => {
    const sg = merge(
      evalSetRun("base", "HAS_BASELINE_TRIGGER", { n_passed: 10, n_total: 20 }, "100"),
      evalSetRun("rerun", "HAS_TRIGGER", { n_passed: 14, n_total: 20 }, "200"),
    );

    const { points } = buildEvalOutputSeries(sg);

    expect(points).toHaveLength(2);
    expect(labelsOf(points)).toEqual(["base", "r1"]);
    expect(scoresOf(points)).toEqual([10, 14]);
  });

  it("collects requirement-hosted triggers via EvalSet -HAS_REQUIREMENT-> EvalRequirement -HAS_TRIGGER->", () => {
    const sg: Subgraph = {
      nodes: [
        evalSetNode(),
        { ref_id: "req-1", node_type: "EvalRequirement", properties: {} },
        triggerNode("trigger-req"),
        outputNode("output-req", { n_passed: 33, n_total: 40 }, "300"),
      ],
      edges: [
        edge(EVAL_SET, "req-1", "HAS_REQUIREMENT"),
        edge("req-1", "trigger-req", "HAS_TRIGGER"),
        edge("trigger-req", "output-req", "HAS_OUTPUT"),
      ],
    };

    const { points } = buildEvalOutputSeries(sg);

    expect(points).toHaveLength(1);
    expect(points[0].actualPassed).toBe(33);
    // No baseline trigger exists → labels start at r1, no "base"
    expect(points[0].label).toBe("r1");
    expect(points[0].isBaseline).toBe(false);
  });

  it("ignores a HAS_TRIGGER whose source is neither the EvalSet nor an owned requirement", () => {
    const sg: Subgraph = {
      nodes: [
        evalSetNode(),
        // An EvalRequirement that this EvalSet does NOT own
        { ref_id: "req-foreign", node_type: "EvalRequirement", properties: {} },
        triggerNode("trigger-foreign"),
        outputNode("output-foreign", { n_passed: 99, n_total: 100 }, "400"),
        ...evalSetRun("base", "HAS_BASELINE_TRIGGER", { n_passed: 10, n_total: 20 }, "100").nodes,
      ],
      edges: [
        // No HAS_REQUIREMENT edge from the EvalSet to req-foreign
        edge("req-foreign", "trigger-foreign", "HAS_TRIGGER"),
        edge("trigger-foreign", "output-foreign", "HAS_OUTPUT"),
        ...evalSetRun("base", "HAS_BASELINE_TRIGGER", { n_passed: 10, n_total: 20 }, "100").edges,
      ],
    };

    const { points } = buildEvalOutputSeries(sg);

    expect(points).toHaveLength(1);
    expect(points[0].actualPassed).toBe(10);
  });

  it("counts a trigger reachable by both hosts exactly once, keeping baseline sticky", () => {
    const sg: Subgraph = {
      nodes: [
        evalSetNode(),
        { ref_id: "req-1", node_type: "EvalRequirement", properties: {} },
        triggerNode("trigger-shared"),
        outputNode("output-shared", { n_passed: 12, n_total: 20 }, "100"),
      ],
      edges: [
        edge(EVAL_SET, "trigger-shared", "HAS_BASELINE_TRIGGER"),
        edge(EVAL_SET, "req-1", "HAS_REQUIREMENT"),
        edge("req-1", "trigger-shared", "HAS_TRIGGER"),
        edge("trigger-shared", "output-shared", "HAS_OUTPUT"),
      ],
    };

    const { points, dropped } = buildEvalOutputSeries(sg);

    expect(points).toHaveLength(1);
    expect(points[0].isBaseline).toBe(true);
    expect(points[0].label).toBe("base");
    // Deduped at the trigger level, so the output is never even revisited.
    expect(dropped).toHaveLength(0);
  });

  it("returns an empty series when there is no EvalSet node", () => {
    const result = buildEvalOutputSeries({ nodes: [triggerNode("t")], edges: [] });
    expect(result.points).toEqual([]);
    expect(result.denominator).toBe(0);
  });
});

// ── Output filtering ──────────────────────────────────────────────────────────

describe("buildEvalOutputSeries — output filtering", () => {
  it("drops outputs with no resolvable n_passed/n_total", () => {
    const sg = merge(
      evalSetRun("base", "HAS_BASELINE_TRIGGER", { n_passed: 10, n_total: 20 }, "100"),
      evalSetRun("empty", "HAS_TRIGGER", {}, "200"),
    );

    const { points, dropped } = buildEvalOutputSeries(sg);

    expect(points).toHaveLength(1);
    expect(dropped).toEqual([{ ref_id: "output-empty", reason: "no-counts" }]);
  });

  it('drops the `judge_notes: "0/0 criteria passed"` shape rather than charting a 0/0 point', () => {
    // This is exactly what stakwork-run.ts writes: no n_passed/n_total properties
    // at all, and judge_notes the parser happily reads as 0/0. Charting it would
    // hand HillClimbChart a y-domain of [0, 0].
    const sg = merge(
      evalSetRun("base", "HAS_BASELINE_TRIGGER", { n_passed: 10, n_total: 20 }, "100"),
      evalSetRun(
        "degenerate",
        "HAS_TRIGGER",
        { judge_notes: "0/0 criteria passed. Judge: unknown" },
        "200",
      ),
    );

    const { points, dropped, denominator } = buildEvalOutputSeries(sg);

    expect(points).toHaveLength(1);
    expect(denominator).toBe(20);
    expect(dropped).toEqual([{ ref_id: "output-degenerate", reason: "zero-total" }]);
  });

  it("drops a duplicate output reachable from two triggers", () => {
    const sg: Subgraph = {
      nodes: [
        evalSetNode(),
        triggerNode("trigger-a"),
        triggerNode("trigger-b"),
        outputNode("output-shared", { n_passed: 10, n_total: 20 }, "100"),
      ],
      edges: [
        edge(EVAL_SET, "trigger-a", "HAS_BASELINE_TRIGGER"),
        edge(EVAL_SET, "trigger-b", "HAS_TRIGGER"),
        edge("trigger-a", "output-shared", "HAS_OUTPUT"),
        edge("trigger-b", "output-shared", "HAS_OUTPUT"),
      ],
    };

    const { points, dropped } = buildEvalOutputSeries(sg);

    expect(points).toHaveLength(1);
    expect(dropped).toEqual([{ ref_id: "output-shared", reason: "duplicate" }]);
  });

  it("returns an empty series (with drop reasons) when nothing scores", () => {
    const sg = merge(evalSetRun("only", "HAS_TRIGGER", {}, "100"));
    const { points, dropped, denominator } = buildEvalOutputSeries(sg);
    expect(points).toEqual([]);
    expect(denominator).toBe(0);
    expect(dropped).toHaveLength(1);
  });
});

// ── Ordering ──────────────────────────────────────────────────────────────────

describe("buildEvalOutputSeries — ordering", () => {
  it("orders by date_added_to_graph when every output has one", () => {
    const sg = merge(
      evalSetRun("base", "HAS_BASELINE_TRIGGER", { n_passed: 10, n_total: 20 }, "100"),
      // Deliberately named so ref_id order disagrees with date order
      evalSetRun("zzz", "HAS_TRIGGER", { n_passed: 12, n_total: 20 }, "200"),
      evalSetRun("aaa", "HAS_TRIGGER", { n_passed: 14, n_total: 20 }, "300"),
    );

    const { points, orderingMode } = buildEvalOutputSeries(sg);

    expect(orderingMode).toBe("date");
    expect(scoresOf(points)).toEqual([10, 12, 14]);
  });

  it("falls back to the id suffix when a date is missing", () => {
    const sg = merge(
      evalSetRun("base", "HAS_BASELINE_TRIGGER", { n_passed: 10, n_total: 20, id: "slug-run" }),
      evalSetRun("second", "HAS_TRIGGER", { n_passed: 14, n_total: 20, id: "slug-run--20" }),
      evalSetRun("first", "HAS_TRIGGER", { n_passed: 12, n_total: 20, id: "slug-run--10" }),
    );

    const { points, orderingMode } = buildEvalOutputSeries(sg);

    expect(orderingMode).toBe("id-suffix");
    expect(scoresOf(points)).toEqual([10, 12, 14]);
  });

  it("is deterministic under a shuffled input when nothing orders the points", () => {
    // No dates, and ids that carry no "--" suffix (hive writes randomUUID()),
    // so every point ties and the tie-break must be ref_id — never the input
    // array order, which is the walker's fetch-completion order.
    const parts = [
      evalSetRun("base", "HAS_BASELINE_TRIGGER", { n_passed: 10, n_total: 20, id: "uuid-a" }),
      evalSetRun("m", "HAS_TRIGGER", { n_passed: 11, n_total: 20, id: "uuid-b" }),
      evalSetRun("d", "HAS_TRIGGER", { n_passed: 12, n_total: 20, id: "uuid-c" }),
      evalSetRun("q", "HAS_TRIGGER", { n_passed: 13, n_total: 20, id: "uuid-d" }),
    ];
    const sg = merge(...parts);

    const forward = buildEvalOutputSeries(sg);
    const shuffled = buildEvalOutputSeries({
      nodes: [...sg.nodes].reverse(),
      edges: [...sg.edges].reverse(),
    });

    expect(forward.orderingMode).toBe("ref-id");
    expect(shuffled.points.map((p) => p.ref_id)).toEqual(forward.points.map((p) => p.ref_id));
    expect(labelsOf(shuffled.points)).toEqual(labelsOf(forward.points));
  });

  it("pins the baseline to index 0 even when its timestamp is the latest", () => {
    const sg = merge(
      evalSetRun("base", "HAS_BASELINE_TRIGGER", { n_passed: 10, n_total: 20 }, "900"),
      evalSetRun("r1", "HAS_TRIGGER", { n_passed: 12, n_total: 20 }, "100"),
      evalSetRun("r2", "HAS_TRIGGER", { n_passed: 14, n_total: 20 }, "200"),
    );

    const { points } = buildEvalOutputSeries(sg);

    expect(labelsOf(points)).toEqual(["base", "r1", "r2"]);
    expect(points[0].isBaseline).toBe(true);
    expect(scoresOf(points)).toEqual([10, 12, 14]);
  });

  it("labels r1…rN with no `base` when there is no HAS_BASELINE_TRIGGER", () => {
    const sg = merge(
      evalSetRun("a", "HAS_TRIGGER", { n_passed: 10, n_total: 20 }, "100"),
      evalSetRun("b", "HAS_TRIGGER", { n_passed: 12, n_total: 20 }, "200"),
      evalSetRun("c", "HAS_TRIGGER", { n_passed: 14, n_total: 20 }, "300"),
    );

    const { points } = buildEvalOutputSeries(sg);

    expect(labelsOf(points)).toEqual(["r1", "r2", "r3"]);
    expect(points.every((p) => p.isBaseline === false)).toBe(true);
  });
});

// ── Denominator + scores ──────────────────────────────────────────────────────

describe("buildEvalOutputSeries — denominator and scores", () => {
  it("normalizes n_total to the max across points and clamps numerators", () => {
    const sg = merge(
      evalSetRun("base", "HAS_BASELINE_TRIGGER", { n_passed: 10, n_total: 20 }, "100"),
      evalSetRun("wide", "HAS_TRIGGER", { n_passed: 30, n_total: 40 }, "200"),
      // A numerator larger than the normalized denominator must be clamped, never
      // allowed to draw outside the chart's y-domain.
      evalSetRun("over", "HAS_TRIGGER", { n_passed: 55, n_total: 30 }, "300"),
    );

    const { points, denominator } = buildEvalOutputSeries(sg);

    expect(denominator).toBe(40);
    expect(points.every((p) => p.n_total === 40)).toBe(true);
    expect(scoresOf(points)).toEqual([10, 30, 40]);
    expect(points.map((p) => p.n_passed)).toEqual([10, 30, 40]);
  });

  it("keeps real scores in actualPassed while bestPassed ratchets up-or-flat", () => {
    const sg = merge(
      evalSetRun("base", "HAS_BASELINE_TRIGGER", { n_passed: 50, n_total: 74 }, "100"),
      evalSetRun("up", "HAS_TRIGGER", { n_passed: 58, n_total: 74 }, "200"),
      evalSetRun("down", "HAS_TRIGGER", { n_passed: 52, n_total: 74 }, "300"),
    );

    const { points } = buildEvalOutputSeries(sg);

    // The regression keeps its real score…
    expect(scoresOf(points)).toEqual([50, 58, 52]);
    // …but the line the chart draws never falls: the run is "ignored".
    expect(points.map((p) => p.bestPassed)).toEqual([50, 58, 58]);
    expect(points.every((p) => p.accepted === true)).toBe(true);
  });
});

// ── Fixture integration ───────────────────────────────────────────────────────

describe("buildEvalOutputSeries — concept-only fixture", () => {
  const sg = {
    nodes: buildConceptOnlyNodes() as unknown as SubgraphNode[],
    edges: buildConceptOnlyEdges(),
  };

  it("charts every scored run even with zero ProposedFix nodes", () => {
    const { points, denominator, orderingMode, dropped } = buildEvalOutputSeries(sg);

    expect(sg.nodes.some((n) => (n.node_type ?? "").toLowerCase() === "proposedfix")).toBe(false);

    // baseline + 2 EvalSet re-runs + 1 requirement-hosted + 1 wider-denominator
    expect(points).toHaveLength(5);
    expect(labelsOf(points)).toEqual(["base", "r1", "r2", "r3", "r4"]);
    expect(orderingMode).toBe("date");

    // max(n_total) across kept points: 74, 74, 74, 74, 80
    expect(denominator).toBe(80);
    expect(points.every((p) => p.n_total === 80)).toBe(true);

    // Real scores, including the deliberate regression at r2
    expect(scoresOf(points)).toEqual([50, 58, 52, 61, 64]);
    // The line ratchets: the r2 regression never pulls it down
    expect(points.map((p) => p.bestPassed)).toEqual([50, 58, 58, 61, 64]);

    // The degenerate "0/0 criteria passed" output never becomes a point
    expect(dropped).toEqual([
      { ref_id: CONCEPT_ONLY_DEGENERATE_OUTPUT_ID, reason: "zero-total" },
    ]);
    expect(points.map((p) => p.ref_id)).not.toContain(CONCEPT_ONLY_DEGENERATE_OUTPUT_ID);
    expect(points[0].ref_id).toBe(CONCEPT_ONLY_BASELINE_OUTPUT_ID);
  });

  it("produces the same series for a shuffled fixture payload", () => {
    const forward = buildEvalOutputSeries(sg);
    const shuffled = buildEvalOutputSeries({
      nodes: [...sg.nodes].reverse(),
      edges: [...sg.edges].reverse(),
    });
    expect(shuffled.points.map((p) => p.ref_id)).toEqual(forward.points.map((p) => p.ref_id));
  });
});
