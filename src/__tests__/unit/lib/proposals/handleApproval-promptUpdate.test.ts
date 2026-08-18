/**
 * Unit tests for approvePromptUpdate in handleApproval.ts.
 *
 * Covers:
 *  - promptVersionId + workspaceSlug threaded into ApprovalResult on success
 *  - slug comes from the name-resolved stakwork workspace row (not hardcoded)
 *  - malformed MCP payload → approval still succeeds, warn logged, promptVersionId absent
 *  - regression guard: returned ApprovalResult contains no `value` field
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Hoisted mocks ──────────────────────────────────────────────────────────
const {
  mockWorkspaceFindFirst,
  mockMemberFindFirst,
  mockMcpUpdatePrompt,
  mockLogger,
} = vi.hoisted(() => ({
  mockWorkspaceFindFirst: vi.fn(),
  mockMemberFindFirst: vi.fn(),
  mockMcpUpdatePrompt: vi.fn(),
  mockLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("@/lib/db", () => ({
  db: {
    workspace: { findFirst: mockWorkspaceFindFirst },
    workspaceMember: { findFirst: mockMemberFindFirst },
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
  getSwarmAccessByWorkspaceId: vi.fn(),
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

vi.mock("@/services/roadmap/feature-chat", () => ({
  sendFeatureChatMessage: vi.fn(),
}));

vi.mock("@/lib/mcp/mcpTools", () => ({
  mcpCreatePrompt: vi.fn(),
  mcpUpdatePrompt: mockMcpUpdatePrompt,
}));

vi.mock("@/lib/logger", () => ({ logger: mockLogger }));

vi.stubGlobal("fetch", vi.fn());

// ── Imports (after mocks) ──────────────────────────────────────────────────
import { handleApproval } from "@/lib/proposals/handleApproval";
import type { ProposalOutput } from "@/lib/proposals/types";
import { PROPOSE_PROMPT_UPDATE_TOOL } from "@/lib/proposals/types";

// ── Helpers ────────────────────────────────────────────────────────────────

const STAKWORK_WORKSPACE = { id: "ws-stakwork", slug: "stakwork" };
const PROMPT_ID = "prompt-abc";
const VERSION_ID = "version-xyz";

function makeProposal(payload: { promptId: string; value: string; description?: string }) {
  return {
    proposalId: "proposal-1",
    kind: "promptUpdate" as const,
    payload,
  } as Extract<ProposalOutput, { kind: "promptUpdate" }>;
}

function makeMessages(proposal: ReturnType<typeof makeProposal>) {
  return [
    {
      role: "assistant" as const,
      toolCalls: [
        {
          toolName: PROPOSE_PROMPT_UPDATE_TOOL,
          output: proposal,
        },
      ],
    },
    {
      role: "user" as const,
      approval: { proposalId: proposal.proposalId },
    },
  ];
}

function mcpOk(versionId: string, extraFields?: Record<string, unknown>) {
  // NOTE: payload also carries the full `value` — regression guard ensures it's never spread.
  return {
    isError: false,
    content: [{ text: JSON.stringify({ versionId, value: "should-not-appear", ...extraFields }) }],
  };
}

function mcpError(msg: string) {
  return { isError: true, content: [{ text: msg }] };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("approvePromptUpdate — promptVersionId + workspaceSlug", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWorkspaceFindFirst.mockResolvedValue(STAKWORK_WORKSPACE);
    mockMemberFindFirst.mockResolvedValue({ id: "member-1" });
  });

  it("threads promptVersionId and workspaceSlug into ApprovalResult on success", async () => {
    mockMcpUpdatePrompt.mockResolvedValue(mcpOk(VERSION_ID));

    const proposal = makeProposal({ promptId: PROMPT_ID, value: "new body" });
    const result = await handleApproval({
      orgId: "org-1",
      userId: "user-1",
      proposal,
      messages: makeMessages(proposal),
      intent: { proposalId: proposal.proposalId },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result.kind).toBe("promptUpdate");
    expect(result.result.promptVersionId).toBe(VERSION_ID);
    expect(result.result.workspaceSlug).toBe("stakwork");
    // workspaceSlug must come from the DB row, not a hardcoded string
    expect(result.result.workspaceSlug).toBe(STAKWORK_WORKSPACE.slug);
  });

  it("workspaceSlug is the slug of the name-resolved stakwork workspace row", async () => {
    // Use a different slug to confirm it's not hardcoded
    mockWorkspaceFindFirst.mockResolvedValue({ id: "ws-stakwork", slug: "stakwork-custom-slug" });
    mockMcpUpdatePrompt.mockResolvedValue(mcpOk(VERSION_ID));

    const proposal = makeProposal({ promptId: PROMPT_ID, value: "v" });
    const result = await handleApproval({
      orgId: "org-1",
      userId: "user-1",
      proposal,
      messages: makeMessages(proposal),
      intent: { proposalId: proposal.proposalId },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result.workspaceSlug).toBe("stakwork-custom-slug");
  });

  it("approval succeeds but promptVersionId is absent when MCP payload is malformed JSON", async () => {
    mockMcpUpdatePrompt.mockResolvedValue({
      isError: false,
      content: [{ text: "not-valid-json" }],
    });

    const proposal = makeProposal({ promptId: PROMPT_ID, value: "v" });
    const result = await handleApproval({
      orgId: "org-1",
      userId: "user-1",
      proposal,
      messages: makeMessages(proposal),
      intent: { proposalId: proposal.proposalId },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result.promptVersionId).toBeUndefined();
    expect(result.result.workspaceSlug).toBe(STAKWORK_WORKSPACE.slug);
    // Warning must have been logged with proposalId and promptId only
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining("versionId parse failed"),
      "handleApproval",
      expect.objectContaining({
        proposalId: proposal.proposalId,
        promptId: PROMPT_ID,
      }),
    );
  });

  it("approval succeeds but promptVersionId is absent when versionId is not a string", async () => {
    mockMcpUpdatePrompt.mockResolvedValue({
      isError: false,
      content: [{ text: JSON.stringify({ versionId: 42 }) }],
    });

    const proposal = makeProposal({ promptId: PROMPT_ID, value: "v" });
    const result = await handleApproval({
      orgId: "org-1",
      userId: "user-1",
      proposal,
      messages: makeMessages(proposal),
      intent: { proposalId: proposal.proposalId },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result.promptVersionId).toBeUndefined();
  });

  it("REGRESSION: returned ApprovalResult must not contain the prompt value", async () => {
    mockMcpUpdatePrompt.mockResolvedValue(mcpOk(VERSION_ID));

    const proposal = makeProposal({ promptId: PROMPT_ID, value: "secret-prompt-body" });
    const result = await handleApproval({
      orgId: "org-1",
      userId: "user-1",
      proposal,
      messages: makeMessages(proposal),
      intent: { proposalId: proposal.proposalId },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The full result object must not contain the prompt value anywhere
    const serialized = JSON.stringify(result.result);
    expect(serialized).not.toContain("secret-prompt-body");
    expect(serialized).not.toContain("should-not-appear");
    expect((result.result as Record<string, unknown>).value).toBeUndefined();
  });

  it("returns 403 when user is not a member of stakwork workspace", async () => {
    mockMemberFindFirst.mockResolvedValue(null);

    const proposal = makeProposal({ promptId: PROMPT_ID, value: "v" });
    const result = await handleApproval({
      orgId: "org-1",
      userId: "user-1",
      proposal,
      messages: makeMessages(proposal),
      intent: { proposalId: proposal.proposalId },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.status).toBe(403);
    expect(mockMcpUpdatePrompt).not.toHaveBeenCalled();
  });

  it("returns error when MCP update fails", async () => {
    mockMcpUpdatePrompt.mockResolvedValue(mcpError("Prompt not found"));

    const proposal = makeProposal({ promptId: PROMPT_ID, value: "v" });
    const result = await handleApproval({
      orgId: "org-1",
      userId: "user-1",
      proposal,
      messages: makeMessages(proposal),
      intent: { proposalId: proposal.proposalId },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("Prompt not found");
  });
});
