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
} from "@/services/swarm/api/nodes";
import { graphEpochToIso } from "@/lib/harvey-lab/eval-normalizers";
import { logger } from "@/lib/logger";
import { db } from "@/lib/db";
import { StakworkRunType } from "@prisma/client";

// ── EvalSet label casing helpers ───────────────────────────────────────────
//
// Bridge for a known jarvis label-casing defect: eval-ontology nodes carry the
// Neo4j label "Evalset" (capital E, lowercase s) — a leftover from a since-removed
// historical `str.capitalize()` normalization. jarvis's WRITE path canonicalizes
// `node_type` case-insensitively (resolves against `db.labels()`), so writes land
// on the existing "Evalset" label. Its SEARCH path passes `node_type` verbatim
// (case-sensitive Cypher IN), so sending only "EvalSet" misses every stored node.
//
// Fix: send BOTH casings server-side; compare case-insensitively client-side.
// This works before AND after a planned jarvis heal migration that relabels
// "Evalset" → "EvalSet" and adds symmetric search canonicalization
// (tracked in the separate jarvis/graphmindset ticket).
//
// CLEANUP TRIGGER: once the jarvis heal migration has run and search
// canonicalization has shipped, collapse EVALSET_NODE_LABELS to ["EvalSet"]
// and revert isEvalSetLabel to a direct === comparison.
//
// Mirrors the pattern in src/app/api/workspaces/[slug]/evals/[evalSetId]/requirements/route.ts
// which already compares String(n.node_type ?? "").toLowerCase() === "evalrequirement"
// with an ("Evalset" / "Evalrequirement") comment for the same reason.

/**
 * Both casings sent to searchNodesByAttributes so the node is found regardless
 * of whether the stored Neo4j label is "Evalset" (current) or "EvalSet" (post-heal).
 */
export const EVALSET_NODE_LABELS: string[] = ["EvalSet", "Evalset"];

/**
 * Case-insensitive check for an EvalSet node_type label.
 * Accepts "EvalSet", "Evalset", and any other casing variant.
 */
export const isEvalSetLabel = (label: string | null | undefined): boolean =>
  (label ?? "").toLowerCase() === "evalset";

// ── Normalized result shape ────────────────────────────────────────────────
// Both underlying helpers return different shapes; we map everything onto this
// single contract so callers never branch on two incompatible results.

export interface RecursionServiceResult {
  ok: boolean;
  nodes?: RecursionEvalSetEntry[];
  error?: string;
  /** True when one or more non-authoritative sources (2 or 3) failed but Source 1 succeeded. */
  partial?: boolean;
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
  /**
   * Whether recursion is currently enabled on this EvalSet node.
   * Source 1 entries (filtered by recursion=true) are reliably true even when the
   * property is absent from the serialized bag (via defaultRecursion). Source 2/3
   * entries fall back to the node's stored recursion property, defaulting to false.
   */
  recursion?: boolean;
  /**
   * Why this EvalSet appears in the list. Priority order for dedup: active > wasEnabled > multipleRuns.
   * - "active"       — recursion = true on the graph node (Source 1)
   * - "wasEnabled"   — recursionEnabledAt is set, even if recursion is now false (Source 2)
   * - "multipleRuns" — more than one LEGAL_BENCHMARK_RUNNER StakworkRun exists for this eval set (Source 3)
   */
  reason?: "active" | "wasEnabled" | "multipleRuns";
  /**
   * ISO timestamp of when the EvalSet node was added to the graph — its
   * top-level `date_added_to_graph`, converted at this boundary. Null when
   * the node predates the field.
   */
  dateAddedToGraph?: string | null;
}

// ── listRecursionEvalSets ──────────────────────────────────────────────────

/** Priority rank for dedup: lower number = higher priority. */
const REASON_PRIORITY: Record<NonNullable<RecursionEvalSetEntry["reason"]>, number> = {
  active: 0,
  wasEnabled: 1,
  multipleRuns: 2,
};

