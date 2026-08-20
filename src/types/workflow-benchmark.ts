import { WorkflowStatus, StakworkRunType } from "@prisma/client";

/**
 * Parsed contents of a workflow benchmark run's `result` JSON column on StakworkRun.
 *
 * Stored under `BENCHMARK_RUNNER`. The `taskSlug` field carries the `wfbench/`
 * prefix which is the discriminator between benchmark domains on the shared type.
 */
export interface WorkflowBenchmarkRunResult {
  /** Task slug with wfbench/ prefix, e.g. "wfbench/summarize-workflow-steps". */
  taskSlug: string;
  taskTitle: string;
  /**
   * Operator-chosen execution model (bare name, e.g. "claude-sonnet-5").
   * Stored at run creation under a clobber-proof key.
   */
  requestedModel?: string;
  /**
   * Operator-chosen judge model (bare name, e.g. "claude-sonnet-4-6").
   * Stored at run creation under a clobber-proof key.
   */
  requestedJudgeModel?: string;
  /** Error message if the run failed. */
  errorMessage?: string;
  /** Jarvis EvalTrigger node ref — set after non-fatal Jarvis instrumentation. */
  evalTriggerRef?: string;
  /** Whether the EvalTriggerOutput node has already been written (idempotency guard). */
  evalOutputWritten?: boolean;
  /** Project ID returned by Stakwork on dispatch. */
  runnerProjectId?: number;
  // ── Score fields from the runner webhook ──────────────────────────────────
  score?: number;
  max_score?: number;
  n_passed?: number;
  n_total?: number;
  pass_rate?: number;
  all_pass?: boolean;
  /** Runner-echoed execution model name. For display, prefer requestedModel. */
  model?: string;
  /** Name of the judge model used for evaluation (runner-echoed). */
  judge_model?: string;
  /** Per-criterion results. */
  criteria_results?: Array<{
    id: string;
    title: string;
    verdict: string;
    reasoning: string;
    flagged?: boolean | number | string;
    llm_flag_reason?: string;
    flag_basis?: string;
    contested?: boolean | number | string;
  }>;
}

/**
 * A single StakworkRun row representing a workflow benchmark run.
 */
export interface WorkflowBenchmarkRunRow {
  id: string;
  workspaceId: string;
  type: StakworkRunType;
  status: WorkflowStatus;
  projectId: number | null;
  result: WorkflowBenchmarkRunResult | null;
  createdAt: string | Date;
  updatedAt: string | Date;
}

/** Operator-facing status derived from a single run. */
export type WorkflowBenchmarkPipelineStatus = "running" | "complete" | "failed";

/**
 * Parse a StakworkRun.result JSON string into WorkflowBenchmarkRunResult.
 * Returns null if the string is absent or unparseable.
 */
export function parseWorkflowBenchmarkRunResult(
  result: string | null | undefined,
): WorkflowBenchmarkRunResult | null {
  if (!result) return null;
  try {
    return JSON.parse(result) as WorkflowBenchmarkRunResult;
  } catch {
    return null;
  }
}

/**
 * Derive pipeline status from run status.
 */
export function deriveWorkflowBenchmarkStatus(
  runStatus: WorkflowStatus,
): WorkflowBenchmarkPipelineStatus {
  if (runStatus === WorkflowStatus.FAILED) return "failed";
  if (runStatus === WorkflowStatus.COMPLETED) return "complete";
  return "running";
}

/**
 * Whether a result is from the wfbench/ domain.
 * Used by the Runs tab to filter out runs from other benchmark domains
 * on the shared BENCHMARK_RUNNER type.
 */
export function isWorkflowBenchmarkSlug(slug: string | undefined | null): boolean {
  return typeof slug === "string" && slug.startsWith("wfbench/");
}
