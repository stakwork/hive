/**
 * legal-benchmark-fix-snapshots.ts
 *
 * Server-side helper that fetches ProposedFix nodes for a given task slug,
 * optionally scoped to a specific EvalTrigger (run-scoped fixes).
 *
 * Two paths:
 *   1. When `evalTriggerRef` is present: hop EvalTrigger → HAS_PROPOSED_FIX → ProposedFix
 *      Returns genuinely run-scoped fixes. An empty result stays empty — it does
 *      NOT fall through to the task-wide search (that would misrepresent scope).
 *   2. When absent: task-slug attribute search (historical fallback).
 *
 * Scoping note: the underlying Jarvis query filters on `task_slug`, not run.
 * When using the fallback path, fixes attributable to `runId` are badged and
 * sorted first; all others are still returned.
 *
 * Authorization: this helper must only be called AFTER workspace/role checks
 * have passed. It performs no auth checks itself.
 */

import type { JarvisConnectionConfig } from "@/types/jarvis";
import type { ProposedFix } from "@/types/legal";
import { searchNodesByAttributes } from "@/services/swarm/api/nodes";
import { logger } from "@/lib/logger";

// ── Constants ─────────────────────────────────────────────────────────────────

const MOCK_FIXES =
  process.env.USE_MOCKS === "true" && process.env.NODE_ENV !== "production";

// ── Jarvis graph traversal ────────────────────────────────────────────────────

/**
 * Hop EvalTrigger → HAS_PROPOSED_FIX → ProposedFix nodes via the Jarvis expand API.
 * Returns null when the hop fails (network error, etc.) — not an empty array, so
 * callers can distinguish "hop failed" from "hop succeeded with no results".
 */
