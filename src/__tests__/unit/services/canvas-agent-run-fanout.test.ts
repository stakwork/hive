/**
 * Unit tests for canvas-agent-run-fanout.ts
 *
 * Coverage:
 *   hardenContent:
 *     - Passes through valid strings
 *     - Coerces non-string to string
 *     - Returns null for oversized content (> MAX_CONTENT_LENGTH)
 *     - Returns null for null/undefined
 *
 *   fanOutAgentRunToCanvas:
 *     - Happy path: appends message and notifies Pusher
 *     - Idempotent on runId (second call is a no-op)
 *     - Bails non-fatally when conversation is not found
 *     - Bails non-fatally on org/user ownership mismatch
 *     - Failure status produces a failure note (not the raw content)
 *     - Success status uses the content directly
 *     - Non-fatal when DB throws
 */

import { describe, test, expect, vi, beforeEach } from "vitest";
import { hardenContent, fanOutAgentRunToCanvas, type AgentRunRow } from "@/services/canvas-agent-run-fanout";

// ── Mock prisma ────────────────────────────────────────────────────────────────

const mockQueryRaw = vi.fn();
const mockUpdate = vi.fn();
const mockFindUnique = vi.fn();
const mockTransaction = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    $transaction: (...args: unknown[]) => mockTransaction(...args),
    sharedConversation: {
      findUnique: (...args: unknown[]) => mockFindUnique(...args),
      update: (...args: unknown[]) => mockUpdate(...args),
    },
  },
}));

const mockNotify = vi.fn();
vi.mock("@/lib/pusher", () => ({
  notifyCanvasConversationUpdated: (...args: unknown[]) => mockNotify(...args),
}));

// ── hardenContent ─────────────────────────────────────────────────────────────

describe("hardenContent", () => {
  test("passes through a valid string", () => {
    expect(hardenContent("hello world")).toBe("hello world");
  });

  test("coerces a number to string", () => {
    expect(hardenContent(42)).toBe("42");
  });

  test("coerces an object to string via String()", () => {
    expect(hardenContent({ a: 1 })).toBe("[object Object]");
  });

  test("returns null for null", () => {
    expect(hardenContent(null)).toBeNull();
  });

  test("returns null for undefined", () => {
    expect(hardenContent(undefined)).toBeNull();
  });

  test("returns null for oversized string (> 128KB)", () => {
    const big = "x".repeat(128 * 1024 + 1);
    expect(hardenContent(big)).toBeNull();
  });

  test("accepts a string exactly at the 128KB limit", () => {
    const atLimit = "x".repeat(128 * 1024);
    expect(hardenContent(atLimit)).toBe(atLimit);
  });
});

// ── fanOutAgentRunToCanvas helpers ────────────────────────────────────────────

const BASE_ROW: AgentRunRow = {
  conversationId: "conv-1",
  orgId: "org-1",
  userId: "user-1",
};

const BASE_PAYLOAD = {
  runId: "run-1",
  agentKind: "workflow_explorer",
  title: "Find transcription skills",
  content: "Found 3 workflows matching.",
  status: "success" as const,
};

/**
 * Set up the transaction mock to simulate a real DB $transaction:
 * calls the callback with a tx proxy that routes to the module-level mocks.
 */
function setupTransaction({
  conversation,
  locked,
}: {
  conversation?: { userId: string; sourceControlOrgId: string } | null;
  locked?: { messages: unknown }[];
}) {
  mockTransaction.mockImplementation(async (cb: (tx: unknown) => Promise<void>) => {
    const tx = {
      sharedConversation: {
        findUnique: vi.fn().mockResolvedValue(conversation ?? null),
        update: mockUpdate.mockResolvedValue({}),
      },
      $queryRaw: mockQueryRaw.mockResolvedValue(locked ?? []),
    };
    return cb(tx);
  });
}

// ── fanOutAgentRunToCanvas tests ──────────────────────────────────────────────

