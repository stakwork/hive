/**
 * Unit tests for the shared canvas-turn persistence writer
 * (`src/services/canvas-turn-persistence.ts`), used by BOTH the
 * user-driven `/api/ask/quick` turn and the autonomous auto-turn.
 *
 * Coverage:
 *   - `messagesFromSteps`: id-prefix scheme, text/tool-call split,
 *     stripped control tools, content-less turns.
 *   - `appendTurnMessages`: idempotency on the id prefix (a retried
 *     `after()` / re-delivered webhook must not double-append), the
 *     row-lock read path, and the Pusher nudge firing only on a fresh
 *     append.
 */

import { describe, test, expect, vi, beforeEach } from "vitest";

// ─── Mocks ──────────────────────────────────────────────────────────

vi.mock("@/lib/db", () => ({
  db: {
    sharedConversation: { update: vi.fn() },
    $queryRaw: vi.fn(),
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/pusher", () => ({
  notifyCanvasConversationUpdated: vi.fn(),
}));

import { db } from "@/lib/db";
import { notifyCanvasConversationUpdated } from "@/lib/pusher";
import {
  messagesFromSteps,
  appendTurnMessages,
} from "@/services/canvas-turn-persistence";

const queryRaw = db.$queryRaw as ReturnType<typeof vi.fn>;
const txn = db.$transaction as ReturnType<typeof vi.fn>;
const update = db.sharedConversation.update as ReturnType<typeof vi.fn>;
const notify = notifyCanvasConversationUpdated as ReturnType<typeof vi.fn>;

/** Run the `$transaction` callback against a tx whose locked read returns `existing`. */
function withLockedRows(existing: unknown[]) {
  txn.mockImplementation(async (cb: (tx: unknown) => Promise<void>) => {
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([{ messages: existing }]),
      sharedConversation: { update },
    };
    return cb(tx);
  });
}

/** Run the `$transaction` callback against a tx whose locked read is empty (row gone). */
function withNoRow() {
  txn.mockImplementation(async (cb: (tx: unknown) => Promise<void>) => {
    const tx = {
      $queryRaw: vi.fn().mockResolvedValue([]),
      sharedConversation: { update },
    };
    return cb(tx);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  queryRaw.mockResolvedValue([]);
  update.mockResolvedValue({ id: "conv-1" });
});

describe("messagesFromSteps", () => {
  test("splits text and tool calls into separate rows under the id prefix", () => {
    const steps = [
      {
        text: "Looking into it.",
        toolCalls: [
          { toolCallId: "tc1", toolName: "search", input: { q: "x" } },
        ],
        toolResults: [{ toolCallId: "tc1", output: { hits: 2 } }],
      },
      { text: "Here's the answer." },
    ];

    const rows = messagesFromSteps(steps, "turn-1-a");

    expect(rows.map((r) => r.id)).toEqual([
      "turn-1-a0",
      "turn-1-a1",
      "turn-1-a2",
    ]);
    expect(rows[0]).toMatchObject({ role: "assistant", content: "Looking into it." });
    expect(rows[1].toolCalls?.[0]).toMatchObject({
      id: "tc1",
      toolName: "search",
      status: "output-available",
    });
    expect(rows[2]).toMatchObject({ content: "Here's the answer." });
  });

  test("strips control tools and yields nothing for a control-only turn", () => {
    const steps = [
      { toolCalls: [{ toolCallId: "s1", toolName: "stay_silent", input: {} }] },
    ];
    const rows = messagesFromSteps(steps, "autoturn-x-", new Set(["stay_silent"]));
    expect(rows).toEqual([]);
  });

  test("marks errored tool results as output-error", () => {
    const steps = [
      {
        toolCalls: [{ toolCallId: "tc1", toolName: "do", input: {} }],
        toolResults: [{ toolCallId: "tc1", output: { error: "boom" } }],
      },
    ];
    const rows = messagesFromSteps(steps, "turn-1-a");
    expect(rows[0].toolCalls?.[0]).toMatchObject({
      status: "output-error",
      errorText: "Tool call failed",
    });
  });
});

describe("appendTurnMessages", () => {
  const rows = [
    { id: "turn-1-a0", role: "assistant" as const, content: "Hi" },
  ];

  test("appends and fires a nudge on a fresh write", async () => {
    withLockedRows([{ id: "turn-1-u", role: "user", content: "Q" }]);

    const did = await appendTurnMessages({
      conversationId: "conv-1",
      rows,
      idPrefix: "turn-1-a",
      reason: "user-turn",
    });

    expect(did).toBe(true);
    expect(update).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith("conv-1", "user-turn");
  });

  test("is idempotent: a row already under the prefix → no write, no nudge", async () => {
    withLockedRows([
      { id: "turn-1-a0", role: "assistant", content: "Hi (already)" },
    ]);

    const did = await appendTurnMessages({
      conversationId: "conv-1",
      rows,
      idPrefix: "turn-1-a",
      reason: "user-turn",
    });

    expect(did).toBe(false);
    expect(update).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  test("no-ops on an empty rows array", async () => {
    const did = await appendTurnMessages({
      conversationId: "conv-1",
      rows: [],
      idPrefix: "turn-1-a",
      reason: "user-turn",
    });
    expect(did).toBe(false);
    expect(txn).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  test("no-ops when the conversation row was deleted mid-turn", async () => {
    withNoRow();

    const did = await appendTurnMessages({
      conversationId: "conv-1",
      rows,
      idPrefix: "turn-1-a",
      reason: "user-turn",
    });

    expect(did).toBe(false);
    expect(update).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });
});
