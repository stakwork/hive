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
 * **Security:** callers must apply `requireAuth` + workspace-gate +
 * `getWorkspaceSwarmAccess` before calling — no authorization happens here.
 */

import type { JarvisConnectionConfig, JarvisNode } from "@/types/jarvis";
import { resolveEvalSetRefIdBySlug } from "@/services/legal-benchmark-recursion";
import { resolveContested } from "@/lib/harvey-lab/eval-normalizers";
import type { GraphRubric } from "@/lib/harvey-lab/rubric-scoring";
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
 * Fetch the EvalRequirement roster for an EvalSet ref_id.
 *
 * Uses the same depth-1 HAS_REQUIREMENT expand as the generic evals
 * requirements route; Jarvis returns the root node alongside its neighbors and
 * node types come back inconsistently cased ("Evalset" / "Evalrequirement"),
 * so the root is dropped and the type match is case-insensitive.
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
    const rubrics: GraphRubric[] = (data?.nodes ?? [])
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

    return { ok: true, rubrics };
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
