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
} = vi.hoisted(() => ({
  mockResolveGraphJarvis: vi.fn(),
  mockAddNode: vi.fn(),
  mockUpdateNodeV2: vi.fn(),
  mockAddEdgeV2: vi.fn(),
  mockReadNodeByRef: vi.fn(),
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
import { handleApproval, type MessageLike } from "@/lib/proposals/handleApproval";
import {
  PROPOSE_CREATE_NODE_TOOL,
  PROPOSE_NODE_EDIT_TOOL,
  PROPOSE_CREATE_TRIPLET_TOOL,
  PROPOSE_CREATE_BATCH_TRIPLET_TOOL,
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
