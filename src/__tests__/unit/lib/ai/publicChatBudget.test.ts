import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import {
  ANON_DAILY_TOKEN_CAP,
  OUTPUT_TOKEN_WEIGHT,
  WORKSPACE_PUBLIC_DAILY_TOKEN_CAP,
  deriveAnonymousId,
} from "@/lib/ai/publicChatBudget";

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
});
