import type { StrutRunStatus } from "@prisma/client";

export type OpenHealthSplit = "public" | "heldout";
export type OpenHealthDifficulty = "easy" | "medium" | "hard";

/** A benchmark task, as strut's workflows name it (`input.task`). */
export type OpenHealthBenchmarkTask = "patient_diagnosis" | "context_summarization";

/**
 * A summarization row's variant: the whole patient, or one specialty's view
 * of the chart (where the right answer may be to abstain). Diagnosis rows
 * have none.
 */
export type OpenHealthVariant = "unconditioned" | "specialty_conditioned";

/** What the page offers: a task, and for summarization its variant. */
export interface OpenHealthBenchmark {
  task: OpenHealthBenchmarkTask;
  variant: OpenHealthVariant | null;
}

/** One benchmark task (a patient, or one specialty's view of one), as `openhealth-list-tasks` returns it. */
export interface OpenHealthTask {
  /** The task id — what a run is launched with. */
  gtId: number;
  patientId: number;
  difficulty: OpenHealthDifficulty;
  split: string;
  age: number | null;
  sex: "F" | "M" | null;
  numEncounters: number | null;
  task: OpenHealthBenchmarkTask;
  variant: OpenHealthVariant | null;
  /** The specialty of a specialty-conditioned summary, e.g. "Cardiology". */
  specialty: string | null;
  clinicalQuestion: string | null;
}

export interface OpenHealthTaskList {
  split: OpenHealthSplit;
  task: OpenHealthBenchmarkTask;
  variant: OpenHealthVariant | null;
  total: number;
  byDifficulty: Record<OpenHealthDifficulty, number>;
  tasks: OpenHealthTask[];
}

export type OpenHealthOutcome = "running" | "succeeded" | "failed" | "cancelled";

export interface OpenHealthScores {
  /**
   * Headline score, 0–1: the paper's primary metric for the task. Named
   * `f1` because every task's headline is an F1 (weighted F1 for
   * diagnosis, clinical F1 for a summary, conditioned F1 for a specialty
   * summary) but one: an absent specialty's abstention accuracy, 1 or 0.
   * Since workflow v12 it is the ADJUSTED score: answer-key items with an
   * accepted contest are excluded from it.
   */
  f1: number;
  /** The metric `f1` is: `weighted_problem_list_f1_neutral`, `clinical_f1`, `conditioned_f1`, `abstention_accuracy`. */
  metric: string;
  /** The untouched benchmark score; null when the workflow did not report one (before v12). */
  official: number | null;
  /** Answer-key items excluded from `f1` as contested; `official` scores them. */
  contested: number;
  recall: number | null;
  precision: number | null;
  tier: string | null;
  nMatched: number | null;
  nGt: number | null;
  nPred: number | null;
}

/** One run, as the runs list shows it. */
export interface OpenHealthRun {
  id: string;
  strutRunId: string | null;
  status: StrutRunStatus;
  outcome: OpenHealthOutcome;
  gtId: number | null;
  patientId: number | null;
  difficulty: OpenHealthDifficulty | null;
  task: OpenHealthBenchmarkTask;
  variant: OpenHealthVariant | null;
  specialty: string | null;
  scores: OpenHealthScores | null;
  /** USD: the produce agent plus every ingested section. */
  costUsd: number | null;
  durationMs: number | null;
  error: string | null;
  createdAt: string;
  settledAt: string | null;
}

export interface OpenHealthIngestedSection {
  file: string;
  needed: boolean | null;
  cost: number | null;
  steps: number | null;
  error: string | null;
}

export type OpenHealthArtifactName = "problem-list" | "summary" | "timeline" | "checklist";

/**
 * One answer-key item excluded from a run's score: an improve run showed
 * the chart contradicts it, and the graph holds it as an `EvalRequirement`
 * with `contested: true` under the task's EvalSet.
 */
export interface OpenHealthContest {
  /** The EvalRequirement's id: `<evalsetId>-contested-<list>-<slug>`. */
  id: string | null;
  /** The EvalRequirement node, for a link to the graph. */
  refId: string | null;
  /** The answer-key item, as the gold names it. */
  name: string;
  /** The gold list it sits in: `must_include_findings`, `diagnoses`, … */
  list: string | null;
  icd10: string | null;
  /** Why the chart contradicts it, and who contested it. */
  reason: string | null;
  /** Verbatim quotes from the chart and the gold. */
  evidence: string[];
}

