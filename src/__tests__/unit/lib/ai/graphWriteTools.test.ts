/**
 * Unit tests for buildGraphWriteTools (src/lib/ai/graphWriteTools.ts).
 *
 * Tests:
 *  1. propose_create_node: reserved keys rejected
 *  2. propose_create_node: unknown node_type rejected when ontology available
 *  3. propose_create_node: returns proposal, no write, no sensitive fields
 *  4. propose_create_node: access denied → error
 *  5. propose_node_edit: reserved keys rejected
 *  6. propose_node_edit: mirror-owned type refused
 *  7. propose_node_edit: node not found → refusedReason in meta
 *  8. propose_node_edit: returns proposal with oldStr/newStr, no write
 *  9. propose_create_triplet: XOR src ref_id + inline both → error
 * 10. propose_create_triplet: XOR src neither → error
 * 11. propose_create_triplet: valid ref_id sides → proposal
 * 12. propose_create_batch_triplet: >25 triplets → error
 * 13. propose_create_batch_triplet: valid batch → proposal
 * 14. No proposal payload ever contains swarmApiKey/jarvisUrl/apiKey
 * 15. No namespace or create_schema_if_missing in any payload
 * 16. propose_delete_edge: refuses an edge that isn't there, names the ends of one that is, never writes
 * 17. propose_move_node: finds the single parent, needs from_ref_id for several, refuses no parent,
 *     mirror-owned, missing nodes, a destination under the node (cycle), never writes
 * 18. propose_delete_node: lists the live edges on the card, caps the list, refuses missing,
 *     mirror-owned and Schema nodes, never writes
 */

// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Hoisted mocks ──────────────────────────────────────────────────────────
const {
  mockResolveGraphJarvis,
  mockReadNodeByRef,
  mockKgGetOntology,
  mockKgGetNode,
  mockFindEdgeByEndpoints,
  mockListIncomingEdges,
  mockGetNodeEdges,
} = vi.hoisted(() => ({
  mockResolveGraphJarvis: vi.fn(),
  mockReadNodeByRef: vi.fn(),
  mockKgGetOntology: vi.fn(),
  mockKgGetNode: vi.fn(),
  mockFindEdgeByEndpoints: vi.fn(),
  mockListIncomingEdges: vi.fn(),
  mockGetNodeEdges: vi.fn(),
}));

vi.mock("@/lib/ai/graphWriteAuth", () => ({
  resolveGraphJarvis: mockResolveGraphJarvis,
  GRAPH_JARVIS_ACCESS_DENIED: "Workspace not found or access denied.",
}));

vi.mock("@/services/swarm/api/nodes", () => ({
  readNodeByRef: mockReadNodeByRef,
  findEdgeByEndpoints: mockFindEdgeByEndpoints,
  listIncomingEdges: mockListIncomingEdges,
  getNodeEdges: mockGetNodeEdges,
  isMutedEdge: (p?: Record<string, unknown>) => p?.is_muted === true || p?.is_deleted === true,
  deleteSingleNode: vi.fn(),
  addNode: vi.fn(),
  updateNodeV2: vi.fn(),
  addEdgeV2: vi.fn(),
  deleteEdge: vi.fn(),
}));

vi.mock("@/lib/ai/kg-adapter", () => ({
  kgGetOntology: mockKgGetOntology,
  kgGetNode: mockKgGetNode,
}));

// ── Import after mocks ─────────────────────────────────────────────────────
import { buildGraphWriteTools } from "@/lib/ai/graphWriteTools";

// ── Fixtures ───────────────────────────────────────────────────────────────
const ORG_ID = "org-001";
const USER_ID = "user-001";
const WS_ID = "ws-001";
const WS_SLUG = "my-workspace";

const ACCESS_OK = {
  ok: true as const,
  access: {
    workspaceId: WS_ID,
    workspaceSlug: WS_SLUG,
    config: { jarvisUrl: "https://swarm.sphinx.chat:8444", apiKey: "api-key-secret" },
  },
};

const ACCESS_DENIED = {
  ok: false as const,
  error: "Workspace not found or access denied.",
};

