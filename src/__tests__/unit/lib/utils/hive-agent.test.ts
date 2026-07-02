import { describe, test, expect } from "vitest";
import {
  resolveHiveAgentName,
  isBifrostAgentName,
  HIVE_AGENT_OPTIONS,
} from "@/lib/utils/hive-agent";
import { BIFROST_AGENT_NAMES } from "@/services/bifrost/orchestrator";

// ---------------------------------------------------------------------------
// isBifrostAgentName
// ---------------------------------------------------------------------------
describe("isBifrostAgentName", () => {
  test("returns true for every member of BIFROST_AGENT_NAMES", () => {
    for (const name of BIFROST_AGENT_NAMES) {
      expect(isBifrostAgentName(name)).toBe(true);
    }
  });

  test("returns false for arbitrary strings", () => {
    expect(isBifrostAgentName("unknown-agent")).toBe(false);
    expect(isBifrostAgentName("Code Reviewer")).toBe(false);
    expect(isBifrostAgentName("")).toBe(false);
  });

  test("returns false for non-string values", () => {
    expect(isBifrostAgentName(null)).toBe(false);
    expect(isBifrostAgentName(undefined)).toBe(false);
    expect(isBifrostAgentName(42)).toBe(false);
    expect(isBifrostAgentName({})).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// HIVE_AGENT_OPTIONS catalog
// ---------------------------------------------------------------------------
describe("HIVE_AGENT_OPTIONS", () => {
  test("contains an entry for every BIFROST_AGENT_NAMES member", () => {
    const names = HIVE_AGENT_OPTIONS.map((o) => o.name);
    for (const agentName of BIFROST_AGENT_NAMES) {
      expect(names).toContain(agentName);
    }
  });

  test("every option has a non-empty displayName and description", () => {
    for (const option of HIVE_AGENT_OPTIONS) {
      expect(option.displayName.trim().length).toBeGreaterThan(0);
      expect(option.description.trim().length).toBeGreaterThan(0);
    }
  });

  test("preserves BIFROST_AGENT_NAMES order", () => {
    expect(HIVE_AGENT_OPTIONS.map((o) => o.name)).toEqual([...BIFROST_AGENT_NAMES]);
  });
});

// ---------------------------------------------------------------------------
// resolveHiveAgentName — source bucket → canonical agent
// ---------------------------------------------------------------------------
describe("resolveHiveAgentName — source defaults", () => {
  test('repo_agent → "repo-agent"', () => {
    expect(resolveHiveAgentName("repo_agent")).toBe("repo-agent");
  });

  test('jamie_agent → "canvas-agent"', () => {
    expect(resolveHiveAgentName("jamie_agent")).toBe("canvas-agent");
  });

  test('provider_direct → "plan-agent"', () => {
    expect(resolveHiveAgentName("provider_direct")).toBe("plan-agent");
  });

  test("result is always a member of BIFROST_AGENT_NAMES", () => {
    const sources = ["repo_agent", "jamie_agent", "provider_direct"] as const;
    for (const source of sources) {
      const result = resolveHiveAgentName(source);
      expect(BIFROST_AGENT_NAMES as readonly string[]).toContain(result);
    }
  });
});

// ---------------------------------------------------------------------------
// resolveHiveAgentName — user override wins when valid
// ---------------------------------------------------------------------------
describe("resolveHiveAgentName — override behaviour", () => {
  test("valid override wins over source default", () => {
    expect(resolveHiveAgentName("repo_agent", "coding-agent")).toBe("coding-agent");
    expect(resolveHiveAgentName("provider_direct", "logs-agent")).toBe("logs-agent");
    expect(resolveHiveAgentName("jamie_agent", "diagram-agent")).toBe("diagram-agent");
  });

  test("invalid override string falls back to source default", () => {
    expect(resolveHiveAgentName("repo_agent", "Code Reviewer")).toBe("repo-agent");
    expect(resolveHiveAgentName("jamie_agent", "unknown-bot")).toBe("canvas-agent");
    expect(resolveHiveAgentName("provider_direct", "")).toBe("plan-agent");
  });

  test("null override falls back to source default", () => {
    expect(resolveHiveAgentName("repo_agent", null)).toBe("repo-agent");
    expect(resolveHiveAgentName("jamie_agent", null)).toBe("canvas-agent");
  });

  test("undefined override (no second arg) falls back to source default", () => {
    expect(resolveHiveAgentName("repo_agent", undefined)).toBe("repo-agent");
    expect(resolveHiveAgentName("provider_direct", undefined)).toBe("plan-agent");
  });

  test("override must be exact canonical name — display names are rejected", () => {
    // "Repo Agent" is a displayName, not a BifrostAgentName
    expect(resolveHiveAgentName("jamie_agent", "Repo Agent")).toBe("canvas-agent");
    expect(resolveHiveAgentName("jamie_agent", "Canvas Agent")).toBe("canvas-agent");
  });
});
