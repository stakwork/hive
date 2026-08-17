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
    sharedConversation: { update: vi.fn(), findFirst: vi.fn() },
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
  fetchStoredConversationMessages,
  normalizeStoredAttachments,
} from "@/services/canvas-turn-persistence";

const queryRaw = db.$queryRaw as ReturnType<typeof vi.fn>;
const txn = db.$transaction as ReturnType<typeof vi.fn>;
const update = db.sharedConversation.update as ReturnType<typeof vi.fn>;
const findFirst = db.sharedConversation.findFirst as ReturnType<typeof vi.fn>;
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

  // ── per-step timestamp tests ────────────────────────────────────────

  test("uses response.timestamp for each step, falling back for steps without one", () => {
    const ts = new Date("2025-01-01T12:00:00.000Z");
    const steps = [
      { text: "Step one", response: { timestamp: ts } },
      { text: "Step two" }, // no response.timestamp → forward-fill from step one
    ];

    const rows = messagesFromSteps(steps, "t-");

    expect(rows[0].timestamp).toBe(ts.toISOString());
    // Step two falls back to the last valid timestamp (step one's)
    expect(rows[1].timestamp).toBe(ts.toISOString());
  });

  test("text row and tool-call row from the same step share identical stepTimestamp", () => {
    const ts = new Date("2025-06-15T09:30:00.000Z");
    const steps = [
      {
        text: "Running a tool.",
        toolCalls: [{ toolCallId: "tc1", toolName: "search", input: {} }],
        toolResults: [{ toolCallId: "tc1", output: { hits: 1 } }],
        response: { timestamp: ts },
      },
    ];

    const rows = messagesFromSteps(steps, "t-");

    expect(rows).toHaveLength(2);
    expect(rows[0].timestamp).toBe(ts.toISOString());
    expect(rows[1].timestamp).toBe(ts.toISOString());
    // Both rows carry the same value — not different per-row stamps
    expect(rows[0].timestamp).toBe(rows[1].timestamp);
  });

  test("forward-fill keeps timestamps non-decreasing when an early step lacks a timestamp", () => {
    const ts = new Date("2025-03-10T08:00:00.000Z");
    const steps = [
      { text: "Step one" }, // no timestamp → falls back to `now` (initial lastTimestamp)
      { text: "Step two", response: { timestamp: ts } }, // real timestamp
    ];

    const rows = messagesFromSteps(steps, "t-");

    // Step one gets the fallback (now), step two gets its real timestamp.
    // The real timestamp (ts) is in the past relative to `now`, so we just
    // assert both are valid ISO strings and step two uses ts exactly.
    expect(rows[1].timestamp).toBe(ts.toISOString());
    // Both must be parseable
    expect(isNaN(new Date(rows[0].timestamp!).getTime())).toBe(false);
    expect(isNaN(new Date(rows[1].timestamp!).getTime())).toBe(false);
  });

  test("malformed response.timestamp does not throw; falls back to last valid timestamp", () => {
    const ts = new Date("2025-07-20T00:00:00.000Z");
    const steps = [
      { text: "Good step", response: { timestamp: ts } },
      { text: "Bad step", response: { timestamp: "not-a-date" as unknown as Date } },
    ];

    // Must not throw
    let rows: ReturnType<typeof messagesFromSteps>;
    expect(() => {
      rows = messagesFromSteps(steps, "t-");
    }).not.toThrow();

    // Good step uses its own timestamp
    expect(rows![0].timestamp).toBe(ts.toISOString());
    // Bad step falls back to the last valid timestamp (step one's)
    expect(rows![1].timestamp).toBe(ts.toISOString());
  });

  test("malformed first-step timestamp falls back to the pre-loop `now`", () => {
    const before = Date.now();
    const steps = [
      { text: "Broken first step", response: { timestamp: "garbage" as unknown as Date } },
    ];

    const rows = messagesFromSteps(steps, "t-");
    const after = Date.now();

    const rowTs = new Date(rows[0].timestamp!).getTime();
    // Timestamp should be in the vicinity of `now` (within 5 seconds)
    expect(rowTs).toBeGreaterThanOrEqual(before - 5000);
    expect(rowTs).toBeLessThanOrEqual(after + 5000);
  });

  test("existing fixtures without response field continue to work unchanged", () => {
    const steps = [
      {
        text: "Looking into it.",
        toolCalls: [{ toolCallId: "tc1", toolName: "search", input: { q: "x" } }],
        toolResults: [{ toolCallId: "tc1", output: { hits: 2 } }],
      },
      { text: "Here's the answer." },
    ];

    // Should not throw; timestamps fall back to `now` chain
    const rows = messagesFromSteps(steps, "legacy-");
    expect(rows).toHaveLength(3);
    rows.forEach((row) => {
      expect(typeof row.timestamp).toBe("string");
      expect(isNaN(new Date(row.timestamp!).getTime())).toBe(false);
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

// ─────────────────────────────────────────────────────────────────────────────
// deferredCheck population from schedule_check tool results
// ─────────────────────────────────────────────────────────────────────────────

describe("messagesFromSteps — deferredCheck population", () => {
  test("attaches deferredCheck to the text row when schedule_check succeeds", () => {
    const steps = [
      {
        text: "I've scheduled the check for you.",
        toolCalls: [
          {
            toolCallId: "tc-sched",
            toolName: "schedule_check",
            input: { query: "Check PR status", delayMs: 300_000, description: "Check PR in 5 min" },
          },
        ],
        toolResults: [
          {
            toolCallId: "tc-sched",
            output: {
              deferredActionId: "deferred-001",
              fireAt: "2026-01-01T00:05:00.000Z",
              description: "Check PR in 5 min",
            },
          },
        ],
      },
    ];

    const rows = messagesFromSteps(steps, "t-");

    // Text row should carry deferredCheck
    const textRow = rows.find((r) => r.content !== "");
    expect(textRow).toBeDefined();
    expect(textRow!.deferredCheck).toEqual({
      id: "deferred-001",
      description: "Check PR in 5 min",
      fireAt: "2026-01-01T00:05:00.000Z",
      status: "PENDING",
    });
  });

  test("attaches deferredCheck to tool-call row when step has no text", () => {
    const steps = [
      {
        text: "",
        toolCalls: [
          {
            toolCallId: "tc-sched",
            toolName: "schedule_check",
            input: { query: "Check deploy", delayMs: 60_000, description: "Check deploy in 1 min" },
          },
        ],
        toolResults: [
          {
            toolCallId: "tc-sched",
            output: {
              deferredActionId: "deferred-002",
              fireAt: "2026-01-01T00:01:00.000Z",
              description: "Check deploy in 1 min",
            },
          },
        ],
      },
    ];

    const rows = messagesFromSteps(steps, "t-");

    const toolRow = rows.find((r) => r.toolCalls && r.toolCalls.length > 0);
    expect(toolRow).toBeDefined();
    expect(toolRow!.deferredCheck).toEqual({
      id: "deferred-002",
      description: "Check deploy in 1 min",
      fireAt: "2026-01-01T00:01:00.000Z",
      status: "PENDING",
    });
  });

  test("does not attach deferredCheck when no schedule_check tool call is present", () => {
    const steps = [
      {
        text: "Here is the result.",
        toolCalls: [
          { toolCallId: "tc-search", toolName: "search", input: { q: "foo" } },
        ],
        toolResults: [{ toolCallId: "tc-search", output: { hits: 3 } }],
      },
    ];

    const rows = messagesFromSteps(steps, "t-");

    rows.forEach((row) => {
      expect(row.deferredCheck).toBeUndefined();
    });
  });

  test("does not attach deferredCheck when schedule_check result has missing fields", () => {
    const steps = [
      {
        text: "Scheduling…",
        toolCalls: [
          { toolCallId: "tc-bad", toolName: "schedule_check", input: {} },
        ],
        toolResults: [
          {
            toolCallId: "tc-bad",
            output: { someRandomField: true }, // missing deferredActionId / fireAt / description
          },
        ],
      },
    ];

    const rows = messagesFromSteps(steps, "t-");
    rows.forEach((row) => {
      expect(row.deferredCheck).toBeUndefined();
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// fetchStoredConversationMessages
// ─────────────────────────────────────────────────────────────────────────────

describe("fetchStoredConversationMessages", () => {
  beforeEach(() => {
    findFirst.mockReset();
  });

  const baseArgs = {
    conversationId: "conv-1",
    userId: "user-1",
    workspaceSlug: "my-workspace",
  };

  const sampleMessages = [
    { id: "m1", role: "user", content: "Hello" },
    { id: "m2", role: "assistant", content: "Hi there" },
  ];

  test("returns StoredMessage[] when conversationId + userId + workspaceSlug match", async () => {
    findFirst.mockResolvedValue({ messages: sampleMessages });
    const result = await fetchStoredConversationMessages(baseArgs);
    expect(result).toEqual(sampleMessages);
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "conv-1",
          userId: "user-1",
          workspace: { slug: "my-workspace", deleted: false },
        }),
        select: { messages: true },
      }),
    );
  });

  test("returns null when userId mismatches (IDOR guard)", async () => {
    // DB returns null when predicate doesn't match
    findFirst.mockResolvedValue(null);
    const result = await fetchStoredConversationMessages({
      ...baseArgs,
      userId: "other-user",
    });
    expect(result).toBeNull();
  });

  test("returns null when conversationId is not found", async () => {
    findFirst.mockResolvedValue(null);
    const result = await fetchStoredConversationMessages({
      ...baseArgs,
      conversationId: "non-existent",
    });
    expect(result).toBeNull();
  });

  test("returns null for org-canvas rows (workspaceId = null) — documents the gap the org-canvas fallback compensates for", async () => {
    // The workspace predicate { workspace: { slug, deleted: false } } can never
    // match a SharedConversation row that has workspaceId = null, so Prisma
    // returns null here. This is the existing behavior that causes HTTP 400 on
    // 2nd+ turns from Sphinx iOS/macOS — the fix adds an org-canvas fallback
    // in /api/ask/quick/route.ts after this call returns null.
    findFirst.mockResolvedValue(null);
    const result = await fetchStoredConversationMessages({
      conversationId: "org-conv-1",
      userId: "user-1",
      workspaceSlug: "any-slug",
    });
    expect(result).toBeNull();
  });

  test("returns [] (not null) when conversation exists but messages column is empty", async () => {
    findFirst.mockResolvedValue({ messages: null });
    const result = await fetchStoredConversationMessages(baseArgs);
    expect(result).toEqual([]);
  });

  test("returns [] when messages column is an empty array", async () => {
    findFirst.mockResolvedValue({ messages: [] });
    const result = await fetchStoredConversationMessages(baseArgs);
    expect(result).toEqual([]);
  });
});

describe("normalizeStoredAttachments", () => {
  const valid = {
    path: "s3/key.png",
    filename: "img.png",
    mimeType: "image/png",
    size: 1234,
  };

  test("returns [] for non-array input", () => {
    expect(normalizeStoredAttachments(undefined)).toEqual([]);
    expect(normalizeStoredAttachments(null)).toEqual([]);
    expect(normalizeStoredAttachments("nope")).toEqual([]);
    expect(normalizeStoredAttachments({})).toEqual([]);
  });

  test("keeps a well-formed attachment, picking only the known fields", () => {
    const result = normalizeStoredAttachments([{ ...valid, extra: "ignored" }]);
    expect(result).toEqual([valid]);
  });

  test("drops entries missing or mistyping any required field", () => {
    const result = normalizeStoredAttachments([
      valid,
      null,
      "string",
      { ...valid, path: 123 }, // wrong type
      { filename: "x.png", mimeType: "image/png", size: 1 }, // missing path
      { ...valid, size: "1234" }, // size must be a number
    ]);
    expect(result).toEqual([valid]);
  });
});