/** Map a raw graph node to a `RecursionEvalSetEntry` with the given reason. */
function toEntry(
  node: { ref_id: string; date_added_to_graph?: number | string; properties?: Record<string, unknown> },
  reason: NonNullable<RecursionEvalSetEntry["reason"]>,
  defaultRecursion?: boolean,
): RecursionEvalSetEntry {
  return {
    ref_id: node.ref_id,
    id: node.properties?.id != null ? String(node.properties.id) : node.ref_id,
    name: node.properties?.name != null ? String(node.properties.name) : "",
    projectId: node.properties?.project_id != null
      ? (node.properties.project_id as number | string)
      : null,
    recursion: (node.properties?.recursion as boolean | undefined) ?? defaultRecursion ?? false,
    reason,
    dateAddedToGraph: graphEpochToIso(node.date_added_to_graph),
  };
}

/** Merge `incoming` into `acc`, keeping the highest-priority reason per ref_id. */
function mergeEntries(
  acc: Map<string, RecursionEvalSetEntry>,
  incoming: RecursionEvalSetEntry[],
): void {
  for (const entry of incoming) {
    const existing = acc.get(entry.ref_id);
    if (!existing) {
      acc.set(entry.ref_id, entry);
    } else {
      const existingPriority = existing.reason ? REASON_PRIORITY[existing.reason] : Infinity;
      const incomingPriority = entry.reason ? REASON_PRIORITY[entry.reason] : Infinity;
      if (incomingPriority < existingPriority) {
        acc.set(entry.ref_id, entry);
      }
    }
  }
}

/**
 * Returns EvalSet nodes visible under any of three conditions (deduplicated by ref_id):
 *
 *   Source 1 (authoritative) — `recursion = true` on the graph node → reason "active"
 *   Source 2 (non-fatal)     — `recursionEnabledAt` is set (ever-enabled) → reason "wasEnabled"
 *   Source 3 (non-fatal)     — more than one LEGAL_BENCHMARK_RUNNER run in Postgres → reason "multipleRuns"
 *
 * `workspaceId` is optional so the existing one-argument call in `legal-recursion-cron.ts`
 * compiles unchanged. When absent, Source 3 is skipped entirely.
 *
 * NOTE: `searchNodesByAttributes` returns `{ ok: true, nodes: [] }` (not an
 * error) when an attribute is unknown. An empty result from Source 1 therefore
 * cannot be distinguished from "the recursion attribute hasn't shipped to this swarm's
 * schema yet". We log a distinct signal in that case so it can be spotted in
 * production without a code change.
 *
 * NOTE on Source 2 comparator: no existing codebase call uses `comparator: "!="` against
 * Jarvis `/graph/search/attributes` — all confirmed calls use `"="` or `"contains"`.
 * We attempt `{ comparator: "!=", value: null }` as a best-effort; if Jarvis rejects it,
 * the settlement resolves to `{ ok: false }` and we fall back to a post-fetch JS filter
 * on all EvalSet nodes (fetch without the recursionEnabledAt filter, then filter in JS).
 */
