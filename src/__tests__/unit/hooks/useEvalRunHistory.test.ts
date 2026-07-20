/**
 * Unit tests for the `attempts` field added to useEvalRunHistory.
 *
 * Verifies that:
 * - All completed EvalTriggerOutput nodes (with n_passed/n_total) are collected
 *   across all triggers (not just identity triggers)
 * - They are sorted via sortAttemptsChronologically (baseline-first)
 * - Rerun outputs from triggers that don't pass triggerHasIdentity are NOT dropped
 * - Empty n_passed/n_total nodes are excluded from the attempts series
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock("@/hooks/useWorkspace", () => ({
  useWorkspace: () => ({
    workspace: { slug: "openlaw", id: "ws-1" },
  }),
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeRawOutput(
  ref_id: string,
  n_passed: number,
  n_total: number,
  date_added_to_graph?: string,
  id?: string,
) {
  return {
    ref_id,
    date_added_to_graph,
    properties: {
      result: "pass",
      score: n_passed / n_total,
      n_passed,
      n_total,
      id,
    },
  };
}

function makeRawTriggerWithIdentity(ref_id: string, outputs: object[] = []) {
  return {
    ref_id,
    properties: {
      agent: "Legal Runner",
      start_point: "task submitted",
      end_point: "task scored",
    },
    outputs,
  };
}

function makeRawTriggerWithoutIdentity(ref_id: string, outputs: object[] = []) {
  return {
    ref_id,
    properties: {}, // no agent/start_point/end_point → fails triggerHasIdentity
    outputs,
  };
}

/**
 * Set up a fake fetch that routes by URL substring.
 * Sorts longest patterns first so more-specific routes win over shorter ones.
 */
function mockFetch(routes: Record<string, unknown>) {
  const sortedEntries = Object.entries(routes).sort((a, b) => b[0].length - a[0].length);

  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      for (const [pattern, data] of sortedEntries) {
        if (url.includes(pattern)) {
          return Promise.resolve({
            ok: true,
            json: async () => data,
          });
        }
      }
      return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
    }),
  );
}

// ─── Tests ───────────────────────────────────────────────────────────────────

import { useEvalRunHistory } from "@/hooks/useEvalRunHistory";

describe("useEvalRunHistory — attempts field", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * Set up routes — Phase 1 resolves /requirements, Phase 2 resolves /triggers + runs.
   * The hook is two-phase: Phase 1 sets reqId, Phase 2 reads triggers.
   */
  function setupRoutes(triggers: object[], outputsHaveScores = true) {
    mockFetch({
      // Phase 2: triggers route (more specific — matched first)
      "/requirements/req-1/triggers": {
        data: { nodes: triggers },
      },
      // Phase 2: runs endpoint
      "type=LEGAL_BENCHMARK_RUNNER": { data: [] },
      // Phase 1: requirements list (less specific — matched last)
      "/requirements": {
        data: {
          nodes: [{ ref_id: "req-1", properties: { id: "antitrust/task-1" } }],
        },
      },
    });
    void outputsHaveScores;
  }

  it("returns empty attempts when no EvalTriggerOutput nodes have n_passed/n_total", async () => {
    setupRoutes([
      makeRawTriggerWithIdentity("trig-1", [
        // output WITHOUT n_passed/n_total — should be excluded
        { ref_id: "out-1", properties: { result: "pass", score: 0.8 } },
      ]),
    ]);

    const { result } = renderHook(() => useEvalRunHistory("antitrust/task-1"));

    // Wait for loading to complete (phase 2 sets isLoading=false after fetch)
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    }, { timeout: 5000 });

    // After loading, attempts should be empty (no n_passed/n_total on the output)
    expect(result.current.attempts).toHaveLength(0);
  });

  it("collects all completed outputs across multiple triggers", async () => {
    setupRoutes([
      makeRawTriggerWithIdentity("trig-1", [
        makeRawOutput("out-1", 28, 42, "1720000000"),
        makeRawOutput("out-2", 34, 42, "1720086400"),
      ]),
      makeRawTriggerWithIdentity("trig-2", [
        makeRawOutput("out-3", 38, 42, "1720172800"),
      ]),
    ]);

    const { result } = renderHook(() => useEvalRunHistory("antitrust/task-1"));

    await waitFor(() => {
      expect(result.current.attempts).toHaveLength(3);
    }, { timeout: 5000 });
  });

  it("sorts attempts chronologically by date_added_to_graph (baseline first)", async () => {
    // Out-of-order: reruns before baseline in the raw array
    setupRoutes([
      makeRawTriggerWithIdentity("trig-1", [
        makeRawOutput("out-r2", 38, 42, "1720172800"), // last
        makeRawOutput("out-base", 28, 42, "1720000000"), // first (earliest)
        makeRawOutput("out-r1", 34, 42, "1720086400"), // middle
      ]),
    ]);

    const { result } = renderHook(() => useEvalRunHistory("antitrust/task-1"));

    await waitFor(() => {
      expect(result.current.attempts).toHaveLength(3);
    }, { timeout: 5000 });

    const attempts = result.current.attempts;
    expect(attempts[0].n_passed).toBe(28); // baseline
    expect(attempts[1].n_passed).toBe(34); // rerun 1
    expect(attempts[2].n_passed).toBe(38); // rerun 2
  });

  it("does NOT drop rerun outputs from triggers that lack agent/start/end (non-identity)", async () => {
    // A rerun trigger (from the recursion workflow) may not have agent/start_point/end_point
    // — it still carries valid EvalTriggerOutput nodes we need for the chart
    setupRoutes([
      makeRawTriggerWithIdentity("trig-identity", [
        makeRawOutput("out-base", 28, 42, "1720000000"),
      ]),
      makeRawTriggerWithoutIdentity("trig-rerun", [
        makeRawOutput("out-rerun", 38, 42, "1720172800"),
      ]),
    ]);

    const { result } = renderHook(() => useEvalRunHistory("antitrust/task-1"));

    // Both outputs should appear in attempts (rerun not dropped)
    await waitFor(() => {
      expect(result.current.attempts).toHaveLength(2);
    }, { timeout: 5000 });

    expect(result.current.attempts.map((a) => a.n_passed)).toContain(38);
  });

  it("keeps existing history return intact (used by EvalRunsBox)", async () => {
    setupRoutes([
      makeRawTriggerWithIdentity("trig-1", [
        makeRawOutput("out-1", 28, 42, "1720000000"),
      ]),
    ]);

    const { result } = renderHook(() => useEvalRunHistory("antitrust/task-1"));

    // Wait for history to be populated
    await waitFor(() => {
      expect(result.current.history).toHaveLength(1);
    }, { timeout: 5000 });

    expect(result.current.history[0].triggerId).toBe("trig-1");
  });

  it("latest score = last element of attempts", async () => {
    setupRoutes([
      makeRawTriggerWithIdentity("trig-1", [
        makeRawOutput("out-1", 28, 42, "1720000000"),
        makeRawOutput("out-2", 38, 42, "1720172800"),
      ]),
    ]);

    const { result } = renderHook(() => useEvalRunHistory("antitrust/task-1"));

    await waitFor(() => {
      expect(result.current.attempts).toHaveLength(2);
    }, { timeout: 5000 });

    const last = result.current.attempts[result.current.attempts.length - 1];
    expect(last.n_passed).toBe(38);
  });
});
