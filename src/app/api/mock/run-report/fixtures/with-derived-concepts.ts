/**
 * PROVISIONAL — field names inferred from architecture docs; upstream contract
 * not yet finalized. See fixtures/reference/CONTRACT.md.
 *
 * `with-derived-concepts` — the WITH_TOOL_ACTIVITY bundle extended with
 * producer-supplied `concepts.node_identities` and `concepts.top_concepts`,
 * programmatically derived from the same `tool_activity` records by running
 * Hive's own local derivation.
 *
 * Purpose: ROUND-TRIP assertion. Proves that `readBundleNodeIdentities`
 * faithfully reproduces a well-formed row set produced by Hive's own code.
 * This fixture deliberately CANNOT detect producer-vs-Hive drift — its input
 * is Hive's own output. For drift detection see `derived-concepts-golden.ts`.
 *
 * Derived by calling `readToolActivity` + `buildNodeIdentities` over the
 * WITH_TOOL_ACTIVITY `tool_activity` records. Do not hand-edit the
 * `node_identities` entries below — re-derive if the base fixture changes.
 */

import { WITH_TOOL_ACTIVITY } from "./with-tool-activity";
import { readToolActivity, buildNodeIdentities } from "@/lib/run-report/tool-activity";

type Bundle = Record<string, unknown>;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

// Build the derivation from the base fixture at module load time so it stays
// in sync with WITH_TOOL_ACTIVITY without manual maintenance.
function deriveIdentitiesAndConcepts(base: Bundle): {
  nodeIdentities: unknown[];
  topConcepts: unknown[];
} {
  const concepts = (base.concepts ?? {}) as Record<string, unknown>;

  // Roster: cross_check_agent + drafter (matches the fixture's agent_names)
  const rosterMap = new Map([
    ["cross_check_agent", "cross_check_agent"],
    ["drafter", "drafter"],
  ]);

  const result = readToolActivity(concepts, rosterMap);
  const identities = buildNodeIdentities(result.groups);

  // node_identities: serialize as the producer contract shape
  const nodeIdentities = identities.map((row) => ({
    identity: row.identity,
    identity_kind: row.identityKind,
    name: row.name,
    node_type: row.nodeType,
    run_status: row.runStatus,
    run_basis: row.runBasis ?? null,
    agents: row.agents.map((a) => ({
      agentKey: a.agentKey,
      count: a.count,
      status: a.status,
      basis: a.basis,
    })),
  }));

  // top_concepts: Concept-typed retrieved identities sorted by total desc
  const topConcepts = identities
    .filter((id) => id.nodeType === "Concept" && id.runStatus === "retrieved" && id.name)
    .map((id) => ({
      node_type: id.nodeType,
      name: id.name,
      total: id.agents.filter((a) => a.status === "retrieved").reduce((s, a) => s + a.count, 0) || 1,
    }))
    .sort((a, b) => b.total - a.total);

  return { nodeIdentities, topConcepts };
}

export const WITH_DERIVED_CONCEPTS: Bundle = (() => {
  const b = clone(WITH_TOOL_ACTIVITY) as Bundle;
  const base = clone(WITH_TOOL_ACTIVITY) as Bundle;

  const { nodeIdentities, topConcepts } = deriveIdentitiesAndConcepts(base);

  b.concepts = {
    ...(b.concepts as Record<string, unknown>),
    node_identities: nodeIdentities,
    top_concepts: topConcepts,
  };

  return b;
})();