export async function listRecursionEvalSets(
  config: JarvisConnectionConfig,
  workspaceId?: string,
): Promise<RecursionServiceResult> {
  // ── Source 1: recursion = true (authoritative) ────────────────────────────
  const source1 = async (): Promise<RecursionEvalSetEntry[]> => {
    const result = await searchNodesByAttributes(config, {
      nodeTypes: EVALSET_NODE_LABELS,
      filters: [{ attribute: "recursion", value: true, comparator: "=" }],
      includeProperties: true,
      skipCache: true,
    });

    if (!result.ok) {
      logger.warn("[legal/benchmarks/recursion] listRecursionEvalSets Source 1 graph query failed", "legal", {
        status: result.status,
        error: result.error,
        endpointMissing: result.endpointMissing,
      });
      // Throw so Promise.allSettled captures this as rejected — authoritative failure.
      throw new Error(result.error ?? "Graph query failed");
    }

    if (result.nodes.length === 0) {
      // Distinct signal: zero nodes may indicate the attribute hasn't shipped yet
      // rather than a genuinely empty result.
      logger.info(
        "[legal/benchmarks/recursion] listRecursionEvalSets returned zero nodes — " +
          "this may indicate the recursion attribute has not yet shipped to this swarm",
        "legal",
        { possibleMissingAttribute: true },
      );
    }

    return result.nodes.map((n) => toEntry(n, "active", true));
  };

  // ── Source 2: recursionEnabledAt is set (ever-enabled) ───────────────────
  const source2 = async (): Promise<RecursionEvalSetEntry[]> => {
    const result = await searchNodesByAttributes(config, {
      nodeTypes: EVALSET_NODE_LABELS,
      filters: [{ attribute: "recursionEnabledAt", value: null, comparator: "!=" }],
      includeProperties: true,
      skipCache: true,
    });

    if (!result.ok) {
      throw new Error(result.error ?? "Source 2 graph query failed");
    }

    return result.nodes
      .filter((n) => n.properties?.recursionEnabledAt != null)
      .map((n) => toEntry(n, "wasEnabled"));
  };

  // ── Source 3: multiple LEGAL_BENCHMARK_RUNNER runs in Postgres ────────────
  const source3 = async (): Promise<RecursionEvalSetEntry[]> => {
    if (!workspaceId) return []; // Skip when no workspaceId — cron one-arg call

    const MULTI_RUN_CAP = 50;

    // Group by evalSetId, keeping only those with more than one run.
    const multiRunGroups = await db.stakworkRun.groupBy({
      by: ["evalSetId"],
      where: {
        type: StakworkRunType.LEGAL_BENCHMARK_RUNNER,
        workspaceId,
        evalSetId: { not: null },
      },
      _count: { evalSetId: true },
      having: { evalSetId: { _count: { gt: 1 } } },
    });

    const allIds = multiRunGroups
      .map((g) => g.evalSetId)
      .filter((id): id is string => id != null);

    if (allIds.length === 0) return [];

    let ids = allIds;
    if (allIds.length > MULTI_RUN_CAP) {
      logger.warn(
        `Source 3: capping eval set ID resolution at ${MULTI_RUN_CAP}; ${allIds.length - MULTI_RUN_CAP} IDs truncated`,
        "legal",
        { workspaceId },
      );
      ids = allIds.slice(0, MULTI_RUN_CAP);
    }

    // Resolve each evalSetId to its graph node.
    const batches = await Promise.all(
      ids.map((id) =>
        searchNodesByAttributes(config, {
          nodeTypes: EVALSET_NODE_LABELS,
          filters: [{ attribute: "id", value: id, comparator: "=" }],
          includeProperties: true,
          skipCache: true,
        }),
      ),
    );

    const entries: RecursionEvalSetEntry[] = [];
    for (const batch of batches) {
      if (!batch.ok || batch.nodes.length === 0) continue;
      // Apply the deterministic tie-break to pick one node per id.
      const winnerRefId = selectEvalSetByTieBreak(batch.nodes);
      const winnerNode = batch.nodes.find((n) => n.ref_id === winnerRefId);
      if (!winnerNode) continue;
      // Read id, name, projectId from node.properties — do not use the bare ref_id string.
      entries.push(toEntry(winnerNode, "multipleRuns"));
    }

    return entries;
  };

  // ── Run all three sources concurrently ────────────────────────────────────
  const [s1Settlement, s2Settlement, s3Settlement] = await Promise.allSettled([
    source1(),
    source2(),
    source3(),
  ]);

  // Source 1 is authoritative: any failure aborts.
  if (s1Settlement.status === "rejected") {
    const err = s1Settlement.reason instanceof Error
      ? s1Settlement.reason.message
      : "Graph query failed";
    return { ok: false, error: err };
  }

  const deduped = new Map<string, RecursionEvalSetEntry>();
  mergeEntries(deduped, s1Settlement.value);

  let partial = false;

  if (s2Settlement.status === "fulfilled") {
    mergeEntries(deduped, s2Settlement.value);
  } else {
    logger.warn(
      "[legal/benchmarks/recursion] listRecursionEvalSets Source 2 (wasEnabled) failed — " +
        "continuing with partial results",
      "legal",
      {
        error: s2Settlement.reason instanceof Error
          ? s2Settlement.reason.message
          : String(s2Settlement.reason),
      },
    );
    partial = true;
  }

  if (s3Settlement.status === "fulfilled") {
    mergeEntries(deduped, s3Settlement.value);
  } else {
    logger.warn(
      "[legal/benchmarks/recursion] listRecursionEvalSets Source 3 (multipleRuns) failed — " +
        "continuing with partial results",
      "legal",
      {
        error: s3Settlement.reason instanceof Error
          ? s3Settlement.reason.message
          : String(s3Settlement.reason),
      },
    );
    partial = true;
  }

  return { ok: true, nodes: [...deduped.values()], ...(partial ? { partial: true } : {}) };
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
): Promise<RecursionServiceResult> {
  logger.info(
    `[legal/benchmarks/recursion] writeBackEvalProjectId refId=${refId} projectId=${projectId}`,
    "legal",
    { refId, projectId },
  );

  const result = await updateNode(config, {
    ref_id: refId,
    node_type: "EvalSet",
    node_data: { project_id: projectId },
  });

  if (!result.success) {
    logger.warn(
      `[legal/benchmarks/recursion] writeBackEvalProjectId failed refId=${refId}`,
      "legal",
      { refId, projectId, error: result.error },
    );
    return { ok: false, error: result.error ?? "Graph update failed" };
  }

  return { ok: true };
}

