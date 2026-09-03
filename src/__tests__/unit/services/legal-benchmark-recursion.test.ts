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
const WORKSPACE_ID = "ws-openlaw-123";

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

// ── listRecursionEvalSets — three-source merge ────────────────────────────────

describe("listRecursionEvalSets — three-source merge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.stakworkRun.groupBy).mockResolvedValue([]);
  });

  const makeNode = (ref_id: string, overrides: Record<string, unknown> = {}) => ({
    ref_id,
    node_type: "EvalSet",
    properties: { id: `task/${ref_id}`, name: `Task ${ref_id}`, ...overrides },
  });

  // ── Source 1 (active) ───────────────────────────────────────────────────

  test("Source 1: node with recursion=true appears with reason 'active'", async () => {
    const node = makeNode("ref-active");
    // Source 1 returns node; Source 2 returns empty; Source 3 returns no DB rows
    mockSearchNodesByAttributes
      .mockResolvedValueOnce({ ok: true, nodes: [node] })  // Source 1
      .mockResolvedValueOnce({ ok: true, nodes: [] });      // Source 2
    vi.mocked(db.stakworkRun.groupBy).mockResolvedValue([]);

    const result = await listRecursionEvalSets(CONFIG, WORKSPACE_ID);

    expect(result.ok).toBe(true);
    const entry = result.nodes?.find((n) => n.ref_id === "ref-active");
    expect(entry).toBeDefined();
    expect(entry?.reason).toBe("active");
  });

  test("Source 1: dateAddedToGraph comes from the node's top-level date_added_to_graph", async () => {
    const stamped = { ...makeNode("ref-stamped"), date_added_to_graph: 1756000000 };
    const unstamped = makeNode("ref-unstamped");
    mockSearchNodesByAttributes
      .mockResolvedValueOnce({ ok: true, nodes: [stamped, unstamped] })  // Source 1
      .mockResolvedValueOnce({ ok: true, nodes: [] });                    // Source 2
    vi.mocked(db.stakworkRun.groupBy).mockResolvedValue([]);

    const result = await listRecursionEvalSets(CONFIG, WORKSPACE_ID);

    expect(result.nodes?.find((n) => n.ref_id === "ref-stamped")?.dateAddedToGraph).toBe(
      new Date(1756000000 * 1000).toISOString(),
    );
    expect(result.nodes?.find((n) => n.ref_id === "ref-unstamped")?.dateAddedToGraph).toBeNull();
  });

  test("Source 1 failure returns { ok: false } (authoritative)", async () => {
    mockSearchNodesByAttributes.mockResolvedValueOnce({ ok: false, nodes: [], error: "Jarvis down" });
    // Source 2 + 3 would still run but result should still be failure
    mockSearchNodesByAttributes.mockResolvedValue({ ok: true, nodes: [] });

    const result = await listRecursionEvalSets(CONFIG, WORKSPACE_ID);

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Jarvis down|Graph query failed/);
  });

  // ── Source 2 (wasEnabled) ───────────────────────────────────────────────

  test("Source 2: node with recursionEnabledAt set appears with reason 'wasEnabled'", async () => {
    const node = makeNode("ref-was-enabled", { recursionEnabledAt: 1700000000 });
    // Source 1 returns empty; Source 2 returns the wasEnabled node
    mockSearchNodesByAttributes
      .mockResolvedValueOnce({ ok: true, nodes: [] })       // Source 1
      .mockResolvedValueOnce({ ok: true, nodes: [node] }); // Source 2

    const result = await listRecursionEvalSets(CONFIG, WORKSPACE_ID);

    expect(result.ok).toBe(true);
    const entry = result.nodes?.find((n) => n.ref_id === "ref-was-enabled");
    expect(entry).toBeDefined();
    expect(entry?.reason).toBe("wasEnabled");
  });

  test("Source 2 sends recursionEnabledAt != null filter", async () => {
    mockSearchNodesByAttributes
      .mockResolvedValueOnce({ ok: true, nodes: [] }) // Source 1
      .mockResolvedValueOnce({ ok: true, nodes: [] }); // Source 2

    await listRecursionEvalSets(CONFIG, WORKSPACE_ID);

    // Source 2 call is the second call
    const [, params] = mockSearchNodesByAttributes.mock.calls[1] as [
      unknown,
      { filters: Array<{ attribute: string; value: unknown; comparator: string }> },
    ];
    expect(params.filters[0].attribute).toBe("recursionEnabledAt");
    expect(params.filters[0].value).toBeNull();
    expect(params.filters[0].comparator).toBe("!=");
  });

  test("Source 2 failure: partial=true, Source 1 results preserved", async () => {
    const s1Node = makeNode("ref-active");
    mockSearchNodesByAttributes
      .mockResolvedValueOnce({ ok: true, nodes: [s1Node] }) // Source 1
      .mockResolvedValueOnce({ ok: false, nodes: [], error: "Jarvis unreachable" }); // Source 2 fails

    const result = await listRecursionEvalSets(CONFIG, WORKSPACE_ID);

    expect(result.ok).toBe(true);
    expect(result.partial).toBe(true);
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes![0].ref_id).toBe("ref-active");
    expect(result.nodes![0].reason).toBe("active");
  });

  test("Source 2 rejection (throws): partial=true, Source 1 results preserved", async () => {
    const s1Node = makeNode("ref-active");
    mockSearchNodesByAttributes
      .mockResolvedValueOnce({ ok: true, nodes: [s1Node] }) // Source 1 ok
      .mockRejectedValueOnce(new Error("Network error"));   // Source 2 throws

    const result = await listRecursionEvalSets(CONFIG, WORKSPACE_ID);

    expect(result.ok).toBe(true);
    expect(result.partial).toBe(true);
    expect(result.nodes![0].reason).toBe("active");
  });

  // ── Source 3 (multipleRuns) ─────────────────────────────────────────────

  test("Source 3: evalSetId with >1 LEGAL_BENCHMARK_RUNNER runs appears with reason 'multipleRuns'", async () => {
    const s3Node = makeNode("ref-multi");
    // Source 1: empty; Source 2: empty; Source 3: DB returns one multi-run evalSetId
    mockSearchNodesByAttributes
      .mockResolvedValueOnce({ ok: true, nodes: [] })        // Source 1
      .mockResolvedValueOnce({ ok: true, nodes: [] })        // Source 2
      .mockResolvedValueOnce({ ok: true, nodes: [s3Node] }); // Source 3 graph lookup
    vi.mocked(db.stakworkRun.groupBy).mockResolvedValue([
      { evalSetId: "task/ref-multi", _count: { evalSetId: 2 } } as never,
    ]);

    const result = await listRecursionEvalSets(CONFIG, WORKSPACE_ID);

    expect(result.ok).toBe(true);
    const entry = result.nodes?.find((n) => n.ref_id === "ref-multi");
    expect(entry).toBeDefined();
    expect(entry?.reason).toBe("multipleRuns");
  });

  test("Source 3 is skipped when workspaceId is absent (one-arg cron call)", async () => {
    mockSearchNodesByAttributes
      .mockResolvedValueOnce({ ok: true, nodes: [] }) // Source 1
      .mockResolvedValueOnce({ ok: true, nodes: [] }); // Source 2

    await listRecursionEvalSets(CONFIG); // no workspaceId

    // groupBy must NOT have been called
    expect(db.stakworkRun.groupBy).not.toHaveBeenCalled();
  });

  test("Source 3 DB failure: partial=true, Sources 1+2 preserved", async () => {
    const s1Node = makeNode("ref-active");
    mockSearchNodesByAttributes
      .mockResolvedValueOnce({ ok: true, nodes: [s1Node] }) // Source 1
      .mockResolvedValueOnce({ ok: true, nodes: [] });       // Source 2
    vi.mocked(db.stakworkRun.groupBy).mockRejectedValue(new Error("DB connection error"));

    const result = await listRecursionEvalSets(CONFIG, WORKSPACE_ID);

    expect(result.ok).toBe(true);
    expect(result.partial).toBe(true);
    expect(result.nodes).toHaveLength(1);
    expect(result.nodes![0].reason).toBe("active");
  });

  test("Source 3 cap: 51 IDs → only 50 resolved, logger.warn emitted", async () => {
    const ids = Array.from({ length: 51 }, (_, i) => `eval-set-${i}`);
    vi.mocked(db.stakworkRun.groupBy).mockResolvedValue(
      ids.map((id) => ({ evalSetId: id, _count: { evalSetId: 2 } }) as never),
    );
    mockSearchNodesByAttributes
      .mockResolvedValueOnce({ ok: true, nodes: [] }) // Source 1
      .mockResolvedValueOnce({ ok: true, nodes: [] }) // Source 2
      .mockResolvedValue({ ok: true, nodes: [] }); // Source 3 per-ID lookups

    await listRecursionEvalSets(CONFIG, WORKSPACE_ID);

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("capping eval set ID resolution at 50"),
      "legal",
      expect.objectContaining({ workspaceId: WORKSPACE_ID }),
    );
    // 50 graph lookups (+ 2 for Source 1 & 2)
    expect(mockSearchNodesByAttributes).toHaveBeenCalledTimes(52);
  });

  // ── Deduplication ───────────────────────────────────────────────────────

  test("Dedup: node qualifying under both 'active' and 'wasEnabled' appears once with reason 'active'", async () => {
    const node = makeNode("ref-dup");
    // Source 1 returns the node (active); Source 2 also returns it (wasEnabled)
    mockSearchNodesByAttributes
      .mockResolvedValueOnce({ ok: true, nodes: [node] }) // Source 1
      .mockResolvedValueOnce({ ok: true, nodes: [node] }); // Source 2

    const result = await listRecursionEvalSets(CONFIG, WORKSPACE_ID);

    const matching = result.nodes?.filter((n) => n.ref_id === "ref-dup") ?? [];
    expect(matching).toHaveLength(1);
    expect(matching[0].reason).toBe("active");
  });

  test("Dedup: node qualifying under 'wasEnabled' and 'multipleRuns' appears once with reason 'wasEnabled'", async () => {
    const node = makeNode("ref-dup2", { recursionEnabledAt: 1700000000 });
    mockSearchNodesByAttributes
      .mockResolvedValueOnce({ ok: true, nodes: [] })        // Source 1: not active
      .mockResolvedValueOnce({ ok: true, nodes: [node] })   // Source 2: wasEnabled
      .mockResolvedValueOnce({ ok: true, nodes: [node] });  // Source 3 graph lookup
    vi.mocked(db.stakworkRun.groupBy).mockResolvedValue([
      { evalSetId: `task/ref-dup2`, _count: { evalSetId: 2 } } as never,
    ]);

    const result = await listRecursionEvalSets(CONFIG, WORKSPACE_ID);

    const matching = result.nodes?.filter((n) => n.ref_id === "ref-dup2") ?? [];
    expect(matching).toHaveLength(1);
    expect(matching[0].reason).toBe("wasEnabled");
  });

  test("Dedup: all three conditions → appears once with reason 'active'", async () => {
    const node = makeNode("ref-all-three");
    mockSearchNodesByAttributes
      .mockResolvedValueOnce({ ok: true, nodes: [node] })   // Source 1
      .mockResolvedValueOnce({ ok: true, nodes: [node] })   // Source 2
      .mockResolvedValueOnce({ ok: true, nodes: [node] });  // Source 3 graph lookup
    vi.mocked(db.stakworkRun.groupBy).mockResolvedValue([
      { evalSetId: "task/ref-all-three", _count: { evalSetId: 3 } } as never,
    ]);

    const result = await listRecursionEvalSets(CONFIG, WORKSPACE_ID);

    const matching = result.nodes?.filter((n) => n.ref_id === "ref-all-three") ?? [];
    expect(matching).toHaveLength(1);
    expect(matching[0].reason).toBe("active");
  });

  // ── selectEvalSetByTieBreak + property extraction ──────────────────────

  test("Source 3: id/name/projectId come from node.properties, not bare ref_id", async () => {
    const node = {
      ref_id: "ref-s3",
      node_type: "EvalSet",
      properties: {
        id: "contracts/draft-sla",
        name: "Draft SLA",
        project_id: 42,
      },
    };
    mockSearchNodesByAttributes
      .mockResolvedValueOnce({ ok: true, nodes: [] })        // Source 1
      .mockResolvedValueOnce({ ok: true, nodes: [] })        // Source 2
      .mockResolvedValueOnce({ ok: true, nodes: [node] });  // Source 3 graph lookup
    vi.mocked(db.stakworkRun.groupBy).mockResolvedValue([
      { evalSetId: "contracts/draft-sla", _count: { evalSetId: 2 } } as never,
    ]);

    const result = await listRecursionEvalSets(CONFIG, WORKSPACE_ID);

    const entry = result.nodes?.find((n) => n.ref_id === "ref-s3");
    expect(entry?.id).toBe("contracts/draft-sla");
    expect(entry?.name).toBe("Draft SLA");
    expect(entry?.projectId).toBe(42);
    // id must NOT be the bare ref_id string
    expect(entry?.id).not.toBe("ref-s3");
  });

  // ── no partial when all sources succeed ────────────────────────────────

  test("partial is absent when all sources succeed", async () => {
    mockSearchNodesByAttributes
      .mockResolvedValueOnce({ ok: true, nodes: [] }) // Source 1
      .mockResolvedValueOnce({ ok: true, nodes: [] }); // Source 2
    vi.mocked(db.stakworkRun.groupBy).mockResolvedValue([]);

    const result = await listRecursionEvalSets(CONFIG, WORKSPACE_ID);

    expect(result.partial).toBeUndefined();
  });
});

