import { WorkflowStatus, StakworkRunType } from "@prisma/client";

/**
 * Parsed contents of a benchmark run's `result` JSON column on StakworkRun.
 * Both runner and scorer rows store these fields (scorer omits runnerProjectId).
 */
export interface BenchmarkRunResult {
  taskSlug: string;
  taskTitle: string;
  /** ID of the paired runner/scorer StakworkRun row */
  siblingRunId: string;
  /** Jarvis EvalTrigger node ref — set after non-fatal Jarvis instrumentation */
  evalTriggerRef?: string;
  /** Project ID returned by Stakwork on runner dispatch */
  runnerProjectId?: number;
  /** S3 URL of the runner's output document */
  runnerOutputUrl?: string;
  /** Plain-text runner output */
  runnerOutputText?: string;
  /** Serialised RubricScore[] from the scorer */
  scoreJson?: string;
  /** Error message if the run failed */
  errorMessage?: string;
}

/**
 * A single StakworkRun row representing one side of a benchmark pipeline pair.
 */
export interface BenchmarkRunRow {
  id: string;
  workspaceId: string;
  type: StakworkRunType;
  status: WorkflowStatus;
  projectId: number | null;
  result: BenchmarkRunResult | null;
  createdAt: string | Date;
  updatedAt: string | Date;
}

/**
 * Operator-facing composite status derived from the runner+scorer pair.
 * running  — runner PENDING/IN_PROGRESS
 * scoring  — runner COMPLETED + scorer PENDING/IN_PROGRESS
 * complete — scorer COMPLETED
 * failed   — either row FAILED
 */
export type BenchmarkPipelineStatus = "running" | "scoring" | "complete" | "failed";

/**
 * The paired view of a benchmark pipeline (runner + scorer rows).
 * Provides convenience accessors for fields the UI expects.
 */
export interface LegalBenchmarkRun {
  /** Primary tracking id — the runner row's id */
  id: string;
  workspaceId: string;
  taskSlug: string;
  taskTitle: string;
  /** Composite operator-facing status */
  status: BenchmarkPipelineStatus;
  runnerRun: BenchmarkRunRow;
  scorerRun: BenchmarkRunRow | null;
  /** Convenience access to runner output fields (read from runnerRun.result) */
  runnerOutputUrl: string | null;
  runnerOutputText: string | null;
  /** Convenience access to scorer output (read from scorerRun.result) */
  scoreJson: string | null;
  errorMessage: string | null;
  createdAt: string | Date;
  updatedAt: string | Date;
}

export interface RubricScore {
  criterion: string;
  pass: boolean;
  notes: string;
}

/**
 * Parse a StakworkRun.result JSON string into BenchmarkRunResult.
 * Returns null if the string is absent or unparseable.
 */
export function parseBenchmarkRunResult(result: string | null | undefined): BenchmarkRunResult | null {
  if (!result) return null;
  try {
    return JSON.parse(result) as BenchmarkRunResult;
  } catch {
    return null;
  }
}

/**
 * Derive the composite pipeline status from a runner+scorer pair.
 */
export function deriveBenchmarkStatus(
  runnerStatus: WorkflowStatus,
  scorerStatus: WorkflowStatus | undefined,
): BenchmarkPipelineStatus {
  if (runnerStatus === WorkflowStatus.FAILED) return "failed";
  if (scorerStatus === WorkflowStatus.FAILED) return "failed";
  if (scorerStatus === WorkflowStatus.COMPLETED) return "complete";
  if (
    runnerStatus === WorkflowStatus.COMPLETED &&
    (scorerStatus === WorkflowStatus.PENDING || scorerStatus === WorkflowStatus.IN_PROGRESS)
  ) {
    return "scoring";
  }
  return "running";
}