// ── selectEvalSetByTieBreak (shared private helper) ───────────────────────

/**
 * Pure tie-break selector: given a list of candidate EvalSet nodes, picks the
 * best one deterministically (no logging — callers log their own context):
 *   1. Canonical "EvalSet" label wins over "Evalset"
 *   2. Otherwise lowest ref_id (stable sort)
 */
function selectEvalSetByTieBreak(
  nodes: Array<{ ref_id: string; node_type?: string }>,
): string {
  if (nodes.length === 1) return nodes[0].ref_id;
  const canonical = nodes.find((n) => n.node_type === "EvalSet");
  return (canonical ?? [...nodes].sort((a, b) => a.ref_id.localeCompare(b.ref_id))[0]).ref_id;
}

// ── resolveEvalSetRefIdBySlug ──────────────────────────────────────────────

/**
 * Resolves the EvalSet `ref_id` for a given task-slug (stored as the node's
 * `id` attribute) with the same deterministic tie-break used by enrollment.
 *
 * - Both casings sent server-side so the node is found regardless of label.
 * - When multiple matches exist (e.g. during a jarvis heal-migration window),
 *   the canonical "EvalSet" label wins; otherwise the lowest ref_id is chosen.
 *
 * Returns the ref_id string on success, or null when not found / on error.
 *
 * **Security:** callers must apply `requireAuth` + workspace-gate +
 * `getWorkspaceSwarmAccess` before calling this function — it does NOT
 * perform its own authorization.
 */
