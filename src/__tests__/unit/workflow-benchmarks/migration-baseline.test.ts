/**
 * Migration-acceptance test for the corpus restructure.
 *
 * `benchmarks/workflow-editor/__fixtures__/corpus-migration-baseline.json` is
 * a snapshot of `WORKFLOW_BENCHMARK_TASKS` taken from the OLD hand-written
 * `src/lib/workflow-benchmark-tasks.ts` array, before it was replaced by the
 * generated-index pipeline. This test asserts the regenerated corpus (walked
 * from `benchmarks/workflow-editor/tasks/` through the real generator) is
 * DEEP-EQUAL to that snapshot — not byte-identical, since the generator's
 * TS-source formatting differs from the old hand-written file.
 *
 * This is a migration-acceptance artifact, not a permanent regression guard.
 * Slices legitimately mutating corpus data are expected to re-baseline this
 * fixture in their own commit, with the JSON diff reviewed as the change
 * record — which has happened twice so far: workflow_input/expected_output
 * (input contract) and expectedSecrets removal + C-004/C-005 narrowing
 * (secret cleanup). The ongoing guard against unreviewed drift is the
 * separate "regenerate produces no diff" CI check, which does not decay.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { generateWorkflowBenchmarkTasks } from "../../../../scripts/generate-workflow-benchmark-tasks";
import type { WorkflowBenchmarkTask } from "@/lib/workflow-benchmarks/task-schema";

const BASELINE_FIXTURE_PATH = join(
  process.cwd(),
  "benchmarks/workflow-editor/__fixtures__/corpus-migration-baseline.json",
);
const PRODUCTION_TASKS_ROOT = join(
  process.cwd(),
  "benchmarks/workflow-editor/tasks",
);

describe("corpus migration acceptance", () => {
  it("regenerating from the production tasks tree deep-equals the pre-migration baseline fixture", () => {
    const baseline = JSON.parse(
      readFileSync(BASELINE_FIXTURE_PATH, "utf-8"),
    ) as WorkflowBenchmarkTask[];

    const { tasks } = generateWorkflowBenchmarkTasks(PRODUCTION_TASKS_ROOT);

    expect(tasks).toEqual(baseline);
  });
});
