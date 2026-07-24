/**
 * Unit tests for buildWorkflowExplorerTools
 *
 * Coverage:
 *   - Isolation: no-context callers use the inline poll path (no row, no webhookUrl).
 *   - Ctx without currentCanvasConversationId / publicBaseUrl / ownership: same fallback.
 *   - Dispatch path (canvas): row created, dispatchRepoAgent called with a tokenized
 *     webhookUrl, requestId saved, dispatch message returned, row left PENDING
 *     (the webhook is the sole delivery path — no poll, no inline claim).
 *   - Fan-back setup failure: degrades to the inline poll path.
 *   - Initiation failure (dispatch throws before a request_id) → row claimed FAILED.
 *   - Inline poll path: content return, cancellation marker, and error behavior unchanged.
 *   - Token security: the bearer token rides in the webhookUrl; only its SHA-256 is stored.
 */

import { describe, test, expect, vi, beforeEach } from "vitest";
import crypto from "crypto";

// ── Hoisted mock factories ────────────────────────────────────────────────────

const {
  mockRepoAgent,
  mockDispatchRepoAgent,
  mockResolveOrgConversationRowId,
  mockAgentRunCreate,
  mockAgentRunUpdate,
  mockAgentRunUpdateMany,
} = vi.hoisted(() => ({
  mockRepoAgent: vi.fn(),
  mockDispatchRepoAgent: vi.fn(),
  mockResolveOrgConversationRowId: vi.fn(),
  mockAgentRunCreate: vi.fn(),
  mockAgentRunUpdate: vi.fn(),
  mockAgentRunUpdateMany: vi.fn(),
}));

