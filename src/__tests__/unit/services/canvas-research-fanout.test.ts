/**
 * Unit tests for fanOutResearchToCanvas.
 *
 * Coverage:
 *   - Appends a correctly-shaped row to an empty conversation.
 *   - Row shape: id, role, content (ready vs failed), source fields.
 *   - Idempotency: second call with same researchId is a no-op.
 *   - Missing conversation (SELECT returns empty) → silent no-op.
 *   - Pusher notification fired only when a fresh append happened.
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
import { fanOutResearchToCanvas } from "@/services/canvas-research-fanout";
import type { ResearchFanOutPayload } from "@/services/canvas-research-fanout";

const CONV_ID = "conv-1";
const BASE_PAYLOAD: ResearchFanOutPayload = {
  researchId: "res-1",
  slug: "test-research",
  topic: "How X works",
  title: "X Deep Dive",
  summary: "A comprehensive look at X.",
  status: "ready",
};

// Helper: set up the transaction mock to simulate a conversation with given messages.
function mockConversation(existingMessages: unknown[]) {
  (db.$transaction as ReturnType<typeof vi.fn>).mockImplementation(
    async (fn: (tx: unknown) => Promise<void>) => {
      const appended: unknown[] = [];
      const tx = {
        $queryRaw: vi.fn().mockResolvedValue([{ messages: existingMessages }]),
        sharedConversation: {
          update: vi.fn(async ({ data }: { data: { messages: unknown } }) => {
            // Capture what was written
            (appended as unknown[]).push(data.messages);
          }),
        },
      };
      await fn(tx);
      return appended;
    },
  );
}

function mockMissingConversation() {
  (db.$transaction as ReturnType<typeof vi.fn>).mockImplementation(
    async (fn: (tx: unknown) => Promise<void>) => {
      const tx = {
        $queryRaw: vi.fn().mockResolvedValue([]), // empty → conversation deleted
        sharedConversation: { update: vi.fn() },
      };
      await fn(tx);
    },
  );
}

describe("fanOutResearchToCanvas", () => {
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

    await fanOutResearchToCanvas(CONV_ID, BASE_PAYLOAD);

    expect(capturedMessages.length).toBeGreaterThan(0);
    const row = capturedMessages[0] as {
      id: string;
      role: string;
      content: string;
      source: { kind: string; researchId: string; slug: string; status: string };
    };
    expect(row.id).toBe(`research-${BASE_PAYLOAD.researchId}`);
    expect(row.role).toBe("assistant");
    expect(row.content).toContain(BASE_PAYLOAD.title);
    expect(row.content).toContain(BASE_PAYLOAD.summary);
    expect(row.content).toContain(BASE_PAYLOAD.slug);
    expect(row.source.kind).toBe("research");
    expect(row.source.researchId).toBe(BASE_PAYLOAD.researchId);
    expect(row.source.slug).toBe(BASE_PAYLOAD.slug);
    expect(row.source.status).toBe("ready");
  });

  test("content says 'Research ready' for status=ready", async () => {
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
    await fanOutResearchToCanvas(CONV_ID, { ...BASE_PAYLOAD, status: "ready" });
    expect(capturedContent).toMatch(/research ready/i);
  });

  test("content says 'Research failed' for status=failed", async () => {
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
    await fanOutResearchToCanvas(CONV_ID, { ...BASE_PAYLOAD, status: "failed" });
    expect(capturedContent).toMatch(/research failed/i);
    expect(capturedContent).toContain(BASE_PAYLOAD.topic);
  });

  test("fires Pusher notification after fresh append", async () => {
    mockConversation([]);
    await fanOutResearchToCanvas(CONV_ID, BASE_PAYLOAD);
    expect(notifyCanvasConversationUpdated).toHaveBeenCalledWith(CONV_ID, "research");
  });

  test("idempotency: second call with same researchId is a no-op", async () => {
    const existingRow = {
      id: `research-${BASE_PAYLOAD.researchId}`,
      role: "assistant",
      content: "Research ready: ...",
      timestamp: new Date().toISOString(),
      source: {
        kind: "research",
        researchId: BASE_PAYLOAD.researchId,
        slug: BASE_PAYLOAD.slug,
        topic: BASE_PAYLOAD.topic,
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

    await fanOutResearchToCanvas(CONV_ID, BASE_PAYLOAD);

    // No update — already fanned out
    expect(updateCallCount).toBe(0);
    expect(notifyCanvasConversationUpdated).not.toHaveBeenCalled();
  });

  test("silent no-op when conversation does not exist", async () => {
    mockMissingConversation();
    await fanOutResearchToCanvas(CONV_ID, BASE_PAYLOAD);
    expect(notifyCanvasConversationUpdated).not.toHaveBeenCalled();
  });

  test("includes initiativeId in source when provided", async () => {
    let capturedSource: unknown = null;
    (db.$transaction as ReturnType<typeof vi.fn>).mockImplementation(
      async (fn: (tx: unknown) => Promise<void>) => {
        const tx = {
          $queryRaw: vi.fn().mockResolvedValue([{ messages: [] }]),
          sharedConversation: {
            update: vi.fn(async ({ data }: { data: { messages: Array<{ source: unknown }> } }) => {
              capturedSource = data.messages[0].source;
            }),
          },
        };
        await fn(tx);
      },
    );
    await fanOutResearchToCanvas(CONV_ID, { ...BASE_PAYLOAD, initiativeId: "init-1" });
    expect((capturedSource as { initiativeId?: string })?.initiativeId).toBe("init-1");
  });

  test("omits initiativeId from source when not provided", async () => {
    let capturedSource: unknown = null;
    (db.$transaction as ReturnType<typeof vi.fn>).mockImplementation(
      async (fn: (tx: unknown) => Promise<void>) => {
        const tx = {
          $queryRaw: vi.fn().mockResolvedValue([{ messages: [] }]),
          sharedConversation: {
            update: vi.fn(async ({ data }: { data: { messages: Array<{ source: unknown }> } }) => {
              capturedSource = data.messages[0].source;
            }),
          },
        };
        await fn(tx);
      },
    );
    await fanOutResearchToCanvas(CONV_ID, BASE_PAYLOAD); // no initiativeId
    expect((capturedSource as { initiativeId?: unknown })?.initiativeId).toBeUndefined();
  });
});
