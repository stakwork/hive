import { describe, it, expect, vi, beforeEach } from "vitest";

const { create } = vi.hoisted(() => ({ create: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { canvasTurnUsage: { create } } }));

import { extractTurnUsage, recordTurnUsage } from "@/lib/ai/publicChatBudget";

describe("extractTurnUsage", () => {
  it("reads the ai@7 shape: totals plus inputTokenDetails cache read / write", () => {
    expect(
      extractTurnUsage({
        inputTokens: 1000,
        outputTokens: 50,
        inputTokenDetails: { noCacheTokens: 100, cacheReadTokens: 800, cacheWriteTokens: 100 },
      }),
    ).toEqual({ inputTokens: 1000, outputTokens: 50, cacheReadTokens: 800, cacheWriteTokens: 100 });
  });

  it("falls back to the provider-level flat names and raw Anthropic counters", () => {
    expect(extractTurnUsage({ inputTokens: 10, outputTokens: 2, cachedInputTokens: 7 })).toMatchObject({
      cacheReadTokens: 7,
      cacheWriteTokens: 0,
    });
    expect(
      extractTurnUsage({
        inputTokens: 10,
        outputTokens: 2,
        raw: { cache_read_input_tokens: 3, cache_creation_input_tokens: 4 },
      }),
    ).toMatchObject({ cacheReadTokens: 3, cacheWriteTokens: 4 });
  });

  it("falls back to providerMetadata.anthropic.cacheCreationInputTokens for the write count", () => {
    expect(
      extractTurnUsage(
        { inputTokens: 10, outputTokens: 2 },
        { anthropic: { cacheCreationInputTokens: 9, cacheReadInputTokens: 1 } },
      ),
    ).toMatchObject({ cacheReadTokens: 1, cacheWriteTokens: 9 });
  });

  it("prefers inputTokenDetails over the fallbacks", () => {
    expect(
      extractTurnUsage(
        { inputTokens: 10, outputTokens: 2, inputTokenDetails: { cacheWriteTokens: 5 } },
        { anthropic: { cacheCreationInputTokens: 9 } },
      ).cacheWriteTokens,
    ).toBe(5);
  });

  it("reads missing / undefined / garbage as zero", () => {
    const zero = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
    expect(extractTurnUsage(undefined)).toEqual(zero);
    expect(extractTurnUsage(null)).toEqual(zero);
    expect(extractTurnUsage({ inputTokens: undefined, outputTokens: Number.NaN })).toEqual(zero);
    expect(extractTurnUsage({ inputTokens: -5, outputTokens: 1 }).inputTokens).toBe(0);
  });

  it("reads the flat shape the onAbort hook reports", () => {
    expect(extractTurnUsage({ inputTokens: 4, outputTokens: 1, cacheReadTokens: 2, cacheWriteTokens: 1 })).toEqual({
      inputTokens: 4,
      outputTokens: 1,
      cacheReadTokens: 2,
      cacheWriteTokens: 1,
    });
  });
});

describe("recordTurnUsage", () => {
  beforeEach(() => {
    create.mockReset();
    create.mockResolvedValue({});
  });

  it("writes one canvas_turn_usage row", async () => {
    await recordTurnUsage({
      conversationId: "conv-1",
      turnId: "turn-1",
      mode: "concept",
      source: "planner_wake",
      model: "claude-sonnet",
      usage: { inputTokens: 100, outputTokens: 20, inputTokenDetails: { cacheReadTokens: 60, cacheWriteTokens: 10 } },
    });
    expect(create).toHaveBeenCalledWith({
      data: {
        conversationId: "conv-1",
        turnId: "turn-1",
        mode: "concept",
        source: "planner_wake",
        model: "claude-sonnet",
        inputTokens: 100,
        outputTokens: 20,
        cacheReadTokens: 60,
        cacheWriteTokens: 10,
      },
    });
  });

  it("stores null for an absent turn id / model", async () => {
    await recordTurnUsage({
      conversationId: "c",
      mode: "full",
      source: "user",
      usage: { inputTokens: 1, outputTokens: 1 },
    });
    expect(create.mock.calls[0][0].data).toMatchObject({ turnId: null, model: null });
  });

  it("writes nothing for a turn that reported no tokens", async () => {
    await recordTurnUsage({ conversationId: "c", mode: "full", source: "user", usage: undefined });
    expect(create).not.toHaveBeenCalled();
  });

  it("is best-effort: a db failure is logged, not thrown", async () => {
    create.mockRejectedValue(new Error("db down"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      recordTurnUsage({
        conversationId: "c",
        mode: "full",
        source: "user",
        usage: { inputTokens: 1, outputTokens: 1 },
      }),
    ).resolves.toBeUndefined();
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });
});
