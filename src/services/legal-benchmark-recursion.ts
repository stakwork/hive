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
  /** true when Sources 2 or 3 failed but Source 1 succeeded — callers still get 200 */
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
   * Why this EvalSet appears in the list. Highest-priority wins on dedup:
   *   "active"       — recursion=true on the graph node (authoritative)
   *   "wasEnabled"   — recursionEnabledAt is set, even if recursion is now false
   *   "multipleRuns" — more than one LEGAL_BENCHMARK_RUNNER StakworkRun in Postgres
   */
  reason?: "active" | "wasEnabled" | "multipleRuns";
}

// ── listRecursionEvalSets ──────────────────────────────────────────────────

/** Priority order for dedup — lower index = higher priority. */
const REASON_PRIORITY: RecursionEvalSetEntry["reason"][] = ["active", "wasEnabled", "multipleRuns"];

function reasonPriority(r: RecursionEvalSetEntry["reason"]): number {
  const idx = REASON_PRIORITY.indexOf(r);
  return idx === -1 ? Infinity : idx;
}

/** Map a raw JarvisGraphNode to a RecursionEvalSetEntry with a given reason. */
function mapEvalSetNode(
  node: { ref_id: string; properties?: Record<string, unknown> },
  reason: RecursionEvalSetEntry["reason"],
): RecursionEvalSetEntry {
  return {
    ref_id: node.ref_id,
    // node.properties.id holds the task-slug / node_key; fall back to ref_id
    // if the property is absent (older node or schema mismatch).
    id: node.properties?.id != null ? String(node.properties.id) : node.ref_id,
    name: node.properties?.name != null ? String(node.properties.name) : "",
    // project_id attribute may be absent on older nodes or before the schema ships.
    projectId: node.properties?.project_id != null
      ? (node.properties.project_id as number | string)
      : null,
    reason,
  };
}

/** Merge a list of entries into the dedup map, keeping the highest-priority reason. */
function mergeIntoMap(
  map: Map<string, RecursionEvalSetEntry>,
  entries: RecursionEvalSetEntry[],
): void {
  for (const entry of entries) {
    const existing = map.get(entry.ref_id);
    if (!existing || reasonPriority(entry.reason) < reasonPriority(existing.reason)) {
      map.set(entry.ref_id, entry);
    }
  }
}

/**
 * Returns EvalSet nodes that should appear in the Recursion tab, merging three sources:
 *
 *   Source 1 (authoritative): `recursion = true` on the graph node → reason "active"
 *   Source 2 (ever-enabled):  `recursionEnabledAt` is set (even if recursion is now false) → reason "wasEnabled"
 *   Source 3 (multi-run):     more than one LEGAL_BENCHMARK_RUNNER StakworkRun in Postgres
 *                             for the same evalSetId, scoped to `workspaceId` → reason "multipleRuns"
 *
 * Sources 2 and 3 are non-fatal — on failure the endpoint still returns 200 with Source 1
 * results and `partial: true`. Source 1 failure returns `{ ok: false }` as before.
 *
 * `workspaceId` is optional so the existing one-argument call in the recursion cron
 * compiles unchanged; Source 3 is skipped when absent.
 *
 * NOTE: `searchNodesByAttributes` returns `{ ok: true, nodes: [] }` (not an
 * error) when an attribute is unknown. An empty result therefore cannot be
 * distinguished from "the recursion attribute hasn't shipped to this swarm's
 * schema yet". We log a distinct signal in that case so it can be spotted in
 * production without a code change.
 */
