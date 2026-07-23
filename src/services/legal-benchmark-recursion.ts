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
}

/** Whitelisted node shape — only these fields are surfaced to callers. */
export interface RecursionEvalSetEntry {
  ref_id: string;
  /** Task-slug / node_key — pulled from node.properties.id (distinct from ref_id). */
  id: string;
  name: string;
  /**
   * Whether recursion is enabled on this EvalSet node.
   * Derived defensively — both raw boolean `true` and the string `"true"` are treated
   * as enabled, since Jarvis's loose typing makes a string-typed boolean return plausible.
   */
  recursion: boolean;
  /**
   * Stakwork project_id from the last dispatched eval run, written back by the cron.
   * Null when the attribute is absent (older node or schema mismatch — attribute may
   * not yet be live on every swarm; see zero-node / possibly-missing-attribute pattern).
   */
  projectId?: number | string | null;
}

// ── Shared mapping helper ──────────────────────────────────────────────────

/**
 * Maps a raw Jarvis node onto `RecursionEvalSetEntry`.
 *
 * Used by both `listRecursionEvalSets` and `listAllEvalSets` so `recursion`
 * is derived identically in both places.
 *
 * `recursion` is derived defensively: both raw boolean `true` and the string
 * `"true"` are treated as enabled (Jarvis's loose typing makes a string-typed
 * boolean return plausible — mirrors the `projectId: number | string` pattern
 * on the same interface). Anything else maps to `false`.
 */
function mapNodeToEntry(node: {
  ref_id: string;
  properties?: Record<string, unknown> | null;
}): RecursionEvalSetEntry {
  const props = node.properties ?? {};
  const recursionRaw = props.recursion;
  return {
    ref_id: node.ref_id,
    id: props.id != null ? String(props.id) : node.ref_id,
    name: props.name != null ? String(props.name) : "",
    recursion: recursionRaw === true || recursionRaw === "true",
    projectId: props.project_id != null
      ? (props.project_id as number | string)
      : null,
  };
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
    nodeTypes: EVALSET_NODE_LABELS,
    filters: [{ attribute: "recursion", value: true, comparator: "=" }],
    includeProperties: true,
    skipCache: true,
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

  const nodes: RecursionEvalSetEntry[] = result.nodes.map(mapNodeToEntry);

  return { ok: true, nodes };
}

// ── listAllEvalSets ────────────────────────────────────────────────────────

const LIST_ALL_LIMIT = 1000;

/**
 * Returns ALL EvalSet nodes in the workspace, regardless of their `recursion`
 * attribute value. Intended for the UI's Recursion tab so users can discover
 * and enable/disable recursion on any EvalSet.
 *
 * **Do NOT use as a replacement for `listRecursionEvalSets` in cron paths.**
 * The recursion cron (`executeScheduledLegalBenchmarkRecursion`) depends on
 * `listRecursionEvalSets`'s filtered (recursion=true) contract and would
 * silently re-dispatch evals against every EvalSet if switched to this function.
 *
 * Results are sorted deterministically by name (ascending) to prevent
 * poll-driven UI reordering when the list grows large.
 *
 * Logs a warning when the returned node count equals `LIST_ALL_LIMIT` — that
 * indicates possible silent truncation by the underlying search cap.
 */
export async function listAllEvalSets(
  config: JarvisConnectionConfig,
): Promise<RecursionServiceResult> {
  const result = await searchNodesByAttributes(config, {
    nodeTypes: EVALSET_NODE_LABELS,
    filters: [],
    includeProperties: true,
    skipCache: true,
    limit: LIST_ALL_LIMIT,
  });

  if (!result.ok) {
    logger.warn("[legal/benchmarks/recursion] listAllEvalSets graph query failed", "legal", {
      status: result.status,
      error: result.error,
      endpointMissing: result.endpointMissing,
    });
    return { ok: false, error: result.error ?? "Graph query failed" };
  }

  if (result.nodes.length === 0) {
    logger.info(
      "[legal/benchmarks/recursion] listAllEvalSets returned zero nodes — " +
        "no EvalSets exist in workspace",
      "legal",
      { workspaceHasNoEvalSets: true },
    );
  }

  if (result.nodes.length === LIST_ALL_LIMIT) {
    logger.warn(
      `[legal/benchmarks/recursion] listAllEvalSets returned ${LIST_ALL_LIMIT} nodes — ` +
        "result may have been truncated by the graph search cap; " +
        "some EvalSets may not be visible in the UI",
      "legal",
      { count: LIST_ALL_LIMIT, possibleTruncation: true },
    );
  }

  const nodes: RecursionEvalSetEntry[] = result.nodes
    .map(mapNodeToEntry)
    .sort((a, b) => a.name.localeCompare(b.name));

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

  const result = await updateNode(config, {
    ref_id: refId,
    node_type: "EvalSet",
    node_data: { recursion: enabled },
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