describe("fanOutAgentRunToCanvas", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockNotify.mockReset();
  });

  test("happy path: appends message and notifies Pusher", async () => {
    setupTransaction({
      conversation: { userId: "user-1", sourceControlOrgId: "org-1" },
      locked: [{ messages: [] }],
    });

    await fanOutAgentRunToCanvas(BASE_ROW, BASE_PAYLOAD);

    expect(mockUpdate).toHaveBeenCalledOnce();
    const updateCall = mockUpdate.mock.calls[0][0];
    const messages = updateCall.data.messages as unknown[];
    expect(messages).toHaveLength(1);
    const msg = messages[0] as Record<string, unknown>;
    expect(msg.content).toBe("Found 3 workflows matching.");
    expect(msg.role).toBe("assistant");
    expect((msg.source as Record<string, unknown>).kind).toBe("agent_run");
    expect((msg.source as Record<string, unknown>).runId).toBe("run-1");
    expect((msg.source as Record<string, unknown>).status).toBe("success");

    expect(mockNotify).toHaveBeenCalledWith("conv-1", "agent_run");
  });

  test("failure status produces a failure note, not the raw content", async () => {
    setupTransaction({
      conversation: { userId: "user-1", sourceControlOrgId: "org-1" },
      locked: [{ messages: [] }],
    });

    await fanOutAgentRunToCanvas(BASE_ROW, {
      ...BASE_PAYLOAD,
      status: "failed",
      content: "raw error detail",
    });

    const updateCall = mockUpdate.mock.calls[0][0];
    const messages = updateCall.data.messages as unknown[];
    const msg = messages[0] as Record<string, unknown>;
    // Content is a failure note, not the raw content
    expect(msg.content).toContain("did not complete");
    expect(msg.content).toContain("raw error detail");
    expect((msg.source as Record<string, unknown>).status).toBe("failed");
  });

  test("idempotent: second call for same runId is a no-op", async () => {
    const existingMsg = {
      id: `agent-run-run-1`,
      role: "assistant",
      content: "first delivery",
      timestamp: new Date().toISOString(),
      source: { kind: "agent_run", runId: "run-1" },
    };
    setupTransaction({
      conversation: { userId: "user-1", sourceControlOrgId: "org-1" },
      locked: [{ messages: [existingMsg] }],
    });

    await fanOutAgentRunToCanvas(BASE_ROW, BASE_PAYLOAD);

    // Update should NOT have been called — already fanned out
    expect(mockUpdate).not.toHaveBeenCalled();
    // Pusher also NOT called
    expect(mockNotify).not.toHaveBeenCalled();
  });

  test("bails non-fatally when conversation is not found (deleted)", async () => {
    setupTransaction({
      conversation: null,
      locked: [],
    });

    // Should not throw
    await expect(fanOutAgentRunToCanvas(BASE_ROW, BASE_PAYLOAD)).resolves.toBeUndefined();
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockNotify).not.toHaveBeenCalled();
  });

  test("bails non-fatally on org mismatch (IDOR guard)", async () => {
    setupTransaction({
      // Conversation belongs to a DIFFERENT org
      conversation: { userId: "user-1", sourceControlOrgId: "org-different" },
      locked: [{ messages: [] }],
    });

    await expect(fanOutAgentRunToCanvas(BASE_ROW, BASE_PAYLOAD)).resolves.toBeUndefined();
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockNotify).not.toHaveBeenCalled();
  });

  test("bails non-fatally on userId mismatch (IDOR guard)", async () => {
    setupTransaction({
      // Conversation belongs to a DIFFERENT user
      conversation: { userId: "user-different", sourceControlOrgId: "org-1" },
      locked: [{ messages: [] }],
    });

    await expect(fanOutAgentRunToCanvas(BASE_ROW, BASE_PAYLOAD)).resolves.toBeUndefined();
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockNotify).not.toHaveBeenCalled();
  });

  test("is non-fatal when DB throws — does not re-throw", async () => {
    mockTransaction.mockRejectedValue(new Error("DB connection lost"));

    await expect(fanOutAgentRunToCanvas(BASE_ROW, BASE_PAYLOAD)).resolves.toBeUndefined();
    expect(mockNotify).not.toHaveBeenCalled();
  });

  test("does not notify Pusher when no message was appended (idempotency case)", async () => {
    const existingMsg = {
      id: `agent-run-run-1`,
      role: "assistant",
      content: "already there",
      timestamp: new Date().toISOString(),
      source: { kind: "agent_run", runId: "run-1" },
    };
    setupTransaction({
      conversation: { userId: "user-1", sourceControlOrgId: "org-1" },
      locked: [{ messages: [existingMsg] }],
    });

    await fanOutAgentRunToCanvas(BASE_ROW, BASE_PAYLOAD);

    expect(mockNotify).not.toHaveBeenCalled();
  });

  test("appends message id with 'agent-run-' prefix", async () => {
    setupTransaction({
      conversation: { userId: "user-1", sourceControlOrgId: "org-1" },
      locked: [{ messages: [] }],
    });

    await fanOutAgentRunToCanvas(BASE_ROW, { ...BASE_PAYLOAD, runId: "abc123" });

    const updateCall = mockUpdate.mock.calls[0][0];
    const messages = updateCall.data.messages as unknown[];
    const msg = messages[0] as Record<string, unknown>;
    expect(msg.id).toBe("agent-run-abc123");
  });

  test("preserves existing messages when appending", async () => {
    const existingMsg = {
      id: "old-msg",
      role: "user",
      content: "Previous message",
      timestamp: new Date().toISOString(),
    };
    setupTransaction({
      conversation: { userId: "user-1", sourceControlOrgId: "org-1" },
      locked: [{ messages: [existingMsg] }],
    });

    await fanOutAgentRunToCanvas(BASE_ROW, BASE_PAYLOAD);

    const updateCall = mockUpdate.mock.calls[0][0];
    const messages = updateCall.data.messages as unknown[];
    expect(messages).toHaveLength(2);
    expect((messages[0] as Record<string, unknown>).id).toBe("old-msg");
    expect((messages[1] as Record<string, unknown>).id).toBe("agent-run-run-1");
  });
});
