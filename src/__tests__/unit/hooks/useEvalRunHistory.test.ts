/**
 * Unit tests for the reworked useEvalRunHistory hook.
 *
 * The hook now accepts `{ refId, slug }` and fetches via the dedicated
 * GET /api/workspaces/[slug]/legal/benchmarks/fix-chain?evalSetRefId=...
 * route (backed by walkFixChain) rather than the old /graph/subgraph proxy.
 *
 * Verifies:
 * - New { refId, slug } signature is accepted
 * - fix-chain route is called with the evalSet ref_id (NOT /graph/subgraph)
 * - buildHillClimbSeries is used to produce the chart attempts series
 * - Falls back to slug-resolve when refId is absent
 * - Empty result when EvalSet ref_id cannot be resolved
 * - history table is still populated from identity triggers
 * - partial:true is logged but does not block results
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

const mockLoggerWarn = vi.fn();
const mockLoggerInfo = vi.fn();
vi.mock("@/lib/logger", () => ({
  logger: {
    info: (...args: unknown[]) => mockLoggerInfo(...args),
    warn: (...args: unknown[]) => mockLoggerWarn(...args),
    error: vi.fn(),
    debug: vi.fn(),
  },
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

/** Shape returned by the new fix-chain route */
function makeFixChainResponse(nodes: object[], edges: object[] = [], partial = false) {
  return {
    success: true,
    data: { nodes, edges, partial },
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

describe("useEvalRunHistory — new { refId, slug } signature + fix-chain route", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    mockBuildHillClimbSeries.mockReset();
    mockLoggerWarn.mockReset();
    mockLoggerInfo.mockReset();
  });

  it("calls the fix-chain route with the provided refId (not /graph/subgraph)", async () => {
    mockBuildHillClimbSeries.mockReturnValue([]);
    const triggerNode = makeTriggerNode("trig-1");
    const outputNode = makeOutputNode("out-1", 28, 42);

    mockFetch({
      "fix-chain": makeFixChainResponse([triggerNode, outputNode], [
        { source: "trig-1", target: "out-1", edge_type: "HAS_OUTPUT" },
      ]),
      "type=LEGAL_BENCHMARK_RUNNER": { data: [] },
    });

    const { result } = renderHook(() =>
      useEvalRunHistory({ refId: "eval-set-ref-001", slug: "antitrust/task-1" }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false), { timeout: 5000 });

    // Should call buildHillClimbSeries with the fix-chain data
    expect(mockBuildHillClimbSeries).toHaveBeenCalled();
    const callArg = mockBuildHillClimbSeries.mock.calls[0][0] as { nodes: object[]; edges: object[] };
    // The fix-chain route URL should include the evalSet ref_id
    expect(vi.mocked(global.fetch)).toHaveBeenCalledWith(
      expect.stringContaining("eval-set-ref-001"),
    );
    // nodes array should include the EvalSet stub injected by the hook
    expect(callArg.nodes.some((n: object) => (n as { ref_id: string }).ref_id === "eval-set-ref-001")).toBe(true);
    // Verify the fix-chain route was called, NOT the old subgraph proxy
    const fetchCalls = vi.mocked(global.fetch).mock.calls.map((c) => c[0] as string);
    expect(fetchCalls.some((u) => u.includes("fix-chain"))).toBe(true);
    expect(fetchCalls.some((u) => u.includes("graph/subgraph"))).toBe(false);
    expect(fetchCalls.some((u) => u.includes("swarm/jarvis/nodes"))).toBe(false);
  });

  it("returns empty attempts when fix-chain fetch fails", async () => {
    mockBuildHillClimbSeries.mockReturnValue([]);
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (url.includes("fix-chain")) {
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
      "fix-chain": makeFixChainResponse([triggerNode], []),
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
    // After resolving, should also call fix-chain with the resolved ref_id
    const fetchCalls = vi.mocked(global.fetch).mock.calls.map((c) => c[0] as string);
    expect(fetchCalls.some((u) => u.includes("fix-chain"))).toBe(true);
    expect(fetchCalls.some((u) => u.includes("resolved-ref-id"))).toBe(true);
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
    // Should NOT call fix-chain when resolve returns null
    const fetchCalls = vi.mocked(global.fetch).mock.calls.map((c) => c[0] as string);
    expect(fetchCalls.some((u) => u.includes("fix-chain"))).toBe(false);
    expect(fetchCalls.some((u) => u.includes("graph/subgraph"))).toBe(false);
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
      "fix-chain": makeFixChainResponse([makeTriggerNode("trig-1")], []),
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
      "fix-chain": makeFixChainResponse([triggerNode, outputNode], [
        { source: "trig-1", target: "out-1", edge_type: "HAS_OUTPUT" },
      ]),
      "type=LEGAL_BENCHMARK_RUNNER": { data: [] },
    });

    const { result } = renderHook(() =>
      useEvalRunHistory({ refId: "ref-001", slug: "antitrust/task-1" }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false), { timeout: 5000 });
    // Falls back to the flat list from trigger outputs
    expect(result.current.attempts).toHaveLength(1);
    expect(result.current.attempts[0].n_passed).toBe(28);
  });

  it("history table is populated from identity triggers in the fix-chain", async () => {
    mockBuildHillClimbSeries.mockReturnValue([]);
    const identityTrigger = makeTriggerNode("trig-identity", true);
    const nonIdentityTrigger = makeTriggerNode("trig-anon", false);
    const outputNode = makeOutputNode("out-1", 28, 42);

    mockFetch({
      "fix-chain": makeFixChainResponse(
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

  it("does not hit old subgraph proxy or harvey-lab/requirements path", async () => {
    mockBuildHillClimbSeries.mockReturnValue([]);
    mockFetch({
      "fix-chain": makeFixChainResponse([], []),
      "type=LEGAL_BENCHMARK_RUNNER": { data: [] },
    });

    renderHook(() =>
      useEvalRunHistory({ refId: "ref-001", slug: "antitrust/task-1" }),
    );

    await waitFor(() => {
      const calls = vi.mocked(global.fetch).mock.calls.map((c) => c[0] as string);
      return calls.some((u) => u.includes("fix-chain"));
    }, { timeout: 5000 });

    const fetchCalls = vi.mocked(global.fetch).mock.calls.map((c) => c[0] as string);
    expect(fetchCalls.some((u) => u.includes("harvey-lab"))).toBe(false);
    expect(fetchCalls.some((u) => u.includes("requirements"))).toBe(false);
    expect(fetchCalls.some((u) => u.includes("graph/subgraph"))).toBe(false);
    expect(fetchCalls.some((u) => u.includes("swarm/jarvis/nodes"))).toBe(false);
  });

  it("logs a warning when partial:true is returned from the fix-chain route", async () => {
    mockBuildHillClimbSeries.mockReturnValue([]);
    const triggerNode = makeTriggerNode("trig-1");

    mockFetch({
      "fix-chain": makeFixChainResponse([triggerNode], [], true /* partial */),
      "type=LEGAL_BENCHMARK_RUNNER": { data: [] },
    });

    const { result } = renderHook(() =>
      useEvalRunHistory({ refId: "ref-partial", slug: "antitrust/task-1" }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false), { timeout: 5000 });

    // Should still produce results (partial doesn't block rendering)
    expect(result.current.error).toBeNull();
    // Should have logged a warning about partial data
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      expect.stringContaining("partial"),
      "legal",
      expect.objectContaining({ evalSetRefId: "ref-partial" }),
    );
  });
});

// ─── Series selection ────────────────────────────────────────────────────────

describe("useEvalRunHistory — series selection", () => {
  const EVAL_SET_REF = "ref-series-001";

  afterEach(() => {
    vi.restoreAllMocks();
    mockBuildHillClimbSeries.mockReset();
    mockLoggerWarn.mockReset();
    mockLoggerInfo.mockReset();
  });

  /** EvalSet-hosted trigger + one scored output. */
  function conceptRun(name: string, edgeType: string, n_passed: number, date: string) {
    const trigger = `trigger-${name}`;
    const output = `output-${name}`;
    return {
      nodes: [makeTriggerNode(trigger), makeOutputNode(output, n_passed, 74, date)],
      edges: [
        { source: EVAL_SET_REF, target: trigger, edge_type: edgeType },
        { source: trigger, target: output, edge_type: "HAS_OUTPUT" },
      ],
    };
  }

  function conceptOnlyGraph() {
    const parts = [
      conceptRun("base", "HAS_BASELINE_TRIGGER", 50, "1720000000"),
      conceptRun("r1", "HAS_TRIGGER", 58, "1720086400"),
      conceptRun("r2", "HAS_TRIGGER", 52, "1720172800"),
    ];
    return {
      nodes: parts.flatMap((p) => p.nodes),
      edges: parts.flatMap((p) => p.edges),
    };
  }

  it("keeps the hill-climb series when it has a scored non-baseline point", async () => {
    mockBuildHillClimbSeries.mockReturnValue([
      { ref_id: "base", attempt_number: 1, result: "pass", score: 0.6, n_passed: 50, n_total: 74, isBaseline: true, accepted: true, actualPassed: 50, bestPassed: 50, label: "base" },
      { ref_id: "fix", attempt_number: 2, result: "pass", score: 0.8, n_passed: 60, n_total: 74, isBaseline: false, accepted: true, actualPassed: 60, bestPassed: 60, label: "r1" },
    ]);

    const graph = conceptOnlyGraph();
    mockFetch({
      "fix-chain": makeFixChainResponse(graph.nodes, graph.edges),
      "type=LEGAL_BENCHMARK_RUNNER": { data: [] },
    });

    const { result } = renderHook(() =>
      useEvalRunHistory({ refId: EVAL_SET_REF, slug: "antitrust/task-1" }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false), { timeout: 5000 });

    expect(result.current.seriesKind).toBe("fix-chain");
    expect(result.current.attempts.map((a) => a.actualPassed)).toEqual([50, 60]);
  });

  it("logs the mixed-set case when a fix chain and concept re-runs coexist", async () => {
    mockBuildHillClimbSeries.mockReturnValue([
      { ref_id: "base", attempt_number: 1, result: "pass", score: 0.6, n_passed: 50, n_total: 74, isBaseline: true, accepted: true, actualPassed: 50, bestPassed: 50, label: "base" },
      { ref_id: "fix", attempt_number: 2, result: "pass", score: 0.8, n_passed: 60, n_total: 74, isBaseline: false, accepted: true, actualPassed: 60, bestPassed: 60, label: "r1" },
    ]);

    const graph = conceptOnlyGraph();
    mockFetch({
      "fix-chain": makeFixChainResponse(graph.nodes, graph.edges),
      "type=LEGAL_BENCHMARK_RUNNER": { data: [] },
    });

    const { result } = renderHook(() =>
      useEvalRunHistory({ refId: EVAL_SET_REF, slug: "antitrust/task-1" }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false), { timeout: 5000 });

    expect(mockLoggerInfo).toHaveBeenCalledWith(
      expect.stringContaining("Mixed set"),
      "legal",
      expect.objectContaining({ evalOutputPoints: 3 }),
    );
  });

  it("falls through to the eval-output series when the only fixes were rejected and unscored", async () => {
    // buildHillClimbSeries emits slot points (actualPassed: null, accepted: false)
    // for rejected-and-unscored fixes. Counting bare non-baseline points would
    // keep the hill-climb path here and hide the concept re-runs entirely.
    mockBuildHillClimbSeries.mockReturnValue([
      { ref_id: "base", attempt_number: 1, result: "pass", score: 0.6, n_passed: 50, n_total: 74, isBaseline: true, accepted: true, actualPassed: 50, bestPassed: 50, label: "base" },
      { ref_id: "slot-fix-1", attempt_number: 0, result: "", score: 0, isBaseline: false, accepted: false, actualPassed: null, bestPassed: 50, label: "r1" },
    ]);

    const graph = conceptOnlyGraph();
    mockFetch({
      "fix-chain": makeFixChainResponse(graph.nodes, graph.edges),
      "type=LEGAL_BENCHMARK_RUNNER": { data: [] },
    });

    const { result } = renderHook(() =>
      useEvalRunHistory({ refId: EVAL_SET_REF, slug: "antitrust/task-1" }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false), { timeout: 5000 });

    expect(result.current.seriesKind).toBe("eval-output");
    expect(result.current.attempts.map((a) => a.label)).toEqual(["base", "r1", "r2"]);
    // Real scores, in date order — including the regression at r2
    expect(result.current.attempts.map((a) => a.actualPassed)).toEqual([50, 58, 52]);
    // The line ratchets: bestPassed never falls
    expect(result.current.attempts.map((a) => a.bestPassed)).toEqual([50, 58, 58]);
  });

  it("charts concept re-runs when there is no ProposedFix at all", async () => {
    mockBuildHillClimbSeries.mockReturnValue([]);

    const graph = conceptOnlyGraph();
    mockFetch({
      "fix-chain": makeFixChainResponse(graph.nodes, graph.edges),
      "type=LEGAL_BENCHMARK_RUNNER": { data: [] },
    });

    const { result } = renderHook(() =>
      useEvalRunHistory({ refId: EVAL_SET_REF, slug: "antitrust/task-1" }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false), { timeout: 5000 });

    expect(result.current.seriesKind).toBe("eval-output");
    expect(result.current.attempts).toHaveLength(3);
    expect(result.current.partial).toBe(false);
  });

  it("surfaces the walk's partial flag on the returned value", async () => {
    mockBuildHillClimbSeries.mockReturnValue([]);

    const graph = conceptOnlyGraph();
    mockFetch({
      "fix-chain": makeFixChainResponse(graph.nodes, graph.edges, true /* partial */),
      "type=LEGAL_BENCHMARK_RUNNER": { data: [] },
    });

    const { result } = renderHook(() =>
      useEvalRunHistory({ refId: EVAL_SET_REF, slug: "antitrust/task-1" }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false), { timeout: 5000 });
    expect(result.current.partial).toBe(true);
  });

  it("lists every identity trigger the widened walk brings back as a history row", async () => {
    // Concept re-runs now appear as history rows. That is a consequence of
    // fetching non-baseline triggers, accepted deliberately and pinned here.
    mockBuildHillClimbSeries.mockReturnValue([]);

    const graph = conceptOnlyGraph();
    mockFetch({
      "fix-chain": makeFixChainResponse(graph.nodes, graph.edges),
      "type=LEGAL_BENCHMARK_RUNNER": { data: [] },
    });

    const { result } = renderHook(() =>
      useEvalRunHistory({ refId: EVAL_SET_REF, slug: "antitrust/task-1" }),
    );

    await waitFor(() => expect(result.current.history).toHaveLength(3), { timeout: 5000 });
    expect(result.current.history.map((h) => h.triggerId).sort()).toEqual([
      "trigger-base",
      "trigger-r1",
      "trigger-r2",
    ]);
  });
});

// ─── Activity-rail rows ──────────────────────────────────────────────────────

describe("useEvalRunHistory — attemptRows", () => {
  const EVAL_SET_REF = "ref-rail-001";
  const TASK_SLUG = "antitrust/task-1";

  afterEach(() => {
    vi.restoreAllMocks();
    mockBuildHillClimbSeries.mockReset();
  });

  /** EvalSet-hosted trigger + one scored output (n_passed/n_total). */
  function railRun(name: string, edgeType: string, n_passed: number, date: string) {
    const trigger = `trigger-${name}`;
    const output = `output-${name}`;
    return {
      nodes: [makeTriggerNode(trigger), makeOutputNode(output, n_passed, 74, date)],
      edges: [
        { source: EVAL_SET_REF, target: trigger, edge_type: edgeType },
        { source: trigger, target: output, edge_type: "HAS_OUTPUT" },
      ],
    };
  }

  function railGraph() {
    const parts = [
      railRun("base", "HAS_BASELINE_TRIGGER", 50, "1720000000"),
      railRun("r1", "HAS_TRIGGER", 58, "1720086400"),
    ];
    return {
      nodes: parts.flatMap((p) => p.nodes),
      edges: parts.flatMap((p) => p.edges),
    };
  }

  function runRow(
    id: string,
    over: Partial<{
      status: string;
      projectId: number | null;
      createdAt: string;
      hasReport: boolean;
      result: Record<string, unknown>;
    }> = {},
  ) {
    return {
      id,
      projectId: over.projectId ?? 100,
      status: over.status ?? "COMPLETED",
      createdAt: over.createdAt ?? "2026-08-18T10:00:00.000Z",
      hasReport: over.hasReport ?? false,
      result: JSON.stringify({ taskSlug: TASK_SLUG, ...(over.result ?? {}) }),
    };
  }

  function renderRail(routes: Record<string, unknown>) {
    mockBuildHillClimbSeries.mockReturnValue([]);
    mockFetch(routes);
    return renderHook(() => useEvalRunHistory({ refId: EVAL_SET_REF, slug: TASK_SLUG }));
  }

  it("fetches runner, eval, and recursion run lists", async () => {
    const graph = railGraph();
    const { result } = renderRail({
      "fix-chain": makeFixChainResponse(graph.nodes, graph.edges),
      "type=LEGAL_BENCHMARK_RUNNER": { runs: [] },
      "type=LEGAL_BENCHMARK_EVAL": { runs: [] },
      "type=LEGAL_BENCHMARK_RECURSION": { runs: [] },
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false), { timeout: 5000 });

    const urls = vi.mocked(global.fetch).mock.calls.map((c) => c[0] as string);
    expect(urls.some((u) => u.includes("type=LEGAL_BENCHMARK_RUNNER"))).toBe(true);
    expect(urls.some((u) => u.includes("type=LEGAL_BENCHMARK_EVAL"))).toBe(true);
    expect(urls.some((u) => u.includes("type=LEGAL_BENCHMARK_RECURSION"))).toBe(true);
  });

  it("joins a runner run onto its trigger row with chart label and score", async () => {
    // Timestamp priority: graph write-time beats Postgres updatedAt/createdAt.
    // The output node has date_added_to_graph "1720000000" → "2024-07-03T09:46:40.000Z".
    // Even though the run has a later createdAt, graphTime wins.
    const graph = railGraph();
    const { result } = renderRail({
      "fix-chain": makeFixChainResponse(graph.nodes, graph.edges),
      "type=LEGAL_BENCHMARK_RUNNER": {
        runs: [runRow("run-base", { result: { evalTriggerRef: "trigger-base" }, projectId: 77 })],
      },
      "type=LEGAL_BENCHMARK_EVAL": { runs: [] },
      "type=LEGAL_BENCHMARK_RECURSION": { runs: [] },
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false), { timeout: 5000 });

    const base = result.current.attemptRows.find((r) => r.key === "output-base");
    expect(base).toBeDefined();
    expect(base!.label).toBe("base");
    expect(base!.attemptIndex).toBe(0);
    expect(base!.status).toBe("COMPLETED");
    expect(base!.runType).toBe("runner");
    expect(base!.projectId).toBe(77);
    expect(base!.score).toEqual({ passed: 50, total: 74 });
    // Graph write-time wins over run's createdAt (new timestamp priority).
    expect(base!.timestamp).toBe(new Date(1720000000 * 1000).toISOString());
  });

  it("an active eval run outranks a terminal runner run on the same trigger", async () => {
    const graph = railGraph();
    const { result } = renderRail({
      "fix-chain": makeFixChainResponse(graph.nodes, graph.edges),
      "type=LEGAL_BENCHMARK_RUNNER": {
        runs: [runRow("run-old", { result: { evalTriggerRef: "trigger-r1" }, createdAt: "2026-08-18T09:00:00.000Z" })],
      },
      "type=LEGAL_BENCHMARK_EVAL": {
        runs: [runRow("run-live", { status: "IN_PROGRESS", result: { evalTriggerRef: "trigger-r1" } })],
      },
      "type=LEGAL_BENCHMARK_RECURSION": { runs: [] },
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false), { timeout: 5000 });

    const row = result.current.attemptRows.find((r) => r.key === "output-r1");
    expect(row!.status).toBe("IN_PROGRESS");
    expect(row!.runType).toBe("eval");
    expect(row!.inFlight).toBe(true);
  });

  it("a trigger with no matching run stays graph-only: null status, graph timestamp", async () => {
    const graph = railGraph();
    const { result } = renderRail({
      "fix-chain": makeFixChainResponse(graph.nodes, graph.edges),
      "type=LEGAL_BENCHMARK_RUNNER": { runs: [] },
      "type=LEGAL_BENCHMARK_EVAL": { runs: [] },
      "type=LEGAL_BENCHMARK_RECURSION": { runs: [] },
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false), { timeout: 5000 });

    const row = result.current.attemptRows.find((r) => r.key === "output-base");
    expect(row!.status).toBeNull();
    expect(row!.runType).toBeNull();
    // 1720000000 epoch-seconds → ISO
    expect(row!.timestamp).toBe(new Date(1720000000 * 1000).toISOString());
  });

  it("surfaces in-flight AND terminal recursion runs (no evalTriggerRef by design) as rail rows", async () => {
    // Terminal recursion runs now appear in completedRows alongside runner/eval
    // runs — they carry no n_passed/n_total so score is null, and hasReport is
    // false (the recursion webhook never writes it). Both render correctly.
    const graph = railGraph();
    const { result } = renderRail({
      "fix-chain": makeFixChainResponse(graph.nodes, graph.edges),
      "type=LEGAL_BENCHMARK_RUNNER": { runs: [] },
      "type=LEGAL_BENCHMARK_EVAL": { runs: [] },
      "type=LEGAL_BENCHMARK_RECURSION": {
        runs: [
          runRow("rec-live", { status: "PENDING" }),
          // Different task — must not appear on this card
          runRow("rec-other", { status: "PENDING", result: { taskSlug: "other/task" } }),
          // Terminal recursion runs now appear (score: null, hasReport: false)
          runRow("rec-done", { status: "COMPLETED" }),
        ],
      },
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false), { timeout: 5000 });

    const keys = result.current.attemptRows.map((r) => r.key);
    expect(keys).toContain("rec-live");
    expect(keys).not.toContain("rec-other");
    // Terminal recursion runs now appear in the rail (spec change)
    expect(keys).toContain("rec-done");

    const live = result.current.attemptRows.find((r) => r.key === "rec-live")!;
    expect(live.label).toBeNull();
    expect(live.runType).toBe("recursion");
    expect(live.inFlight).toBe(true);

    const done = result.current.attemptRows.find((r) => r.key === "rec-done")!;
    expect(done.runType).toBe("recursion");
    expect(done.score).toBeNull();
    expect(done.hasReport).toBe(false);
    expect(done.inFlight).toBe(false);
  });

  it("report pending: completed run with a report requested but no bundle yet", async () => {
    const graph = railGraph();
    const { result } = renderRail({
      "fix-chain": makeFixChainResponse(graph.nodes, graph.edges),
      "type=LEGAL_BENCHMARK_RUNNER": {
        runs: [
          runRow("run-pending-report", {
            result: { evalTriggerRef: "trigger-base", generateRunReport: true },
            hasReport: false,
          }),
          runRow("run-with-report", {
            result: { evalTriggerRef: "trigger-r1", generateRunReport: true },
            hasReport: true,
          }),
        ],
      },
      "type=LEGAL_BENCHMARK_EVAL": { runs: [] },
      "type=LEGAL_BENCHMARK_RECURSION": { runs: [] },
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false), { timeout: 5000 });

    const pending = result.current.attemptRows.find((r) => r.key === "output-base")!;
    expect(pending.reportPending).toBe(true);
    expect(pending.hasReport).toBe(false);

    const landed = result.current.attemptRows.find((r) => r.key === "output-r1")!;
    expect(landed.reportPending).toBe(false);
    expect(landed.hasReport).toBe(true);
  });

  it("sets graphReportRef on graph-only rows whose node carries a report_url", async () => {
    // The Stakwork eval workflow writes report_url onto the EvalTriggerOutput
    // node itself — recursion attempts that never join a StakworkRun row must
    // still surface a report handle. The row carries the node REF, not the raw
    // bundle URL: the attempt-report page resolves the URL server-side.
    const output = makeOutputNode("output-base", 50, 74, "1720000000");
    (output.properties as Record<string, unknown>).report_url =
      "https://example.com/reports/base";
    const graph = {
      nodes: [makeTriggerNode("trigger-base"), output],
      edges: [
        { source: EVAL_SET_REF, target: "trigger-base", edge_type: "HAS_BASELINE_TRIGGER" },
        { source: "trigger-base", target: "output-base", edge_type: "HAS_OUTPUT" },
      ],
    };
    const { result } = renderRail({
      "fix-chain": makeFixChainResponse(graph.nodes, graph.edges),
      "type=LEGAL_BENCHMARK_RUNNER": { runs: [] },
      "type=LEGAL_BENCHMARK_EVAL": { runs: [] },
      "type=LEGAL_BENCHMARK_RECURSION": { runs: [] },
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false), { timeout: 5000 });

    const row = result.current.attemptRows.find((r) => r.key === "output-base")!;
    expect(row.status).toBeNull();
    expect(row.hasReport).toBe(false);
    expect(row.graphReportRef).toBe("output-base");
  });

  it("charts rows for identity-less triggers — the concept pipeline writes none", async () => {
    // Trigger nodes with no agent/start_point/end_point (external concept
    // workflow). history filters these out; the rail must NOT.
    const bareTrigger = makeTriggerNode("trigger-bare", false);
    const graph = {
      nodes: [bareTrigger, makeOutputNode("output-bare", 70, 71, "1720000000")],
      edges: [
        { source: EVAL_SET_REF, target: "trigger-bare", edge_type: "HAS_BASELINE_TRIGGER" },
        { source: "trigger-bare", target: "output-bare", edge_type: "HAS_OUTPUT" },
      ],
    };
    const { result } = renderRail({
      "fix-chain": makeFixChainResponse(graph.nodes, graph.edges),
      "type=LEGAL_BENCHMARK_RUNNER": { runs: [] },
      "type=LEGAL_BENCHMARK_EVAL": { runs: [] },
      "type=LEGAL_BENCHMARK_RECURSION": { runs: [] },
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false), { timeout: 5000 });

    // history stays identity-gated (runs-table concern)…
    expect(result.current.history).toHaveLength(0);
    // …but the rail mirrors the chart: one row per dot, graph-only.
    expect(result.current.attemptRows).toHaveLength(1);
    expect(result.current.attemptRows[0].key).toBe("output-bare");
    expect(result.current.attemptRows[0].label).toBe("base");
    expect(result.current.attemptRows[0].score).toEqual({ passed: 70, total: 71 });
    expect(result.current.attemptRows[0].status).toBeNull();
  });

  it("orders charted rows by dot index ahead of run-only rows", async () => {
    const graph = railGraph();
    const { result } = renderRail({
      "fix-chain": makeFixChainResponse(graph.nodes, graph.edges),
      "type=LEGAL_BENCHMARK_RUNNER": { runs: [] },
      "type=LEGAL_BENCHMARK_EVAL": {
        runs: [runRow("eval-live", { status: "IN_PROGRESS" })],
      },
      "type=LEGAL_BENCHMARK_RECURSION": { runs: [] },
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false), { timeout: 5000 });

    const keys = result.current.attemptRows.map((r) => r.key);
    expect(keys).toEqual(["output-base", "output-r1", "eval-live"]);
  });
});
