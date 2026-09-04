/**
 * Unit tests for legal-benchmark-recursion service.
 */

import { describe, test, expect, vi, beforeEach } from "vitest";

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const mockSearchNodesByAttributes = vi.hoisted(() => vi.fn());
const mockUpdateNode = vi.hoisted(() => vi.fn());
const mockGroupBy = vi.hoisted(() => vi.fn());

vi.mock("@/services/swarm/api/nodes", () => ({
  searchNodesByAttributes: mockSearchNodesByAttributes,
  updateNode: mockUpdateNode,
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// `@/lib/db` mock — required to isolate Prisma from the live DB client.
vi.mock("@/lib/db", () => ({
  db: { stakworkRun: { groupBy: mockGroupBy } },
}));

// ── Import after mocks ────────────────────────────────────────────────────────

import {
  listRecursionEvalSets,
  setEvalSetRecursion,
  enableRecursionForTaskSlug,
  resolveEvalSetRefIdBySlug,
  EVALSET_NODE_LABELS,
  isEvalSetLabel,
} from "@/services/legal-benchmark-recursion";
import { logger } from "@/lib/logger";
import { db } from "@/lib/db";

// ── Fixtures ──────────────────────────────────────────────────────────────────

const CONFIG = { jarvisUrl: "https://jarvis.example.com", apiKey: "test-key" };

const EVAL_SET_NODE = {
  ref_id: "ref-abc-123",
  node_type: "EvalSet",
  properties: {
    id: "practice-area/task-slug",
    name: "Draft a contract",
    recursion: true,
    extra_secret: "should-not-leak",
  },
};

type SearchParams = {
  nodeTypes: string[];
  filters: Array<{ attribute: string; value: unknown; comparator: string }>;
  includeProperties: boolean;
  skipCache?: boolean;
};

function recursionCalls(): SearchParams[] {
  return (mockSearchNodesByAttributes.mock.calls as [unknown, SearchParams][]).map(([, p]) => p);
}

function makeNode(ref_id: string, overrides: Record<string, unknown> = {}) {
  return {
    ref_id,
    node_type: "EvalSet",
    properties: { id: `task/${ref_id}`, name: `Task ${ref_id}`, ...overrides },
  };
}

// ── listRecursionEvalSets — dispatch vs list ──────────────────────────────────

describe("listRecursionEvalSets — dispatch vs list", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.stakworkRun.groupBy).mockResolvedValue([]);
  });

  test("dispatch: recursion=true appears with reason 'active' even when property bag omits recursion", async () => {
    const node = makeNode("ref-active"); // no recursion property
    mockSearchNodesByAttributes.mockResolvedValueOnce({ ok: true, nodes: [node] });

    const result = await listRecursionEvalSets(CONFIG, "dispatch");

    expect(result.ok).toBe(true);
    const entry = result.nodes?.find((n) => n.ref_id === "ref-active");
    expect(entry).toBeDefined();
    expect(entry?.reason).toBe("active");
    expect(entry?.recursion).toBe(true);
  });

  test("dispatch: copies recursionEnabledAt so plateau cutoff can read it", async () => {
    const node = makeNode("ref-active", { recursion: true, recursionEnabledAt: 1700000000 });
    mockSearchNodesByAttributes.mockResolvedValueOnce({ ok: true, nodes: [node] });

    const result = await listRecursionEvalSets(CONFIG, "dispatch");

    expect(result.nodes?.[0].recursionEnabledAt).toBe(1700000000);
  });

  test("dispatch: dateAddedToGraph comes from the node's top-level date_added_to_graph", async () => {
    const stamped = { ...makeNode("ref-stamped", { recursion: true }), date_added_to_graph: 1756000000 };
    const unstamped = makeNode("ref-unstamped", { recursion: true });
    mockSearchNodesByAttributes.mockResolvedValueOnce({ ok: true, nodes: [stamped, unstamped] });

    const result = await listRecursionEvalSets(CONFIG, "dispatch");

    expect(result.nodes?.find((n) => n.ref_id === "ref-stamped")?.dateAddedToGraph).toBe(
      new Date(1756000000 * 1000).toISOString(),
    );
    expect(result.nodes?.find((n) => n.ref_id === "ref-unstamped")?.dateAddedToGraph).toBeNull();
  });

  test("dispatch: true-query failure returns { ok: false }", async () => {
    mockSearchNodesByAttributes.mockResolvedValueOnce({ ok: false, nodes: [], error: "Jarvis down" });

    const result = await listRecursionEvalSets(CONFIG, "dispatch");

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Jarvis down|Graph query failed/);
  });

  test("dispatch sends only recursion=true (boolean), skipCache, includeProperties", async () => {
    mockSearchNodesByAttributes.mockResolvedValueOnce({ ok: true, nodes: [] });

    await listRecursionEvalSets(CONFIG, "dispatch");

    expect(mockSearchNodesByAttributes).toHaveBeenCalledTimes(1);
    const params = recursionCalls()[0];
    expect(params.nodeTypes).toEqual(EVALSET_NODE_LABELS);
    expect(params.includeProperties).toBe(true);
    expect(params.skipCache).toBe(true);
    expect(params.filters).toEqual([{ attribute: "recursion", value: true, comparator: "=" }]);
  });

  test("list: recursion=false + leftover recursionEnabledAt is listed, reason omitted, timestamp copied", async () => {
    const liveOff = makeNode("ref-off", { recursion: false, recursionEnabledAt: 1700000000 });
    mockSearchNodesByAttributes
      .mockResolvedValueOnce({ ok: true, nodes: [] })
      .mockResolvedValueOnce({ ok: true, nodes: [liveOff] });

    const result = await listRecursionEvalSets(CONFIG, "list");

    expect(result.ok).toBe(true);
    const entry = result.nodes?.find((n) => n.ref_id === "ref-off");
    expect(entry).toBeDefined();
    expect(entry?.recursion).toBe(false);
    expect(entry?.reason).toBeUndefined();
    expect(entry).not.toHaveProperty("reason");
    expect(entry?.recursionEnabledAt).toBe(1700000000);
  });

  test("dispatch: recursion=false + leftover timestamp is not a candidate", async () => {
    mockSearchNodesByAttributes.mockResolvedValueOnce({ ok: true, nodes: [] });

    const result = await listRecursionEvalSets(CONFIG, "dispatch");

    expect(result.ok).toBe(true);
    expect(result.nodes).toEqual([]);
    expect(result.nodes?.find((n) => n.ref_id === "ref-off")).toBeUndefined();
    expect(recursionCalls().every((p) => p.filters[0].value === true)).toBe(true);
  });

  test("list: recursion=false is listed; reason omitted so Runs-tab active check would not badge it", async () => {
    const liveOff = makeNode("ref-off", { recursion: false });
    mockSearchNodesByAttributes
      .mockResolvedValueOnce({ ok: true, nodes: [] })
      .mockResolvedValueOnce({ ok: true, nodes: [liveOff] });

    const result = await listRecursionEvalSets(CONFIG, "list");

    expect(result.nodes).toHaveLength(1);
    expect(result.nodes![0].reason).toBeUndefined();
    expect(result.nodes![0].reason === "active").toBe(false);
  });

  test("unset recursion appears in neither list nor dispatch", async () => {
    mockSearchNodesByAttributes.mockResolvedValue({ ok: true, nodes: [] });

    const dispatched = await listRecursionEvalSets(CONFIG, "dispatch");
    const listed = await listRecursionEvalSets(CONFIG, "list");

    expect(dispatched.nodes).toEqual([]);
    expect(listed.nodes).toEqual([]);
  });

  test("same ref_id from both filters → one row, true wins (reason: active)", async () => {
    const liveOn = makeNode("ref-dup", { recursion: true });
    const liveOff = makeNode("ref-dup", { recursion: false, recursionEnabledAt: 1700000000 });
    mockSearchNodesByAttributes
      .mockResolvedValueOnce({ ok: true, nodes: [liveOn] })
      .mockResolvedValueOnce({ ok: true, nodes: [liveOff] });

    const result = await listRecursionEvalSets(CONFIG, "list");

    const matching = result.nodes?.filter((n) => n.ref_id === "ref-dup") ?? [];
    expect(matching).toHaveLength(1);
    expect(matching[0].reason).toBe("active");
    expect(matching[0].recursion).toBe(true);
  });

  test("Postgres multi-run (groupBy) is never called in either mode", async () => {
    mockSearchNodesByAttributes.mockResolvedValue({ ok: true, nodes: [] });

    await listRecursionEvalSets(CONFIG, "dispatch");
    await listRecursionEvalSets(CONFIG, "list");

    expect(db.stakworkRun.groupBy).not.toHaveBeenCalled();
  });

  test("list sends exactly two filters (true then false), boolean values, skipCache, includeProperties", async () => {
    mockSearchNodesByAttributes.mockResolvedValue({ ok: true, nodes: [] });

    await listRecursionEvalSets(CONFIG, "list");

    expect(mockSearchNodesByAttributes).toHaveBeenCalledTimes(2);
    const calls = recursionCalls();
    expect(calls.map((p) => p.filters[0])).toEqual([
      { attribute: "recursion", value: true, comparator: "=" },
      { attribute: "recursion", value: false, comparator: "=" },
    ]);
    for (const params of calls) {
      expect(params.nodeTypes).toEqual(EVALSET_NODE_LABELS);
      expect(params.includeProperties).toBe(true);
      expect(params.skipCache).toBe(true);
      expect(typeof params.filters[0].value).toBe("boolean");
    }
  });

  test("list true-query failure → { ok: false }", async () => {
    mockSearchNodesByAttributes.mockResolvedValueOnce({ ok: false, nodes: [], error: "Jarvis down" });

    const result = await listRecursionEvalSets(CONFIG, "list");

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Jarvis down|Graph query failed/);
    expect(mockSearchNodesByAttributes).toHaveBeenCalledTimes(1);
  });

  test("list false-query failure → { ok: true } with the true nodes (no partial)", async () => {
    const liveOn = makeNode("ref-active", { recursion: true });
    mockSearchNodesByAttributes
      .mockResolvedValueOnce({ ok: true, nodes: [liveOn] })
      .mockResolvedValueOnce({ ok: false, nodes: [], error: "Jarvis unreachable" });

    const result = await listRecursionEvalSets(CONFIG, "list");

    expect(result.ok).toBe(true);
    expect(result).not.toHaveProperty("partial");
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes![0].ref_id).toBe("ref-active");
    expect(result.nodes![0].reason).toBe("active");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("recursion=false query failed"),
      "legal",
      expect.anything(),
    );
  });

  test("list false-query throw → { ok: true } with the true nodes (no partial)", async () => {
    const liveOn = makeNode("ref-active", { recursion: true });
    mockSearchNodesByAttributes
      .mockResolvedValueOnce({ ok: true, nodes: [liveOn] })
      .mockRejectedValueOnce(new Error("Network error"));

    const result = await listRecursionEvalSets(CONFIG, "list");

    expect(result.ok).toBe(true);
    expect(result).not.toHaveProperty("partial");
    expect(result.nodes![0].reason).toBe("active");
  });

  test("list true empty + false non-empty → no possibleMissingAttribute log", async () => {
    const liveOff = makeNode("ref-off", { recursion: false });
    mockSearchNodesByAttributes
      .mockResolvedValueOnce({ ok: true, nodes: [] })
      .mockResolvedValueOnce({ ok: true, nodes: [liveOff] });

    const result = await listRecursionEvalSets(CONFIG, "list");

    expect(result.ok).toBe(true);
    expect(result.nodes).toHaveLength(1);
    expect(logger.info).not.toHaveBeenCalledWith(
      expect.stringContaining("zero nodes"),
      "legal",
      expect.objectContaining({ possibleMissingAttribute: true }),
    );
  });
});

