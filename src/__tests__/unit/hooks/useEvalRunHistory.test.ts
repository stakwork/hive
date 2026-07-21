/**
 * Unit tests for the reworked useEvalRunHistory hook.
 *
 * The hook now accepts `{ refId, slug }` and fetches via the subgraph proxy
 * (GET /api/swarm/jarvis/nodes?id=...&endpoint=...) rather than the old
 * /evals/harvey-lab/requirements path.
 *
 * Verifies:
 * - New { refId, slug } signature is accepted
 * - Subgraph proxy is called with the evalSet ref_id
 * - buildHillClimbSeries is used to produce the chart attempts series
 * - Falls back to slug-resolve when refId is absent
 * - Empty result when EvalSet ref_id cannot be resolved
 * - history table is still populated from identity triggers
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock("@/hooks/useWorkspace", () => ({
  useWorkspace: () => ({
    workspace: { slug: "openlaw", id: "ws-1" },
  }),
}));

// Mock buildHillClimbSeries so we can verify it's called
const mockBuildHillClimbSeries = vi.fn();
vi.mock("@/lib/harvey-lab/hill-climb-series", () => ({
  buildHillClimbSeries: (sg: unknown) => mockBuildHillClimbSeries(sg),
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeOutputNode(ref_id: string, n_passed: number, n_total: number, date?: string) {
  return {
    ref_id,
    node_type: "EvalTriggerOutput",
    date_added_to_graph: date ?? String(1720000000),
    properties: { result: "pass", score: n_passed / n_total, n_passed, n_total },
  };
}

function makeTriggerNode(ref_id: string, withIdentity = true) {
  return {
    ref_id,
    node_type: "EvalTrigger",
    date_added_to_graph: String(1720000000),
    properties: withIdentity
      ? { agent: "Legal Runner", start_point: "start", end_point: "end" }
      : {},
  };
}

function makeSubgraphResponse(nodes: object[], edges: object[] = []) {
  return {
    success: true,
    data: { nodes, edges },
  };
}

function mockFetch(routes: Record<string, unknown>) {
  const sortedEntries = Object.entries(routes).sort((a, b) => b[0].length - a[0].length);
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) => {
      for (const [pattern, data] of sortedEntries) {
        if (url.includes(pattern)) {
          return Promise.resolve({ ok: true, json: async () => data });
        }
      }
      return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
    }),
  );
}

// ─── Tests ───────────────────────────────────────────────────────────────────

import { useEvalRunHistory } from "@/hooks/useEvalRunHistory";

describe("useEvalRunHistory — new { refId, slug } signature + subgraph fetch", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    mockBuildHillClimbSeries.mockReset();
  });

  it("calls the subgraph proxy with the provided refId", async () => {
    mockBuildHillClimbSeries.mockReturnValue([]);
    const triggerNode = makeTriggerNode("trig-1");
    const outputNode = makeOutputNode("out-1", 28, 42);

    mockFetch({
      "jarvis/nodes": makeSubgraphResponse([triggerNode, outputNode], [
        { source: "trig-1", target: "out-1", edge_type: "HAS_OUTPUT" },
      ]),
      "type=LEGAL_BENCHMARK_RUNNER": { data: [] },
    });

    const { result } = renderHook(() =>
      useEvalRunHistory({ refId: "eval-set-ref-001", slug: "antitrust/task-1" }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false), { timeout: 5000 });

    // Should call buildHillClimbSeries with the subgraph data
    expect(mockBuildHillClimbSeries).toHaveBeenCalled();
    const callArg = mockBuildHillClimbSeries.mock.calls[0][0] as { nodes: object[]; edges: object[] };
    // The subgraph proxy endpoint should include the evalSet ref_id
    expect(vi.mocked(global.fetch)).toHaveBeenCalledWith(
      expect.stringContaining("eval-set-ref-001"),
    );
    // nodes array should include the EvalSet stub
    expect(callArg.nodes.some((n: object) => (n as { ref_id: string }).ref_id === "eval-set-ref-001")).toBe(true);
  });

  it("returns empty attempts when subgraph fetch fails", async () => {
    mockBuildHillClimbSeries.mockReturnValue([]);
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (url.includes("jarvis/nodes")) {
          return Promise.resolve({ ok: false, status: 502, json: async () => ({}) });
        }
        return Promise.resolve({ ok: true, json: async () => ({ data: [] }) });
      }),
    );

    const { result } = renderHook(() =>
      useEvalRunHistory({ refId: "eval-set-ref-001", slug: "antitrust/task-1" }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false), { timeout: 5000 });
    expect(result.current.attempts).toHaveLength(0);
    expect(result.current.history).toHaveLength(0);
  });

  it("resolves slug via /recursion/resolve when refId is absent", async () => {
    mockBuildHillClimbSeries.mockReturnValue([]);
    const triggerNode = makeTriggerNode("trig-1");

    mockFetch({
      "recursion/resolve": { refId: "resolved-ref-id" },
      "jarvis/nodes": makeSubgraphResponse([triggerNode], []),
      "type=LEGAL_BENCHMARK_RUNNER": { data: [] },
    });

    renderHook(() =>
      useEvalRunHistory({ refId: null, slug: "antitrust/task-1" }),
    );

    await waitFor(
      () => {
        const calls = vi.mocked(global.fetch).mock.calls.map((c) => c[0]);
        return calls.some((u) => typeof u === "string" && u.includes("recursion/resolve"));
      },
      { timeout: 5000 },
    );

    expect(vi.mocked(global.fetch)).toHaveBeenCalledWith(
      expect.stringContaining("recursion/resolve"),
    );
  });

  it("returns empty when refId is absent and slug-resolve returns null", async () => {
    mockBuildHillClimbSeries.mockReturnValue([]);
    mockFetch({
      "recursion/resolve": { refId: null },
      "type=LEGAL_BENCHMARK_RUNNER": { data: [] },
    });

    const { result } = renderHook(() =>
      useEvalRunHistory({ refId: null, slug: "antitrust/task-1" }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false), { timeout: 5000 });
    expect(result.current.attempts).toHaveLength(0);
    expect(result.current.history).toHaveLength(0);
    // Should NOT call the subgraph proxy when resolve returns null
    const fetchCalls = vi.mocked(global.fetch).mock.calls.map((c) => c[0] as string);
    expect(fetchCalls.some((u) => u.includes("jarvis/nodes"))).toBe(false);
  });

  it("uses buildHillClimbSeries result as attempts when non-empty", async () => {
    const fakeAttempts = [
      {
        ref_id: "out-base",
        attempt_number: 1,
        result: "pass",
        score: 0.67,
        n_passed: 50,
        n_total: 74,
        date_added_to_graph: "1720000000",
      },
      {
        ref_id: "out-rerun",
        attempt_number: 2,
        result: "pass",
        score: 0.78,
        n_passed: 58,
        n_total: 74,
        date_added_to_graph: "1720086400",
      },
    ];
    mockBuildHillClimbSeries.mockReturnValue(fakeAttempts);

    mockFetch({
      "jarvis/nodes": makeSubgraphResponse([makeTriggerNode("trig-1")], []),
      "type=LEGAL_BENCHMARK_RUNNER": { data: [] },
    });

    const { result } = renderHook(() =>
      useEvalRunHistory({ refId: "ref-001", slug: "antitrust/task-1" }),
    );

    await waitFor(() => expect(result.current.attempts).toHaveLength(2), { timeout: 5000 });
    expect(result.current.attempts[0].n_passed).toBe(50);
    expect(result.current.attempts[1].n_passed).toBe(58);
  });

  it("falls back to legacy flat list when buildHillClimbSeries returns empty", async () => {
    // buildHillClimbSeries returns [] (no EvalSet/fix data) but triggers have outputs
    mockBuildHillClimbSeries.mockReturnValue([]);
    const triggerNode = makeTriggerNode("trig-1");
    const outputNode = makeOutputNode("out-1", 28, 42, "1720000000");

    mockFetch({
      "jarvis/nodes": makeSubgraphResponse([triggerNode, outputNode], [
        { source: "trig-1", target: "out-1", edge_type: "HAS_OUTPUT" },
      ]),
      "type=LEGAL_BENCHMARK_RUNNER": { data: [] },
    });

    const { result } = renderHook(() =>
      useEvalRunHistory({ refId: "ref-001", slug: "antitrust/task-1" }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false), { timeout: 5000 });
    // Falls back to the flat list from subgraph trigger outputs
    expect(result.current.attempts).toHaveLength(1);
    expect(result.current.attempts[0].n_passed).toBe(28);
  });

  it("history table is populated from identity triggers in the subgraph", async () => {
    mockBuildHillClimbSeries.mockReturnValue([]);
    const identityTrigger = makeTriggerNode("trig-identity", true);
    const nonIdentityTrigger = makeTriggerNode("trig-anon", false);
    const outputNode = makeOutputNode("out-1", 28, 42);

    mockFetch({
      "jarvis/nodes": makeSubgraphResponse(
        [identityTrigger, nonIdentityTrigger, outputNode],
        [
          { source: "trig-identity", target: "out-1", edge_type: "HAS_OUTPUT" },
        ],
      ),
      "type=LEGAL_BENCHMARK_RUNNER": {
        data: [{ id: "run-1", projectId: 123, result: JSON.stringify({ evalTriggerRef: "trig-identity" }), createdAt: "2024-01-01T00:00:00Z" }],
      },
    });

    const { result } = renderHook(() =>
      useEvalRunHistory({ refId: "ref-001", slug: "antitrust/task-1" }),
    );

    await waitFor(() => expect(result.current.history).toHaveLength(1), { timeout: 5000 });
    expect(result.current.history[0].triggerId).toBe("trig-identity");
    // Non-identity trigger should NOT appear in history
    expect(result.current.history.find((h) => h.triggerId === "trig-anon")).toBeUndefined();
  });

  it("does not hit old harvey-lab/requirements path", async () => {
    mockBuildHillClimbSeries.mockReturnValue([]);
    mockFetch({
      "jarvis/nodes": makeSubgraphResponse([], []),
      "type=LEGAL_BENCHMARK_RUNNER": { data: [] },
    });

    renderHook(() =>
      useEvalRunHistory({ refId: "ref-001", slug: "antitrust/task-1" }),
    );

    await waitFor(() => {
      const calls = vi.mocked(global.fetch).mock.calls.map((c) => c[0] as string);
      return calls.some((u) => u.includes("jarvis/nodes"));
    }, { timeout: 5000 });

    const fetchCalls = vi.mocked(global.fetch).mock.calls.map((c) => c[0] as string);
    expect(fetchCalls.some((u) => u.includes("harvey-lab"))).toBe(false);
    expect(fetchCalls.some((u) => u.includes("requirements"))).toBe(false);
  });
});
