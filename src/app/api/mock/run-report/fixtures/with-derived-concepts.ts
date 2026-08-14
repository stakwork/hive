/**
 * `with-derived-concepts` — the WITH_TOOL_ACTIVITY bundle extended with
 * producer-supplied `concepts.nodeIdentities` and `concepts.topConcepts`,
 * programmatically derived from the same `tool_activity` records by running
 * Hive's own local derivation.
 *
 * Wire format: camelCase keys (`nodeIdentities`, `topConcepts`, `identityKind`,
 * `nodeType`, `runStatus`, `runBasis`) matching the live producer contract
 * (workflow 58019 / version 188497).
 *
 * Purpose: ROUND-TRIP assertion. Proves that `readBundleNodeIdentities`
 * faithfully reproduces a well-formed row set produced by Hive's own code.
 * This fixture deliberately CANNOT detect producer-vs-Hive drift — its input
 * is Hive's own output. For drift detection see `derived-concepts-golden.ts`.
 *
 * Derived by calling `readToolActivity` + `buildNodeIdentities` over the
 * WITH_TOOL_ACTIVITY `tool_activity` records. Do not hand-edit the
 * `nodeIdentities` entries below — re-derive if the base fixture changes.
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

  // nodeIdentities: serialize as the live producer wire shape (camelCase).
  // The reader in concept-facts.ts accepts both camelCase and snake_case;
  // emitting camelCase here makes the round-trip test exercise the live path.
  const nodeIdentities = identities.map((row) => ({
    identity: row.identity,
    identityKind: row.identityKind,
    name: row.name,
    nodeType: row.nodeType,
    runStatus: row.runStatus,
    runBasis: row.runBasis ?? null,
    agents: row.agents.map((a) => ({
      agentKey: a.agentKey,
      count: a.count,
      status: a.status,
      basis: a.basis,
    })),
  }));

  // topConcepts: Concept-typed retrieved identities sorted by total desc.
  // camelCase to match the live producer wire shape.
  const topConcepts = identities
    .filter((id) => id.nodeType === "Concept" && id.runStatus === "retrieved" && id.name)
    .map((id) => ({
      nodeType: id.nodeType,
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
    // camelCase container keys — the live producer wire format (workflow 58019 / v188497).
    // The strip loop in project.ts uses NODE_IDENTITIES_CONTAINER_KEYS /
    // TOP_CONCEPTS_CONTAINER_KEYS which include both spellings.
    nodeIdentities,
    topConcepts,
  };

  return b;
})();
