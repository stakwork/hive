/**
 * Unit tests for legal-benchmark-recursion service.
 */

import { describe, test, expect, vi, beforeEach } from "vitest";

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const mockSearchNodesByAttributes = vi.hoisted(() => vi.fn());
const mockUpdateNode = vi.hoisted(() => vi.fn());

vi.mock("@/services/swarm/api/nodes", () => ({
  searchNodesByAttributes: mockSearchNodesByAttributes,
  updateNode: mockUpdateNode,
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ── Import after mocks ────────────────────────────────────────────────────────

import {
  listRecursionEvalSets,
  setEvalSetRecursion,
  enableRecursionForTaskSlug,
  EVALSET_NODE_LABELS,
  isEvalSetLabel,
} from "@/services/legal-benchmark-recursion";
import { logger } from "@/lib/logger";

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

// ── listRecursionEvalSets ─────────────────────────────────────────────────────

describe("listRecursionEvalSets", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("calls searchNodesByAttributes with exact filter shape", async () => {
    mockSearchNodesByAttributes.mockResolvedValue({ ok: true, nodes: [EVAL_SET_NODE] });

    await listRecursionEvalSets(CONFIG);

    expect(mockSearchNodesByAttributes).toHaveBeenCalledOnce();
    const [, params] = mockSearchNodesByAttributes.mock.calls[0] as [unknown, {
      nodeTypes: string[];
      filters: Array<{ attribute: string; value: unknown; comparator: string }>;
      includeProperties: boolean;
    }];

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
    expect(req.node_data).toEqual({ recursion: true });
  });

  test("calls updateNode with correct payload to disable recursion", async () => {
    mockUpdateNode.mockResolvedValue({ success: true });

    await setEvalSetRecursion(CONFIG, "ref-abc-123", false);

    const [, req] = mockUpdateNode.mock.calls[0] as [unknown, {
      node_data: Record<string, unknown>;
    }];
    expect(req.node_data).toEqual({ recursion: false });
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

    // updateNode was called with the resolved ref_id and recursion=true
    expect(mockUpdateNode).toHaveBeenCalledOnce();
    const [, updateReq] = mockUpdateNode.mock.calls[0] as [unknown, {
      ref_id: string;
      node_type: string;
      node_data: Record<string, unknown>;
    }];
    expect(updateReq.ref_id).toBe("ref-abc-123");
    expect(updateReq.node_type).toBe("EvalSet");
    expect(updateReq.node_data).toEqual({ recursion: true });

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

    // Both calls use the both-casing nodeTypes list
    for (const [, params] of mockSearchNodesByAttributes.mock.calls as [unknown, { nodeTypes: string[] }][]) {
      expect(params.nodeTypes).toContain("EvalSet");
      expect(params.nodeTypes).toContain("Evalset");
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
