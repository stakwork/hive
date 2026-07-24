/**
 * Unit tests for buildWorkflowExplorerTools
 *
 * Coverage:
 *   - Isolation: no-context callers (no ctx) create no row and pass no webhookUrl.
 *   - Isolation: callers with ctx but no currentCanvasConversationId create no row.
 *   - User cancellation: REPO_AGENT_CANCELLED_MARKER → row claimed FAILED.
 *   - Initiation failure (throws before request_id) → row claimed FAILED.
 *   - Inline success: row claimed DELIVERED_INLINE; content returned.
 *   - Inline race (webhook claimed first): "already posted" note returned.
 *   - Poll timeout with request_id: row stays PENDING; "still running" message.
 *   - Tool signature / schema sanity.
 */

import { describe, test, expect, vi, beforeEach } from "vitest";

// ── Hoisted mock factories ────────────────────────────────────────────────────

const {
  mockRepoAgent,
  mockResolveWorkflowLibrarySwarm,
  mockResolveOrgConversationRowId,
  mockAgentRunCreate,
  mockAgentRunUpdate,
  mockAgentRunUpdateMany,
  mockRandomBytes,
} = vi.hoisted(() => ({
  mockRepoAgent: vi.fn(),
  mockResolveWorkflowLibrarySwarm: vi.fn(),
  mockResolveOrgConversationRowId: vi.fn(),
  mockAgentRunCreate: vi.fn(),
  mockAgentRunUpdate: vi.fn(),
  mockAgentRunUpdateMany: vi.fn(),
  mockRandomBytes: vi.fn(),
}));

vi.mock("@/lib/ai/askTools", () => ({
  repoAgent: mockRepoAgent,
  REPO_AGENT_CANCELLED_MARKER: "__repo_agent_user_cancelled__",
}));

vi.mock("@/lib/db", () => ({
  db: {
    workspace: { findFirst: vi.fn().mockResolvedValue({ id: "ws-id" }) },
    swarm: {
      findFirst: vi.fn().mockResolvedValue({
        swarmUrl: "https://swarm.example.com:3355",
        swarmApiKey: "encrypted-key",
      }),
    },
    agentRun: {
      create: mockAgentRunCreate,
      update: mockAgentRunUpdate,
      updateMany: mockAgentRunUpdateMany,
    },
  },
}));

vi.mock("@/lib/encryption", () => ({
  EncryptionService: {
    getInstance: () => ({
      decryptField: vi.fn().mockReturnValue("decrypted-api-key"),
    }),
  },
}));

vi.mock("@/config/env", () => ({
  config: { STAKWORK_API_KEY: undefined },
}));

vi.mock("@/services/org-canvas-conversation", () => ({
  resolveOrgConversationRowId: mockResolveOrgConversationRowId,
}));

// Intercept crypto.randomBytes
vi.mock("crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("crypto")>();
  return {
    ...actual,
    default: {
      ...actual,
      randomBytes: (n: number) => {
        const result = mockRandomBytes(n);
        if (result) return result;
        return actual.randomBytes(n);
      },
      createHash: actual.createHash, // keep real SHA-256 for tokenHash
    },
  };
});

import { buildWorkflowExplorerTools } from "@/lib/ai/workflowExplorerTools";
import type { CapabilityContext } from "@/lib/ai/capabilities";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeCtx(overrides: Partial<CapabilityContext> = {}): CapabilityContext {
  return {
    orgId: "org-1",
    userId: "user-1",
    capturedWebSearchResults: [],
    ...overrides,
  };
}

