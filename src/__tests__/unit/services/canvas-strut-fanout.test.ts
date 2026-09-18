/**
 * Unit tests for canvas-strut-fanout.ts
 *
 * Coverage:
 *   - renderStrutContent: header names workspace + chat id (the model's only
 *     handle for continuing the chat), interim / parked / settled / error forms.
 *   - fanOutStrutToCanvas: appends + nudges; idempotent per (run, turn, event)
 *     while distinct turns of ONE dispatch each land; skips on missing
 *     conversation / ownership mismatch; reports `failed` when the DB throws.
 */

import { describe, test, expect, vi, beforeEach } from "vitest";

const mockQueryRaw = vi.fn();
const mockUpdate = vi.fn();
const mockFindUnique = vi.fn();
const mockTransaction = vi.fn();
const mockNotify = vi.fn();

vi.mock("@/lib/db", () => ({
  db: { $transaction: (...args: unknown[]) => mockTransaction(...args) },
}));
vi.mock("@/lib/pusher", () => ({
  notifyCanvasConversationUpdated: (...args: unknown[]) => mockNotify(...args),
}));

import {
  fanOutStrutToCanvas,
  renderStrutContent,
  strutRowId,
  type StrutFanOutPayload,
} from "@/services/canvas-strut-fanout";

const ROW = { conversationId: "conv-1", orgId: "org-1", userId: "user-1" };

function payload(over: Partial<StrutFanOutPayload> = {}): StrutFanOutPayload {
  return {
    runId: "run-1",
    title: "Build clipper",
    workspaceSlug: "acme",
    chatId: "chat-9",
    turn: 0,
    event: "turn.end",
    status: "done",
    text: "Published clipper v1.",
    error: null,
    settled: true,
    parked: false,
    ...over,
  };
}

describe("renderStrutContent", () => {
  test("the header carries the workspace and chat id", () => {
    const content = renderStrutContent(payload());
    expect(content.startsWith("**Strut · acme · chat `chat-9`** — Build clipper")).toBe(true);
    expect(content).toContain("Published clipper v1.");
    expect(content).not.toContain("still working");
  });

  test("an unsettled turn is marked interim", () => {
    expect(renderStrutContent(payload({ settled: false }))).toContain("Strut is still working");
  });

  test("parked, error, and bare-settled forms", () => {
    expect(renderStrutContent(payload({ parked: true }))).toContain("auto-turn cap");
    expect(renderStrutContent(payload({ status: "error", text: null, error: "no key" }))).toContain(
      "did not complete: no key",
    );
    expect(renderStrutContent(payload({ event: "settled", text: null }))).toContain("nothing further to report");
  });
});

describe("fanOutStrutToCanvas", () => {
  let messages: Array<{ id: string }>;

  beforeEach(() => {
    vi.clearAllMocks();
    messages = [];
    mockFindUnique.mockResolvedValue({ userId: "user-1", sourceControlOrgId: "org-1" });
    mockQueryRaw.mockImplementation(async () => [{ messages }]);
    mockUpdate.mockImplementation(async ({ data }: { data: { messages: Array<{ id: string }> } }) => {
      messages = data.messages;
    });
    mockTransaction.mockImplementation(async (fn: (tx: unknown) => Promise<void>) =>
      fn({
        $queryRaw: mockQueryRaw,
        sharedConversation: { findUnique: mockFindUnique, update: mockUpdate },
      }),
    );
  });

  test("appends the row and nudges the conversation", async () => {
    expect(await fanOutStrutToCanvas(ROW, payload())).toBe("appended");
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      id: "strut-run-1-0-turn",
      role: "assistant",
      source: { kind: "strut", runId: "run-1", chatId: "chat-9", workspaceSlug: "acme", turn: 0, settled: true },
    });
    expect(mockNotify).toHaveBeenCalledWith("conv-1", "strut");
  });

  test("a retry is a duplicate; later turns and the settled event of the same run each land", async () => {
    await fanOutStrutToCanvas(ROW, payload({ settled: false }));
    expect(await fanOutStrutToCanvas(ROW, payload({ settled: false }))).toBe("duplicate");
    expect(await fanOutStrutToCanvas(ROW, payload({ turn: 1 }))).toBe("appended");
    expect(await fanOutStrutToCanvas(ROW, payload({ turn: 1, event: "settled", text: null }))).toBe("appended");
    expect(messages.map((m) => m.id)).toEqual(["strut-run-1-0-turn", "strut-run-1-1-turn", "strut-run-1-1-settled"]);
    expect(mockNotify).toHaveBeenCalledTimes(3);
  });

  test("skips when the conversation is gone or not the run owner's", async () => {
    mockFindUnique.mockResolvedValueOnce(null);
    expect(await fanOutStrutToCanvas(ROW, payload())).toBe("skipped");
    mockFindUnique.mockResolvedValueOnce({ userId: "someone-else", sourceControlOrgId: "org-1" });
    expect(await fanOutStrutToCanvas(ROW, payload())).toBe("skipped");
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockNotify).not.toHaveBeenCalled();
  });

  test("a DB failure is `failed`, never a throw", async () => {
    mockTransaction.mockRejectedValue(new Error("db down"));
    expect(await fanOutStrutToCanvas(ROW, payload())).toBe("failed");
  });

  test("strutRowId distinguishes a turn from the settled event", () => {
    expect(strutRowId({ runId: "r", turn: 2, event: "turn.end" })).toBe("strut-r-2-turn");
    expect(strutRowId({ runId: "r", turn: 2, event: "settled" })).toBe("strut-r-2-settled");
  });
});
