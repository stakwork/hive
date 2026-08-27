/**
 * Server-boundary lookup for a corpus task's deterministic rerun answer.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * SERVER-BOUNDARY ONLY. This module (and the generated map it wraps) must
 * NEVER be imported by a "use client" module or anything under
 * src/components/**, directly or transitively. See
 * src/lib/workflow-benchmarks/task-schema.ts for the full rationale on why
 * this is an import-boundary unit test rather than the `server-only` package.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * Callers: the workflow-benchmarks dispatch route (`run/route.ts`), which
 * looks up the expected answer by slug when building `taskVars`.
 */

import { EXPECTED_OUTPUTS } from "./expected-outputs.server.generated";

/**
 * Returns the deterministic rerun answer for a corpus task, or undefined
 * when the task declared no `expected_output`.
 */
export function findExpectedOutput(taskSlug: string): string | undefined {
  return EXPECTED_OUTPUTS[taskSlug];
}