export async function listRecursionEvalSets(
  config: JarvisConnectionConfig,
  workspaceId?: string,
): Promise<RecursionServiceResult> {
  // ── Source 1: recursion = true (authoritative) ───────────────────────────
  const source1Thunk = async () =>
    searchNodesByAttributes(config, {
      nodeTypes: EVALSET_NODE_LABELS,
      filters: [{ attribute: "recursion", value: true, comparator: "=" }],
      includeProperties: true,
      skipCache: true,
    });

  // ── Source 2: recursionEnabledAt is set (ever-enabled) ──────────────────
  // Passes `"!=" + null` to Jarvis `/graph/search/attributes` as a best-effort
  // "attribute exists" filter. If Jarvis rejects this comparator, the result
  // will be { ok: false } — treated as non-fatal (partial result).
  const source2Thunk = async () =>
    searchNodesByAttributes(config, {
      nodeTypes: EVALSET_NODE_LABELS,
      filters: [{ attribute: "recursionEnabledAt", value: null, comparator: "!=" }],
      includeProperties: true,
      skipCache: true,
    });

  // ── Source 3: >1 LEGAL_BENCHMARK_RUNNER runs per evalSetId ──────────────
  // Only executed when workspaceId is provided; scoped to that workspace to
  // prevent cross-workspace data leakage (IDOR-safe: workspaceId comes from
  // the caller's authenticated getWorkspaceSwarmAccess result).
  const source3Thunk = async (): Promise<RecursionEvalSetEntry[]> => {
    if (!workspaceId) return [];

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

    const ids = multiRunGroups
      .map((g) => g.evalSetId)
      .filter((id): id is string => id != null);

    if (ids.length === 0) return [];

    // Cap at 50 to avoid excessive graph round-trips.
    const CAP = 50;
    if (ids.length > CAP) {
      logger.warn(
        `[legal/benchmarks/recursion] Source 3: capping eval set ID resolution at ${CAP}; ${ids.length - CAP} IDs truncated`,
        "legal",
        { workspaceId },
      );
    }
    const cappedIds = ids.slice(0, CAP);

    // Resolve each evalSetId to an EvalSet graph node.
    const batches = await Promise.all(
      cappedIds.map((id) =>
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
      const winnerRefId = selectEvalSetByTieBreak(batch.nodes);
      const winnerNode = batch.nodes.find((n) => n.ref_id === winnerRefId) ?? batch.nodes[0];
      entries.push(mapEvalSetNode(winnerNode, "multipleRuns"));
    }
    return entries;
  };

  // ── Run all three sources concurrently ───────────────────────────────────
  // Each source is wrapped in an async thunk so synchronous throws are captured
  // as rejected settlements rather than escaping Promise.allSettled.
  const [s1Settlement, s2Settlement, s3Settlement] = await Promise.allSettled([
    source1Thunk(),
    source2Thunk(),
    source3Thunk(),
  ]);

  // Source 1 is authoritative — any failure aborts.
  if (s1Settlement.status === "rejected") {
    const err = s1Settlement.reason instanceof Error
      ? s1Settlement.reason.message
      : "Graph query failed";
    logger.warn("[legal/benchmarks/recursion] listRecursionEvalSets Source 1 threw", "legal", {
      error: err,
    });
    return { ok: false, error: err };
  }
  const s1Result = s1Settlement.value;
  if (!s1Result.ok) {
    logger.warn("[legal/benchmarks/recursion] listRecursionEvalSets graph query failed", "legal", {
      status: s1Result.status,
      error: s1Result.error,
      endpointMissing: s1Result.endpointMissing,
    });
    return { ok: false, error: s1Result.error ?? "Graph query failed" };
  }

  if (s1Result.nodes.length === 0) {
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

  // ── Dedup map: ref_id → entry, highest-priority reason wins ─────────────
  const dedupMap = new Map<string, RecursionEvalSetEntry>();
  mergeIntoMap(dedupMap, s1Result.nodes.map((n) => mapEvalSetNode(n, "active")));

  let partial = false;

  // Source 2 — non-fatal
  if (s2Settlement.status === "rejected") {
    const err = s2Settlement.reason instanceof Error
      ? s2Settlement.reason.message
      : "Graph query failed";
    logger.warn(
      "[legal/benchmarks/recursion] listRecursionEvalSets Source 2 (wasEnabled) failed",
      "legal",
      { error: err },
    );
    partial = true;
  } else if (!s2Settlement.value.ok) {
    logger.warn(
      "[legal/benchmarks/recursion] listRecursionEvalSets Source 2 (wasEnabled) returned ok:false",
      "legal",
      { status: s2Settlement.value.status, error: s2Settlement.value.error },
    );
    partial = true;
  } else {
    mergeIntoMap(dedupMap, s2Settlement.value.nodes.map((n) => mapEvalSetNode(n, "wasEnabled")));
  }

  // Source 3 — non-fatal
  if (s3Settlement.status === "rejected") {
    const err = s3Settlement.reason instanceof Error
      ? s3Settlement.reason.message
      : "DB or graph query failed";
    logger.warn(
      "[legal/benchmarks/recursion] listRecursionEvalSets Source 3 (multipleRuns) failed",
      "legal",
      { error: err, workspaceId },
    );
    partial = true;
  } else {
    mergeIntoMap(dedupMap, s3Settlement.value);
  }

  return {
    ok: true,
    nodes: [...dedupMap.values()],
    ...(partial ? { partial: true } : {}),
  };
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
    skipCache: true,
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
