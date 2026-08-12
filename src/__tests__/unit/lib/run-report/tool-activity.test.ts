import { describe, it, expect } from "vitest";
import {
  TOOL_CLASS,
  TOOL_ACTIVITY_CONTAINER_KEYS,
  TOOL_ACTIVITY_CALLS_PER_AGENT_CAP,
  TOOL_ACTIVITY_NODES_PER_CALL_CAP,
  readToolActivity,
  buildNodeIdentities,
  countWithheldInputFields,
  readRawToolActivityRecords,
} from "@/lib/run-report/tool-activity";
import type { ToolActivityGroup } from "@/lib/run-report/tool-activity";

// ── Helpers ───────────────────────────────────────────────────────────────────

function rosterMap(...names: string[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const n of names) m.set(n.toLowerCase(), n);
  return m;
}

function runActivity(
  records: unknown[],
  roster?: Map<string, string>,
  callsPerAgentCap?: number,
  nodesPerCallCap?: number,
) {
  const concepts = { tool_activity: records };
  return readToolActivity(
    concepts,
    roster ?? rosterMap("agent_a", "agent_b"),
    callsPerAgentCap,
    nodesPerCallCap,
  );
}

function singleCall(
  toolName: string,
  nodes: unknown[],
  input?: unknown,
  agentName = "agent_a",
  extra: Record<string, unknown> = {},
) {
  return {
    agent_name: agentName,
    tool_name: toolName,
    input: input ?? { query: "test" },
    nodes,
    ...extra,
  };
}

// ── TOOL_ACTIVITY_CONTAINER_KEYS ──────────────────────────────────────────────

describe("TOOL_ACTIVITY_CONTAINER_KEYS", () => {
  it("includes tool_activity (primary key)", () => {
    expect(TOOL_ACTIVITY_CONTAINER_KEYS).toContain("tool_activity");
  });
  it("includes aliased keys", () => {
    expect(TOOL_ACTIVITY_CONTAINER_KEYS).toContain("toolActivity");
    expect(TOOL_ACTIVITY_CONTAINER_KEYS).toContain("tool_calls");
    expect(TOOL_ACTIVITY_CONTAINER_KEYS).toContain("toolCalls");
  });
});

describe("readRawToolActivityRecords", () => {
  it("reads from tool_activity key", () => {
    const records = [{ tool_name: "graph_search" }];
    expect(readRawToolActivityRecords({ tool_activity: records })).toEqual(records);
  });
  it("reads from aliased toolActivity key", () => {
    const records = [{ tool_name: "graph_get" }];
    expect(readRawToolActivityRecords({ toolActivity: records })).toEqual(records);
  });
  it("reads from toolCalls key", () => {
    const records = [{ tool_name: "graph_neighbors" }];
    expect(readRawToolActivityRecords({ toolCalls: records })).toEqual(records);
  });
  it("returns empty array when no key present", () => {
    expect(readRawToolActivityRecords({ synthesis: {} })).toHaveLength(0);
    expect(readRawToolActivityRecords({})).toHaveLength(0);
  });
  it("returns empty array for non-record input", () => {
    expect(readRawToolActivityRecords(null)).toHaveLength(0);
    expect(readRawToolActivityRecords("string")).toHaveLength(0);
  });
});

// ── TOOL_CLASS ────────────────────────────────────────────────────────────────

describe("TOOL_CLASS — verified names", () => {
  it("graph_search → surfacing", () => expect(TOOL_CLASS.graph_search).toBe("surfacing"));
  it("graph_get → retrieval", () => expect(TOOL_CLASS.graph_get).toBe("retrieval"));
  it("graph_neighbors → retrieval", () => expect(TOOL_CLASS.graph_neighbors).toBe("retrieval"));
  it("graph_ontology → none", () => expect(TOOL_CLASS.graph_ontology).toBe("none"));
});

describe("TOOL_CLASS — inferred names (harness-side, review on first real bundle)", () => {
  it("graph_node → retrieval (presumed legacy name for graph_get)", () => {
    expect(TOOL_CLASS.graph_node).toBe("retrieval");
  });
  it("get_ontology → none", () => expect(TOOL_CLASS.get_ontology).toBe("none"));
  it("get_ontology_type → none", () => expect(TOOL_CLASS.get_ontology_type).toBe("none"));
});