// ── listRecursionEvalSets ─────────────────────────────────────────────────────

describe("listRecursionEvalSets", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("calls searchNodesByAttributes with correct dispatch filter shape (recursion=true)", async () => {
    mockSearchNodesByAttributes.mockResolvedValue({ ok: true, nodes: [EVAL_SET_NODE] });

    await listRecursionEvalSets(CONFIG, "dispatch");

    expect(mockSearchNodesByAttributes).toHaveBeenCalledTimes(1);
    const [, params] = mockSearchNodesByAttributes.mock.calls[0] as [unknown, SearchParams];

    expect(params.nodeTypes).toContain("EvalSet");
    expect(params.nodeTypes).toContain("Evalset");
    expect(params.nodeTypes).toEqual(EVALSET_NODE_LABELS);
    expect(params.includeProperties).toBe(true);
    expect(params.filters).toHaveLength(1);
    const filter = params.filters[0];
    expect(filter.attribute).toBe("recursion");
    expect(filter.value).toBe(true);           // boolean, not string
    expect(filter.comparator).toBe("=");        // exact match, not "eq"
    expect(params.skipCache).toBe(true);
  });

  test("returns normalized result with ok: true and whitelisted nodes", async () => {
    mockSearchNodesByAttributes.mockResolvedValue({ ok: true, nodes: [EVAL_SET_NODE] });

    const result = await listRecursionEvalSets(CONFIG, "dispatch");

    expect(result.ok).toBe(true);
    expect(result.nodes).toHaveLength(1);
    const node = result.nodes![0];
    expect(node.ref_id).toBe("ref-abc-123");
    expect(node.id).toBe("practice-area/task-slug");
    expect(node.name).toBe("Draft a contract");

    expect(node).not.toHaveProperty("extra_secret");
    expect(node).not.toHaveProperty("properties");
    expect(node).not.toHaveProperty("node_type");
  });

  test("falls back to ref_id when properties.id is absent", async () => {
    const nodeNoId = { ...EVAL_SET_NODE, properties: { name: "No ID node" } };
    mockSearchNodesByAttributes.mockResolvedValue({ ok: true, nodes: [nodeNoId] });

    const result = await listRecursionEvalSets(CONFIG, "dispatch");

    expect(result.ok).toBe(true);
    expect(result.nodes![0].id).toBe("ref-abc-123");
  });

  test("dispatch: returns empty nodes array and logs distinct signal on zero results", async () => {
    mockSearchNodesByAttributes.mockResolvedValue({ ok: true, nodes: [] });

    const result = await listRecursionEvalSets(CONFIG, "dispatch");

    expect(result.ok).toBe(true);
    expect(result.nodes).toEqual([]);

    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining("zero nodes"),
      "legal",
      expect.objectContaining({ possibleMissingAttribute: true }),
    );
  });

  test("list: logs possibleMissingAttribute only when both queries return empty", async () => {
    mockSearchNodesByAttributes.mockResolvedValue({ ok: true, nodes: [] });

    const result = await listRecursionEvalSets(CONFIG, "list");

    expect(result.ok).toBe(true);
    expect(result.nodes).toEqual([]);
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining("zero nodes"),
      "legal",
      expect.objectContaining({ possibleMissingAttribute: true, mode: "list" }),
    );
  });

  test("returns ok: false and error on graph failure", async () => {
    mockSearchNodesByAttributes.mockResolvedValue({
      ok: false,
      nodes: [],
      status: 502,
      error: "Upstream timeout",
    });

    const result = await listRecursionEvalSets(CONFIG, "dispatch");

    expect(result.ok).toBe(false);
    expect(result.error).toBe("Upstream timeout");
    expect(result.nodes).toBeUndefined();
  });

  test("normalizes { ok, nodes } shape from searchNodesByAttributes onto service result type", async () => {
    mockSearchNodesByAttributes.mockResolvedValue({
      ok: true,
      nodes: [EVAL_SET_NODE],
      status: 200,
      endpointMissing: false,
    });

    const result = await listRecursionEvalSets(CONFIG, "dispatch");

    expect(result).toHaveProperty("ok", true);
    expect(result).toHaveProperty("nodes");
    expect(result).not.toHaveProperty("status");
    expect(result).not.toHaveProperty("endpointMissing");
  });
});

