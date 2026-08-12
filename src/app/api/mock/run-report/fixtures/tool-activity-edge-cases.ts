/**
 * PROVISIONAL — field names inferred from architecture docs; upstream contract
 * not yet finalized. Assertions bind to normalizer behaviour, not to these
 * literal key spellings. See fixtures/reference/CONTRACT.md.
 *
 * `tool-activity-edge-cases` — the adversarial v2 run.
 *
 * Derived from FULL_BUNDLE via clone() + targeted mutation (per pattern in
 * fixtures/index.ts). Covers every defensive normalizer path.
 *
 * Covers:
 *  - A node with no identity field at all (unidentified counter)
 *  - A node with node_type: "unknown"
 *  - A REDACTED_KEYS key at top level AND nested in input (withheld count)
 *  - An unrecognized tool returning nodes (defaults to surfacing)
 *  - An unrecognized tool whose input addresses a known identity (rescued to retrieved)
 *  - An unrecognized tool that returns nothing anywhere in the run (status: ok, not empty)
 *  - A node name shaped like AKIAIOSFODNN7EXAMPLE (must survive verbatim — not a secret)
 *  - A call whose node array exceeds the nodes-per-call cap
 */

import { FULL_BUNDLE } from "./full";

type Bundle = Record<string, unknown>;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

// Generate N distinct nodes (for the cap-overflow test).
function makeNodes(count: number): unknown[] {
  return Array.from({ length: count }, (_, i) => ({
    ref_id: `cap-node-${i}`,
    node_type: "Concept",
    name: `Cap node ${i}`,
  }));
}

export const TOOL_ACTIVITY_EDGE_CASES: Bundle = (() => {
  const b = clone(FULL_BUNDLE) as Bundle;
  b.schema_version = 2;

  b.concepts = {
    tool_activity: [
      // ── Call 1: node with no identity field ──────────────────────────────
      // Must render in call row but be excluded from run-wide roll-up.
      // unidentifiedNodeCount should be incremented.
      {
        agent_name: "cross_check_agent",
        tool_name: "graph_search",
        input: { query: "test" },
        nodes: [
          // No ref_id, urn, node_id, or id — only name and node_type.
          { node_type: "unknown", name: "mystery node" },
        ],
      },

      // ── Call 2: node with node_type: "unknown" ───────────────────────────
      // Unknown node_type must pass through without error.
      {
        agent_name: "cross_check_agent",
        tool_name: "graph_get",
        input: { urn: "urn:acme:kg:ws1:unknown:node-U" },
        nodes: [
          { urn: "urn:acme:kg:ws1:unknown:node-U", node_type: "unknown", name: "unknown type node" },
        ],
      },

      // ── Call 3: REDACTED_KEYS at top level AND nested ────────────────────
      // Both "url" (top level) and nested "token" inside "filter" should count
      // into withheldInputFieldCount. The withheld keys must never appear in output.
      {
        agent_name: "cross_check_agent",
        tool_name: "graph_search",
        input: {
          query: "withheld fields test",
          url: "https://example.com/secret",    // REDACTED_KEY — top level
          filter: {
            type: "Concept",
            token: "secret-token-value",        // REDACTED_KEY — nested
          },
        },
        nodes: [
          { ref_id: "node-W", node_type: "Concept", name: "withheld test node" },
        ],
      },

      // ── Call 4: unrecognized tool returning nodes ─────────────────────────
      // Must default to surfacing (never overstate that something was read).
      // unknownToolNames should contain "custom_graph_lookup".
      {
        agent_name: "cross_check_agent",
        tool_name: "custom_graph_lookup",
        input: { id: "custom-query" },
        nodes: [
          { ref_id: "node-X", node_type: "File", name: "some-file.ts" },
        ],
      },

      // ── Call 5: unrecognized tool whose input addresses a known identity ──
      // The identity "node-W" appears in call 3's nodes. This call's input
      // explicitly addresses it — the node should be marked retrieved via
      // "input" tier (not just surfaced from the unrecognized tool default).
      {
        agent_name: "drafter",
        tool_name: "unknown_fetch_tool",
        input: {
          // Explicitly addresses node-W — rescues it to retrieved via input-match tier
          target: "node-W",
        },
        nodes: [
          { ref_id: "node-W", node_type: "Concept", name: "withheld test node" },
        ],
      },

      // ── Call 6: unrecognized tool that returns NOTHING anywhere in the run ─
      // Must render as status: ok with NO EMPTY badge.
      // (Only tools that have been observed returning nodes elsewhere get badged EMPTY.)
      {
        agent_name: "drafter",
        tool_name: "orchestration_dispatch",
        input: { workflow: "analysis" },
        nodes: [],
      },

      // ── Call 7: node name shaped like an AWS key ─────────────────────────
      // The token-shape sweep must NOT apply to node names/identities.
      // This name must survive verbatim (it's a legitimate identifier, not a secret).
      // See FULL_BUNDLE's AKIAIOSFODNN7EXAMPLE note.
      {
        agent_name: "drafter",
        tool_name: "graph_get",
        input: { urn: "urn:acme:kg:ws1:Concept:node-AKIA" },
        nodes: [
          {
            urn: "urn:acme:kg:ws1:Concept:node-AKIA",
            node_type: "Concept",
            // This AKIA-shaped name must NOT be scrubbed by the token-shape pass.
            name: "AKIAIOSFODNN7EXAMPLE",
          },
        ],
      },

      // ── Call 8: node array exceeds the per-call cap ───────────────────────
      // TOOL_ACTIVITY_NODES_PER_CALL_CAP = 100. This call has 150 nodes.
      // The call must be truncated to 100, nodesTruncated=true, nodesDroppedCount=50.
      // Classification must run on ALL 150 nodes before truncation so the run-wide
      // roll-up reflects the full evidence.
      {
        agent_name: "drafter",
        tool_name: "graph_search",
        input: { query: "bulk search that returns many results" },
        nodes: makeNodes(150),
      },
    ],
  };

  return b;
})();