function getTools() {
  return buildGraphWriteTools(ORG_ID, USER_ID);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockResolveGraphJarvis.mockResolvedValue(ACCESS_OK);
  mockKgGetOntology.mockResolvedValue({
    domains: ["entity"],
    node_types: [{ type: "Concept", domain: "entity", description: "" }],
  });
  mockReadNodeByRef.mockResolvedValue({
    success: true,
    ref_id: "node-123",
    node_type: "Concept",
    properties: { name: "Old Name" },
  });
  mockFindEdgeByEndpoints.mockResolvedValue({
    success: true,
    status: "success",
    ref_id: "edge-1",
    edge: { ref_id: "edge-1", properties: {}, source_name: "Coding", target_name: "Security" },
  });
  mockListIncomingEdges.mockResolvedValue({
    success: true,
    status: "success",
    edges: [{ ref_id: "edge-1", source_ref_id: "parent-1", source_name: "Coding", properties: {} }],
  });
  mockKgGetNode.mockResolvedValue({ ref_id: "parent-2", node_type: "Concept", name: "Ops" });
});

// ── propose_create_node ───────────────────────────────────────────────────

describe("propose_create_node", () => {
  it("rejects reserved key 'status'", async () => {
    const tools = getTools();
    const result = await tools.propose_create_node.execute(
      { workspaceSlug: WS_SLUG, node_type: "Concept", node_data: { status: "active" } },
      {} as never,
    );
    expect(result).toMatchObject({ error: expect.stringContaining("reserved key") });
    expect(mockResolveGraphJarvis).not.toHaveBeenCalled();
  });

  it("rejects reserved key 'algo_pagerank'", async () => {
    const tools = getTools();
    const result = await tools.propose_create_node.execute(
      { workspaceSlug: WS_SLUG, node_type: "Concept", node_data: { algo_pagerank: 0.9 } },
      {} as never,
    );
    expect(result).toMatchObject({ error: expect.stringContaining("reserved key") });
  });

  it("rejects unknown node_type when ontology is available", async () => {
    const tools = getTools();
    const result = await tools.propose_create_node.execute(
      { workspaceSlug: WS_SLUG, node_type: "UnknownType", node_data: { name: "x" } },
      {} as never,
    );
    expect(result).toMatchObject({ error: expect.stringContaining("Unknown node_type") });
  });

  it("returns proposal object without writing", async () => {
    const tools = getTools();
    const result = await tools.propose_create_node.execute(
      { workspaceSlug: WS_SLUG, node_type: "Concept", node_data: { name: "Test" } },
      {} as never,
    );
    expect(result).toMatchObject({
      kind: "graphNodeCreate",
      proposalId: expect.any(String),
      payload: {
        workspaceId: WS_ID,
        workspaceSlug: WS_SLUG,
        node_type: "Concept",
        node_data: { name: "Test" },
      },
    });
    // Verify no writes happened
    const { addNode } = await import("@/services/swarm/api/nodes");
    expect(vi.mocked(addNode)).not.toHaveBeenCalled();
  });

  it("returns error when access is denied", async () => {
    mockResolveGraphJarvis.mockResolvedValue(ACCESS_DENIED);
    const tools = getTools();
    const result = await tools.propose_create_node.execute(
      { workspaceSlug: WS_SLUG, node_type: "Concept", node_data: { name: "x" } },
      {} as never,
    );
    expect(result).toMatchObject({ error: expect.stringContaining("access denied") });
  });

  it("serialized payload contains no sensitive fields", async () => {
    const tools = getTools();
    const result = await tools.propose_create_node.execute(
      { workspaceSlug: WS_SLUG, node_type: "Concept", node_data: { name: "x" } },
      {} as never,
    );
    const str = JSON.stringify(result);
    expect(str).not.toContain("swarmApiKey");
    expect(str).not.toContain("jarvisUrl");
    expect(str).not.toContain("apiKey");
    expect(str).not.toContain("x-api-token");
    expect(str).not.toContain("namespace");
    expect(str).not.toContain("create_schema_if_missing");
  });
});

// ── propose_node_edit ─────────────────────────────────────────────────────

