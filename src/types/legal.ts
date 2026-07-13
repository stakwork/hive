import { WorkflowStatus, StakworkRunType } from "@prisma/client";

/**
 * Parsed contents of a benchmark run's `result` JSON column on StakworkRun.
 * The single runner row stores these fields after the collapsed single-run pipeline.
 */
export interface BenchmarkRunResult {
  taskSlug: string;
  taskTitle: string;
  /** ID of the paired runner/scorer StakworkRun row — optional for legacy rows; new runs omit this */
  siblingRunId?: string;
  /** Jarvis EvalTrigger node ref — set after non-fatal Jarvis instrumentation */
  evalTriggerRef?: string;
  /** Whether the aggregate EvalTriggerOutput node has already been written (idempotency guard) */
  evalOutputWritten?: boolean;
  /** Project ID returned by Stakwork on runner dispatch */
  runnerProjectId?: number;
  /** S3 URL of the runner's output document */
  runnerOutputUrl?: string;
  /** Plain-text runner output */
  runnerOutputText?: string;
  /** Error message if the run failed */
  errorMessage?: string;
  // ── Flat score fields from the runner webhook (workflow 57179 inline eval) ──
  /** Raw score (e.g. 72) */
  score?: number;
  /** Maximum possible score (e.g. 74) */
  max_score?: number;
  /** Number of criteria that passed */
  n_passed?: number;
  /** Total number of criteria */
  n_total?: number;
  /** Pass rate as a fraction (0–1) */
  pass_rate?: number;
  /** Overall pass/fail result */
  all_pass?: boolean;
  /** S3 URL to per-criterion score breakdown (out of scope for v1 display) */
  scores_s3_url?: string;
  /** Name of the judge model used for evaluation */
  judge_model?: string;
  /** Per-criterion results returned inline by workflow 57179 */
  criteria_results?: Array<{
    id: string;
    title: string;
    /** Casing unverified from workflow 57179 — do not narrow to a union */
    verdict: string;
    reasoning: string;
    /** Root-cause fields annotated by LEGAL_BENCHMARK_EVAL webhook */
    cause_type?: string;
    cause_summary?: string;
    cause_detail?: string;
    suggested_fix?: string;
    log_evidence?: string;
    cause_ref_id?: string;
  }>;
}

/**
 * A single StakworkRun row representing a benchmark run.
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
 * Operator-facing status derived from a single runner run.
 * running  — PENDING/IN_PROGRESS
 * complete — COMPLETED
 * failed   — FAILED
 */
export type BenchmarkPipelineStatus = "running" | "complete" | "failed";

/**
 * The view of a benchmark run (single runner row).
 * Provides convenience accessors for fields the UI expects.
 */
export interface LegalBenchmarkRun {
  /** Primary tracking id — the runner row's id */
  id: string;
  workspaceId: string;
  taskSlug: string;
  taskTitle: string;
  /** Operator-facing status */
  status: BenchmarkPipelineStatus;
  runnerRun: BenchmarkRunRow;
  /** @deprecated — scorer is no longer created; always null for new runs */
  scorerRun: BenchmarkRunRow | null;
  /** Convenience access to runner output fields (read from runnerRun.result) */
  runnerOutputUrl: string | null;
  runnerOutputText: string | null;
  /** @deprecated — scoreJson is no longer populated; use flat score fields on runnerRun.result */
  scoreJson: string | null;
  errorMessage: string | null;
  createdAt: string | Date;
  updatedAt: string | Date;
}

/**
 * A `ProposedFix` graph node projected for client consumption.
 * Fetched from the Jarvis graph via `/api/workspaces/[slug]/legal/benchmarks/proposed-fixes`.
 *
 * `prompt_version_id` — the OLD/failing prompt version (display only).
 * `new_prompt_version_id` — the NEW unpublished fix version (reserved for future publish wiring).
 */
export interface ProposedFix {
  /** Graph node ref_id */
  ref_id?: string;
  criterion_id?: string;
  criterion_title?: string;
  prompt_name?: string;
  prompt_id?: string;
  /** The failing (old) prompt version — display only */
  prompt_version_id?: string;
  /** The new unpublished fix prompt version — reserved for future publish wiring */
  new_prompt_version_id?: string;
  failing_value?: string;
  passing_value?: string;
  delta?: string;
  reasoning?: string;
  status?: string;
  /** pending | running | improved | no_change | regressed | scored */
  rerun_status?: string;
  before_score?: string;
  after_score?: string;
  score_delta?: string;
  rerun_run_id?: string;
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
 * Derive the pipeline status from a single runner run status.
 *
 * @param runnerStatus - The runner run's WorkflowStatus.
 * @param _scorerStatus - Deprecated; ignored. Kept as an optional no-op param for
 *   backward compatibility while the hook is updated in T2. Remove once T2 lands.
 */
export function deriveBenchmarkStatus(
  runnerStatus: WorkflowStatus,
  _scorerStatus?: WorkflowStatus,
): BenchmarkPipelineStatus {
  if (runnerStatus === WorkflowStatus.FAILED) return "failed";
  if (runnerStatus === WorkflowStatus.COMPLETED) return "complete";
  return "running";
}