async function hopEvalTriggerToFixes(
  config: JarvisConnectionConfig,
  evalTriggerRef: string,
): Promise<ProposedFix[] | null> {
  try {
    const baseUrl = config.jarvisUrl.replace(/\/$/, "");
    const edgeTypeParam = encodeURIComponent('["HAS_PROPOSED_FIX"]');
    const url = `${baseUrl}/v2/nodes/${encodeURIComponent(evalTriggerRef)}?expand=edges&edge_type=${edgeTypeParam}`;

    const res = await fetch(url, {
      headers: {
        "x-api-token": config.apiKey,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      logger.warn(
        "[legal-benchmark-fix-snapshots] EvalTrigger hop returned non-ok",
        "legal",
        { evalTriggerRef, status: res.status },
      );
      return null;
    }

    const data = (await res.json()) as {
      nodes?: Array<{
        ref_id: string;
        node_type?: string;
        properties?: Record<string, unknown>;
      }>;
      edges?: Array<{ source: string; target: string; edge_type: string }>;
    };

    // Collect ProposedFix ref_ids from HAS_PROPOSED_FIX edges
    const fixRefIds = new Set<string>(
      (data.edges ?? [])
        .filter(
          (e) => e.source === evalTriggerRef && e.edge_type === "HAS_PROPOSED_FIX",
        )
        .map((e) => e.target),
    );

    if (fixRefIds.size === 0) {
      return [];
    }

    // Map ProposedFix nodes
    const fixes: ProposedFix[] = (data.nodes ?? [])
      .filter((n) => fixRefIds.has(n.ref_id))
      .map((n) => projectNodeToFix(n.ref_id, n.properties));

    return fixes;
  } catch (err) {
    logger.warn(
      "[legal-benchmark-fix-snapshots] EvalTrigger hop threw",
      "legal",
      { evalTriggerRef, error: String(err) },
    );
    return null;
  }
}

// ── Property projection ───────────────────────────────────────────────────────

/**
 * Project a raw graph node's properties into a ProposedFix shape.
 * Mirrors the whitelist in proposed-fixes/route.ts projectFix().
 * Includes the new snapshot fields (target_type, etc.).
 */
function projectNodeToFix(
  refId: string,
  props: Record<string, unknown> | undefined,
): ProposedFix {
  const p = props ?? {};
  const str = (key: string): string | null => {
    const v = p[key];
    return v != null ? String(v) : null;
  };
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
    // Snapshot fields
    target_type: str("target_type"),
    target_name: str("target_name"),
    target_version: str("target_version"),
    target_ref: str("target_ref"),
    old_value: str("old_value"),
    new_value: str("new_value"),
    fix_type: str("fix_type"),
  };
}

// ── Attribution helpers ───────────────────────────────────────────────────────

/**
 * Returns true when a fix is attributable to `runId`.
 * Mirrors the precedence from the architecture doc:
 *   rerun_run_id → unique_source_id → project_id
 */
function isAttributedToRun(fix: ProposedFix, runId: string): boolean {
  if (fix.rerun_run_id === runId) return true;
  // project_id is used as the unique_source_id fallback in projectFix
  // For source attribution we only check rerun_run_id (direct link to run)
  return false;
}

// ── Mock fixtures ─────────────────────────────────────────────────────────────

async function getMockFixes(_taskSlug: string | null): Promise<ProposedFix[]> {
  return [];
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface FetchFixSnapshotsOpts {
  /** Hive StakworkRun id — used for run-attribution badging on the fallback path. */
  runId?: string;
  /**
   * Graph ref_id of the EvalTrigger node written by the eval run.
   * When present: hop EvalTrigger → HAS_PROPOSED_FIX (run-scoped, no fallback).
   * When absent: task-slug attribute search (historical fallback).
   */
  evalTriggerRef?: string;
}

/**
 * Fetch ProposedFix nodes for a task's fix history.
 *
 * Authorization: must only be called after workspace/role checks pass.
 * The jarvisConfig and taskSlug must be derived from already-validated workspace data.
 *
 * Returns [] (not an error) when taskSlug/jarvisConfig is missing or
 * when the Jarvis query returns no results.
 */
export async function fetchFixSnapshots(
  jarvisConfig: JarvisConnectionConfig | null | undefined,
  taskSlug: string | null | undefined,
  opts: FetchFixSnapshotsOpts = {},
): Promise<ProposedFix[]> {
  // Mock branch for development
  if (MOCK_FIXES) {
    return getMockFixes(taskSlug ?? null);
  }

  // Fail gracefully when config or slug is missing
  if (!jarvisConfig || !taskSlug) {
    return [];
  }

  const { runId, evalTriggerRef } = opts;

  // ── Path 1: EvalTrigger edge hop (run-scoped) ─────────────────────────────
  if (evalTriggerRef) {
    logger.info(
      "[legal-benchmark-fix-snapshots] Using EvalTrigger hop (run-scoped)",
      "legal",
      { evalTriggerRef, runId },
    );
    const hopResult = await hopEvalTriggerToFixes(jarvisConfig, evalTriggerRef);

    if (hopResult === null) {
      // Hop failed — return empty rather than falling through to task-wide search
      logger.warn(
        "[legal-benchmark-fix-snapshots] EvalTrigger hop failed — returning empty",
        "legal",
        { evalTriggerRef },
      );
      return [];
    }

    // Hop succeeded (may be empty for runs with no fixes yet)
    // Keep rejected fixes — a rejected concept edit is informative
    return hopResult.sort((a, b) => {
      // Sort by attributed-to-this-run first
      if (runId) {
        const aIs = isAttributedToRun(a, runId) ? 1 : 0;
        const bIs = isAttributedToRun(b, runId) ? 1 : 0;
        if (aIs !== bIs) return bIs - aIs;
      }
      return 0;
    });
  }

  // ── Path 2: Task-slug attribute search (fallback) ─────────────────────────
  logger.info(
    "[legal-benchmark-fix-snapshots] Using task-slug search (fallback)",
    "legal",
    { taskSlug, runId },
  );

  const searchResult = await searchNodesByAttributes(jarvisConfig, {
    nodeTypes: ["ProposedFix"],
    filters: [{ attribute: "task_slug", value: taskSlug, comparator: "=" }],
    includeProperties: true,
  });

  if (!searchResult.ok) {
    logger.warn(
      "[legal-benchmark-fix-snapshots] task-slug search failed",
      "legal",
      { taskSlug },
    );
    return [];
  }

  const fixes = searchResult.nodes.map((node) =>
    projectNodeToFix(node.ref_id, node.properties),
  );

  // Keep all fixes including rejected (unlike the route which filters rejected)
  // Canonicalize status: eval_status takes precedence over status
  const withStatus = fixes.map((f) => ({
    ...f,
    // Ensure the canonical status field is set for downstream accept/reject logic
    eval_status: f.eval_status ?? f.status,
  }));

  // Sort: run-attributed fixes first, then by recency
  return withStatus.sort((a, b) => {
    if (runId) {
      const aIs = isAttributedToRun(a, runId) ? 1 : 0;
      const bIs = isAttributedToRun(b, runId) ? 1 : 0;
      if (aIs !== bIs) return bIs - aIs;
    }
    return 0;
  });
}

/**
 * Section label string — tells callers how to caption the section based on
 * which path was taken.
 */
export function fixSnapshotSectionLabel(evalTriggerRef: string | undefined): string {
  return evalTriggerRef
    ? "Concept changes from this run's fix loop"
    : "Concept changes from this task's fix loop";
}
