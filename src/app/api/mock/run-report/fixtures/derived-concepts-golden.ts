/**
 * PROVISIONAL — see fixtures/reference/CONTRACT.md.
 *
 * `derived-concepts-golden` — a small, hand-authored, frozen row set written
 * directly from the Hive row contract (NOT derived from Hive's own code).
 *
 * This is the drift detector for requirement 5. It is FOREIGN DATA: if Hive's
 * `readBundleNodeIdentities` rejects or misreads these rows, it signals that
 * Hive's rule has diverged from the producer's rule — the CI failure this
 * feature was built to surface.
 *
 * DO NOT re-derive or auto-generate this fixture. Keep it frozen.
 *
 * Rows covered:
 *  1. A URN-identity row (retrieved, single agent)
 *  2. A bare-ref_id row (surfaced, single agent)
 *  3. A multi-agent row (retrieved by one agent, surfaced by another)
 *  4. An unattributed-agent row (agent key not in roster → __unattributed__)
 *  5. Two rows sharing a display name via different identity kinds
 *     (tests that byName and perIdentity produce different counts)
 */

type NodeIdentityInput = {
  identity: string;
  identity_kind: "ref_id" | "urn" | "id";
  name: string | null;
  node_type: string | null;
  run_status: "retrieved" | "surfaced";
  run_basis: string | null;
  agents: Array<{
    agentKey: string;
    count: number;
    status: "retrieved" | "surfaced";
    basis: string;
  }>;
};

/** The raw `node_identities` array as a producer would emit it. */
export const GOLDEN_NODE_IDENTITIES: NodeIdentityInput[] = [
  // Row 1: URN identity, retrieved, single agent (cross_check_agent)
  {
    identity: "urn:acme:kg:ws1:Concept:law-001",
    identity_kind: "urn",
    name: "governing_law",
    node_type: "Concept",
    run_status: "retrieved",
    run_basis: "content",
    agents: [
      { agentKey: "cross_check_agent", count: 2, status: "retrieved", basis: "content" },
    ],
  },
  // Row 2: bare ref_id, surfaced only
  {
    identity: "node-surf-01",
    identity_kind: "ref_id",
    name: "termination_clause",
    node_type: "Concept",
    run_status: "surfaced",
    run_basis: null,
    agents: [
      { agentKey: "cross_check_agent", count: 1, status: "surfaced", basis: "tool-class" },
    ],
  },
  // Row 3: multi-agent row (retrieved by agent A, surfaced by agent B)
  {
    identity: "urn:acme:kg:ws1:Concept:clause-777",
    identity_kind: "urn",
    name: "indemnity_cap",
    node_type: "Concept",
    run_status: "retrieved",
    run_basis: "tool-class",
    agents: [
      { agentKey: "cross_check_agent", count: 3, status: "retrieved", basis: "tool-class" },
      { agentKey: "drafter", count: 1, status: "surfaced", basis: "tool-class" },
    ],
  },
  // Row 4: unattributed agent (agent key not in roster — must collapse to __unattributed__)
  {
    identity: "node-unattr-02",
    identity_kind: "ref_id",
    name: "force_majeure",
    node_type: "Concept",
    run_status: "retrieved",
    run_basis: "input",
    agents: [
      { agentKey: "unknown_agent_xyz", count: 1, status: "retrieved", basis: "input" },
    ],
  },
  // Row 5a: shares display name "shared_concept" via ref_id identity kind
  {
    identity: "node-shared-A",
    identity_kind: "ref_id",
    name: "shared_concept",
    node_type: "Concept",
    run_status: "retrieved",
    run_basis: "tool-class",
    agents: [
      { agentKey: "cross_check_agent", count: 2, status: "retrieved", basis: "tool-class" },
    ],
  },
  // Row 5b: shares display name "shared_concept" via URN identity kind
  {
    identity: "urn:acme:kg:ws1:Concept:shared-B",
    identity_kind: "urn",
    name: "shared_concept",
    node_type: "Concept",
    run_status: "retrieved",
    run_basis: "content",
    agents: [
      { agentKey: "drafter", count: 1, status: "retrieved", basis: "content" },
    ],
  },
];

/** A minimal concepts object with the golden node_identities. */
export const DERIVED_CONCEPTS_GOLDEN: Record<string, unknown> = {
  node_identities: GOLDEN_NODE_IDENTITIES,
};

/** Roster used when reading golden rows — must cover all non-unattributed agent keys. */
export const GOLDEN_ROSTER = new Map([
  ["cross_check_agent", "cross_check_agent"],
  ["drafter", "drafter"],
  // "unknown_agent_xyz" deliberately ABSENT to test __unattributed__ collapse
]);