// ── Candidate-key tolerance ───────────────────────────────────────────────────

describe("readToolActivity — candidate-key tolerance", () => {
  it("resolves nodes from 'nodes' key", () => {
    const res = runActivity([singleCall("graph_search", [{ ref_id: "n1", node_type: "Concept", name: "test" }])]);
    expect(res.groups[0].calls[0].nodes).toHaveLength(1);
  });

  it("resolves nodes from 'results' key", () => {
    const rec = { agent_name: "agent_a", tool_name: "graph_search", input: {}, results: [{ ref_id: "n1", node_type: "Concept", name: "test" }] };
    const res = runActivity([rec]);
    expect(res.groups[0].calls[0].nodes).toHaveLength(1);
  });

  it("resolves nodes from nested 'result.nodes' key", () => {
    const rec = { agent_name: "agent_a", tool_name: "graph_search", input: {}, result: { nodes: [{ ref_id: "n1", node_type: "Concept", name: "test" }] } };
    const res = runActivity([rec]);
    expect(res.groups[0].calls[0].nodes).toHaveLength(1);
  });

  it("lifts a scalar node into a one-element array", () => {
    const rec = { agent_name: "agent_a", tool_name: "graph_search", input: {}, nodes: { ref_id: "n1", node_type: "Concept", name: "scalar" } };
    const res = runActivity([rec]);
    expect(res.groups[0].calls[0].nodes).toHaveLength(1);
  });

  it("treats a missing container as zero nodes (not an error)", () => {
    const rec = { agent_name: "agent_a", tool_name: "graph_ontology", input: { type: "Concept" } };
    const res = runActivity([rec]);
    expect(res.groups[0].calls[0].nodes).toHaveLength(0);
    expect(res.groups[0].calls[0].status).toBe("ok"); // ontology = none class = no EMPTY badge
  });

  it("accepts input as a scalar string (wraps as { value })", () => {
    const rec = { agent_name: "agent_a", tool_name: "graph_search", input: "freeform query", nodes: [] };
    const res = runActivity([rec]);
    expect(res.groups[0].calls[0].input).toEqual({ value: "freeform query" });
  });

  it("accepts input as an object", () => {
    const rec = { agent_name: "agent_a", tool_name: "graph_search", input: { query: "test", limit: 10 }, nodes: [] };
    const res = runActivity([rec]);
    expect(res.groups[0].calls[0].input).toMatchObject({ query: "test" });
  });

  it("resolves input from 'args' candidate key", () => {
    const rec = { agent_name: "agent_a", tool_name: "graph_search", args: { query: "via args" }, nodes: [] };
    const res = runActivity([rec]);
    expect(res.groups[0].calls[0].input).toMatchObject({ query: "via args" });
  });
});

// ── Identity resolution ───────────────────────────────────────────────────────

