/**
 * PROVISIONAL — see fixtures/reference/CONTRACT.md.
 *
 * Malformed `node_identities` variants used by concept-facts fallback tests.
 * Each entry exercises one rejection reason from readBundleNodeIdentities.
 */

/** One valid row used as a baseline in mutation-based tests. */
const VALID_ROW = {
  identity: "node-ok",
  identity_kind: "ref_id",
  name: "ok_node",
  node_type: "Concept",
  run_status: "surfaced",
  run_basis: null,
  agents: [
    { agentKey: "cross_check_agent", count: 1, status: "surfaced", basis: "tool-class" },
  ],
};

/** wrong top-level type (not an array) */
export const MALFORMED_WRONG_TYPE: Record<string, unknown> = {
  node_identities: { not: "an array" },
};

/** empty array */
export const MALFORMED_EMPTY_ARRAY: Record<string, unknown> = {
  node_identities: [],
};

/** missing agents[] */
export const MALFORMED_MISSING_AGENTS: Record<string, unknown> = {
  node_identities: [{ ...VALID_ROW, agents: undefined }],
};

/** empty agents[] */
export const MALFORMED_EMPTY_AGENTS: Record<string, unknown> = {
  node_identities: [{ ...VALID_ROW, agents: [] }],
};

/** malformed agent entry (missing count) */
export const MALFORMED_AGENT_NO_COUNT: Record<string, unknown> = {
  node_identities: [
    {
      ...VALID_ROW,
      agents: [{ agentKey: "cross_check_agent", status: "surfaced", basis: "tool-class" }],
    },
  ],
};

/** unresolvable identity_kind (unknown string) */
export const MALFORMED_BAD_IDENTITY_KIND: Record<string, unknown> = {
  node_identities: [{ ...VALID_ROW, identity_kind: "unknown_kind" }],
};

/** missing identity_kind */
export const MALFORMED_MISSING_IDENTITY_KIND: Record<string, unknown> = {
  node_identities: [{ ...VALID_ROW, identity_kind: undefined }],
};

/** inconsistent run_status/run_basis: retrieved with null basis */
export const MALFORMED_RETRIEVED_NULL_BASIS: Record<string, unknown> = {
  node_identities: [
    {
      ...VALID_ROW,
      run_status: "retrieved",
      run_basis: null,
      agents: [{ agentKey: "cross_check_agent", count: 1, status: "retrieved", basis: "content" }],
    },
  ],
};

/** inconsistent run_status/run_basis: surfaced with non-null basis */
export const MALFORMED_SURFACED_WITH_BASIS: Record<string, unknown> = {
  node_identities: [
    {
      ...VALID_ROW,
      run_status: "surfaced",
      run_basis: "content",
    },
  ],
};

/** retrieved run_status but no agent has retrieved status */
export const MALFORMED_RETRIEVED_NO_AGENT_RETRIEVED: Record<string, unknown> = {
  node_identities: [
    {
      ...VALID_ROW,
      run_status: "retrieved",
      run_basis: "tool-class",
      agents: [{ agentKey: "cross_check_agent", count: 1, status: "surfaced", basis: "tool-class" }],
    },
  ],
};

/** URN identity with identity_kind !== "urn" */
export const MALFORMED_URN_WRONG_KIND: Record<string, unknown> = {
  node_identities: [
    {
      ...VALID_ROW,
      identity: "urn:acme:kg:ws1:Concept:node-X",
      identity_kind: "ref_id",
    },
  ],
};

/**
 * Colliding canonical keys: two rows that produce the same canonical key
 * AFTER mergeIdentityRows (they are not a URN/bare-id pair, so they cannot
 * be merged — they are a true collision).
 */
export const MALFORMED_KEY_COLLISION: Record<string, unknown> = {
  node_identities: [
    { ...VALID_ROW, identity: "collision-key", identity_kind: "id" },
    { ...VALID_ROW, identity: "collision-key", identity_kind: "id", name: "duplicate" },
  ],
};
