/**
 * Unit tests for legal-recursion-attempt-stats.ts
 *
 * Tests `computeAttemptStats(subgraph, evalSetRefId, opts?)` which computes:
 *   - `attemptCount`  — total ProposedFix nodes across all trigger branches
 *   - `plateauStreak` — trailing scored non-improving attempts
 *
 * Covers:
 *   - attempt-cap scenario (using fixture subgraph)
 *   - plateau-cap scenario (using fixture subgraph, multi-branch)
 *   - multi-trigger-branch dedup (single shared visited set)
 *   - healthy-improving (no cap hit) scenario
 *   - unscored attempts → count toward attemptCount, not plateauStreak
 *   - cutoff option → resets plateauStreak, NOT attemptCount
 *   - combined: re-enabled EvalSet near attempt-count cap with reset plateau
 */

import { describe, it, expect } from "vitest";
import { computeAttemptStats } from "@/services/legal-recursion-attempt-stats";
import type { Subgraph, SubgraphNode, SubgraphEdge } from "@/lib/harvey-lab/hill-climb-series";
import {
  buildAttemptCapNodes,
  buildAttemptCapEdges,
  buildPlateauCapNodes,
  buildPlateauCapEdges,
  ATTEMPT_CAP_EVALSET_ID,
  PLATEAU_CAP_EVALSET_ID,
  PLATEAU_CAP_FIX1_ID,
  PLATEAU_CAP_NODE_IDS,
} from "@/app/api/mock/jarvis/graph/recursion-fixture";

// ── Helpers ────────────────────────────────────────────────────────────────────

function evalSetNode(ref_id: string, ts = "1700000000"): SubgraphNode {
  return { ref_id, node_type: "EvalSet", date_added_to_graph: ts, properties: {} };
}

function triggerNode(ref_id: string, ts = "1700001000"): SubgraphNode {
  return {
    ref_id,
    node_type: "EvalTrigger",
    date_added_to_graph: ts,
    properties: { agent: "test", start_point: "s", end_point: "e" },
  };
}

function outputNode(ref_id: string, n_passed: number, n_total: number, ts: string): SubgraphNode {
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
    },
  };
}

function fixNode(
  ref_id: string,
  ts: string,
  opts: { eval_status?: string; after_score?: string } = {},
): SubgraphNode {
  return {
    ref_id,
    node_type: "ProposedFix",
    date_added_to_graph: ts,
    properties: {
      eval_status: opts.eval_status ?? "accepted",
      ...(opts.after_score != null ? { after_score: opts.after_score } : {}),
    },
  };
}

function edge(source: string, target: string, edge_type: string): SubgraphEdge {
  return { source, target, edge_type };
}

