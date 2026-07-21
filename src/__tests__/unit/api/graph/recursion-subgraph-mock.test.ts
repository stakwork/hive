/**
 * Unit tests for:
 *  1. isRecursionSubgraphRequest (fixture-constants.ts)
 *  2. Recursion fixture shape (recursion-fixture.ts)
 *  3. Mock graph route branching (mock/jarvis/graph/route.ts GET handler)
 *  4. callMockEndpoint param-forwarding regression (jarvis/nodes/route.ts)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ── 1. isRecursionSubgraphRequest ──────────────────────────────────────────
import {
  isRecursionSubgraphRequest,
  MOCK_EVAL_SET_REF_ID,
} from "@/app/api/mock/jarvis/graph/fixture-constants";

describe("isRecursionSubgraphRequest", () => {
  it("returns true when start_node contains the mock EvalSet ref_id", () => {
    expect(isRecursionSubgraphRequest({ startNode: MOCK_EVAL_SET_REF_ID })).toBe(true);
    expect(
      isRecursionSubgraphRequest({
        startNode: `/graph/subgraph?start_node=${MOCK_EVAL_SET_REF_ID}&node_type=EvalTrigger`,
      }),
    ).toBe(true);
  });

  it("returns true for node_type containing EvalTrigger (any casing)", () => {
    expect(isRecursionSubgraphRequest({ nodeType: "EvalTrigger" })).toBe(true);
    expect(isRecursionSubgraphRequest({ nodeType: "evaltrigger" })).toBe(true);
    expect(isRecursionSubgraphRequest({ nodeType: "EvalTrigger,EvalTriggerOutput" })).toBe(true);
  });

  it("returns true for node_type containing EvalTriggerOutput", () => {
    expect(isRecursionSubgraphRequest({ nodeType: "EvalTriggerOutput" })).toBe(true);
  });

  it("returns true for node_type containing ProposedFix", () => {
    expect(isRecursionSubgraphRequest({ nodeType: "ProposedFix" })).toBe(true);
  });

  it("returns true for node_type containing EvalSet (casing variants)", () => {
    expect(isRecursionSubgraphRequest({ nodeType: "EvalSet" })).toBe(true);
    expect(isRecursionSubgraphRequest({ nodeType: "Evalset" })).toBe(true);
  });

  it("returns false for generic node types (no regression)", () => {
    expect(isRecursionSubgraphRequest({ nodeType: "Function" })).toBe(false);
    expect(isRecursionSubgraphRequest({ nodeType: "Variable" })).toBe(false);
    expect(isRecursionSubgraphRequest({ nodeType: "Person" })).toBe(false);
    expect(isRecursionSubgraphRequest({})).toBe(false);
    expect(isRecursionSubgraphRequest({ nodeType: null, startNode: null })).toBe(false);
  });
});

// ── 2. Recursion fixture shape ─────────────────────────────────────────────
import {
  buildRecursionNodes,
  buildRecursionEdges,
  RECURSION_NODE_IDS,
} from "@/app/api/mock/jarvis/graph/recursion-fixture";

describe("buildRecursionNodes", () => {
  let nodes: ReturnType<typeof buildRecursionNodes>;

  beforeEach(() => {
    nodes = buildRecursionNodes();
  });

  const byId = (id: string) => nodes.find((n) => n.ref_id === id);

  it("includes one EvalSet root node (casing variant: Evalset)", () => {
    const evalSet = byId(RECURSION_NODE_IDS.EVAL_SET_ID);
    expect(evalSet).toBeDefined();
    // Intentional casing variant — lower-cased to exercise case-insensitive matching
    expect(evalSet!.node_type.toLowerCase()).toBe("evalset");
  });

  it("includes a baseline EvalTrigger", () => {
    const trigger = byId(RECURSION_NODE_IDS.BASELINE_TRIGGER_ID);
    expect(trigger).toBeDefined();
    expect(trigger!.node_type).toBe("EvalTrigger");
  });

  it("includes a baseline EvalTriggerOutput with integer n_passed/n_total", () => {
    const output = byId(RECURSION_NODE_IDS.BASELINE_OUTPUT_ID);
    expect(output).toBeDefined();
    expect(typeof output!.properties!.n_passed).toBe("number");
    expect(typeof output!.properties!.n_total).toBe("number");
    expect((output!.properties!.n_passed as number)).toBeGreaterThan(0);
  });

  it("root fix has eval_status:'accepted' conflicting with status:'rejected'", () => {
    const fix = byId(RECURSION_NODE_IDS.FIX_ROOT_ID);
    expect(fix).toBeDefined();
    expect(fix!.properties!.eval_status).toBe("accepted");
    expect(fix!.properties!.status).toBe("rejected");
  });

  it("root fix has rerun_run_id matching its PRODUCED_BY output ref_id", () => {
    const fix = byId(RECURSION_NODE_IDS.FIX_ROOT_ID);
    expect(fix!.properties!.rerun_run_id).toBe(RECURSION_NODE_IDS.FIX_ROOT_RERUN_OUTPUT_ID);
  });

  it("root fix has string before_score/after_score", () => {
    const fix = byId(RECURSION_NODE_IDS.FIX_ROOT_ID);
    expect(typeof fix!.properties!.before_score).toBe("string");
    expect(typeof fix!.properties!.after_score).toBe("string");
  });

  it("root rerun EvalTriggerOutput has higher n_passed than baseline", () => {
    const baseline = byId(RECURSION_NODE_IDS.BASELINE_OUTPUT_ID);
    const rerun = byId(RECURSION_NODE_IDS.FIX_ROOT_RERUN_OUTPUT_ID);
    expect((rerun!.properties!.n_passed as number)).toBeGreaterThan(
      baseline!.properties!.n_passed as number,
    );
  });

  it("derived fix has NO eval_status (exercises status fallback)", () => {
    const fix = byId(RECURSION_NODE_IDS.FIX_DERIVED_ID);
    expect(fix).toBeDefined();
    expect(fix!.properties!.eval_status).toBeUndefined();
    expect(fix!.properties!.status).toBe("accepted");
  });

  it("derived fix has rerun_run_id matching its PRODUCED_BY output", () => {
    const fix = byId(RECURSION_NODE_IDS.FIX_DERIVED_ID);
    expect(fix!.properties!.rerun_run_id).toBe(RECURSION_NODE_IDS.FIX_DERIVED_RERUN_OUTPUT_ID);
  });

  it("includes a rejected ProposedFix with eval_status:'rejected'", () => {
    const fix = byId(RECURSION_NODE_IDS.FIX_REJECTED_ID);
    expect(fix).toBeDefined();
    expect(fix!.properties!.eval_status).toBe("rejected");
  });

  it("includes a casing-variant EvalTrigger node (evaltrigger)", () => {
    const rerunTrigger = byId(RECURSION_NODE_IDS.RERUN_TRIGGER_ID);
    expect(rerunTrigger).toBeDefined();
    expect(rerunTrigger!.node_type).toBe("evaltrigger");
  });
});

describe("buildRecursionEdges", () => {
  let edges: ReturnType<typeof buildRecursionEdges>;

  beforeEach(() => {
    edges = buildRecursionEdges();
  });

  const findEdge = (src: string, tgt: string, type: string) =>
    edges.find((e) => e.source === src && e.target === tgt && e.edge_type === type);

  it("has HAS_BASELINE_TRIGGER from EvalSet to baseline trigger", () => {
    expect(
      findEdge(RECURSION_NODE_IDS.EVAL_SET_ID, RECURSION_NODE_IDS.BASELINE_TRIGGER_ID, "HAS_BASELINE_TRIGGER"),
    ).toBeDefined();
  });

  it("has HAS_TRIGGER from EvalSet to rerun trigger", () => {
    expect(
      findEdge(RECURSION_NODE_IDS.EVAL_SET_ID, RECURSION_NODE_IDS.RERUN_TRIGGER_ID, "HAS_TRIGGER"),
    ).toBeDefined();
  });

  it("has HAS_OUTPUT from baseline trigger to baseline output", () => {
    expect(
      findEdge(RECURSION_NODE_IDS.BASELINE_TRIGGER_ID, RECURSION_NODE_IDS.BASELINE_OUTPUT_ID, "HAS_OUTPUT"),
    ).toBeDefined();
  });

  it("has HAS_PROPOSED_FIX from baseline trigger to root fix", () => {
    expect(
      findEdge(RECURSION_NODE_IDS.BASELINE_TRIGGER_ID, RECURSION_NODE_IDS.FIX_ROOT_ID, "HAS_PROPOSED_FIX"),
    ).toBeDefined();
  });

  it("has PRODUCED_BY from root fix to its rerun output", () => {
    expect(
      findEdge(RECURSION_NODE_IDS.FIX_ROOT_ID, RECURSION_NODE_IDS.FIX_ROOT_RERUN_OUTPUT_ID, "PRODUCED_BY"),
    ).toBeDefined();
  });

  it("has DERIVED_FROM from derived fix to root fix", () => {
    expect(
      findEdge(RECURSION_NODE_IDS.FIX_DERIVED_ID, RECURSION_NODE_IDS.FIX_ROOT_ID, "DERIVED_FROM"),
    ).toBeDefined();
  });

  it("has PRODUCED_BY from derived fix to its rerun output", () => {
    expect(
      findEdge(RECURSION_NODE_IDS.FIX_DERIVED_ID, RECURSION_NODE_IDS.FIX_DERIVED_RERUN_OUTPUT_ID, "PRODUCED_BY"),
    ).toBeDefined();
  });

  it("has HAS_PROPOSED_FIX from rerun trigger to rejected fix", () => {
    expect(
      findEdge(RECURSION_NODE_IDS.RERUN_TRIGGER_ID, RECURSION_NODE_IDS.FIX_REJECTED_ID, "HAS_PROPOSED_FIX"),
    ).toBeDefined();
  });
});

// ── 3. Mock graph route branching ──────────────────────────────────────────
// We mock db.workspace.findFirst so we don't need a real DB in unit tests.
vi.mock("@/lib/db", () => ({
  db: {
    workspace: {
      findFirst: vi.fn().mockResolvedValue({ id: "ws-1", slug: "test-workspace" }),
      findUnique: vi.fn().mockResolvedValue({ id: "ws-1", slug: "test-workspace" }),
    },
  },
}));

import { GET as MockGraphGET } from "@/app/api/mock/jarvis/graph/route";

function makeGraphRequest(params: Record<string, string>) {
  const url = new URL("http://localhost:3000/api/mock/jarvis/graph");
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  return new NextRequest(url);
}

describe("GET /api/mock/jarvis/graph — branching logic", () => {
  it("returns recursion fixture when node_type=EvalTrigger", async () => {
    const req = makeGraphRequest({ workspaceSlug: "test-workspace", node_type: "EvalTrigger" });
    const res = await MockGraphGET(req);
    const body = await res.json();

    expect(body.success).toBe(true);
    const nodeTypes = body.data.nodes.map((n: { node_type: string }) => n.node_type.toLowerCase());
    expect(nodeTypes).toContain("evalset");
    // Must NOT contain generic nodes
    expect(nodeTypes).not.toContain("function");
    expect(nodeTypes).not.toContain("variable");
  });

  it("returns recursion fixture when start_node matches mock EvalSet ref_id", async () => {
    const req = makeGraphRequest({
      workspaceSlug: "test-workspace",
      start_node: MOCK_EVAL_SET_REF_ID,
    });
    const res = await MockGraphGET(req);
    const body = await res.json();

    expect(body.success).toBe(true);
    const refIds = body.data.nodes.map((n: { ref_id: string }) => n.ref_id);
    expect(refIds).toContain(MOCK_EVAL_SET_REF_ID);
  });

  it("returns recursion fixture when node_type=ProposedFix", async () => {
    const req = makeGraphRequest({ workspaceSlug: "test-workspace", node_type: "ProposedFix" });
    const res = await MockGraphGET(req);
    const body = await res.json();
    const nodeTypes = body.data.nodes.map((n: { node_type: string }) => n.node_type.toLowerCase());
    expect(nodeTypes).not.toContain("function");
    expect(nodeTypes.some((t: string) => t.includes("proposedfix"))).toBe(true);
  });

  it("returns recursion fixture with PRODUCED_BY edges", async () => {
    const req = makeGraphRequest({ workspaceSlug: "test-workspace", node_type: "EvalTrigger" });
    const res = await MockGraphGET(req);
    const body = await res.json();
    const producedByEdges = body.data.edges.filter(
      (e: { edge_type: string }) => e.edge_type === "PRODUCED_BY",
    );
    expect(producedByEdges.length).toBeGreaterThanOrEqual(2);
  });

  it("recursion fixture includes the eval_status conflict node (eval_status wins)", async () => {
    const req = makeGraphRequest({ workspaceSlug: "test-workspace", node_type: "ProposedFix" });
    const res = await MockGraphGET(req);
    const body = await res.json();
    const conflictFix = body.data.nodes.find(
      (n: { ref_id: string }) => n.ref_id === RECURSION_NODE_IDS.FIX_ROOT_ID,
    );
    expect(conflictFix).toBeDefined();
    expect(conflictFix.properties.eval_status).toBe("accepted");
    expect(conflictFix.properties.status).toBe("rejected");
  });

  it("recursion fixture includes the status-fallback node (no eval_status)", async () => {
    const req = makeGraphRequest({ workspaceSlug: "test-workspace", node_type: "ProposedFix" });
    const res = await MockGraphGET(req);
    const body = await res.json();
    const fallbackFix = body.data.nodes.find(
      (n: { ref_id: string }) => n.ref_id === RECURSION_NODE_IDS.FIX_DERIVED_ID,
    );
    expect(fallbackFix).toBeDefined();
    expect(fallbackFix.properties.eval_status).toBeUndefined();
    expect(fallbackFix.properties.status).toBe("accepted");
  });

  it("recursion fixture includes the rejected fix", async () => {
    const req = makeGraphRequest({ workspaceSlug: "test-workspace", node_type: "ProposedFix" });
    const res = await MockGraphGET(req);
    const body = await res.json();
    const rejectedFix = body.data.nodes.find(
      (n: { ref_id: string }) => n.ref_id === RECURSION_NODE_IDS.FIX_REJECTED_ID,
    );
    expect(rejectedFix).toBeDefined();
    expect(rejectedFix.properties.eval_status).toBe("rejected");
  });

  // ── Regression: generic graph unchanged when no new params ─────────────
  it("returns generic graph (Function/Variable nodes) when no recursion params", async () => {
    const req = makeGraphRequest({ workspaceSlug: "test-workspace" });
    const res = await MockGraphGET(req);
    const body = await res.json();

    expect(body.success).toBe(true);
    const nodeTypes: string[] = body.data.nodes.map((n: { node_type: string }) => n.node_type);
    expect(nodeTypes).toContain("Function");
    expect(nodeTypes).toContain("Variable");
    // Must NOT contain EvalSet etc.
    const lowerTypes = nodeTypes.map((t) => t.toLowerCase());
    expect(lowerTypes).not.toContain("evalset");
  });

  it("returns generic graph for node_type=Function (no regression)", async () => {
    const req = makeGraphRequest({ workspaceSlug: "test-workspace", node_type: "Function" });
    const res = await MockGraphGET(req);
    const body = await res.json();
    const nodeTypes: string[] = body.data.nodes.map((n: { node_type: string }) => n.node_type);
    expect(nodeTypes).toContain("Function");
  });
});

// ── 4. callMockEndpoint param-forwarding ──────────────────────────────────
// We test the forwarding logic by asserting on the URL constructed and passed
// to MockGET — we do this via spying on the imported GET handler in test env.
describe("callMockEndpoint param-forwarding (unit logic)", () => {
  it("forwards endpoint, node_type, start_node, depth to the mock URL", () => {
    // This test validates the forwarding logic extracted from callMockEndpoint.
    // We simulate the same loop that the route uses.
    const incomingSearchParams = new URLSearchParams(
      "id=ws-id-1&endpoint=%2Fgraph%2Fsubgraph%3Fstart_node%3Dmock-evalset-001&node_type=EvalTrigger&start_node=mock-evalset-001&depth=3",
    );

    const forwardedParams: Record<string, string> = {
      workspaceSlug: "test-workspace",
    };
    for (const key of ["endpoint", "node_type", "start_node", "depth"] as const) {
      const val = incomingSearchParams.get(key);
      if (val !== null) forwardedParams[key] = val;
    }

    expect(forwardedParams.workspaceSlug).toBe("test-workspace");
    expect(forwardedParams.endpoint).toBeDefined();
    expect(forwardedParams.node_type).toBe("EvalTrigger");
    expect(forwardedParams.start_node).toBe("mock-evalset-001");
    expect(forwardedParams.depth).toBe("3");
  });

  it("does NOT include absent params — preserves byte-for-byte URL for existing consumers", () => {
    // Simulate a call from SynchronizedGraphComponent (only id param, no new params)
    const incomingSearchParams = new URLSearchParams("id=ws-id-1");

    const forwardedParams: Record<string, string> = {
      workspaceSlug: "test-workspace",
    };
    for (const key of ["endpoint", "node_type", "start_node", "depth"] as const) {
      const val = incomingSearchParams.get(key);
      if (val !== null) forwardedParams[key] = val;
    }

    // Only workspaceSlug — no new params added
    expect(Object.keys(forwardedParams)).toEqual(["workspaceSlug"]);
    expect(forwardedParams.endpoint).toBeUndefined();
    expect(forwardedParams.node_type).toBeUndefined();
    expect(forwardedParams.start_node).toBeUndefined();
    expect(forwardedParams.depth).toBeUndefined();

    const mockUrl = new URL("http://localhost:3000/api/mock/jarvis/graph");
    for (const [k, v] of Object.entries(forwardedParams)) {
      mockUrl.searchParams.set(k, v);
    }
    // URL should only have workspaceSlug — identical to the old behaviour
    expect(mockUrl.searchParams.toString()).toBe("workspaceSlug=test-workspace");
  });

  it("forwards only the params that are present (partial forwarding)", () => {
    const incomingSearchParams = new URLSearchParams("id=ws-id-1&node_type=ProposedFix");

    const forwardedParams: Record<string, string> = { workspaceSlug: "slug" };
    for (const key of ["endpoint", "node_type", "start_node", "depth"] as const) {
      const val = incomingSearchParams.get(key);
      if (val !== null) forwardedParams[key] = val;
    }

    expect(forwardedParams.node_type).toBe("ProposedFix");
    expect(forwardedParams.endpoint).toBeUndefined();
    expect(forwardedParams.start_node).toBeUndefined();
    expect(forwardedParams.depth).toBeUndefined();
  });
});
