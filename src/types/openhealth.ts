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