// ── setEvalSetRecursion ───────────────────────────────────────────────────────

describe("setEvalSetRecursion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("calls updateNode with correct payload to enable recursion", async () => {
    mockUpdateNode.mockResolvedValue({ success: true });

    await setEvalSetRecursion(CONFIG, "ref-abc-123", true);

    expect(mockUpdateNode).toHaveBeenCalledOnce();
    const [, req] = mockUpdateNode.mock.calls[0] as [unknown, {
      ref_id: string;
      node_type: string;
      node_data: Record<string, unknown>;
    }];
    expect(req.ref_id).toBe("ref-abc-123");
    expect(req.node_type).toBe("EvalSet");
    expect(req.node_data).toMatchObject({ recursion: true });
    expect(typeof (req.node_data as Record<string, unknown>).recursionEnabledAt).toBe("number");
    expect((req.node_data as Record<string, unknown>).recursionEnabledAt as number).toBeGreaterThan(0);
  });

  test("calls updateNode with correct payload to disable recursion", async () => {
    mockUpdateNode.mockResolvedValue({ success: true });

    await setEvalSetRecursion(CONFIG, "ref-abc-123", false);

    const [, req] = mockUpdateNode.mock.calls[0] as [unknown, {
      node_data: Record<string, unknown>;
    }];
    expect(req.node_data).toEqual({ recursion: false });
    // Disabling must NOT stamp recursionEnabledAt
    expect(req.node_data).not.toHaveProperty("recursionEnabledAt");
  });

  test("returns ok: true on success", async () => {
    mockUpdateNode.mockResolvedValue({ success: true });

    const result = await setEvalSetRecursion(CONFIG, "ref-abc-123", true);

    expect(result.ok).toBe(true);
    expect(result.error).toBeUndefined();
  });

  test("returns ok: false with error on graph write failure", async () => {
    mockUpdateNode.mockResolvedValue({ success: false, error: "Node not found in graph" });

    const result = await setEvalSetRecursion(CONFIG, "ref-xyz", false);

    expect(result.ok).toBe(false);
    expect(result.error).toBe("Node not found in graph");
    expect(result.nodes).toBeUndefined();
  });

  test("normalizes { success, error? } shape from updateNode onto service result type", async () => {
    mockUpdateNode.mockResolvedValue({ success: true });

    const result = await setEvalSetRecursion(CONFIG, "ref-abc-123", true);

    // Service result shape: { ok, nodes?, error? } — no raw "success" key
    expect(result).toHaveProperty("ok", true);
    expect(result).not.toHaveProperty("success");
  });

  test("stamps recursionEnabledAt (unix epoch seconds) on enable", async () => {
    mockUpdateNode.mockResolvedValue({ success: true });
    const before = Math.floor(Date.now() / 1000);

    await setEvalSetRecursion(CONFIG, "ref-abc-123", true);

    const after = Math.floor(Date.now() / 1000);
    const [, req] = mockUpdateNode.mock.calls[0] as [unknown, {
      node_data: Record<string, unknown>;
    }];
    const ts = req.node_data.recursionEnabledAt as number;
    expect(typeof ts).toBe("number");
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });

  test("does NOT stamp recursionEnabledAt when disabling", async () => {
    mockUpdateNode.mockResolvedValue({ success: true });

    await setEvalSetRecursion(CONFIG, "ref-abc-123", false);

    const [, req] = mockUpdateNode.mock.calls[0] as [unknown, {
      node_data: Record<string, unknown>;
    }];
    expect(req.node_data).not.toHaveProperty("recursionEnabledAt");
    expect(req.node_data.recursion).toBe(false);
  });
});

