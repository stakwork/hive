/**
 * Pure derivations over a run report bundle.
 *
 * Mirrors the `src/lib/harvey-lab/*` split: all computation lives here so the
 * renderer stays declarative and every derivation is unit-testable without a
 * DOM. Nothing in this file performs IO or touches the database.
 */

import type { RunReportStats, SanitizedNode } from "./types";

// ── Timestamps ───────────────────────────────────────────────────────────────

/**
 * Normalize a bundle timestamp to epoch ms, once, at ingest.
 *
 * The generator emits `"YYYY-MM-DD HH:MM:SS.mmm"` (space-separated, no zone),
 * but true ISO8601-with-offset also appears. The space-separated form is
 * treated as UTC — it carries no zone, and guessing the server's local zone
 * would silently shift every timestamp by the deployment region's offset.
 *
 * Returns null rather than NaN so callers can render "—" instead of "Invalid
 * Date". Display formatting is the renderer's job and must go through
 * `formatInUserTz` — never re-derive by string slicing.
 */
export function toEpochMs(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    // Heuristic: seconds vs milliseconds. Anything below 1e12 is seconds.
    return value < 1e12 ? Math.round(value * 1000) : Math.round(value);
  }
  if (typeof value !== "string") return null;

  const trimmed = value.trim();
  if (trimmed === "") return null;

  // "YYYY-MM-DD HH:MM:SS(.mmm)?" with no zone → treat as UTC.
  const spaceSeparated = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2}(?:\.\d+)?)$/.exec(trimmed);
  if (spaceSeparated) {
    const parsed = Date.parse(`${spaceSeparated[1]}T${spaceSeparated[2]}Z`);
    return Number.isNaN(parsed) ? null : parsed;
  }

  const parsed = Date.parse(trimmed);
  return Number.isNaN(parsed) ? null : parsed;
}

// ── Pipeline timeline ────────────────────────────────────────────────────────

// ── Workflow phases ──────────────────────────────────────────────────────────

/**
 * Harvey runner step → pipeline phase.
 *
 * Mirrors the mapping the generator's own viewer uses, so a Hive-rendered
 * report groups and colours the timeline the same way an operator reading the
 * standalone viewer would expect. An unmapped step falls back to "other" rather
 * than being hidden — a new workflow step must still appear on the timeline.
 */
export type WorkflowPhase = "setup" | "context" | "draft" | "verify" | "score" | "other";

const PHASE_STEPS: Record<Exclude<WorkflowPhase, "other">, string[]> = {
  setup: "set_var build_checklist_messages check_documents build_checklist_body guard_missing_docs build_namespace_body call_checklist_llm register_namespace foreach_ingest_doc parse_checklist extract_swarm_slug flag_spreadsheet_sources".split(" "),
  context: "write_checklist_to_file guard_cross_checker run_cross_check_agent guard_case_law run_case_law_research".split(" "),
  draft: "derive_basename build_drafter_plan set_drafter_plan run_draft".split(" "),
  verify: "verify_completeness verify_correctness verify_arithmetic verify_doctrine run_aggregator".split(" "),
  score: "foreach_fetch_deliverable assemble_output_map validate_deliverable_names build_score_rubric_attrs score_rubric format_results build_webhook_body if_no_webhook_url post_result set_output guard_all_pass".split(" "),
};

const STEP_TO_PHASE: Record<string, WorkflowPhase> = (() => {
  const map: Record<string, WorkflowPhase> = {};
  for (const [phase, steps] of Object.entries(PHASE_STEPS)) {
    for (const step of steps) map[step] = phase as WorkflowPhase;
  }
  return map;
})();

export function phaseOf(step: string): WorkflowPhase {
  return STEP_TO_PHASE[step] ?? "other";
}

/** Tailwind classes per phase, in Hive's palette rather than the viewer's. */
export const PHASE_CLASS: Record<WorkflowPhase, string> = {
  setup: "bg-blue-500",
  context: "bg-orange-500",
  draft: "bg-emerald-500",
  verify: "bg-amber-500",
  score: "bg-pink-500",
  other: "bg-muted-foreground/40",
};

export const PHASE_LABEL: Record<WorkflowPhase, string> = {
  setup: "Setup",
  context: "Context",
  draft: "Draft",
  verify: "Verify",
  score: "Score",
  other: "Other",
};

