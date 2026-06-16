/**
 * Unit tests for `dispatchDueActions` in `deferred-chat-action-dispatcher.ts`.
 *
 * Coverage:
 *   - PENDING → FIRED on success
 *   - PENDING → FAILED when runCanvasAgent throws
 *   - Already-FIRED rows skipped via SELECT FOR UPDATE SKIP LOCKED guard
 *   - Empty queue → { fired: 0, failed: 0 } returned immediately
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ──────────────────────────────────────────────────────────

vi.mock("@/lib/db", () => ({
  db: {
    deferredChatAction: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
    sharedConversation: {
      findUnique: vi.fn(),
    },
    $transaction: vi.fn(),
    $executeRaw: vi.fn(),
    $queryRaw: vi.fn(),
  },
}));

vi.mock("@/lib/ai/runCanvasAgent", () => ({
  runCanvasAgent: vi.fn(),
}));

vi.mock("@/services/canvas-turn-persistence", () => ({
  messagesFromSteps: vi.fn(),
  appendTurnMessages: vi.fn(),
}));

vi.mock("@/services/deferred-check", () => ({
  updateDeferredCheckStatus: vi.fn(),
}));

vi.mock("@/lib/pusher", () => ({
  notifyCanvasConversationUpdated: vi.fn(),
}));

import { db } from "@/lib/db";
import { runCanvasAgent } from "@/lib/ai/runCanvasAgent";
import {
  messagesFromSteps,
  appendTurnMessages,
} from "@/services/canvas-turn-persistence";
import { updateDeferredCheckStatus } from "@/services/deferred-check";
import { notifyCanvasConversationUpdated } from "@/lib/pusher";
import { dispatchDueActions } from "@/services/deferred-chat-action-dispatcher";

const mockFindMany = db.deferredChatAction.findMany as ReturnType<typeof vi.fn>;
const mockUpdate = db.deferredChatAction.update as ReturnType<typeof vi.fn>;
const mockConversationFindUnique = db.sharedConversation.findUnique as ReturnType<typeof vi.fn>;
const mockTransaction = db.$transaction as ReturnType<typeof vi.fn>;
const mockRunCanvasAgent = runCanvasAgent as ReturnType<typeof vi.fn>;
const mockMessagesFromSteps = messagesFromSteps as ReturnType<typeof vi.fn>;
const mockAppendTurnMessages = appendTurnMessages as ReturnType<typeof vi.fn>;
const mockUpdateDeferredCheckStatus = updateDeferredCheckStatus as ReturnType<typeof vi.fn>;
const mockNotify = notifyCanvasConversationUpdated as ReturnType<typeof vi.fn>;

/** A minimal DeferredChatAction record */
function makeAction(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "action-1",
    conversationId: "conv-1",
    orgId: "org-1",
    userId: "user-1",
    query: "What is the status of the build?",
    description: "check build status in 5 minutes",
    fireAt: new Date(Date.now() - 5000), // 5 seconds ago
    status: "PENDING",
    createdAt: new Date(),
    firedAt: null,
    ...overrides,
  };
}

/** A minimal SharedConversation for the action */
const mockConversation = {
  id: "conv-1",
  userId: "user-1",
  sourceControlOrgId: "org-1",
  messages: [],
  settings: {},
  workspace: { slug: "my-workspace" },
};

/** A fake streamText result handle */
function makeAgentResult(text = "Build is passing.") {
  const steps = [{ text, toolCalls: [], toolResults: [] }];
  return {
    result: {
      text: Promise.resolve(text),
      steps: Promise.resolve(steps),
    },
    primarySwarmUrl: "https://swarm.example.com",
    primarySwarmApiKey: "key",
    cacheableConcepts: {},
    cacheHit: false,
    assembledPrefix: "",
  };
}