// ── enableRecursionForTaskSlug ────────────────────────────────────────────────

describe("enableRecursionForTaskSlug", () => {
  const TASK_SLUG = "practice-area/task-slug";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("resolves EvalSet ref_id from task-slug and calls setEvalSetRecursion with true", async () => {
    mockSearchNodesByAttributes.mockResolvedValue({ ok: true, nodes: [EVAL_SET_NODE] });
    mockUpdateNode.mockResolvedValue({ success: true });

    const result = await enableRecursionForTaskSlug(CONFIG, TASK_SLUG);

    // Search was called with id filter matching the task-slug
    expect(mockSearchNodesByAttributes).toHaveBeenCalledOnce();
    const [, searchParams] = mockSearchNodesByAttributes.mock.calls[0] as [unknown, {
      nodeTypes: string[];
      filters: Array<{ attribute: string; value: unknown; comparator: string }>;
      includeProperties: boolean;
    }];
    // Both casings must be present — regression guard against reverting to single casing
    expect(searchParams.nodeTypes).toContain("EvalSet");
    expect(searchParams.nodeTypes).toContain("Evalset");
    expect(searchParams.nodeTypes).toEqual(EVALSET_NODE_LABELS);
    expect(searchParams.filters).toEqual([{ attribute: "id", value: TASK_SLUG, comparator: "=" }]);
    expect(searchParams.includeProperties).toBe(true);
    // Must bypass jarvis response cache — resolve step reads current state before write
    expect((searchParams as { skipCache?: boolean }).skipCache).toBe(true);

    // updateNode was called with the resolved ref_id and recursion=true
    expect(mockUpdateNode).toHaveBeenCalledOnce();
    const [, updateReq] = mockUpdateNode.mock.calls[0] as [unknown, {
      ref_id: string;
      node_type: string;
      node_data: Record<string, unknown>;
    }];
    expect(updateReq.ref_id).toBe("ref-abc-123");
    expect(updateReq.node_type).toBe("EvalSet");
    // recursionEnabledAt is now stamped when enabling — use toMatchObject so the test
    // doesn't break when the timestamp field is added.
    expect(updateReq.node_data).toMatchObject({ recursion: true });
    expect(typeof (updateReq.node_data as Record<string, unknown>).recursionEnabledAt).toBe("number");

    expect(result.ok).toBe(true);
    expect(result).not.toHaveProperty("notFound");
  });

  test("returns not-found result without calling updateNode when no EvalSet matches", async () => {
    mockSearchNodesByAttributes.mockResolvedValue({ ok: true, nodes: [] });

    const result = await enableRecursionForTaskSlug(CONFIG, "nonexistent/task");

    expect(mockSearchNodesByAttributes).toHaveBeenCalledOnce();
    expect(mockUpdateNode).not.toHaveBeenCalled();

    expect(result.ok).toBe(false);
    expect(result).toHaveProperty("notFound", true);
    expect(result.error).toBeDefined();
  });

  test("returns error without calling updateNode when graph search fails", async () => {
    mockSearchNodesByAttributes.mockResolvedValue({
      ok: false,
      nodes: [],
      error: "Upstream timeout",
    });

    const result = await enableRecursionForTaskSlug(CONFIG, TASK_SLUG);

    expect(mockUpdateNode).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    expect(result.error).toBe("Upstream timeout");
    expect(result).not.toHaveProperty("notFound");
  });

  test("returns error when graph write fails after resolving ref_id", async () => {
    mockSearchNodesByAttributes.mockResolvedValue({ ok: true, nodes: [EVAL_SET_NODE] });
    mockUpdateNode.mockResolvedValue({ success: false, error: "Write conflict" });

    const result = await enableRecursionForTaskSlug(CONFIG, TASK_SLUG);

    expect(mockUpdateNode).toHaveBeenCalledOnce();
    expect(result.ok).toBe(false);
    expect(result.error).toBe("Write conflict");
    expect(result).not.toHaveProperty("notFound");
  });

  test("is idempotent — enabling an already-true flag succeeds", async () => {
    // EvalSet already has recursion=true; enabling again should still succeed
    mockSearchNodesByAttributes.mockResolvedValue({ ok: true, nodes: [EVAL_SET_NODE] });
    mockUpdateNode.mockResolvedValue({ success: true });

    const result = await enableRecursionForTaskSlug(CONFIG, TASK_SLUG);

    expect(result.ok).toBe(true);
    // updateNode is still called (setEvalSetRecursion always writes, which is idempotent on the graph)
    expect(mockUpdateNode).toHaveBeenCalledOnce();
  });

  test("notFound: true only when search returns empty nodes — never on transport failure", async () => {
    // Transport failure: ok=false → must return error, NOT notFound
    mockSearchNodesByAttributes.mockResolvedValue({
      ok: false,
      nodes: [],
      error: "Connection refused",
    });
    const transportResult = await enableRecursionForTaskSlug(CONFIG, TASK_SLUG);
    expect(transportResult.ok).toBe(false);
    expect(transportResult).not.toHaveProperty("notFound");
    expect(transportResult.error).toBe("Connection refused");

    vi.clearAllMocks();

    // Genuine empty result: ok=true, nodes=[] → must return notFound
    mockSearchNodesByAttributes.mockResolvedValue({ ok: true, nodes: [] });
    const emptyResult = await enableRecursionForTaskSlug(CONFIG, "nonexistent/slug");
    expect(emptyResult.ok).toBe(false);
    expect(emptyResult.notFound).toBe(true);
    expect(emptyResult.error).toBeDefined();
    expect(mockUpdateNode).not.toHaveBeenCalled();
  });

  test("deterministic tie-break: selects canonical 'EvalSet'-labelled node and logs warning when multiple nodes match", async () => {
    const evalsetNode = { ...EVAL_SET_NODE, node_type: "Evalset", ref_id: "ref-old-evalset" };
    const canonicalNode = { ...EVAL_SET_NODE, node_type: "EvalSet", ref_id: "ref-canonical-evalset" };

    mockSearchNodesByAttributes.mockResolvedValue({
      ok: true,
      nodes: [evalsetNode, canonicalNode],
    });
    mockUpdateNode.mockResolvedValue({ success: true });

    const result = await enableRecursionForTaskSlug(CONFIG, TASK_SLUG);

    // Warning must be logged
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("multiple EvalSet nodes matched"),
      "legal",
      expect.objectContaining({ taskSlug: TASK_SLUG, count: 2 }),
    );

    // Must pick the canonical "EvalSet" node, not the first (Evalset) one
    expect(mockUpdateNode).toHaveBeenCalledOnce();
    const [, updateReq] = mockUpdateNode.mock.calls[0] as [unknown, { ref_id: string }];
    expect(updateReq.ref_id).toBe("ref-canonical-evalset");

    expect(result.ok).toBe(true);
  });

  test("deterministic tie-break falls back to stable ref_id sort when no canonical node present", async () => {
    const nodeA = { ...EVAL_SET_NODE, node_type: "Evalset", ref_id: "ref-zzz" };
    const nodeB = { ...EVAL_SET_NODE, node_type: "Evalset", ref_id: "ref-aaa" };

    mockSearchNodesByAttributes.mockResolvedValue({
      ok: true,
      nodes: [nodeA, nodeB], // nodeA first, but nodeB has lower ref_id
    });
    mockUpdateNode.mockResolvedValue({ success: true });

    await enableRecursionForTaskSlug(CONFIG, TASK_SLUG);

    // Falls back to lowest ref_id sort
    const [, updateReq] = mockUpdateNode.mock.calls[0] as [unknown, { ref_id: string }];
    expect(updateReq.ref_id).toBe("ref-aaa");
  });

  test("logs resolved ref_id on successful enable", async () => {
    mockSearchNodesByAttributes.mockResolvedValue({ ok: true, nodes: [EVAL_SET_NODE] });
    mockUpdateNode.mockResolvedValue({ success: true });

    await enableRecursionForTaskSlug(CONFIG, TASK_SLUG);

    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining("resolved ref_id=ref-abc-123"),
      "legal",
      expect.objectContaining({ refId: "ref-abc-123", taskSlug: TASK_SLUG }),
    );
  });

  test("enable → list round-trip: list returns the newly-enabled node (mocked jarvis)", async () => {
    // Enable: search finds the node, write succeeds
    mockSearchNodesByAttributes.mockResolvedValueOnce({ ok: true, nodes: [EVAL_SET_NODE] });
    mockUpdateNode.mockResolvedValue({ success: true });

    const enableResult = await enableRecursionForTaskSlug(CONFIG, TASK_SLUG);
    expect(enableResult.ok).toBe(true);

    // List: returns the same node (now with recursion=true)
    mockSearchNodesByAttributes.mockResolvedValueOnce({
      ok: true,
      nodes: [EVAL_SET_NODE],
    });

    const listResult = await listRecursionEvalSets(CONFIG, "dispatch");

    // Both calls use the both-casing nodeTypes list and must send skipCache: true
    for (const [, params] of mockSearchNodesByAttributes.mock.calls as [unknown, { nodeTypes: string[]; skipCache?: boolean }][]) {
      expect(params.nodeTypes).toContain("EvalSet");
      expect(params.nodeTypes).toContain("Evalset");
      // Both the enable-resolve readback and the list read must bypass the jarvis cache
      expect(params.skipCache).toBe(true);
    }

    expect(listResult.ok).toBe(true);
    expect(listResult.nodes).toHaveLength(1);
    expect(listResult.nodes![0].ref_id).toBe("ref-abc-123");
  });
});

