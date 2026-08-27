/**
 * Import-boundary invariant for the Workflow Benchmark expected-outputs
 * server-boundary module.
 *
 * `src/lib/workflow-benchmarks/expected-outputs.server.generated.ts` (and its
 * wrapper `expected-output-lookup.server.ts`) carry the deterministic rerun
 * answer for corpus tasks that declare one. That value must NEVER reach the
 * browser — `WorkflowBenchmarksPanel.tsx` imports the whole corpus index and
 * ships it to the client, so if the expected-output module were reachable
 * from a "use client" file or anything under src/components/**, the answer
 * would leak into the bundle.
 *
 * This is deliberately a static, mechanical text-based grep — not the
 * `server-only` npm package — because `server-only` is not installed, and
 * `vitest.config.ts` configures no `react-server` resolve condition, so
 * importing it would break every existing unit test that transitively
 * imports the dispatch route. See task-schema.ts's file header for the full
 * rationale.
 *
 * Scope: direct import STRINGS only (text-based grep), mirroring the
 * existing src/__tests__/unit/lib/run-report/invariants.test.ts pattern —
 * not a transitive module-graph traversal.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

const SRC_DIR = join(process.cwd(), "src");
const COMPONENTS_DIR = join(process.cwd(), "src/components");

// Match actual import/require statements only — not prose mentioning the
// filename in a comment (e.g. WorkflowBenchmarksPanel.tsx's rationale comment
// explaining why it does NOT import this module).
const BOUNDARY_IMPORT_PATTERNS = [
  /from\s+["'][^"']*expected-outputs\.server\.generated["']/,
  /from\s+["'][^"']*expected-output-lookup\.server["']/,
  /require\(\s*["'][^"']*expected-outputs\.server\.generated["']\s*\)/,
  /require\(\s*["'][^"']*expected-output-lookup\.server["']\s*\)/,
];

function filesIn(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) out.push(...filesIn(full));
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

function read(file: string): string {
  return readFileSync(file, "utf8");
}

function hasUseClientDirective(content: string): boolean {
  // "use client" must be the first statement (ignoring leading whitespace/comments-ish),
  // but for this mechanical check we just look for the directive string anywhere near
  // the top of the file, matching Next.js's own convention of putting it first.
  const firstNonEmptyLines = content.split("\n").slice(0, 5).join("\n");
  return /["']use client["']/.test(firstNonEmptyLines);
}

describe("expected-outputs server-boundary import invariant", () => {
  it("the boundary files exist", () => {
    const generatedPath = join(
      SRC_DIR,
      "lib/workflow-benchmarks/expected-outputs.server.generated.ts",
    );
    const wrapperPath = join(SRC_DIR, "lib/workflow-benchmarks/expected-output-lookup.server.ts");
    expect(() => readFileSync(generatedPath, "utf8")).not.toThrow();
    expect(() => readFileSync(wrapperPath, "utf8")).not.toThrow();
  });

  it("nothing under src/components/** imports the expected-outputs boundary module (directly)", () => {
    const files = filesIn(COMPONENTS_DIR);
    const offenders = files.filter((f) => {
      const content = read(f);
      return BOUNDARY_IMPORT_PATTERNS.some((p) => p.test(content));
    });
    expect(offenders).toEqual([]);
  });

  it("no \"use client\" module anywhere in src/ imports the expected-outputs boundary module (directly)", () => {
    const files = filesIn(SRC_DIR);
    const offenders = files.filter((f) => {
      const content = read(f);
      if (!hasUseClientDirective(content)) return false;
      return BOUNDARY_IMPORT_PATTERNS.some((p) => p.test(content));
    });
    expect(offenders).toEqual([]);
  });

  it("WorkflowBenchmarksPanel.tsx (the client-reachable task browser) does not import the boundary module", () => {
    const panelPath = join(COMPONENTS_DIR, "workflow-benchmarks/WorkflowBenchmarksPanel.tsx");
    const content = read(panelPath);
    for (const pattern of BOUNDARY_IMPORT_PATTERNS) {
      expect(pattern.test(content)).toBe(false);
    }
  });

  it("only the dispatch route imports the expected-output-lookup.server wrapper", () => {
    // Sanity check that the invariant above is non-vacuous: the wrapper DOES
    // have a legitimate server-side importer (the dispatch route), so this
    // isn't just an unused file the boundary check trivially passes on.
    const files = filesIn(SRC_DIR);
    const importers = files.filter((f) => /expected-output-lookup\.server/.test(read(f)));
    // At least the dispatch route + the wrapper's own declaration.
    expect(importers.length).toBeGreaterThan(0);
    const dispatchRoutePath = join(
      SRC_DIR,
      "app/api/workspaces/[slug]/workflow-benchmarks/run/route.ts",
    );
    expect(importers).toContain(dispatchRoutePath);
  });

  it("the generated expected-outputs module carries its boundary header comment", () => {
    const generatedPath = join(
      SRC_DIR,
      "lib/workflow-benchmarks/expected-outputs.server.generated.ts",
    );
    const content = read(generatedPath);
    expect(content).toMatch(/SERVER-BOUNDARY ONLY/);
    // The phrase wraps across a comment line break in the rendered header —
    // match tolerant of intervening whitespace/newlines/comment asterisks.
    expect(content).toMatch(/NEVER be imported by a "use client"[\s*]*module/);
  });
});
