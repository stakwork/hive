/**
 * legal-benchmark-recursion.ts
 *
 * Graph-backed EvalSet recursion service. Replaces the removed Postgres-backed
 * LegalBenchmarkRecursion enrollment routes.
 *
 * All operations key on the EvalSet node's `recursion` boolean attribute
 * (added in a sibling jarvis-backend change — may not be live on every swarm
 * until that change ships; see zero-node log signal below).
 */

import type { JarvisConnectionConfig } from "@/types/jarvis";
import {
  searchNodesByAttributes,
  updateNode,
  checkNodeByKey,
} from "@/services/swarm/api/nodes";
import { logger } from "@/lib/logger";

// ── Normalized result shape ────────────────────────────────────────────────
// Both underlying helpers return different shapes; we map everything onto this
// single contract so callers never branch on two incompatible results.

export interface RecursionServiceResult {
  ok: boolean;
  nodes?: RecursionEvalSetEntry[];
  error?: string;
}

/** Whitelisted node shape — only these fields are surfaced to callers. */
export interface RecursionEvalSetEntry {
  ref_id: string;
  /** Task-slug / node_key — pulled from node.properties.id (distinct from ref_id). */
  id: string;
  name: string;
  /**
   * Stakwork project_id from the last dispatched eval run, written back by the cron.
   * Null when the attribute is absent (older node or schema mismatch — attribute may
   * not yet be live on every swarm; see zero-node / possibly-missing-attribute pattern).
   */
  projectId?: number | string | null;
}

// ── listRecursionEvalSets ──────────────────────────────────────────────────

/**
 * Returns all EvalSet nodes where `recursion = true`.
 *
 * NOTE: `searchNodesByAttributes` returns `{ ok: true, nodes: [] }` (not an
 * error) when an attribute is unknown. An empty result therefore cannot be
 * distinguished from "the recursion attribute hasn't shipped to this swarm's
 * schema yet". We log a distinct signal in that case so it can be spotted in
 * production without a code change.
 */
export async function listRecursionEvalSets(
  config: JarvisConnectionConfig,
): Promise<RecursionServiceResult> {
  const result = await searchNodesByAttributes(config, {
    nodeTypes: ["EvalSet"],
    filters: [{ attribute: "recursion", value: true, comparator: "=" }],
    includeProperties: true,
  });

  if (!result.ok) {
    logger.warn("[legal/benchmarks/recursion] listRecursionEvalSets graph query failed", "legal", {
      status: result.status,
      error: result.error,
      endpointMissing: result.endpointMissing,
    });
    return { ok: false, error: result.error ?? "Graph query failed" };
  }

  if (result.nodes.length === 0) {
    // Distinct signal: zero nodes may indicate the attribute hasn't shipped yet
    // rather than a genuinely empty result — preserves a breadcrumb for the
    // known attribute-availability gap.
    logger.info(
      "[legal/benchmarks/recursion] listRecursionEvalSets returned zero nodes — " +
        "this may indicate the recursion attribute has not yet shipped to this swarm",
      "legal",
      { possibleMissingAttribute: true },
    );
  }

  const nodes: RecursionEvalSetEntry[] = result.nodes.map((node) => ({
    ref_id: node.ref_id,
    // node.properties.id holds the task-slug / node_key; fall back to ref_id
    // if the property is absent (older node or schema mismatch).
    id: node.properties?.id != null ? String(node.properties.id) : node.ref_id,
    name: node.properties?.name != null ? String(node.properties.name) : "",
    // project_id attribute may be absent on older nodes or before the schema ships.
    projectId: node.properties?.project_id != null
      ? (node.properties.project_id as number | string)
      : null,
  }));

  return { ok: true, nodes };
}

// ── writeBackEvalProjectId ─────────────────────────────────────────────────

/**
 * Writes back the Stakwork eval project_id onto an EvalSet node after a
 * successful dispatch. Called by the recursion cron so the next pass can
 * detect an already-running eval via live status instead of re-dispatching.
 *
 * Mirrors `setEvalSetRecursion`'s logging/error-handling shape.
 *
 * NOTE: Until the `project_id` attribute ships to the target swarm's schema,
 * `updateNode` may appear to succeed while no-op'ing — same caveat as
 * `setEvalSetRecursion`. The caller should log a CRITICAL if this keeps
 * failing after retries.
 */
