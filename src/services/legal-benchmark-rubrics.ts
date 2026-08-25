/**
 * legal-benchmark-rubrics.ts
 *
 * Graph-backed rubric roster reads for legal benchmark tasks.
 *
 * The graph models each benchmark task as an EvalSet node (`properties.id` =
 * task slug) whose rubric criteria are EvalRequirement nodes hanging off
 * HAS_REQUIREMENT edges. This service resolves that roster so score surfaces
 * can read their DENOMINATOR from the graph instead of trusting the runner's
 * echoed `n_total`, and can see which criterion definitions are `contested`.
 *
 * For contested requirements, we fan out one hop further to resolve a
 * contest-validity rationale from the nearest `CriterionResult` node
 * (via `HAS_CRITERION_RESULT` edges). The rationale is stored as
 * `contestReason` / `contestExcerpt` on `GraphRubric` and is used by the
 * RubricLedger to render a violet rationale block. Both fields are clamped
 * before storage so they are safe to serialize into offline export bundles.
 *
 * **Security:** callers must apply `requireAuth` + workspace-gate +
 * `getWorkspaceSwarmAccess` before calling — no authorization happens here.
 */

import type { JarvisConnectionConfig, JarvisNode } from "@/types/jarvis";
import { resolveEvalSetRefIdBySlug } from "@/services/legal-benchmark-recursion";
import { resolveContested } from "@/lib/harvey-lab/eval-normalizers";
import type { GraphRubric } from "@/lib/harvey-lab/rubric-scoring";
import { expandEdges } from "@/lib/harvey-lab/jarvis-expand";
import { RUBRIC_EXCERPT_CHAR_CAP } from "@/lib/run-report/derive";
import { logger } from "@/lib/logger";

export interface TaskRubricRoster {
  evalSetRefId: string;
  rubrics: GraphRubric[];
}

export interface TaskRubricRosterResult {
  ok: boolean;
  /** Null when the task has no EvalSet in the graph (not an error). */
  roster?: TaskRubricRoster | null;
  error?: string;
}

/**
 * Maximum number of concurrent HAS_CRITERION_RESULT fan-outs when resolving
 * contest rationales. Mirrors the concurrency cap in the recursion-summary
 * service to avoid swarm OOM under load.
 */
const CRITERION_RESULT_CONCURRENCY = 6;

/**
 * Clamp a string to at most `cap` characters, appending an ellipsis if cut.
 * Mirrors the `clampText` helper in `derive.ts` — inlined here to avoid a
 * circular dependency (this service is imported by the report route; derive.ts
 * imports types that depend on the report route's exports).
 */
function clampText(text: string, cap: number): string {
  return text.length > cap ? `${text.slice(0, cap)}\u2026` : text;
}

/**
 * Parse the trailing numeric run-suffix from a CriterionResult `id`.
 *
 * IDs are structured as `<criterion_id>-<run_project_id>`, e.g.
 * `C-007-149493800`. The suffix is the numeric project-id component used as a
 * proxy for recency (nodes carry no `created_at`; all three verified contested
 * requirements are 1:1 with their result so this is a rare tie-break, not the
 * hot path; matching the report's own run is not available because the roster
 * cache is keyed `${workspaceSlug}:${taskSlug}` with no `runId`).
 *
 * Returns the parsed integer, or -1 when the id is absent or unparseable.
 */
function parseCriterionResultRunSuffix(id: string | undefined | null): number {
  if (!id) return -1;
  const lastDash = id.lastIndexOf("-");
  if (lastDash === -1) return -1;
  const suffix = id.slice(lastDash + 1);
  const n = parseInt(suffix, 10);
  return isNaN(n) ? -1 : n;
}

/**
 * Select the best CriterionResult candidate from a list of Jarvis nodes.
 *
 * Selection rule (spec-aligned):
 *   1. Filter to nodes with `node_type === "criterionresult"` (case-insensitive).
 *   2. Filter to nodes with a non-empty `llm_flag_reason`.
 *   3. Select the candidate with the highest trailing numeric run-suffix on
 *      its `id`. Fall back to a stable sort on `ref_id` when the suffix is
 *      unparseable or tied.
 *
 * Returns null when no suitable node exists.
 */
function selectBestCriterionResult(nodes: JarvisNode[]): {
  reason: string;
  excerpt: string | null;
} | null {
  const candidates = nodes
    .filter((n) => String(n.node_type ?? "").toLowerCase() === "criterionresult")
    .map((n) => {
      const raw = n.properties?.llm_flag_reason;
      const reason = typeof raw === "string" ? raw.trim() : "";
      const rawExcerpt = n.properties?.document_excerpt;
      const excerpt = typeof rawExcerpt === "string" ? rawExcerpt.trim() : "";
      return {
        ref_id: n.ref_id,
        id: n.properties?.id != null ? String(n.properties.id) : "",
        reason,
        excerpt: excerpt || null,
      };
    })
    .filter((c) => c.reason.length > 0);

  if (candidates.length === 0) return null;

  // Sort by trailing numeric suffix descending; stable secondary sort on ref_id.
  candidates.sort((a, b) => {
    const sa = parseCriterionResultRunSuffix(a.id);
    const sb = parseCriterionResultRunSuffix(b.id);
    if (sa !== sb) return sb - sa; // highest first
    // Stable secondary tie-break: lexicographic ref_id descending (prefer "later" uuid)
    return b.ref_id < a.ref_id ? -1 : b.ref_id > a.ref_id ? 1 : 0;
  });

  const best = candidates[0];
  return {
    reason: clampText(best.reason, RUBRIC_EXCERPT_CHAR_CAP),
    excerpt: best.excerpt ? clampText(best.excerpt, RUBRIC_EXCERPT_CHAR_CAP) : null,
  };
}

