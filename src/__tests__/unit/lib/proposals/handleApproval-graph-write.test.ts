/**
 * Unit tests for graph-write approval handlers in handleApproval.ts.
 *
 * Tests:
 *  1. approveGraphNodeCreate: success (created)
 *  2. approveGraphNodeCreate: Warning/alreadyExists → success with alreadyExisted flag
 *  3. approveGraphNodeCreate: Jarvis 200+{status:"fail"} → error
 *  4. approveGraphNodeCreate: client intent.payload override is ignored
 *  5. approveGraphNodeCreate: workspace not a member of org → 403
 *  6. approveGraphNodeEdit: mirror-owned type refused pre-write
 *  7. approveGraphNodeEdit: ref_id not found → refused
 *  8. approveGraphNodeEdit: success
 *  9. approveGraphTripletCreate: success
 * 10. approveGraphBatchTripletCreate: partial failure returns per-item results
 * 11. Re-approving (prior approvalResult exists) → idempotent no-op
 * 12. Proposal not found → 404
 * 13. Caller is org member but not workspace member → 403
 * 14. approveGraphEdgeDelete: finds the edge by its ends, mutes it; gone → 404; refused → 400
 * 15. approveGraphNodeMove: links to the new parent THEN unlinks the old; a failed unlink is an
 *     error (retryable); cycle / mirror-owned / missing → refused before any write
 * 16. approveGraphNodeDelete: deletes by ref_id; gone → 404; failed → 502; refused → 400
 */

// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Hoisted mocks ──────────────────────────────────────────────────────────
const {
  mockResolveGraphJarvis,
  mockAddNode,
  mockUpdateNodeV2,
  mockAddEdgeV2,
  mockReadNodeByRef,
  mockDeleteEdge,
  mockFindEdgeByEndpoints,
  mockKgGetNode,
  mockDeleteSingleNode,
} = vi.hoisted(() => ({
  mockResolveGraphJarvis: vi.fn(),
  mockAddNode: vi.fn(),
  mockUpdateNodeV2: vi.fn(),
  mockAddEdgeV2: vi.fn(),
  mockReadNodeByRef: vi.fn(),
  mockDeleteEdge: vi.fn(),
  mockFindEdgeByEndpoints: vi.fn(),
  mockKgGetNode: vi.fn(),
  mockDeleteSingleNode: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    workspace: { findFirst: vi.fn() },
    workspaceMember: { findFirst: vi.fn() },
    initiative: { create: vi.fn(), findFirst: vi.fn() },
    milestone: { findFirst: vi.fn() },
    feature: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    swarm: { findUnique: vi.fn() },
  },
}));

vi.mock("@/lib/ai/graphWriteAuth", () => ({
  resolveGraphJarvis: mockResolveGraphJarvis,
  GRAPH_JARVIS_ACCESS_DENIED: "Workspace not found or access denied.",
}));

vi.mock("@/services/swarm/api/nodes", () => ({
  addNode: mockAddNode,
  updateNodeV2: mockUpdateNodeV2,
  addEdgeV2: mockAddEdgeV2,
  readNodeByRef: mockReadNodeByRef,
  deleteEdge: mockDeleteEdge,
  findEdgeByEndpoints: mockFindEdgeByEndpoints,
  deleteSingleNode: mockDeleteSingleNode,
}));

// The move's cycle check reads the destination's ancestors through kg-adapter.
vi.mock("@/lib/ai/kg-adapter", () => ({
  kgGetNode: mockKgGetNode,
}));

vi.mock("@/lib/canvas", () => ({
  notifyCanvasUpdated: vi.fn(),
  setLivePosition: vi.fn(),
  featureProjectsOn: vi.fn(),
  mostSpecificRef: vi.fn(),
  readAssignedFeatures: vi.fn(),
  resolvePlacement: vi.fn().mockReturnValue(null),
  findFreeSlotInViewport: vi.fn().mockReturnValue(null),
  notifyFeatureReassignmentRefresh: vi.fn(),
  ROOT_REF: "",
}));

vi.mock("@/lib/canvas/io", () => ({ readCanvas: vi.fn() }));
vi.mock("@/services/roadmap", () => ({ createFeature: vi.fn() }));
vi.mock("@/services/roadmap/feature-dependency", () => ({
  detectFeatureDependencyCycle: vi.fn().mockResolvedValue({ ok: true }),
}));
vi.mock("@/services/roadmap/feature-chat", () => ({ sendFeatureChatMessage: vi.fn() }));
vi.mock("@/lib/mcp/mcpTools", () => ({
  mcpCreatePrompt: vi.fn(),
  mcpUpdatePrompt: vi.fn(),
}));
vi.mock("@/lib/helpers/swarm-access", () => ({
  getSwarmAccessByWorkspaceId: vi.fn(),
}));
vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

// ── Imports ────────────────────────────────────────────────────────────────
import { logger } from "@/lib/logger";
import { handleApproval, type MessageLike } from "@/lib/proposals/handleApproval";
import {
  PROPOSE_CREATE_NODE_TOOL,
  PROPOSE_NODE_EDIT_TOOL,
  PROPOSE_CREATE_TRIPLET_TOOL,
  PROPOSE_CREATE_BATCH_TRIPLET_TOOL,
  PROPOSE_DELETE_EDGE_TOOL,
  PROPOSE_MOVE_NODE_TOOL,
  PROPOSE_DELETE_NODE_TOOL,
} from "@/lib/proposals/types";