/** A contest the workflow's checks refused (a quote that is not in the chart); it never affects a score. */
export interface OpenHealthContestRejected {
  /** The scoring error it was raised for, or the item's name. */
  error: string;
  reason: string | null;
}

/** A run with everything its viewer shows. */
export interface OpenHealthRunDetail extends OpenHealthRun {
  title: string | null;
  namespace: string | null;
  clinicalQuestion: string | null;
  /** Diagnosis: the model's code and the answer-key code it matched. */
  matched: Array<{ pred: string; gt: string }>;
  /** Answer-key items the run did not produce: codes for diagnosis, finding names for a summary. */
  missed: string[];
  /** Diagnosis: codes that matched nothing. Specialty summary: off-specialty findings it leaked. */
  extra: string[];
  /** Summary: the must-include findings the summary named. */
  found: string[];
  /** Summary: its length, the covariate the recall-only metric needs beside it. */
  summaryWords: number | null;
  /**
   * Specialty summary: how many critical findings the answer key holds. The
   * paper's scorer gives an involved specialty with none a 0 whatever the
   * summary says, so the viewer flags those.
   */
  criticalCount: number | null;
  /** Every metric the scorer computed, by its name. */
  metrics: Record<string, number>;
  chart: {
    chartChars: number | null;
    sectionCount: number | null;
    sectionsIngested: number | null;
    sectionsFailed: string[];
    encounterCount: number | null;
    withheldSections: string[];
  } | null;
  ingested: OpenHealthIngestedSection[];
  /** Answer-key items excluded from the score; `scores.contested` counts them. */
  contested: OpenHealthContest[];
  /** Contests recorded against the task that did not pass the workflow's checks. */
  contestsRejected: OpenHealthContestRejected[];
  produceCost: number | null;
  produceSteps: number | null;
  spreadsheetUrl: string | null;
}

/**
 * What the graph answered for a Concept the improve run wrote: `created`,
 * `existed` (the edge to its parent was already there), or `failed`.
 */
export type OpenHealthConceptWrite = "created" | "existed" | "failed";

/** One Concept the improve run proposed, after the workflow's own validation. */
export interface OpenHealthConceptProposal {
  /** `create` hangs a new Concept under `parent`; `amend` rewrites an existing one. */
  action: "create" | "amend";
  name: string;
  parent: string | null;
  description: string | null;
  /** Markdown: the new Concept's docs, or the replacement docs of an amend. */
  docs: string | null;
  rationale: string | null;
  /** The scoring errors it would fix, e.g. "missed P011". */
  addresses: string[];
  /** Null when the run reports no write for it: an amend, or a run that did not apply. */
  write: OpenHealthConceptWrite | null;
  writeError: string | null;
}

/** One `openhealth-improve` run over a benchmark run. */
export interface OpenHealthImprovement {
  id: string;
  strutRunId: string | null;
  outcome: OpenHealthOutcome;
  /** Did the run write its new Concepts to the graph? */
  applied: boolean;
  summary: string | null;
  /** Scoring errors the run looked at; null when it did not report them. */
  errorCount: number | null;
  proposals: OpenHealthConceptProposal[];
  /** Proposals the workflow's validation refused, with why. */
  rejected: Array<{ name: string; reasons: string[] }>;
  /** Errors the run left alone, with why. */
  notAddressed: Array<{ error: string; reason: string }>;
  /**
   * Answer-key items the run contested and the graph recorded: the chart
   * contradicts them, and they are excluded from the score from the next
   * run on. Empty when the run did not apply.
   */
  contestsAccepted: OpenHealthContest[];
  /** Contests the workflow's checks refused. */
  contestsRejected: OpenHealthContestRejected[];
  durationMs: number | null;
  error: string | null;
  createdAt: string;
  settledAt: string | null;
}

export interface OpenHealthImproveResponse {
  /** Newest first. */
  improvements: OpenHealthImprovement[];
}

export type OpenHealthStageStatus = "pending" | "running" | "done" | "failed";

