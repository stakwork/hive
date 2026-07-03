import { describe, test, expect } from "vitest";
import {
  resolveHiveAgentName,
  isBifrostAgentName,
  isCaptureAgentName,
  HIVE_AGENT_OPTIONS,
  CAPTURE_AGENT_NAMES,
  parseCanonicalAgent,
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

  test("returns false for wfe-agent (not in Bifrost catalog)", () => {
    expect(isBifrostAgentName("wfe-agent")).toBe(false);
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
// CAPTURE_AGENT_NAMES allowlist
// ---------------------------------------------------------------------------
describe("CAPTURE_AGENT_NAMES", () => {
  test("contains all BIFROST_AGENT_NAMES members", () => {
    for (const name of BIFROST_AGENT_NAMES) {
      expect(CAPTURE_AGENT_NAMES as readonly string[]).toContain(name);
    }
  });

  test("contains wfe-agent", () => {
    expect(CAPTURE_AGENT_NAMES as readonly string[]).toContain("wfe-agent");
  });

  test("has exactly BIFROST_AGENT_NAMES.length + 1 entries", () => {
    expect(CAPTURE_AGENT_NAMES.length).toBe(BIFROST_AGENT_NAMES.length + 1);
  });
});

// ---------------------------------------------------------------------------
// isCaptureAgentName
// ---------------------------------------------------------------------------
describe("isCaptureAgentName", () => {
  test("returns true for every BIFROST_AGENT_NAMES member", () => {
    for (const name of BIFROST_AGENT_NAMES) {
      expect(isCaptureAgentName(name)).toBe(true);
    }
  });

  test("returns true for wfe-agent", () => {
    expect(isCaptureAgentName("wfe-agent")).toBe(true);
  });

  test("returns false for arbitrary strings", () => {
    expect(isCaptureAgentName("unknown-agent")).toBe(false);
    expect(isCaptureAgentName("Code Reviewer")).toBe(false);
    expect(isCaptureAgentName("")).toBe(false);
  });

  test("returns false for non-string values", () => {
    expect(isCaptureAgentName(null)).toBe(false);
    expect(isCaptureAgentName(undefined)).toBe(false);
    expect(isCaptureAgentName(42)).toBe(false);
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

  test("contains wfe-agent", () => {
    const names = HIVE_AGENT_OPTIONS.map((o) => o.name);
    expect(names).toContain("wfe-agent");
  });

  test("has BIFROST_AGENT_NAMES.length + 1 entries (wfe-agent at end)", () => {
    expect(HIVE_AGENT_OPTIONS.length).toBe(BIFROST_AGENT_NAMES.length + 1);
    expect(HIVE_AGENT_OPTIONS[HIVE_AGENT_OPTIONS.length - 1].name).toBe("wfe-agent");
  });

  test("every option has a non-empty displayName and description", () => {
    for (const option of HIVE_AGENT_OPTIONS) {
      expect(option.displayName.trim().length).toBeGreaterThan(0);
      expect(option.description.trim().length).toBeGreaterThan(0);
    }
  });

  test("Bifrost agents appear before wfe-agent in BIFROST_AGENT_NAMES order", () => {
    const bifrostPortion = HIVE_AGENT_OPTIONS.slice(0, BIFROST_AGENT_NAMES.length).map((o) => o.name);
    expect(bifrostPortion).toEqual([...BIFROST_AGENT_NAMES]);
  });
});

// ---------------------------------------------------------------------------
// parseCanonicalAgent
// ---------------------------------------------------------------------------
describe("parseCanonicalAgent — happy paths", () => {
  test("extracts coding-agent from coding-agent-<cuid>", () => {
    expect(parseCanonicalAgent("coding-agent-cmr3lw4o5abc")).toBe("coding-agent");
  });

  test("extracts plan-agent from plan-agent-<cuid>", () => {
    expect(parseCanonicalAgent("plan-agent-cmr3lpydabc123")).toBe("plan-agent");
  });

  test("extracts wfe-agent from wfe-agent-<cuid>", () => {
    expect(parseCanonicalAgent("wfe-agent-cmr3abc123xyz")).toBe("wfe-agent");
  });

  test("extracts repo-agent from repo-agent-<cuid>", () => {
    expect(parseCanonicalAgent("repo-agent-cm1abc2def3")).toBe("repo-agent");
  });

  test("extracts canvas-agent from canvas-agent-<cuid>", () => {
    expect(parseCanonicalAgent("canvas-agent-cmzzz000aaa")).toBe("canvas-agent");
  });

  test("extracts browser-agent from browser-agent-<cuid>", () => {
    expect(parseCanonicalAgent("browser-agent-cmabc000111")).toBe("browser-agent");
  });

  test("exact match (no suffix) also works", () => {
    expect(parseCanonicalAgent("coding-agent")).toBe("coding-agent");
    expect(parseCanonicalAgent("wfe-agent")).toBe("wfe-agent");
  });
});

describe("parseCanonicalAgent — no-match cases", () => {
  test("returns undefined for completely unknown agent name", () => {
    expect(parseCanonicalAgent("unknown-agent-cmr3abc")).toBeUndefined();
  });

  test("returns undefined for free-text agent string", () => {
    expect(parseCanonicalAgent("Code Reviewer")).toBeUndefined();
  });

  test("returns undefined for empty string", () => {
    expect(parseCanonicalAgent("")).toBeUndefined();
  });

  test("returns undefined for suffix-only cuid string", () => {
    expect(parseCanonicalAgent("cmr3lw4o5abc")).toBeUndefined();
  });

  test("returns undefined when name contains uppercase (not canonical)", () => {
    expect(parseCanonicalAgent("Coding-Agent-cmr3abc")).toBeUndefined();
  });

  test("returns undefined for swarm_agent (not in allowlist)", () => {
    expect(parseCanonicalAgent("swarm_agent")).toBeUndefined();
  });
});

describe("parseCanonicalAgent — longest-prefix match", () => {
  test("does not split on last dash — uses known prefix matching", () => {
    // If there were a hypothetical 'coding-agent-v2', it should still match 'coding-agent'
    // For now, verify that 'coding-agent-cmr3abc' correctly returns 'coding-agent'
    // and not 'coding-agent-cmr3ab' (i.e. doesn't split on last dash)
    expect(parseCanonicalAgent("coding-agent-cmr3abc")).toBe("coding-agent");
  });

  test("handles all known agents with realistic cuid suffixes", () => {
    const testCases: [string, string][] = [
      ["repo-agent-cm1234567890abc", "repo-agent"],
      ["chat-agent-cm9876543210xyz", "chat-agent"],
      ["canvas-agent-cmabcdef123456", "canvas-agent"],
      ["diagram-agent-cm000111222333", "diagram-agent"],
      ["logs-agent-cmlogabc123", "logs-agent"],
      ["plan-agent-cmplanabc456", "plan-agent"],
      ["coding-agent-cmcodabc789", "coding-agent"],
      ["test-agent-cmtesabc012", "test-agent"],
      ["build-agent-cmbuibabc345", "build-agent"],
      ["browser-agent-cmbrowsrabc", "browser-agent"],
      ["wfe-agent-cmwfeabc678", "wfe-agent"],
    ];

    for (const [input, expected] of testCases) {
      expect(parseCanonicalAgent(input)).toBe(expected);
    }
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

  test("result is always a member of CAPTURE_AGENT_NAMES", () => {
    const sources = ["repo_agent", "jamie_agent", "provider_direct"] as const;
    for (const source of sources) {
      const result = resolveHiveAgentName(source);
      expect(CAPTURE_AGENT_NAMES as readonly string[]).toContain(result);
    }
  });
});

// ---------------------------------------------------------------------------
// resolveHiveAgentName — user override wins when valid
// ---------------------------------------------------------------------------
describe("resolveHiveAgentName — override behaviour", () => {
  test("valid BifrostAgentName override wins over source default", () => {
    expect(resolveHiveAgentName("repo_agent", "coding-agent")).toBe("coding-agent");
    expect(resolveHiveAgentName("provider_direct", "logs-agent")).toBe("logs-agent");
    expect(resolveHiveAgentName("jamie_agent", "diagram-agent")).toBe("diagram-agent");
  });

  test("wfe-agent override is accepted (not in Bifrost catalog but in capture allowlist)", () => {
    expect(resolveHiveAgentName("repo_agent", "wfe-agent")).toBe("wfe-agent");
    expect(resolveHiveAgentName("provider_direct", "wfe-agent")).toBe("wfe-agent");
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
    // "Repo Agent" is a displayName, not a canonical name
    expect(resolveHiveAgentName("jamie_agent", "Repo Agent")).toBe("canvas-agent");
    expect(resolveHiveAgentName("jamie_agent", "WFE Agent")).toBe("canvas-agent");
  });
});