// Build a simple linear subgraph: baseline → 1 trigger → n scored fixes in a chain
function buildLinearSubgraph(
  opts: {
    evalSetId?: string;
    nFixes?: number;
    baselineN?: number;
    scoresFn?: (i: number) => number; // returns n_passed for fix[i] (0-indexed)
    unscoredCount?: number; // append this many fixes with no score
  } = {},
): Subgraph {
  const evalSetId = opts.evalSetId ?? "es-1";
  const triggerId = "trig-1";
  const baselineOutputId = "out-base";
  const nFixes = opts.nFixes ?? 3;
  const baselineN = opts.baselineN ?? 50;
  const scoresFn = opts.scoresFn ?? ((i) => baselineN + i + 1);
  const unscoredCount = opts.unscoredCount ?? 0;

  const nodes: SubgraphNode[] = [
    evalSetNode(evalSetId),
    triggerNode(triggerId, "1700001000"),
    outputNode(baselineOutputId, baselineN, 100, "1700001500"),
  ];
  const edges: SubgraphEdge[] = [
    edge(evalSetId, triggerId, "HAS_BASELINE_TRIGGER"),
    edge(triggerId, baselineOutputId, "HAS_OUTPUT"),
  ];

  const fixIds = Array.from({ length: nFixes }, (_, i) => `fix-${i}`);
  const fixOutIds = Array.from({ length: nFixes }, (_, i) => `out-fix-${i}`);

  for (let i = 0; i < nFixes; i++) {
    const ts = String(1700002000 + i * 100);
    const nPassed = scoresFn(i);
    nodes.push(fixNode(fixIds[i], ts, {}));
    nodes.push(outputNode(fixOutIds[i], nPassed, 100, String(Number(ts) + 50)));
    edges.push(edge(fixIds[i], fixOutIds[i], "PRODUCED_BY"));
    if (i === 0) {
      edges.push(edge(triggerId, fixIds[0], "HAS_PROPOSED_FIX"));
    } else {
      edges.push(edge(fixIds[i], fixIds[i - 1], "DERIVED_FROM"));
    }
  }

  // Append unscored fixes (no PRODUCED_BY, no after_score)
  for (let i = 0; i < unscoredCount; i++) {
    const unscoredId = `unscored-fix-${i}`;
    const ts = String(1700002000 + (nFixes + i) * 100);
    nodes.push(fixNode(unscoredId, ts, {}));
    // Derive from last fix in the chain
    const prevId = nFixes > 0 ? fixIds[nFixes - 1] : triggerId;
    edges.push(edge(unscoredId, prevId, nFixes > 0 ? "DERIVED_FROM" : "HAS_PROPOSED_FIX"));
    // No PRODUCED_BY edge → unscored
  }

  return { nodes, edges };
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("computeAttemptStats", () => {

  // ── Healthy-improving scenario ─────────────────────────────────────────────

  it("healthy-improving: returns correct attemptCount with plateauStreak=0", () => {
    // 5 fixes, each improving: 51, 52, 53, 54, 55 (each > running best)
    const sg = buildLinearSubgraph({ nFixes: 5, baselineN: 50, scoresFn: (i) => 51 + i });
    const stats = computeAttemptStats(sg, "es-1");
    expect(stats.attemptCount).toBe(5);
    expect(stats.plateauStreak).toBe(0);
  });

  it("healthy-improving: plateauStreak=0 when last attempt beats running best", () => {
    // 3 fixes: 40 (below baseline 50), then 60, then 70 (latest = improvement)
    const sg = buildLinearSubgraph({
      nFixes: 3,
      baselineN: 50,
      scoresFn: (i) => [40, 60, 70][i],
    });
    const stats = computeAttemptStats(sg, "es-1");
    expect(stats.attemptCount).toBe(3);
    expect(stats.plateauStreak).toBe(0); // last fix=70 beats runningBest=60
  });

  // ── Attempt-cap scenario ───────────────────────────────────────────────────

  it("attempt-cap fixture: attemptCount >= 10 (multi-branch, with cross-branch dedup)", () => {
    const nodes = buildAttemptCapNodes();
    const edges = buildAttemptCapEdges();
    // Inject EvalSet stub so computeAttemptStats can find it by evalSetRefId
    const evalSetStub: SubgraphNode = {
      ref_id: ATTEMPT_CAP_EVALSET_ID,
      node_type: "EvalSet",
      properties: {},
    };
    // Remove any existing EvalSet node from buildAttemptCapNodes to avoid duplicates
    const filteredNodes = nodes.filter((n) => n.ref_id !== ATTEMPT_CAP_EVALSET_ID);
    const sg: Subgraph = {
      nodes: [evalSetStub, ...filteredNodes],
      edges,
    };
    const stats = computeAttemptStats(sg, ATTEMPT_CAP_EVALSET_ID);
    // 9 fixes in baseline chain + 1 branch2 fix = 10
    // branch2 also has DERIVED_FROM fix-1, but fix-1 is already visited → deduped
    expect(stats.attemptCount).toBe(10);
  });

  it("attempt-cap fixture: cross-branch node counted only once (not double-counted)", () => {
    const nodes = buildAttemptCapNodes();
    const edges = buildAttemptCapEdges();
    const sg: Subgraph = { nodes, edges };
    const stats1 = computeAttemptStats(sg, ATTEMPT_CAP_EVALSET_ID);
    // Verify it's exactly 10, not 11 (which would happen if cross-branch dedup fails)
    expect(stats1.attemptCount).toBe(10);
  });

  // ── Plateau-cap scenario ───────────────────────────────────────────────────

  it("plateau-cap fixture: plateauStreak >= plateau limit (multi-branch)", () => {
    const nodes = buildPlateauCapNodes();
    const edges = buildPlateauCapEdges();
    const sg: Subgraph = { nodes, edges };
    const stats = computeAttemptStats(sg, PLATEAU_CAP_EVALSET_ID);
    // fix1=60 (improves), fix2=55 (doesn't beat 60), fix3=58 (doesn't beat 60)
    // plateau streak = 2 (fix2 and fix3)
    expect(stats.attemptCount).toBe(3);
    expect(stats.plateauStreak).toBe(2);
  });

  it("plateau-cap: single non-improving attempt → plateauStreak=1", () => {
    // Baseline 50 → fix1=60 (best) → fix2=55 (below 60) → streak=1
    const sg = buildLinearSubgraph({ nFixes: 2, baselineN: 50, scoresFn: (i) => [60, 55][i] });
    const stats = computeAttemptStats(sg, "es-1");
    expect(stats.attemptCount).toBe(2);
    expect(stats.plateauStreak).toBe(1);
  });

  // ── Multi-trigger-branch dedup ─────────────────────────────────────────────

  it("multi-branch dedup: fix reachable from two branches counted once", () => {
    // EvalSet → baseline trigger → fix-A → fix-B → fix-C
    //         → rerun trigger → fix-B (same ref_id — already visited via baseline chain)
    // Expected: attemptCount = 3 (A, B, C) not 4 (A, B, C, B-duplicate)
    const evalSetId = "es-dedup";
    const baselineTriggerId = "trig-baseline";
    const rerunTriggerId = "trig-rerun";
    const baselineOutputId = "out-baseline";
    const fixAId = "fix-A";
    const fixBId = "fix-B"; // shared node
    const fixCId = "fix-C";
    const fixAOutputId = "out-A";
    const fixBOutputId = "out-B";
    const fixCOutputId = "out-C";

    const sg: Subgraph = {
      nodes: [
        evalSetNode(evalSetId, "1700000000"),
        triggerNode(baselineTriggerId, "1700001000"),
        triggerNode(rerunTriggerId, "1700001100"),
        outputNode(baselineOutputId, 50, 100, "1700001500"),
        fixNode(fixAId, "1700002000", {}),
        fixNode(fixBId, "1700003000", {}),
        fixNode(fixCId, "1700004000", {}),
        outputNode(fixAOutputId, 55, 100, "1700002500"),
        outputNode(fixBOutputId, 60, 100, "1700003500"),
        outputNode(fixCOutputId, 65, 100, "1700004500"),
      ],
      edges: [
        edge(evalSetId, baselineTriggerId, "HAS_BASELINE_TRIGGER"),
        edge(evalSetId, rerunTriggerId, "HAS_TRIGGER"),
        edge(baselineTriggerId, baselineOutputId, "HAS_OUTPUT"),
        edge(baselineTriggerId, fixAId, "HAS_PROPOSED_FIX"),
        edge(fixAId, fixAOutputId, "PRODUCED_BY"),
        edge(fixBId, fixAId, "DERIVED_FROM"),
        edge(fixBId, fixBOutputId, "PRODUCED_BY"),
        edge(fixCId, fixBId, "DERIVED_FROM"),
        edge(fixCId, fixCOutputId, "PRODUCED_BY"),
        // Second trigger also starts at fix-B (already in baseline chain)
        edge(rerunTriggerId, fixBId, "HAS_PROPOSED_FIX"),
      ],
    };

    const stats = computeAttemptStats(sg, evalSetId);
    // fix-A (from baseline chain) + fix-B (from baseline chain, deduped in rerun) + fix-C = 3
    expect(stats.attemptCount).toBe(3);
    expect(stats.plateauStreak).toBe(0); // all improving: 55 → 60 → 65
  });

  // ── Unscored attempts ──────────────────────────────────────────────────────

  it("unscored attempts count toward attemptCount but NOT plateauStreak", () => {
    // 2 scored improving fixes + 3 unscored fixes
    // attemptCount = 5, plateauStreak = 0 (unscored don't break or extend streak)
    const sg = buildLinearSubgraph({
      nFixes: 2,
      baselineN: 50,
      scoresFn: (i) => [55, 60][i], // improving
      unscoredCount: 3,
    });
    const stats = computeAttemptStats(sg, "es-1");
    expect(stats.attemptCount).toBe(5);
    // Last scored attempt is 60 (improving) → no plateau
    expect(stats.plateauStreak).toBe(0);
  });

  it("unscored attempts between non-improving scored attempts don't extend streak", () => {
    // Baseline 50 → fix1=55 (improving) → fix2=unscored → fix3=52 (non-improving)
    // plateau streak should be 1 (only fix3 counted in streak)
    const evalSetId = "es-unscored-mid";
    const triggerId = "trig-1";
    const baselineOutId = "out-base";
    const fix1Id = "fix-1";
    const fix2Id = "fix-2-unscored";
    const fix3Id = "fix-3";
    const fix1OutId = "out-1";
    const fix3OutId = "out-3";

    const sg: Subgraph = {
      nodes: [
        evalSetNode(evalSetId),
        triggerNode(triggerId, "1700001000"),
        outputNode(baselineOutId, 50, 100, "1700001500"),
        fixNode(fix1Id, "1700002000", {}),
        outputNode(fix1OutId, 55, 100, "1700002500"),
        // fix2 = unscored (no PRODUCED_BY)
        fixNode(fix2Id, "1700003000", {}),
        fixNode(fix3Id, "1700004000", {}),
        outputNode(fix3OutId, 52, 100, "1700004500"),
      ],
      edges: [
        edge(evalSetId, triggerId, "HAS_BASELINE_TRIGGER"),
        edge(triggerId, baselineOutId, "HAS_OUTPUT"),
        edge(triggerId, fix1Id, "HAS_PROPOSED_FIX"),
        edge(fix1Id, fix1OutId, "PRODUCED_BY"),
        edge(fix2Id, fix1Id, "DERIVED_FROM"),
        // No PRODUCED_BY for fix2 → unscored
        edge(fix3Id, fix2Id, "DERIVED_FROM"),
        edge(fix3Id, fix3OutId, "PRODUCED_BY"),
      ],
    };

    const stats = computeAttemptStats(sg, evalSetId);
    expect(stats.attemptCount).toBe(3); // fix1 + fix2 + fix3
    // Running best: 55 (from fix1). fix3=52 < 55 → streak=1
    expect(stats.plateauStreak).toBe(1);
  });

  // ── cutoff option ──────────────────────────────────────────────────────────

  it("cutoff resets plateauStreak to 0 when all pre-cutoff non-improving attempts", () => {
    // 3 attempts chronologically:
    //   ts=100: fix-old-nonimproving (score=45 < baseline 50) ← before cutoff
    //   ts=200: fix-cutoff-improving (score=55)              ← at cutoff
    //   ts=300: fix-post-improving (score=60)                ← after cutoff
    // Without cutoff: plateau streak = 0 (latest is improving)
    // With cutoff at ts=200 (seconds → Date): post-cutoff only has improving → streak=0
    // But verify the *count* of unfiltered attempts is still 3

    const evalSetId = "es-cutoff";
    const triggerId = "trig-1";
    const baselineOutId = "out-base";
    const fix1Id = "fix-old-nonimproving";
    const fix2Id = "fix-cutoff-improving";
    const fix3Id = "fix-post-improving";
    const fix1OutId = "out-1";
    const fix2OutId = "out-2";
    const fix3OutId = "out-3";

    const sg: Subgraph = {
      nodes: [
        evalSetNode(evalSetId, "50"),
        triggerNode(triggerId, "60"),
        outputNode(baselineOutId, 50, 100, "70"),
        fixNode(fix1Id, "100", {}), // ts=100
        outputNode(fix1OutId, 45, 100, "110"), // 45 < 50 baseline, non-improving
        fixNode(fix2Id, "200", {}), // ts=200 = cutoff
        outputNode(fix2OutId, 55, 100, "210"), // 55 > 50 → improving
        fixNode(fix3Id, "300", {}), // ts=300 > cutoff
        outputNode(fix3OutId, 60, 100, "310"), // 60 > 55 → improving
      ],
      edges: [
        edge(evalSetId, triggerId, "HAS_BASELINE_TRIGGER"),
        edge(triggerId, baselineOutId, "HAS_OUTPUT"),
        edge(triggerId, fix1Id, "HAS_PROPOSED_FIX"),
        edge(fix1Id, fix1OutId, "PRODUCED_BY"),
        edge(fix2Id, fix1Id, "DERIVED_FROM"),
        edge(fix2Id, fix2OutId, "PRODUCED_BY"),
        edge(fix3Id, fix2Id, "DERIVED_FROM"),
        edge(fix3Id, fix3OutId, "PRODUCED_BY"),
      ],
    };

    // Without cutoff: full history — fix1 non-improving, fix2 improving, fix3 improving
    // → plateauStreak = 0 (latest improves)
    const statsNoFilter = computeAttemptStats(sg, evalSetId);
    expect(statsNoFilter.attemptCount).toBe(3);
    expect(statsNoFilter.plateauStreak).toBe(0);

    // With cutoff at ts=200 (Unix seconds → Date as milliseconds)
    const cutoffDate = new Date(200 * 1000); // 200s in ms
    const statsWithCutoff = computeAttemptStats(sg, evalSetId, { cutoff: cutoffDate });
    // attemptCount = 3 (NOT filtered by cutoff)
    expect(statsWithCutoff.attemptCount).toBe(3);
    // plateauStreak computed from post-cutoff attempts only: fix2=55 (improving), fix3=60 (improving)
    // → plateauStreak = 0
    expect(statsWithCutoff.plateauStreak).toBe(0);
  });

  it("cutoff: plateauStreak resets to 0 when pre-cutoff non-improving attempts are excluded", () => {
    // 3 attempts:
    //   fix1 (ts=100): score=45, non-improving (45 < baseline 50)
    //   fix2 (ts=200): score=48, non-improving (48 < 50)
    //   fix3 (ts=300): score=55, improving (55 > 50)
    //
    // Without cutoff: streak = 0 (fix3 is improving, breaks any streak)
    // With cutoff at ts=300 (only fix3 included): streakCandidates = [fix3=55 > 50] → streak=0
    // This tests that cutoff correctly isolates the post-cutoff window

    const evalSetId = "es-cutoff-b";
    const triggerId = "trig-1";
    const baselineOutId = "out-base";

    const sg: Subgraph = {
      nodes: [
        evalSetNode(evalSetId, "50"),
        triggerNode(triggerId, "60"),
        outputNode(baselineOutId, 50, 100, "70"),
        fixNode("fix1", "100"),
        outputNode("out1", 45, 100, "110"),
        fixNode("fix2", "200"),
        outputNode("out2", 48, 100, "210"),
        fixNode("fix3", "300"),
        outputNode("out3", 55, 100, "310"),
      ],
      edges: [
        edge(evalSetId, triggerId, "HAS_BASELINE_TRIGGER"),
        edge(triggerId, baselineOutId, "HAS_OUTPUT"),
        edge(triggerId, "fix1", "HAS_PROPOSED_FIX"),
        edge("fix1", "out1", "PRODUCED_BY"),
        edge("fix2", "fix1", "DERIVED_FROM"),
        edge("fix2", "out2", "PRODUCED_BY"),
        edge("fix3", "fix2", "DERIVED_FROM"),
        edge("fix3", "out3", "PRODUCED_BY"),
      ],
    };

    // With cutoff at ts=250 (filters fix1 and fix2 from streak, only fix3 counted)
    const cutoff = new Date(250 * 1000);
    const stats = computeAttemptStats(sg, evalSetId, { cutoff });
    expect(stats.attemptCount).toBe(3); // never filtered
    expect(stats.plateauStreak).toBe(0); // fix3=55 > 50 (running best of post-cutoff window) → improving
  });

  it("combined: EvalSet near attempt-count cap with reset plateauStreak after re-enable", () => {
    // 8 pre-cutoff non-improving attempts + 1 post-cutoff improving attempt
    // attemptCount = 9 (close to cap of 10), plateauStreak = 0 (post-cutoff improving)
    const evalSetId = "es-combined";
    const triggerId = "trig-1";
    const baselineOutId = "out-base";

    const nodes: SubgraphNode[] = [
      evalSetNode(evalSetId, "10"),
      triggerNode(triggerId, "20"),
      outputNode(baselineOutId, 50, 100, "30"),
    ];
    const edges: SubgraphEdge[] = [
      edge(evalSetId, triggerId, "HAS_BASELINE_TRIGGER"),
      edge(triggerId, baselineOutId, "HAS_OUTPUT"),
    ];

    // 8 pre-cutoff non-improving attempts (ts 100-800, score 45 each)
    for (let i = 0; i < 8; i++) {
      const fixId = `fix-pre-${i}`;
      const outId = `out-pre-${i}`;
      const ts = String(100 + i * 100);
      nodes.push(fixNode(fixId, ts, {}));
      nodes.push(outputNode(outId, 45, 100, String(Number(ts) + 10)));
      edges.push(edge(fixId, outId, "PRODUCED_BY"));
      if (i === 0) {
        edges.push(edge(triggerId, fixId, "HAS_PROPOSED_FIX"));
      } else {
        edges.push(edge(fixId, `fix-pre-${i - 1}`, "DERIVED_FROM"));
      }
    }

    // 1 post-cutoff improving attempt (ts=2000, score=60 > 50)
    nodes.push(fixNode("fix-post", "2000", {}));
    nodes.push(outputNode("out-post", 60, 100, "2010"));
    edges.push(edge("fix-post", `fix-pre-7`, "DERIVED_FROM"));
    edges.push(edge("fix-post", "out-post", "PRODUCED_BY"));

    const sg: Subgraph = { nodes, edges };

    // With cutoff at ts=1500 (filters out all pre-cutoff attempts from streak computation)
    const cutoff = new Date(1500 * 1000);
    const stats = computeAttemptStats(sg, evalSetId, { cutoff });

    // attemptCount = 9 (NOT filtered by cutoff)
    expect(stats.attemptCount).toBe(9);
    // plateauStreak computed only from post-cutoff window: [fix-post=60 (improving)] → streak=0
    expect(stats.plateauStreak).toBe(0);
  });

  // ── Edge cases ─────────────────────────────────────────────────────────────

  it("empty subgraph (no EvalSet): returns 0/0", () => {
    const sg: Subgraph = { nodes: [], edges: [] };
    const stats = computeAttemptStats(sg, "es-missing");
    expect(stats.attemptCount).toBe(0);
    expect(stats.plateauStreak).toBe(0);
  });

  it("baseline-only (no ProposedFix): returns 0/0", () => {
    const evalSetId = "es-baseline-only";
    const sg: Subgraph = {
      nodes: [
        evalSetNode(evalSetId),
        triggerNode("trig-1"),
        outputNode("out-base", 50, 100, "1700001000"),
      ],
      edges: [
        edge(evalSetId, "trig-1", "HAS_BASELINE_TRIGGER"),
        edge("trig-1", "out-base", "HAS_OUTPUT"),
      ],
    };
    const stats = computeAttemptStats(sg, evalSetId);
    expect(stats.attemptCount).toBe(0);
    expect(stats.plateauStreak).toBe(0);
  });

  it("single improving attempt: plateauStreak=0", () => {
    const sg = buildLinearSubgraph({ nFixes: 1, baselineN: 50, scoresFn: () => 60 });
    const stats = computeAttemptStats(sg, "es-1");
    expect(stats.attemptCount).toBe(1);
    expect(stats.plateauStreak).toBe(0);
  });

  it("single non-improving attempt: plateauStreak=1", () => {
    const sg = buildLinearSubgraph({ nFixes: 1, baselineN: 50, scoresFn: () => 40 });
    const stats = computeAttemptStats(sg, "es-1");
    expect(stats.attemptCount).toBe(1);
    expect(stats.plateauStreak).toBe(1);
  });

  it("all non-improving attempts: plateauStreak equals total scored attempt count", () => {
    // Baseline 60 → fixes all at 55 (non-improving): streak = 4
    const sg = buildLinearSubgraph({ nFixes: 4, baselineN: 60, scoresFn: () => 55 });
    const stats = computeAttemptStats(sg, "es-1");
    expect(stats.attemptCount).toBe(4);
    expect(stats.plateauStreak).toBe(4);
  });

  it("EvalSet found by node_type scan even if evalSetRefId differs from injected stub", () => {
    // Callers may inject a stub { ref_id: evalSetRefId, node_type: "EvalSet" }
    // where the subgraph also has the real EvalSet node — both should work
    const evalSetId = "es-scan";
    const sg = buildLinearSubgraph({ evalSetId, nFixes: 2, scoresFn: (i) => 55 + i });
    const stats = computeAttemptStats(sg, evalSetId);
    expect(stats.attemptCount).toBe(2);
  });
});
