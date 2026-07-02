/**
 * Unit tests for fanOutGraphWalkToCanvas.
 *
 * Coverage:
 *   - Appends a correctly-shaped row to an empty conversation.
 *   - Row id, role, source.kind, source.graphWalkId, source.title, source.status.
 *   - Content is the synthesized answer for status=ready.
 *   - Content is a failure message for status=failed.
 *   - Idempotency: second call with same graphWalkId is a silent no-op.
 *   - Missing conversation → silent no-op (no Pusher call).
 *   - Pusher notification fired only when a fresh row was appended.
 */

import { describe, test, expect, vi, beforeEach } from "vitest";

// ─── Mocks ──────────────────────────────────────────────────────────

vi.mock("@/lib/db", () => ({
  db: {
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/pusher", () => ({
  notifyCanvasConversationUpdated: vi.fn(),
}));

import { db } from "@/lib/db";
import { notifyCanvasConversationUpdated } from "@/lib/pusher";
import {
  fanOutGraphWalkToCanvas,
  type GraphWalkFanOutPayload,
} from "@/services/canvas-graph-walk-fanout";

const CONV_ID = "conv-1";
const BASE_PAYLOAD: GraphWalkFanOutPayload = {
  graphWalkId: "walk-abc-123",
  title: "Find Files linked to AuthFeature",
  answer: "Found 3 File nodes connected via HAS_IMPLEMENTATION edges.",
  status: "ready",
};

// ─── Transaction helpers ─────────────────────────────────────────────

function mockConversation(existingMessages: unknown[]) {
  (db.$transaction as ReturnType<typeof vi.fn>).mockImplementation(
    async (fn: (tx: unknown) => Promise<void>) => {
      const tx = {
        $queryRaw: vi.fn().mockResolvedValue([{ messages: existingMessages }]),
        sharedConversation: { update: vi.fn(async () => {}) },
      };
      await fn(tx);
    },
  );
}

function mockMissingConversation() {
  (db.$transaction as ReturnType<typeof vi.fn>).mockImplementation(
    async (fn: (tx: unknown) => Promise<void>) => {
      const tx = {
        $queryRaw: vi.fn().mockResolvedValue([]), // empty → deleted
        sharedConversation: { update: vi.fn() },
      };
      await fn(tx);
    },
  );
}

describe("fanOutGraphWalkToCanvas", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("appends a correctly-shaped row to an empty conversation", async () => {
    let capturedMessages: unknown[] = [];
    (db.$transaction as ReturnType<typeof vi.fn>).mockImplementation(
      async (fn: (tx: unknown) => Promise<void>) => {
        const tx = {
          $queryRaw: vi.fn().mockResolvedValue([{ messages: [] }]),
          sharedConversation: {
            update: vi.fn(async ({ data }: { data: { messages: unknown[] } }) => {
              capturedMessages = data.messages;
            }),
          },
        };
        await fn(tx);
      },
    );

    await fanOutGraphWalkToCanvas(CONV_ID, BASE_PAYLOAD);

    expect(capturedMessages).toHaveLength(1);
    const row = capturedMessages[0] as {
      id: string;
      role: string;
      content: string;
      timestamp: string;
      source: { kind: string; graphWalkId: string; title: string; status: string };
    };
    expect(row.id).toBe(`graph-walk-${BASE_PAYLOAD.graphWalkId}`);
    expect(row.role).toBe("assistant");
    expect(row.source.kind).toBe("graph_walk");
    expect(row.source.graphWalkId).toBe(BASE_PAYLOAD.graphWalkId);
    expect(row.source.title).toBe(BASE_PAYLOAD.title);
    expect(row.source.status).toBe("ready");
    expect(row.timestamp).toBeTruthy();
  });

  test("content is the synthesized answer for status=ready", async () => {
    let capturedContent = "";
    (db.$transaction as ReturnType<typeof vi.fn>).mockImplementation(
      async (fn: (tx: unknown) => Promise<void>) => {
        const tx = {
          $queryRaw: vi.fn().mockResolvedValue([{ messages: [] }]),
          sharedConversation: {
            update: vi.fn(async ({ data }: { data: { messages: Array<{ content: string }> } }) => {
              capturedContent = data.messages[0].content;
            }),
          },
        };
        await fn(tx);
      },
    );

    await fanOutGraphWalkToCanvas(CONV_ID, { ...BASE_PAYLOAD, status: "ready" });
    expect(capturedContent).toBe(BASE_PAYLOAD.answer);
  });

  test("content is a failure message for status=failed", async () => {
    let capturedContent = "";
    (db.$transaction as ReturnType<typeof vi.fn>).mockImplementation(
      async (fn: (tx: unknown) => Promise<void>) => {
        const tx = {
          $queryRaw: vi.fn().mockResolvedValue([{ messages: [] }]),
          sharedConversation: {
            update: vi.fn(async ({ data }: { data: { messages: Array<{ content: string }> } }) => {
              capturedContent = data.messages[0].content;
            }),
          },
        };
        await fn(tx);
      },
    );

    await fanOutGraphWalkToCanvas(CONV_ID, {
      ...BASE_PAYLOAD,
      answer: "",
      status: "failed",
    });
    expect(capturedContent).toContain(BASE_PAYLOAD.title);
    expect(capturedContent).toMatch(/graph walk failed/i);
  });

  test("fires Pusher notification after fresh append", async () => {
    mockConversation([]);
    await fanOutGraphWalkToCanvas(CONV_ID, BASE_PAYLOAD);
    expect(notifyCanvasConversationUpdated).toHaveBeenCalledWith(
      CONV_ID,
      "graph_walk",
    );
  });

  test("idempotency: second call with same graphWalkId is a silent no-op", async () => {
    const existingRow = {
      id: `graph-walk-${BASE_PAYLOAD.graphWalkId}`,
      role: "assistant",
      content: BASE_PAYLOAD.answer,
      timestamp: new Date().toISOString(),
      source: {
        kind: "graph_walk",
        graphWalkId: BASE_PAYLOAD.graphWalkId,
        title: BASE_PAYLOAD.title,
        status: "ready",
      },
    };

    let updateCallCount = 0;
    (db.$transaction as ReturnType<typeof vi.fn>).mockImplementation(
      async (fn: (tx: unknown) => Promise<void>) => {
        const tx = {
          $queryRaw: vi.fn().mockResolvedValue([{ messages: [existingRow] }]),
          sharedConversation: {
            update: vi.fn(async () => {
              updateCallCount++;
            }),
          },
        };
        await fn(tx);
      },
    );

    await fanOutGraphWalkToCanvas(CONV_ID, BASE_PAYLOAD);

    expect(updateCallCount).toBe(0);
    expect(notifyCanvasConversationUpdated).not.toHaveBeenCalled();
  });

  test("silent no-op when conversation does not exist", async () => {
    mockMissingConversation();
    await fanOutGraphWalkToCanvas(CONV_ID, BASE_PAYLOAD);
    expect(notifyCanvasConversationUpdated).not.toHaveBeenCalled();
  });

  test("does not fire Pusher when conversation is missing", async () => {
    mockMissingConversation();
    // Should not throw
    await expect(fanOutGraphWalkToCanvas(CONV_ID, BASE_PAYLOAD)).resolves.toBeUndefined();
    expect(notifyCanvasConversationUpdated).not.toHaveBeenCalled();
  });

  test("appends new row even when conversation has other kinds of messages", async () => {
    const existingRow = {
      id: "msg-1",
      role: "assistant",
      content: "Hello",
      timestamp: new Date().toISOString(),
      source: { kind: "research", researchId: "res-1" },
    };
    let capturedMessages: unknown[] = [];
    (db.$transaction as ReturnType<typeof vi.fn>).mockImplementation(
      async (fn: (tx: unknown) => Promise<void>) => {
        const tx = {
          $queryRaw: vi.fn().mockResolvedValue([{ messages: [existingRow] }]),
          sharedConversation: {
            update: vi.fn(async ({ data }: { data: { messages: unknown[] } }) => {
              capturedMessages = data.messages;
            }),
          },
        };
        await fn(tx);
      },
    );

    await fanOutGraphWalkToCanvas(CONV_ID, BASE_PAYLOAD);
    // Should append, not replace
    expect(capturedMessages).toHaveLength(2);
    const newRow = capturedMessages[1] as { source: { kind: string } };
    expect(newRow.source.kind).toBe("graph_walk");
  });
});
