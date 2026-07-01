import { describe, it, expect, afterEach } from "vitest";
import { isBifrostEnabledForAgent } from "@/config/env";

// Companion to `env-bifrost-flag.test.ts`. The two gates share the
// same CSV grammar but have OPPOSITE defaults:
//   - BIFROST_ENABLED          → default-closed (empty = off)
//   - BIFROST_ENABLED_AGENTS   → default-open  (empty = all agents)
//
// The asymmetry is intentional: the workspace gate is the primary
// rollout switch; the agent gate is opt-in filtering layered on top.
// These tests pin both halves of that contract.

describe("isBifrostEnabledForAgent", () => {
  const originalEnv = process.env.BIFROST_ENABLED_AGENTS;

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.BIFROST_ENABLED_AGENTS = originalEnv;
    } else {
      delete process.env.BIFROST_ENABLED_AGENTS;
    }
  });

  describe("default-open states", () => {
    it("returns true when env var is unset (back-compat)", () => {
      delete process.env.BIFROST_ENABLED_AGENTS;
      expect(isBifrostEnabledForAgent("coding-agent")).toBe(true);
      expect(isBifrostEnabledForAgent("plan-agent")).toBe(true);
      expect(isBifrostEnabledForAgent("repo-agent")).toBe(true);
    });

    it("returns true when env var is empty string", () => {
      process.env.BIFROST_ENABLED_AGENTS = "";
      expect(isBifrostEnabledForAgent("coding-agent")).toBe(true);
    });

    it("returns true for whitespace-only env value", () => {
      process.env.BIFROST_ENABLED_AGENTS = "   ";
      expect(isBifrostEnabledForAgent("coding-agent")).toBe(true);
    });

    it.each(["true", "all", "*", "TRUE", "All", " true ", " * "])(
      'returns true for any agentName when env is %j',
      (value) => {
        process.env.BIFROST_ENABLED_AGENTS = value;
        expect(isBifrostEnabledForAgent("coding-agent")).toBe(true);
        expect(isBifrostEnabledForAgent("unknown-future-agent")).toBe(true);
      },
    );
  });

  describe("explicit off state", () => {
    it('returns false when env is "false"', () => {
      process.env.BIFROST_ENABLED_AGENTS = "false";
      expect(isBifrostEnabledForAgent("coding-agent")).toBe(false);
      expect(isBifrostEnabledForAgent("plan-agent")).toBe(false);
    });

    it('returns false for "false" regardless of case', () => {
      process.env.BIFROST_ENABLED_AGENTS = "False";
      expect(isBifrostEnabledForAgent("coding-agent")).toBe(false);
      process.env.BIFROST_ENABLED_AGENTS = "FALSE";
      expect(isBifrostEnabledForAgent("coding-agent")).toBe(false);
    });
  });

  describe("CSV allow-list", () => {
    it("returns true for an exact-match agentName", () => {
      process.env.BIFROST_ENABLED_AGENTS =
        "plan-agent,coder-agent,pr-monitor";
      expect(isBifrostEnabledForAgent("plan-agent")).toBe(true);
      expect(isBifrostEnabledForAgent("coding-agent")).toBe(true);
      expect(isBifrostEnabledForAgent("pr-monitor")).toBe(true);
    });

    it("returns false for agentNames absent from the allow-list", () => {
      process.env.BIFROST_ENABLED_AGENTS = "plan-agent,coder-agent";
      expect(isBifrostEnabledForAgent("repo-agent")).toBe(false);
      expect(isBifrostEnabledForAgent("chat-agent")).toBe(false);
      expect(isBifrostEnabledForAgent("pr-monitor")).toBe(false);
    });

    it("matches case-insensitively", () => {
      process.env.BIFROST_ENABLED_AGENTS = "Plan-Agent,Coder-Agent";
      expect(isBifrostEnabledForAgent("plan-agent")).toBe(true);
      expect(isBifrostEnabledForAgent("PLAN-AGENT")).toBe(true);
      expect(isBifrostEnabledForAgent("coding-agent")).toBe(true);
    });

    it("trims whitespace in both env entries and input agentName", () => {
      process.env.BIFROST_ENABLED_AGENTS =
        " plan-agent , coder-agent  ,  pr-monitor ";
      expect(isBifrostEnabledForAgent("plan-agent")).toBe(true);
      expect(isBifrostEnabledForAgent("  coder-agent  ")).toBe(true);
      expect(isBifrostEnabledForAgent("pr-monitor")).toBe(true);
    });

    it("filters out empty CSV entries", () => {
      process.env.BIFROST_ENABLED_AGENTS = "plan-agent,,coder-agent,,,";
      expect(isBifrostEnabledForAgent("plan-agent")).toBe(true);
      expect(isBifrostEnabledForAgent("coding-agent")).toBe(true);
      expect(isBifrostEnabledForAgent("")).toBe(false);
      expect(isBifrostEnabledForAgent("  ")).toBe(false);
    });

    it("returns false for empty / null / undefined agentName on a CSV list", () => {
      process.env.BIFROST_ENABLED_AGENTS = "plan-agent,coder-agent";
      expect(isBifrostEnabledForAgent("")).toBe(false);
      expect(isBifrostEnabledForAgent(null)).toBe(false);
      expect(isBifrostEnabledForAgent(undefined)).toBe(false);
    });

    it("does not do partial / substring matching", () => {
      process.env.BIFROST_ENABLED_AGENTS = "coder-agent,plan-agent";
      expect(isBifrostEnabledForAgent("coder")).toBe(false);
      expect(isBifrostEnabledForAgent("coder-agent-extra")).toBe(false);
      expect(isBifrostEnabledForAgent("plan")).toBe(false);
    });

    it("treats a single agentName (no comma) as a one-entry allow-list", () => {
      process.env.BIFROST_ENABLED_AGENTS = "pr-monitor";
      expect(isBifrostEnabledForAgent("pr-monitor")).toBe(true);
      expect(isBifrostEnabledForAgent("plan-agent")).toBe(false);
    });
  });

  describe("realistic rollout shapes", () => {
    it('"workflow agents only" — the 3 PR-4079 surfaces opt in', () => {
      process.env.BIFROST_ENABLED_AGENTS =
        "plan-agent,coder-agent,pr-monitor";
      // Workflow surfaces opted in:
      expect(isBifrostEnabledForAgent("plan-agent")).toBe(true);
      expect(isBifrostEnabledForAgent("coding-agent")).toBe(true);
      expect(isBifrostEnabledForAgent("pr-monitor")).toBe(true);
      // Chat surfaces stay off:
      expect(isBifrostEnabledForAgent("repo-agent")).toBe(false);
      expect(isBifrostEnabledForAgent("chat-agent")).toBe(false);
      expect(isBifrostEnabledForAgent("canvas-agent")).toBe(false);
      expect(isBifrostEnabledForAgent("diagram-agent")).toBe(false);
      expect(isBifrostEnabledForAgent("logs-agent")).toBe(false);
    });

    it('"chat agents only" — the inverse rollout', () => {
      process.env.BIFROST_ENABLED_AGENTS =
        "repo-agent,chat-agent,canvas-agent,diagram-agent,logs-agent";
      expect(isBifrostEnabledForAgent("repo-agent")).toBe(true);
      expect(isBifrostEnabledForAgent("plan-agent")).toBe(false);
      expect(isBifrostEnabledForAgent("coding-agent")).toBe(false);
      expect(isBifrostEnabledForAgent("pr-monitor")).toBe(false);
    });
  });
});
