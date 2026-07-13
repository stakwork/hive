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

export interface RubricScore {
  criterion: string;
  pass: boolean;
  notes: string;
}

/**
 * A proposed fix for a failing criterion in a legal benchmark run.
 * Read from `ProposedFix` graph nodes written by M3 after a run completes.
 *
 * `prompt_version_id` — the OLD/failing prompt version (display-only).
 * `new_prompt_version_id` — the NEW, not-yet-published fix version
 *   (reserved for future publish wiring — not used in this v1).
 */
export interface ProposedFix {
  /** Graph node ref_id — always present on a projected node */
  ref_id?: string;
  /** ID of the evaluation criterion this fix targets */
  criterion_id?: string;
  /** Human-readable criterion title */
  criterion_title?: string;
  /** Name of the prompt being fixed */
  prompt_name?: string;
  /** ID of the prompt being fixed */
  prompt_id?: string;
  /** Old/failing prompt version (display-only) */
  prompt_version_id?: string;
  /** New, not-yet-published fix version (reserved for future publish wiring) */
  new_prompt_version_id?: string;
  /** The value that caused failure */
  failing_value?: string;
  /** The value that would have passed */
  passing_value?: string;
  /** Description of the change between the old and new prompt version */
  delta?: string;
  /** Model reasoning behind the proposed fix */
  reasoning?: string;
  /** Proposal status (e.g. "pending", "accepted", "rejected") */
  status?: string;
  /** Status of the automated rerun using the new prompt version */
  rerun_status?: string;
  /** Score before the fix (stringified number) */
  before_score?: string;
  /** Score after the fix (stringified number) */
  after_score?: string;
  /** Score delta, e.g. "+4" or "-2" */
  score_delta?: string;
  /** Run ID of the automated rerun that validated this fix */
  rerun_run_id?: string;
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
