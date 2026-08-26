// Corpus data barrel — re-exports the generated index plus the derived
// lookups consumers rely on. Authoring rules, the zod schema, and invariant
// predicates live in `src/lib/workflow-benchmarks/task-schema.ts`.

import { WORKFLOW_BENCHMARK_TASKS } from "./workflow-benchmark-tasks.generated";
import { TASK_SLUG_RE } from "./workflow-benchmarks/task-schema";

export type {
  WorkflowBenchmarkTask,
  WorkflowBenchmarkCriterion,
} from "./workflow-benchmarks/task-schema";
export { WORKFLOW_BENCHMARK_TASKS };
export { TASK_SLUG_RE };

/**
 * Look up a task by its namespaced slug.
 * Returns undefined when the slug is not in the corpus.
 */
export function findBenchmarkTask(slug: string) {
  return WORKFLOW_BENCHMARK_TASKS.find((t) => t.slug === slug);
}

/**
 * The set of all valid corpus slugs — used by dispatch and rubrics routes
 * to validate the `taskSlug` query/body param against the corpus rather than
 * forwarding an arbitrary string into graph queries or workflow vars.
 */
export const CORPUS_SLUGS: ReadonlySet<string> = new Set(
  WORKFLOW_BENCHMARK_TASKS.map((t) => t.slug),
);

/**
 * Wire var names for the dispatch payload / rerunner contract. Defined here
 * (rather than at first use) so the module surface is stable — unused until
 * the input-contract slice adds `workflow_input`/`expected_output`.
 */
export const WORKFLOW_INPUT_VAR = "workflow_input_json";
export const RERUN_EXPECTED_OUTPUT_VAR = "rerun_expected_output";
