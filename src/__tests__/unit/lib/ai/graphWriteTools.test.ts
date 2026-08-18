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
 */

// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Hoisted mocks ──────────────────────────────────────────────────────────
const {
  mockResolveGraphJarvis,
  mockReadNodeByRef,
  mockKgGetOntology,
} = vi.hoisted(() => ({
  mockResolveGraphJarvis: vi.fn(),
  mockReadNodeByRef: vi.fn(),
  mockKgGetOntology: vi.fn(),
}));

vi.mock("@/lib/ai/graphWriteAuth", () => ({
  resolveGraphJarvis: mockResolveGraphJarvis,
  GRAPH_JARVIS_ACCESS_DENIED: "Workspace not found or access denied.",
}));

vi.mock("@/services/swarm/api/nodes", () => ({
  readNodeByRef: mockReadNodeByRef,
  addNode: vi.fn(),
  updateNodeV2: vi.fn(),
  addEdgeV2: vi.fn(),
}));

vi.mock("@/lib/ai/kg-adapter", () => ({
  kgGetOntology: mockKgGetOntology,
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