describe("propose_node_edit", () => {
  it("rejects reserved key 'ref_id'", async () => {
    const tools = getTools();
    const result = await tools.propose_node_edit.execute(
      { workspaceSlug: WS_SLUG, ref_id: "node-123", node_data: { ref_id: "hack" } },
      {} as never,
    );
    expect(result).toMatchObject({ error: expect.stringContaining("reserved key") });
  });

  it("refuses mirror-owned type HiveFeature", async () => {
    mockReadNodeByRef.mockResolvedValue({
      success: true,
      ref_id: "node-123",
      node_type: "HiveFeature",
      properties: {},
    });
    const tools = getTools();
    const result = await tools.propose_node_edit.execute(
      { workspaceSlug: WS_SLUG, ref_id: "node-123", node_data: { name: "new" } },
      {} as never,
    );
    // Should return a proposal with refusedReason in meta (not a raw error)
    expect(result).toMatchObject({
      kind: "graphNodeEdit",
      meta: { refusedReason: expect.stringContaining("mirror-owned") },
    });
  });

  it("surfaces node-not-found as refusedReason", async () => {
    mockReadNodeByRef.mockResolvedValue({ success: false, message: "not found" });
    const tools = getTools();
    const result = await tools.propose_node_edit.execute(
      { workspaceSlug: WS_SLUG, ref_id: "missing-node", node_data: { name: "x" } },
      {} as never,
    );
    expect(result).toMatchObject({
      kind: "graphNodeEdit",
      meta: { refusedReason: expect.stringContaining("not found") },
    });
  });

  it("returns proposal with diff snapshot for valid edit", async () => {
    const tools = getTools();
    const result = await tools.propose_node_edit.execute(
      { workspaceSlug: WS_SLUG, ref_id: "node-123", node_data: { name: "New Name" } },
      {} as never,
    ) as Record<string, unknown>;
    expect(result.kind).toBe("graphNodeEdit");
    const meta = result.meta as Record<string, unknown>;
    expect(meta.oldStr).toContain("Old Name");
    expect(meta.newStr).toContain("New Name");
    expect(meta.refusedReason).toBeUndefined();
  });

  it("does not call addNode or updateNodeV2", async () => {
    const tools = getTools();
    await tools.propose_node_edit.execute(
      { workspaceSlug: WS_SLUG, ref_id: "node-123", node_data: { name: "x" } },
      {} as never,
    );
    const { updateNodeV2 } = await import("@/services/swarm/api/nodes");
    expect(vi.mocked(updateNodeV2)).not.toHaveBeenCalled();
  });
});

// ── propose_create_triplet ────────────────────────────────────────────────

describe("propose_create_triplet", () => {
  it("rejects source with both ref_id and inline spec", async () => {
    const tools = getTools();
    const result = await tools.propose_create_triplet.execute(
      {
        workspaceSlug: WS_SLUG,
        edge_type: "USES",
        source: { ref_id: "n1", node_type: "Concept", node_data: {} } as never,
        target: { ref_id: "n2" },
      },
      {} as never,
    );
    expect(result).toMatchObject({ error: expect.stringContaining("source") });
  });

  it("rejects target with neither ref_id nor inline spec", async () => {
    const tools = getTools();
    const result = await tools.propose_create_triplet.execute(
      {
        workspaceSlug: WS_SLUG,
        edge_type: "USES",
        source: { ref_id: "n1" },
        target: {} as never,
      },
      {} as never,
    );
    expect(result).toMatchObject({ error: expect.stringContaining("target") });
  });

  it("returns proposal for valid ref_id sides", async () => {
    const tools = getTools();
    const result = await tools.propose_create_triplet.execute(
      {
        workspaceSlug: WS_SLUG,
        edge_type: "USES",
        source: { ref_id: "n1" },
        target: { ref_id: "n2" },
      },
      {} as never,
    );
    expect(result).toMatchObject({
      kind: "graphTripletCreate",
      proposalId: expect.any(String),
      payload: {
        workspaceId: WS_ID,
        edge_type: "USES",
      },
    });
    // Ensure no namespace or create_schema_if_missing
    const str = JSON.stringify(result);
    expect(str).not.toContain("namespace");
    expect(str).not.toContain("create_schema_if_missing");
  });

  it("rejects reserved key in edge_data", async () => {
    const tools = getTools();
    const result = await tools.propose_create_triplet.execute(
      {
        workspaceSlug: WS_SLUG,
        edge_type: "USES",
        edge_data: { status: "active" },
        source: { ref_id: "n1" },
        target: { ref_id: "n2" },
      },
      {} as never,
    );
    expect(result).toMatchObject({ error: expect.stringContaining("reserved key") });
  });
});

// ── propose_create_batch_triplet ──────────────────────────────────────────

