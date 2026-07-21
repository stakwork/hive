/**
 * Unit tests for the mock Jarvis graph route's recursion fixture branching.
 * Tests the fixture selection logic (eval-ontology node_type params → recursion
 * fixture vs. generic graph) without requiring a real DB connection by mocking
 * the db workspace lookup.
 */
import { describe, test, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ── Mock DB ────────────────────────────────────────────────────────────────────
vi.mock("@/lib/db", () => ({
  db: {
    workspace: {
      findFirst: vi.fn().mockResolvedValue({
        id: "ws-mock-id",
        slug: "test-workspace",
      }),
    },
  },
}));

import { GET, MOCK_RECURSION_EVALSET_REF_ID } from "@/app/api/mock/jarvis/graph/route";

function makeRequest(params: Record<string, string | string[]>): NextRequest {
  const url = new URL("http://localhost:3000/api/mock/jarvis/graph");
  // Always set workspaceSlug so the route doesn't 400
  if (!params["workspaceSlug"]) {
    url.searchParams.set("workspaceSlug", "test-workspace");
  }
  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) {
      value.forEach((v) => url.searchParams.append(key, v));
    } else {
      url.searchParams.set(key, value);
    }
  }
  return new NextRequest(url.toString(), { method: "GET" });
}

// ── Generic graph (default) ────────────────────────────────────────────────────

describe("Mock jarvis/graph — generic fixture (default)", () => {
  test("returns generic graph nodes when no eval params are present", async () => {
    const response = await GET(makeRequest({}));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    const types: string[] = body.data.nodes.map((n: any) => n.node_type);
    expect(types).toContain("Function");
    expect(types).not.toContain("EvalSet");
  });

  test("returns generic graph for unrelated node_type param", async () => {
    const response = await GET(makeRequest({ node_type: "Feature" }));
    expect(response.status).toBe(200);
    const body = await response.json();
    const types: string[] = body.data.nodes.map((n: any) => n.node_type);
    expect(types).toContain("Function");
    expect(types).not.toContain("EvalSet");
  });
});

// ── Recursion fixture selection ────────────────────────────────────────────────