// ── listRecursionEvalSets ─────────────────────────────────────────────────────

describe("listRecursionEvalSets", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("calls searchNodesByAttributes with correct Source 1 filter shape (recursion=true)", async () => {
    // Source 2 (wasEnabled) must be mocked to return ok so it doesn't throw
    mockSearchNodesByAttributes.mockResolvedValue({ ok: true, nodes: [EVAL_SET_NODE] });

    await listRecursionEvalSets(CONFIG);

    // Now called at least twice: Source 1 (recursion=true) + Source 2 (recursionEnabledAt!=null)
    expect(mockSearchNodesByAttributes).toHaveBeenCalled();

    // Source 1 is the first call — find it by its filter attribute
    const source1Call = (mockSearchNodesByAttributes.mock.calls as [unknown, {
      nodeTypes: string[];
      filters: Array<{ attribute: string; value: unknown; comparator: string }>;
      includeProperties: boolean;
      skipCache?: boolean;
    }][]).find(([, params]) => params.filters[0]?.attribute === "recursion");
    expect(source1Call).toBeDefined();
    const [, params] = source1Call!;

    // Both casings must be present — regression guard against reverting to a single casing
    expect(params.nodeTypes).toContain("EvalSet");
    expect(params.nodeTypes).toContain("Evalset");
    expect(params.nodeTypes).toEqual(EVALSET_NODE_LABELS);
    expect(params.includeProperties).toBe(true);
    expect(params.filters).toHaveLength(1);
    const filter = params.filters[0];
    expect(filter.attribute).toBe("recursion");
    expect(filter.value).toBe(true);           // boolean, not string
    expect(filter.comparator).toBe("=");        // exact match, not "eq"
    // Must bypass jarvis response cache — admin toggle list must always be fresh
    expect(params.skipCache).toBe(true);
  });

  test("returns normalized result with ok: true and whitelisted nodes", async () => {
    mockSearchNodesByAttributes.mockResolvedValue({ ok: true, nodes: [EVAL_SET_NODE] });

    const result = await listRecursionEvalSets(CONFIG);

    expect(result.ok).toBe(true);
    expect(result.nodes).toHaveLength(1);
    const node = result.nodes![0];
    expect(node.ref_id).toBe("ref-abc-123");
    expect(node.id).toBe("practice-area/task-slug");
    expect(node.name).toBe("Draft a contract");

    // Whitelist check — no raw properties leaked
    expect(node).not.toHaveProperty("extra_secret");
    expect(node).not.toHaveProperty("properties");
    expect(node).not.toHaveProperty("node_type");
  });

  test("falls back to ref_id when properties.id is absent", async () => {
    const nodeNoId = { ...EVAL_SET_NODE, properties: { name: "No ID node" } };
    mockSearchNodesByAttributes.mockResolvedValue({ ok: true, nodes: [nodeNoId] });

    const result = await listRecursionEvalSets(CONFIG);

    expect(result.ok).toBe(true);
    expect(result.nodes![0].id).toBe("ref-abc-123");
  });

  test("returns empty nodes array and logs distinct signal on zero results", async () => {
    mockSearchNodesByAttributes.mockResolvedValue({ ok: true, nodes: [] });

    const result = await listRecursionEvalSets(CONFIG);

    expect(result.ok).toBe(true);
    expect(result.nodes).toEqual([]);

    // Distinct signal for possible missing attribute
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining("zero nodes"),
      "legal",
      expect.objectContaining({ possibleMissingAttribute: true }),
    );
  });

  test("returns ok: false and error on graph failure", async () => {
    mockSearchNodesByAttributes.mockResolvedValue({
      ok: false,
      nodes: [],
      status: 502,
      error: "Upstream timeout",
    });

    const result = await listRecursionEvalSets(CONFIG);

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

    const result = await listRecursionEvalSets(CONFIG);

    // Service result only exposes { ok, nodes?, error? } — no raw status/endpointMissing
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

    const listResult = await listRecursionEvalSets(CONFIG);

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

// ── listRecursionEvalSets — three-source merge ────────────────────────────────

describe("listRecursionEvalSets — three-source merge", () => {
  const ACTIVE_NODE = {
    ref_id: "ref-active",
    node_type: "EvalSet",
    properties: { id: "tax/task-1", name: "Tax Task 1", recursion: true },
  };
  const WAS_ENABLED_NODE = {
    ref_id: "ref-was-enabled",
    node_type: "EvalSet",
    properties: { id: "contracts/task-2", name: "Contracts Task 2", recursionEnabledAt: 1700000000 },
  };
  const MULTI_RUN_NODE = {
    ref_id: "ref-multi-run",
    node_type: "EvalSet",
    properties: { id: "antitrust/task-3", name: "Antitrust Task 3" },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // By default Source 3 (Prisma groupBy) returns no multi-run groups
    mockGroupBy.mockResolvedValue([]);
  });

  // ── Source 1: active ──────────────────────────────────────────────────────

  test("Source 1: nodes where recursion=true have reason 'active'", async () => {
    // Source 1 returns active node
    mockSearchNodesByAttributes.mockImplementation(
      (_config: unknown, params: { filters: Array<{ attribute: string }> }) => {
        const attr = params.filters[0]?.attribute;
        if (attr === "recursion") return Promise.resolve({ ok: true, nodes: [ACTIVE_NODE] });
        // Source 2 (wasEnabled) returns empty
        return Promise.resolve({ ok: true, nodes: [] });
      },
    );

    const result = await listRecursionEvalSets(CONFIG);

    expect(result.ok).toBe(true);
    const active = result.nodes?.find((n) => n.ref_id === "ref-active");
    expect(active?.reason).toBe("active");
  });

  test("Source 1 failure returns ok: false (authoritative)", async () => {
    mockSearchNodesByAttributes.mockImplementation(
      (_config: unknown, params: { filters: Array<{ attribute: string }> }) => {
        if (params.filters[0]?.attribute === "recursion") {
          return Promise.resolve({ ok: false, nodes: [], error: "Graph unavailable" });
        }
        return Promise.resolve({ ok: true, nodes: [] });
      },
    );

    const result = await listRecursionEvalSets(CONFIG, WORKSPACE_ID);

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Graph unavailable/);
  });

  // ── Source 2: wasEnabled ──────────────────────────────────────────────────

  test("Source 2: nodes where recursionEnabledAt is set have reason 'wasEnabled'", async () => {
    mockSearchNodesByAttributes.mockImplementation(
      (_config: unknown, params: { filters: Array<{ attribute: string }> }) => {
        const attr = params.filters[0]?.attribute;
        if (attr === "recursion") return Promise.resolve({ ok: true, nodes: [] });
        if (attr === "recursionEnabledAt") return Promise.resolve({ ok: true, nodes: [WAS_ENABLED_NODE] });
        return Promise.resolve({ ok: true, nodes: [] });
      },
    );

    const result = await listRecursionEvalSets(CONFIG, WORKSPACE_ID);

    expect(result.ok).toBe(true);
    const wasEnabled = result.nodes?.find((n) => n.ref_id === "ref-was-enabled");
    expect(wasEnabled?.reason).toBe("wasEnabled");
  });

  test("Source 2 failure: partial=true, Source 1 results still returned", async () => {
    mockSearchNodesByAttributes.mockImplementation(
      (_config: unknown, params: { filters: Array<{ attribute: string }> }) => {
        const attr = params.filters[0]?.attribute;
        if (attr === "recursion") return Promise.resolve({ ok: true, nodes: [ACTIVE_NODE] });
        // Source 2 "!=" attempt fails, fallback also fails
        return Promise.resolve({ ok: false, nodes: [], error: "Jarvis rejected !=" });
      },
    );

    const result = await listRecursionEvalSets(CONFIG, WORKSPACE_ID);

    expect(result.ok).toBe(true);
    expect(result.partial).toBe(true);
    expect(result.nodes?.find((n) => n.ref_id === "ref-active")?.reason).toBe("active");
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("Source 2"),
      expect.anything(),
      expect.anything(),
    );
  });

  // ── Source 3: multipleRuns ────────────────────────────────────────────────

  test("Source 3: eval sets with multiple runs have reason 'multipleRuns'", async () => {
    mockGroupBy.mockResolvedValue([
      { evalSetId: "antitrust/task-3", _count: { evalSetId: 3 } },
    ]);
    mockSearchNodesByAttributes.mockImplementation(
      (_config: unknown, params: { filters: Array<{ attribute: string; value: unknown }> }) => {
        const attr = params.filters[0]?.attribute;
        const val = params.filters[0]?.value;
        if (attr === "recursion") return Promise.resolve({ ok: true, nodes: [] });
        if (attr === "recursionEnabledAt") return Promise.resolve({ ok: true, nodes: [] });
        // Source 3 lookup by id
        if (attr === "id" && val === "antitrust/task-3") {
          return Promise.resolve({ ok: true, nodes: [MULTI_RUN_NODE] });
        }
        return Promise.resolve({ ok: true, nodes: [] });
      },
    );

    const result = await listRecursionEvalSets(CONFIG, WORKSPACE_ID);

    expect(result.ok).toBe(true);
    const multiRun = result.nodes?.find((n) => n.ref_id === "ref-multi-run");
    expect(multiRun?.reason).toBe("multipleRuns");
    // id/name/projectId come from node.properties, not bare ref_id
    expect(multiRun?.id).toBe("antitrust/task-3");
    expect(multiRun?.name).toBe("Antitrust Task 3");
  });

  test("Source 3: skipped entirely when workspaceId is absent", async () => {
    mockGroupBy.mockResolvedValue([
      { evalSetId: "antitrust/task-3", _count: { evalSetId: 3 } },
    ]);
    mockSearchNodesByAttributes.mockResolvedValue({ ok: true, nodes: [] });

    // Call without workspaceId (one-arg form — cron call site)
    const result = await listRecursionEvalSets(CONFIG);

    expect(result.ok).toBe(true);
    expect(mockGroupBy).not.toHaveBeenCalled();
  });

  test("Source 3: Prisma groupBy throw yields partial=true, Sources 1+2 still returned", async () => {
    mockGroupBy.mockRejectedValue(new Error("DB connection failed"));
    mockSearchNodesByAttributes.mockImplementation(
      (_config: unknown, params: { filters: Array<{ attribute: string }> }) => {
        const attr = params.filters[0]?.attribute;
        if (attr === "recursion") return Promise.resolve({ ok: true, nodes: [ACTIVE_NODE] });
        if (attr === "recursionEnabledAt") return Promise.resolve({ ok: true, nodes: [WAS_ENABLED_NODE] });
        return Promise.resolve({ ok: true, nodes: [] });
      },
    );

    const result = await listRecursionEvalSets(CONFIG, WORKSPACE_ID);

    expect(result.ok).toBe(true);
    expect(result.partial).toBe(true);
    expect(result.nodes?.find((n) => n.ref_id === "ref-active")).toBeDefined();
    expect(result.nodes?.find((n) => n.ref_id === "ref-was-enabled")).toBeDefined();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("Source 3"),
      expect.anything(),
      expect.anything(),
    );
  });

  test("Source 3: synchronous throw inside async thunk is treated as rejected settlement", async () => {
    // groupBy resolves, but the resulting IDs cause a synchronous error somewhere in the chain.
    // We simulate this by making groupBy return a value that causes an issue in the
    // Promise.allSettled flow — here we make groupBy itself throw synchronously.
    // Since source3 is an async thunk, synchronous throws become rejections.
    mockGroupBy.mockImplementation(() => { throw new Error("Sync throw"); });
    mockSearchNodesByAttributes.mockImplementation(
      (_config: unknown, params: { filters: Array<{ attribute: string }> }) => {
        if (params.filters[0]?.attribute === "recursion") return Promise.resolve({ ok: true, nodes: [ACTIVE_NODE] });
        return Promise.resolve({ ok: true, nodes: [] });
      },
    );

    const result = await listRecursionEvalSets(CONFIG, WORKSPACE_ID);

    // Sync throw inside async thunk → rejected settlement → non-fatal
    expect(result.ok).toBe(true);
    expect(result.partial).toBe(true);
    expect(result.nodes?.find((n) => n.ref_id === "ref-active")).toBeDefined();
  });

  test("Source 3: caps at 50 IDs and logs a warning when groupBy returns >50 rows", async () => {
    const fiftyOneGroups = Array.from({ length: 51 }, (_, i) => ({
      evalSetId: `task-${i}`,
      _count: { evalSetId: 2 },
    }));
    mockGroupBy.mockResolvedValue(fiftyOneGroups);
    mockSearchNodesByAttributes.mockImplementation(
      (_config: unknown, params: { filters: Array<{ attribute: string }> }) => {
        if (params.filters[0]?.attribute === "recursion") return Promise.resolve({ ok: true, nodes: [] });
        if (params.filters[0]?.attribute === "recursionEnabledAt") return Promise.resolve({ ok: true, nodes: [] });
        return Promise.resolve({ ok: true, nodes: [] });
      },
    );

    const result = await listRecursionEvalSets(CONFIG, WORKSPACE_ID);

    expect(result.ok).toBe(true);
    // searchNodesByAttributes called for: Source 1 (1) + Source 2 (1) + Source 3 (50 max) = 52 calls
    const idLookupCalls = mockSearchNodesByAttributes.mock.calls.filter(
      ([, params]: [unknown, { filters: Array<{ attribute: string }> }]) =>
        params.filters[0]?.attribute === "id",
    );
    expect(idLookupCalls.length).toBeLessThanOrEqual(50);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("capping"),
      expect.anything(),
      expect.objectContaining({ workspaceId: WORKSPACE_ID }),
    );
  });

  // ── Deduplication ─────────────────────────────────────────────────────────

  test("deduplication: node qualifying under all three conditions appears once with reason 'active'", async () => {
    // The same ref_id appears in all three sources
    const sharedNode = {
      ref_id: "ref-shared",
      node_type: "EvalSet",
      properties: { id: "shared/task", name: "Shared Task", recursion: true, recursionEnabledAt: 1700000000 },
    };
    mockGroupBy.mockResolvedValue([{ evalSetId: "shared/task", _count: { evalSetId: 2 } }]);
    mockSearchNodesByAttributes.mockImplementation(
      (_config: unknown, params: { filters: Array<{ attribute: string; value: unknown }> }) => {
        const attr = params.filters[0]?.attribute;
        if (attr === "recursion") return Promise.resolve({ ok: true, nodes: [sharedNode] });
        if (attr === "recursionEnabledAt") return Promise.resolve({ ok: true, nodes: [sharedNode] });
        // Source 3 id lookup
        if (attr === "id") return Promise.resolve({ ok: true, nodes: [sharedNode] });
        return Promise.resolve({ ok: true, nodes: [] });
      },
    );

    const result = await listRecursionEvalSets(CONFIG, WORKSPACE_ID);

    expect(result.ok).toBe(true);
    const sharedEntries = result.nodes?.filter((n) => n.ref_id === "ref-shared");
    // Must appear exactly once
    expect(sharedEntries).toHaveLength(1);
    // Highest-priority reason wins
    expect(sharedEntries![0].reason).toBe("active");
  });

  test("deduplication: 'active' beats 'wasEnabled' beats 'multipleRuns'", async () => {
    const activeNode = { ref_id: "ref-x", node_type: "EvalSet", properties: { id: "area/task", name: "Task", recursion: true, recursionEnabledAt: 1700000000 } };
    mockGroupBy.mockResolvedValue([{ evalSetId: "area/task", _count: { evalSetId: 2 } }]);
    mockSearchNodesByAttributes.mockImplementation(
      (_config: unknown, params: { filters: Array<{ attribute: string }> }) => {
        const attr = params.filters[0]?.attribute;
        if (attr === "recursion") return Promise.resolve({ ok: true, nodes: [activeNode] });
        if (attr === "recursionEnabledAt") return Promise.resolve({ ok: true, nodes: [activeNode] });
        if (attr === "id") return Promise.resolve({ ok: true, nodes: [activeNode] });
        return Promise.resolve({ ok: true, nodes: [] });
      },
    );

    const result = await listRecursionEvalSets(CONFIG, WORKSPACE_ID);

    const entries = result.nodes?.filter((n) => n.ref_id === "ref-x");
    expect(entries).toHaveLength(1);
    expect(entries![0].reason).toBe("active");
  });

  // ── Property extraction from node.properties, not bare ref_id ─────────────

  test("selectEvalSetByTieBreak + property extraction: id/name/projectId from node.properties", async () => {
    const evalsetNode = {
      ref_id: "ref-old",
      node_type: "Evalset",
      properties: { id: "area/task", name: "Old Name", project_id: 999 },
    };
    const canonicalNode = {
      ref_id: "ref-new",
      node_type: "EvalSet",
      properties: { id: "area/task", name: "Canonical Name", project_id: 42 },
    };
    mockGroupBy.mockResolvedValue([{ evalSetId: "area/task", _count: { evalSetId: 2 } }]);
    mockSearchNodesByAttributes.mockImplementation(
      (_config: unknown, params: { filters: Array<{ attribute: string }> }) => {
        const attr = params.filters[0]?.attribute;
        if (attr === "recursion") return Promise.resolve({ ok: true, nodes: [] });
        if (attr === "recursionEnabledAt") return Promise.resolve({ ok: true, nodes: [] });
        // Source 3: two nodes for the same id — tie-break selects canonical "EvalSet"
        if (attr === "id") return Promise.resolve({ ok: true, nodes: [evalsetNode, canonicalNode] });
        return Promise.resolve({ ok: true, nodes: [] });
      },
    );

    const result = await listRecursionEvalSets(CONFIG, WORKSPACE_ID);

    const entry = result.nodes?.find((n) => n.ref_id === "ref-new");
    expect(entry).toBeDefined();
    // Properties come from node.properties, not the bare ref_id string
    expect(entry?.id).toBe("area/task");
    expect(entry?.name).toBe("Canonical Name");
    expect(entry?.projectId).toBe(42);
    // The Evalset node was NOT picked
    expect(result.nodes?.find((n) => n.ref_id === "ref-old")).toBeUndefined();
  });

  // ── Partial result signalling ─────────────────────────────────────────────

  test("partial is undefined when all sources succeed", async () => {
    mockSearchNodesByAttributes.mockImplementation(
      (_config: unknown, params: { filters: Array<{ attribute: string }> }) => {
        if (params.filters[0]?.attribute === "recursion") return Promise.resolve({ ok: true, nodes: [ACTIVE_NODE] });
        return Promise.resolve({ ok: true, nodes: [] });
      },
    );

    const result = await listRecursionEvalSets(CONFIG, WORKSPACE_ID);

    expect(result.ok).toBe(true);
    expect(result.partial).toBeUndefined();
  });
});