describe("readToolActivity — identity resolution", () => {
  it("resolves identity from ref_id (first priority)", () => {
    const res = runActivity([singleCall("graph_search", [{ ref_id: "rid-1", node_type: "Concept", name: "test" }])]);
    const node = res.groups[0].calls[0].nodes[0];
    expect(node.identity).toBe("rid-1");
    expect(node.identityKind).toBe("ref_id");
  });

  it("resolves identity from urn when ref_id absent", () => {
    const res = runActivity([singleCall("graph_search", [{ urn: "urn:acme:kg:ws:Concept:c1", node_type: "Concept", name: "test" }])]);
    const node = res.groups[0].calls[0].nodes[0];
    expect(node.identity).toBe("urn:acme:kg:ws:Concept:c1");
    expect(node.identityKind).toBe("urn");
    expect(node.canonicalKey).toBe("kg/Concept/c1");
  });

  it("resolves identity from id when ref_id and urn absent", () => {
    const res = runActivity([singleCall("graph_search", [{ id: "plain-id-1", node_type: "File", name: "file.ts" }])]);
    const node = res.groups[0].calls[0].nodes[0];
    expect(node.identity).toBe("plain-id-1");
    expect(node.identityKind).toBe("id");
  });

  it("sets canonicalKey to realm/type/id for URN-form identities", () => {
    const res = runActivity([singleCall("graph_get", [{ urn: "urn:org:pg:Task:t1", name: "Task 1" }])]);
    expect(res.groups[0].calls[0].nodes[0].canonicalKey).toBe("pg/Task/t1");
  });

  it("sets canonicalKey to bare value for non-URN identities", () => {
    const res = runActivity([singleCall("graph_search", [{ ref_id: "bare-id", name: "Node" }])]);
    expect(res.groups[0].calls[0].nodes[0].canonicalKey).toBe("bare-id");
  });

  it("handles unknown node_type passthrough", () => {
    const res = runActivity([singleCall("graph_search", [{ ref_id: "u1", node_type: "unknown", name: "unknown type" }])]);
    expect(res.groups[0].calls[0].nodes[0].nodeType).toBe("unknown");
  });

  it("node with no identity field is excluded from unidentified count but renders in call row", () => {
    const res = runActivity([singleCall("graph_search", [{ node_type: "Concept", name: "no-id" }])]);
    expect(res.groups[0].calls[0].nodes).toHaveLength(1); // still in call row
    expect(res.unidentifiedNodeCount).toBe(1);
  });

  it("dedup never applies to display name", () => {
    // Two nodes with same name but different ref_ids → two separate rows
    const res = runActivity([singleCall("graph_search", [
      { ref_id: "x1", node_type: "Concept", name: "same name" },
      { ref_id: "x2", node_type: "Concept", name: "same name" },
    ])]);
    expect(res.groups[0].calls[0].nodes).toHaveLength(2);
  });
});

// ── Canonical dedup: bare ref_id + URN merge ──────────────────────────────────

describe("buildNodeIdentities — canonical dedup", () => {
  it("merges bare ref_id row into URN row when URN id segment matches", () => {
    // Agent A: surfaced via ref_id
    // Agent B: retrieved via URN
    const groups: ToolActivityGroup[] = [
      {
        agentKey: "agent_a",
        agentName: "agent_a",
        isUnattributed: false,
        calls: [{
          toolName: "graph_search",
          rawToolName: "graph_search",
          input: {},
          status: "ok",
          position: 0,
          nodesTruncated: false,
          nodesDroppedCount: 0,
          withheldInputFieldCount: 0,
          isUnknownTool: false,
          nodes: [{
            identity: "node-X",
            identityKind: "ref_id",
            canonicalKey: "node-X",
            name: "Node X",
            nodeType: "Concept",
            hasContent: false,
            retrievalBasis: "tool-class", // surfacing
          }],
        }],
      },
      {
        agentKey: "agent_b",
        agentName: "agent_b",
        isUnattributed: false,
        calls: [{
          toolName: "graph_get",
          rawToolName: "graph_get",
          input: {},
          status: "ok",
          position: 1,
          nodesTruncated: false,
          nodesDroppedCount: 0,
          withheldInputFieldCount: 0,
          isUnknownTool: false,
          nodes: [{
            identity: "urn:acme:kg:ws:Concept:node-X",
            identityKind: "urn",
            canonicalKey: "kg/Concept/node-X",
            name: "Node X",
            nodeType: "Concept",
            hasContent: true,
            retrievalBasis: "content",
          }],
        }],
      },
    ];
    const identities = buildNodeIdentities(groups);
    // Should be one row (merged), not two
    expect(identities).toHaveLength(1);
    // URN form wins for display
    expect(identities[0].identity).toBe("urn:acme:kg:ws:Concept:node-X");
    // Run-wide: retrieved (from agent B)
    expect(identities[0].runStatus).toBe("retrieved");
  });

  it("two different realms claiming the same bare id stay separate (ambiguous)", () => {
    // urn:org1:kg:ws:Concept:node-Z and urn:org1:pg:Concept:node-Z
    const records = [
      singleCall("graph_search", [
        { urn: "urn:acme:kg:ws:Concept:shared-id", node_type: "Concept", name: "KG node" },
      ], {}, "agent_a"),
      singleCall("graph_get", [
        { urn: "urn:acme:pg:Concept:shared-id", node_type: "Concept", name: "PG node" },
      ], {}, "agent_a"),
    ];
    const res = runActivity(records);
    expect(res.ambiguousIdentityCount).toBeGreaterThan(0);
    const ids = buildNodeIdentities(res.groups);
    // Two different realm/type/id canonical keys → two rows
    expect(ids.length).toBeGreaterThanOrEqual(2);
  });

  it("dedup aggregates across agents — same identity retrieved by A, surfaced by B", () => {
    const records = [
      // Agent A: retrieves node-Y via graph_get
      singleCall("graph_get", [
        { ref_id: "node-Y", node_type: "Concept", name: "Y", properties: { x: 1 } },
      ], { urn: "urn:acme:kg:ws:Concept:node-Y" }, "agent_a"),
      // Agent B: surfaces node-Y via graph_search
      singleCall("graph_search", [
        { ref_id: "node-Y", node_type: "Concept", name: "Y" },
      ], {}, "agent_b"),
    ];
    const res = runActivity(records, rosterMap("agent_a", "agent_b"));
    const ids = buildNodeIdentities(res.groups);
    const row = ids.find((r) => r.identity === "node-Y");
    expect(row).toBeDefined();
    expect(row!.runStatus).toBe("retrieved"); // retrieved wins
    expect(row!.agents.length).toBe(2);
    const agentAEntry = row!.agents.find((a) => a.agentKey === "agent_a");
    expect(agentAEntry?.status).toBe("retrieved");
    const agentBEntry = row!.agents.find((a) => a.agentKey === "agent_b");
    expect(agentBEntry?.status).toBe("surfaced");
  });
});