// ── Fixtures ───────────────────────────────────────────────────────────────
const ORG_ID = "org-001";
const USER_ID = "user-001";
const WS_ID = "ws-001";
const WS_SLUG = "my-workspace";
const PROPOSAL_ID = "prop-abc123";

const ACCESS_OK = {
  ok: true as const,
  access: {
    workspaceId: WS_ID,
    workspaceSlug: WS_SLUG,
    config: { jarvisUrl: "https://swarm.sphinx.chat:8444", apiKey: "secret" },
  },
};

const ACCESS_DENIED = {
  ok: false as const,
  error: "Workspace not found or access denied.",
};

function makeNodeCreateMsg(proposalId = PROPOSAL_ID, overrides?: Record<string, unknown>): MessageLike {
  return {
    role: "assistant",
    toolCalls: [
      {
        toolName: PROPOSE_CREATE_NODE_TOOL,
        output: {
          kind: "graphNodeCreate",
          proposalId,
          payload: {
            workspaceId: WS_ID,
            workspaceSlug: WS_SLUG,
            node_type: "Concept",
            node_data: { name: "Test Node" },
            ...overrides,
          },
        },
      },
    ],
  };
}

function makeNodeEditMsg(
  proposalId = PROPOSAL_ID,
  nodeType = "Concept",
): MessageLike {
  return {
    role: "assistant",
    toolCalls: [
      {
        toolName: PROPOSE_NODE_EDIT_TOOL,
        output: {
          kind: "graphNodeEdit",
          proposalId,
          payload: {
            workspaceId: WS_ID,
            workspaceSlug: WS_SLUG,
            ref_id: "node-ref-123",
            node_data: { name: "Updated Name" },
          },
          meta: { oldStr: "{}", newStr: '{"name":"Updated Name"}', node_type: nodeType },
        },
      },
    ],
  };
}

function makeTripletMsg(proposalId = PROPOSAL_ID): MessageLike {
  return {
    role: "assistant",
    toolCalls: [
      {
        toolName: PROPOSE_CREATE_TRIPLET_TOOL,
        output: {
          kind: "graphTripletCreate",
          proposalId,
          payload: {
            workspaceId: WS_ID,
            workspaceSlug: WS_SLUG,
            edge_type: "USES",
            source: { ref_id: "n1" },
            target: { ref_id: "n2" },
          },
        },
      },
    ],
  };
}

function makeInlineTripletMsg(proposalId = PROPOSAL_ID): MessageLike {
  return {
    role: "assistant",
    toolCalls: [
      {
        toolName: PROPOSE_CREATE_TRIPLET_TOOL,
        output: {
          kind: "graphTripletCreate",
          proposalId,
          payload: {
            workspaceId: WS_ID,
            workspaceSlug: WS_SLUG,
            edge_type: "USES",
            source: { node_type: "Concept", node_data: { name: "Inline Src" } },
            target: { ref_id: "n2" },
          },
        },
      },
    ],
  };
}

function makeBatchMsg(proposalId = PROPOSAL_ID, count = 2): MessageLike {
  return {
    role: "assistant",
    toolCalls: [
      {
        toolName: PROPOSE_CREATE_BATCH_TRIPLET_TOOL,
        output: {
          kind: "graphBatchTripletCreate",
          proposalId,
          payload: {
            workspaceId: WS_ID,
            workspaceSlug: WS_SLUG,
            triplets: Array.from({ length: count }, (_, i) => ({
              edge_type: "USES",
              source: { ref_id: `n${i}` },
              target: { ref_id: `m${i}` },
            })),
          },
        },
      },
    ],
  };
}

function makeEdgeDeleteMsg(meta: Record<string, unknown> = {}): MessageLike {
  return {
    role: "assistant",
    toolCalls: [
      {
        toolName: PROPOSE_DELETE_EDGE_TOOL,
        output: {
          kind: "graphEdgeDelete",
          proposalId: PROPOSAL_ID,
          payload: {
            workspaceId: WS_ID,
            workspaceSlug: WS_SLUG,
            edge_type: "PARENT_OF",
            source_ref_id: "parent-1",
            target_ref_id: "node-ref-123",
          },
          meta: { workspaceSlug: WS_SLUG, edge_ref_id: "stale-edge-ref", ...meta },
        },
      },
    ],
  };
}

function makeMoveMsg(overrides: Record<string, unknown> = {}, meta: Record<string, unknown> = {}): MessageLike {
  return {
    role: "assistant",
    toolCalls: [
      {
        toolName: PROPOSE_MOVE_NODE_TOOL,
        output: {
          kind: "graphNodeMove",
          proposalId: PROPOSAL_ID,
          payload: {
            workspaceId: WS_ID,
            workspaceSlug: WS_SLUG,
            ref_id: "node-ref-123",
            edge_type: "PARENT_OF",
            from_ref_id: "parent-1",
            to_ref_id: "parent-2",
            ...overrides,
          },
          meta: { workspaceSlug: WS_SLUG, ...meta },
        },
      },
    ],
  };
}

