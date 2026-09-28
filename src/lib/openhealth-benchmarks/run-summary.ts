/**
 * Pure projection & aggregation logic for OpenHealth benchmark runs and
 * task rows. Nothing here makes a network or DB call — every function is a
 * plain transform over a strut run/list summary, so it can be unit tested
 * with plain fixtures (`src/__tests__/fixtures/openhealth-strut.ts`).
 *
 * `projectRunSummary` and `projectTaskRow` are the ONLY places the
 * gold-shaped fields (`ground_truth`, `groundTruth`, `gold`, `problemList`
 * as an input key, raw paths, `callback`/`run_token`, `actor`, `outputDir`,
 * `transcript`) are guaranteed to be dropped: both are POSITIVE allowlists
 * — everything not explicitly copied out is discarded, so a new leaky field
 * added upstream is safe-by-default rather than leaked-by-default.
 */
import {
  OPENHEALTH_OUTPUT_FIELDS,
  OPENHEALTH_LEGACY_OUTPUT_FIELDS,
  OPENHEALTH_SHEET_FIELD,
  OPENHEALTH_STAGES,
  OPENHEALTH_STEP_IDS,
  OPENHEALTH_STEP_TO_STAGE,
  type OpenHealthStage,
  type OpenHealthRawTaskRow,
  type OpenHealthTaskRow,
} from "./contract";
import { isOpenHealthSplit } from "./constants";

export type { OpenHealthTaskRow };

// ── shared small helpers ─────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function arrayOrEmpty(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** The minimal shape every function here reads from — a strut run summary. */
export interface OpenHealthRunLike {
  status?: string;
  input?: Record<string, unknown>;
  output?: Record<string, unknown>;
}

// ── gtId normalization ───────────────────────────────────────────────────────

/**
 * `String(input.gtId ?? output.gtId ?? "")`, or `null` if empty — so
 * numeric (`7013`), string (`"7013"`), and legacy `input: {}` runs (where
 * `gtId` appears only under `output.gtId`) all normalize to the same key.
 * Every comparison and every `taskStats` map key goes through this — never
 * compare `input.gtId` directly.
 */
export function normalizeGtId(run: OpenHealthRunLike): string | null {
  const raw = run.input?.gtId ?? run.output?.gtId ?? "";
  const s = String(raw ?? "");
  return s.length > 0 ? s : null;
}

// ── outcome ──────────────────────────────────────────────────────────────────

export type OpenHealthOutcome = "success" | "failed" | "cancelled" | "running";

const RUNNING_STATUSES = new Set(["running", "pausing", "paused", "cancelling"]);

/**
 * `failed` for `error`/`stale` status OR a terminal `gradeError`/
 * `produceError` on `output` (a run can report `status: "success"` and
 * still have failed to grade — that must never count as a pass).
 * `cancelled` for `status === "cancelled"`.
 * `running` for the live statuses, OR a MISSING status (a strut summary
 * with no status yet is in flight, not failed).
 * Otherwise `success`.
 */
export function deriveOutcome(run: OpenHealthRunLike): OpenHealthOutcome {
  const status = run.status;
  const output = run.output ?? {};
  const hasGradeError = output[OPENHEALTH_OUTPUT_FIELDS.gradeError] != null;
  const hasProduceError = output[OPENHEALTH_LEGACY_OUTPUT_FIELDS.produceError] != null;

  if (status === "error" || status === "stale" || hasGradeError || hasProduceError) {
    return "failed";
  }
  if (status === "cancelled") {
    return "cancelled";
  }
  if (status == null || RUNNING_STATUSES.has(status)) {
    return "running";
  }
  return "success";
}

// ── cost & duration ──────────────────────────────────────────────────────────

/** `output.produceCost + Σ output.ingested[].cost`. Missing fields count as 0. */
export function runCost(run: OpenHealthRunLike): number {
  const output = run.output ?? {};
  const produceCost = numberOrNull(output[OPENHEALTH_OUTPUT_FIELDS.produceCost]) ?? 0;
  const ingested = arrayOrEmpty(output[OPENHEALTH_OUTPUT_FIELDS.ingested]);
  const ingestSum = ingested.reduce((sum: number, item) => {
    const cost = isRecord(item) ? numberOrNull(item.cost) : null;
    return sum + (cost ?? 0);
  }, 0);
  return produceCost + ingestSum;
}

/** `finishedAt - startedAt` in ms, or `null` when either is missing/unparseable. */
export function runDuration(run: { startedAt?: string | null; finishedAt?: string | null }): number | null {
  if (!run.startedAt || !run.finishedAt) return null;
  const start = new Date(run.startedAt).getTime();
  const end = new Date(run.finishedAt).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return null;
  return end - start;
}

// ── F1 (current field, with a legacy fallback) ───────────────────────────────

/**
 * A very old run may not carry the current field name
 * (`weighted_problem_list_f1_neutral`) at all — read a bare `f1` key as a
 * fallback so ancient history still contributes a score instead of
 * silently dropping out of the mean.
 */
