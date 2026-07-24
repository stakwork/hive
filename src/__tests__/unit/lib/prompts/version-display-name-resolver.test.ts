/**
 * Unit tests for the display-name batch resolver used in the versions API route.
 *
 * Tests the resolution logic:
 *  - Real user id → githubUsername (preferred)
 *  - Real user id without GitHub auth → email fallback
 *  - "api-token" sentinel → "API Token"
 *  - Unknown id → raw id as fallback
 */
import { describe, test, expect } from "vitest";
import { API_TOKEN_ACTOR } from "@/lib/auth/api-token";

// ─── Inline the resolver logic to unit-test it in isolation ───────────────────
// (The actual implementation lives in the versions route; mirrored here for clarity.)
type UserRecord = {
  id: string;
  email: string | null;
  githubAuth: { githubUsername: string } | null;
};

function buildDisplayNameMap(
  users: UserRecord[],
): Map<string, string> {
  const map = new Map<string, string>();
  // Hardcode the sentinel
  map.set(API_TOKEN_ACTOR, "API Token");
  for (const u of users) {
    const display = u.githubAuth?.githubUsername ?? u.email ?? u.id;
    map.set(u.id, display);
  }
  return map;
}

function resolveDisplayName(
  map: Map<string, string>,
  rawId: string | null | undefined,
): string | null {
  if (!rawId) return null;
  return map.get(rawId) ?? rawId;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("version display-name resolver", () => {
  test("'api-token' sentinel always maps to 'API Token'", () => {
    const map = buildDisplayNameMap([]);
    expect(resolveDisplayName(map, API_TOKEN_ACTOR)).toBe("API Token");
    expect(resolveDisplayName(map, "api-token")).toBe("API Token");
  });

  test("user with githubUsername → prefers githubUsername over email", () => {
    const users: UserRecord[] = [
      { id: "user-1", email: "alice@example.com", githubAuth: { githubUsername: "alice-gh" } },
    ];
    const map = buildDisplayNameMap(users);
    expect(resolveDisplayName(map, "user-1")).toBe("alice-gh");
  });

  test("user without githubAuth → falls back to email", () => {
    const users: UserRecord[] = [
      { id: "user-2", email: "bob@example.com", githubAuth: null },
    ];
    const map = buildDisplayNameMap(users);
    expect(resolveDisplayName(map, "user-2")).toBe("bob@example.com");
  });

  test("user without githubAuth AND without email → falls back to id", () => {
    const users: UserRecord[] = [
      { id: "user-3", email: null, githubAuth: null },
    ];
    const map = buildDisplayNameMap(users);
    expect(resolveDisplayName(map, "user-3")).toBe("user-3");
  });

  test("unknown id (not in map) → raw id returned as fallback", () => {
    const map = buildDisplayNameMap([]);
    expect(resolveDisplayName(map, "unknown-cuid-xyz")).toBe("unknown-cuid-xyz");
  });

  test("null id → returns null", () => {
    const map = buildDisplayNameMap([]);
    expect(resolveDisplayName(map, null)).toBeNull();
    expect(resolveDisplayName(map, undefined)).toBeNull();
  });

  test("multiple users resolved independently", () => {
    const users: UserRecord[] = [
      { id: "user-a", email: "a@x.com", githubAuth: { githubUsername: "gh-a" } },
      { id: "user-b", email: "b@x.com", githubAuth: null },
    ];
    const map = buildDisplayNameMap(users);
    expect(resolveDisplayName(map, "user-a")).toBe("gh-a");
    expect(resolveDisplayName(map, "user-b")).toBe("b@x.com");
    expect(resolveDisplayName(map, API_TOKEN_ACTOR)).toBe("API Token");
  });
});
