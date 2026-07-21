/**
 * Unit tests for hill-climb-series.ts — the pure builder that walks the
 * EvalSet/EvalTrigger/ProposedFix ontology and produces the chart data series.
 *
 * Contract under test:
 *   buildHillClimbSeries({ nodes, edges }) → EvalTriggerOutput[]
 *
 * Tests cover:
 *   - baseline-only (no ProposedFix)
 *   - accepted fix chain → stepping line
 *   - eval_status="accepted" wins over conflicting legacy status="rejected"
 *   - status="accepted" with NO eval_status renders (fallback exercised)
 *   - rejected/pending fixes excluded from series
 *   - PRODUCED_BY edge → primary score hop
 *   - rerun_run_id fallback (in-subgraph EvalTriggerOutput with matching ref_id)
 *   - string before_score / after_score → derived integer n_passed/n_total
 *   - no usable score → point dropped, never NaN
 *   - label-casing variants handled (case-insensitive node_type matching)
 *   - chain-topological order with sortAttemptsChronologically
 *   - no NaN/undefined ever emitted
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { buildHillClimbSeries } from "@/lib/harvey-lab/hill-climb-series";
import type { Subgraph, SubgraphNode, SubgraphEdge } from "@/lib/harvey-lab/hill-climb-series";

// ─── Helpers ─────────────────────────────────────────────────────────────────

let _nodeIdx = 0;
function uid(prefix = "n") {
  return `${prefix}-${++_nodeIdx}`;
}

function evalSetNode(ref_id = "evalset-1"): SubgraphNode {
  return { ref_id, node_type: "EvalSet", date_added_to_graph: "1720000000", properties: {} };
}

function triggerNode(ref_id: string, ts = "1720001000"): SubgraphNode {
  return {
    ref_id,
    node_type: "EvalTrigger",
    date_added_to_graph: ts,
    properties: { agent: "mock", start_point: "start", end_point: "end" },
  };
}

function outputNode(
  ref_id: string,
  n_passed: number,
  n_total: number,
  ts: string,
  id?: string,
): SubgraphNode {
  return {
    ref_id,
    node_type: "EvalTriggerOutput",
    date_added_to_graph: ts,
    properties: {
      attempt_number: 1,
      result: "pass",
      score: n_passed / n_total,
      n_passed,
      n_total,
      judge_notes: `${n_passed}/${n_total} criteria passed`,
      ...(id ? { id } : {}),
    },
  };
}

function fixNode(
  ref_id: string,
  opts: {
    eval_status?: string;
    status?: string;
    rerun_run_id?: string;
    before_score?: string;
    after_score?: string;
    ts?: string;
  } = {},
): SubgraphNode {
  return {
    ref_id,
    node_type: "ProposedFix",
    date_added_to_graph: opts.ts ?? "1720002000",
    properties: {
      criterion_id: `crit-${ref_id}`,
      ...(opts.eval_status !== undefined ? { eval_status: opts.eval_status } : {}),
      ...(opts.status !== undefined ? { status: opts.status } : {}),
      ...(opts.rerun_run_id !== undefined ? { rerun_run_id: opts.rerun_run_id } : {}),
      ...(opts.before_score !== undefined ? { before_score: opts.before_score } : {}),
      ...(opts.after_score !== undefined ? { after_score: opts.after_score } : {}),
    },
  };
}

function edge(source: string, target: string, edge_type: string): SubgraphEdge {
  return { source, target, edge_type };
}

// Minimal subgraph: EvalSet → baseline trigger → baseline output (no fixes)
function baselineOnly(
  opts: { evalSetId?: string; nPassed?: number; nTotal?: number } = {},
): Subgraph {
  const evalSetId = opts.evalSetId ?? "evalset-1";
  const triggerId = uid("trig");
  const outputId = uid("out");
  return {
    nodes: [
      evalSetNode(evalSetId),
      triggerNode(triggerId, "1720001000"),
      outputNode(outputId, opts.nPassed ?? 50, opts.nTotal ?? 74, "1720001500"),
    ],
    edges: [
      edge(evalSetId, triggerId, "HAS_BASELINE_TRIGGER"),
      edge(triggerId, outputId, "HAS_OUTPUT"),
    ],
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

afterEach(() => {
  _nodeIdx = 0;
  vi.restoreAllMocks();
});

describe("buildHillClimbSeries", () => {
  // ── Baseline-only ─────────────────────────────────────────────────────────

  it("baseline-only: returns a single output point", () => {
    const sg = baselineOnly({ nPassed: 50, nTotal: 74 });
    const series = buildHillClimbSeries(sg);
    expect(series).toHaveLength(1);
    expect(series[0].n_passed).toBe(50);
    expect(series[0].n_total).toBe(74);
  });

  it("returns empty array when no EvalSet node found", () => {
    const sg: Subgraph = {
      nodes: [triggerNode("t1"), outputNode("o1", 50, 74, "1720001000")],
      edges: [edge("t1", "o1", "HAS_OUTPUT")],
    };
    expect(buildHillClimbSeries(sg)).toHaveLength(0);
  });

  it("returns empty when baseline trigger missing", () => {
    const sg: Subgraph = {
      nodes: [evalSetNode()],
      edges: [],
    };
    expect(buildHillClimbSeries(sg)).toHaveLength(0);
  });

  it("returns empty when baseline output missing n_passed/n_total", () => {
    const evalSetId = "evalset-1";
    const triggerId = uid("trig");
    const outputId = uid("out");
    const sg: Subgraph = {
      nodes: [
        evalSetNode(evalSetId),
        triggerNode(triggerId),
        { ref_id: outputId, node_type: "EvalTriggerOutput", properties: { result: "pass" } },
      ],
      edges: [
        edge(evalSetId, triggerId, "HAS_BASELINE_TRIGGER"),
        edge(triggerId, outputId, "HAS_OUTPUT"),
      ],
    };
    expect(buildHillClimbSeries(sg)).toHaveLength(0);
  });

  // ── Accepted fix chain ────────────────────────────────────────────────────

  it("accepted fix chain: returns baseline + accepted fixes in order", () => {
    const evalSetId = "evalset-1";
    const triggerId = uid("trig");
    const baseOutputId = uid("out");
    const fix1Id = uid("fix");
    const fix1OutId = uid("out");
    const fix2Id = uid("fix");
    const fix2OutId = uid("out");

    const sg: Subgraph = {
      nodes: [
        evalSetNode(evalSetId),
        triggerNode(triggerId, "1720001000"),
        outputNode(baseOutputId, 50, 74, "1720001500"),
        fixNode(fix1Id, { eval_status: "accepted", ts: "1720002000" }),
        outputNode(fix1OutId, 58, 74, "1720002500"),
        fixNode(fix2Id, { eval_status: "accepted", ts: "1720003000" }),
        outputNode(fix2OutId, 65, 74, "1720003500"),
      ],
      edges: [
        edge(evalSetId, triggerId, "HAS_BASELINE_TRIGGER"),
        edge(triggerId, baseOutputId, "HAS_OUTPUT"),
        edge(triggerId, fix1Id, "HAS_PROPOSED_FIX"),
        edge(fix1Id, fix1OutId, "PRODUCED_BY"),
        edge(fix2Id, fix1Id, "DERIVED_FROM"), // fix2 derived from fix1
        edge(fix2Id, fix2OutId, "PRODUCED_BY"),
      ],
    };

    const series = buildHillClimbSeries(sg);
    expect(series.length).toBeGreaterThanOrEqual(2);
    // Baseline is first
    expect(series[0].n_passed).toBe(50);
    // All n_passed values are valid integers
    for (const pt of series) {
      expect(typeof pt.n_passed).toBe("number");
      expect(isNaN(pt.n_passed!)).toBe(false);
      expect(typeof pt.n_total).toBe("number");
      expect(isNaN(pt.n_total!)).toBe(false);
    }
  });

  // ── eval_status wins over conflicting status ──────────────────────────────

  it("eval_status=accepted + status=rejected → included (eval_status wins)", () => {
    const evalSetId = "evalset-1";
    const triggerId = uid("trig");
    const baseOutputId = uid("out");
    const fixId = uid("fix");
    const fixOutId = uid("out");

    const sg: Subgraph = {
      nodes: [
        evalSetNode(evalSetId),
        triggerNode(triggerId, "1720001000"),
        outputNode(baseOutputId, 50, 74, "1720001500"),
        // eval_status says accepted but legacy status says rejected → should be included
        fixNode(fixId, { eval_status: "accepted", status: "rejected", ts: "1720002000" }),
        outputNode(fixOutId, 60, 74, "1720002500"),
      ],
      edges: [
        edge(evalSetId, triggerId, "HAS_BASELINE_TRIGGER"),
        edge(triggerId, baseOutputId, "HAS_OUTPUT"),
        edge(triggerId, fixId, "HAS_PROPOSED_FIX"),
        edge(fixId, fixOutId, "PRODUCED_BY"),
      ],
    };

    const series = buildHillClimbSeries(sg);
    // Should have baseline + accepted fix (despite conflicting legacy status)
    expect(series.length).toBe(2);
    expect(series[1].n_passed).toBe(60);
  });

  // ── status fallback when eval_status absent ───────────────────────────────

  it("status=accepted with no eval_status → included (fallback)", () => {
    const evalSetId = "evalset-1";
    const triggerId = uid("trig");
    const baseOutputId = uid("out");
    const fixId = uid("fix");
    const fixOutId = uid("out");

    const sg: Subgraph = {
      nodes: [
        evalSetNode(evalSetId),
        triggerNode(triggerId, "1720001000"),
        outputNode(baseOutputId, 50, 74, "1720001500"),
        // No eval_status — only legacy status="accepted" (today's UI write path)
        fixNode(fixId, { status: "accepted", ts: "1720002000" }),
        outputNode(fixOutId, 55, 74, "1720002500"),
      ],
      edges: [
        edge(evalSetId, triggerId, "HAS_BASELINE_TRIGGER"),
        edge(triggerId, baseOutputId, "HAS_OUTPUT"),
        edge(triggerId, fixId, "HAS_PROPOSED_FIX"),
        edge(fixId, fixOutId, "PRODUCED_BY"),
      ],
    };

    const series = buildHillClimbSeries(sg);
    // Must render the fix via status fallback
    expect(series.length).toBe(2);
    expect(series[1].n_passed).toBe(55);
  });

  // ── Rejected / pending exclusion ─────────────────────────────────────────

  it("eval_status=rejected → excluded from series", () => {
    const evalSetId = "evalset-1";
    const triggerId = uid("trig");
    const baseOutputId = uid("out");
    const fixId = uid("fix");
    const fixOutId = uid("out");

    const sg: Subgraph = {
      nodes: [
        evalSetNode(evalSetId),
        triggerNode(triggerId, "1720001000"),
        outputNode(baseOutputId, 50, 74, "1720001500"),
        fixNode(fixId, { eval_status: "rejected", ts: "1720002000" }),
        outputNode(fixOutId, 60, 74, "1720002500"),
      ],
      edges: [
        edge(evalSetId, triggerId, "HAS_BASELINE_TRIGGER"),
        edge(triggerId, baseOutputId, "HAS_OUTPUT"),
        edge(triggerId, fixId, "HAS_PROPOSED_FIX"),
        edge(fixId, fixOutId, "PRODUCED_BY"),
      ],
    };

    const series = buildHillClimbSeries(sg);
    // Only baseline — rejected fix excluded
    expect(series).toHaveLength(1);
    expect(series[0].n_passed).toBe(50);
  });

  it("eval_status=pending → excluded from series", () => {
    const evalSetId = "evalset-1";
    const triggerId = uid("trig");
    const baseOutputId = uid("out");
    const fixId = uid("fix");
    const fixOutId = uid("out");

    const sg: Subgraph = {
      nodes: [
        evalSetNode(evalSetId),
        triggerNode(triggerId, "1720001000"),
        outputNode(baseOutputId, 50, 74, "1720001500"),
        fixNode(fixId, { eval_status: "pending", ts: "1720002000" }),
        outputNode(fixOutId, 60, 74, "1720002500"),
      ],
      edges: [
        edge(evalSetId, triggerId, "HAS_BASELINE_TRIGGER"),
        edge(triggerId, baseOutputId, "HAS_OUTPUT"),
        edge(triggerId, fixId, "HAS_PROPOSED_FIX"),
        edge(fixId, fixOutId, "PRODUCED_BY"),
      ],
    };

    const series = buildHillClimbSeries(sg);
    expect(series).toHaveLength(1);
  });

  // ── PRODUCED_BY edge — primary score hop ─────────────────────────────────

  it("score is read via PRODUCED_BY edge", () => {
    const evalSetId = "evalset-1";
    const triggerId = uid("trig");
    const baseOutputId = uid("out");
    const fixId = uid("fix");
    const producedByOutputId = uid("out");

    const sg: Subgraph = {
      nodes: [
        evalSetNode(evalSetId),
        triggerNode(triggerId, "1720001000"),
        outputNode(baseOutputId, 50, 74, "1720001500"),
        fixNode(fixId, { eval_status: "accepted", ts: "1720002000" }),
        outputNode(producedByOutputId, 62, 74, "1720002500"),
      ],
      edges: [
        edge(evalSetId, triggerId, "HAS_BASELINE_TRIGGER"),
        edge(triggerId, baseOutputId, "HAS_OUTPUT"),
        edge(triggerId, fixId, "HAS_PROPOSED_FIX"),
        edge(fixId, producedByOutputId, "PRODUCED_BY"),
      ],
    };

    const series = buildHillClimbSeries(sg);
    expect(series).toHaveLength(2);
    expect(series[1].n_passed).toBe(62);
  });

  // ── rerun_run_id fallback (in-subgraph) ──────────────────────────────────

  it("rerun_run_id fallback: resolves in-subgraph EvalTriggerOutput by ref_id", () => {
    const evalSetId = "evalset-1";
    const triggerId = uid("trig");
    const baseOutputId = uid("out");
    const fixId = uid("fix");
    const rerunOutputId = `rerun-output-${uid("x")}`;

    const sg: Subgraph = {
      nodes: [
        evalSetNode(evalSetId),
        triggerNode(triggerId, "1720001000"),
        outputNode(baseOutputId, 50, 74, "1720001500"),
        // No PRODUCED_BY edge — only rerun_run_id pointing to the rerun output ref_id
        fixNode(fixId, { eval_status: "accepted", rerun_run_id: rerunOutputId, ts: "1720002000" }),
        outputNode(rerunOutputId, 57, 74, "1720002500"),
      ],
      edges: [
        edge(evalSetId, triggerId, "HAS_BASELINE_TRIGGER"),
        edge(triggerId, baseOutputId, "HAS_OUTPUT"),
        edge(triggerId, fixId, "HAS_PROPOSED_FIX"),
        // Intentionally NO PRODUCED_BY edge — fallback path
      ],
    };

    const series = buildHillClimbSeries(sg);
    expect(series).toHaveLength(2);
    expect(series[1].n_passed).toBe(57);
  });

  // ── String before_score/after_score → derived n_passed/n_total ───────────

  it("string after_score derives integer n_passed against baseline n_total", () => {
    const evalSetId = "evalset-1";
    const triggerId = uid("trig");
    const baseOutputId = uid("out");
    const fixId = uid("fix");

    const sg: Subgraph = {
      nodes: [
        evalSetNode(evalSetId),
        triggerNode(triggerId, "1720001000"),
        outputNode(baseOutputId, 50, 74, "1720001500"),
        // No PRODUCED_BY, no rerun_run_id — only string scores
        fixNode(fixId, {
          eval_status: "accepted",
          before_score: "50",
          after_score: "58",
          ts: "1720002000",
        }),
      ],
      edges: [
        edge(evalSetId, triggerId, "HAS_BASELINE_TRIGGER"),
        edge(triggerId, baseOutputId, "HAS_OUTPUT"),
        edge(triggerId, fixId, "HAS_PROPOSED_FIX"),
      ],
    };

    const series = buildHillClimbSeries(sg);
    expect(series).toHaveLength(2);
    const fixPt = series[1];
    expect(fixPt.n_passed).toBe(58);
    expect(fixPt.n_total).toBe(74); // derived against baseline n_total
    expect(isNaN(fixPt.n_passed!)).toBe(false);
  });

  // ── No usable score → point dropped ──────────────────────────────────────

  it("accepted fix with no usable score is dropped — never NaN", () => {
    const evalSetId = "evalset-1";
    const triggerId = uid("trig");
    const baseOutputId = uid("out");
    const fixId = uid("fix");

    const sg: Subgraph = {
      nodes: [
        evalSetNode(evalSetId),
        triggerNode(triggerId, "1720001000"),
        outputNode(baseOutputId, 50, 74, "1720001500"),
        // Accepted but no score data at all
        fixNode(fixId, { eval_status: "accepted", ts: "1720002000" }),
      ],
      edges: [
        edge(evalSetId, triggerId, "HAS_BASELINE_TRIGGER"),
        edge(triggerId, baseOutputId, "HAS_OUTPUT"),
        edge(triggerId, fixId, "HAS_PROPOSED_FIX"),
      ],
    };

    const series = buildHillClimbSeries(sg);
    // Fix point dropped → only baseline
    expect(series).toHaveLength(1);
    expect(series[0].n_passed).toBe(50);
    // Guard: no NaN/undefined anywhere
    for (const pt of series) {
      expect(pt.n_passed).toBeDefined();
      expect(pt.n_total).toBeDefined();
      if (pt.n_passed != null) expect(isNaN(pt.n_passed)).toBe(false);
      if (pt.n_total != null) expect(isNaN(pt.n_total)).toBe(false);
    }
  });

  // ── Label-casing variants ─────────────────────────────────────────────────

  it("handles EvalSet casing variant 'Evalset'", () => {
    const sg: Subgraph = {
      nodes: [
        { ref_id: "evalset-1", node_type: "Evalset", properties: {} },
        triggerNode("trig-1", "1720001000"),
        outputNode("out-1", 50, 74, "1720001500"),
      ],
      edges: [
        edge("evalset-1", "trig-1", "HAS_BASELINE_TRIGGER"),
        edge("trig-1", "out-1", "HAS_OUTPUT"),
      ],
    };
    const series = buildHillClimbSeries(sg);
    expect(series).toHaveLength(1);
    expect(series[0].n_passed).toBe(50);
  });

  it("handles EvalTrigger casing variant 'evaltrigger'", () => {
    const evalSetId = "evalset-1";
    const triggerId = uid("trig");
    const baseOutputId = uid("out");
    const fixId = uid("fix");
    const fixOutId = uid("out");

    const sg: Subgraph = {
      nodes: [
        evalSetNode(evalSetId),
        {
          ref_id: triggerId,
          node_type: "evaltrigger", // lowercase variant
          date_added_to_graph: "1720001000",
          properties: {},
        },
        outputNode(baseOutputId, 50, 74, "1720001500"),
        fixNode(fixId, { eval_status: "accepted", ts: "1720002000" }),
        outputNode(fixOutId, 60, 74, "1720002500"),
      ],
      edges: [
        edge(evalSetId, triggerId, "HAS_BASELINE_TRIGGER"),
        edge(triggerId, baseOutputId, "HAS_OUTPUT"),
        edge(triggerId, fixId, "HAS_PROPOSED_FIX"),
        edge(fixId, fixOutId, "PRODUCED_BY"),
      ],
    };

    const series = buildHillClimbSeries(sg);
    expect(series.length).toBeGreaterThanOrEqual(1);
    expect(series[0].n_passed).toBe(50);
  });

  it("handles ProposedFix casing variant 'proposedfix'", () => {
    const evalSetId = "evalset-1";
    const triggerId = uid("trig");
    const baseOutputId = uid("out");
    const fixId = uid("fix");
    const fixOutId = uid("out");

    const sg: Subgraph = {
      nodes: [
        evalSetNode(evalSetId),
        triggerNode(triggerId, "1720001000"),
        outputNode(baseOutputId, 50, 74, "1720001500"),
        {
          ref_id: fixId,
          node_type: "proposedfix", // lowercase
          date_added_to_graph: "1720002000",
          properties: { eval_status: "accepted" },
        },
        outputNode(fixOutId, 60, 74, "1720002500"),
      ],
      edges: [
        edge(evalSetId, triggerId, "HAS_BASELINE_TRIGGER"),
        edge(triggerId, baseOutputId, "HAS_OUTPUT"),
        edge(triggerId, fixId, "HAS_PROPOSED_FIX"),
        edge(fixId, fixOutId, "PRODUCED_BY"),
      ],
    };

    const series = buildHillClimbSeries(sg);
    expect(series.length).toBe(2);
    expect(series[1].n_passed).toBe(60);
  });

  // ── Ordering follows sortAttemptsChronologically ──────────────────────────

  it("series ordering matches sortAttemptsChronologically (baseline first by timestamp)", () => {
    const evalSetId = "evalset-1";
    const triggerId = uid("trig");
    // Baseline output has latest timestamp (out-of-order in array)
    const baseOutputId = uid("out");
    const fixId = uid("fix");
    const fixOutId = uid("out");

    const sg: Subgraph = {
      nodes: [
        evalSetNode(evalSetId),
        triggerNode(triggerId, "1720001000"),
        // Baseline has earlier timestamp → should sort first
        outputNode(baseOutputId, 50, 74, "1720001500"),
        fixNode(fixId, { eval_status: "accepted", ts: "1720002000" }),
        // Fix output has later timestamp → sorts after baseline
        outputNode(fixOutId, 60, 74, "1720003000"),
      ],
      edges: [
        edge(evalSetId, triggerId, "HAS_BASELINE_TRIGGER"),
        edge(triggerId, baseOutputId, "HAS_OUTPUT"),
        edge(triggerId, fixId, "HAS_PROPOSED_FIX"),
        edge(fixId, fixOutId, "PRODUCED_BY"),
      ],
    };

    const series = buildHillClimbSeries(sg);
    expect(series.length).toBe(2);
    // First point is the baseline (earlier timestamp)
    expect(series[0].n_passed).toBe(50);
    // Second is the fix rerun (later timestamp)
    expect(series[1].n_passed).toBe(60);
  });

  // ── No NaN/undefined emitted ─────────────────────────────────────────────

  it("never emits NaN or undefined for n_passed/n_total on any returned point", () => {
    // Build a complex subgraph with mixed fix quality
    const evalSetId = "evalset-1";
    const triggerId = uid("trig");
    const baseOutputId = uid("out");
    const fix1Id = uid("fix");
    const fix1OutId = uid("out");
    const fix2Id = uid("fix"); // no score — should be dropped

    const sg: Subgraph = {
      nodes: [
        evalSetNode(evalSetId),
        triggerNode(triggerId, "1720001000"),
        outputNode(baseOutputId, 50, 74, "1720001500"),
        fixNode(fix1Id, { eval_status: "accepted", ts: "1720002000" }),
        outputNode(fix1OutId, 58, 74, "1720002500"),
        // fix2 is accepted but has no usable score
        fixNode(fix2Id, { eval_status: "accepted", ts: "1720003000" }),
      ],
      edges: [
        edge(evalSetId, triggerId, "HAS_BASELINE_TRIGGER"),
        edge(triggerId, baseOutputId, "HAS_OUTPUT"),
        edge(triggerId, fix1Id, "HAS_PROPOSED_FIX"),
        edge(fix1Id, fix1OutId, "PRODUCED_BY"),
        edge(fix2Id, fix1Id, "DERIVED_FROM"),
        // No PRODUCED_BY for fix2 → dropped
      ],
    };

    const series = buildHillClimbSeries(sg);
    for (const pt of series) {
      expect(pt.n_passed).toBeDefined();
      expect(pt.n_total).toBeDefined();
      if (pt.n_passed != null) expect(isNaN(pt.n_passed)).toBe(false);
      if (pt.n_total != null) expect(isNaN(pt.n_total)).toBe(false);
    }
  });
});