// ── Gantt layout ─────────────────────────────────────────────────────────────

export interface GanttBar {
  name: string;
  phase: WorkflowPhase;
  startMs: number;
  endMs: number;
  durationMs: number;
  /** Percentage offsets along the shared time axis. */
  leftPct: number;
  widthPct: number;
}

export interface GanttLayout {
  bars: GanttBar[];
  ticks: Array<{ leftPct: number; label: string }>;
  startMs: number;
  endMs: number;
  totalMs: number;
}

/**
 * Lay steps out on a SHARED absolute time axis, so concurrent work reads as
 * overlapping bars and gaps read as idle time. This is what distinguishes a
 * timeline from a plain bar chart of durations.
 */
export function buildGantt(
  steps: Array<{ name: string; startMs: number | null; endMs: number | null }>,
  tickCount = 6,
): GanttLayout | null {
  const valid = steps.filter(
    (s): s is { name: string; startMs: number; endMs: number } =>
      s.startMs != null && s.endMs != null && s.endMs >= s.startMs,
  );
  if (valid.length === 0) return null;

  const startMs = Math.min(...valid.map((s) => s.startMs));
  const endMs = Math.max(...valid.map((s) => s.endMs));
  const totalMs = Math.max(1, endMs - startMs);

  const bars: GanttBar[] = valid.map((s) => ({
    name: s.name,
    phase: phaseOf(s.name),
    startMs: s.startMs,
    endMs: s.endMs,
    durationMs: s.endMs - s.startMs,
    leftPct: ((s.startMs - startMs) / totalMs) * 100,
    // Floor at a hair above zero so a sub-second step is still visible.
    widthPct: Math.max(0.4, ((s.endMs - s.startMs) / totalMs) * 100),
  }));

  const ticks = Array.from({ length: tickCount + 1 }, (_, i) => {
    const fraction = i / tickCount;
    return {
      leftPct: fraction * 100,
      label: formatDuration(Math.round(totalMs * fraction)),
    };
  });

  return { bars, ticks, startMs, endMs, totalMs };
}

