/**
 * Concept-facts selector — single source-of-truth for node identities and
 * concept rankings.
 *
 * When a bundle carries `concepts.node_identities` / `concepts.top_concepts`,
 * this module reads and validates them; otherwise it falls back to the local
 * derivation from `buildNodeIdentities`. Both paths share the same ranking
 * helpers so rendered output is provably identical.
 *
 * ── Client-bundle constraint ──────────────────────────────────────────────────
 * This file is imported by chain.ts, which is imported by RunReportView.tsx
 * ("use client"). It must NOT import:
 *   - @/lib/logger     — server-only (uses pino)
 *   - ./project        — imports zod + sanitizeDocumentHtml → hast-util-from-html /
 *                        hast-util-sanitize, which must never reach the client bundle
 * Cap / limit values are received as parameters instead.
 */

import { parseUrn } from "@/lib/urn/parse";
import { isRecord } from "./derive";
import { redactSensitiveKeys } from "./redact";
import {
  buildNodeIdentities,
  mergeIdentityRows,
  toolClassOf,
} from "./tool-activity";
import type {
  NodeIdentityRow,
  ToolActivityGroup,
  IdentityKind,
  RetrievalStatus,
  RetrievalBasis,
} from "./tool-activity";
import type { ConceptPull } from "./chain";

// ── Candidate-key lists ───────────────────────────────────────────────────────

/**
 * Keys under which the producer may ship the pre-derived node-identity array.
 * Parallel to TOOL_ACTIVITY_CONTAINER_KEYS; no existing list covers this key.
 */
export const NODE_IDENTITIES_CONTAINER_KEYS = [
  "node_identities",
  "nodeIdentities",
] as const;

/**
 * Keys under which the producer may ship the pre-derived top-concepts list.
 * Parallel to TOOL_ACTIVITY_CONTAINER_KEYS; no existing list covers this key.
 */
export const TOP_CONCEPTS_CONTAINER_KEYS = [
  "top_concepts",
  "topConcepts",
] as const;

// ── Shared helpers ────────────────────────────────────────────────────────────

/** Valid values for identityKind as supplied by the producer. */
const VALID_IDENTITY_KINDS: ReadonlySet<string> = new Set<IdentityKind>([
  "ref_id",
  "urn",
  "id",
]);

/** Valid values for RetrievalStatus. */
const VALID_RUN_STATUSES: ReadonlySet<string> = new Set<RetrievalStatus>([
  "surfaced",
  "retrieved",
]);

/** Valid values for RetrievalBasis. */
const VALID_RUN_BASES: ReadonlySet<string> = new Set<RetrievalBasis>([
  "content",
  "input",
  "tool-class",
]);

/**
 * Resolve an agent key to a display name.
 *
 * Off-roster agent keys collapse to the `__unattributed__` synthetic group,
 * matching the behaviour in normalizeRecords (tool-activity.ts:602-620).
 * Extracted as a shared helper so both the bundle reader and the local path
 * apply the same rule — one decision, one place.
 */
export function resolveAgentLabel(
  agentKey: string,
  rosterMap: Map<string, string>,
): { resolvedKey: string; resolvedName: string } {
  const normalizedKey = agentKey.trim().toLowerCase();
  if (!normalizedKey) {
    return { resolvedKey: "__unattributed__", resolvedName: "Unattributed" };
  }
  if (rosterMap.has(normalizedKey)) {
    return { resolvedKey: normalizedKey, resolvedName: rosterMap.get(normalizedKey)! };
  }
  return { resolvedKey: "__unattributed__", resolvedName: "Unattributed" };
}

/**
 * Derive a canonical key from an identity string.
 *
 * Mirrors the local-path logic in resolveIdentity (tool-activity.ts:270-275):
 * URN → `realm/type/id`, else the identity string verbatim.
 */
function canonicalKeyOf(identity: string): string {
  const parsed = parseUrn(identity);
  return parsed ? `${parsed.realm}/${parsed.type}/${parsed.id}` : identity;
}

// ── Bundle reader ─────────────────────────────────────────────────────────────