/**
 * Fetch the EvalRequirement roster for an EvalSet ref_id, then fan out to
 * resolve contest rationales for contested requirements.
 *
 * Uses the same depth-1 HAS_REQUIREMENT expand as the generic evals
 * requirements route; Jarvis returns the root node alongside its neighbors and
 * node types come back inconsistently cased ("Evalset" / "Evalrequirement"),
 * so the root is dropped and the type match is case-insensitive.
 *
 * For contested requirements, we also walk `HAS_CRITERION_RESULT` edges (one
 * hop) to populate `contestReason` / `contestExcerpt`. Fan-out is bounded to
 * `CRITERION_RESULT_CONCURRENCY` concurrent requests. A rationale fetch
 * failure degrades to no reason and never fails the roster.
 */
export async function fetchEvalSetRubrics(
  config: JarvisConnectionConfig,
  evalSetRefId: string,
): Promise<{ ok: boolean; rubrics?: GraphRubric[]; error?: string }> {
  const edgeType = encodeURIComponent("['HAS_REQUIREMENT']");
  const url = `${config.jarvisUrl}/v2/nodes/${encodeURIComponent(evalSetRefId)}?expand=edges&edge_type=${edgeType}&depth=1`;

  try {
    const res = await fetch(url, { headers: { "x-api-token": config.apiKey } });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      logger.warn(
        `[legal/benchmarks/rubrics] Jarvis expand failed status=${res.status}`,
        "legal",
        { evalSetRefId, status: res.status, body: text.slice(0, 200) },
      );
      return { ok: false, error: `Jarvis returned ${res.status}` };
    }

    const data = (await res.json()) as { nodes?: JarvisNode[] };
    const rawRubrics: GraphRubric[] = (data?.nodes ?? [])
      .filter(
        (n) =>
          n.ref_id !== evalSetRefId &&
          String(n.node_type ?? "").toLowerCase() === "evalrequirement",
      )
      .map((n) => ({
        ref_id: n.ref_id,
        id: n.properties?.id != null ? String(n.properties.id) : n.ref_id,
        name: n.properties?.name != null ? String(n.properties.name) : "",
        contested: resolveContested({ contested: n.properties?.contested }),
      }));

    // ── Contest-rationale fan-out ──────────────────────────────────────────
    // For each contested requirement, walk HAS_CRITERION_RESULT one hop to
    // find a contest-validity rationale. Bounded concurrency; failures degrade.
    const contestedRubrics = rawRubrics.filter((r) => r.contested);
    const totalContested = contestedRubrics.length;
    let resolvedRationale = 0;

    if (contestedRubrics.length > 0) {
      // Process in batches of CRITERION_RESULT_CONCURRENCY.
      for (let i = 0; i < contestedRubrics.length; i += CRITERION_RESULT_CONCURRENCY) {
        const batch = contestedRubrics.slice(i, i + CRITERION_RESULT_CONCURRENCY);
        await Promise.all(
          batch.map(async (rubric) => {
            const nodes = await expandEdges(
              rubric.ref_id,
              ["HAS_CRITERION_RESULT"],
              config,
            );
            if (!nodes) return; // expandEdges never throws; null = failure, degrade
            const best = selectBestCriterionResult(nodes);
            if (best) {
              rubric.contestReason = best.reason;
              rubric.contestExcerpt = best.excerpt ?? null;
              resolvedRationale++;
            }
          }),
        );
      }
    }

    logger.info(
      `[legal/benchmarks/rubrics] Roster fetched: ${rawRubrics.length} requirements, ` +
        `${totalContested} contested, ${resolvedRationale} with rationale`,
      "legal",
      { evalSetRefId, total: rawRubrics.length, totalContested, resolvedRationale },
    );

    return { ok: true, rubrics: rawRubrics };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn("[legal/benchmarks/rubrics] Jarvis expand threw", "legal", {
      evalSetRefId,
      error: message,
    });
    return { ok: false, error: message };
  }
}

/**
 * Resolve a task slug to its EvalSet and return the full rubric roster.
 *
 * `{ ok: true, roster: null }` means the graph simply has no EvalSet for this
 * task (legacy task, roster not ingested yet) — callers fall back to run-local
 * scoring. `{ ok: false }` means the graph was unreachable.
 */
export async function fetchTaskRubricRoster(
  config: JarvisConnectionConfig,
  taskSlug: string,
): Promise<TaskRubricRosterResult> {
  const evalSetRefId = await resolveEvalSetRefIdBySlug(config, taskSlug);
  if (!evalSetRefId) return { ok: true, roster: null };

  const result = await fetchEvalSetRubrics(config, evalSetRefId);
  if (!result.ok) return { ok: false, error: result.error };

  return { ok: true, roster: { evalSetRefId, rubrics: result.rubrics ?? [] } };
}
