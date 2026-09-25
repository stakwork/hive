/**
 * Unit tests for classifyCallerToken (src/lib/auth/caller-token.ts).
 *
 * Covers the three-way classification used by both pod-access and the
 * workflow-callback routes:
 *  - system token → { kind: "system" }
 *  - valid org key → { kind: "org", orgId, apiKeyId, validated }
 *  - anything else (missing, unknown, revoked, expired org key) → null
 *
 * A `hiveorg_` token that fails validation must never fall through to the
 * system-token check.
 */
import { describe, test, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/org-api-keys", () => ({
  isOrgApiKey: vi.fn(),
  validateOrgApiKey: vi.fn(),
}));

vi.mock("@/lib/auth/api-token", () => ({
  validateApiToken: vi.fn(),
}));

import { classifyCallerToken } from "@/lib/auth/caller-token";
import { isOrgApiKey, validateOrgApiKey } from "@/lib/org-api-keys";
import { validateApiToken } from "@/lib/auth/api-token";

function makeRequest(token?: string): NextRequest {
  return new NextRequest("http://localhost/api/chat/response", {
    method: "POST",
    headers: token ? { "x-api-token": token } : {},
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("classifyCallerToken", () => {
  test("returns null when the header is missing and the system token doesn't match", async () => {
    vi.mocked(isOrgApiKey).mockReturnValue(false);
    vi.mocked(validateApiToken).mockReturnValue(false);

    const result = await classifyCallerToken(makeRequest());

    expect(result).toBeNull();
  });

  test("classifies the system API_TOKEN as { kind: 'system' }", async () => {
    vi.mocked(isOrgApiKey).mockReturnValue(false);
    vi.mocked(validateApiToken).mockReturnValue(true);

    const result = await classifyCallerToken(makeRequest("the-system-token"));

    expect(result).toEqual({ kind: "system" });
  });

  test("classifies a valid hiveorg_ key as { kind: 'org', orgId, apiKeyId, validated }", async () => {
    const validated = {
      apiKey: { id: "key-1", name: "strut", createdById: "user-1" },
      orgId: "org-1",
    };
    vi.mocked(isOrgApiKey).mockReturnValue(true);
    vi.mocked(validateOrgApiKey).mockResolvedValue(validated as never);

    const result = await classifyCallerToken(makeRequest("hiveorg_abc123"));

    expect(result).toEqual({
      kind: "org",
      orgId: "org-1",
      apiKeyId: "key-1",
      validated,
    });
    // Never falls through to the system check once identified as an org key.
    expect(validateApiToken).not.toHaveBeenCalled();
  });

  test("a hiveorg_ key that fails validation (revoked/expired/unknown) is a hard null — never falls through to the system check", async () => {
    vi.mocked(isOrgApiKey).mockReturnValue(true);
    vi.mocked(validateOrgApiKey).mockResolvedValue(null);
    // Even if this were somehow true, it must not be consulted.
    vi.mocked(validateApiToken).mockReturnValue(true);

    const result = await classifyCallerToken(makeRequest("hiveorg_revoked"));

    expect(result).toBeNull();
    expect(validateApiToken).not.toHaveBeenCalled();
  });
});