const LEGACY_F1_FIELD = "f1";

function readF1(output: Record<string, unknown>): number | null {
  return numberOrNull(output[OPENHEALTH_OUTPUT_FIELDS.f1]) ?? numberOrNull(output[LEGACY_F1_FIELD]);
}

// ── summarizeRuns ────────────────────────────────────────────────────────────

export interface OpenHealthRunsSummary {
  /** succeeded / (succeeded + failed). `null` when that denominator is 0. */
  successRate: number | null;
  /** Mean F1 over successful runs only. `null` when there are none. */
  meanF1: number | null;
  succeeded: number;
  failed: number;
  cancelled: number;
  running: number;
  total: number;
}

/**
 * Success rate = succeeded / (succeeded + failed). Running and cancelled
 * runs are excluded from BOTH the numerator and the denominator — they are
 * not yet a verdict on the case.
 */
export function summarizeRuns(runs: OpenHealthRunLike[]): OpenHealthRunsSummary {
  let succeeded = 0;
  let failed = 0;
  let cancelled = 0;
  let running = 0;
  const f1s: number[] = [];

  for (const run of runs) {
    const outcome = deriveOutcome(run);
    if (outcome === "success") {
      succeeded += 1;
      const f1 = readF1(run.output ?? {});
      if (f1 != null) f1s.push(f1);
    } else if (outcome === "failed") {
      failed += 1;
    } else if (outcome === "cancelled") {
      cancelled += 1;
    } else {
      running += 1;
    }
  }

  const denom = succeeded + failed;
  return {
    successRate: denom > 0 ? succeeded / denom : null,
    meanF1: f1s.length > 0 ? f1s.reduce((a, b) => a + b, 0) / f1s.length : null,
    succeeded,
    failed,
    cancelled,
    running,
    total: runs.length,
  };
}

// ── taskStats ────────────────────────────────────────────────────────────────

export interface OpenHealthTaskStat {
  attempts: number;
  bestF1: number | null;
}

/** Attempts (any outcome) and best F1 (successful runs only) per normalised gtId. */
export function taskStats(runs: OpenHealthRunLike[]): Map<string, OpenHealthTaskStat> {
  const map = new Map<string, OpenHealthTaskStat>();
  for (const run of runs) {
    const gtId = normalizeGtId(run);
    if (gtId === null) continue;
    const entry = map.get(gtId) ?? { attempts: 0, bestF1: null };
    entry.attempts += 1;
    if (deriveOutcome(run) === "success") {
      const f1 = readF1(run.output ?? {});
      if (f1 != null && (entry.bestF1 === null || f1 > entry.bestF1)) {
        entry.bestF1 = f1;
      }
    }
    map.set(gtId, entry);
  }
  return map;
}

// ── stage mapping ────────────────────────────────────────────────────────────

/** The furthest of the five stages present in a set of step ids, task-first. */
export function stageFromSteps(stepIds: Iterable<string>): OpenHealthStage {
  const present = new Set(stepIds);
  let current: OpenHealthStage = OPENHEALTH_STAGES[0];
  for (const stage of OPENHEALTH_STAGES) {
    if (present.has(OPENHEALTH_STEP_IDS[stage])) current = stage;
  }
  return current;
}

/**
 * Map an upstream SSE event path (e.g. `/steps/task/step.end`) to a stage
 * by matching a path SEGMENT against a known step id — never a substring
 * match, so a step id that happens to be a prefix of another does not
 * misfire.
 */
export function stageFromPath(path: string): OpenHealthStage | null {
  const segments = path.split("/").filter(Boolean);
  for (const segment of segments) {
    const stage = OPENHEALTH_STEP_TO_STAGE[segment];
    if (stage) return stage;
  }
  return null;
}

// ── sheet resolution ─────────────────────────────────────────────────────────

interface SheetResolution {
  hasSheet: boolean;
  /** Only ever an `https:` URL — an artifact path is NEVER surfaced here. */
  sheetUrl: string | null;
}

function isHttpsUrl(value: unknown): value is string {
  return typeof value === "string" && /^https:\/\//i.test(value);
}

function resolveSheet(output: Record<string, unknown>): SheetResolution {
  const sheet = output[OPENHEALTH_SHEET_FIELD];
  if (sheet == null) return { hasSheet: false, sheetUrl: null };
  if (typeof sheet === "string") {
    return { hasSheet: true, sheetUrl: isHttpsUrl(sheet) ? sheet : null };
  }
  if (isRecord(sheet)) {
    if (isHttpsUrl(sheet.url)) return { hasSheet: true, sheetUrl: sheet.url };
    if (typeof sheet.path === "string" && sheet.path.length > 0) {
      return { hasSheet: true, sheetUrl: null };
    }
  }
  return { hasSheet: false, sheetUrl: null };
}

function extractErrorMessage(error: unknown): string | null {
  if (typeof error === "string" && error.length > 0) return error;
  if (isRecord(error) && typeof error.message === "string" && error.message.length > 0) {
    return error.message;
  }
  return null;
}

