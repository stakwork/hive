/**
 * Unit tests for approveConceptCreate in handleApproval.ts.
 *
 * Covers:
 *  - `parent` present → included in the fetch body
 *  - `parent` absent  → omitted from the fetch body
 *  - Swarm 400 (bad/self-parent) → error propagated with swarm's message
 *  - Swarm 500 (rollback)        → distinct message propagated intact
 *  - Swarm error body has no error field → falls back to generic message
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Hoisted mocks ──────────────────────────────────────────────────────────
const { mockFindFirst, mockGetSwarmAccess, mockFetch } = vi.hoisted(() => ({
  mockFindFirst: vi.fn(),
  mockGetSwarmAccess: vi.fn(),
  mockFetch: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    workspace: { findFirst: mockFindFirst },
    initiative: { create: vi.fn(), findFirst: vi.fn() },
    milestone: { findFirst: vi.fn() },
    feature: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("@/lib/helpers/swarm-access", () => ({
  getSwarmAccessByWorkspaceId: mockGetSwarmAccess,
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

vi.mock("@/lib/canvas/io", () => ({
  readCanvas: vi.fn(),
}));

vi.mock("@/services/roadmap", () => ({
  createFeature: vi.fn(),
}));

vi.mock("@/services/roadmap/feature-dependency", () => ({
  detectFeatureDependencyCycle: vi.fn().mockResolvedValue({ ok: true }),
}));

vi.mock("@/services/roadmap/feature-chat", () => ({
  sendFeatureChatMessage: vi.fn(),
}));

vi.mock("@/lib/mcp/mcpTools", () => ({
  mcpCreatePrompt: vi.fn(),
  mcpUpdatePrompt: vi.fn(),
}));

vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.stubGlobal("fetch", mockFetch);

// ── Imports (after mocks) ──────────────────────────────────────────────────
import { handleApproval } from "@/lib/proposals/handleApproval";
import { PROPOSE_NEW_CONCEPT_TOOL, type ProposalOutput } from "@/lib/proposals/types";

// ── Helpers ────────────────────────────────────────────────────────────────

function swarmOk() {
  mockGetSwarmAccess.mockResolvedValue({
    success: true,
    data: { swarmUrl: "https://swarm.example.com", swarmApiKey: "key" },
  });
}

function makeMessages(payload: {
  workspaceId: string;
  workspaceSlug: string;
  name: string;
  documentation: string;
  parent?: string;
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

beforeEach(() => {
  vi.clearAllMocks();
  mockFindFirst.mockResolvedValue({ id: "ws-cuid-1" });
  swarmOk();
});

// ── Tests ──────────────────────────────────────────────────────────────────

describe("approveConceptCreate — parent field in fetch body", () => {
  it("includes parent in the POST body when present in payload", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ concept: { id: "acme/hive/auth-guide" } }),
    });

    const messages = makeMessages({
      workspaceId: "ws-cuid-1",
      workspaceSlug: "acme",
      name: "Auth Guide",
      documentation: "# Auth\nDetails.",
      parent: "acme/hive/authentication",
    });

    await handleApproval({
      orgId: "org-1",
      userId: "user-1",
      messages,
      intent: { proposalId: "prop-1" },
    });

    expect(mockFetch).toHaveBeenCalledOnce();
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.parent).toBe("acme/hive/authentication");
  });

  it("omits parent from the POST body when absent in payload", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ concept: { id: "acme/hive/deploy-guide" } }),
    });

    const messages = makeMessages({
      workspaceId: "ws-cuid-1",
      workspaceSlug: "acme",
      name: "Deploy Guide",
      documentation: "# Deploy\nDetails.",
    });

    await handleApproval({
      orgId: "org-1",
      userId: "user-1",
      messages,
      intent: { proposalId: "prop-1" },
    });

    expect(mockFetch).toHaveBeenCalledOnce();
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body).not.toHaveProperty("parent");
  });
});

describe("approveConceptCreate — error propagation", () => {
  it("propagates swarm 400 (bad/self-parent) with the swarm's own error message", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: "parent not found: acme/hive/nonexistent" }),
    });

    const messages = makeMessages({
      workspaceId: "ws-cuid-1",
      workspaceSlug: "acme",
      name: "New Concept",
      documentation: "# New\nDetails.",
      parent: "acme/hive/nonexistent",
    });

    const result = await handleApproval({
      orgId: "org-1",
      userId: "user-1",
      messages,
      intent: { proposalId: "prop-1" },
    });

    expect(result.ok).toBe(false);
    expect((result as { ok: false; error: string }).error).toContain(
      "parent not found: acme/hive/nonexistent",
    );
  });

  it("propagates swarm 500 rollback with the distinct rollback message intact", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: "parent link failed; rolled back" }),
    });

    const messages = makeMessages({
      workspaceId: "ws-cuid-1",
      workspaceSlug: "acme",
      name: "Rolled Back Concept",
      documentation: "# RB\nDetails.",
      parent: "acme/hive/some-parent",
    });

    const result = await handleApproval({
      orgId: "org-1",
      userId: "user-1",
      messages,
      intent: { proposalId: "prop-1" },
    });

    expect(result.ok).toBe(false);
    expect((result as { ok: false; error: string }).error).toContain(
      "parent link failed; rolled back",
    );
  });

  it("falls back to generic message when swarm error body has no error field", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({}),
    });

    const messages = makeMessages({
      workspaceId: "ws-cuid-1",
      workspaceSlug: "acme",
      name: "Conflict Concept",
      documentation: "# C\nDetails.",
    });

    const result = await handleApproval({
      orgId: "org-1",
      userId: "user-1",
      messages,
      intent: { proposalId: "prop-1" },
    });

    expect(result.ok).toBe(false);
    expect((result as { ok: false; error: string }).error).toMatch(
      /failed to create concept/i,
    );
  });
});