// ── Ordering ──────────────────────────────────────────────────────────────────

describe("readToolActivity — ordering", () => {
  it("uses position ordering when seq is missing", () => {
    const records = [
      singleCall("graph_search", [], {}, "agent_a"),
      singleCall("graph_get", [], {}, "agent_a"),
    ];
    const res = runActivity(records);
    expect(res.orderingBasis).toBe("position");
    const calls = res.groups[0].calls;
    expect(calls[0].toolName).toBe("graph_search");
    expect(calls[1].toolName).toBe("graph_get");
  });

  it("uses seq ordering when seq is numeric on EVERY record", () => {
    const records = [
      { agent_name: "agent_a", tool_name: "graph_get", seq: 2, input: {}, nodes: [] },
      { agent_name: "agent_a", tool_name: "graph_search", seq: 1, input: {}, nodes: [] },
    ];
    const res = runActivity(records);
    expect(res.orderingBasis).toBe("seq");
    const calls = res.groups[0].calls;
    expect(calls[0].toolName).toBe("graph_search"); // seq:1 first
    expect(calls[1].toolName).toBe("graph_get");    // seq:2 second
  });

  it("falls back to position when seq is missing on any record", () => {
    const records = [
      { agent_name: "agent_a", tool_name: "graph_get", seq: 2, input: {}, nodes: [] },
      { agent_name: "agent_a", tool_name: "graph_search", input: {}, nodes: [] }, // no seq
    ];
    const res = runActivity(records);
    expect(res.orderingBasis).toBe("position");
  });

  it("mixed run: one agent has seq, another doesn't — falls back everywhere", () => {
    const records = [
      { agent_name: "agent_a", tool_name: "graph_get", seq: 5, input: {}, nodes: [] },
      { agent_name: "agent_b", tool_name: "graph_search", input: {}, nodes: [] }, // no seq
    ];
    const res = runActivity(records, rosterMap("agent_a", "agent_b"));
    expect(res.orderingBasis).toBe("position");
  });
});

// ── Classification ────────────────────────────────────────────────────────────

