import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/db", () => ({
  db: {
    sharedConversation: {
      aggregate: vi.fn(),
      update: vi.fn(),
    },
  },
}));

import { db } from "@/lib/db";
import {
  ANON_DAILY_TOKEN_CAP,
  OUTPUT_TOKEN_WEIGHT,
  CACHE_READ_TOKEN_WEIGHT,
  CACHE_WRITE_TOKEN_WEIGHT,
  WORKSPACE_PUBLIC_DAILY_TOKEN_CAP,
  deriveAnonymousId,
  checkPublicChatBudget,
  recordTurnTokens,
} from "@/lib/ai/publicChatBudget";

const aggregate = db.sharedConversation.aggregate as ReturnType<typeof vi.fn>;
const update = db.sharedConversation.update as ReturnType<typeof vi.fn>;

/** Both the anon and the workspace aggregate resolve to these sums. */
function withSpend(sum: Record<string, number>) {
  aggregate.mockResolvedValue({ _sum: sum });
}

beforeEach(() => {
  vi.clearAllMocks();
  update.mockResolvedValue({});
});

function makeReq(headers: Record<string, string>): NextRequest {
  return new NextRequest("http://localhost/api/ask/quick", {
    method: "POST",
    headers,
  });
}

describe("deriveAnonymousId", () => {
  it("returns a stable 16-char hex string for the same IP + UA", () => {
    const req = makeReq({
      "x-forwarded-for": "203.0.113.7",
      "user-agent": "Mozilla/5.0 Test",
    });
    const a = deriveAnonymousId(req);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(a).toBe(deriveAnonymousId(req));
  });

  it("changes when IP changes", () => {
    const a = deriveAnonymousId(
      makeReq({ "x-forwarded-for": "1.1.1.1", "user-agent": "x" }),
    );
    const b = deriveAnonymousId(
      makeReq({ "x-forwarded-for": "2.2.2.2", "user-agent": "x" }),
    );
    expect(a).not.toBe(b);
  });

  it("changes when User-Agent changes", () => {
    const a = deriveAnonymousId(
      makeReq({ "x-forwarded-for": "1.1.1.1", "user-agent": "ua-a" }),
    );
    const b = deriveAnonymousId(
      makeReq({ "x-forwarded-for": "1.1.1.1", "user-agent": "ua-b" }),
    );
    expect(a).not.toBe(b);
  });

  it("falls back to 'unknown' when no IP headers are present", () => {
    // Two calls with no headers should still hash deterministically
    // (the sha is keyed on the literal string "unknown|").
    const a = deriveAnonymousId(makeReq({}));
    const b = deriveAnonymousId(makeReq({}));
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe("token budget constants", () => {
  it("weights output 5x input", () => {
    // Anthropic Sonnet pricing: ~$3/Mtok input, ~$15/Mtok output.
    // The weighting is the contract the rate-limit gate computes
    // against; if anyone changes the constant they should also update
    // the cap or the dollar-cost claim in the comments.
    expect(OUTPUT_TOKEN_WEIGHT).toBe(5);
  });

  it("per-workspace cap dwarfs per-anon cap", () => {
    // Sanity: a single visitor cannot exhaust the workspace bucket.
    expect(WORKSPACE_PUBLIC_DAILY_TOKEN_CAP).toBeGreaterThan(
      ANON_DAILY_TOKEN_CAP,
    );
  });

  it("prices cache reads below and cache writes above fresh input", () => {
    // Anthropic: $0.30/Mtok cache read, $3.75/Mtok cache write,
    // $3/Mtok fresh input.
    expect(CACHE_READ_TOKEN_WEIGHT).toBe(0.1);
    expect(CACHE_WRITE_TOKEN_WEIGHT).toBe(1.25);
  });
});

describe("checkPublicChatBudget — cache repricing", () => {
  const args = { workspaceId: "ws-1", anonymousId: "anon-1" };

  it("treats a row with no cache data exactly as before", async () => {
    // inputTokens alone must still price at 1x, so historical rows and
    // non-cached providers are unaffected.
    withSpend({ inputTokens: ANON_DAILY_TOKEN_CAP - 1, outputTokens: 0 });
    await expect(checkPublicChatBudget(args)).resolves.toMatchObject({
      allowed: true,
    });

    withSpend({ inputTokens: ANON_DAILY_TOKEN_CAP, outputTokens: 0 });
    await expect(checkPublicChatBudget(args)).resolves.toMatchObject({
      allowed: false,
      reason: "anon",
    });
  });

  it("does not double-count cache tokens, which are already inside inputTokens", async () => {
    // A cache-heavy conversation: 200k input of which 199k was a cache
    // read. Adding the cache on top of inputTokens would price this at
    // ~220k and block the visitor; repricing correctly puts it at
    // 1k + 199k*0.1 ≈ 20.9k, comfortably under the 100k cap.
    withSpend({
      inputTokens: 200_000,
      outputTokens: 0,
      cacheReadTokens: 199_000,
      cacheWriteTokens: 0,
    });

    await expect(checkPublicChatBudget(args)).resolves.toMatchObject({
      allowed: true,
    });
  });

  it("still blocks when the repriced cost genuinely exceeds the cap", async () => {
    withSpend({
      inputTokens: 100_000,
      outputTokens: 50_000,
      cacheReadTokens: 90_000,
      cacheWriteTokens: 0,
    });
    // fresh 10k + reads 9k + output 250k = well past the cap.
    await expect(checkPublicChatBudget(args)).resolves.toMatchObject({
      allowed: false,
    });
  });

  it("charges a cache write more than the same number of fresh tokens", async () => {
    // 80k of pure cache writes → 100k weighted, exactly at the cap.
    withSpend({
      inputTokens: 80_000,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 80_000,
    });
    await expect(checkPublicChatBudget(args)).resolves.toMatchObject({
      allowed: false,
    });
  });
});

describe("recordTurnTokens", () => {
  it("increments all four counters", async () => {
    await recordTurnTokens({
      conversationId: "conv-1",
      inputTokens: 6873,
      outputTokens: 47,
      cacheReadTokens: 6059,
      cacheWriteTokens: 812,
    });

    expect(update).toHaveBeenCalledWith({
      where: { id: "conv-1" },
      data: {
        inputTokens: { increment: 6873 },
        outputTokens: { increment: 47 },
        cacheReadTokens: { increment: 6059 },
        cacheWriteTokens: { increment: 812 },
      },
    });
  });

  it("records a cache-only turn rather than skipping it", async () => {
    await recordTurnTokens({
      conversationId: "conv-1",
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 4096,
      cacheWriteTokens: 0,
    });
    expect(update).toHaveBeenCalledTimes(1);
  });

  it("skips the write when the turn spent nothing at all", async () => {
    await recordTurnTokens({
      conversationId: "conv-1",
      inputTokens: 0,
      outputTokens: 0,
    });
    expect(update).not.toHaveBeenCalled();
  });
});
