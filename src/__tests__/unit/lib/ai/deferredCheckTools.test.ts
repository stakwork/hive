/**
 * Unit tests for `buildDeferredCheckTools` (`src/lib/ai/deferredCheckTools.ts`).
 *
 * Coverage:
 *   - `schedule_check` tool inserts a DeferredChatAction with the correct fields
 *   - `fireAt` is within ±200 ms of Date.now() + delayMs
 *   - The tool returns `{ deferredActionId, fireAt, description }`
 *   - Context values (conversationId, orgId, userId) are always taken from the
 *     factory context, never from tool input (IDOR guard)
 */

import { describe, test, expect, vi, beforeEach } from "vitest";

// ─── Mocks ──────────────────────────────────────────────────────────

const { mockCreate } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    deferredChatAction: {
      create: mockCreate,
    },
  },
}));

import { buildDeferredCheckTools } from "@/lib/ai/deferredCheckTools";

// ────────────────────────────────────────────────────────────────────

const CTX = {
  conversationId: "conv-123",
  orgId: "org-456",
  userId: "user-789",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("buildDeferredCheckTools", () => {
  test("returns a toolset with a single schedule_check tool", () => {
    const tools = buildDeferredCheckTools(CTX);
    expect(Object.keys(tools)).toEqual(["schedule_check"]);
  });

  test("schedule_check inserts a DeferredChatAction with correct fields", async () => {
    const record = { id: "action-001" };
    mockCreate.mockResolvedValue(record);

    const tools = buildDeferredCheckTools(CTX);
    const tool = tools.schedule_check;

    const delayMs = 5 * 60 * 1000; // 5 minutes
    const before = Date.now();
    const result = await tool.execute!(
      {
        query: "Check the CI status of PR #42",
        delayMs,
        description: "Check CI status of PR #42 in 5 minutes",
      },
      { toolCallId: "tc1", messages: [], abortSignal: new AbortController().signal },
    );
    const after = Date.now();

    // Verify the DB create was called with correct fields
    expect(mockCreate).toHaveBeenCalledOnce();
    const createArgs = mockCreate.mock.calls[0][0].data;
    expect(createArgs.conversationId).toBe(CTX.conversationId);
    expect(createArgs.orgId).toBe(CTX.orgId);
    expect(createArgs.userId).toBe(CTX.userId);
    expect(createArgs.query).toBe("Check the CI status of PR #42");
    expect(createArgs.description).toBe("Check CI status of PR #42 in 5 minutes");
    expect(createArgs.status).toBe("PENDING");

    // fireAt should be within ±200 ms of Date.now() + delayMs
    const fireAtMs = createArgs.fireAt.getTime();
    expect(fireAtMs).toBeGreaterThanOrEqual(before + delayMs - 200);
    expect(fireAtMs).toBeLessThanOrEqual(after + delayMs + 200);

    // Return value has the expected shape
    expect(result).toEqual({
      deferredActionId: "action-001",
      fireAt: expect.any(String),
      description: "Check CI status of PR #42 in 5 minutes",
    });

    // Returned fireAt ISO string matches the stored fireAt
    const typedResult = result as { deferredActionId: string; fireAt: string; description: string };
    const returnedFireAt = new Date(typedResult.fireAt).getTime();
    expect(returnedFireAt).toBeGreaterThanOrEqual(before + delayMs - 200);
    expect(returnedFireAt).toBeLessThanOrEqual(after + delayMs + 200);
  });

  test("IDOR: context values are not overridable via tool input", async () => {
    mockCreate.mockResolvedValue({ id: "action-002" });
    const tools = buildDeferredCheckTools(CTX);

    await tools.schedule_check.execute!(
      {
        query: "some query",
        delayMs: 1000,
        description: "some description",
      },
      { toolCallId: "tc2", messages: [], abortSignal: new AbortController().signal },
    );

    const createArgs = mockCreate.mock.calls[0][0].data;
    // Context values must come from the factory, not the tool call payload
    expect(createArgs.conversationId).toBe("conv-123");
    expect(createArgs.orgId).toBe("org-456");
    expect(createArgs.userId).toBe("user-789");
  });

  test("propagates DB errors", async () => {
    mockCreate.mockRejectedValue(new Error("DB connection lost"));
    const tools = buildDeferredCheckTools(CTX);

    await expect(
      tools.schedule_check.execute!(
        {
          query: "ping",
          delayMs: 60_000,
          description: "check ping in 1 minute",
        },
        { toolCallId: "tc3", messages: [], abortSignal: new AbortController().signal },
      ),
    ).rejects.toThrow("DB connection lost");
  });
});