describe("propose_create_batch_triplet", () => {
  it("rejects batch exceeding 25 items", async () => {
    const tools = getTools();
    const triplets = Array.from({ length: 26 }, (_, i) => ({
      edge_type: "USES",
      source: { ref_id: `n${i}` },
      target: { ref_id: `m${i}` },
    }));
    const result = await tools.propose_create_batch_triplet.execute(
      { workspaceSlug: WS_SLUG, triplets },
      {} as never,
    );
    expect(result).toMatchObject({ error: expect.stringContaining("cap") });
  });

  it("returns proposal for valid batch", async () => {
    const tools = getTools();
    const triplets = [
      { edge_type: "USES", source: { ref_id: "n1" }, target: { ref_id: "n2" } },
      { edge_type: "OWNS", source: { ref_id: "n3" }, target: { ref_id: "n4" } },
    ];
    const result = await tools.propose_create_batch_triplet.execute(
      { workspaceSlug: WS_SLUG, triplets },
      {} as never,
    );
    expect(result).toMatchObject({
      kind: "graphBatchTripletCreate",
      proposalId: expect.any(String),
      payload: {
        workspaceId: WS_ID,
        triplets: expect.arrayContaining([
          expect.objectContaining({ edge_type: "USES" }),
        ]),
      },
    });
    // Ensure addEdgeV2 was NOT called
    const { addEdgeV2 } = await import("@/services/swarm/api/nodes");
    expect(vi.mocked(addEdgeV2)).not.toHaveBeenCalled();
  });

  it("rejects XOR violation in batch item", async () => {
    const tools = getTools();
    const triplets = [
      {
        edge_type: "USES",
        source: { ref_id: "n1", node_type: "Concept", node_data: {} } as never,
        target: { ref_id: "n2" },
      },
    ];
    const result = await tools.propose_create_batch_triplet.execute(
      { workspaceSlug: WS_SLUG, triplets },
      {} as never,
    );
    expect(result).toMatchObject({ error: expect.stringContaining("source") });
  });
});

// ── propose_delete_edge ───────────────────────────────────────────────────

describe("propose_delete_edge", () => {
  const args = {
    workspaceSlug: WS_SLUG,
    edge_type: "PARENT_OF",
    source_ref_id: "parent-1",
    target_ref_id: "node-123",
  };

  it("returns a proposal naming both ends, without writing", async () => {
    const tools = getTools();
    const result = await tools.propose_delete_edge.execute(
      { ...args, rationale: "Wrong parent." },
      {} as never,
    );
    expect(result).toEqual({
      kind: "graphEdgeDelete",
      proposalId: expect.any(String),
      payload: { workspaceId: WS_ID, ...args },
      rationale: "Wrong parent.",
      meta: { workspaceSlug: WS_SLUG, edge_ref_id: "edge-1", source_name: "Coding", target_name: "Security" },
    });
    expect(mockFindEdgeByEndpoints).toHaveBeenCalledWith(ACCESS_OK.access.config, {
      source_ref_id: "parent-1",
      edge_type: "PARENT_OF",
      target_ref_id: "node-123",
    });
    const { deleteEdge } = await import("@/services/swarm/api/nodes");
    expect(vi.mocked(deleteEdge)).not.toHaveBeenCalled();
    const str = JSON.stringify(result);
    expect(str).not.toContain("apiKey");
    expect(str).not.toContain("jarvisUrl");
  });

  it("refuses an edge that isn't in the graph, as a card with a reason", async () => {
    mockFindEdgeByEndpoints.mockResolvedValue({ success: true, status: "success" });
    const tools = getTools();
    const result = await tools.propose_delete_edge.execute(args, {} as never);
    expect(result).toMatchObject({
      kind: "graphEdgeDelete",
      meta: { refusedReason: expect.stringContaining('No PARENT_OF edge from "parent-1" to "node-123" was found') },
    });
  });

  it("reports a failed edge read as a tool error", async () => {
    mockFindEdgeByEndpoints.mockResolvedValue({ success: false, message: "Request failed with status 503" });
    const tools = getTools();
    const result = await tools.propose_delete_edge.execute(args, {} as never);
    expect(result).toEqual({ error: "Request failed with status 503" });
  });

  it("rejects an edge from a node to itself before touching the graph", async () => {
    const tools = getTools();
    const result = await tools.propose_delete_edge.execute(
      { ...args, target_ref_id: "parent-1" },
      {} as never,
    );
    expect(result).toMatchObject({ error: expect.stringContaining("different") });
    expect(mockResolveGraphJarvis).not.toHaveBeenCalled();
  });

  it("returns error when access is denied", async () => {
    mockResolveGraphJarvis.mockResolvedValue(ACCESS_DENIED);
    const tools = getTools();
    const result = await tools.propose_delete_edge.execute(args, {} as never);
    expect(result).toMatchObject({ error: expect.stringContaining("access denied") });
    expect(mockFindEdgeByEndpoints).not.toHaveBeenCalled();
  });
});

