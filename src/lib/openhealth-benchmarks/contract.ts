/**
 * Pinned contract for the `openhealth-run` / `openhealth-list-tasks` strut
 * workflows on the hive workspace's own swarm.
 *
 * This is the SINGLE SOURCE OF TRUTH for field names, step ids, and input/
 * output shapes. Every route, the run-summary projection, and the UI import
 * these names instead of hardcoding strings — so a field rename on the
 * strut side is a one-file change here, not a grep-and-replace.
 *
 * Taken from the live `openhealth-run` / `openhealth-list-tasks` workflow
 * definitions on the hive swarm and the on-disk `run.json` shapes those
 * workflows produce. The LEGACY shape (below) is what runs launched through
 * the old Hive route (`{ task, split, gtId, patientId }` input, no
 * `workdir`) still carry — those runs already executed against this same
 * strut, so their history must keep rendering once Hive stops writing its
 * own StakworkRun rows.
 */

import type { OpenHealthSplit } from "./constants";
import { OPENHEALTH_LIST_TASKS_WORKFLOW } from "./constants";

// ── Workflow names ──────────────────────────────────────────────────────────

/** Default `openhealth-run` workflow name — overridable via env (kept). */
export const OPENHEALTH_DEFAULT_RUN_WORKFLOW = "openhealth-run";

/**
 * The read-only task-list workflow. Fixed — no env override. Defined in
 * `constants.ts` (the ticket's canonical home for it) and re-exported here
 * so callers can import either the contract or the constants module.
 */
export { OPENHEALTH_LIST_TASKS_WORKFLOW };

// ── Run input ────────────────────────────────────────────────────────────────

/** Current `openhealth-run` input contract. */
export interface OpenHealthRunInput {
  /** Native type as carried by the cached task row — string or number. */
  gtId: string | number;
  /** `"gt-" + <validated gtId>` — never anything the caller supplied directly. */
  workdir: string;
}

/**
 * Legacy input shape, from runs dispatched by the old (pre-strut-rebuild)
 * `run` route. Still appears in run history — `normalizeGtId` and every
 * caller that reads `input.gtId` must tolerate it.
 */
export interface OpenHealthLegacyRunInput {
  task?: string;
  split?: string;
  gtId?: string | number;
  patientId?: string;
}

// ── Run output field names ──────────────────────────────────────────────────

/** Output field names on a terminal `openhealth-run` summary. */
export const OPENHEALTH_OUTPUT_FIELDS = {
  /** Headline F1 score. */
  f1: "weighted_problem_list_f1_neutral",
  recall: "problem_list_recall",
  precision: "problem_list_precision_neutral",
  tier: "tier",
  matched: "matched",
  missed: "missed",
  extra: "extra",
  sectionsFailed: "sectionsFailed",
  problemList: "problemList",
  produceCost: "produceCost",
  /** Array of `{ cost, ... }` — summed into the run's ingest cost. */
  ingested: "ingested",
  /** Present (non-null) when scoring itself failed on an otherwise-terminal run. */
  gradeError: "gradeError",
} as const;

/**
 * Legacy-only output field. Runs dispatched by the old route surface a
 * produce-stage failure under this key instead of `gradeError` — both are
 * treated as `failed` by `deriveOutcome`.
 */
export const OPENHEALTH_LEGACY_OUTPUT_FIELDS = {
  produceError: "produceError",
} as const;

/** One ingest-cost entry inside `output.ingested[]`. */
export interface OpenHealthIngestedCost {
  cost?: number;
  [key: string]: unknown;
}

/** The shape `projectRunSummary` reads from `output` before allowlisting. */
export interface OpenHealthRunOutput {
  [OPENHEALTH_OUTPUT_FIELDS.f1]?: number;
  [OPENHEALTH_OUTPUT_FIELDS.recall]?: number;
  [OPENHEALTH_OUTPUT_FIELDS.precision]?: number;
  [OPENHEALTH_OUTPUT_FIELDS.tier]?: string;
  [OPENHEALTH_OUTPUT_FIELDS.matched]?: unknown[];
  [OPENHEALTH_OUTPUT_FIELDS.missed]?: unknown[];
  [OPENHEALTH_OUTPUT_FIELDS.extra]?: unknown[];
  [OPENHEALTH_OUTPUT_FIELDS.sectionsFailed]?: unknown[];
  [OPENHEALTH_OUTPUT_FIELDS.problemList]?: unknown[];
  [OPENHEALTH_OUTPUT_FIELDS.produceCost]?: number;
  [OPENHEALTH_OUTPUT_FIELDS.ingested]?: OpenHealthIngestedCost[];
  [OPENHEALTH_OUTPUT_FIELDS.gradeError]?: string | null;
  [OPENHEALTH_LEGACY_OUTPUT_FIELDS.produceError]?: string | null;
  /** Legacy runs may carry `gtId` only on `output`, not `input`. */
  gtId?: string | number;
  /** The Sheet field — see below. */
  [key: string]: unknown;
}

// ── The Sheet field ──────────────────────────────────────────────────────────

/** Key on `output` carrying the results Sheet, in one of two forms. */
export const OPENHEALTH_SHEET_FIELD = "sheet";

/**
 * `artifact` — a path under the run's workdir, served through
 * `runs/[runId]/sheet` (the server rebuilds the path from an allowlisted
 * basename; the client never supplies one).
 * `url` — an external `https:` URL, passed through in `projectRunSummary`
 * with no proxy route.
 */
export type OpenHealthSheetForm =
  | { kind: "artifact"; path: string }
  | { kind: "url"; url: string };

/** The one allowlisted Sheet artifact basename, relative to the run's workdir. */
export const OPENHEALTH_SHEET_ARTIFACT_BASENAME = "spreadsheet.md";

// ── Stages & step ids ────────────────────────────────────────────────────────

export const OPENHEALTH_STAGES = ["task", "ingest", "produce", "scored", "result"] as const;
export type OpenHealthStage = (typeof OPENHEALTH_STAGES)[number];

/** Top-level strut step ids that map to each stage, in order. */
export const OPENHEALTH_STEP_IDS: Record<OpenHealthStage, string> = {
  task: "task",
  ingest: "ingest",
  produce: "produce",
  scored: "scored",
  result: "result",
};

/** `stepId -> stage` reverse lookup. */
export const OPENHEALTH_STEP_TO_STAGE: Record<string, OpenHealthStage> = Object.fromEntries(
  OPENHEALTH_STAGES.map((stage) => [OPENHEALTH_STEP_IDS[stage], stage]),
) as Record<string, OpenHealthStage>;

// ── list-tasks input & row shape ─────────────────────────────────────────────

export interface OpenHealthListTasksInput {
  split: OpenHealthSplit;
  /** Present only on a difficulty-filtered refresh — never the split cache. */
  difficulty?: string;
}

/** Key on a terminal `openhealth-list-tasks` run's `output` holding the task rows. */
export const OPENHEALTH_LIST_TASKS_OUTPUT_FIELD = "tasks";

/** Raw upstream task row, before `projectTaskRow` allowlists it. */
export interface OpenHealthRawTaskRow {
  gtId?: string | number;
  gt_id?: string | number;
  split?: string;
  difficulty?: string | null;
  patientId?: string | null;
  patient_id?: string | null;
  title?: string | null;
  [key: string]: unknown;
}

/** The allowlisted shape a task row may carry to the client. */
export interface OpenHealthTaskRow {
  gtId: string;
  split: OpenHealthSplit;
  difficulty: string | null;
  patientId?: string | null;
  title?: string | null;
}