// ── EVALSET_NODE_LABELS / isEvalSetLabel helpers ─────────────────────────────

describe("EVALSET_NODE_LABELS and isEvalSetLabel", () => {
  test("EVALSET_NODE_LABELS contains both 'EvalSet' and 'Evalset'", () => {
    expect(EVALSET_NODE_LABELS).toContain("EvalSet");
    expect(EVALSET_NODE_LABELS).toContain("Evalset");
    // Must have at least two entries (regression: not collapsed to a single casing)
    expect(EVALSET_NODE_LABELS.length).toBeGreaterThanOrEqual(2);
  });

  test("isEvalSetLabel returns true for 'EvalSet'", () => {
    expect(isEvalSetLabel("EvalSet")).toBe(true);
  });

  test("isEvalSetLabel returns true for 'Evalset' (stored jarvis label)", () => {
    expect(isEvalSetLabel("Evalset")).toBe(true);
  });

  test("isEvalSetLabel returns true for any casing variant", () => {
    expect(isEvalSetLabel("evalset")).toBe(true);
    expect(isEvalSetLabel("EVALSET")).toBe(true);
    expect(isEvalSetLabel("eVaLsEt")).toBe(true);
  });

  test("isEvalSetLabel returns false for genuinely different node types", () => {
    expect(isEvalSetLabel("Task")).toBe(false);
    expect(isEvalSetLabel("ProposedFix")).toBe(false);
    expect(isEvalSetLabel("EvalTrigger")).toBe(false);
    expect(isEvalSetLabel("")).toBe(false);
  });

  test("isEvalSetLabel returns false for null and undefined", () => {
    expect(isEvalSetLabel(null)).toBe(false);
    expect(isEvalSetLabel(undefined)).toBe(false);
  });
});

