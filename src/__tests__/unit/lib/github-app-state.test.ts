import { describe, test, expect, beforeEach, afterEach } from "vitest";
import {
  signGithubAppState,
  verifyGithubAppState,
} from "@/lib/auth/github-app-state";

const ORIGINAL_SECRET = process.env.NEXTAUTH_SECRET;

describe("github-app-state", () => {
  beforeEach(() => {
    process.env.NEXTAUTH_SECRET = "test-secret-for-github-app-state-hmac";
  });

  afterEach(() => {
    process.env.NEXTAUTH_SECRET = ORIGINAL_SECRET;
  });

  describe("signGithubAppState", () => {
    test("produces a `<body>.<signature>` token", () => {
      const state = signGithubAppState({
        workspaceSlug: "my-workspace",
        randomState: "random-abc",
        timestamp: Date.now(),
      });

      expect(typeof state).toBe("string");
      const parts = state.split(".");
      expect(parts).toHaveLength(2);
      expect(parts[0]).toMatch(/^[A-Za-z0-9_-]+$/); // base64url
      expect(parts[1]).toMatch(/^[0-9a-f]+$/); // hex
    });

    test("includes optional repositoryUrl in the payload", () => {
      const state = signGithubAppState({
        workspaceSlug: "my-workspace",
        repositoryUrl: "https://github.com/acme/repo",
        randomState: "random-abc",
        timestamp: Date.now(),
      });

      const result = verifyGithubAppState(state);
      expect(result.ok).toBe(true);
      expect(result.payload?.repositoryUrl).toBe(
        "https://github.com/acme/repo",
      );
    });

    test("throws when NEXTAUTH_SECRET is missing", () => {
      delete process.env.NEXTAUTH_SECRET;
      expect(() =>
        signGithubAppState({
          workspaceSlug: "ws",
          randomState: "r",
          timestamp: Date.now(),
        }),
      ).toThrow(/NEXTAUTH_SECRET is required/);
    });
  });

  describe("verifyGithubAppState", () => {
    test("accepts a freshly-signed state", () => {
      const state = signGithubAppState({
        workspaceSlug: "ws",
        randomState: "r",
        timestamp: Date.now(),
      });
      const result = verifyGithubAppState(state);
      expect(result.ok).toBe(true);
      expect(result.payload?.workspaceSlug).toBe("ws");
    });

    test("rejects a tampered body (signature no longer matches)", () => {
      const state = signGithubAppState({
        workspaceSlug: "original-ws",
        randomState: "r",
        timestamp: Date.now(),
      });
      const [, sig] = state.split(".");
      // Swap the body to one representing a different workspace but
      // keep the original signature.
      const forgedBody = Buffer.from(
        JSON.stringify({
          workspaceSlug: "victim-ws",
          randomState: "r",
          timestamp: Date.now(),
        }),
      )
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/g, "");
      const forged = `${forgedBody}.${sig}`;

      const result = verifyGithubAppState(forged);
      expect(result.ok).toBe(false);
      expect(result.reason).toBe("bad_signature");
    });

    test("rejects a tampered signature", () => {
      const state = signGithubAppState({
        workspaceSlug: "ws",
        randomState: "r",
        timestamp: Date.now(),
      });
      const tampered = state.replace(/.$/, (c) => (c === "a" ? "b" : "a"));
      const result = verifyGithubAppState(tampered);
      expect(result.ok).toBe(false);
      expect(result.reason).toBe("bad_signature");
    });

    test("rejects state signed with a different secret", () => {
      const state = signGithubAppState({
        workspaceSlug: "ws",
        randomState: "r",
        timestamp: Date.now(),
      });
      process.env.NEXTAUTH_SECRET = "a-different-secret";
      const result = verifyGithubAppState(state);
      expect(result.ok).toBe(false);
      expect(result.reason).toBe("bad_signature");
    });

    test("rejects an expired state (older than 1h)", () => {
      const state = signGithubAppState({
        workspaceSlug: "ws",
        randomState: "r",
        timestamp: Date.now() - 2 * 60 * 60 * 1000, // 2 hours ago
      });
      const result = verifyGithubAppState(state);
      expect(result.ok).toBe(false);
      expect(result.reason).toBe("expired");
    });

    test("rejects a state with a future timestamp", () => {
      const state = signGithubAppState({
        workspaceSlug: "ws",
        randomState: "r",
        timestamp: Date.now() + 10 * 60 * 1000, // 10 min in the future
      });
      const result = verifyGithubAppState(state);
      expect(result.ok).toBe(false);
      expect(result.reason).toBe("expired");
    });

    test("rejects malformed input (missing dot)", () => {
      expect(verifyGithubAppState("no-dot-here").ok).toBe(false);
      expect(verifyGithubAppState("no-dot-here").reason).toBe("malformed");
    });

    test("rejects null, undefined and empty string", () => {
      expect(verifyGithubAppState(null).ok).toBe(false);
      expect(verifyGithubAppState(undefined).ok).toBe(false);
      expect(verifyGithubAppState("").ok).toBe(false);
    });

    test("rejects legacy plain-base64 state", () => {
      // The old format was base64 JSON with no signature. The new
      // verifier must reject these outright rather than falling back.
      const legacy = Buffer.from(
        JSON.stringify({
          workspaceSlug: "ws",
          randomState: "r",
          timestamp: Date.now(),
        }),
      ).toString("base64");

      const result = verifyGithubAppState(legacy);
      expect(result.ok).toBe(false);
      // Legacy format has no `.` — rejected as malformed.
      expect(result.reason).toBe("malformed");
    });

    test("rejects a payload missing required fields", async () => {
      // Hand-sign a payload that omits `workspaceSlug`.
      const badPayload = Buffer.from(
        JSON.stringify({ randomState: "r", timestamp: Date.now() }),
      )
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/g, "");

      // Compute a valid signature for the bad body.
      const crypto = await import("crypto");
      const sig = crypto
        .createHmac("sha256", process.env.NEXTAUTH_SECRET!)
        .update(badPayload)
        .digest("hex");

      const state = `${badPayload}.${sig}`;
      const result = verifyGithubAppState(state);
      expect(result.ok).toBe(false);
      expect(result.reason).toBe("invalid_payload");
    });
  });
});