const baseIntent = { proposalId: PROPOSAL_ID };

beforeEach(() => {
  vi.clearAllMocks();
  mockResolveGraphJarvis.mockResolvedValue(ACCESS_OK);
  mockAddNode.mockResolvedValue({ success: true, ref_id: "new-ref-001" });
  mockUpdateNodeV2.mockResolvedValue({ success: true, ref_id: "node-ref-123", status: "success" });
  mockAddEdgeV2.mockResolvedValue({ success: true, ref_id: "edge-ref-001", status: "success" });
  mockReadNodeByRef.mockResolvedValue({
    success: true,
    ref_id: "node-ref-123",
    node_type: "Concept",
    properties: {},
  });
  mockDeleteEdge.mockResolvedValue({ success: true });
  mockFindEdgeByEndpoints.mockResolvedValue({
    success: true,
    status: "success",
    ref_id: "edge-live-001",
    edge: { ref_id: "edge-live-001", properties: {} },
  });
  mockKgGetNode.mockResolvedValue({ ref_id: "parent-2", node_type: "Concept", name: "Ops" });
});

// ── approveGraphNodeCreate ────────────────────────────────────────────────

describe("approveGraphNodeCreate", () => {
  it("creates node and returns result", async () => {
    const messages: MessageLike[] = [makeNodeCreateMsg()];
    const result = await handleApproval({
      orgId: ORG_ID,
      userId: USER_ID,
      messages,
      intent: baseIntent,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result.kind).toBe("graphNodeCreate");
      expect(result.result.createdEntityId).toBe("new-ref-001");
      expect(result.result.landedOn).toBe(`workspace:${WS_ID}`);
      expect(result.result.workspaceSlug).toBe(WS_SLUG);
      expect(result.alreadyApproved).toBe(false);
    }
    expect(mockAddNode).toHaveBeenCalledOnce();
  });

  it("Warning/alreadyExists → alreadyExisted flag on result", async () => {
    mockAddNode.mockResolvedValue({
      success: true,
      ref_id: "existing-ref",
      alreadyExists: true,
    });
    const messages: MessageLike[] = [makeNodeCreateMsg()];
    const result = await handleApproval({
      orgId: ORG_ID, userId: USER_ID, messages, intent: baseIntent,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result.alreadyExisted).toBe(true);
    }
  });

  it("Jarvis 200+{status:'fail'} → error", async () => {
    mockAddNode.mockResolvedValue({ success: false, error: "node_key collision" });
    const messages: MessageLike[] = [makeNodeCreateMsg()];
    const result = await handleApproval({
      orgId: ORG_ID, userId: USER_ID, messages, intent: baseIntent,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(502);
    }
  });

  it("client intent.payload override is ignored (server uses persisted payload)", async () => {
    const messages: MessageLike[] = [makeNodeCreateMsg()];
    // Client tries to swap out workspaceId and node_type
    const intent = {
      proposalId: PROPOSAL_ID,
      payload: { workspaceId: "attacker-ws", node_type: "HackType" } as never,
    };
    await handleApproval({ orgId: ORG_ID, userId: USER_ID, messages, intent });
    // addNode should be called with the server-persisted payload, not the override
    expect(mockAddNode).toHaveBeenCalledWith(
      expect.objectContaining({ jarvisUrl: ACCESS_OK.access.config.jarvisUrl }),
      { node_type: "Concept", node_data: { name: "Test Node" } },
    );
  });

  it("workspace not member of this org → 403", async () => {
    mockResolveGraphJarvis.mockResolvedValue(ACCESS_DENIED);
    const messages: MessageLike[] = [makeNodeCreateMsg()];
    const result = await handleApproval({
      orgId: ORG_ID, userId: USER_ID, messages, intent: baseIntent,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(403);
    expect(mockAddNode).not.toHaveBeenCalled();
  });
});

// ── approveGraphNodeEdit ──────────────────────────────────────────────────

describe("approveGraphNodeEdit", () => {
  it("refuses mirror-owned type pre-write", async () => {
    mockReadNodeByRef.mockResolvedValue({
      success: true,
      ref_id: "node-ref-123",
      node_type: "HiveFeature",
      properties: {},
    });
    const messages: MessageLike[] = [makeNodeEditMsg(PROPOSAL_ID, "HiveFeature")];
    const result = await handleApproval({
      orgId: ORG_ID, userId: USER_ID, messages, intent: baseIntent,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("mirror-owned");
    }
    expect(mockUpdateNodeV2).not.toHaveBeenCalled();
  });

  it("refuses ref_id absent from graph pre-write", async () => {
    mockReadNodeByRef.mockResolvedValue({ success: false, message: "not found" });
    const messages: MessageLike[] = [makeNodeEditMsg()];
    const result = await handleApproval({
      orgId: ORG_ID, userId: USER_ID, messages, intent: baseIntent,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(404);
    expect(mockUpdateNodeV2).not.toHaveBeenCalled();
  });

  it("succeeds for valid editable node", async () => {
    const messages: MessageLike[] = [makeNodeEditMsg()];
    const result = await handleApproval({
      orgId: ORG_ID, userId: USER_ID, messages, intent: baseIntent,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result.kind).toBe("graphNodeEdit");
    }
    expect(mockUpdateNodeV2).toHaveBeenCalledOnce();
  });

  it("passes the node's namespace to updateNodeV2 and logs it", async () => {
    mockReadNodeByRef.mockResolvedValue({
      success: true,
      ref_id: "node-ref-123",
      node_type: "Concept",
      properties: {},
      namespace: "other-ns",
    });
    const result = await handleApproval({
      orgId: ORG_ID, userId: USER_ID, messages: [makeNodeEditMsg()], intent: baseIntent,
    });
    expect(result.ok).toBe(true);
    expect(mockUpdateNodeV2.mock.calls[0][3]).toBe("other-ns");
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining("approveGraphNodeEdit"),
      "handleApproval",
      expect.objectContaining({ namespace: "other-ns" }),
    );
  });

  it("passes an undefined namespace when the read returns none (logged as default)", async () => {
    const result = await handleApproval({
      orgId: ORG_ID, userId: USER_ID, messages: [makeNodeEditMsg()], intent: baseIntent,
    });
    expect(result.ok).toBe(true);
    expect(mockUpdateNodeV2).toHaveBeenCalledOnce();
    expect(mockUpdateNodeV2.mock.calls[0][3]).toBeUndefined();
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining("approveGraphNodeEdit"),
      "handleApproval",
      expect.objectContaining({ namespace: "default" }),
    );
  });
});

// ── approveGraphTripletCreate ─────────────────────────────────────────────

describe("approveGraphTripletCreate", () => {
  it("creates edge and returns result", async () => {
    const messages: MessageLike[] = [makeTripletMsg()];
    const result = await handleApproval({
      orgId: ORG_ID, userId: USER_ID, messages, intent: baseIntent,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result.kind).toBe("graphTripletCreate");
      expect(result.result.createdEntityId).toBe("edge-ref-001");
    }
    expect(mockAddEdgeV2).toHaveBeenCalledOnce();
  });

  it("inline endpoint whose node already exists (no ref_id) still creates the edge", async () => {
    // Jarvis reports the duplicate only via status_messages, so addNode
    // succeeds without a ref_id. The node exists — the approval must not fail.
    mockAddNode.mockResolvedValue({ success: true, alreadyExists: true });

    const messages: MessageLike[] = [makeInlineTripletMsg()];
    const result = await handleApproval({
      orgId: ORG_ID, userId: USER_ID, messages, intent: baseIntent,
    });

    expect(result.ok).toBe(true);
    expect(mockAddEdgeV2).toHaveBeenCalledOnce();
    // The inline spec is handed to addEdgeV2, which resolves it by node_key.
    expect(mockAddEdgeV2).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        source: { node_type: "Concept", node_data: { name: "Inline Src" } },
        target: { ref_id: "n2" },
      }),
    );
  });

  it("inline endpoint uses the returned ref_id when Jarvis provides one", async () => {
    mockAddNode.mockResolvedValue({ success: true, ref_id: "resolved-ref" });

    const messages: MessageLike[] = [makeInlineTripletMsg()];
    await handleApproval({
      orgId: ORG_ID, userId: USER_ID, messages, intent: baseIntent,
    });

    expect(mockAddEdgeV2).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ source: { ref_id: "resolved-ref" } }),
    );
  });

  it("inline endpoint whose node write fails → 502", async () => {
    mockAddNode.mockResolvedValue({ success: false, error: "jarvis down" });

    const messages: MessageLike[] = [makeInlineTripletMsg()];
    const result = await handleApproval({
      orgId: ORG_ID, userId: USER_ID, messages, intent: baseIntent,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(502);
      expect(result.error).toContain("jarvis down");
    }
    expect(mockAddEdgeV2).not.toHaveBeenCalled();
  });

  it("Warning duplicate → alreadyExisted flag", async () => {
    mockAddEdgeV2.mockResolvedValue({
      success: true,
      ref_id: "edge-ref-001",
      status: "Warning",
      alreadyExists: true,
    });
    const messages: MessageLike[] = [makeTripletMsg()];
    const result = await handleApproval({
      orgId: ORG_ID, userId: USER_ID, messages, intent: baseIntent,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result.alreadyExisted).toBe(true);
    }
  });
});