/** Human-readable duration. Returns "—" for unknown. */
export function formatDuration(ms: number | null): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = Math.round(seconds % 60);
  if (minutes < 60) return `${minutes}m ${remainder}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

// ── Rubric grouping / fix aggregation ────────────────────────────────────────

export interface RubricRow {
  id: string;
  title: string;
  passed: boolean;
  reasoning: string;
  suggestedFix?: string;
  causeType?: string;
  causeSummary?: string;
}

/**
 * Verdict casing from the producer is unverified, so match case-insensitively
 * on a prefix rather than against an exact enum.
 */
export function isPassVerdict(verdict: unknown): boolean {
  return typeof verdict === "string" && /^\s*pass/i.test(verdict);
}

export function groupRubrics(analysis: unknown): RubricRow[] {
  const summaries = readArray(analysis, "summaries");
  const rows: RubricRow[] = [];

  for (const entry of summaries) {
    if (!isRecord(entry)) continue;
    const id = asString(entry.id) ?? asString(entry.rubric_id) ?? "";
    if (!id) continue;
    rows.push({
      id,
      title: asString(entry.title) ?? id,
      passed: isPassVerdict(entry.verdict),
      reasoning: asString(entry.reasoning) ?? "",
      suggestedFix: asString(entry.suggested_fix),
      causeType: asString(entry.cause_type),
      causeSummary: asString(entry.cause_summary),
    });
  }

  return rows;
}

export interface AggregatedFix {
  causeType: string;
  count: number;
  rubricIds: string[];
  suggestions: string[];
}

/** Group failing rubrics by cause type so repeated root causes collapse. */
export function aggregateFixes(rows: RubricRow[]): AggregatedFix[] {
  const byCause = new Map<string, AggregatedFix>();

  for (const row of rows) {
    if (row.passed) continue;
    const causeType = row.causeType?.trim() || "uncategorized";
    const existing = byCause.get(causeType);
    const suggestion = row.suggestedFix?.trim();

    if (existing) {
      existing.count += 1;
      existing.rubricIds.push(row.id);
      if (suggestion && !existing.suggestions.includes(suggestion)) {
        existing.suggestions.push(suggestion);
      }
    } else {
      byCause.set(causeType, {
        causeType,
        count: 1,
        rubricIds: [row.id],
        suggestions: suggestion ? [suggestion] : [],
      });
    }
  }

  return [...byCause.values()].sort((a, b) => b.count - a.count);
}

// ── Stats ────────────────────────────────────────────────────────────────────

/**
 * Computed here because the producer toolkit does not export a stats block.
 * `passCount`/`failCount` are null (not 0) when the bundle carries no rubric
 * verdicts at all, so "no analysis ran" is distinguishable from "everything
 * failed".
 */
export function computeStats(input: {
  sourceDocs: unknown[];
  workfiles: unknown[];
  traces: unknown[];
  branches: unknown[];
  rubricRows: RubricRow[];
}): RunReportStats {
  const { rubricRows } = input;
  const hasRubrics = rubricRows.length > 0;

  return {
    sourceDocCount: input.sourceDocs.length,
    workfileCount: input.workfiles.length,
    traceCount: input.traces.length,
    branchCount: input.branches.length,
    rubricCount: rubricRows.length,
    passCount: hasRubrics ? rubricRows.filter((r) => r.passed).length : null,
    failCount: hasRubrics ? rubricRows.filter((r) => !r.passed).length : null,
  };
}

// ── Flattened text index (for highlighting) ──────────────────────────────────

export interface FlatTextIndex {
  /** Concatenation of every text node in document order. */
  text: string;
  /** Per-text-node span into `text`, with the path to reach that node. */
  spans: Array<{ start: number; end: number; path: number[] }>;
}

/**
 * Flatten a sanitized tree into a concatenated text index with per-node offsets.
 *
 * Required because the generator matches link tokens against a plain-text
 * rendition (`d['plain']`) that it then strips before shipping — so tokens are
 * routinely split across text nodes by inline tags, and a per-node substring
 * search would miss them.
 */
export function flattenText(nodes: SanitizedNode[]): FlatTextIndex {
  const spans: FlatTextIndex["spans"] = [];
  let text = "";

  const visit = (list: SanitizedNode[], path: number[]) => {
    list.forEach((node, i) => {
      const nodePath = [...path, i];
      if (typeof node === "string") {
        spans.push({ start: text.length, end: text.length + node.length, path: nodePath });
        text += node;
      } else if (node.c) {
        visit(node.c, nodePath);
      }
    });
  };

  visit(nodes, []);
  return { text, spans };
}

/** Max tokens honoured per document, and max length of any single token. */
export const MAX_HIGHLIGHT_TOKENS = 25;
export const MAX_TOKEN_LENGTH = 200;

/**
 * Locate highlight ranges for a set of tokens against a flattened index.
 *
 * Tokens originate in the bundle, so they are attacker-influenced: every token
 * is length-capped and the match is a plain `indexOf` scan rather than a
 * constructed `RegExp`. Building a regex from bundle text would be regex
 * injection and a catastrophic-backtracking client DoS.
 */
export function findHighlightRanges(
  index: FlatTextIndex,
  tokens: string[],
): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];
  const haystack = index.text.toLowerCase();

  for (const raw of tokens.slice(0, MAX_HIGHLIGHT_TOKENS)) {
    if (typeof raw !== "string") continue;
    const token = raw.trim().slice(0, MAX_TOKEN_LENGTH).toLowerCase();
    if (token.length < 3) continue;

    let from = 0;
    for (;;) {
      const at = haystack.indexOf(token, from);
      if (at === -1) break;
      ranges.push({ start: at, end: at + token.length });
      from = at + token.length;
      if (ranges.length >= MAX_HIGHLIGHT_TOKENS * 4) break;
    }
  }

  return mergeRanges(ranges);
}

function mergeRanges(
  ranges: Array<{ start: number; end: number }>,
): Array<{ start: number; end: number }> {
  if (ranges.length === 0) return [];
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const merged = [sorted[0]];
  for (const range of sorted.slice(1)) {
    const last = merged[merged.length - 1];
    if (range.start <= last.end) last.end = Math.max(last.end, range.end);
    else merged.push(range);
  }
  return merged;
}

// ── Small shared readers ─────────────────────────────────────────────────────

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function readArray(source: unknown, key: string): unknown[] {
  if (!isRecord(source)) return [];
  const value = source[key];
  return Array.isArray(value) ? value : [];
}