// ── resolveEvalSetRefIdBySlug ─────────────────────────────────────────────────

describe("resolveEvalSetRefIdBySlug", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("returns ref_id when a single EvalSet matches the task slug", async () => {
    mockSearchNodesByAttributes.mockResolvedValue({
      ok: true,
      nodes: [{ ref_id: "ref-abc-123", node_type: "EvalSet", properties: { id: "antitrust/task-1" } }],
    });

    const result = await resolveEvalSetRefIdBySlug(CONFIG, "antitrust/task-1");
    expect(result).toBe("ref-abc-123");
  });

  test("sends both EvalSet casings in search", async () => {
    mockSearchNodesByAttributes.mockResolvedValue({ ok: true, nodes: [] });

    await resolveEvalSetRefIdBySlug(CONFIG, "antitrust/task-1");

    const [, params] = mockSearchNodesByAttributes.mock.calls[0] as [unknown, { nodeTypes: string[] }];
    expect(params.nodeTypes).toContain("EvalSet");
    expect(params.nodeTypes).toContain("Evalset");
  });

  test("returns null when no matching EvalSet node found", async () => {
    mockSearchNodesByAttributes.mockResolvedValue({ ok: true, nodes: [] });

    const result = await resolveEvalSetRefIdBySlug(CONFIG, "nonexistent/task");
    expect(result).toBeNull();
  });

  test("returns null when graph search fails", async () => {
    mockSearchNodesByAttributes.mockResolvedValue({ ok: false, error: "Graph error", nodes: [] });

    const result = await resolveEvalSetRefIdBySlug(CONFIG, "antitrust/task-1");
    expect(result).toBeNull();
  });

  test("deterministic tie-break: canonical EvalSet label preferred over Evalset", async () => {
    mockSearchNodesByAttributes.mockResolvedValue({
      ok: true,
      nodes: [
        { ref_id: "ref-old", node_type: "Evalset", properties: { id: "antitrust/task-1" } },
        { ref_id: "ref-new", node_type: "EvalSet", properties: { id: "antitrust/task-1" } },
      ],
    });

    const result = await resolveEvalSetRefIdBySlug(CONFIG, "antitrust/task-1");
    // Canonical "EvalSet" node wins
    expect(result).toBe("ref-new");
  });

  test("deterministic tie-break: lowest ref_id used when no canonical label", async () => {
    mockSearchNodesByAttributes.mockResolvedValue({
      ok: true,
      nodes: [
        { ref_id: "ref-zzz", node_type: "Evalset", properties: { id: "antitrust/task-1" } },
        { ref_id: "ref-aaa", node_type: "Evalset", properties: { id: "antitrust/task-1" } },
      ],
    });

    const result = await resolveEvalSetRefIdBySlug(CONFIG, "antitrust/task-1");
    // Lowest ref_id for stability
    expect(result).toBe("ref-aaa");
  });

  test("sends id filter with exact match comparator", async () => {
    mockSearchNodesByAttributes.mockResolvedValue({ ok: true, nodes: [] });

    await resolveEvalSetRefIdBySlug(CONFIG, "practice-area/task-slug");

    const [, params] = mockSearchNodesByAttributes.mock.calls[0] as [unknown, {
      filters: Array<{ attribute: string; value: unknown; comparator: string }>;
    }];
    expect(params.filters).toHaveLength(1);
    const filter = params.filters[0];
    expect(filter.attribute).toBe("id");
    expect(filter.value).toBe("practice-area/task-slug");
    expect(filter.comparator).toBe("=");
  });
});