// ── approveGraphBatchTripletCreate ────────────────────────────────────────

describe("approveGraphBatchTripletCreate", () => {
  it("returns per-item results including partial failure", async () => {
    // First triplet succeeds, second fails
    mockAddEdgeV2
      .mockResolvedValueOnce({ success: true, ref_id: "edge-001" })
      .mockResolvedValueOnce({ success: false, message: "failed" });

    const messages: MessageLike[] = [makeBatchMsg(PROPOSAL_ID, 2)];
    const result = await handleApproval({
      orgId: ORG_ID, userId: USER_ID, messages, intent: baseIntent,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result.kind).toBe("graphBatchTripletCreate");
      const items = result.result.items ?? [];
      expect(items).toHaveLength(2);
      expect(items[0]).toMatchObject({ index: 0, ok: true, refId: "edge-001" });
      expect(items[1]).toMatchObject({ index: 1, ok: false });
    }
  });

  it("every triplet failing → ok:false so the approval is retryable", async () => {
    // A successful return stamps an approvalResult, and findPriorApproval
    // would then short-circuit every retry — leaving nothing written and no
    // way to re-run the batch.
    mockAddEdgeV2.mockResolvedValue({ success: false, message: "jarvis 500" });

    const messages: MessageLike[] = [makeBatchMsg(PROPOSAL_ID, 3)];
    const result = await handleApproval({
      orgId: ORG_ID, userId: USER_ID, messages, intent: baseIntent,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(502);
      expect(result.error).toContain("jarvis 500");
    }
  });

  it("all triplets succeed → all items ok", async () => {
    const messages: MessageLike[] = [makeBatchMsg(PROPOSAL_ID, 2)];
    const result = await handleApproval({
      orgId: ORG_ID, userId: USER_ID, messages, intent: baseIntent,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result.items?.every((i) => i.ok)).toBe(true);
    }
  });
});

// ── Reserved-key re-validation (forged transcript) ────────────────────────
//
// The proposal payload reaches handleApproval through the client-supplied
// `canvasChatMessages` transcript, so the propose-time reserved-key check is
// bypassable. These assert the approval-time guard actually blocks the write.

describe("reserved-key re-validation at approval time", () => {
  it("node create with a forged reserved key → 400, no write", async () => {
    const messages: MessageLike[] = [
      makeNodeCreateMsg(PROPOSAL_ID, {
        node_data: { name: "x", is_deleted: true, algo_pagerank: 1 },
      }),
    ];
    const result = await handleApproval({
      orgId: ORG_ID, userId: USER_ID, messages, intent: baseIntent,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.error).toContain("reserved key");
      expect(result.error).toContain("is_deleted");
      expect(result.error).toContain("algo_pagerank");
    }
    expect(mockAddNode).not.toHaveBeenCalled();
  });

  it("node edit with a forged reserved key → 400, no write", async () => {
    const msg = makeNodeEditMsg();
    (
      msg.toolCalls![0].output as { payload: { node_data: Record<string, unknown> } }
    ).payload.node_data = { status: "active" };

    const result = await handleApproval({
      orgId: ORG_ID, userId: USER_ID, messages: [msg], intent: baseIntent,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(400);
    expect(mockUpdateNodeV2).not.toHaveBeenCalled();
  });

  it("triplet with a forged reserved key in edge_data → 400, no write", async () => {
    const msg = makeTripletMsg();
    (
      msg.toolCalls![0].output as { payload: Record<string, unknown> }
    ).payload.edge_data = { boost: 99 };

    const result = await handleApproval({
      orgId: ORG_ID, userId: USER_ID, messages: [msg], intent: baseIntent,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("boost");
    expect(mockAddEdgeV2).not.toHaveBeenCalled();
  });

  it("batch rejects the whole payload when one triplet carries a reserved key", async () => {
    const msg = makeBatchMsg(PROPOSAL_ID, 3);
    (
      msg.toolCalls![0].output as {
        payload: { triplets: Array<Record<string, unknown>> };
      }
    ).payload.triplets[1].source = {
      node_type: "Concept",
      node_data: { name: "x", ref_id: "forged" },
    };

    const result = await handleApproval({
      orgId: ORG_ID, userId: USER_ID, messages: [msg], intent: baseIntent,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.error).toContain("triplets[1].source.node_data");
    }
    // No partial application — nothing is written.
    expect(mockAddEdgeV2).not.toHaveBeenCalled();
    expect(mockAddNode).not.toHaveBeenCalled();
  });
});

// ── Idempotency / findProposal ────────────────────────────────────────────

describe("idempotency and proposal lookup", () => {
  it("re-approving an already-approved proposal returns prior result (no write)", async () => {
    const priorResult = {
      proposalId: PROPOSAL_ID,
      kind: "graphNodeCreate" as const,
      createdEntityId: "existing-ref",
      landedOn: `workspace:${WS_ID}`,
    };
    const messages: MessageLike[] = [
      makeNodeCreateMsg(),
      { role: "assistant", approvalResult: priorResult },
    ];
    const result = await handleApproval({
      orgId: ORG_ID, userId: USER_ID, messages, intent: baseIntent,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.alreadyApproved).toBe(true);
      expect(result.result).toEqual(priorResult);
    }
    expect(mockAddNode).not.toHaveBeenCalled();
  });

  it("proposal not found → 404", async () => {
    const messages: MessageLike[] = [];
    const result = await handleApproval({
      orgId: ORG_ID, userId: USER_ID, messages,
      intent: { proposalId: "nonexistent" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(404);
  });
});

// ── approveGraphEdgeDelete ────────────────────────────────────────────────

describe("approveGraphEdgeDelete", () => {
  it("finds the edge by its ends at approval time and mutes that one, not the ref_id on the card", async () => {
    const result = await handleApproval({
      orgId: ORG_ID, userId: USER_ID, messages: [makeEdgeDeleteMsg()], intent: baseIntent,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result).toEqual({
        proposalId: PROPOSAL_ID,
        kind: "graphEdgeDelete",
        createdEntityId: "edge-live-001",
        landedOn: `workspace:${WS_ID}`,
        workspaceSlug: WS_SLUG,
      });
    }
    expect(mockFindEdgeByEndpoints).toHaveBeenCalledWith(ACCESS_OK.access.config, {
      source_ref_id: "parent-1",
      edge_type: "PARENT_OF",
      target_ref_id: "node-ref-123",
    });
    expect(mockDeleteEdge).toHaveBeenCalledWith(ACCESS_OK.access.config, "edge-live-001");
  });

  it("says so when the edge is already gone, without writing", async () => {
    mockFindEdgeByEndpoints.mockResolvedValue({ success: true, status: "success" });

    const result = await handleApproval({
      orgId: ORG_ID, userId: USER_ID, messages: [makeEdgeDeleteMsg()], intent: baseIntent,
    });

    expect(result).toMatchObject({ ok: false, status: 404, error: expect.stringContaining("already have been removed") });
    expect(mockDeleteEdge).not.toHaveBeenCalled();
  });

  it("refuses a card the propose tool refused", async () => {
    const result = await handleApproval({
      orgId: ORG_ID, userId: USER_ID, messages: [makeEdgeDeleteMsg({ refusedReason: "No edge." })], intent: baseIntent,
    });

    expect(result).toMatchObject({ ok: false, status: 400, error: "No edge." });
    expect(mockFindEdgeByEndpoints).not.toHaveBeenCalled();
  });

  it("surfaces a failed mute as 502 so the approval can be retried", async () => {
    mockDeleteEdge.mockResolvedValue({ success: false, error: "Request failed with status 500" });

    const result = await handleApproval({
      orgId: ORG_ID, userId: USER_ID, messages: [makeEdgeDeleteMsg()], intent: baseIntent,
    });

    expect(result).toMatchObject({ ok: false, status: 502, error: expect.stringContaining("500") });
  });

  it("denies a caller who is not a member of the workspace before any read", async () => {
    mockResolveGraphJarvis.mockResolvedValue(ACCESS_DENIED);

    const result = await handleApproval({
      orgId: ORG_ID, userId: USER_ID, messages: [makeEdgeDeleteMsg()], intent: baseIntent,
    });

    expect(result).toMatchObject({ ok: false, status: 403 });
    expect(mockFindEdgeByEndpoints).not.toHaveBeenCalled();
    expect(mockDeleteEdge).not.toHaveBeenCalled();
  });
});

// ── approveGraphNodeMove ──────────────────────────────────────────────────

describe("approveGraphNodeMove", () => {
  it("links the node under its new parent first, then removes the old link", async () => {
    const order: string[] = [];
    mockAddEdgeV2.mockImplementation(async () => {
      order.push("link");
      return { success: true, ref_id: "edge-new", status: "success" };
    });
    mockDeleteEdge.mockImplementation(async () => {
      order.push("unlink");
      return { success: true };
    });

    const result = await handleApproval({
      orgId: ORG_ID, userId: USER_ID, messages: [makeMoveMsg()], intent: baseIntent,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result).toEqual({
        proposalId: PROPOSAL_ID,
        kind: "graphNodeMove",
        createdEntityId: "node-ref-123",
        landedOn: `workspace:${WS_ID}`,
        workspaceSlug: WS_SLUG,
        alreadyExisted: undefined,
      });
    }
    expect(order).toEqual(["link", "unlink"]);
    expect(mockAddEdgeV2).toHaveBeenCalledWith(ACCESS_OK.access.config, {
      edge: { edge_type: "PARENT_OF" },
      source: { ref_id: "parent-2" },
      target: { ref_id: "node-ref-123" },
    });
    // The old edge is found by its ends, never taken from the card.
    expect(mockFindEdgeByEndpoints).toHaveBeenCalledWith(ACCESS_OK.access.config, {
      source_ref_id: "parent-1",
      edge_type: "PARENT_OF",
      target_ref_id: "node-ref-123",
    });
    expect(mockDeleteEdge).toHaveBeenCalledWith(ACCESS_OK.access.config, "edge-live-001");
  });

  it("flags a new link that already existed, and still removes the old one", async () => {
    mockAddEdgeV2.mockResolvedValue({ success: true, ref_id: "edge-new", status: "Warning", alreadyExists: true });

    const result = await handleApproval({
      orgId: ORG_ID, userId: USER_ID, messages: [makeMoveMsg()], intent: baseIntent,
    });

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.result.alreadyExisted).toBe(true);
    expect(mockDeleteEdge).toHaveBeenCalledOnce();
  });

  it("aborts without removing the old link when the new one is a muted existing edge", async () => {
    // Jarvis reports the muted legacy edge as a duplicate, but no read shows it.
    mockAddEdgeV2.mockResolvedValue({ success: true, ref_id: "edge-muted", status: "Warning", alreadyExists: true });
    mockFindEdgeByEndpoints
      .mockResolvedValueOnce({ success: true, status: "success", ref_id: "edge-live-001", edge: { ref_id: "edge-live-001", properties: {} } })
      .mockResolvedValueOnce({ success: true, status: "success" });

    const result = await handleApproval({
      orgId: ORG_ID, userId: USER_ID, messages: [makeMoveMsg()], intent: baseIntent,
    });

    expect(result).toMatchObject({ ok: false, status: 409, error: expect.stringContaining("old link") });
    expect(mockFindEdgeByEndpoints).toHaveBeenLastCalledWith(ACCESS_OK.access.config, {
      source_ref_id: "parent-2",
      edge_type: "PARENT_OF",
      target_ref_id: "node-ref-123",
    });
    expect(mockDeleteEdge).not.toHaveBeenCalled();
  });

  it("aborts without removing the old link when the new link can't be confirmed", async () => {
    mockFindEdgeByEndpoints
      .mockResolvedValueOnce({ success: true, status: "success", ref_id: "edge-live-001", edge: { ref_id: "edge-live-001", properties: {} } })
      .mockResolvedValueOnce({ success: false, message: "Request failed with status 500" });

    const result = await handleApproval({
      orgId: ORG_ID, userId: USER_ID, messages: [makeMoveMsg()], intent: baseIntent,
    });

    expect(result).toMatchObject({ ok: false, status: 502 });
    expect(mockDeleteEdge).not.toHaveBeenCalled();
  });

  it("leaves the node under both parents and reports an error when the old link can't be removed", async () => {
    mockDeleteEdge.mockResolvedValue({ success: false, error: "Request failed with status 500" });

    const result = await handleApproval({
      orgId: ORG_ID, userId: USER_ID, messages: [makeMoveMsg()], intent: baseIntent,
    });

    expect(result).toMatchObject({
      ok: false,
      status: 502,
      error: expect.stringContaining("Approve again to retry"),
    });
    expect(mockAddEdgeV2).toHaveBeenCalledOnce();
  });

  it("does not touch the old link when the new one can't be made", async () => {
    mockAddEdgeV2.mockResolvedValue({ success: false, message: "Edge creation returned unexpected status" });

    const result = await handleApproval({
      orgId: ORG_ID, userId: USER_ID, messages: [makeMoveMsg()], intent: baseIntent,
    });

    expect(result).toMatchObject({ ok: false, status: 502 });
    expect(mockDeleteEdge).not.toHaveBeenCalled();
  });

  it("says so when the node is no longer under the parent it was to leave", async () => {
    mockFindEdgeByEndpoints.mockResolvedValue({ success: true, status: "success" });

    const result = await handleApproval({
      orgId: ORG_ID, userId: USER_ID, messages: [makeMoveMsg()], intent: baseIntent,
    });

    expect(result).toMatchObject({ ok: false, status: 404, error: expect.stringContaining("no longer under") });
    expect(mockAddEdgeV2).not.toHaveBeenCalled();
    expect(mockDeleteEdge).not.toHaveBeenCalled();
  });

  it("refuses a destination under the node itself before any write", async () => {
    mockKgGetNode.mockResolvedValue({
      ref_id: "parent-2",
      node_type: "Concept",
      name: "Ops",
      ancestors: [{ ref_id: "node-ref-123", name: "Security", node_type: "Concept", depth: 2, parents: [] }],
    });

    const result = await handleApproval({
      orgId: ORG_ID, userId: USER_ID, messages: [makeMoveMsg()], intent: baseIntent,
    });

    expect(result).toMatchObject({ ok: false, status: 400, error: expect.stringContaining("cycle") });
    expect(mockAddEdgeV2).not.toHaveBeenCalled();
    expect(mockDeleteEdge).not.toHaveBeenCalled();
  });

  it("refuses a mirror-owned node, a missing node and a missing destination", async () => {
    mockReadNodeByRef.mockResolvedValueOnce({ success: true, ref_id: "node-ref-123", node_type: "HiveFeature", properties: {} });
    expect(
      await handleApproval({ orgId: ORG_ID, userId: USER_ID, messages: [makeMoveMsg()], intent: baseIntent }),
    ).toMatchObject({ ok: false, status: 400, error: expect.stringContaining("mirror-owned") });

    mockReadNodeByRef.mockResolvedValueOnce({ success: false, message: "not found" });
    expect(
      await handleApproval({ orgId: ORG_ID, userId: USER_ID, messages: [makeMoveMsg()], intent: baseIntent }),
    ).toMatchObject({ ok: false, status: 404, error: expect.stringContaining('Node "node-ref-123" not found') });

    mockReadNodeByRef
      .mockResolvedValueOnce({ success: true, ref_id: "node-ref-123", node_type: "Concept", properties: {} })
      .mockResolvedValueOnce({ success: false, message: "not found" });
    expect(
      await handleApproval({ orgId: ORG_ID, userId: USER_ID, messages: [makeMoveMsg()], intent: baseIntent }),
    ).toMatchObject({ ok: false, status: 404, error: expect.stringContaining('Destination "parent-2" not found') });

    expect(mockAddEdgeV2).not.toHaveBeenCalled();
    expect(mockDeleteEdge).not.toHaveBeenCalled();
  });

  it("rejects a forged payload that moves a node under itself, and a card the tool refused", async () => {
    expect(
      await handleApproval({
        orgId: ORG_ID, userId: USER_ID, messages: [makeMoveMsg({ to_ref_id: "node-ref-123" })], intent: baseIntent,
      }),
    ).toMatchObject({ ok: false, status: 400 });
    expect(
      await handleApproval({
        orgId: ORG_ID, userId: USER_ID, messages: [makeMoveMsg({}, { refusedReason: "Has 2 parents." })], intent: baseIntent,
      }),
    ).toMatchObject({ ok: false, status: 400, error: "Has 2 parents." });
    expect(mockReadNodeByRef).not.toHaveBeenCalled();
  });
});

// ── approveGraphNodeDelete ────────────────────────────────────────────────

function makeNodeDeleteMsg(
  meta: Record<string, unknown> = {},
  payloadExtra: Record<string, unknown> = {},
): MessageLike {
  return {
    role: "assistant",
    toolCalls: [
      {
        toolName: PROPOSE_DELETE_NODE_TOOL,
        output: {
          kind: "graphNodeDelete",
          proposalId: PROPOSAL_ID,
          payload: { workspaceId: WS_ID, workspaceSlug: WS_SLUG, ref_id: "node-ref-123", ...payloadExtra },
          meta: { workspaceSlug: WS_SLUG, node_name: "Old Concept", ...meta },
        },
      },
    ],
  };
}

describe("approveGraphNodeDelete", () => {
  beforeEach(() => {
    mockDeleteSingleNode.mockResolvedValue({ success: true, deletedEdgeCount: 2 });
  });

  it("logs how many links Jarvis removed", async () => {
    await handleApproval({ orgId: ORG_ID, userId: USER_ID, messages: [makeNodeDeleteMsg()], intent: baseIntent });

    expect(vi.mocked(logger.info)).toHaveBeenCalledWith(
      "[handleApproval.approveGraphNodeDelete] deleted",
      "handleApproval",
      expect.objectContaining({ deleted_edge_count: 2 }),
    );
    const fields = vi.mocked(logger.info).mock.calls.at(-1)?.[2] as Record<string, unknown>;
    expect(fields).not.toHaveProperty("deleted_edge_count_unknown");
  });

  it("logs a null count, flagged unknown, when Jarvis sent none", async () => {
    mockDeleteSingleNode.mockResolvedValue({ success: true, deletedEdgeCount: null });

    await handleApproval({ orgId: ORG_ID, userId: USER_ID, messages: [makeNodeDeleteMsg()], intent: baseIntent });

    expect(vi.mocked(logger.info)).toHaveBeenCalledWith(
      "[handleApproval.approveGraphNodeDelete] deleted",
      "handleApproval",
      expect.objectContaining({ deleted_edge_count: null, deleted_edge_count_unknown: true }),
    );
  });

  it("deletes the node by its ref_id", async () => {
    const result = await handleApproval({
      orgId: ORG_ID, userId: USER_ID, messages: [makeNodeDeleteMsg()], intent: baseIntent,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result).toEqual({
        proposalId: PROPOSAL_ID,
        kind: "graphNodeDelete",
        createdEntityId: "node-ref-123",
        landedOn: `workspace:${WS_ID}`,
        workspaceSlug: WS_SLUG,
      });
    }
    expect(mockDeleteSingleNode).toHaveBeenCalledWith(ACCESS_OK.access.config, "node-ref-123", undefined);
  });

  it("passes the payload namespace to deleteSingleNode", async () => {
    const result = await handleApproval({
      orgId: ORG_ID, userId: USER_ID, messages: [makeNodeDeleteMsg({}, { namespace: "other-ns" })], intent: baseIntent,
    });

    expect(result.ok).toBe(true);
    expect(mockDeleteSingleNode).toHaveBeenCalledWith(ACCESS_OK.access.config, "node-ref-123", "other-ns");
  });

  it("says so when the node is already gone", async () => {
    mockDeleteSingleNode.mockResolvedValue({ success: false, notFound: true, error: "Node not found — it may already have been deleted." });

    const result = await handleApproval({
      orgId: ORG_ID, userId: USER_ID, messages: [makeNodeDeleteMsg()], intent: baseIntent,
    });

    expect(result).toMatchObject({ ok: false, status: 404, error: expect.stringContaining("already have been deleted") });
  });

  it("surfaces an unconfirmed delete as 502 so the approval can be retried", async () => {
    mockDeleteSingleNode.mockResolvedValue({ success: false, error: "Jarvis did not confirm the node was deleted." });

    const result = await handleApproval({
      orgId: ORG_ID, userId: USER_ID, messages: [makeNodeDeleteMsg()], intent: baseIntent,
    });

    expect(result).toMatchObject({ ok: false, status: 502, error: expect.stringContaining("did not confirm") });
  });

  it("refuses a card the propose tool refused", async () => {
    const result = await handleApproval({
      orgId: ORG_ID, userId: USER_ID, messages: [makeNodeDeleteMsg({ refusedReason: "Schema nodes define a type." })], intent: baseIntent,
    });

    expect(result).toMatchObject({ ok: false, status: 400, error: "Schema nodes define a type." });
    expect(mockDeleteSingleNode).not.toHaveBeenCalled();
  });

  it("denies a caller who is not a member of the workspace before any write", async () => {
    mockResolveGraphJarvis.mockResolvedValue(ACCESS_DENIED);

    const result = await handleApproval({
      orgId: ORG_ID, userId: USER_ID, messages: [makeNodeDeleteMsg()], intent: baseIntent,
    });

    expect(result).toMatchObject({ ok: false, status: 403 });
    expect(mockDeleteSingleNode).not.toHaveBeenCalled();
  });
});