// ── propose_move_node ─────────────────────────────────────────────────────

describe("propose_move_node", () => {
  const args = { workspaceSlug: WS_SLUG, ref_id: "node-123", to_ref_id: "parent-2", edge_type: "PARENT_OF" };

  it("moves a node with one parent without being told where from, and names everything on the card", async () => {
    mockReadNodeByRef
      .mockResolvedValueOnce({ success: true, ref_id: "node-123", node_type: "Concept", properties: { name: "Security" } })
      .mockResolvedValueOnce({ success: true, ref_id: "parent-2", node_type: "Concept", properties: { name: "Ops" } });
    const tools = getTools();
    const result = await tools.propose_move_node.execute({ ...args, rationale: "Belongs with ops." }, {} as never);
    expect(result).toEqual({
      kind: "graphNodeMove",
      proposalId: expect.any(String),
      payload: {
        workspaceId: WS_ID,
        workspaceSlug: WS_SLUG,
        ref_id: "node-123",
        edge_type: "PARENT_OF",
        from_ref_id: "parent-1",
        to_ref_id: "parent-2",
      },
      rationale: "Belongs with ops.",
      meta: {
        workspaceSlug: WS_SLUG,
        node_name: "Security",
        node_type: "Concept",
        from_name: "Coding",
        to_name: "Ops",
        edge_ref_id: "edge-1",
      },
    });
    expect(mockListIncomingEdges).toHaveBeenCalledWith(ACCESS_OK.access.config, {
      ref_id: "node-123",
      edge_type: "PARENT_OF",
    });
    // The cycle check reads the destination's ancestors.
    expect(mockKgGetNode).toHaveBeenCalledWith(
      ACCESS_OK.access.config.jarvisUrl,
      ACCESS_OK.access.config.apiKey,
      "parent-2",
      { includeAncestors: true },
    );
    const { addEdgeV2, deleteEdge } = await import("@/services/swarm/api/nodes");
    expect(vi.mocked(addEdgeV2)).not.toHaveBeenCalled();
    expect(vi.mocked(deleteEdge)).not.toHaveBeenCalled();
  });

  it("uses from_ref_id when given, even when the node's own listing was cut short", async () => {
    mockListIncomingEdges.mockResolvedValue({ success: true, status: "success", edges: [] });
    const tools = getTools();
    const result = await tools.propose_move_node.execute({ ...args, from_ref_id: "parent-1" }, {} as never);
    expect(result).toMatchObject({
      kind: "graphNodeMove",
      payload: { from_ref_id: "parent-1", to_ref_id: "parent-2" },
      meta: { from_name: "Coding", edge_ref_id: "edge-1" },
    });
    expect(mockFindEdgeByEndpoints).toHaveBeenCalledWith(ACCESS_OK.access.config, {
      source_ref_id: "parent-1",
      edge_type: "PARENT_OF",
      target_ref_id: "node-123",
    });
    expect((result as { meta: { refusedReason?: string } }).meta.refusedReason).toBeUndefined();
  });

  it("refuses a from_ref_id the node isn't under", async () => {
    mockListIncomingEdges.mockResolvedValue({ success: true, status: "success", edges: [] });
    mockFindEdgeByEndpoints.mockResolvedValue({ success: true, status: "success" });
    const tools = getTools();
    const result = await tools.propose_move_node.execute({ ...args, from_ref_id: "elsewhere" }, {} as never);
    expect(result).toMatchObject({
      kind: "graphNodeMove",
      payload: { from_ref_id: "elsewhere" },
      meta: { refusedReason: expect.stringContaining("is not under") },
    });
  });

  it("asks for from_ref_id when the node has several parents", async () => {
    mockListIncomingEdges.mockResolvedValue({
      success: true,
      status: "success",
      edges: [
        { ref_id: "e-1", source_ref_id: "parent-1", source_name: "Coding", properties: {} },
        { ref_id: "e-2", source_ref_id: "parent-3", properties: {} },
      ],
    });
    const tools = getTools();
    const result = await tools.propose_move_node.execute(args, {} as never);
    expect(result).toMatchObject({
      kind: "graphNodeMove",
      payload: { from_ref_id: "" },
      meta: { refusedReason: expect.stringContaining("2 PARENT_OF parents (Coding, parent-3)") },
    });
  });

  it("refuses a node with no parent along the edge", async () => {
    mockListIncomingEdges.mockResolvedValue({ success: true, status: "success", edges: [] });
    const tools = getTools();
    const result = await tools.propose_move_node.execute(args, {} as never);
    expect(result).toMatchObject({
      kind: "graphNodeMove",
      meta: { refusedReason: expect.stringContaining("propose_create_triplet") },
    });
  });

  it("refuses a move to the parent the node is already under", async () => {
    const tools = getTools();
    const result = await tools.propose_move_node.execute({ ...args, to_ref_id: "parent-1" }, {} as never);
    expect(result).toMatchObject({
      kind: "graphNodeMove",
      meta: { refusedReason: expect.stringContaining("already under") },
    });
  });

  it("refuses a destination that sits under the node itself", async () => {
    mockKgGetNode.mockResolvedValue({
      ref_id: "parent-2",
      node_type: "Concept",
      name: "Ops",
      ancestors: [{ ref_id: "node-123", name: "Security", node_type: "Concept", depth: 1, parents: [] }],
    });
    const tools = getTools();
    const result = await tools.propose_move_node.execute(args, {} as never);
    expect(result).toMatchObject({
      kind: "graphNodeMove",
      meta: { refusedReason: expect.stringContaining("cycle") },
    });
  });

  it("skips the cycle check for an edge type other than PARENT_OF", async () => {
    const tools = getTools();
    const result = await tools.propose_move_node.execute({ ...args, edge_type: "BELONGS_TO" }, {} as never);
    expect(result).toMatchObject({ kind: "graphNodeMove", payload: { edge_type: "BELONGS_TO" } });
    expect(mockKgGetNode).not.toHaveBeenCalled();
  });

  it("refuses a mirror-owned node", async () => {
    mockReadNodeByRef.mockResolvedValueOnce({ success: true, ref_id: "node-123", node_type: "HiveTask", properties: {} });
    const tools = getTools();
    const result = await tools.propose_move_node.execute(args, {} as never);
    expect(result).toMatchObject({
      kind: "graphNodeMove",
      meta: { node_type: "HiveTask", refusedReason: expect.stringContaining("mirror-owned") },
    });
    expect(mockListIncomingEdges).not.toHaveBeenCalled();
  });

  it("refuses a node or a destination that isn't there", async () => {
    mockReadNodeByRef.mockResolvedValueOnce({ success: false, message: "not found" });
    const tools = getTools();
    expect(await tools.propose_move_node.execute(args, {} as never)).toMatchObject({
      meta: { refusedReason: expect.stringContaining('Node "node-123" was not found') },
    });

    mockReadNodeByRef
      .mockResolvedValueOnce({ success: true, ref_id: "node-123", node_type: "Concept", properties: {} })
      .mockResolvedValueOnce({ success: false, message: "not found" });
    expect(await tools.propose_move_node.execute(args, {} as never)).toMatchObject({
      meta: { from_name: "Coding", refusedReason: expect.stringContaining('Destination "parent-2" was not found') },
    });
  });

  it("rejects a node moved under itself, or from and to the same parent, before touching the graph", async () => {
    const tools = getTools();
    expect(await tools.propose_move_node.execute({ ...args, to_ref_id: "node-123" }, {} as never)).toMatchObject({
      error: expect.stringContaining("own parent"),
    });
    expect(
      await tools.propose_move_node.execute({ ...args, from_ref_id: "parent-2" }, {} as never),
    ).toMatchObject({ error: expect.stringContaining("nothing would move") });
    expect(mockResolveGraphJarvis).not.toHaveBeenCalled();
  });
});