vi.mock("@/lib/ai/askTools", () => ({
  repoAgent: mockRepoAgent,
  dispatchRepoAgent: mockDispatchRepoAgent,
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

/** Ctx with both fan-back prerequisites (conversation + public base URL). */
function makeCanvasCtx(): CapabilityContext {
  return makeCtx({
    currentCanvasConversationId: "conv-1",
    publicBaseUrl: "https://hive.example.com",
  });
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
    mockRepoAgent.mockResolvedValue({ content: "workflow research result" });
    mockDispatchRepoAgent.mockResolvedValue("req-123");
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

  // ── Isolation: no-context callers use the inline poll path ───────────────────

  test("no ctx: polls inline — no AgentRun row, no dispatch, no webhookUrl", async () => {
    const execute = getExecute(/* no ctx */);
    const result = await execute({ prompt: "find transcription skills" });

    expect(mockAgentRunCreate).not.toHaveBeenCalled();
    expect(mockDispatchRepoAgent).not.toHaveBeenCalled();
    expect(mockRepoAgent).toHaveBeenCalledOnce();
    expect(mockRepoAgent.mock.calls[0][2]).not.toHaveProperty("webhookUrl");
    expect(result).toBe("workflow research result");
  });

  test("ctx without currentCanvasConversationId: polls inline, no row", async () => {
    const execute = getExecute(makeCtx({ publicBaseUrl: "https://hive.example.com" }));
    await execute({ prompt: "find transcription skills" });

    expect(mockAgentRunCreate).not.toHaveBeenCalled();
    expect(mockDispatchRepoAgent).not.toHaveBeenCalled();
    expect(mockRepoAgent).toHaveBeenCalledOnce();
  });

  test("ctx without publicBaseUrl: polls inline, no row", async () => {
    const execute = getExecute(makeCtx({ currentCanvasConversationId: "conv-1" }));
    await execute({ prompt: "find transcription skills" });

    expect(mockAgentRunCreate).not.toHaveBeenCalled();
    expect(mockDispatchRepoAgent).not.toHaveBeenCalled();
    expect(mockRepoAgent).toHaveBeenCalledOnce();
  });

  test("ctx with conversation that fails ownership check: polls inline, no row", async () => {
    mockResolveOrgConversationRowId.mockResolvedValue(null); // IDOR check fails
    const execute = getExecute(makeCanvasCtx());
    await execute({ prompt: "find transcription skills" });

    expect(mockAgentRunCreate).not.toHaveBeenCalled();
    expect(mockDispatchRepoAgent).not.toHaveBeenCalled();
    expect(mockRepoAgent).toHaveBeenCalledOnce();
  });

  // ── Dispatch path (canvas conversation) ──────────────────────────────────────

  test("canvas ctx: creates row, dispatches with webhookUrl, returns background message", async () => {
    const execute = getExecute(makeCanvasCtx());
    const result = await execute({ prompt: "find transcription skills" });

    // Row created with validated ownership fields and a hashed token
    expect(mockAgentRunCreate).toHaveBeenCalledOnce();
    const createArgs = mockAgentRunCreate.mock.calls[0][0].data;
    expect(createArgs.conversationId).toBe("validated-conv-id");
    expect(createArgs.orgId).toBe("org-1");
    expect(createArgs.userId).toBe("user-1");
    expect(createArgs.tokenHash).toHaveLength(64); // SHA-256 hex

    // Dispatch-only: no poll loop
    expect(mockDispatchRepoAgent).toHaveBeenCalledOnce();
    expect(mockRepoAgent).not.toHaveBeenCalled();

    // webhookUrl carries id + bearer token in the query string (stakgraph
    // POSTs the URL verbatim with no custom headers)
    const dispatchParams = mockDispatchRepoAgent.mock.calls[0][2];
    expect(dispatchParams.webhookUrl).toContain("/api/agent-runs/webhook?id=");
    expect(dispatchParams.webhookUrl).toMatch(/&token=[0-9a-f]{64}$/i);

    // requestId saved; row NOT claimed (stays PENDING for the webhook)
    expect(mockAgentRunUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "run-test-1" },
        data: expect.objectContaining({ requestId: "req-123" }),
      }),
    );
    expect(mockAgentRunUpdateMany).not.toHaveBeenCalled();

    expect(result).toContain("researching in the background");
  });

  test("requestId save failure is non-fatal — dispatch message still returned", async () => {
    mockAgentRunUpdate.mockRejectedValue(new Error("db write failed"));
    const execute = getExecute(makeCanvasCtx());
    const result = await execute({ prompt: "find transcription skills" });

    expect(result).toContain("researching in the background");
  });

  test("fan-back setup failure degrades to the inline poll path", async () => {
    mockAgentRunCreate.mockRejectedValue(new Error("db down"));
    const execute = getExecute(makeCanvasCtx());
    const result = await execute({ prompt: "find transcription skills" });

    expect(mockDispatchRepoAgent).not.toHaveBeenCalled();
    expect(mockRepoAgent).toHaveBeenCalledOnce();
    expect(result).toBe("workflow research result");
  });

  // ── Initiation failure ────────────────────────────────────────────────────────

  test("dispatch failure: claims row FAILED, returns error message", async () => {
    mockDispatchRepoAgent.mockRejectedValue(new Error("Failed to initiate repo agent"));

    const execute = getExecute(makeCanvasCtx());
    const result = await execute({ prompt: "find transcription skills" });

    expect(mockAgentRunUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: "PENDING" }),
        data: expect.objectContaining({ status: "FAILED" }),
      }),
    );
    expect(result).toContain("Could not execute");
  });

  test("inline poll failure with no ctx: no row interaction, returns error message", async () => {
    mockRepoAgent.mockRejectedValue(new Error("swarm error"));

    const execute = getExecute(/* no ctx */);
    const result = await execute({ prompt: "find transcription skills" });

    expect(mockAgentRunCreate).not.toHaveBeenCalled();
    expect(mockAgentRunUpdateMany).not.toHaveBeenCalled();
    expect(result).toContain("Could not execute");
  });

  // ── Cancellation (inline poll path only) ─────────────────────────────────────

  test("no-context cancellation: no row interaction, returns cancelled message", async () => {
    mockRepoAgent.mockResolvedValue("__repo_agent_user_cancelled__");

    const execute = getExecute(/* no ctx */);
    const result = await execute({ prompt: "find transcription skills" });

    expect(mockAgentRunCreate).not.toHaveBeenCalled();
    expect(mockAgentRunUpdateMany).not.toHaveBeenCalled();
    expect(result).toContain("cancelled");
  });

  // ── Token security ────────────────────────────────────────────────────────────

  test("stored tokenHash is SHA-256 of the URL-borne raw token, not the raw token itself", async () => {
    const execute = getExecute(makeCanvasCtx());
    await execute({ prompt: "find transcription skills" });

    const createArgs = mockAgentRunCreate.mock.calls[0][0].data;
    // The raw token rides in the webhookUrl query string (stakgraph relays
    // no headers) — extract it and verify only its hash was persisted.
    const url: string = mockDispatchRepoAgent.mock.calls[0][2].webhookUrl;
    const rawToken = new URL(url).searchParams.get("token") as string;
    expect(rawToken).toMatch(/^[0-9a-f]{64}$/i);

    const expectedHash = crypto.createHash("sha256").update(rawToken).digest("hex");
    expect(createArgs.tokenHash).toBe(expectedHash);
    expect(createArgs.tokenHash).not.toBe(rawToken);
  });
});
