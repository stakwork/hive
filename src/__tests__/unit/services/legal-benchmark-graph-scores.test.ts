/**
 * Unit tests for legal-benchmark-graph-scores.ts — the graph-backed score
 * numerator source for the Runs tab.
 *
 * Contract under test:
 *   fetchTaskGraphOutputs(config, taskSlug, triggerRefs)
 *     → { ok, evalSetRefId, outputs, partial }
 *
 * Coverage:
 *   - EvalSet-hosted triggers (HAS_BASELINE_TRIGGER/HAS_TRIGGER) expanded,
 *     their outputs collected with the owning triggerRef attached
 *   - caller triggerRefs (requirement-hosted manual triggers) expanded too
 *   - judge_notes-only outputs (hive's inline write shape) yield counts
 *   - no EvalSet → caller refs still expand
 *   - per-hop failure → partial=true, surviving hops still returned
 *   - trigger cap enforced
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockResolveEvalSetRefIdBySlug = vi.hoisted(() => vi.fn());
vi.mock("@/services/legal-benchmark-recursion", () => ({
  resolveEvalSetRefIdBySlug: mockResolveEvalSetRefIdBySlug,
}));

import {
  fetchTaskGraphOutputs,
  GRAPH_SCORES_TRIGGER_CAP,
} from "@/services/legal-benchmark-graph-scores";
import type { JarvisConnectionConfig } from "@/types/jarvis";

const CONFIG: JarvisConnectionConfig = {
  jarvisUrl: "https://jarvis.example.com",
  apiKey: "test-key",
};

type MockNode = { ref_id: string; node_type: string; properties?: Record<string, unknown>; date_added_to_graph?: string };

/** Route fetch by expanded ref_id → returned neighbor nodes. */
function mockFetchByRef(responses: Record<string, MockNode[] | "fail">) {
  return vi.fn(async (url: string) => {
    const match = /\/v2\/nodes\/([^?]+)\?/.exec(url);
    const refId = match ? decodeURIComponent(match[1]) : "";
    const nodes = responses[refId];
    if (nodes === "fail" ) return { ok: false, status: 502, text: async () => "" } as Response;
    if (!nodes) return { ok: true, json: async () => ({ nodes: [] }) } as unknown as Response;
    // Jarvis returns the root alongside neighbors — include it to prove filtering.
    return {
      ok: true,
      json: async () => ({ nodes: [{ ref_id: refId, node_type: "EvalSet" }, ...nodes] }),
    } as unknown as Response;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockResolveEvalSetRefIdBySlug.mockResolvedValue("evalset-1");
});

describe("fetchTaskGraphOutputs", () => {
  it("collects outputs from EvalSet-hosted triggers with the owning triggerRef attached", async () => {
    vi.stubGlobal("fetch", mockFetchByRef({
      "evalset-1": [
        { ref_id: "trig-base", node_type: "EvalTrigger" },
        { ref_id: "trig-rerun", node_type: "evaltrigger" }, // casing variant
        { ref_id: "unrelated", node_type: "Concept" },
      ],
      "trig-base": [
        { ref_id: "out-base", node_type: "EvalTriggerOutput", properties: { result: "fail", score: 0.5, n_passed: 5, n_total: 10 } },
      ],
      "trig-rerun": [
        { ref_id: "out-rerun", node_type: "EvalTriggerOutput", properties: { result: "fail", score: 0.8, n_passed: 8, n_total: 10, id: "task-a-src--57419" } },
      ],
    }));

    const result = await fetchTaskGraphOutputs(CONFIG, "task-a");
    expect(result.ok).toBe(true);
    expect(result.partial).toBe(false);
    expect(result.evalSetRefId).toBe("evalset-1");
    expect(result.outputs.map((o) => [o.ref_id, o.triggerRef])).toEqual([
      ["out-base", "trig-base"],
      ["out-rerun", "trig-rerun"],
    ]);
    expect(result.outputs[1].id).toBe("task-a-src--57419");
  });

  it("expands caller trigger refs (requirement-hosted manual triggers) too", async () => {
    vi.stubGlobal("fetch", mockFetchByRef({
      "evalset-1": [],
      "manual-trig": [
        // hive's inline write: counts ONLY in judge_notes
        { ref_id: "out-manual", node_type: "EvalTriggerOutput", properties: { result: "fail", score: 0.72, judge_notes: "36/50 criteria passed. Judge: sonnet" } },
      ],
    }));

    const result = await fetchTaskGraphOutputs(CONFIG, "task-a", ["manual-trig"]);
    expect(result.outputs).toHaveLength(1);
    expect(result.outputs[0].triggerRef).toBe("manual-trig");
    // normalizeOutput parsed counts out of judge_notes — load-bearing fallback
    expect(result.outputs[0].n_passed).toBe(36);
    expect(result.outputs[0].n_total).toBe(50);
  });

  it("still expands caller refs when the task has no EvalSet", async () => {
    mockResolveEvalSetRefIdBySlug.mockResolvedValue(null);
    vi.stubGlobal("fetch", mockFetchByRef({
      "manual-trig": [
        { ref_id: "out-1", node_type: "EvalTriggerOutput", properties: { result: "pass", score: 1, n_passed: 10, n_total: 10 } },
      ],
    }));

    const result = await fetchTaskGraphOutputs(CONFIG, "task-a", ["manual-trig"]);
    expect(result.ok).toBe(true);
    expect(result.evalSetRefId).toBeNull();
    expect(result.outputs).toHaveLength(1);
  });

  it("marks the result partial when a hop fails, keeping the surviving hops", async () => {
    vi.stubGlobal("fetch", mockFetchByRef({
      "evalset-1": [{ ref_id: "trig-ok", node_type: "EvalTrigger" }],
      "trig-ok": [
        { ref_id: "out-ok", node_type: "EvalTriggerOutput", properties: { result: "fail", score: 0.5, n_passed: 5, n_total: 10 } },
      ],
      "trig-dead": "fail",
    }));

    const result = await fetchTaskGraphOutputs(CONFIG, "task-a", ["trig-dead"]);
    expect(result.partial).toBe(true);
    expect(result.ok).toBe(true); // something was gathered
    expect(result.outputs.map((o) => o.ref_id)).toEqual(["out-ok"]);
  });

  it("returns ok:false when the graph fails and yields nothing", async () => {
    vi.stubGlobal("fetch", mockFetchByRef({ "evalset-1": "fail", "trig-dead": "fail" }));
    const result = await fetchTaskGraphOutputs(CONFIG, "task-a", ["trig-dead"]);
    expect(result.ok).toBe(false);
    expect(result.outputs).toEqual([]);
  });

  it("caps the trigger fan-out", async () => {
    const manyRefs = Array.from({ length: GRAPH_SCORES_TRIGGER_CAP + 20 }, (_, i) => `t-${i}`);
    const fetchMock = mockFetchByRef({ "evalset-1": [] });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchTaskGraphOutputs(CONFIG, "task-a", manyRefs);
    expect(result.partial).toBe(true);
    // 1 EvalSet expand + capped trigger expands
    expect(fetchMock).toHaveBeenCalledTimes(1 + GRAPH_SCORES_TRIGGER_CAP);
  });
});