describe("Mock jarvis/graph — recursion fixture selection", () => {
  test("returns recursion fixture for node_type=EvalTrigger", async () => {
    const response = await GET(makeRequest({ node_type: "EvalTrigger" }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    const types: string[] = body.data.nodes.map((n: any) => n.node_type);
    expect(types).toContain("EvalSet");
    expect(types).not.toContain("Function");
  });

  test("returns recursion fixture for node_type=EvalTriggerOutput", async () => {
    const response = await GET(makeRequest({ node_type: "EvalTriggerOutput" }));
    const body = await response.json();
    const types: string[] = body.data.nodes.map((n: any) => n.node_type);
    expect(types).toContain("EvalSet");
  });

  test("returns recursion fixture for node_type=ProposedFix", async () => {
    const response = await GET(makeRequest({ node_type: "ProposedFix" }));
    const body = await response.json();
    const types: string[] = body.data.nodes.map((n: any) => n.node_type);
    expect(types).toContain("EvalSet");
  });

  test("returns recursion fixture for node_type=EvalSet", async () => {
    const response = await GET(makeRequest({ node_type: "EvalSet" }));
    const body = await response.json();
    const types: string[] = body.data.nodes.map((n: any) => n.node_type);
    expect(types).toContain("EvalSet");
  });

  test("case-insensitive: evaltrigger → recursion fixture", async () => {
    const response = await GET(makeRequest({ node_type: "evaltrigger" }));
    const body = await response.json();
    const types: string[] = body.data.nodes.map((n: any) => n.node_type);
    expect(types).toContain("EvalSet");
  });

  test("case-insensitive: PROPOSEDFIX → recursion fixture", async () => {
    const response = await GET(makeRequest({ node_type: "PROPOSEDFIX" }));
    const body = await response.json();
    const types: string[] = body.data.nodes.map((n: any) => n.node_type);
    expect(types).toContain("EvalSet");
  });

  test("returns recursion fixture when start_node matches mock EvalSet ref_id", async () => {
    const response = await GET(makeRequest({ start_node: MOCK_RECURSION_EVALSET_REF_ID }));
    const body = await response.json();
    const types: string[] = body.data.nodes.map((n: any) => n.node_type);
    expect(types).toContain("EvalSet");
  });

  test("returns recursion fixture when endpoint contains subgraph with mock EvalSet start_node", async () => {
    const endpoint = `/graph/subgraph?start_node=${MOCK_RECURSION_EVALSET_REF_ID}&depth=10`;
    const response = await GET(makeRequest({ endpoint }));
    const body = await response.json();
    const types: string[] = body.data.nodes.map((n: any) => n.node_type);
    expect(types).toContain("EvalSet");
  });

  test("multiple node_type values — one eval type triggers recursion fixture", async () => {
    const response = await GET(
      makeRequest({
        node_type: ["EvalTrigger", "EvalTriggerOutput", "ProposedFix"],
      })
    );
    const body = await response.json();
    const types: string[] = body.data.nodes.map((n: any) => n.node_type);
    expect(types).toContain("EvalSet");
    expect(types).not.toContain("Function");
  });
});

// ── Fixture shape verification ─────────────────────────────────────────────────

describe("Mock jarvis/graph — recursion fixture shape", () => {
  let nodes: any[];
  let edges: any[];
  let byRefId: Record<string, any>;

  beforeEach(async () => {
    const response = await GET(makeRequest({ node_type: "EvalTrigger" }));
    const body = await response.json();
    nodes = body.data.nodes;
    edges = body.data.edges;
    byRefId = Object.fromEntries(nodes.map((n: any) => [n.ref_id, n]));
  });

  test("contains EvalSet root node with correct ref_id", () => {
    expect(byRefId[MOCK_RECURSION_EVALSET_REF_ID]).toBeDefined();
    expect(byRefId[MOCK_RECURSION_EVALSET_REF_ID].node_type).toBe("EvalSet");
  });

  test("contains baseline EvalTrigger", () => {
    expect(byRefId["mock-trigger-baseline-001"]).toBeDefined();
    expect(byRefId["mock-trigger-baseline-001"].node_type).toBe("EvalTrigger");
  });

  test("contains baseline EvalTriggerOutput with integer n_passed/n_total", () => {
    const output = byRefId["mock-output-baseline-001"];
    expect(output).toBeDefined();
    expect(output.node_type).toBe("EvalTriggerOutput");
    expect(output.properties.n_passed).toBe(3);
    expect(output.properties.n_total).toBe(5);
  });

  test("contains accepted fix-1 with string before_score/after_score", () => {
    const fix = byRefId["mock-fix-accepted-001"];
    expect(fix).toBeDefined();
    expect(fix.node_type).toBe("ProposedFix");
    expect(fix.properties.status).toBe("accepted");
    expect(fix.properties.before_score).toBe("60");
    expect(fix.properties.after_score).toBe("80");
  });

  test("contains accepted fix-2 (derived from fix-1) with higher score", () => {
    const fix = byRefId["mock-fix-accepted-002"];
    expect(fix).toBeDefined();
    expect(fix.properties.status).toBe("accepted");
    expect(fix.properties.before_score).toBe("80");
    expect(fix.properties.after_score).toBe("100");
  });

  test("rerun output-1 has higher n_passed than baseline", () => {
    expect(byRefId["mock-output-rerun-001"].properties.n_passed).toBe(4);
    expect(byRefId["mock-output-rerun-002"].properties.n_passed).toBe(5);
  });

  test("contains pending ProposedFix (status=pending)", () => {
    const fix = byRefId["mock-fix-pending-001"];
    expect(fix).toBeDefined();
    expect(fix.properties.status).toBe("pending");
  });

  test("contains rejected ProposedFix (status=rejected)", () => {
    const fix = byRefId["mock-fix-rejected-001"];
    expect(fix).toBeDefined();
    expect(fix.properties.status).toBe("rejected");
  });

  test("contains alternate-casing node (evaltrigger)", () => {
    const node = byRefId["mock-trigger-alt-casing-001"];
    expect(node).toBeDefined();
    expect(node.node_type).toBe("evaltrigger");
  });

  test("edges include all required ontology edge types", () => {
    const edgeTypes = new Set(edges.map((e: any) => e.edge_type));
    expect(edgeTypes).toContain("HAS_BASELINE_TRIGGER");
    expect(edgeTypes).toContain("HAS_OUTPUT");
    expect(edgeTypes).toContain("HAS_PROPOSED_FIX");
    expect(edgeTypes).toContain("PRODUCED_BY");
    expect(edgeTypes).toContain("DERIVED_FROM");
    expect(edgeTypes).toContain("HAS_TRIGGER");
  });

  test("EvalSet → baseline trigger edge exists (HAS_BASELINE_TRIGGER)", () => {
    const edge = edges.find(
      (e: any) =>
        e.source === MOCK_RECURSION_EVALSET_REF_ID &&
        e.target === "mock-trigger-baseline-001" &&
        e.edge_type === "HAS_BASELINE_TRIGGER"
    );
    expect(edge).toBeDefined();
  });

  test("baseline trigger → output edge exists (HAS_OUTPUT)", () => {
    const edge = edges.find(
      (e: any) =>
        e.source === "mock-trigger-baseline-001" &&
        e.target === "mock-output-baseline-001" &&
        e.edge_type === "HAS_OUTPUT"
    );
    expect(edge).toBeDefined();
  });

  test("baseline trigger → fix-1 edge exists (HAS_PROPOSED_FIX)", () => {
    const edge = edges.find(
      (e: any) =>
        e.source === "mock-trigger-baseline-001" &&
        e.target === "mock-fix-accepted-001" &&
        e.edge_type === "HAS_PROPOSED_FIX"
    );
    expect(edge).toBeDefined();
  });

  test("fix-1 → rerun-output-1 edge exists (PRODUCED_BY)", () => {
    const edge = edges.find(
      (e: any) =>
        e.source === "mock-fix-accepted-001" &&
        e.target === "mock-output-rerun-001" &&
        e.edge_type === "PRODUCED_BY"
    );
    expect(edge).toBeDefined();
  });

  test("fix-2 → fix-1 derivation edge exists (DERIVED_FROM)", () => {
    const edge = edges.find(
      (e: any) =>
        e.source === "mock-fix-accepted-002" &&
        e.target === "mock-fix-accepted-001" &&
        e.edge_type === "DERIVED_FROM"
    );
    expect(edge).toBeDefined();
  });

  test("fix-2 → rerun-output-2 edge exists (PRODUCED_BY)", () => {
    const edge = edges.find(
      (e: any) =>
        e.source === "mock-fix-accepted-002" &&
        e.target === "mock-output-rerun-002" &&
        e.edge_type === "PRODUCED_BY"
    );
    expect(edge).toBeDefined();
  });
});

// ── Error cases ────────────────────────────────────────────────────────────────

describe("Mock jarvis/graph — error cases", () => {
  test("returns 400 when workspaceSlug is missing", async () => {
    const url = new URL("http://localhost:3000/api/mock/jarvis/graph");
    url.searchParams.set("node_type", "EvalTrigger");
    const request = new NextRequest(url.toString(), { method: "GET" });
    const response = await GET(request);
    expect(response.status).toBe(400);
  });

  test("returns 404 when workspace is not found", async () => {
    const { db } = await import("@/lib/db");
    vi.mocked(db.workspace.findFirst).mockResolvedValueOnce(null);

    const response = await GET(makeRequest({ node_type: "EvalTrigger" }));
    expect(response.status).toBe(404);
  });
});
