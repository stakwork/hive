/**
 * Unit tests for approveConceptCreate and approveConceptUpdate in
 * handleApproval.ts.
 *
 * Both go through the Jarvis API (addNode / updateNodeV2 + addEdgeV2), not
 * gitree — see the "Concept approvals" comment block in handleApproval.ts.
 *
 * Covers:
 *  - repo-less payload → bare-slug `id`, no `repo` key (general concept)
 *  - repo present      → repo-prefixed `id` + `repo` key
 *  - body lands in `docs` (canonical, indexed) — never `documentation`
 *  - parent present → resolved by `id` via attribute search, PARENT_OF edge
 *  - parent absent  → no search, no edge
 *  - parent not found → 400 BEFORE the node is created
 *  - self-parent (parent id == new id) → 400 before any network call
 *  - edge failure after a fresh create → deleteNode rollback
 *  - edge failure after a merge (alreadyExists) → NO rollback
 *  - addNode failure → error propagated
 *  - anchor edges (jarvis migration 111): kind → workspace edge type,
 *    APPROVED from the approver's member node, person PREFERENCE, repo
 *    IN_REPO — all best-effort (failures never fail the approval)
 */

// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Hoisted mocks ──────────────────────────────────────────────────────────
const {
  mockResolveGraphJarvis,
  mockAddNode,
  mockUpdateNodeV2,
  mockAddEdgeV2,
  mockDeleteNode,
  mockSearchNodesByAttributes,
} = vi.hoisted(() => ({
  mockResolveGraphJarvis: vi.fn(),
  mockAddNode: vi.fn(),
  mockUpdateNodeV2: vi.fn(),
  mockAddEdgeV2: vi.fn(),
  mockDeleteNode: vi.fn(),
  mockSearchNodesByAttributes: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    workspace: { findFirst: vi.fn(), findUnique: vi.fn() },
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
  readNodeByRef: vi.fn(),
  deleteNode: mockDeleteNode,
  searchNodesByAttributes: mockSearchNodesByAttributes,
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

// ── Imports (after mocks) ──────────────────────────────────────────────────
import { handleApproval } from "@/lib/proposals/handleApproval";
import { db } from "@/lib/db";
import type { Mock } from "vitest";
import {
  PROPOSE_NEW_CONCEPT_TOOL,
  PROPOSE_CONCEPT_UPDATE_TOOL,
  type ProposalOutput,
} from "@/lib/proposals/types";

// ── Helpers ────────────────────────────────────────────────────────────────

function makeMessages(payload: {
  workspaceId: string;
  workspaceSlug: string;
  name: string;
  documentation: string;
  description?: string;
  repo?: string;
  parent?: string;
  kind?: "preference" | "best_practice" | "gotcha" | "process" | "general";
  personUserId?: string;
}) {
  const proposal: ProposalOutput = {
    kind: "conceptCreate",
    proposalId: "prop-1",
    payload,
  };
  return [
    {
      role: "assistant" as const,
      toolCalls: [{ toolName: PROPOSE_NEW_CONCEPT_TOOL, output: proposal }],
    },
    {
      role: "user" as const,
      approval: { proposalId: "prop-1" },
    },
  ];
}

function approve(
  messages: ReturnType<typeof makeMessages> | ReturnType<typeof makeUpdateMessages>,
) {
  return handleApproval({
    orgId: "org-1",
    userId: "user-1",
    messages,
    intent: { proposalId: "prop-1" },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockResolveGraphJarvis.mockResolvedValue({
    ok: true,
    access: {
      workspaceId: "ws-cuid-1",
      workspaceSlug: "acme",
      config: { jarvisUrl: "https://jarvis.example.com:8444", apiKey: "key" },
    },
  });
  mockAddNode.mockResolvedValue({ success: true, ref_id: "ref-new" });
  mockUpdateNodeV2.mockResolvedValue({ success: true, status: "success" });
  mockAddEdgeV2.mockResolvedValue({ success: true });
  mockDeleteNode.mockResolvedValue({ success: true });
  mockSearchNodesByAttributes.mockResolvedValue({
    ok: true,
    nodes: [{ ref_id: "ref-parent", node_type: "Concept" }],
  });
  // Anchor-pass defaults: workspace row exists; the approver ("user-1") has
  // a member row. Individual tests override to exercise owner/edge cases.
  (db.workspace.findUnique as Mock).mockResolvedValue({
    name: "Acme",
    ownerId: "user-owner",
    owner: { name: "Owner", githubAuth: { githubUsername: "the-owner" } },
  });
  (db.workspaceMember.findFirst as Mock).mockResolvedValue({
    id: "wm-approver",
    user: { name: "Approver", githubAuth: { githubUsername: "approver" } },
  });
});

function makeUpdateMessages(payload: {
  workspaceId: string;
  workspaceSlug: string;
  conceptId: string;
  documentation: string;
}) {
  const proposal: ProposalOutput = {
    kind: "conceptUpdate",
    proposalId: "prop-1",
    payload,
    meta: { oldStr: "old body", newStr: payload.documentation },
  };
  return [
    {
      role: "assistant" as const,
      toolCalls: [{ toolName: PROPOSE_CONCEPT_UPDATE_TOOL, output: proposal }],
    },
    {
      role: "user" as const,
      approval: { proposalId: "prop-1" },
    },
  ];
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("approveConceptCreate — node_data shape", () => {
  it("repo-less payload creates a bare-slug id with no repo key (general concept)", async () => {
    const result = await approve(
      makeMessages({
        workspaceId: "ws-cuid-1",
        workspaceSlug: "acme",
        name: "Deployment Runbook",
        documentation: "# Deploy\nDetails.",
      }),
    );

    expect(result.ok).toBe(true);
    expect(mockAddNode).toHaveBeenCalledOnce();
    const [, payload] = mockAddNode.mock.calls[0];
    expect(payload.node_type).toBe("Concept");
    expect(payload.node_data.id).toBe("deployment-runbook");
    expect(payload.node_data).not.toHaveProperty("repo");
    if (result.ok) {
      expect(result.result.createdEntityId).toBe("deployment-runbook");
    }
  });

  it("repo payload creates a repo-prefixed id and carries the repo key", async () => {
    const result = await approve(
      makeMessages({
        workspaceId: "ws-cuid-1",
        workspaceSlug: "acme",
        name: "Auth Guide",
        documentation: "# Auth\nDetails.",
        repo: "acme/hive",
      }),
    );

    expect(result.ok).toBe(true);
    const [, payload] = mockAddNode.mock.calls[0];
    expect(payload.node_data.id).toBe("acme/hive/auth-guide");
    expect(payload.node_data.repo).toBe("acme/hive");
    if (result.ok) {
      expect(result.result.createdEntityId).toBe("acme/hive/auth-guide");
    }
  });

  it("writes the body to docs (canonical, indexed) — never documentation", async () => {
    await approve(
      makeMessages({
        workspaceId: "ws-cuid-1",
        workspaceSlug: "acme",
        name: "Style Rules",
        documentation: "# Style\nUse tabs.",
        description: "House style",
      }),
    );

    const [, payload] = mockAddNode.mock.calls[0];
    expect(payload.node_data.docs).toBe("# Style\nUse tabs.");
    expect(payload.node_data).not.toHaveProperty("documentation");
    expect(payload.node_data.description).toBe("House style");
  });
});

describe("approveConceptCreate — parent linking", () => {
  it("resolves the parent by id and links it with a PARENT_OF edge", async () => {
    const result = await approve(
      makeMessages({
        workspaceId: "ws-cuid-1",
        workspaceSlug: "acme",
        name: "Auth Guide",
        documentation: "# Auth\nDetails.",
        parent: "acme/hive/authentication",
      }),
    );

    expect(result.ok).toBe(true);
    expect(mockSearchNodesByAttributes).toHaveBeenCalledOnce();
    const [, searchParams] = mockSearchNodesByAttributes.mock.calls[0];
    expect(searchParams.nodeTypes).toEqual(["Concept"]);
    expect(searchParams.filters).toEqual([
      { attribute: "id", value: "acme/hive/authentication", comparator: "=" },
    ]);

    // Anchor edges (HAS_CONCEPT/APPROVED) also fire — assert on the
    // PARENT_OF call specifically, and that it precedes the anchors.
    const parentCalls = mockAddEdgeV2.mock.calls.filter(
      ([, p]) => p.edge.edge_type === "PARENT_OF",
    );
    expect(parentCalls).toHaveLength(1);
    const [, edgePayload] = parentCalls[0];
    expect(edgePayload.source).toEqual({ ref_id: "ref-parent" });
    expect(edgePayload.target).toEqual({ ref_id: "ref-new" });
    expect(mockAddEdgeV2.mock.calls[0][1].edge.edge_type).toBe("PARENT_OF");
  });

  it("makes no parent search and no PARENT_OF edge when parent is absent", async () => {
    await approve(
      makeMessages({
        workspaceId: "ws-cuid-1",
        workspaceSlug: "acme",
        name: "Deploy Guide",
        documentation: "# Deploy\nDetails.",
      }),
    );

    // No Concept-id resolution (the only searches allowed are anchor-pass
    // Repository lookups — none here, since the payload has no repo)...
    expect(mockSearchNodesByAttributes).not.toHaveBeenCalled();
    // ...and no PARENT_OF edge; anchor edges are separate and expected.
    const types = mockAddEdgeV2.mock.calls.map(([, p]) => p.edge.edge_type);
    expect(types).not.toContain("PARENT_OF");
  });

  it("returns 400 and never creates the node when the parent is not found", async () => {
    mockSearchNodesByAttributes.mockResolvedValue({ ok: true, nodes: [] });

    const result = await approve(
      makeMessages({
        workspaceId: "ws-cuid-1",
        workspaceSlug: "acme",
        name: "New Concept",
        documentation: "# New\nDetails.",
        parent: "acme/hive/nonexistent",
      }),
    );

    expect(result.ok).toBe(false);
    expect((result as { ok: false; error: string }).error).toContain(
      "Parent concept 'acme/hive/nonexistent' not found",
    );
    expect(mockAddNode).not.toHaveBeenCalled();
  });

  it("rejects a self-parent before any network call", async () => {
    const result = await approve(
      makeMessages({
        workspaceId: "ws-cuid-1",
        workspaceSlug: "acme",
        name: "Auth Guide",
        documentation: "# Auth\nDetails.",
        repo: "acme/hive",
        parent: "acme/hive/auth-guide",
      }),
    );

    expect(result.ok).toBe(false);
    expect((result as { ok: false; error: string }).error).toContain(
      "cannot be its own parent",
    );
    expect(mockSearchNodesByAttributes).not.toHaveBeenCalled();
    expect(mockAddNode).not.toHaveBeenCalled();
  });
});

describe("approveConceptCreate — failure handling", () => {
  it("rolls back a freshly-created node when the parent link fails", async () => {
    mockAddEdgeV2.mockResolvedValue({ success: false, message: "edge rejected" });

    const result = await approve(
      makeMessages({
        workspaceId: "ws-cuid-1",
        workspaceSlug: "acme",
        name: "Orphan Concept",
        documentation: "# O\nDetails.",
        parent: "acme/hive/some-parent",
      }),
    );

    expect(result.ok).toBe(false);
    expect((result as { ok: false; error: string }).error).toContain("parent link failed");
    expect(mockDeleteNode).toHaveBeenCalledOnce();
    const [, deletedRef] = mockDeleteNode.mock.calls[0];
    expect(deletedRef).toBe("ref-new");
  });

  it("does NOT roll back a pre-existing node a merge landed on when the edge fails", async () => {
    mockAddNode.mockResolvedValue({
      success: true,
      ref_id: "ref-existing",
      alreadyExists: true,
    });
    mockAddEdgeV2.mockResolvedValue({ success: false, message: "edge rejected" });

    const result = await approve(
      makeMessages({
        workspaceId: "ws-cuid-1",
        workspaceSlug: "acme",
        name: "Existing Concept",
        documentation: "# E\nDetails.",
        parent: "acme/hive/some-parent",
      }),
    );

    expect(result.ok).toBe(false);
    expect(mockDeleteNode).not.toHaveBeenCalled();
  });

  it("propagates an addNode failure", async () => {
    mockAddNode.mockResolvedValue({ success: false, error: "schema rejected node_data" });

    const result = await approve(
      makeMessages({
        workspaceId: "ws-cuid-1",
        workspaceSlug: "acme",
        name: "Bad Concept",
        documentation: "# B\nDetails.",
      }),
    );

    expect(result.ok).toBe(false);
    expect((result as { ok: false; error: string }).error).toContain(
      "schema rejected node_data",
    );
  });
});

describe("approveConceptCreate — anchor edges (migration 111)", () => {
  /** All edges written for a call, as {type, source, target} triples. */
  function edgeCalls() {
    return mockAddEdgeV2.mock.calls.map(([, payload]: any[]) => ({
      type: payload.edge.edge_type,
      source: payload.source,
      target: payload.target,
    }));
  }

  it("writes HAS_CONCEPT from the workspace node by default, plus APPROVED from the approver", async () => {
    const result = await approve(
      makeMessages({
        workspaceId: "ws-cuid-1",
        workspaceSlug: "acme",
        name: "Deployment Runbook",
        documentation: "# Deploy",
      }),
    );

    expect(result.ok).toBe(true);
    const edges = edgeCalls();

    const anchor = edges.find((e) => e.type === "HAS_CONCEPT");
    expect(anchor?.source).toEqual({
      node_type: "HiveWorkspace",
      node_data: { workspace_id: "ws-cuid-1", name: "Acme" },
    });
    // Fresh create → concept addressed by ref_id.
    expect(anchor?.target).toEqual({ ref_id: "ref-new" });

    const approved = edges.find((e) => e.type === "APPROVED");
    expect(approved?.source).toEqual({
      node_type: "HiveWorkspaceMember",
      node_data: { member_id: "wm-approver", name: "Approver", user_id: "user-1" },
    });
    expect(approved?.target).toEqual({ ref_id: "ref-new" });
  });

  it("maps kind to the typed workspace edge (preference → PREFERENCE)", async () => {
    await approve(
      makeMessages({
        workspaceId: "ws-cuid-1",
        workspaceSlug: "acme",
        name: "Evan PR Style",
        documentation: "# Short PR descriptions",
        kind: "preference",
      }),
    );
    const types = edgeCalls().map((e) => e.type);
    expect(types).toContain("PREFERENCE");
    expect(types).not.toContain("HAS_CONCEPT");
  });

  it("writes a person PREFERENCE edge from the person's member node", async () => {
    // First findFirst call resolves the approver, second the person.
    (db.workspaceMember.findFirst as Mock)
      .mockResolvedValueOnce({
        id: "wm-approver",
        user: { name: "Approver", githubAuth: { githubUsername: "approver" } },
      })
      .mockResolvedValueOnce({
        id: "wm-evan",
        user: { name: null, githubAuth: { githubUsername: "evanfeenstra" } },
      });

    await approve(
      makeMessages({
        workspaceId: "ws-cuid-1",
        workspaceSlug: "acme",
        name: "Evan PR Style",
        documentation: "# Short PR descriptions",
        kind: "preference",
        personUserId: "user-evan",
      }),
    );

    const prefs = edgeCalls().filter((e) => e.type === "PREFERENCE");
    // One from the workspace (kind), one from the person's member node.
    expect(prefs).toHaveLength(2);
    const fromMember = prefs.find(
      (e) => e.source.node_type === "HiveWorkspaceMember",
    );
    expect(fromMember?.source.node_data).toEqual({
      member_id: "wm-evan",
      name: "evanfeenstra",
      user_id: "user-evan",
    });
  });

  it("falls back to the owner identity when the approver has no member row", async () => {
    (db.workspaceMember.findFirst as Mock).mockResolvedValue(null);

    await approve(
      makeMessages({
        workspaceId: "ws-cuid-1",
        workspaceSlug: "acme",
        name: "Runbook",
        documentation: "# R",
      }),
    );

    // approver userId is "user-1" but ownerId is "user-owner" → not the owner
    // either → APPROVED skipped entirely, approval still fine.
    expect(edgeCalls().find((e) => e.type === "APPROVED")).toBeUndefined();

    // Now approve as the actual owner.
    vi.clearAllMocks();
    mockAddNode.mockResolvedValue({ success: true, ref_id: "ref-new" });
    mockAddEdgeV2.mockResolvedValue({ success: true });
    mockResolveGraphJarvis.mockResolvedValue({
      ok: true,
      access: {
        workspaceId: "ws-cuid-1",
        workspaceSlug: "acme",
        config: { jarvisUrl: "https://jarvis.example.com:8444", apiKey: "key" },
      },
    });
    (db.workspace.findUnique as Mock).mockResolvedValue({
      name: "Acme",
      ownerId: "user-1",
      owner: { name: "Owner", githubAuth: { githubUsername: "the-owner" } },
    });
    (db.workspaceMember.findFirst as Mock).mockResolvedValue(null);

    await approve(
      makeMessages({
        workspaceId: "ws-cuid-1",
        workspaceSlug: "acme",
        name: "Runbook",
        documentation: "# R",
      }),
    );
    const approved = edgeCalls().find((e) => e.type === "APPROVED");
    expect(approved?.source.node_data).toEqual({
      member_id: "user-1",
      name: "Owner",
      user_id: "user-1",
    });
  });

  it("resolves the Repository node by name and writes IN_REPO by ref_id", async () => {
    mockSearchNodesByAttributes.mockImplementation(async (_cfg: unknown, q: any) =>
      q.nodeTypes[0] === "Repository"
        ? { ok: true, nodes: [{ ref_id: "ref-repo", node_type: "Repository" }] }
        : { ok: true, nodes: [{ ref_id: "ref-parent", node_type: "Concept" }] },
    );

    await approve(
      makeMessages({
        workspaceId: "ws-cuid-1",
        workspaceSlug: "acme",
        name: "Auth Guide",
        documentation: "# Auth",
        repo: "acme/hive",
      }),
    );

    const repoSearch = mockSearchNodesByAttributes.mock.calls.find(
      ([, q]: any[]) => q.nodeTypes[0] === "Repository",
    );
    expect(repoSearch?.[1].filters).toEqual([
      { attribute: "name", value: "acme/hive", comparator: "=" },
    ]);

    const inRepo = edgeCalls().find((e) => e.type === "IN_REPO");
    expect(inRepo?.source).toEqual({ ref_id: "ref-new" });
    expect(inRepo?.target).toEqual({ ref_id: "ref-repo" });
  });

  it("skips IN_REPO (no failure) when the Repository node is not in the graph", async () => {
    mockSearchNodesByAttributes.mockImplementation(async (_cfg: unknown, q: any) =>
      q.nodeTypes[0] === "Repository"
        ? { ok: true, nodes: [] }
        : { ok: true, nodes: [{ ref_id: "ref-parent", node_type: "Concept" }] },
    );

    const result = await approve(
      makeMessages({
        workspaceId: "ws-cuid-1",
        workspaceSlug: "acme",
        name: "Auth Guide",
        documentation: "# Auth",
        repo: "acme/hive",
      }),
    );

    expect(result.ok).toBe(true);
    expect(edgeCalls().find((e) => e.type === "IN_REPO")).toBeUndefined();
  });

  it("anchor edge failures never fail the approval (best-effort)", async () => {
    mockAddEdgeV2.mockResolvedValue({ success: false, message: "anchor boom" });

    const result = await approve(
      makeMessages({
        workspaceId: "ws-cuid-1",
        workspaceSlug: "acme",
        name: "Runbook",
        documentation: "# R",
        kind: "gotcha",
      }),
    );

    expect(result.ok).toBe(true);
    expect(mockDeleteNode).not.toHaveBeenCalled();
  });

  it("addresses the concept by inline node_data when a merge returned no ref_id", async () => {
    mockAddNode.mockResolvedValue({ success: true, alreadyExists: true });

    await approve(
      makeMessages({
        workspaceId: "ws-cuid-1",
        workspaceSlug: "acme",
        name: "Existing Concept",
        documentation: "# E",
      }),
    );

    const anchor = edgeCalls().find((e) => e.type === "HAS_CONCEPT");
    expect(anchor?.target).toEqual({
      node_type: "Concept",
      node_data: { name: "Existing Concept" },
    });
  });
});

describe("approveConceptUpdate — jarvis update path", () => {
  it("resolves the ref_id by concept id and writes the new body to docs", async () => {
    const result = await approve(
      makeUpdateMessages({
        workspaceId: "ws-cuid-1",
        workspaceSlug: "acme",
        conceptId: "acme/hive/auth-guide",
        documentation: "# Auth v2\nNew details.",
      }),
    );

    expect(result.ok).toBe(true);
    expect(mockSearchNodesByAttributes).toHaveBeenCalledOnce();
    const [, searchParams] = mockSearchNodesByAttributes.mock.calls[0];
    expect(searchParams.filters).toEqual([
      { attribute: "id", value: "acme/hive/auth-guide", comparator: "=" },
    ]);

    expect(mockUpdateNodeV2).toHaveBeenCalledOnce();
    const [, refId, nodeData] = mockUpdateNodeV2.mock.calls[0];
    expect(refId).toBe("ref-parent");
    expect(nodeData).toEqual({ docs: "# Auth v2\nNew details." });
    if (result.ok) {
      expect(result.result.createdEntityId).toBe("acme/hive/auth-guide");
    }
  });

  it("returns 404 without writing when the concept id resolves to nothing", async () => {
    mockSearchNodesByAttributes.mockResolvedValue({ ok: true, nodes: [] });

    const result = await approve(
      makeUpdateMessages({
        workspaceId: "ws-cuid-1",
        workspaceSlug: "acme",
        conceptId: "acme/hive/nonexistent",
        documentation: "# N\nDetails.",
      }),
    );

    expect(result.ok).toBe(false);
    expect((result as { ok: false; error: string }).error).toContain(
      "Concept 'acme/hive/nonexistent' not found",
    );
    expect(mockUpdateNodeV2).not.toHaveBeenCalled();
  });

  it("propagates an updateNodeV2 failure", async () => {
    mockUpdateNodeV2.mockResolvedValue({ success: false, message: "invalid properties" });

    const result = await approve(
      makeUpdateMessages({
        workspaceId: "ws-cuid-1",
        workspaceSlug: "acme",
        conceptId: "acme/hive/auth-guide",
        documentation: "# A\nDetails.",
      }),
    );

    expect(result.ok).toBe(false);
    expect((result as { ok: false; error: string }).error).toContain("invalid properties");
  });
});