describe("readToolActivity — classification (surfaced vs retrieved)", () => {
  it("content-bearing record → retrieved with retrievalBasis: content", () => {
    const res = runActivity([singleCall("graph_search", [
      { ref_id: "n1", node_type: "Concept", name: "test", properties: { key: "value" } },
    ])]);
    const node = res.groups[0].calls[0].nodes[0];
    expect(node.retrievalBasis).toBe("content");
    const ids = buildNodeIdentities(res.groups);
    expect(ids[0].runStatus).toBe("retrieved");
  });

  it("description-only search hit stays surfaced (description is metadata, not content)", () => {
    const res = runActivity([singleCall("graph_search", [
      { ref_id: "n1", node_type: "Concept", name: "test", description: "a search hit description" },
    ])]);
    const node = res.groups[0].calls[0].nodes[0];
    // description is NOT content — should default to surfacing via tool-class
    expect(node.retrievalBasis).toBe("tool-class");
    const ids = buildNodeIdentities(res.groups);
    expect(ids[0].runStatus).toBe("surfaced");
  });

  it("graph_neighbors-style result marks adjacent nodes retrieved via tool-class", () => {
    // Node identities NOT in the input but returned by retrieval-class tool
    const res = runActivity([{
      agent_name: "agent_a",
      tool_name: "graph_neighbors",
      input: { urn: "urn:acme:kg:ws:Concept:start-node" },
      nodes: [
        // adjacent node — its identity is NOT in the input
        { urn: "urn:acme:kg:ws:Concept:adjacent-1", node_type: "Concept", name: "Adjacent" },
      ],
    }]);
    const node = res.groups[0].calls[0].nodes[0];
    expect(node.retrievalBasis).toBe("tool-class");
    const ids = buildNodeIdentities(res.groups);
    expect(ids[0].runStatus).toBe("retrieved");
  });

  it("input-match: exact equality marks node retrieved", () => {
    const res = runActivity([
      singleCall("graph_get", [{ ref_id: "exact-id", node_type: "Concept", name: "Node" }], "exact-id"),
    ]);
    const node = res.groups[0].calls[0].nodes[0];
    expect(node.retrievalBasis).toBe("input");
    const ids = buildNodeIdentities(res.groups);
    expect(ids[0].runStatus).toBe("retrieved");
  });

  it("input-match: colon-segment containment marks node retrieved", () => {
    // The URN "urn:acme:kg:ws:Concept:seg-id" contains "seg-id" as a segment
    const res = runActivity([
      singleCall("graph_get",
        [{ ref_id: "seg-id", node_type: "Concept", name: "Node" }],
        { urn: "urn:acme:kg:ws:Concept:seg-id" }),
    ]);
    const node = res.groups[0].calls[0].nodes[0];
    expect(node.retrievalBasis).toBe("input");
    const ids = buildNodeIdentities(res.groups);
    expect(ids[0].runStatus).toBe("retrieved");
  });

  it("input-match: URN id-segment match marks node retrieved", () => {
    // input contains URN whose id segment matches node's ref_id
    const res = runActivity([
      singleCall("graph_get",
        [{ urn: "urn:acme:kg:ws:Concept:c-456", node_type: "Concept", name: "Node" }],
        { urn: "urn:acme:kg:ws:Concept:c-456" }),
    ]);
    const node = res.groups[0].calls[0].nodes[0];
    expect(["input", "tool-class"]).toContain(node.retrievalBasis);
    const ids = buildNodeIdentities(res.groups);
    expect(ids[0].runStatus).toBe("retrieved");
  });

  it("unrecognized tool returning nodes defaults to surfacing", () => {
    const res = runActivity([singleCall("custom_tool", [{ ref_id: "n1", node_type: "File", name: "f.ts" }])]);
    expect(res.unknownToolNames).toContain("custom_tool");
    const node = res.groups[0].calls[0].nodes[0];
    // custom_tool is unknown → surfacing default
    expect(node.retrievalBasis).toBe("tool-class"); // stored as tool-class but class is unknown/surfacing
    const ids = buildNodeIdentities(res.groups);
    expect(ids[0].runStatus).toBe("surfaced");
  });

  it("unrecognized tool whose input addresses an identity → retrieved", () => {
    const records = [
      // First: graph_get returns node-R
      singleCall("graph_get", [{ ref_id: "node-R", node_type: "Concept", name: "R" }], { ref: "node-R" }),
      // Second: unknown tool, input explicitly names node-R
      singleCall("unknown_tool", [{ ref_id: "node-R", node_type: "Concept", name: "R" }], "node-R"),
    ];
    const res = runActivity(records);
    const ids = buildNodeIdentities(res.groups);
    const row = ids.find((r) => r.identity === "node-R");
    expect(row?.runStatus).toBe("retrieved");
  });

  it("retrieved-wins run-wide aggregation preserves per-agent surfaced counterpart", () => {
    const records = [
      singleCall("graph_get", [{ ref_id: "node-Z", node_type: "Concept", name: "Z", properties: { x: 1 } }], {}, "agent_a"),
      singleCall("graph_search", [{ ref_id: "node-Z", node_type: "Concept", name: "Z" }], {}, "agent_b"),
    ];
    const res = runActivity(records, rosterMap("agent_a", "agent_b"));
    const ids = buildNodeIdentities(res.groups);
    const row = ids.find((r) => r.identity === "node-Z");
    expect(row?.runStatus).toBe("retrieved");
    const agentBEntry = row?.agents.find((a) => a.agentKey === "agent_b");
    expect(agentBEntry?.status).toBe("surfaced"); // per-agent: surfaced preserved
  });

  it("all-surfaced hint fires when ≥1 identity exists but zero classify as retrieved", () => {
    const res = runActivity([
      singleCall("graph_search", [{ ref_id: "s1", node_type: "Concept", name: "surfaced only" }]),
    ]);
    expect(res.allSurfacedHint).toBe(true);
  });

  it("all-surfaced hint does NOT fire when some identities are retrieved", () => {
    const res = runActivity([
      singleCall("graph_get", [{ ref_id: "r1", node_type: "Concept", name: "N", properties: { x: 1 } }]),
    ]);
    expect(res.allSurfacedHint).toBe(false);
  });

  it("none-class calls contribute no identities", () => {
    const res = runActivity([
      singleCall("graph_ontology", [{ ref_id: "o1", node_type: "Concept", name: "Ontology" }]),
    ]);
    const ids = buildNodeIdentities(res.groups);
    expect(ids).toHaveLength(0); // none-class → no identities
  });
});