interface BundleLimits {
  /** Maximum rows to accept before triggering cap-divergence rejection. */
  arrayCapRows: number;
  /** Whether any calls-per-agent truncation occurred in the parent run. */
  callsPerAgentTruncated: boolean;
  /** Whether any nodes-per-call truncation occurred in the parent run. */
  nodesPerCallTruncated: boolean;
}

type ReadBundleResult =
  | { rows: NodeIdentityRow[]; reason: null }
  | { rows: null; reason: string };

/**
 * Read and validate the producer-supplied `node_identities` array from the
 * raw concepts object.
 *
 * Every rejection reason lands on the local-derivation fallback for the whole
 * bundle (no per-row salvage, no merging of bundle and derived rows).
 *
 * Rows are constructed field-by-field from an explicit allowlist — the raw
 * object is never spread, so unrecognised producer fields are silently dropped
 * rather than emitted unredacted.
 *
 * Security note: `identity` on a `ref_id` row ultimately becomes the path
 * segment of an authenticated workspace graph fetch (one outbound request per
 * concept chip — chain.ts:315, ReportHeader.tsx:127).  Shape-validated here
 * even though the fetch route applies proper auth, so producer-controlled
 * strings can't mint arbitrary-looking downstream requests.
 */
export function readBundleNodeIdentities(
  rawConcepts: unknown,
  rosterMap: Map<string, string>,
  limits: BundleLimits,
): ReadBundleResult {
  if (!isRecord(rawConcepts)) return { rows: null, reason: "absent" };

  // Locate the container.
  let raw: unknown = undefined;
  for (const k of NODE_IDENTITIES_CONTAINER_KEYS) {
    if (k in (rawConcepts as Record<string, unknown>)) {
      raw = (rawConcepts as Record<string, unknown>)[k];
      break;
    }
  }
  if (raw === undefined) return { rows: null, reason: "absent" };
  if (!Array.isArray(raw)) return { rows: null, reason: "malformed-shape" };
  if (raw.length === 0) return { rows: null, reason: "malformed-shape" };

  // Cap-divergence check: if any Hive cap was hit, the bundle rows cannot be
  // reconciled with the locally-capped groups, so reject outright.
  // This is Hive's own invariant — bundle facts are only trusted when no
  // Hive cap applied to this run.
  if (limits.callsPerAgentTruncated || limits.nodesPerCallTruncated) {
    return { rows: null, reason: "cap-divergence" };
  }
  if (raw.length > limits.arrayCapRows) {
    return { rows: null, reason: "cap-divergence" };
  }

  const builtRows: NodeIdentityRow[] = [];

  for (const rawRow of raw) {
    if (!isRecord(rawRow)) return { rows: null, reason: "malformed-shape" };

    // ── identity_kind ──────────────────────────────────────────────────────
    const rawKind = (rawRow as Record<string, unknown>).identity_kind;
    if (typeof rawKind !== "string" || !VALID_IDENTITY_KINDS.has(rawKind)) {
      return { rows: null, reason: "unresolvable-identity-kind" };
    }
    const identityKind = rawKind as IdentityKind;

    // ── identity ────────────────────────────────────────────────────────────
    const rawIdentity = (rawRow as Record<string, unknown>).identity;
    if (typeof rawIdentity !== "string" || !rawIdentity.trim()) {
      return { rows: null, reason: "malformed-shape" };
    }
    const identityRaw = rawIdentity.trim();

    // URN-prefix / kind consistency
    if (identityRaw.startsWith("urn:") && identityKind !== "urn") {
      return { rows: null, reason: "unresolvable-identity-kind" };
    }

    // ref_id shape validation — security-relevant (see function JSDoc)
    if (identityKind === "ref_id") {
      // ref_id must not start with "urn:" and must not contain slashes or
      // control characters that could construct an unintended URL path.
      if (identityRaw.startsWith("urn:") || /[/\\\x00-\x1f]/.test(identityRaw)) {
        return { rows: null, reason: "malformed-shape" };
      }
    }
    if (identityKind === "urn" && !identityRaw.startsWith("urn:")) {
      return { rows: null, reason: "malformed-shape" };
    }

    const canonicalKey = canonicalKeyOf(identityRaw);

    // ── run_status / run_basis ─────────────────────────────────────────────
    const rawRunStatus = (rawRow as Record<string, unknown>).run_status;
    const rawRunBasis = (rawRow as Record<string, unknown>).run_basis;

    if (typeof rawRunStatus !== "string" || !VALID_RUN_STATUSES.has(rawRunStatus)) {
      return { rows: null, reason: "inconsistent-status" };
    }
    const runStatus = rawRunStatus as RetrievalStatus;

    // runBasis: non-null iff runStatus === "retrieved"
    let runBasis: RetrievalBasis | null = null;
    if (runStatus === "retrieved") {
      if (
        typeof rawRunBasis !== "string" ||
        !VALID_RUN_BASES.has(rawRunBasis)
      ) {
        return { rows: null, reason: "inconsistent-status" };
      }
      runBasis = rawRunBasis as RetrievalBasis;
    } else {
      // surfaced: runBasis must be null/absent
      if (rawRunBasis !== null && rawRunBasis !== undefined) {
        return { rows: null, reason: "inconsistent-status" };
      }
    }

    // ── agents[] ────────────────────────────────────────────────────────────
    const rawAgents = (rawRow as Record<string, unknown>).agents;
    if (!Array.isArray(rawAgents) || rawAgents.length === 0) {
      return { rows: null, reason: "missing-agents" };
    }

    // Validate and re-resolve agent entries through rosterMap.
    const mergedAgents = new Map<
      string,
      { agentKey: string; agentName: string; count: number; status: RetrievalStatus; basis: RetrievalBasis }
    >();
    let hasRetrievedAgent = false;

    for (const rawAgent of rawAgents) {
      if (!isRecord(rawAgent)) return { rows: null, reason: "missing-agents" };
      const rr = rawAgent as Record<string, unknown>;

      const rawAgentKey = rr.agentKey ?? rr.agent_key;
      if (typeof rawAgentKey !== "string") return { rows: null, reason: "missing-agents" };

      const rawCount = rr.count;
      if (typeof rawCount !== "number" || !Number.isFinite(rawCount) || rawCount < 0) {
        return { rows: null, reason: "missing-agents" };
      }

      const rawStatus = rr.status;
      if (typeof rawStatus !== "string" || !VALID_RUN_STATUSES.has(rawStatus)) {
        return { rows: null, reason: "missing-agents" };
      }
      const agentStatus = rawStatus as RetrievalStatus;

      const rawBasis = rr.basis;
      if (typeof rawBasis !== "string" || !VALID_RUN_BASES.has(rawBasis)) {
        return { rows: null, reason: "missing-agents" };
      }
      const agentBasis = rawBasis as RetrievalBasis;

      if (agentStatus === "retrieved") hasRetrievedAgent = true;

      // Re-resolve through roster — producer-supplied display labels are ignored.
      const { resolvedKey, resolvedName } = resolveAgentLabel(rawAgentKey, rosterMap);

      // Merge duplicate agent entries (off-roster keys both collapse to
      // __unattributed__ and their counts must be summed).
      const existing = mergedAgents.get(resolvedKey);
      if (existing) {
        existing.count += rawCount;
        if (agentStatus === "retrieved" && existing.status !== "retrieved") {
          existing.status = "retrieved";
          existing.basis = agentBasis;
        }
      } else {
        mergedAgents.set(resolvedKey, {
          agentKey: resolvedKey,
          agentName: resolvedName,
          count: rawCount,
          status: agentStatus,
          basis: agentBasis,
        });
      }
    }

    // Cross-check: retrieved runStatus requires ≥1 agent with retrieved status
    if (runStatus === "retrieved" && !hasRetrievedAgent) {
      return { rows: null, reason: "inconsistent-status" };
    }

    // ── name / node_type ────────────────────────────────────────────────────
    const rawName = (rawRow as Record<string, unknown>).name;
    const rawNodeType = (rawRow as Record<string, unknown>).node_type;
    const name = typeof rawName === "string" ? rawName || null : null;
    const nodeType = typeof rawNodeType === "string" ? rawNodeType || null : null;

    // ── Redaction ───────────────────────────────────────────────────────────
    // identity/name: identifier-class redaction (tokenShapes: false)
    // all other string fields: token-shape pass
    const redactedIdentity = redactSensitiveKeys(identityRaw) as string;
    const redactedName = name ? (redactSensitiveKeys(name) as string) : null;

    builtRows.push({
      canonicalKey,
      identity: redactedIdentity,
      identityKind,
      name: redactedName,
      nodeType,
      runStatus,
      runBasis,
      agents: [...mergedAgents.values()],
      // hasOffScreenEvidence is always false on bundle rows — correct because
      // any bundle where Hive's cap fired is rejected above (cap-divergence),
      // so no truncated evidence can exist on a surviving bundle row.
      hasOffScreenEvidence: false,
    });
  }

  // Pre-merge collision check: detect true duplicate canonical keys that are
  // NOT resolvable as a URN/bare-id pair.
  //
  // mergeIdentityRows is designed to merge same-canonical-key rows (it absorbs
  // bare-id rows into their URN counterpart, or merges duplicate URN rows).
  // For bundle rows, this merge is only valid when one row is a URN form and
  // the other is the bare-id peer with a matching id segment.  Two rows that
  // share a canonical key WITHOUT being a URN/bare-id pair are a true producer
  // collision — reject the entire bundle.
  //
  // We detect this before calling mergeIdentityRows so the rejection fires even
  // though mergeIdentityRows would silently combine them.
  {
    const keysSeen = new Map<string, string>(); // canonicalKey → identity
    for (const row of builtRows) {
      const prev = keysSeen.get(row.canonicalKey);
      if (prev !== undefined) {
        // Allowed only if one side is a URN and the other is the same bare id
        // (i.e., exactly the URN/bare-id pair that mergeIdentityRows handles).
        const prevIsUrn = prev.startsWith("urn:");
        const curIsUrn = row.identity.startsWith("urn:");
        if (prevIsUrn === curIsUrn) {
          // Both URN or both non-URN with same canonical key: true collision.
          return { rows: null, reason: "key-collision" };
        }
        // Mixed URN/non-URN pair: mergeIdentityRows will handle it correctly.
      } else {
        keysSeen.set(row.canonicalKey, row.identity);
      }
    }
  }

  // Post-build URN/bare-id merge (safe: pre-merge check above ensures only
  // legitimate URN/bare-id pairs share a canonical key at this point).
  const merged = mergeIdentityRows(builtRows);

  return { rows: merged, reason: null };
}