describe("dispatchDueActions", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default: no actions due
    mockFindMany.mockResolvedValue([]);

    // Default: conversation found
    mockConversationFindUnique.mockResolvedValue(mockConversation);

    // Default: $transaction grants claim (non-empty SKIP LOCKED result)
    mockTransaction.mockImplementation(
      async (fn: (tx: unknown) => unknown) =>
        fn({
          $queryRaw: vi
            .fn()
            .mockResolvedValue([{ id: "action-1", status: "PENDING" }]),
          deferredChatAction: {
            update: vi.fn().mockResolvedValue({}),
          },
        }),
    );

    // Default: agent returns a simple text response
    mockRunCanvasAgent.mockResolvedValue(makeAgentResult());

    // Default: messagesFromSteps returns one text row
    mockMessagesFromSteps.mockReturnValue([
      {
        id: "deferred-action-1-0",
        role: "assistant",
        content: "Build is passing.",
        timestamp: new Date().toISOString(),
      },
    ]);

    mockAppendTurnMessages.mockResolvedValue(true);
    mockUpdateDeferredCheckStatus.mockResolvedValue(undefined);
    mockUpdate.mockResolvedValue({});
    mockNotify.mockImplementation(() => undefined);
  });

  it("returns { fired: 0, failed: 0 } when no actions are due", async () => {
    mockFindMany.mockResolvedValue([]);
    const result = await dispatchDueActions();
    expect(result).toEqual({ fired: 0, failed: 0, errors: [] });
    expect(mockRunCanvasAgent).not.toHaveBeenCalled();
  });

  describe("PENDING → FIRED on success", () => {
    it("calls runCanvasAgent with a synthetic deferred-check message", async () => {
      mockFindMany.mockResolvedValue([makeAction()]);

      await dispatchDueActions();

      expect(mockRunCanvasAgent).toHaveBeenCalledOnce();
      const opts = mockRunCanvasAgent.mock.calls[0][0];
      expect(opts.userId).toBe("user-1");
      expect(opts.orgId).toBe("org-1");
      expect(opts.workspaceSlugs).toContain("my-workspace");
      // The last message must be the synthetic user message
      const lastMsg = opts.messages[opts.messages.length - 1];
      expect(lastMsg.role).toBe("user");
      expect(lastMsg.content).toContain("[Deferred check");
      expect(lastMsg.content).toContain("What is the status of the build?");
    });

    it("prepends 'Checking back as requested…' to the first text row", async () => {
      mockFindMany.mockResolvedValue([makeAction()]);

      await dispatchDueActions();

      const appendCall = mockAppendTurnMessages.mock.calls[0][0];
      const firstTextRow = appendCall.rows.find(
        (r: { role: string; content: string }) =>
          r.role === "assistant" && r.content.trim(),
      );
      expect(firstTextRow?.content).toMatch(/^Checking back as requested…/);
    });

    it("calls appendTurnMessages with the correct conversationId and idPrefix", async () => {
      mockFindMany.mockResolvedValue([makeAction()]);

      await dispatchDueActions();

      expect(mockAppendTurnMessages).toHaveBeenCalledOnce();
      const args = mockAppendTurnMessages.mock.calls[0][0];
      expect(args.conversationId).toBe("conv-1");
      expect(args.idPrefix).toBe("deferred-action-1-");
      expect(args.reason).toBe("deferred-check-fired");
    });

    it("calls updateDeferredCheckStatus with FIRED", async () => {
      mockFindMany.mockResolvedValue([makeAction()]);

      await dispatchDueActions();

      expect(mockUpdateDeferredCheckStatus).toHaveBeenCalledWith(
        "conv-1",
        "action-1",
        "FIRED",
      );
    });

    it("notifies open browser tabs via Pusher", async () => {
      mockFindMany.mockResolvedValue([makeAction()]);

      await dispatchDueActions();

      expect(mockNotify).toHaveBeenCalledWith("conv-1", "deferred-check-fired");
    });

    it("returns { fired: 1, failed: 0 }", async () => {
      mockFindMany.mockResolvedValue([makeAction()]);

      const result = await dispatchDueActions();

      expect(result.fired).toBe(1);
      expect(result.failed).toBe(0);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe("PENDING → FAILED when runCanvasAgent throws", () => {
    it("marks the action as FAILED and adds to errors", async () => {
      mockFindMany.mockResolvedValue([makeAction()]);
      mockRunCanvasAgent.mockRejectedValue(new Error("LLM unavailable"));

      const result = await dispatchDueActions();

      expect(result.fired).toBe(0);
      expect(result.failed).toBe(1);
      expect(result.errors[0]).toContain("action-1");
      expect(result.errors[0]).toContain("LLM unavailable");

      // Should have updated the action status to FAILED
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "action-1" },
          data: { status: "FAILED" },
        }),
      );
    });

    it("continues processing remaining actions after one failure", async () => {
      const action2 = makeAction({ id: "action-2", query: "What is the PR status?" });
      mockFindMany.mockResolvedValue([makeAction(), action2]);

      // First call fails, second succeeds
      mockRunCanvasAgent
        .mockRejectedValueOnce(new Error("timeout"))
        .mockResolvedValueOnce(makeAgentResult("PR is open."));

      mockMessagesFromSteps
        .mockReturnValueOnce([
          {
            id: "deferred-action-1-0",
            role: "assistant",
            content: "Build is passing.",
            timestamp: new Date().toISOString(),
          },
        ])
        .mockReturnValueOnce([
          {
            id: "deferred-action-2-0",
            role: "assistant",
            content: "PR is open.",
            timestamp: new Date().toISOString(),
          },
        ]);

      // Second transaction also grants claim
      mockTransaction
        .mockImplementationOnce(
          async (fn: (tx: unknown) => unknown) =>
            fn({
              $queryRaw: vi
                .fn()
                .mockResolvedValue([{ id: "action-1", status: "PENDING" }]),
              deferredChatAction: { update: vi.fn().mockResolvedValue({}) },
            }),
        )
        .mockImplementationOnce(
          async (fn: (tx: unknown) => unknown) =>
            fn({
              $queryRaw: vi
                .fn()
                .mockResolvedValue([{ id: "action-2", status: "PENDING" }]),
              deferredChatAction: { update: vi.fn().mockResolvedValue({}) },
            }),
        );

      const result = await dispatchDueActions();

      expect(result.fired).toBe(1);
      expect(result.failed).toBe(1);
      expect(mockRunCanvasAgent).toHaveBeenCalledTimes(2);
    });
  });

  describe("SELECT FOR UPDATE SKIP LOCKED guard", () => {
    it("skips an action when the transaction returns empty (row locked by another worker)", async () => {
      mockFindMany.mockResolvedValue([makeAction()]);

      // Transaction returns empty — row is locked by another worker
      mockTransaction.mockImplementation(
        async (fn: (tx: unknown) => unknown) =>
          fn({
            $queryRaw: vi.fn().mockResolvedValue([]), // empty = SKIP LOCKED
            deferredChatAction: { update: vi.fn().mockResolvedValue({}) },
          }),
      );

      const result = await dispatchDueActions();

      expect(result.fired).toBe(0);
      expect(result.failed).toBe(0);
      expect(mockRunCanvasAgent).not.toHaveBeenCalled();
    });

    it("skips an action whose status is no longer PENDING (claimed by another worker)", async () => {
      mockFindMany.mockResolvedValue([makeAction()]);

      // Transaction returns the row but status is FIRED (race)
      mockTransaction.mockImplementation(
        async (fn: (tx: unknown) => unknown) =>
          fn({
            $queryRaw: vi
              .fn()
              .mockResolvedValue([{ id: "action-1", status: "FIRED" }]),
            deferredChatAction: { update: vi.fn().mockResolvedValue({}) },
          }),
      );

      const result = await dispatchDueActions();

      expect(result.fired).toBe(0);
      expect(result.failed).toBe(0);
      expect(mockRunCanvasAgent).not.toHaveBeenCalled();
    });
  });

  describe("missing conversation", () => {
    it("marks action as FAILED when conversation is not found", async () => {
      mockFindMany.mockResolvedValue([makeAction()]);
      mockConversationFindUnique.mockResolvedValue(null);

      const result = await dispatchDueActions();

      expect(result.fired).toBe(0);
      expect(result.failed).toBe(1);
      expect(result.errors[0]).toContain("action-1");
    });
  });
});
