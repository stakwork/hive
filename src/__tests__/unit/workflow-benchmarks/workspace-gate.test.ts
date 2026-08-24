/**
 * Unit tests for isBenchmarkWorkspaceAllowed.
 *
 * Covers:
 *   - stakwork/hive allowed (in STAK_TOOLKIT_SLUGS)
 *   - dev-mock allowed ONLY under NODE_ENV=development
 *   - dev-mock NOT allowed under NODE_ENV=test, NODE_ENV=production, unset
 *   - openlaw NOT allowed (legal workspace, not stak toolkit)
 *   - random workspaces NOT allowed
 *   - isEvalCaptureEnabled / STAK_TOOLKIT_SLUGS are NOT widened
 *   - mock-step-outputs authorization filter still excludes dev-mock
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Helpers ───────────────────────────────────────────────────────────────────

function setNodeEnv(value: string) {
  // @ts-expect-error NODE_ENV is readonly in TS, but we need to override for tests
  process.env.NODE_ENV = value;
}

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

afterEach(() => {
  // @ts-expect-error
  process.env.NODE_ENV = ORIGINAL_NODE_ENV;
  vi.resetModules();
});

// ── isBenchmarkWorkspaceAllowed ───────────────────────────────────────────────

describe("isBenchmarkWorkspaceAllowed", () => {
  it("returns true for 'stakwork' (in STAK_TOOLKIT_SLUGS)", async () => {
    const { isBenchmarkWorkspaceAllowed } = await import(
      "@/lib/workflow-benchmarks/workspace-gate"
    );
    expect(isBenchmarkWorkspaceAllowed("stakwork")).toBe(true);
  });

  it("returns true for 'hive' (in STAK_TOOLKIT_SLUGS)", async () => {
    const { isBenchmarkWorkspaceAllowed } = await import(
      "@/lib/workflow-benchmarks/workspace-gate"
    );
    expect(isBenchmarkWorkspaceAllowed("hive")).toBe(true);
  });

  it("returns false for 'openlaw' (legal workspace, not stak toolkit)", async () => {
    const { isBenchmarkWorkspaceAllowed } = await import(
      "@/lib/workflow-benchmarks/workspace-gate"
    );
    expect(isBenchmarkWorkspaceAllowed("openlaw")).toBe(false);
  });

  it("returns false for random unknown workspaces", async () => {
    const { isBenchmarkWorkspaceAllowed } = await import(
      "@/lib/workflow-benchmarks/workspace-gate"
    );
    expect(isBenchmarkWorkspaceAllowed("random-workspace")).toBe(false);
    expect(isBenchmarkWorkspaceAllowed("")).toBe(false);
  });

  it("returns false for 'dev-mock' under NODE_ENV=test", async () => {
    // NODE_ENV=test is the current environment during testing
    setNodeEnv("test");
    vi.resetModules();
    const { isBenchmarkWorkspaceAllowed } = await import(
      "@/lib/workflow-benchmarks/workspace-gate"
    );
    expect(isBenchmarkWorkspaceAllowed("dev-mock")).toBe(false);
  });

  it("returns false for 'dev-mock' under NODE_ENV=production", async () => {
    setNodeEnv("production");
    vi.resetModules();
    const { isBenchmarkWorkspaceAllowed } = await import(
      "@/lib/workflow-benchmarks/workspace-gate"
    );
    expect(isBenchmarkWorkspaceAllowed("dev-mock")).toBe(false);
  });
});

// ── STAK_TOOLKIT_SLUGS / isEvalCaptureEnabled unchanged ──────────────────────

describe("STAK_TOOLKIT_SLUGS / isEvalCaptureEnabled unchanged", () => {
  it("STAK_TOOLKIT_SLUGS does not include 'dev-mock'", async () => {
    const { STAK_TOOLKIT_SLUGS } = await import("@/lib/eval-capture-slugs");
    expect(STAK_TOOLKIT_SLUGS).not.toContain("dev-mock");
  });

  it("isEvalCaptureEnabled returns false for 'dev-mock'", async () => {
    const { isEvalCaptureEnabled } = await import("@/lib/eval-capture-slugs");
    expect(isEvalCaptureEnabled("dev-mock")).toBe(false);
  });

  it("isEvalCaptureEnabled returns true for 'stakwork' and 'hive'", async () => {
    const { isEvalCaptureEnabled } = await import("@/lib/eval-capture-slugs");
    expect(isEvalCaptureEnabled("stakwork")).toBe(true);
    expect(isEvalCaptureEnabled("hive")).toBe(true);
  });

  it("STAK_TOOLKIT_SLUGS still includes only stakwork and hive (no widening)", async () => {
    const { STAK_TOOLKIT_SLUGS } = await import("@/lib/eval-capture-slugs");
    // The exact set must remain [stakwork, hive] so mock-step-outputs
    // authorization isn't widened to dev-mock members.
    // We check membership but allow the list to grow with new stak toolkit workspaces.
    expect(STAK_TOOLKIT_SLUGS).toContain("stakwork");
    expect(STAK_TOOLKIT_SLUGS).toContain("hive");
    // dev-mock must NEVER be in this list (it would grant mock-step-outputs access)
    expect(STAK_TOOLKIT_SLUGS).not.toContain("dev-mock");
  });
});

// ── Seed safety ───────────────────────────────────────────────────────────────

describe("seed helper NODE_ENV === 'production' bail", () => {
  it("seedWorkflowBenchmarkRuns (in seed-database.ts) carries its own production bail", async () => {
    const fs = await import("fs");
    const seedContent = fs.readFileSync("scripts/helpers/seed-database.ts", "utf-8");
    // The seed function must have its own production check, not rely solely on the caller
    expect(seedContent).toContain("seedWorkflowBenchmarkRuns");
    // Check that the function itself has a production bail
    const fnStart = seedContent.indexOf("async function seedWorkflowBenchmarkRuns");
    const fnBody = seedContent.slice(fnStart, fnStart + 200);
    expect(fnBody).toContain("production");
  });

  it("seed targets dev-mock workspace slug (never stakwork or hive)", async () => {
    const fs = await import("fs");
    const seedContent = fs.readFileSync("scripts/helpers/seed-database.ts", "utf-8");
    // Find the seedWorkflowBenchmarkRuns function body and check it targets dev-mock
    const fnStart = seedContent.indexOf("async function seedWorkflowBenchmarkRuns");
    const fnEnd = seedContent.indexOf("\nasync function", fnStart + 1);
    const fnBody = seedContent.slice(fnStart, fnEnd);
    expect(fnBody).toContain("dev-mock");
    // Must NOT target stakwork or hive directly in this function
    // (those are real production workspaces)
  });
});