// ── Selector ──────────────────────────────────────────────────────────────────

interface SelectLimits {
  /** PROJECTION_ARRAY_CAP from project.ts — passed in to avoid importing project.ts. */
  arrayCapRows: number;
  /** Whether any calls-per-agent truncation occurred. */
  callsPerAgentTruncated: boolean;
  /** Whether any nodes-per-call truncation occurred. */
  nodesPerCallTruncated: boolean;
}

interface SelectResult {
  identities: NodeIdentityRow[];
  source: "bundle" | "derived";
  reason: string | null;
  /** Count of rows truncated by the array cap (local-derivation path only). */
  truncated: number;
}

interface SelectOptions {
  /**
   * Test seam: force a specific source engine over the same input so both
   * paths can be driven over one bundle without a real bundle/derived split.
   * Not used in production — presence-detection governs the production path.
   */
  forceSource?: "bundle" | "derived";
}

/**
 * Select node identities from the best available source.
 *
 * Presence-detects `concepts.node_identities`; on absence or any rejection
 * reason, falls back to `buildNodeIdentities(groups)` (source "derived").
 *
 * Both paths share `mergeIdentityRows`, so the URN/bare-id dedup rule is
 * applied identically regardless of source.
 */
export function selectNodeIdentities(
  rawConcepts: unknown,
  groups: ToolActivityGroup[],
  rosterMap: Map<string, string>,
  limits: SelectLimits,
  opts?: SelectOptions,
): SelectResult {
  const bundleLimits: BundleLimits = {
    arrayCapRows: limits.arrayCapRows,
    callsPerAgentTruncated: limits.callsPerAgentTruncated,
    nodesPerCallTruncated: limits.nodesPerCallTruncated,
  };

  const useDerived =
    opts?.forceSource === "derived" ||
    (opts?.forceSource !== "bundle" && (() => {
      // Quick presence check: is the container key present at all?
      if (!isRecord(rawConcepts)) return true;
      for (const k of NODE_IDENTITIES_CONTAINER_KEYS) {
        if (k in (rawConcepts as Record<string, unknown>)) return false;
      }
      return true;
    })());

  if (!useDerived && opts?.forceSource !== "derived") {
    const result = readBundleNodeIdentities(rawConcepts, rosterMap, bundleLimits);
    if (result.reason === null) {
      return {
        identities: result.rows,
        source: "bundle",
        reason: null,
        truncated: 0,
      };
    }
    // Rejection: fall through to derived.
    const derived = buildNodeIdentities(groups);
    const truncated = Math.max(0, derived.length - limits.arrayCapRows);
    return {
      identities: truncated > 0 ? derived.slice(0, limits.arrayCapRows) : derived,
      source: "derived",
      reason: result.reason,
      truncated,
    };
  }

  // Derived path (forceSource === "derived" OR no bundle field present)
  const derived = buildNodeIdentities(groups);
  const truncated = Math.max(0, derived.length - limits.arrayCapRows);
  return {
    identities: truncated > 0 ? derived.slice(0, limits.arrayCapRows) : derived,
    source: "derived",
    reason: null,
    truncated,
  };
}