export async function writeBackEvalProjectId(
  config: JarvisConnectionConfig,
  refId: string,
  projectId: number | string,
  namespace?: string,
): Promise<RecursionServiceResult> {
  logger.info(
    `[legal/benchmarks/recursion] writeBackEvalProjectId refId=${refId} projectId=${projectId} namespace=${namespace ?? "default"}`,
    "legal",
    { refId, projectId, namespace },
  );

  const result = await updateNode(
    config,
    {
      ref_id: refId,
      node_type: "EvalSet",
      node_data: { project_id: projectId },
    },
    namespace ? { namespace } : undefined,
  );

  if (!result.success) {
    logger.warn(
      `[legal/benchmarks/recursion] writeBackEvalProjectId failed refId=${refId}`,
      "legal",
      { refId, projectId, namespace, error: result.error },
    );
    return { ok: false, error: result.error ?? "Graph update failed" };
  }

  return { ok: true };
}

// ── enableRecursionForTaskSlug ─────────────────────────────────────────────

/**
 * Resolves the EvalSet `ref_id` for the given task-slug, then enables recursion on it.
 *
 * The resolve+toggle is done server-side in a single call so the client never
 * supplies a `ref_id` directly — the server derives it from the graph, scoped
 * to the authenticated workspace's swarm access.
 *
 * Returns:
 *  - `{ ok: true }` on success (idempotent — enabling an already-true flag is fine)
 *  - `{ ok: false, notFound: true }` when no EvalSet matches the task-slug
 *  - `{ ok: false, error: string }` on graph search or write failure
 */
export async function enableRecursionForTaskSlug(
  config: JarvisConnectionConfig,
  taskSlug: string,
): Promise<RecursionServiceResult & { notFound?: boolean }> {
  logger.info(
    `[legal/benchmarks/recursion] enableRecursionForTaskSlug taskSlug=${taskSlug}`,
    "legal",
    { taskSlug },
  );

  // Resolve EvalSet ref_id via jarvis's natural-key endpoint.
  // The slug is used as both the `key` and `namespace` (matching how
  // Stakwork workflow 57389 creates these nodes: namespace = task_slug).
  // Pass the raw slug — jarvis re-sanitizes it with the same node_key
  // template used at creation, so pre-sanitizing here would double-apply.
  const checkResult = await checkNodeByKey(config, {
    nodeType: "EvalSet",
    key: taskSlug,
    namespace: taskSlug,
  });

  if (!checkResult.ok) {
    // Transport failure, 400, or endpoint absent on this jarvis version —
    // surface as an error, never as a "not found". Collapsing these would
    // mask a broken lookup as a genuine miss (requirement #1).
    logger.warn(
      `[legal/benchmarks/recursion] enableRecursionForTaskSlug checkNodeByKey failed taskSlug=${taskSlug}`,
      "legal",
      {
        taskSlug,
        error: checkResult.error,
        status: checkResult.status,
        endpointMissing: checkResult.endpointMissing,
      },
    );
    return {
      ok: false,
      error: checkResult.error ?? `checkNodeByKey failed (status: ${checkResult.status ?? "unknown"})`,
    };
  }

  if (!checkResult.exists) {
    // Genuine miss: endpoint responded but no node matched this key+namespace.
    logger.info(
      `[legal/benchmarks/recursion] enableRecursionForTaskSlug no EvalSet found taskSlug=${taskSlug}`,
      "legal",
      { taskSlug },
    );
    return { ok: false, notFound: true, error: "EvalSet not found for task slug" };
  }

  const refId = checkResult.refId!;
  logger.info(
    `[legal/benchmarks/recursion] enableRecursionForTaskSlug resolved refId=${refId} namespace=${taskSlug}`,
    "legal",
    { taskSlug, refId, namespace: taskSlug },
  );

  return setEvalSetRecursion(config, refId, true, taskSlug);
}

// ── setEvalSetRecursion ────────────────────────────────────────────────────

/**
 * Sets the `recursion` attribute on an EvalSet node to `enabled`.
 *
 * NOTE: Until the `recursion` attribute ships to the target swarm's schema,
 * `updateNode` may appear to succeed while no-op'ing. The pre-merge gate in
 * the architecture doc covers this; do not merge before the attribute lands.
 */
export async function setEvalSetRecursion(
  config: JarvisConnectionConfig,
  refId: string,
  enabled: boolean,
  namespace?: string,
): Promise<RecursionServiceResult> {
  logger.info(
    `[legal/benchmarks/recursion] setEvalSetRecursion refId=${refId} enabled=${enabled} namespace=${namespace ?? "default"}`,
    "legal",
    { refId, enabled, namespace },
  );

  const result = await updateNode(
    config,
    {
      ref_id: refId,
      node_type: "EvalSet",
      node_data: { recursion: enabled },
    },
    namespace ? { namespace } : undefined,
  );

  if (!result.success) {
    logger.warn(
      `[legal/benchmarks/recursion] setEvalSetRecursion failed refId=${refId}`,
      "legal",
      { refId, enabled, namespace, error: result.error },
    );
    return { ok: false, error: result.error ?? "Graph update failed" };
  }

  return { ok: true };
}