// ── projectRunSummary ────────────────────────────────────────────────────────

export interface ProjectedRunSummary {
  runId: string;
  status: string | null;
  outcome: OpenHealthOutcome;
  startedAt: string | null;
  finishedAt: string | null;
  gtId: string | null;
  stage: OpenHealthStage;
  f1: number | null;
  recall: number | null;
  precision: number | null;
  tier: string | null;
  cost: number;
  durationMs: number | null;
  matched: unknown[];
  missed: unknown[];
  extra: unknown[];
  matchedCount: number;
  missedCount: number;
  extraCount: number;
  problemList: unknown[];
  sectionsFailed: unknown[];
  error: { message: string } | null;
  hasSheet: boolean;
  sheetUrl: string | null;
}

/**
 * The one allowlist that turns a raw strut run envelope into something safe
 * to send to the browser. Everything not explicitly read out here —
 * `steps`, raw `input`, `callback` (and its `run_token`), `actor`/
 * `principal`, `outputDir`, `transcript`, and every other path or URL — is
 * dropped by omission, not by a denylist.
 *
 * For `partial: true` summaries (reconstructed from the event log, still in
 * flight), the stage comes from the KEYS of `steps` only — their values
 * (which can carry an in-progress `task` step's `groundTruth`) are never
 * read.
 */
export function projectRunSummary(summary: Record<string, unknown>): ProjectedRunSummary {
  const runId = typeof summary.runId === "string" ? summary.runId : String(summary.runId ?? "");
  const status = typeof summary.status === "string" ? summary.status : undefined;
  const input = isRecord(summary.input) ? summary.input : {};
  const output = isRecord(summary.output) ? summary.output : {};
  const runLike: OpenHealthRunLike = { status, input, output };

  const outcome = deriveOutcome(runLike);
  const isPartial = summary.partial === true;
  const stepIds = isPartial || isRecord(summary.steps) ? Object.keys((summary.steps as object) ?? {}) : [];
  const stage: OpenHealthStage =
    outcome === "success" || outcome === "failed"
      ? OPENHEALTH_STAGES[OPENHEALTH_STAGES.length - 1]
      : stageFromSteps(stepIds);

  const matched = arrayOrEmpty(output[OPENHEALTH_OUTPUT_FIELDS.matched]);
  const missed = arrayOrEmpty(output[OPENHEALTH_OUTPUT_FIELDS.missed]);
  const extra = arrayOrEmpty(output[OPENHEALTH_OUTPUT_FIELDS.extra]);
  const problemList = arrayOrEmpty(output[OPENHEALTH_OUTPUT_FIELDS.problemList]);
  const sectionsFailed = arrayOrEmpty(output[OPENHEALTH_OUTPUT_FIELDS.sectionsFailed]);
  const sheet = resolveSheet(output);

  return {
    runId,
    status: status ?? null,
    outcome,
    startedAt: stringOrNull(summary.startedAt),
    finishedAt: stringOrNull(summary.finishedAt),
    gtId: normalizeGtId(runLike),
    stage,
    f1: readF1(output),
    recall: numberOrNull(output[OPENHEALTH_OUTPUT_FIELDS.recall]),
    precision: numberOrNull(output[OPENHEALTH_OUTPUT_FIELDS.precision]),
    tier: stringOrNull(output[OPENHEALTH_OUTPUT_FIELDS.tier]),
    cost: runCost(runLike),
    durationMs: runDuration({
      startedAt: stringOrNull(summary.startedAt),
      finishedAt: stringOrNull(summary.finishedAt),
    }),
    matched,
    missed,
    extra,
    matchedCount: matched.length,
    missedCount: missed.length,
    extraCount: extra.length,
    problemList,
    sectionsFailed,
    error: (() => {
      const message = extractErrorMessage(summary.error);
      return message ? { message } : null;
    })(),
    hasSheet: sheet.hasSheet,
    sheetUrl: sheet.sheetUrl,
  };
}

// ── projectTaskRow ───────────────────────────────────────────────────────────

/**
 * Allowlist `{ gtId, split, difficulty, patientId?, title? }`. Rows whose
 * `split` is not `public`/`heldout` (e.g. `train`, or a malformed value)
 * are dropped entirely — `null`, not a partially-filled row.
 */
export function projectTaskRow(row: OpenHealthRawTaskRow): OpenHealthTaskRow | null {
  const split = row.split;
  if (!isOpenHealthSplit(split)) return null;

  const gtIdRaw = row.gtId ?? row.gt_id;
  if (gtIdRaw === undefined || gtIdRaw === null || String(gtIdRaw).length === 0) return null;

  const patientIdRaw = row.patientId ?? row.patient_id;

  return {
    gtId: String(gtIdRaw),
    split,
    difficulty: stringOrNull(row.difficulty),
    ...(patientIdRaw != null ? { patientId: String(patientIdRaw) } : {}),
    ...(typeof row.title === "string" ? { title: row.title } : {}),
  };
}