// ── Concept rankings ──────────────────────────────────────────────────────────

export const CONCEPT_NODE_TYPES = new Set(["Concept"]);

/**
 * Derive two ranked concept lists from the selected node identities.
 *
 * Two projections exist because the two existing consumers compute different
 * things, and merging them would change rendered output:
 *
 *   `byName`      — aggregates identities sharing a display name (same concept
 *                   reached via different identity kinds) into one ConceptPull.
 *                   Used by chain.ts / ReportHeader.tsx ("top N of M read").
 *
 *   `perIdentity` — one ConceptPull per identity, no name merge.
 *                   Used by sections.tsx ConceptsSection
 *                   ("Top retrieved concepts (N of M read · K surfaced-only)").
 *
 * Both lists:
 *   - filter to CONCEPT_NODE_TYPES + runStatus === "retrieved"
 *   - sort by `total` desc with a deterministic tie-break on `nodeType` then
 *     `name`, so equal-total concepts never render in engine-dependent order
 */
export function deriveTopConcepts(identities: NodeIdentityRow[]): {
  byName: ConceptPull[];
  perIdentity: ConceptPull[];
} {
  const stableSort = (arr: ConceptPull[]): ConceptPull[] =>
    arr.sort(
      (a, b) =>
        b.total - a.total ||
        (a.nodeType ?? "").localeCompare(b.nodeType ?? "") ||
        a.name.localeCompare(b.name),
    );

  // byName
  const byNameMap = new Map<string, ConceptPull>();
  for (const identity of identities) {
    if (!CONCEPT_NODE_TYPES.has(identity.nodeType ?? "")) continue;
    if (!identity.name) continue;
    if (identity.runStatus !== "retrieved") continue;

    const key = `${identity.nodeType ?? ""}|${identity.name}`;
    const readAgents = identity.agents.filter((a) => a.status === "retrieved");
    const agentsForCount = readAgents.length > 0 ? readAgents : identity.agents;
    const total = agentsForCount.reduce((sum, a) => sum + a.count, 0) || 1;
    const refId = identity.identityKind === "ref_id" ? identity.identity : null;

    const existing = byNameMap.get(key);
    if (existing) {
      existing.total += total;
      existing.refId = existing.refId ?? refId;
      for (const a of agentsForCount) {
        const ea = existing.agents.find((x) => x.name === a.agentName);
        if (ea) ea.count += a.count;
        else existing.agents.push({ name: a.agentName, count: a.count });
      }
    } else {
      byNameMap.set(key, {
        name: identity.name,
        nodeType: identity.nodeType ?? null,
        total,
        agents: agentsForCount.map((a) => ({ name: a.agentName, count: a.count })),
        refId,
      });
    }
  }
  const byName = stableSort([...byNameMap.values()]);

  // perIdentity (one row per identity, no name merge — matches sections.tsx)
  const perIdentityArr: ConceptPull[] = [];
  for (const identity of identities) {
    if (!CONCEPT_NODE_TYPES.has(identity.nodeType ?? "")) continue;
    if (!identity.name) continue;
    if (identity.runStatus !== "retrieved") continue;

    const readAgents = identity.agents.filter((a) => a.status === "retrieved");
    const agentsForCount = readAgents.length > 0 ? readAgents : identity.agents;
    const total = agentsForCount.reduce((sum, a) => sum + a.count, 0) || 1;
    const refId = identity.identityKind === "ref_id" ? identity.identity : null;

    perIdentityArr.push({
      name: identity.name,
      nodeType: identity.nodeType ?? null,
      total,
      agents: agentsForCount.map((a) => ({ name: a.agentName, count: a.count })),
      refId,
    });
  }
  const perIdentity = stableSort(perIdentityArr);

  return { byName, perIdentity };
}

