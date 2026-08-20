/**
 * legal-benchmark-fix-snapshots.ts
 *
 * Server-side source for the run report's fix snapshot section. Both report
 * pages (runs/[runId]/report and attempts/[refId]/report) call
 * `fetchFixSnapshots` during the server render and pass the result into
 * `RunReportView` — no client fetch, no `useProposedFixes` reuse. The client
 * hook path breaks on every one of these surfaces: the proposed-fixes route
 * hard-404s outside the `openlaw` slug and errors loudly on non-ok responses,
 * the hook reads its slug from `useWorkspace()` which a deep-linked report
 * never populates, `RunReportView` is a pure projection renderer, and the
 * attempts page has no runId to give the hook.
 *
 * Scoping, stated honestly: the underlying graph query filters on
 * `task_slug`, not run — a runId only ever resolved the slug. The helper
 * therefore returns the task's full fix history; when run identifiers are
 * supplied, fixes attributable to that run (`rerun_run_id` match, else
 * Stakwork project match) are flagged `fromThisRun` and sorted first. The
 * section labels itself accordingly rather than presenting task-wide fixes
 * as run-scoped.
 *
 * Unlike the proposed-fixes route, rejected fixes are RETAINED — a rejected
 * concept edit is one of the most informative diffs a reviewer can see. The
 * route's own rejected filter stays untouched so current consumers don't
 * regress; the new section badges rejected entries instead. Status is
 * resolved canonically as `eval_status ?? status` (see `resolveFixStatus`).
 */

import { searchNodesByAttributes } from "@/services/swarm/api/nodes";
import { buildSnapshotMockFixes } from "@/app/api/mock/jarvis/graph/fix-snapshot-fixtures";
import type { JarvisConnectionConfig } from "@/types/jarvis";
import type { FixSnapshotEntry, ProposedFix } from "@/types/legal";
import { logger } from "@/lib/logger";

/**
 * Map a raw graph node's properties into the whitelisted ProposedFix
 * projection. Tolerates any missing key (returns null for it) — never leaks
 * unexpected node data. Shared by the proposed-fixes route and
 * `fetchFixSnapshots` so the two surfaces cannot drift.
 *
 * `project_id` is sourced primarily from the node's `unique_source_id`
 * property, which jarvis-backend writes via
 * `NodeHelper.update_node_unique_source_id` when a node is dispatched to
 * Stakwork. The legacy `project_id` node property is used only as a fallback
 * for older nodes written before `unique_source_id` existed.
 */
export function projectFix(refId: string, props: Record<string, unknown> | undefined): ProposedFix {
  const p = props ?? {};
  const str = (key: string): string | null => {
    const v = p[key];
    return v != null ? String(v) : null;
  };

  /**
   * Resolve the Stakwork project id with explicit precedence:
   *   1. `unique_source_id` — written by jarvis-backend on Stakwork dispatch (preferred).
   *   2. `project_id`       — legacy fallback for older ProposedFix nodes.
   * WARNING: do not silently reorder this precedence; `unique_source_id` must win
   * whenever it is present and numeric, to ensure the super-admin link resolves.
   */
  const toProjectId = (v: unknown): number | null =>
    v != null && v !== "" && !isNaN(Number(v)) ? Number(v) : null;
  const project_id =
    toProjectId(p["unique_source_id"]) ?? toProjectId(p["project_id"]);

  return {
    ref_id: refId,
    criterion_id: str("criterion_id"),
    criterion_title: str("criterion_title"),
    prompt_name: str("prompt_name"),
    prompt_id: str("prompt_id"),
    prompt_version_id: str("prompt_version_id"),
    new_prompt_version_id: str("new_prompt_version_id"),
    failing_value: str("failing_value"),
    passing_value: str("passing_value"),
    delta: str("delta"),
    reasoning: str("reasoning"),
    eval_status: str("eval_status"),
    status: str("status"),
    rerun_status: str("rerun_status"),
    before_score: str("before_score"),
    after_score: str("after_score"),
    score_delta: str("score_delta"),
    rerun_run_id: str("rerun_run_id"),
    resolved_by: str("resolved_by"),
    resolved_at: str("resolved_at"),
    project_id,
    target_type: str("target_type"),
    target_name: str("target_name"),
    target_version: str("target_version"),
    target_ref: str("target_ref"),
    old_value: str("old_value"),
    new_value: str("new_value"),
    fix_type: str("fix_type"),
  };
}

export interface FetchFixSnapshotsOptions {
  /** StakworkRun row id of the run being viewed — matched against rerun_run_id */
  runId?: string | null;
  /** Stakwork project id of the run — matched against unique_source_id/project_id */
  projectId?: number | null;
}

/** True when the fix is attributable to the run being viewed. */
function isFromRun(fix: ProposedFix, opts: FetchFixSnapshotsOptions): boolean {
  if (opts.runId && fix.rerun_run_id != null && String(fix.rerun_run_id) === String(opts.runId)) {
    return true;
  }
  return opts.projectId != null && fix.project_id != null && fix.project_id === opts.projectId;
}

/**
 * Fetch the ProposedFix history for a task, projected and run-attributed.
 * Never throws; returns an empty array when the task slug or Jarvis config is
 * missing or the graph read fails — the section simply doesn't render.
 */
export async function fetchFixSnapshots(
  jarvisConfig: JarvisConnectionConfig | null,
  taskSlug: string | null | undefined,
  opts: FetchFixSnapshotsOptions = {},
): Promise<FixSnapshotEntry[]> {
  if (!taskSlug) return [];

  let fixes: ProposedFix[];
  if (process.env.USE_MOCKS === "true" && process.env.NODE_ENV !== "production") {
    fixes = buildSnapshotMockFixes();
  } else {
    if (!jarvisConfig) return [];
    const searchResult = await searchNodesByAttributes(jarvisConfig, {
      nodeTypes: ["ProposedFix"],
      filters: [{ attribute: "task_slug", value: taskSlug, comparator: "=" }],
      includeProperties: true,
    });
    if (!searchResult.ok) {
      logger.warn(
        "[legal/benchmarks/fix-snapshots] ProposedFix search failed — omitting snapshot section",
        "legal",
        { taskSlug, status: searchResult.status },
      );
      return [];
    }
    fixes = searchResult.nodes.map((node) => projectFix(node.ref_id, node.properties));
  }

  // Rejected fixes deliberately retained. Attribution flags this-run entries;
  // the sort is stable, so within each group the graph order is preserved.
  return fixes
    .map((fix) => ({ ...fix, fromThisRun: isFromRun(fix, opts) }))
    .sort((a, b) => Number(b.fromThisRun) - Number(a.fromThisRun));
}