// ── listRecursionEvalSets — dispatch vs list (implementation-style) ───────────

describe("listRecursionEvalSets — dispatch vs list (implementation-style)", () => {
  const ACTIVE_NODE = {
    ref_id: "ref-active",
    node_type: "EvalSet",
    properties: { id: "tax/task-1", name: "Tax Task 1", recursion: true, project_id: 42 },
  };
  const LIVE_OFF_NODE = {
    ref_id: "ref-live-off",
    node_type: "EvalSet",
    properties: {
      id: "contracts/task-2",
      name: "Contracts Task 2",
      recursion: false,
      recursionEnabledAt: 1700000000,
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockGroupBy.mockResolvedValue([]);
  });

  function byRecursionValue(trueNodes: unknown[], falseNodes: unknown[] = []) {
    return (
      _config: unknown,
      params: { filters: Array<{ attribute: string; value: unknown }> },
    ) => {
      const filter = params.filters[0];
      if (filter?.attribute === "recursion" && filter.value === true) {
        return Promise.resolve({ ok: true, nodes: trueNodes });
      }
      if (filter?.attribute === "recursion" && filter.value === false) {
        return Promise.resolve({ ok: true, nodes: falseNodes });
      }
      return Promise.resolve({ ok: true, nodes: [] });
    };
  }

  test("dispatch: nodes where recursion=true have reason 'active'", async () => {
    mockSearchNodesByAttributes.mockImplementation(byRecursionValue([ACTIVE_NODE]));

    const result = await listRecursionEvalSets(CONFIG, "dispatch");

    expect(result.ok).toBe(true);
    const active = result.nodes?.find((n) => n.ref_id === "ref-active");
    expect(active?.reason).toBe("active");
    expect(active?.recursion).toBe(true);
    expect(active?.id).toBe("tax/task-1");
    expect(active?.name).toBe("Tax Task 1");
    expect(active?.projectId).toBe(42);
  });

  test("dispatch true-query failure returns ok: false", async () => {
    mockSearchNodesByAttributes.mockImplementation(
      (_config: unknown, params: { filters: Array<{ attribute: string; value: unknown }> }) => {
        if (params.filters[0]?.attribute === "recursion" && params.filters[0]?.value === true) {
          return Promise.resolve({ ok: false, nodes: [], error: "Graph unavailable" });
        }
        return Promise.resolve({ ok: true, nodes: [] });
      },
    );

    const result = await listRecursionEvalSets(CONFIG, "dispatch");

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Graph unavailable/);
  });

  test("list: live-off node with leftover timestamp is listed without reason", async () => {
    mockSearchNodesByAttributes.mockImplementation(byRecursionValue([], [LIVE_OFF_NODE]));

    const result = await listRecursionEvalSets(CONFIG, "list");

    expect(result.ok).toBe(true);
    const liveOff = result.nodes?.find((n) => n.ref_id === "ref-live-off");
    expect(liveOff).toBeDefined();
    expect(liveOff?.reason).toBeUndefined();
    expect(liveOff?.recursion).toBe(false);
    expect(liveOff?.recursionEnabledAt).toBe(1700000000);
  });

  test("dispatch never selects a leftover-timestamp live-off node", async () => {
    mockSearchNodesByAttributes.mockImplementation(byRecursionValue([], [LIVE_OFF_NODE]));

    const result = await listRecursionEvalSets(CONFIG, "dispatch");

    expect(result.ok).toBe(true);
    expect(result.nodes?.find((n) => n.ref_id === "ref-live-off")).toBeUndefined();
    expect(recursionCalls().every((p) => p.filters[0].value === true)).toBe(true);
  });

  test("groupBy is never called in either mode even when mock is primed", async () => {
    mockGroupBy.mockResolvedValue([{ evalSetId: "antitrust/task-3", _count: { evalSetId: 3 } }]);
    mockSearchNodesByAttributes.mockImplementation(byRecursionValue([ACTIVE_NODE], [LIVE_OFF_NODE]));

    await listRecursionEvalSets(CONFIG, "dispatch");
    await listRecursionEvalSets(CONFIG, "list");

    expect(mockGroupBy).not.toHaveBeenCalled();
  });

  test("list false-query failure still returns true nodes with no partial flag", async () => {
    mockSearchNodesByAttributes.mockImplementation(
      (_config: unknown, params: { filters: Array<{ attribute: string; value: unknown }> }) => {
        if (params.filters[0]?.attribute === "recursion" && params.filters[0]?.value === true) {
          return Promise.resolve({ ok: true, nodes: [ACTIVE_NODE] });
        }
        return Promise.resolve({ ok: false, nodes: [], error: "Jarvis rejected false" });
      },
    );

    const result = await listRecursionEvalSets(CONFIG, "list");

    expect(result.ok).toBe(true);
    expect(result).not.toHaveProperty("partial");
    expect(result.nodes?.find((n) => n.ref_id === "ref-active")?.reason).toBe("active");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("recursion=false query failed"),
      expect.anything(),
      expect.anything(),
    );
  });

  test("list true-query failure returns ok: false even if false query would succeed", async () => {
    mockSearchNodesByAttributes.mockImplementation(
      (_config: unknown, params: { filters: Array<{ attribute: string; value: unknown }> }) => {
        if (params.filters[0]?.value === true) {
          return Promise.resolve({ ok: false, nodes: [], error: "Graph unavailable" });
        }
        return Promise.resolve({ ok: true, nodes: [LIVE_OFF_NODE] });
      },
    );

    const result = await listRecursionEvalSets(CONFIG, "list");

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Graph unavailable/);
    expect(mockSearchNodesByAttributes).toHaveBeenCalledTimes(1);
  });

  test("dedup: same ref_id from true and false filters appears once with reason active", async () => {
    const sharedNode = {
      ref_id: "ref-shared",
      node_type: "EvalSet",
      properties: { id: "shared/task", name: "Shared Task", recursion: true, recursionEnabledAt: 1700000000 },
    };
    mockSearchNodesByAttributes.mockImplementation(byRecursionValue([sharedNode], [sharedNode]));

    const result = await listRecursionEvalSets(CONFIG, "list");

    const sharedEntries = result.nodes?.filter((n) => n.ref_id === "ref-shared");
    expect(sharedEntries).toHaveLength(1);
    expect(sharedEntries![0].reason).toBe("active");
  });

  test("list true empty + false non-empty does not log possibleMissingAttribute", async () => {
    mockSearchNodesByAttributes.mockImplementation(byRecursionValue([], [LIVE_OFF_NODE]));

    const result = await listRecursionEvalSets(CONFIG, "list");

    expect(result.ok).toBe(true);
    expect(result.nodes).toHaveLength(1);
    expect(logger.info).not.toHaveBeenCalledWith(
      expect.stringContaining("zero nodes"),
      "legal",
      expect.objectContaining({ possibleMissingAttribute: true }),
    );
  });
});
