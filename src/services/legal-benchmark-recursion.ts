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
   * Stakwork project_id from the last dispatched eval run, written back by the cron.
   * Null when the attribute is absent (older node or schema mismatch — attribute may
   * not yet be live on every swarm; see zero-node / possibly-missing-attribute pattern).
   */
  projectId?: number | string | null;
  /**
   * Whether recursion is currently enabled on this EvalSet node.
   * Live-on hits (filtered by recursion=true) are reliably true even when the
   * property is absent from the serialized bag (via defaultRecursion: true).
   * Live-off hits default to false.
   */
  recursion?: boolean;
  /**
   * Present only on live-on rows (`recursion = true`). False list nodes omit it
   * so Runs-tab badges gated on `reason === "active"` stay live-only.
   */
  reason?: "active";
  /**
   * ISO timestamp of when the EvalSet node was added to the graph — its
   * top-level `date_added_to_graph`, converted at this boundary. Null when
   * the node predates the field.
   */
  dateAddedToGraph?: string | null;
  /**
   * Unix-epoch plateau-streak cutoff copied from the graph node. Not a selector
   * and not an enable flag — the cron reads this as a cutoff only.
   */
  recursionEnabledAt?: number | string | null;
}

export type RecursionListMode = "dispatch" | "list";

// ── listRecursionEvalSets ──────────────────────────────────────────────────

type GraphSearchNode = {
  ref_id: string;
  date_added_to_graph?: number | string;
  properties?: Record<string, unknown>;
};

/** Map a raw graph node to a `RecursionEvalSetEntry`. Omits `reason` when not provided. */
function toEntry(
  node: GraphSearchNode,
  reason?: RecursionEvalSetEntry["reason"],
  defaultRecursion?: boolean,
): RecursionEvalSetEntry {
  const entry: RecursionEvalSetEntry = {
    ref_id: node.ref_id,
    id: node.properties?.id != null ? String(node.properties.id) : node.ref_id,
    name: node.properties?.name != null ? String(node.properties.name) : "",
    projectId: node.properties?.project_id != null
      ? (node.properties.project_id as number | string)
      : null,
    recursion: (node.properties?.recursion as boolean | undefined) ?? defaultRecursion ?? false,
    dateAddedToGraph: graphEpochToIso(node.date_added_to_graph),
  };
  if (reason !== undefined) {
    entry.reason = reason;
  }
  if (node.properties && "recursionEnabledAt" in node.properties) {
    entry.recursionEnabledAt = node.properties.recursionEnabledAt as number | string | null;
  }
  return entry;
}

function searchRecursionEvalSets(config: JarvisConnectionConfig, value: boolean) {
  return searchNodesByAttributes(config, {
    nodeTypes: EVALSET_NODE_LABELS,
    filters: [{ attribute: "recursion", value, comparator: "=" }],
    includeProperties: true,
    skipCache: true,
  });
}

function logPossibleMissingAttribute(mode: RecursionListMode) {
  logger.info(
    "[legal/benchmarks/recursion] listRecursionEvalSets returned zero nodes — " +
      "this may indicate the recursion attribute has not yet shipped to this swarm",
    "legal",
    { possibleMissingAttribute: true, mode },
  );
}

/**
 * Returns EvalSet nodes for cron dispatch or the Recursion tab list.
 *
 *   `dispatch` — `recursion = true` only. Graph failure → `{ ok: false }`.
 *   `list`     — union of `recursion = true` and `recursion = false` on that
 *                one attribute, deduped by ref_id (true wins). Unset matches
 *                neither. True-query failure → `{ ok: false }`; false-query
 *                failure logs a warn and still returns the true nodes.
 *
 * `mode` is required — no default, no one-argument overload.
 *
 * NOTE: `searchNodesByAttributes` returns `{ ok: true, nodes: [] }` (not an
 * error) when an attribute is unknown. An empty `recursion=true` result
 * therefore cannot be distinguished from "the recursion attribute hasn't
 * shipped to this swarm's schema yet". We log a distinct signal when nothing
 * has proven the attribute exists: dispatch empty-true, or list when both
 * queries return empty.
 */
export async function listRecursionEvalSets(
  config: JarvisConnectionConfig,
  mode: RecursionListMode,
): Promise<RecursionServiceResult> {
  let trueResult: Awaited<ReturnType<typeof searchNodesByAttributes>>;
  try {
    trueResult = await searchRecursionEvalSets(config, true);
  } catch (err) {
    const error = err instanceof Error ? err.message : "Graph query failed";
    logger.warn("[legal/benchmarks/recursion] listRecursionEvalSets graph query failed", "legal", {
      error,
      mode,
    });
    return { ok: false, error };
  }

  if (!trueResult.ok) {
    logger.warn("[legal/benchmarks/recursion] listRecursionEvalSets graph query failed", "legal", {
      status: trueResult.status,
      error: trueResult.error,
      endpointMissing: trueResult.endpointMissing,
      mode,
    });
    return { ok: false, error: trueResult.error ?? "Graph query failed" };
  }

  if (mode === "dispatch") {
    if (trueResult.nodes.length === 0) {
      logPossibleMissingAttribute(mode);
    }
    return {
      ok: true,
      nodes: trueResult.nodes.map((n) => toEntry(n, "active", true)),
    };
  }

  let falseResult: Awaited<ReturnType<typeof searchNodesByAttributes>> | null = null;
  try {
    const result = await searchRecursionEvalSets(config, false);
    if (!result.ok) {
      logger.warn(
        "[legal/benchmarks/recursion] listRecursionEvalSets recursion=false query failed — returning live-on EvalSets",
        "legal",
        { status: result.status, error: result.error },
      );
    } else {
      falseResult = result;
    }
  } catch (err) {
    logger.warn(
      "[legal/benchmarks/recursion] listRecursionEvalSets recursion=false query failed — returning live-on EvalSets",
      "legal",
      { error: err instanceof Error ? err.message : String(err) },
    );
  }

  if (trueResult.nodes.length === 0 && falseResult !== null && falseResult.nodes.length === 0) {
    logPossibleMissingAttribute(mode);
  }

  const deduped = new Map<string, RecursionEvalSetEntry>();
  for (const n of trueResult.nodes) {
    deduped.set(n.ref_id, toEntry(n, "active", true));
  }
  for (const n of falseResult?.nodes ?? []) {
    if (deduped.has(n.ref_id)) continue;
    deduped.set(n.ref_id, toEntry(n, undefined, false));
  }

  return { ok: true, nodes: [...deduped.values()] };
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
