/**
 * PROVISIONAL — field names inferred from architecture docs; upstream contract
 * not yet finalized. Assertions bind to normalizer behaviour, not to these
 * literal key spellings. See fixtures/reference/CONTRACT.md.
 *
 * `with-tool-activity` — the normal v2 run.
 *
 * Derived from FULL_BUNDLE via clone() + targeted mutation so it cannot drift
 * out of sync with the base shape (per the pattern in fixtures/index.ts).
 *
 * Covers:
 *  - schema_version: 2 + concepts.tool_activity injected
 *  - An identity surfaced by graph_search then retrieved by graph_get
 *  - A graph_neighbors call returning adjacent identities absent from its input
 *  - The same identity pulled by two agents (cross-agent dedup)
 *  - An identity retrieved by agent A but only surfaced by agent B
 *  - The same node as a bare ref_id from one call and a composite URN from another
 *  - An ontology call returning no nodes (must NOT be badged EMPTY)
 *  - An errored record
 *  - A zero-node record from a tool that returns nodes elsewhere in the run
 *  - Non-concept types (File, Person) to prove no allowlist
 */

import { FULL_BUNDLE } from "./full";

type Bundle = Record<string, unknown>;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export const WITH_TOOL_ACTIVITY: Bundle = (() => {
  const b = clone(FULL_BUNDLE) as Bundle;
  b.schema_version = 2;

  b.concepts = {
    ...(b.concepts as Record<string, unknown>),
    tool_activity: [
      // ── Agent A: cross_check_agent ─────────────────────────────────────────

      // Call 1: graph_search — surfaces node-A (surfaced only for this agent)
      {
        agent_name: "cross_check_agent",
        tool_name: "graph_search",
        input: { query: "termination clause section 12.4" },
        nodes: [
          { ref_id: "node-A", node_type: "Concept", name: "termination_clause" },
          { ref_id: "node-B", node_type: "File",    name: "contract.docx" },
        ],
      },

      // Call 2: graph_get — retrieves node-A by identity (retrieved for agent A)
      {
        agent_name: "cross_check_agent",
        tool_name: "graph_get",
        input: { urn: "urn:acme:kg:ws1:Concept:node-A" },
        nodes: [
          {
            urn: "urn:acme:kg:ws1:Concept:node-A",
            node_type: "Concept",
            name: "termination_clause",
            properties: { definition: "Clause allowing unilateral termination" },
          },
        ],
      },

      // Call 3: graph_neighbors — returns adjacent identities absent from input
      // (node-C and node-D were never in the input — only node-A was)
      {
        agent_name: "cross_check_agent",
        tool_name: "graph_neighbors",
        input: { urn: "urn:acme:kg:ws1:Concept:node-A" },
        nodes: [
          { urn: "urn:acme:kg:ws1:Concept:node-C", node_type: "Concept", name: "indemnity_cap" },
          { urn: "urn:acme:kg:ws1:Person:node-D",  node_type: "Person",  name: "John Smith" },
        ],
      },

      // Call 4: graph_ontology — zero nodes, must NOT be badged EMPTY
      {
        agent_name: "cross_check_agent",
        tool_name: "graph_ontology",
        input: { type: "Concept" },
        nodes: [],
      },

      // Call 5: errored record
      {
        agent_name: "cross_check_agent",
        tool_name: "graph_search",
        input: { query: "governing law" },
        error: true,
        nodes: [],
      },

      // ── Agent B: drafter ────────────────────────────────────────────────────

      // Call 6: graph_search — surfaces node-A for agent B (only surfaced for B)
      {
        agent_name: "drafter",
        tool_name: "graph_search",
        input: { query: "termination" },
        nodes: [
          { ref_id: "node-A", node_type: "Concept", name: "termination_clause" },
        ],
      },

      // Call 7: graph_get — same node-A, now with composite URN form
      // The bare ref_id "node-A" from calls 1/6 and the URN from call 2 must dedup.
      // Also: node-E is the identity retrieved only by agent A via graph_neighbors
      // but surfaced here via graph_search — run-wide row must read "retrieved"
      // (retrieved wins).
      {
        agent_name: "drafter",
        tool_name: "graph_get",
        input: { urn: "urn:acme:kg:ws1:Concept:node-E" },
        nodes: [
          {
            urn: "urn:acme:kg:ws1:Concept:node-E",
            node_type: "Concept",
            name: "governing_law",
            properties: { jurisdiction: "New York" },
          },
        ],
      },

      // Call 8: graph_search — surfaces node-E (was retrieved by agent A, surfaced here)
      {
        agent_name: "drafter",
        tool_name: "graph_search",
        input: { query: "governing law New York" },
        nodes: [
          { ref_id: "node-E", node_type: "Concept", name: "governing_law" },
        ],
      },

      // Call 9: graph_search returning zero nodes — tool returned nodes elsewhere
      // in the run so this must be badged EMPTY (not ok).
      {
        agent_name: "drafter",
        tool_name: "graph_search",
        input: { query: "unlikely obscure query returns nothing" },
        nodes: [],
      },
    ],
  };

  return b;
})();