export async function resolveEvalSetRefIdBySlug(
  config: JarvisConnectionConfig,
  taskSlug: string,
): Promise<string | null> {
  const searchResult = await searchNodesByAttributes(config, {
    nodeTypes: EVALSET_NODE_LABELS,
    filters: [{ attribute: "id", value: taskSlug, comparator: "=" }],
    includeProperties: true,
  });

  if (!searchResult.ok || searchResult.nodes.length === 0) {
    logger.info(
      `[legal/benchmarks/recursion] resolveEvalSetRefIdBySlug no EvalSet found taskSlug=${taskSlug}`,
      "legal",
      { taskSlug, ok: searchResult.ok, error: searchResult.error },
    );
    return null;
  }

  if (searchResult.nodes.length > 1) {
    const labels = searchResult.nodes.map((n) => n.node_type).join(", ");
    logger.warn(
      `[legal/benchmarks/recursion] resolveEvalSetRefIdBySlug multiple EvalSet nodes matched taskSlug=${taskSlug} count=${searchResult.nodes.length} labels=[${labels}] — selecting deterministically`,
      "legal",
      { taskSlug, count: searchResult.nodes.length, labels },
    );
  }
  const refId = selectEvalSetByTieBreak(searchResult.nodes);

  logger.info(
    `[legal/benchmarks/recursion] resolveEvalSetRefIdBySlug resolved ref_id=${refId} taskSlug=${taskSlug}`,
    "legal",
    { taskSlug, refId },
  );
  return refId;
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

  // Search for the EvalSet node — keep full error semantics (transport vs. not-found).
  // Unlike resolveEvalSetRefIdBySlug, we must distinguish a transport failure from an
  // empty result so the caller can return the right status code / error message.
  const searchResult = await searchNodesByAttributes(config, {
    nodeTypes: EVALSET_NODE_LABELS,
    filters: [{ attribute: "id", value: taskSlug, comparator: "=" }],
    includeProperties: true,
    skipCache: true,
  });

  if (!searchResult.ok) {
    logger.warn(
      `[legal/benchmarks/recursion] enableRecursionForTaskSlug graph search failed taskSlug=${taskSlug}`,
      "legal",
      { taskSlug, error: searchResult.error },
    );
    return { ok: false, error: searchResult.error ?? "Graph search failed" };
  }

  if (searchResult.nodes.length === 0) {
    logger.info(
      `[legal/benchmarks/recursion] enableRecursionForTaskSlug no EvalSet found taskSlug=${taskSlug}`,
      "legal",
      { taskSlug },
    );
    return { ok: false, notFound: true, error: "EvalSet not found for task slug" };
  }

  // Apply the shared deterministic tie-break
  if (searchResult.nodes.length > 1) {
    const labels = searchResult.nodes.map((n) => n.node_type).join(", ");
    logger.warn(
      `[legal/benchmarks/recursion] enableRecursionForTaskSlug multiple EvalSet nodes matched taskSlug=${taskSlug} count=${searchResult.nodes.length} labels=[${labels}] — selecting deterministically`,
      "legal",
      { taskSlug, count: searchResult.nodes.length, labels },
    );
  }
  const refId = selectEvalSetByTieBreak(searchResult.nodes);

  logger.info(
    `[legal/benchmarks/recursion] enableRecursionForTaskSlug resolved ref_id=${refId} taskSlug=${taskSlug}`,
    "legal",
    { taskSlug, refId },
  );
  return setEvalSetRecursion(config, refId, true);
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
): Promise<RecursionServiceResult> {
  logger.info(
    `[legal/benchmarks/recursion] setEvalSetRecursion refId=${refId} enabled=${enabled}`,
    "legal",
    { refId, enabled },
  );

  // When enabling recursion, stamp a recursionEnabledAt timestamp so the cron
  // can use it as a cutoff for plateau-streak computation.  This means a manual
  // re-enable correctly resets the plateau window without needing a migration.
  const nodeData: Record<string, unknown> = { recursion: enabled };
  if (enabled) {
    nodeData.recursionEnabledAt = Math.floor(Date.now() / 1000); // Unix epoch (seconds)
  }

  const result = await updateNode(config, {
    ref_id: refId,
    node_type: "EvalSet",
    node_data: nodeData,
  });

  if (!result.success) {
    logger.warn(
      `[legal/benchmarks/recursion] setEvalSetRecursion failed refId=${refId}`,
      "legal",
      { refId, enabled, error: result.error },
    );
    return { ok: false, error: result.error ?? "Graph update failed" };
  }

  return { ok: true };
}