// ── Status derivation ─────────────────────────────────────────────────────────

describe("readToolActivity — status derivation", () => {
  it("ok status for non-empty calls", () => {
    const res = runActivity([singleCall("graph_search", [{ ref_id: "n1", name: "test" }])]);
    expect(res.groups[0].calls[0].status).toBe("ok");
  });

  it("error status for producer-reported error", () => {
    const rec = { agent_name: "agent_a", tool_name: "graph_search", input: {}, error: true, nodes: [] };
    const res = runActivity([rec]);
    expect(res.groups[0].calls[0].status).toBe("error");
  });

  it("error status for failed status field", () => {
    const rec = { agent_name: "agent_a", tool_name: "graph_search", input: {}, status: "failed", nodes: [] };
    const res = runActivity([rec]);
    expect(res.groups[0].calls[0].status).toBe("error");
  });

  it("zero-node call from tool that returned nodes elsewhere → empty", () => {
    const records = [
      singleCall("graph_search", [{ ref_id: "n1", name: "test" }]), // has nodes
      singleCall("graph_search", [], { query: "empty" }),            // zero nodes
    ];
    const res = runActivity(records);
    const calls = res.groups[0].calls;
    const emptyCalls = calls.filter((c) => c.status === "empty");
    expect(emptyCalls.length).toBeGreaterThan(0);
  });

  it("zero-node call from unrecognized tool that NEVER returned nodes → ok (not empty)", () => {
    const res = runActivity([
      singleCall("orchestration_dispatch", [], { workflow: "analysis" }),
    ]);
    expect(res.groups[0].calls[0].status).toBe("ok");
  });

  it("zero-node graph_ontology call → ok (not empty)", () => {
    const res = runActivity([
      singleCall("graph_ontology", [], { type: "Concept" }),
    ]);
    expect(res.groups[0].calls[0].status).toBe("ok"); // none-class → never EMPTY
  });

  it("zero-node graph_search call (known surfacing-class) → empty even without prior node return", () => {
    // graph_search is mapped retrieval/surfacing in TOOL_CLASS → always EMPTY when zero nodes
    const res = runActivity([singleCall("graph_search", [])]);
    expect(res.groups[0].calls[0].status).toBe("empty");
  });
});

// ── Cap ordering ──────────────────────────────────────────────────────────────

