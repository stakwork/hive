import type { StrutRunStatus } from "@prisma/client";

export type OpenHealthSplit = "public" | "heldout";
export type OpenHealthDifficulty = "easy" | "medium" | "hard";

/** One benchmark task (a patient), as `openhealth-list-tasks` returns it. */
export interface OpenHealthTask {
  /** The task id — what a run is launched with. */
  gtId: number;
  patientId: number;
  difficulty: OpenHealthDifficulty;
  split: string;
  age: number | null;
  sex: "F" | "M" | null;
  numEncounters: number | null;
}

export interface OpenHealthTaskList {
  split: OpenHealthSplit;
  total: number;
  byDifficulty: Record<OpenHealthDifficulty, number>;
  tasks: OpenHealthTask[];
}

export type OpenHealthOutcome = "running" | "succeeded" | "failed" | "cancelled";

export interface OpenHealthScores {
  /** Headline score: weighted F1, 0–1. */
  f1: number;
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

export type OpenHealthArtifactName = "problem-list" | "timeline" | "checklist";

/** A run with everything its viewer shows. */
export interface OpenHealthRunDetail extends OpenHealthRun {
  title: string | null;
  namespace: string | null;
  matched: Array<{ pred: string; gt: string }>;
  missed: string[];
  extra: string[];
  chart: {
    chartChars: number | null;
    sectionCount: number | null;
    sectionsIngested: number | null;
    sectionsFailed: string[];
    encounterCount: number | null;
    withheldSections: string[];
  } | null;
  ingested: OpenHealthIngestedSection[];
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
  durationMs: number | null;
  error: string | null;
  createdAt: string;
  settledAt: string | null;
}

export interface OpenHealthImproveResponse {
  /** Newest first. */
  improvements: OpenHealthImprovement[];
}

// ─── Climbs ──────────────────────────────────────────────────────────────

/** Lower-case `OpenHealthClimbStatus` from the schema. */
export type OpenHealthClimbStatus = "running" | "reached" | "exhausted" | "stalled" | "stopped" | "failed";

/** One step of a climb: a benchmark run (an attempt), or the improve run after one. */
export interface OpenHealthClimbStep {
  /** The `StrutRun` id on hive — a benchmark step opens in the run viewer. */
  runId: string;
  kind: "benchmark" | "improve";
  /** The attempt this step is (benchmark) or follows (improve), from 1. */
  attempt: number;
  outcome: OpenHealthOutcome;
  /** Benchmark: the run's weighted F1 once scored. */
  f1: number | null;
  /** Benchmark: did this run raise the climb's best so far? */
  newBest: boolean;
  /** Improve: new Concepts the run wrote to the graph. */
  created: number | null;
  /** Improve: existing Concepts it amended. */
  amended: number | null;
  costUsd: number | null;
  error: string | null;
  createdAt: string;
  settledAt: string | null;
}

/** One climb, as the page shows it: its rules, where it stands, and its steps oldest first. */
export interface OpenHealthClimb {
  id: string;
  gtId: number;
  status: OpenHealthClimbStatus;
  /** Why it ended; null while it runs. */
  stopReason: string | null;
  targetF1: number;
  maxAttempts: number;
  /** Benchmark runs launched or adopted so far. */
  attempts: number;
  /** The first attempt's F1 — the seed's, or attempt 1's once scored. */
  startF1: number | null;
  bestF1: number | null;
  /** The newest scored attempt's F1. */
  latestF1: number | null;
  /** The attempt that scored best — what "Climb again" starts from. */
  bestRunId: string | null;
  /** The step in flight, when one is. */
  currentRunId: string | null;
  /** USD over the benchmark runs; improve runs report no cost. */
  costUsd: number | null;
  steps: OpenHealthClimbStep[];
  createdAt: string;
  settledAt: string | null;
}

export interface OpenHealthClimbsResponse {
  /** Newest first. */
  climbs: OpenHealthClimb[];
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