function getExecute(ctx?: CapabilityContext) {
  const tools = buildWorkflowExplorerTools(ctx);
  const tool = tools["workflow_explorer_agent"] as unknown as {
    execute: (input: { prompt: string; run_step?: boolean }) => Promise<unknown>;
  };
  return tool.execute.bind(tool);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("buildWorkflowExplorerTools", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRandomBytes.mockReturnValue(null); // fall through to real crypto by default
    mockRepoAgent.mockResolvedValue({ content: "workflow research result" });
    mockAgentRunCreate.mockResolvedValue({ id: "run-test-1" });
    mockAgentRunUpdateMany.mockResolvedValue({ count: 1 });
    mockAgentRunUpdate.mockResolvedValue({});
    mockResolveOrgConversationRowId.mockResolvedValue("validated-conv-id");
  });

  // ── Tool schema ──────────────────────────────────────────────────────────────

  test("produces a workflow_explorer_agent tool", () => {
    const tools = buildWorkflowExplorerTools();
    expect(tools).toHaveProperty("workflow_explorer_agent");
  });

  // ── Isolation: no-context callers ────────────────────────────────────────────

  test("no ctx: does NOT create an AgentRun row or pass webhookUrl", async () => {
    const execute = getExecute(/* no ctx */);
    await execute({ prompt: "find transcription skills" });

    expect(mockAgentRunCreate).not.toHaveBeenCalled();
    // repoAgent called without webhookUrl or webhookToken
    const call = mockRepoAgent.mock.calls[0];
    expect(call[2]).not.toHaveProperty("webhookUrl");
    expect(call[2]).not.toHaveProperty("webhookToken");
  });

  test("ctx without currentCanvasConversationId: does NOT create row", async () => {
    const execute = getExecute(makeCtx({ publicBaseUrl: "https://hive.example.com" }));
    await execute({ prompt: "find transcription skills" });

    expect(mockAgentRunCreate).not.toHaveBeenCalled();
  });

  test("ctx without publicBaseUrl: does NOT create row", async () => {
    const execute = getExecute(makeCtx({ currentCanvasConversationId: "conv-1" }));
    await execute({ prompt: "find transcription skills" });

    expect(mockAgentRunCreate).not.toHaveBeenCalled();
  });

  test("ctx with conversation that fails ownership check: does NOT create row", async () => {
    mockResolveOrgConversationRowId.mockResolvedValue(null); // IDOR check fails
    const execute = getExecute(
      makeCtx({ currentCanvasConversationId: "conv-1", publicBaseUrl: "https://hive.example.com" }),
    );
    await execute({ prompt: "find transcription skills" });

    expect(mockAgentRunCreate).not.toHaveBeenCalled();
  });

  // ── Inline success path ───────────────────────────────────────────────────────

  test("inline success: creates row, claims DELIVERED_INLINE, returns content", async () => {
    const execute = getExecute(
      makeCtx({ currentCanvasConversationId: "conv-1", publicBaseUrl: "https://hive.example.com" }),
    );
    const result = await execute({ prompt: "find transcription skills" });

    expect(mockAgentRunCreate).toHaveBeenCalledOnce();
    const createArgs = mockAgentRunCreate.mock.calls[0][0].data;
    expect(createArgs.conversationId).toBe("validated-conv-id");
    expect(createArgs.orgId).toBe("org-1");
    expect(createArgs.userId).toBe("user-1");
    expect(typeof createArgs.tokenHash).toBe("string");
    expect(createArgs.tokenHash).toHaveLength(64); // SHA-256 hex

    // webhookUrl passed to repoAgent (only url part, not the token)
    const repoAgentParams = mockRepoAgent.mock.calls[0][2];
    expect(repoAgentParams.webhookUrl).toContain("/api/agent-runs/webhook?id=");
    expect(repoAgentParams.webhookToken).toBeTruthy(); // raw token included separately

    // Claimed DELIVERED_INLINE
    expect(mockAgentRunUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: "PENDING" }),
        data: expect.objectContaining({ status: "DELIVERED_INLINE" }),
      }),
    );

    // Content returned
    expect(result).toBe("workflow research result");
  });

  test("inline race (webhook won first): returns 'already posted' note", async () => {
    // Simulate webhook claimed first — updateMany returns count=0
    mockAgentRunUpdateMany.mockResolvedValue({ count: 0 });

    const execute = getExecute(
      makeCtx({ currentCanvasConversationId: "conv-1", publicBaseUrl: "https://hive.example.com" }),
    );
    const result = await execute({ prompt: "find transcription skills" });

    expect(result).toContain("already been posted");
  });

  // ── User cancellation ─────────────────────────────────────────────────────────

  test("user cancellation: claims row FAILED, returns cancelled message", async () => {
    mockRepoAgent.mockResolvedValue("__repo_agent_user_cancelled__");

    const execute = getExecute(
      makeCtx({ currentCanvasConversationId: "conv-1", publicBaseUrl: "https://hive.example.com" }),
    );
    const result = await execute({ prompt: "find transcription skills" });

    // Row claimed FAILED
    expect(mockAgentRunUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: "PENDING" }),
        data: expect.objectContaining({ status: "FAILED" }),
      }),
    );

    expect(result).toContain("cancelled");
  });

  test("no-context cancellation: no row interaction, returns cancelled message", async () => {
    mockRepoAgent.mockResolvedValue("__repo_agent_user_cancelled__");

    const execute = getExecute(/* no ctx */);
    const result = await execute({ prompt: "find transcription skills" });

    expect(mockAgentRunCreate).not.toHaveBeenCalled();
    expect(mockAgentRunUpdateMany).not.toHaveBeenCalled();
    expect(result).toContain("cancelled");
  });

  // ── Initiation failure ────────────────────────────────────────────────────────

  test("initiation failure (throws before request_id): claims row FAILED immediately", async () => {
    mockRepoAgent.mockRejectedValue(new Error("Failed to initiate repo agent"));

    const execute = getExecute(
      makeCtx({ currentCanvasConversationId: "conv-1", publicBaseUrl: "https://hive.example.com" }),
    );
    const result = await execute({ prompt: "find transcription skills" });

    // hasRequestId is false → initiation failure path
    expect(mockAgentRunUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "FAILED" }),
      }),
    );
    // Not the poll-timeout message
    expect(result).not.toContain("still running");
    expect(result).toContain("Could not execute");
  });

  test("initiation failure with no ctx: no row interaction, returns error message", async () => {
    mockRepoAgent.mockRejectedValue(new Error("swarm error"));

    const execute = getExecute(/* no ctx */);
    const result = await execute({ prompt: "find transcription skills" });

    expect(mockAgentRunCreate).not.toHaveBeenCalled();
    expect(mockAgentRunUpdateMany).not.toHaveBeenCalled();
    expect(result).toContain("Could not execute");
  });

  // ── Poll timeout after genuine start ─────────────────────────────────────────

  test("poll timeout after genuine start: row stays PENDING, returns 'still running' message", async () => {
    // Simulate: onRequestId fires first (setting hasRequestId = true), then repoAgent throws
    let onRequestIdHook: ((id: string) => Promise<void>) | undefined;
    mockRepoAgent.mockImplementation(
      async (_url: unknown, _key: unknown, _params: unknown, _bifrost: unknown, hooks: { onRequestId?: (id: string) => Promise<void> }) => {
        onRequestIdHook = hooks?.onRequestId;
        if (onRequestIdHook) await onRequestIdHook("req-123");
        throw new Error("Repo agent execution timed out. Please try again.");
      },
    );

    const execute = getExecute(
      makeCtx({ currentCanvasConversationId: "conv-1", publicBaseUrl: "https://hive.example.com" }),
    );
    const result = await execute({ prompt: "find transcription skills" });

    // Row NOT claimed (stays PENDING)
    expect(mockAgentRunUpdateMany).not.toHaveBeenCalled();

    // requestId saved to the row
    expect(mockAgentRunUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ requestId: "req-123" }),
      }),
    );

    // "still running" message
    expect(result).toContain("still running");
    expect(result).not.toContain("Could not execute");
  });

  // ── Token security ────────────────────────────────────────────────────────────

  test("webhookUrl contains only the run id, not the raw token", async () => {
    const execute = getExecute(
      makeCtx({ currentCanvasConversationId: "conv-1", publicBaseUrl: "https://hive.example.com" }),
    );
    await execute({ prompt: "find transcription skills" });

    const repoAgentParams = mockRepoAgent.mock.calls[0][2];
    const url: string = repoAgentParams.webhookUrl;
    // URL should not contain the raw token (64-char hex string from randomBytes)
    expect(url).not.toMatch(/[0-9a-f]{64}/i);
    expect(url).toContain("?id=");
  });

  test("stored tokenHash is SHA-256 of the raw token, not the raw token itself", async () => {
    const execute = getExecute(
      makeCtx({ currentCanvasConversationId: "conv-1", publicBaseUrl: "https://hive.example.com" }),
    );
    await execute({ prompt: "find transcription skills" });

    const createArgs = mockAgentRunCreate.mock.calls[0][0].data;
    const rawToken = mockRepoAgent.mock.calls[0][2].webhookToken as string;

    // tokenHash must be the SHA-256 of rawToken, not the rawToken itself
    const expectedHash = require("crypto")
      .createHash("sha256")
      .update(rawToken)
      .digest("hex");
    expect(createArgs.tokenHash).toBe(expectedHash);
    expect(createArgs.tokenHash).not.toBe(rawToken);
  });
});