export interface OpenHealthStage {
  key: string;
  label: string;
  status: OpenHealthStageStatus;
  /** Ingest only: sections finished, of how many. */
  done?: number;
  total?: number;
}

export interface OpenHealthRunsResponse {
  runs: OpenHealthRun[];
}

export interface OpenHealthProgressResponse {
  stages: OpenHealthStage[];
}

// ─── Climbs ──────────────────────────────────────────────────────────────

/** Where a climb stands: running, or how it ended. */
export type OpenHealthClimbStatus = "running" | "reached" | "exhausted" | "stopped" | "failed";

/**
 * One step of a climb: a benchmark run (an attempt), or the improve run
 * after one. The loop is one strut run and its steps are subflows of it, so
 * no step has a run of its own; a step is addressed by its iteration.
 */
export interface OpenHealthClimbStep {
  kind: "benchmark" | "improve";
  /** The iteration this step belongs to, from 0. Attempt = iteration + 1. */
  iteration: number;
  outcome: OpenHealthOutcome;
  /** Benchmark: the headline score once scored (see `OpenHealthScores.f1`) — adjusted, contested items excluded. */
  f1: number | null;
  /** Benchmark: the metric `f1` is, when the loop reports it. */
  metric: string | null;
  /** Benchmark: the untouched score, when the loop reports one. */
  f1Official: number | null;
  /** Benchmark: answer-key items excluded from `f1` as contested, by name. */
  contested: string[];
  /** Benchmark: its recall and precision, when the loop's event log reports them (the recorded history does not). */
  recall: number | null;
  precision: number | null;
  /** Benchmark: did this run raise the climb's best so far? */
  newBest: boolean;
  /** Benchmark: answer-key items the run missed, and extras it added (codes, or finding names). */
  missed: string[];
  extra: string[];
  /** Benchmark: USD, when the loop's event log reports it (the output does not). */
  costUsd: number | null;
  /** Benchmark in flight: its stages. */
  stages: OpenHealthStage[] | null;
  /** Improve: did it write to the graph? */
  applied: boolean;
  /** Improve: the Concepts it created, amended, and refused — by name. */
  created: string[];
  amended: string[];
  rejected: string[];
  /** Improve: answer-key items it contested and the graph recorded — excluded from the next run on. */
  contestsAccepted: string[];
  /** Improve: contests the workflow's checks refused. */
  contestsRejected: OpenHealthContestRejected[];
  summary: string | null;
  startedAt: string | null;
  error: string | null;
}

/** One climb, as the page shows it: its rules, where it stands, and its steps oldest first. */
export interface OpenHealthClimb {
  id: string;
  strutRunId: string | null;
  /** Null only for a row launched without a task, which Hive never does. */
  gtId: number | null;
  difficulty: OpenHealthDifficulty | null;
  task: OpenHealthBenchmarkTask;
  variant: OpenHealthVariant | null;
  specialty: string | null;
  status: OpenHealthClimbStatus;
  /** Why it ended, in words; null while it runs. */
  stopReason: string | null;
  /** The score the loop stops at (see `OpenHealthScores.f1` for the name). */
  targetF1: number;
  /** Benchmark runs at most; improve runs happen between them. */
  maxRuns: number;
  /** Benchmark runs started so far, the one in flight included. */
  attempts: number;
  /** The first attempt's score. */
  startF1: number | null;
  bestF1: number | null;
  /** The best attempt's untouched score, when the loop reports one. */
  bestF1Official: number | null;
  /** The best attempt's recall and precision, when known. */
  bestRecall: number | null;
  bestPrecision: number | null;
  /** The newest scored attempt's score. */
  latestF1: number | null;
  /** The iteration that scored best. */
  bestIteration: number | null;
  /** USD over the benchmark runs that reported a cost; null when none did. */
  costUsd: number | null;
  /** Every answer-key item contested over the climb, by name: excluded from its runs' scores or accepted by its improve runs. */
  contested: string[];
  steps: OpenHealthClimbStep[];
  durationMs: number | null;
  error: string | null;
  createdAt: string;
  settledAt: string | null;
}

export interface OpenHealthClimbsResponse {
  /** Newest first. */
  climbs: OpenHealthClimb[];
}