// ── propose_delete_node ───────────────────────────────────────────────────

describe("propose_delete_node", () => {
  const args = { workspaceSlug: WS_SLUG, ref_id: "node-123" };

  it("lists the node's live edges on the card, without writing", async () => {
    mockGetNodeEdges.mockResolvedValue({
      ok: true,
      edges: [
        { source: "parent-1", target: "node-123", edge_type: "PARENT_OF", properties: {} },
        { source: "node-123", target: "doc-1", edge_type: "DESCRIBES", properties: {} },
        { source: "node-123", target: "doc-2", edge_type: "DESCRIBES", properties: { is_muted: true } },
      ],
      nodes: [
        { ref_id: "parent-1", node_type: "Concept", properties: { name: "Coding" } },
        { ref_id: "doc-1", node_type: "Document", properties: { title: "Notes" } },
      ],
    });
    const tools = getTools();
    const result = await tools.propose_delete_node.execute(
      { ...args, rationale: "Duplicate of Security v2." },
      {} as never,
    );
    expect(result).toEqual({
      kind: "graphNodeDelete",
      proposalId: expect.any(String),
      payload: { workspaceId: WS_ID, workspaceSlug: WS_SLUG, ref_id: "node-123" },
      rationale: "Duplicate of Security v2.",
      meta: {
        workspaceSlug: WS_SLUG,
        node_name: "Old Name",
        node_type: "Concept",
        edges: [
          { edge_type: "PARENT_OF", direction: "in", other_ref_id: "parent-1", other_name: "Coding" },
          { edge_type: "DESCRIBES", direction: "out", other_ref_id: "doc-1", other_name: "Notes" },
        ],
      },
    });
    const { deleteSingleNode } = await import("@/services/swarm/api/nodes");
    expect(vi.mocked(deleteSingleNode)).not.toHaveBeenCalled();
    const str = JSON.stringify(result);
    expect(str).not.toContain("apiKey");
    expect(str).not.toContain("jarvisUrl");
  });

  it("lists the first 20 edges and counts the rest", async () => {
    mockGetNodeEdges.mockResolvedValue({
      ok: true,
      edges: Array.from({ length: 23 }, (_, i) => ({
        source: "node-123",
        target: `doc-${i}`,
        edge_type: "DESCRIBES",
        properties: {},
      })),
      nodes: [],
    });
    const tools = getTools();
    const result = await tools.propose_delete_node.execute(args, {} as never);
    expect(result).toMatchObject({ meta: { more_edge_count: 3 } });
    expect((result as { meta: { edges: unknown[] } }).meta.edges).toHaveLength(20);
  });

  it("refuses a node that isn't in the graph", async () => {
    mockReadNodeByRef.mockResolvedValue({ success: false, message: "not found" });
    const tools = getTools();
    const result = await tools.propose_delete_node.execute(args, {} as never);
    expect(result).toMatchObject({
      kind: "graphNodeDelete",
      meta: { refusedReason: expect.stringContaining("was not found") },
    });
    expect(mockGetNodeEdges).not.toHaveBeenCalled();
  });

  it("refuses mirror-owned and Schema nodes", async () => {
    const tools = getTools();
    mockReadNodeByRef.mockResolvedValue({ success: true, ref_id: "node-123", node_type: "HiveTask", properties: {} });
    expect(await tools.propose_delete_node.execute(args, {} as never)).toMatchObject({
      meta: { node_type: "HiveTask", refusedReason: expect.stringContaining("mirror-owned") },
    });
    mockReadNodeByRef.mockResolvedValue({ success: true, ref_id: "node-123", node_type: "Schema", properties: {} });
    expect(await tools.propose_delete_node.execute(args, {} as never)).toMatchObject({
      meta: { node_type: "Schema", refusedReason: expect.stringContaining("Schema") },
    });
    expect(mockGetNodeEdges).not.toHaveBeenCalled();
  });

  it("reports a failed edge read as a tool error", async () => {
    mockGetNodeEdges.mockResolvedValue({ ok: false, edges: [], nodes: [], error: "Request failed with status 503" });
    const tools = getTools();
    const result = await tools.propose_delete_node.execute(args, {} as never);
    expect(result).toEqual({ error: "Request failed with status 503" });
  });

  it("returns error when access is denied", async () => {
    mockResolveGraphJarvis.mockResolvedValue(ACCESS_DENIED);
    const tools = getTools();
    const result = await tools.propose_delete_node.execute(args, {} as never);
    expect(result).toMatchObject({ error: expect.stringContaining("access denied") });
    expect(mockReadNodeByRef).not.toHaveBeenCalled();
  });
});
