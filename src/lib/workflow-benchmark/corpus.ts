/**
 * Workflow Benchmark corpus.
 *
 * Tasks in this corpus use the `wfbench/` slug prefix so they are
 * distinguishable from Legal Benchmark tasks on the shared BENCHMARK_RUNNER
 * StakworkRunType. The prefix is load-bearing: the Runs tab filters to
 * wfbench/-prefixed rows, and the single-active-run guard is scoped by
 * taskSlug (not type alone) so two unrelated benchmark domains cannot block
 * each other.
 *
 * `baseline` is optional — absent on the seed task so the score surface
 * gracefully renders "no baseline" rather than "0/0".
 */

export interface WorkflowBenchmarkTask {
  /** Slug with mandatory wfbench/ prefix. */
  slug: string;
  title: string;
  description: string;
  /** Rubric criteria for graph-first scoring (EvalRequirement per criterion). */
  criteria: WorkflowBenchmarkCriterion[];
  /** Optional baseline score from a reference run (absent on seed task). */
  baseline?: number;
}

export interface WorkflowBenchmarkCriterion {
  id: string;
  title: string;
  match_criteria: string;
}

/**
 * Seed corpus — one task per workflow capability area.
 * Expand this list as more benchmark scenarios are authored.
 */
export const WORKFLOW_BENCHMARK_TASKS: WorkflowBenchmarkTask[] = [
  {
    slug: "wfbench/summarize-workflow-steps",
    title: "Summarize Workflow Steps",
    description:
      "Given a Stakwork workflow definition, produce a concise plain-English summary of what each step does, in order, and identify the final output artifact.",
    criteria: [
      {
        id: "WFB-001",
        title: "Step enumeration completeness",
        match_criteria:
          "The summary enumerates every step in the workflow in the correct sequential order without omission.",
      },
      {
        id: "WFB-002",
        title: "Step purpose accuracy",
        match_criteria:
          "Each step's description accurately captures the step's purpose as defined by its node type and configuration.",
      },
      {
        id: "WFB-003",
        title: "Final output identification",
        match_criteria:
          "The summary correctly identifies the final output artifact (type and format) produced by the workflow.",
      },
      {
        id: "WFB-004",
        title: "Clarity and conciseness",
        match_criteria:
          "The summary is written in clear, concise plain English suitable for a non-technical stakeholder.",
      },
    ],
    // baseline deliberately absent — this is the seed task
  },
];

/** Total task count for display. */
export const WORKFLOW_BENCHMARK_TOTAL = WORKFLOW_BENCHMARK_TASKS.length;

/**
 * Look up a task by slug. Returns undefined for unknown slugs.
 */
export function getWorkflowBenchmarkTask(
  slug: string,
): WorkflowBenchmarkTask | undefined {
  return WORKFLOW_BENCHMARK_TASKS.find((t) => t.slug === slug);
}
