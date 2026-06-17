import { describe, it, expect, vi, beforeEach } from "vitest";
import { appendAnswerRow, answerAlreadyRecorded } from "@/services/canvas-planner-forms";
import { db } from "@/lib/db";

vi.mock("@/lib/db", () => ({
  db: {
    sharedConversation: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/pusher", () => ({
  notifyCanvasConversationUpdated: vi.fn(),
}));

import { notifyCanvasConversationUpdated } from "@/lib/pusher";

const CONVERSATION_ID = "conv-test-1";
const FEATURE_ID = "feature-test-1";
const PLANNER_MSG_ID = "planner-msg-test-1";
const ANSWER = "This is my answer to the clarifying question.";

describe("canvas-planner-forms", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("answerAlreadyRecorded", () => {
    it("returns false when conversation has no messages", async () => {
      vi.mocked(db.sharedConversation.findUnique).mockResolvedValue({
        messages: [],
      } as any);

      const result = await answerAlreadyRecorded(CONVERSATION_ID, PLANNER_MSG_ID);
      expect(result).toBe(false);
    });

    it("returns false when conversation not found", async () => {
      vi.mocked(db.sharedConversation.findUnique).mockResolvedValue(null);

      const result = await answerAlreadyRecorded(CONVERSATION_ID, PLANNER_MSG_ID);
      expect(result).toBe(false);
    });

    it("returns true when matching user-answered-planner-form row exists", async () => {
      vi.mocked(db.sharedConversation.findUnique).mockResolvedValue({
        messages: [
          {
            id: `answered-${PLANNER_MSG_ID}`,
            role: "user",
            content: "Answered: This is my answer",
            timestamp: new Date().toISOString(),
            source: {
              kind: "user-answered-planner-form",
              featureId: FEATURE_ID,
              plannerMessageId: PLANNER_MSG_ID,
            },
          },
        ],
      } as any);

      const result = await answerAlreadyRecorded(CONVERSATION_ID, PLANNER_MSG_ID);
      expect(result).toBe(true);
    });

    it("returns false when messages exist but for a different plannerMessageId", async () => {
      vi.mocked(db.sharedConversation.findUnique).mockResolvedValue({
        messages: [
          {
            id: "answered-other-id",
            role: "user",
            content: "Answered: Something else",
            timestamp: new Date().toISOString(),
            source: {
              kind: "user-answered-planner-form",
              featureId: FEATURE_ID,
              plannerMessageId: "other-planner-msg",
            },
          },
        ],
      } as any);

      const result = await answerAlreadyRecorded(CONVERSATION_ID, PLANNER_MSG_ID);
      expect(result).toBe(false);
    });
  });

  describe("appendAnswerRow — idempotency", () => {
    it("appends exactly one row and fires notifyCanvasConversationUpdated once on double-call", async () => {
      // Simulate the transaction acquiring a row lock and writing.
      // On the first call: no existing answer row → appends.
      // On the second call: the row is already there → skips.
      const existingMessages: unknown[] = [];

      vi.mocked(db.$transaction).mockImplementation(async (fn) => {
        // Simulate $queryRaw returning the current messages under lock.
        const txMock = {
          $queryRaw: vi.fn().mockResolvedValue([{ messages: existingMessages }]),
          sharedConversation: {
            update: vi.fn().mockImplementation(async ({ data }) => {
              // Persist the update for the second call to see.
              existingMessages.push(...(data.messages as unknown[]));
              existingMessages.splice(
                0,
                existingMessages.length - (data.messages as unknown[]).length,
              );
              return {};
            }),
          },
        };
        return fn(txMock as any);
      });

      // First call — should append.
      await appendAnswerRow(CONVERSATION_ID, FEATURE_ID, PLANNER_MSG_ID, ANSWER);

      // Simulate second call sees the already-appended row.
      // Replace the transaction mock so the second call finds the row.
      vi.mocked(db.$transaction).mockImplementationOnce(async (fn) => {
        const txMock = {
          $queryRaw: vi.fn().mockResolvedValue([
            {
              messages: [
                {
                  id: `answered-${PLANNER_MSG_ID}`,
                  role: "user",
                  content: `Answered: ${ANSWER}`,
                  timestamp: new Date().toISOString(),
                  source: {
                    kind: "user-answered-planner-form",
                    featureId: FEATURE_ID,
                    plannerMessageId: PLANNER_MSG_ID,
                  },
                },
              ],
            },
          ]),
          sharedConversation: { update: vi.fn() },
        };
        return fn(txMock as any);
      });

      // Second call with the same plannerMessageId — should be a no-op.
      await appendAnswerRow(CONVERSATION_ID, FEATURE_ID, PLANNER_MSG_ID, ANSWER);

      // notifyCanvasConversationUpdated must have been called exactly once
      // (only on the first append, not on the idempotent second call).
      expect(notifyCanvasConversationUpdated).toHaveBeenCalledOnce();
      expect(notifyCanvasConversationUpdated).toHaveBeenCalledWith(
        CONVERSATION_ID,
        "form-answer",
      );
    });

    it("does nothing when the conversation row does not exist", async () => {
      vi.mocked(db.$transaction).mockImplementationOnce(async (fn) => {
        const txMock = {
          $queryRaw: vi.fn().mockResolvedValue([]), // no rows
          sharedConversation: { update: vi.fn() },
        };
        return fn(txMock as any);
      });

      await appendAnswerRow(CONVERSATION_ID, FEATURE_ID, PLANNER_MSG_ID, ANSWER);

      expect(notifyCanvasConversationUpdated).not.toHaveBeenCalled();
    });
  });
});