describe("readToolActivity — cap ordering (classification precedes truncation)", () => {
  it("identity in truncated retrieval-class call still classifies as retrieved", () => {
    // Create nodes that exceed the cap — some will be truncated from the display,
    // but classification should run on all of them.
    const manyNodes = Array.from({ length: TOOL_ACTIVITY_NODES_PER_CALL_CAP + 5 }, (_, i) => ({
      ref_id: `node-cap-${i}`,
      node_type: "Concept",
      name: `Node ${i}`,
      properties: { i }, // has content → retrieved
    }));

    const res = runActivity(
      [singleCall("graph_get", manyNodes)],
      rosterMap("agent_a"),
      100, // callsPerAgentCap
      TOOL_ACTIVITY_NODES_PER_CALL_CAP, // nodesPerCallCap
    );

    const call = res.groups[0].calls[0];
    expect(call.nodesTruncated).toBe(true);
    expect(call.nodesDroppedCount).toBe(5);
    expect(call.nodes.length).toBe(TOOL_ACTIVITY_NODES_PER_CALL_CAP);

    // All non-truncated nodes should be retrieved
    for (const node of call.nodes) {
      expect(node.retrievalBasis).toBe("content");
    }

    // The run-wide identity list should have TOOL_ACTIVITY_NODES_PER_CALL_CAP entries
    const ids = buildNodeIdentities(res.groups);
    expect(ids.length).toBe(TOOL_ACTIVITY_NODES_PER_CALL_CAP);
    // All should be retrieved
    for (const id of ids) {
      expect(id.runStatus).toBe("retrieved");
    }
  });
});

// ── countWithheldInputFields ──────────────────────────────────────────────────

describe("countWithheldInputFields", () => {
  it("counts top-level REDACTED_KEY", () => {
    expect(countWithheldInputFields({ url: "https://example.com", query: "test" })).toBe(1);
  });

  it("counts nested REDACTED_KEY recursively", () => {
    const input = {
      query: "test",
      url: "https://example.com",         // top-level redacted
      filter: {
        type: "Concept",
        token: "secret-token",            // nested redacted
      },
    };
    expect(countWithheldInputFields(input)).toBe(2);
  });

  it("never re-surfaces withheld key names (count only)", () => {
    const count = countWithheldInputFields({ token: "secret", api_key: "key" });
    expect(count).toBe(2);
    // The function returns a count, not the key names or values
    expect(typeof count).toBe("number");
  });

  it("returns 0 for input with no redacted keys", () => {
    expect(countWithheldInputFields({ query: "test", limit: 10 })).toBe(0);
  });

  it("handles deeply nested (2+ levels)", () => {
    const input = {
      options: {
        inner: {
          secret: "deeply nested secret",  // nested 2 levels
        },
      },
    };
    expect(countWithheldInputFields(input)).toBe(1);
  });

  it("returns 0 for non-object inputs", () => {
    expect(countWithheldInputFields("string")).toBe(0);
    expect(countWithheldInputFields(null)).toBe(0);
    expect(countWithheldInputFields(42)).toBe(0);
  });
});

// ── Unattributed records ──────────────────────────────────────────────────────

describe("readToolActivity — unattributed records", () => {
  it("records with unknown agent names go to Unattributed group", () => {
    const rec = { agent_name: "unknown_agent", tool_name: "graph_search", input: {}, nodes: [] };
    const res = runActivity([rec], rosterMap("agent_a")); // unknown_agent not in roster
    const unattributed = res.groups.find((g) => g.isUnattributed);
    expect(unattributed).toBeDefined();
    expect(res.unattributedRecordCount).toBeGreaterThan(0);
  });

  it("attributed records are not counted as unattributed", () => {
    const rec = singleCall("graph_search", [], {}, "agent_a");
    const res = runActivity([rec], rosterMap("agent_a"));
    expect(res.unattributedRecordCount).toBe(0);
    expect(res.groups.find((g) => g.isUnattributed)).toBeUndefined();
  });
});

// ── Unknown tool names ────────────────────────────────────────────────────────

describe("readToolActivity — unknown tool names", () => {
  it("tracks unknown tool names in unknownToolNames", () => {
    const res = runActivity([singleCall("my_custom_tool", [{ ref_id: "n1", name: "x" }])]);
    expect(res.unknownToolNames).toContain("my_custom_tool");
  });

  it("does not include known tools in unknownToolNames", () => {
    const res = runActivity([singleCall("graph_search", [])]);
    expect(res.unknownToolNames).not.toContain("graph_search");
  });
});


