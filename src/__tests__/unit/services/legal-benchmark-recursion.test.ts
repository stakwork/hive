/**
 * Unit tests for legal-benchmark-recursion service.
 */

import { describe, test, expect, vi, beforeEach } from "vitest";

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const mockSearchNodesByAttributes = vi.hoisted(() => vi.fn());
const mockUpdateNode = vi.hoisted(() => vi.fn());
const mockCheckNodeByKey = vi.hoisted(() => vi.fn());

vi.mock("@/services/swarm/api/nodes", () => ({
  searchNodesByAttributes: mockSearchNodesByAttributes,
  updateNode: mockUpdateNode,
  checkNodeByKey: mockCheckNodeByKey,
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ── Import after mocks ────────────────────────────────────────────────────────

import {
  listRecursionEvalSets,
  setEvalSetRecursion,
  enableRecursionForTaskSlug,
  writeBackEvalProjectId,
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

    expect(params.nodeTypes).toEqual(["EvalSet"]);
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

  test("uses checkNodeByKey (not searchNodesByAttributes with attribute:id) to resolve EvalSet", async () => {
    mockCheckNodeByKey.mockResolvedValue({ ok: true, exists: true, refId: "ref-abc-123" });
    mockUpdateNode.mockResolvedValue({ success: true });

    await enableRecursionForTaskSlug(CONFIG, TASK_SLUG);

    // Must use checkNodeByKey, NOT searchNodesByAttributes with attribute "id"
    expect(mockCheckNodeByKey).toHaveBeenCalledOnce();
    expect(mockSearchNodesByAttributes).not.toHaveBeenCalled();
  });

  test("calls checkNodeByKey with correct nodeType, key, and namespace (all = task slug)", async () => {
    mockCheckNodeByKey.mockResolvedValue({ ok: true, exists: true, refId: "ref-abc-123" });
    mockUpdateNode.mockResolvedValue({ success: true });

    await enableRecursionForTaskSlug(CONFIG, TASK_SLUG);

    const [, params] = mockCheckNodeByKey.mock.calls[0] as [unknown, {
      nodeType: string;
      key: string;
      namespace: string;
    }];
    expect(params.nodeType).toBe("EvalSet");
    expect(params.key).toBe(TASK_SLUG);
    expect(params.namespace).toBe(TASK_SLUG);
  });

  test("calls setEvalSetRecursion (updateNode) with resolved ref_id, recursion=true, and slug as namespace", async () => {
    mockCheckNodeByKey.mockResolvedValue({ ok: true, exists: true, refId: "ref-abc-123" });
    mockUpdateNode.mockResolvedValue({ success: true });

    const result = await enableRecursionForTaskSlug(CONFIG, TASK_SLUG);

    expect(mockUpdateNode).toHaveBeenCalledOnce();
    const [, updateReq, updateOpts] = mockUpdateNode.mock.calls[0] as [
      unknown,
      { ref_id: string; node_type: string; node_data: Record<string, unknown> },
      { namespace?: string } | undefined,
    ];
    expect(updateReq.ref_id).toBe("ref-abc-123");
    expect(updateReq.node_type).toBe("EvalSet");
    expect(updateReq.node_data).toEqual({ recursion: true });
    expect(updateOpts?.namespace).toBe(TASK_SLUG);

    expect(result.ok).toBe(true);
    expect(result).not.toHaveProperty("notFound");
  });

  test("returns notFound:true ONLY when checkNodeByKey returns ok:true + exists:false (genuine miss)", async () => {
    mockCheckNodeByKey.mockResolvedValue({ ok: true, exists: false });

    const result = await enableRecursionForTaskSlug(CONFIG, "nonexistent/task");

    expect(mockUpdateNode).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    expect(result).toHaveProperty("notFound", true);
    expect(result.error).toBe("EvalSet not found for task slug");
  });

  test("returns error (NOT notFound) when checkNodeByKey reports a transport failure", async () => {
    mockCheckNodeByKey.mockResolvedValue({ ok: false, exists: false, error: "Network timeout" });

    const result = await enableRecursionForTaskSlug(CONFIG, TASK_SLUG);

    expect(mockUpdateNode).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    expect(result).not.toHaveProperty("notFound");
    expect(result.error).toBeDefined();
  });

  test("returns error (NOT notFound) when checkNodeByKey returns endpointMissing:true (400/version mismatch)", async () => {
    mockCheckNodeByKey.mockResolvedValue({
      ok: false,
      exists: false,
      endpointMissing: true,
      status: 404,
    });

    const result = await enableRecursionForTaskSlug(CONFIG, TASK_SLUG);

    expect(mockUpdateNode).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    expect(result).not.toHaveProperty("notFound");
    // endpointMissing is an error, not a miss
    expect(result.error).toBeDefined();
  });

  test("returns error (NOT notFound) on a 400 INVALID_NAMESPACE response", async () => {
    mockCheckNodeByKey.mockResolvedValue({
      ok: false,
      exists: false,
      status: 400,
      error: "checkNodeByKey failed (status: 400)",
    });

    const result = await enableRecursionForTaskSlug(CONFIG, TASK_SLUG);

    expect(result.ok).toBe(false);
    expect(result).not.toHaveProperty("notFound");
    expect(result.error).toBeDefined();
  });

  test("returns error when graph write fails after resolving ref_id", async () => {
    mockCheckNodeByKey.mockResolvedValue({ ok: true, exists: true, refId: "ref-abc-123" });
    mockUpdateNode.mockResolvedValue({ success: false, error: "Write conflict" });

    const result = await enableRecursionForTaskSlug(CONFIG, TASK_SLUG);

    expect(mockUpdateNode).toHaveBeenCalledOnce();
    expect(result.ok).toBe(false);
    expect(result.error).toBe("Write conflict");
    expect(result).not.toHaveProperty("notFound");
  });

  test("is idempotent — enabling an already-true flag succeeds", async () => {
    mockCheckNodeByKey.mockResolvedValue({ ok: true, exists: true, refId: "ref-abc-123" });
    mockUpdateNode.mockResolvedValue({ success: true });

    const result = await enableRecursionForTaskSlug(CONFIG, TASK_SLUG);

    expect(result.ok).toBe(true);
    // updateNode is still called (setEvalSetRecursion always writes, idempotent on the graph)
    expect(mockUpdateNode).toHaveBeenCalledOnce();
  });
});

// ── setEvalSetRecursion — namespace forwarding ────────────────────────────────

describe("setEvalSetRecursion — namespace forwarding", () => {
  beforeEach(() => vi.clearAllMocks());

  test("forwards namespace to updateNode when provided", async () => {
    mockUpdateNode.mockResolvedValue({ success: true });

    await setEvalSetRecursion(CONFIG, "ref-abc-123", true, "practice-area/task-slug");

    const [, , opts] = mockUpdateNode.mock.calls[0] as [
      unknown,
      unknown,
      { namespace?: string } | undefined,
    ];
    expect(opts?.namespace).toBe("practice-area/task-slug");
  });

  test("omits namespace in opts when not provided (backward compat)", async () => {
    mockUpdateNode.mockResolvedValue({ success: true });

    await setEvalSetRecursion(CONFIG, "ref-abc-123", false);

    const [, , opts] = mockUpdateNode.mock.calls[0] as [
      unknown,
      unknown,
      { namespace?: string } | undefined,
    ];
    expect(opts).toBeUndefined();
  });
});

// ── writeBackEvalProjectId — namespace forwarding ─────────────────────────────

describe("writeBackEvalProjectId — namespace forwarding", () => {
  beforeEach(() => vi.clearAllMocks());

  test("forwards namespace to updateNode when provided", async () => {
    mockUpdateNode.mockResolvedValue({ success: true });

    await writeBackEvalProjectId(CONFIG, "ref-abc-123", 42, "practice-area/task-slug");

    const [, req, opts] = mockUpdateNode.mock.calls[0] as [
      unknown,
      { ref_id: string; node_type: string; node_data: Record<string, unknown> },
      { namespace?: string } | undefined,
    ];
    expect(req.node_data).toEqual({ project_id: 42 });
    expect(opts?.namespace).toBe("practice-area/task-slug");
  });

  test("omits namespace when not provided (backward compat)", async () => {
    mockUpdateNode.mockResolvedValue({ success: true });

    await writeBackEvalProjectId(CONFIG, "ref-abc-123", 99);

    const [, , opts] = mockUpdateNode.mock.calls[0] as [
      unknown,
      unknown,
      { namespace?: string } | undefined,
    ];
    expect(opts).toBeUndefined();
  });

  test("returns ok:true on success", async () => {
    mockUpdateNode.mockResolvedValue({ success: true });
    const result = await writeBackEvalProjectId(CONFIG, "ref-abc-123", 42, "task/slug");
    expect(result.ok).toBe(true);
  });

  test("returns ok:false on write failure", async () => {
    mockUpdateNode.mockResolvedValue({ success: false, error: "ERROR_INVALID_REF_ID" });
    const result = await writeBackEvalProjectId(CONFIG, "ref-abc-123", 42, "task/slug");
    expect(result.ok).toBe(false);
    expect(result.error).toBe("ERROR_INVALID_REF_ID");
  });
});