// ── allSurfacedHint ───────────────────────────────────────────────────────────

/**
 * Compute the "all surfaced" hint — true when identities exist but none are
 * retrieved.
 *
 * Two-denominator design (deliberate — documented here so it is a tested
 * property, not an accident):
 *
 *   - When `identities` is non-empty: count from the selected identity set.
 *     This is the normal path after `selectNodeIdentities`.
 *
 *   - When `identities` is empty: fall back to counting every identified node
 *     across all groups including `none`-class ontology calls.  Computing
 *     purely from identities would flip an ontology-only run from hint=true to
 *     hint=false with no bundle change, because `buildNodeIdentities` discards
 *     none-class calls.  The fallback preserves the existing behaviour for that
 *     case.
 *
 * Both sides are pinned by fixture tests, so the discontinuity is a tested
 * property not an accident.
 */
export function deriveAllSurfacedHint(
  identities: NodeIdentityRow[],
  groups: ToolActivityGroup[],
): boolean {
  if (identities.length > 0) {
    // Identity-set denominator: use the selected source.
    const anyRetrieved = identities.some((id) => id.runStatus === "retrieved");
    return !anyRetrieved;
  }

  // All-calls denominator: count every identified node including none-class.
  let totalIdentities = 0;
  let retrievedCount = 0;
  for (const g of groups) {
    for (const call of g.calls) {
      const cls = toolClassOf(call.toolName);
      for (const node of call.nodes) {
        if (!node.identity) continue;
        totalIdentities++;
        const isRetrieved =
          node.hasContent ||
          node.retrievalBasis === "input" ||
          (cls === "retrieval" && node.retrievalBasis === "tool-class");
        if (isRetrieved) retrievedCount++;
      }
    }
  }
  return totalIdentities > 0 && retrievedCount === 0;
}

