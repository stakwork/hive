/**
 * attempt-series.ts
 *
 * Data-shaping helpers for the Recursion tab's hill-climb chart.
 * Reads from LEGAL_BENCHMARK_RUNNER StakworkRun rows (parsed via
 * parseBenchmarkRunResult) — NOT from EvalTriggerOutput Jarvis nodes.
 */

import { parseBenchmarkRunResult } from "@/types/legal";
import type { BenchmarkRunListRow } from "@/hooks/useLegalBenchmarkRunList";

export interface AttemptPoint {
  /** Number of criteria that passed in this attempt */
  n_passed: number;
  /** Total number of criteria in this attempt */
  n_total: number;
  /** ISO timestamp of the run row (authoritative ordering source) */
  createdAt: string;
  /** True for the earliest run per taskSlug (the baseline run) */
  isBaseline: boolean;
  /** 0-based chronological index within the task's series */
  attemptIndex: number;
}

/**
 * Raw run row shape accepted by buildAttemptSeries.
 * Matches the shape returned by /api/stakwork/runs (raw, before hook mapping).
 */
export interface RawRunRow {
  id: string;
  workspaceId: string;
  status: string;
  projectId: number | null;
  result: string | null;
  createdAt: string;
}

/**
 * Build a map of taskSlug → AttemptPoint[] from a list of raw run rows.
 *
 * Rules:
 * - Parses each row via parseBenchmarkRunResult.
 * - Drops rows whose result is unparseable or lacks n_passed / n_total.
 * - Groups by taskSlug.
 * - Sorts each group by createdAt ascending (authoritative ordering).
 * - Marks attemptIndex === 0 as isBaseline: true; all others false.
 *
 * @param rawRows  Raw rows from /api/stakwork/runs (result is still a JSON string).
 */
export function buildAttemptSeries(rawRows: RawRunRow[]): Map<string, AttemptPoint[]> {
  const grouped = new Map<string, Array<{ createdAt: string; n_passed: number; n_total: number }>>();

  for (const row of rawRows) {
    const parsed = parseBenchmarkRunResult(row.result);
    if (!parsed) continue;
    if (parsed.n_passed === undefined || parsed.n_total === undefined) continue;
    const slug = parsed.taskSlug;
    if (!slug) continue;

    const entry = {
      createdAt: row.createdAt,
      n_passed: parsed.n_passed,
      n_total: parsed.n_total,
    };

    const existing = grouped.get(slug);
    if (existing) {
      existing.push(entry);
    } else {
      grouped.set(slug, [entry]);
    }
  }

  const result = new Map<string, AttemptPoint[]>();

  for (const [slug, points] of grouped.entries()) {
    // Sort ascending by createdAt (ISO strings sort lexicographically correctly)
    const sorted = points.slice().sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    result.set(
      slug,
      sorted.map((p, i) => ({
        n_passed: p.n_passed,
        n_total: p.n_total,
        createdAt: p.createdAt,
        isBaseline: i === 0,
        attemptIndex: i,
      })),
    );
  }

  return result;
}

/**
 * Convenience overload that accepts the already-mapped BenchmarkRunListRow shape
 * (used by useLegalBenchmarkRunList). The hook already extracts n_passed/n_total
 * directly — we re-parse result for consistency, but also fall back to the
 * pre-parsed fields on the row when result is absent (shouldn't happen, but safe).
 */
export function buildAttemptSeriesFromMapped(rows: BenchmarkRunListRow[]): Map<string, AttemptPoint[]> {
  // Re-cast as raw rows; the mapped shape exposes n_passed/n_total already,
  // but result is not present on BenchmarkRunListRow. Build raw-compatible objects.
  // Since we can't re-parse result from BenchmarkRunListRow, we use the pre-mapped fields.
  const grouped = new Map<string, Array<{ createdAt: string; n_passed: number; n_total: number }>>();

  for (const row of rows) {
    if (row.n_passed === undefined || row.n_total === undefined) continue;
    const slug = row.taskSlug;
    if (!slug) continue;

    const entry = {
      createdAt: typeof row.createdAt === "string" ? row.createdAt : new Date(row.createdAt).toISOString(),
      n_passed: row.n_passed,
      n_total: row.n_total,
    };

    const existing = grouped.get(slug);
    if (existing) {
      existing.push(entry);
    } else {
      grouped.set(slug, [entry]);
    }
  }

  const result = new Map<string, AttemptPoint[]>();

  for (const [slug, points] of grouped.entries()) {
    const sorted = points.slice().sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    result.set(
      slug,
      sorted.map((p, i) => ({
        n_passed: p.n_passed,
        n_total: p.n_total,
        createdAt: p.createdAt,
        isBaseline: i === 0,
        attemptIndex: i,
      })),
    );
  }

  return result;
}
