/**
 * Unit tests for `dispatchDueActions` in `deferred-chat-action-dispatcher.ts`.
 *
 * Coverage:
 *   - PENDING → FIRED: one orchestrator turn on the conversation, as its
 *     owner, with the check-back message, their model and zone
 *   - a busy conversation puts the action back to PENDING for the next sweep
 *   - a refused launch is written into the chat as the reply and FAILED
 *   - other errors → FAILED, and the sweep goes on
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
    user: {
      findUnique: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/services/strut-orchestrator", () => ({
  launchOrchestratorTurn: vi.fn(),
}));

vi.mock("@/lib/ai/resolve-model", () => ({
  loadUserChatAgentModel: vi.fn(),
}));

vi.mock("@/services/canvas-turn-persistence", () => ({
  appendTurnMessages: vi.fn(),
}));

vi.mock("@/services/deferred-check", () => ({
  updateDeferredCheckStatus: vi.fn(),
}));

vi.mock("@/lib/pusher", () => ({
  notifyCanvasConversationUpdated: vi.fn(),
}));

import { db } from "@/lib/db";
import { launchOrchestratorTurn } from "@/services/strut-orchestrator";
import { loadUserChatAgentModel } from "@/lib/ai/resolve-model";
import { appendTurnMessages } from "@/services/canvas-turn-persistence";
import { updateDeferredCheckStatus } from "@/services/deferred-check";
import { notifyCanvasConversationUpdated } from "@/lib/pusher";
import { deferredCheckMessage, dispatchDueActions } from "@/services/deferred-chat-action-dispatcher";

const mockFindMany = db.deferredChatAction.findMany as ReturnType<typeof vi.fn>;
const mockUpdate = db.deferredChatAction.update as ReturnType<typeof vi.fn>;
const mockConversationFindUnique = db.sharedConversation.findUnique as ReturnType<typeof vi.fn>;
const mockUserFindUnique = db.user.findUnique as ReturnType<typeof vi.fn>;
const mockTransaction = db.$transaction as ReturnType<typeof vi.fn>;
const mockLaunch = launchOrchestratorTurn as ReturnType<typeof vi.fn>;
const mockModel = loadUserChatAgentModel as ReturnType<typeof vi.fn>;
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
};

const claimGranted = (id: string) => async (fn: (tx: unknown) => unknown) =>
  fn({
    $queryRaw: vi.fn().mockResolvedValue([{ id, status: "PENDING" }]),
    deferredChatAction: { update: vi.fn().mockResolvedValue({}) },
  });

describe("dispatchDueActions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFindMany.mockResolvedValue([]);
    mockConversationFindUnique.mockResolvedValue(mockConversation);
    mockUserFindUnique.mockResolvedValue({ timezone: "Europe/London" });
    mockTransaction.mockImplementation(claimGranted("action-1"));
    mockLaunch.mockResolvedValue({ status: "started", runId: "orch-row-1", strutRunId: "1790000000001" });
    mockModel.mockResolvedValue("anthropic/claude-sonnet-5-5");
    mockAppendTurnMessages.mockResolvedValue(true);
    mockUpdateDeferredCheckStatus.mockResolvedValue(undefined);
    mockUpdate.mockResolvedValue({});
    mockNotify.mockImplementation(() => undefined);
  });

  it("returns { fired: 0, failed: 0 } when no actions are due", async () => {
    const result = await dispatchDueActions();
    expect(result).toEqual({ fired: 0, failed: 0, errors: [] });
    expect(mockLaunch).not.toHaveBeenCalled();
  });

  describe("PENDING → FIRED on success", () => {
    it("launches one orchestrator turn on the conversation, as its owner, with the check-back message", async () => {
      mockFindMany.mockResolvedValue([makeAction()]);

      await dispatchDueActions();

      expect(mockLaunch).toHaveBeenCalledOnce();
      expect(mockLaunch).toHaveBeenCalledWith({
        userId: "user-1",
        orgId: "org-1",
        conversationId: "conv-1",
        message: deferredCheckMessage("What is the status of the build?"),
        publicBaseUrl: expect.any(String),
        timeZone: "Europe/London",
        model: "anthropic/claude-sonnet-5-5",
      });
      expect(deferredCheckMessage("q")).toContain("Checking back as requested…");
      expect(deferredCheckMessage("q").endsWith("q")).toBe(true);
      // The reply lands through the strut-runs webhook, not here.
      expect(mockAppendTurnMessages).not.toHaveBeenCalled();
    });

    it("patches the check FIRED, notifies the tabs, and counts it", async () => {
      mockFindMany.mockResolvedValue([makeAction()]);

      const result = await dispatchDueActions();

      expect(mockUpdateDeferredCheckStatus).toHaveBeenCalledWith("conv-1", "action-1", "FIRED");
      expect(mockNotify).toHaveBeenCalledWith("conv-1", "deferred-check-fired");
      expect(result).toEqual({ fired: 1, failed: 0, errors: [] });
    });

    it("no model pick sends none", async () => {
      mockFindMany.mockResolvedValue([makeAction()]);
      mockModel.mockResolvedValue(undefined);
      await dispatchDueActions();
      expect(mockLaunch.mock.calls[0][0]).not.toHaveProperty("model");
    });
  });

  it("a conversation still busy with a turn puts the action back for the next sweep", async () => {
    mockFindMany.mockResolvedValue([makeAction()]);
    mockLaunch.mockResolvedValue({ status: "busy", note: "Still working on your last message" });

    const result = await dispatchDueActions();

    expect(mockUpdate).toHaveBeenCalledWith({ where: { id: "action-1" }, data: { status: "PENDING", firedAt: null } });
    expect(mockUpdateDeferredCheckStatus).not.toHaveBeenCalled();
    expect(result).toEqual({ fired: 0, failed: 0, errors: [] });
  });

  it("a refused launch is written into the chat as the reply and the action FAILED", async () => {
    mockFindMany.mockResolvedValue([makeAction()]);
    mockLaunch.mockResolvedValue({ status: "error", error: "no orchestrator workflow" });

    const result = await dispatchDueActions();

    expect(mockAppendTurnMessages).toHaveBeenCalledOnce();
    const args = mockAppendTurnMessages.mock.calls[0][0];
    expect(args).toMatchObject({ conversationId: "conv-1", idPrefix: "deferred-action-1-", reason: "deferred-check-fired" });
    expect(args.rows[0]).toMatchObject({ role: "assistant" });
    expect(args.rows[0].content).toContain("no orchestrator workflow");
    expect(mockUpdateDeferredCheckStatus).toHaveBeenCalledWith("conv-1", "action-1", "FAILED");
    expect(result.failed).toBe(1);
    expect(result.errors[0]).toContain("no orchestrator workflow");
  });

  describe("PENDING → FAILED when the launch throws", () => {
    it("marks the action as FAILED and adds to errors", async () => {
      mockFindMany.mockResolvedValue([makeAction()]);
      mockLaunch.mockRejectedValue(new Error("db down"));

      const result = await dispatchDueActions();

      expect(result.fired).toBe(0);
      expect(result.failed).toBe(1);
      expect(result.errors[0]).toContain("action-1");
      expect(result.errors[0]).toContain("db down");
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: "action-1" }, data: { status: "FAILED" } }),
      );
    });

    it("continues processing remaining actions after one failure", async () => {
      mockFindMany.mockResolvedValue([makeAction(), makeAction({ id: "action-2", query: "What is the PR status?" })]);
      mockLaunch
        .mockRejectedValueOnce(new Error("timeout"))
        .mockResolvedValueOnce({ status: "started", runId: "orch-row-2", strutRunId: "1790000000002" });
      mockTransaction
        .mockImplementationOnce(claimGranted("action-1"))
        .mockImplementationOnce(claimGranted("action-2"));

      const result = await dispatchDueActions();

      expect(result.fired).toBe(1);
      expect(result.failed).toBe(1);
      expect(mockLaunch).toHaveBeenCalledTimes(2);
    });
  });

  describe("SELECT FOR UPDATE SKIP LOCKED guard", () => {
    it("skips an action when the transaction returns empty (row locked by another worker)", async () => {
      mockFindMany.mockResolvedValue([makeAction()]);
      mockTransaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
        fn({
          $queryRaw: vi.fn().mockResolvedValue([]),
          deferredChatAction: { update: vi.fn().mockResolvedValue({}) },
        }),
      );

      const result = await dispatchDueActions();

      expect(result).toEqual({ fired: 0, failed: 0, errors: [] });
      expect(mockLaunch).not.toHaveBeenCalled();
    });

    it("skips an action whose status is no longer PENDING (claimed by another worker)", async () => {
      mockFindMany.mockResolvedValue([makeAction()]);
      mockTransaction.mockImplementation(async (fn: (tx: unknown) => unknown) =>
        fn({
          $queryRaw: vi.fn().mockResolvedValue([{ id: "action-1", status: "FIRED" }]),
          deferredChatAction: { update: vi.fn().mockResolvedValue({}) },
        }),
      );

      const result = await dispatchDueActions();

      expect(result).toEqual({ fired: 0, failed: 0, errors: [] });
      expect(mockLaunch).not.toHaveBeenCalled();
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

    it("refuses a conversation another user owns", async () => {
      mockFindMany.mockResolvedValue([makeAction()]);
      mockConversationFindUnique.mockResolvedValue({ ...mockConversation, userId: "someone-else" });

      const result = await dispatchDueActions();

      expect(result.failed).toBe(1);
      expect(mockLaunch).not.toHaveBeenCalled();
    });
  });
});