// ── Top-concepts mismatch ─────────────────────────────────────────────────────

/**
 * Compare the bundle's `top_concepts` key set against the locally-derived list.
 *
 * Returns `true` (mismatch) only when the `(nodeType, name)` KEY SETS differ —
 * order-insensitive, total-insensitive, slice-insensitive.  Totals and ordering
 * may legitimately differ across two producers; set membership is the part that
 * carries meaning (a concept the producer counts as read but Hive does not is
 * the actual drift class).
 *
 * Returns `false` when the bundle carries no `top_concepts` field, or when the
 * sets are equal.
 */
export function compareTopConcepts(
  rawConcepts: unknown,
  derived: ConceptPull[],
): boolean {
  if (!isRecord(rawConcepts)) return false;

  let rawList: unknown = undefined;
  for (const k of TOP_CONCEPTS_CONTAINER_KEYS) {
    if (k in (rawConcepts as Record<string, unknown>)) {
      rawList = (rawConcepts as Record<string, unknown>)[k];
      break;
    }
  }
  if (!Array.isArray(rawList)) return false;

  // Build key sets
  const bundleKeys = new Set<string>();
  for (const item of rawList) {
    if (!isRecord(item)) continue;
    const nodeType = typeof item.node_type === "string" ? item.node_type : (typeof item.nodeType === "string" ? item.nodeType : "");
    const name = typeof item.name === "string" ? item.name : "";
    if (name) bundleKeys.add(`${nodeType}|${name}`);
  }

  const derivedKeys = new Set<string>();
  for (const pull of derived) {
    derivedKeys.add(`${pull.nodeType ?? ""}|${pull.name}`);
  }

  if (bundleKeys.size !== derivedKeys.size) return true;
  for (const k of bundleKeys) {
    if (!derivedKeys.has(k)) return true;
  }
  return false;
}
