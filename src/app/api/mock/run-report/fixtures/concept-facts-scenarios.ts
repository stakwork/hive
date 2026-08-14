/**
 * PROVISIONAL — see fixtures/reference/CONTRACT.md.
 *
 * Scenario fixtures for concept-facts tests:
 *  - Ontology-only tool_activity (all none-class calls)
 *  - Identities-present bundle (node_identities alongside tool_activity)
 *  - Name-collision (two identities sharing a display name)
 *  - has_content tri-state (true / false / absent)
 */

import { FULL_BUNDLE } from "./full";

type Bundle = Record<string, unknown>;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * Ontology-only run: all tool_activity records are graph_ontology calls.
 * buildNodeIdentities returns [] because none-class calls contribute no
 * identities. deriveAllSurfacedHint must use the all-calls denominator and
 * return false (no identified nodes at all → hint does NOT fire).
 */
export const ONTOLOGY_ONLY: Bundle = (() => {
  const b = clone(FULL_BUNDLE) as Bundle;
  b.concepts = {
    tool_activity: [
      {
        agent_name: "cross_check_agent",
        tool_name: "graph_ontology",
        input: { type: "Concept" },
        nodes: [],
      },
      {
        agent_name: "cross_check_agent",
        tool_name: "graph_ontology",
        input: { type: "Person" },
        nodes: [],
      },
    ],
  };
  return b;
})();

/**
 * Ontology-only run WITH node_identities present in the bundle.
 * Tests that deriveAllSurfacedHint switches to the identity-set denominator
 * when identities exist, and returns false (all retrieved in this fixture).
 */
export const ONTOLOGY_WITH_IDENTITIES: Bundle = (() => {
  const b = clone(FULL_BUNDLE) as Bundle;
  b.concepts = {
    tool_activity: [
      {
        agent_name: "cross_check_agent",
        tool_name: "graph_ontology",
        input: { type: "Concept" },
        nodes: [],
      },
    ],
    // Bundle also carries a pre-derived identity: one retrieved node.
    node_identities: [
      {
        identity: "node-onto-01",
        identity_kind: "ref_id",
        name: "ontology_concept",
        node_type: "Concept",
        run_status: "retrieved",
        run_basis: "tool-class",
        agents: [
          { agentKey: "cross_check_agent", count: 1, status: "retrieved", basis: "tool-class" },
        ],
      },
    ],
  };
  return b;
})();

/**
 * Name-collision fixture: two identities sharing the display name
 * "shared_concept" reached via different identity kinds (ref_id and urn).
 *
 * Used to assert:
 *  - deriveTopConcepts().byName merges them into ONE ConceptPull
 *  - deriveTopConcepts().perIdentity keeps TWO ConceptPulls
 *  - The rendered "Top retrieved concepts (N of M read · K surfaced-only)"
 *    string is byte-identical before and after the refactor.
 */
export const NAME_COLLISION: Bundle = (() => {
  const b = clone(FULL_BUNDLE) as Bundle;
  b.concepts = {
    tool_activity: [
      {
        agent_name: "cross_check_agent",
        tool_name: "graph_get",
        input: { ref_id: "node-shared-A" },
        nodes: [
          {
            ref_id: "node-shared-A",
            node_type: "Concept",
            name: "shared_concept",
            properties: { data: 1 },
          },
        ],
      },
      {
        agent_name: "drafter",
        tool_name: "graph_get",
        input: { urn: "urn:acme:kg:ws1:Concept:shared-B" },
        nodes: [
          {
            urn: "urn:acme:kg:ws1:Concept:shared-B",
            node_type: "Concept",
            name: "shared_concept",
            properties: { data: 2 },
          },
        ],
      },
    ],
  };
  return b;
})();

/**
 * has_content: true — node has `has_content: true`, must set retrievalBasis
 * to "content" even though no CONTENT_KEYS field is present.
 */
export const HAS_CONTENT_TRUE: Bundle = (() => {
  const b = clone(FULL_BUNDLE) as Bundle;
  b.concepts = {
    tool_activity: [
      {
        agent_name: "cross_check_agent",
        tool_name: "graph_get",
        input: { ref_id: "node-hc-true" },
        nodes: [
          {
            ref_id: "node-hc-true",
            node_type: "Concept",
            name: "has_content_true_node",
            has_content: true,
            // No CONTENT_KEYS fields (properties/body/content/text/snippet)
          },
        ],
      },
    ],
  };
  return b;
})();

/**
 * has_content: false — node has `has_content: false`, must NOT set
 * retrievalBasis to "content", and must NOT fall through to hasContentField
 * (which would misread the false value as content-present because any non-null
 * non-empty value passes the presence rule).
 *
 * Even though graph_get is a retrieval-class tool, the node should end up
 * retrieved via "tool-class" not "content".
 */
export const HAS_CONTENT_FALSE: Bundle = (() => {
  const b = clone(FULL_BUNDLE) as Bundle;
  b.concepts = {
    tool_activity: [
      {
        agent_name: "cross_check_agent",
        tool_name: "graph_get",
        // Input does NOT contain the node identity so the "input" tier
        // (Tier 2: isAddressedByInput) cannot fire.  Only the tool-class
        // tier (Tier 3: graph_get is "retrieval") applies — giving "tool-class"
        // as expected by the has_content:false test.
        input: { query: "test" },
        nodes: [
          {
            ref_id: "node-hc-false",
            node_type: "Concept",
            name: "has_content_false_node",
            has_content: false,
            // No CONTENT_KEYS fields
          },
        ],
      },
    ],
  };
  return b;
})();

/**
 * has_content: absent — no `has_content` key, no CONTENT_KEYS fields.
 * Must reproduce existing CONTENT_KEYS behaviour (hasContent: false,
 * since neither has_content nor any CONTENT_KEY is present).
 */
export const HAS_CONTENT_ABSENT: Bundle = (() => {
  const b = clone(FULL_BUNDLE) as Bundle;
  b.concepts = {
    tool_activity: [
      {
        agent_name: "cross_check_agent",
        tool_name: "graph_get",
        // Input does NOT contain the node identity so the "input" tier
        // (Tier 2: isAddressedByInput) cannot fire.  Only the tool-class
        // tier (Tier 3: graph_get is "retrieval") applies — giving "tool-class"
        // as expected by the has_content:absent test.
        input: { query: "test" },
        nodes: [
          {
            ref_id: "node-hc-absent",
            node_type: "Concept",
            name: "has_content_absent_node",
            // No has_content key, no CONTENT_KEYS fields
          },
        ],
      },
    ],
  };
  return b;
})();
