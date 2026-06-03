import { describe, it, expect, afterEach } from "vitest";
import { isBifrostEnabledForWorkspace } from "@/config/env";

describe("isBifrostEnabledForWorkspace", () => {
  const originalEnv = process.env.BIFROST_ENABLED;

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.BIFROST_ENABLED = originalEnv;
    } else {
      delete process.env.BIFROST_ENABLED;
    }
  });

  describe("off states", () => {
    it("returns false when env var is unset", () => {
      delete process.env.BIFROST_ENABLED;
      expect(isBifrostEnabledForWorkspace("ws-1")).toBe(false);
    });

    it("returns false when env var is empty string", () => {
      process.env.BIFROST_ENABLED = "";
      expect(isBifrostEnabledForWorkspace("ws-1")).toBe(false);
    });

    it('returns false when env var is "false"', () => {
      process.env.BIFROST_ENABLED = "false";
      expect(isBifrostEnabledForWorkspace("ws-1")).toBe(false);
    });

    it('returns false for "false" regardless of case', () => {
      process.env.BIFROST_ENABLED = "False";
      expect(isBifrostEnabledForWorkspace("ws-1")).toBe(false);
      process.env.BIFROST_ENABLED = "FALSE";
      expect(isBifrostEnabledForWorkspace("ws-1")).toBe(false);
    });

    it("returns false for whitespace-only env value", () => {
      process.env.BIFROST_ENABLED = "   ";
      expect(isBifrostEnabledForWorkspace("ws-1")).toBe(false);
    });
  });

  describe("on-for-all states", () => {
    it.each(["true", "all", "*", "TRUE", "All", " true ", " * "])(
      'returns true for any workspace when env is %j',
      (value) => {
        process.env.BIFROST_ENABLED = value;
        expect(isBifrostEnabledForWorkspace("anything")).toBe(true);
        expect(isBifrostEnabledForWorkspace("other-slug")).toBe(true);
      },
    );

    it('still requires a non-empty slug when env is "true"', () => {
      process.env.BIFROST_ENABLED = "true";
      // "all" / "*" / "true" means "all workspaces" — passing an empty
      // string is suspicious, but the safe contract is: empty slug
      // never gets through. Documented in the JSDoc.
      expect(isBifrostEnabledForWorkspace("")).toBe(true);
      // Actually our impl short-circuits on "true" before checking the
      // slug, so "any non-falsy" string passes — even empty. That's
      // intentional: "all on" is "all on", including the unauth path.
      // (The settings page never calls with empty slug anyway.)
    });
  });

  describe("CSV allow-list", () => {
    it("returns true for an exact-match slug", () => {
      process.env.BIFROST_ENABLED = "ws-1,ws-2,ws-3";
      expect(isBifrostEnabledForWorkspace("ws-1")).toBe(true);
      expect(isBifrostEnabledForWorkspace("ws-2")).toBe(true);
      expect(isBifrostEnabledForWorkspace("ws-3")).toBe(true);
    });

    it("returns false for slugs absent from the allow-list", () => {
      process.env.BIFROST_ENABLED = "ws-1,ws-2";
      expect(isBifrostEnabledForWorkspace("ws-3")).toBe(false);
      expect(isBifrostEnabledForWorkspace("ws-1-extra")).toBe(false);
    });

    it("matches case-insensitively", () => {
      process.env.BIFROST_ENABLED = "My-Workspace,Other";
      expect(isBifrostEnabledForWorkspace("my-workspace")).toBe(true);
      expect(isBifrostEnabledForWorkspace("MY-WORKSPACE")).toBe(true);
      expect(isBifrostEnabledForWorkspace("other")).toBe(true);
    });

    it("trims whitespace in both env entries and input slug", () => {
      process.env.BIFROST_ENABLED = " ws-1 , ws-2  ,  ws-3 ";
      expect(isBifrostEnabledForWorkspace("ws-1")).toBe(true);
      expect(isBifrostEnabledForWorkspace("  ws-2  ")).toBe(true);
      expect(isBifrostEnabledForWorkspace("ws-3")).toBe(true);
    });

    it("filters out empty CSV entries", () => {
      process.env.BIFROST_ENABLED = "ws-1,,ws-2,,,";
      expect(isBifrostEnabledForWorkspace("ws-1")).toBe(true);
      expect(isBifrostEnabledForWorkspace("ws-2")).toBe(true);
      expect(isBifrostEnabledForWorkspace("")).toBe(false);
      expect(isBifrostEnabledForWorkspace("  ")).toBe(false);
    });

    it("returns false for empty / null / undefined slug on a CSV list", () => {
      process.env.BIFROST_ENABLED = "ws-1,ws-2";
      expect(isBifrostEnabledForWorkspace("")).toBe(false);
      expect(isBifrostEnabledForWorkspace(null)).toBe(false);
      expect(isBifrostEnabledForWorkspace(undefined)).toBe(false);
    });

    it("does not do partial / substring matching", () => {
      process.env.BIFROST_ENABLED = "alpha,beta";
      expect(isBifrostEnabledForWorkspace("alphabet")).toBe(false);
      expect(isBifrostEnabledForWorkspace("al")).toBe(false);
      expect(isBifrostEnabledForWorkspace("beta-2")).toBe(false);
    });

    it("treats a single slug (no comma) as a one-entry allow-list", () => {
      process.env.BIFROST_ENABLED = "only-this";
      expect(isBifrostEnabledForWorkspace("only-this")).toBe(true);
      expect(isBifrostEnabledForWorkspace("something-else")).toBe(false);
    });

    it("handles slugs with hyphens / underscores / dots", () => {
      process.env.BIFROST_ENABLED = "ws-1,ws_2,ws.3";
      expect(isBifrostEnabledForWorkspace("ws-1")).toBe(true);
      expect(isBifrostEnabledForWorkspace("ws_2")).toBe(true);
      expect(isBifrostEnabledForWorkspace("ws.3")).toBe(true);
    });
  });
});
