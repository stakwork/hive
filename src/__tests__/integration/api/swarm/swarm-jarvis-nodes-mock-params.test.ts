/**
 * Tests verifying that:
 * 1. `callMockEndpoint` in jarvis/nodes/route.ts forwards `endpoint`,
 *    `node_type`, `start_node`, and `depth` to the mock graph route.
 * 2. The mock graph route returns the recursion fixture (not the generic graph)
 *    when eval-ontology node_type values or a mock EvalSet start_node are present.
 */
import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { WorkspaceRole } from "@prisma/client";
import { generateUniqueId } from "@/__tests__/support/helpers";
import { addMiddlewareHeaders } from "@/__tests__/support/helpers/request-builders";
import { MOCK_RECURSION_EVALSET_REF_ID } from "@/app/api/mock/jarvis/graph/route";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("next-auth/next", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("@/config/env", async () => {
  const actual = await vi.importActual("@/config/env");
  return {
    ...actual,
    config: new Proxy((actual as any).config, {
      get(target: any, prop: string) {
        if (prop === "USE_MOCKS") return process.env.USE_MOCKS === "true";
        return target[prop];
      },
    }),
  };
});

vi.mock("@/services/swarm/api/swarm", () => ({
  swarmApiRequest: vi.fn(),
}));

vi.mock("@/services/s3", () => ({
  getS3Service: vi.fn(),
}));

vi.mock("@/lib/constants", () => ({
  getSwarmVanityAddress: vi.fn((name: string) => `${name}.sphinx.chat`),
}));

vi.mock("@/lib/auth/nextauth", () => ({
  authOptions: {},
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────

describe("Mock param forwarding — jarvis/nodes → mock/jarvis/graph", () => {
  let testUser: { id: string; email: string; name: string };
  let testWorkspace: { id: string; slug: string };

  const makeAuthRequest = async (url: string) => {
    // Reset modules so env changes take effect
    vi.resetModules();
    const { GET } = await import("@/app/api/swarm/jarvis/nodes/route");
    const base = new NextRequest(url, { method: "GET" });
    const req = addMiddlewareHeaders(base, {
      id: testUser.id,
      email: testUser.email,
      name: testUser.name,
    });
    return GET(req as any);
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    // Ensure USE_MOCKS is true so callMockEndpoint is exercised
    process.env.USE_MOCKS = "true";

    const uid = generateUniqueId();
    testUser = await db.user.create({
      data: {
        id: `user-${uid}`,
        email: `test-${uid}@example.com`,
        name: `Test User ${uid}`,
        emailVerified: new Date(),
      },
    });

    testWorkspace = await db.workspace.create({
      data: {
        name: `Test Workspace ${uid}`,
        slug: `test-workspace-${uid}`,
        ownerId: testUser.id,
        members: {
          create: { userId: testUser.id, role: WorkspaceRole.OWNER },
        },
      },
    });
  });

  afterEach(async () => {
    await db.workspaceMember.deleteMany({ where: { workspaceId: testWorkspace.id } });
    await db.workspace.deleteMany({ where: { id: testWorkspace.id } });
    await db.user.deleteMany({ where: { id: testUser.id } });
    delete process.env.USE_MOCKS;
    vi.resetModules();
  });

  // ── Generic fallback still works ───────────────────────────────────────────

  test("returns generic graph when no eval node_type params are present", async () => {
    const url = `http://localhost:3000/api/swarm/jarvis/nodes?id=${testWorkspace.id}`;
    const response = await makeAuthRequest(url);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    // Generic graph contains Function nodes; recursion fixture contains EvalSet nodes
    const nodeTypes: string[] = body.data.nodes.map((n: any) => n.node_type);
    expect(nodeTypes).toContain("Function");
    expect(nodeTypes).not.toContain("EvalSet");
  });

  // ── Recursion fixture selection via node_type ──────────────────────────────

  test("returns recursion fixture when node_type=EvalTrigger is forwarded", async () => {
    const url = `http://localhost:3000/api/swarm/jarvis/nodes?id=${testWorkspace.id}&node_type=EvalTrigger`;
    const response = await makeAuthRequest(url);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);

    const nodeTypes: string[] = body.data.nodes.map((n: any) => n.node_type);
    expect(nodeTypes).toContain("EvalSet");
    expect(nodeTypes).not.toContain("Function");
  });

  test("returns recursion fixture when node_type=EvalTriggerOutput is forwarded", async () => {
    const url = `http://localhost:3000/api/swarm/jarvis/nodes?id=${testWorkspace.id}&node_type=EvalTriggerOutput`;
    const response = await makeAuthRequest(url);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);

    const nodeTypes: string[] = body.data.nodes.map((n: any) => n.node_type);
    expect(nodeTypes).toContain("EvalSet");
  });

  test("returns recursion fixture when node_type=ProposedFix is forwarded", async () => {
    const url = `http://localhost:3000/api/swarm/jarvis/nodes?id=${testWorkspace.id}&node_type=ProposedFix`;
    const response = await makeAuthRequest(url);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);

    const nodeTypes: string[] = body.data.nodes.map((n: any) => n.node_type);
    expect(nodeTypes).toContain("EvalSet");
  });

  test("returns recursion fixture for case-insensitive node_type=evaltrigger", async () => {
    const url = `http://localhost:3000/api/swarm/jarvis/nodes?id=${testWorkspace.id}&node_type=evaltrigger`;
    const response = await makeAuthRequest(url);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);

    const nodeTypes: string[] = body.data.nodes.map((n: any) => n.node_type);
    expect(nodeTypes).toContain("EvalSet");
  });

  // ── Recursion fixture selection via start_node ─────────────────────────────

  test("returns recursion fixture when start_node matches mock EvalSet ref_id", async () => {
    const url = `http://localhost:3000/api/swarm/jarvis/nodes?id=${testWorkspace.id}&start_node=${MOCK_RECURSION_EVALSET_REF_ID}`;
    const response = await makeAuthRequest(url);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);

    const nodeTypes: string[] = body.data.nodes.map((n: any) => n.node_type);
    expect(nodeTypes).toContain("EvalSet");
  });

  // ── endpoint param forwarding ──────────────────────────────────────────────

  test("returns recursion fixture when endpoint encodes subgraph with mock EvalSet start_node", async () => {
    const endpoint = encodeURIComponent(
      `/graph/subgraph?start_node=${MOCK_RECURSION_EVALSET_REF_ID}&depth=10`
    );
    const url = `http://localhost:3000/api/swarm/jarvis/nodes?id=${testWorkspace.id}&endpoint=${endpoint}`;
    const response = await makeAuthRequest(url);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);

    const nodeTypes: string[] = body.data.nodes.map((n: any) => n.node_type);
    expect(nodeTypes).toContain("EvalSet");
  });

  // ── Fixture shape verification ─────────────────────────────────────────────

  test("recursion fixture contains expected nodes and edges", async () => {
    const url = `http://localhost:3000/api/swarm/jarvis/nodes?id=${testWorkspace.id}&node_type=EvalTrigger&node_type=EvalTriggerOutput&node_type=ProposedFix&start_node=${MOCK_RECURSION_EVALSET_REF_ID}&depth=10`;
    const response = await makeAuthRequest(url);

    expect(response.status).toBe(200);
    const body = await response.json();

    const { nodes, edges } = body.data as { nodes: any[]; edges: any[] };

    // Nodes: one EvalSet, triggers, outputs, fixes
    const byRefId = Object.fromEntries(nodes.map((n: any) => [n.ref_id, n]));

    expect(byRefId[MOCK_RECURSION_EVALSET_REF_ID]).toBeDefined();
    expect(byRefId[MOCK_RECURSION_EVALSET_REF_ID].node_type).toBe("EvalSet");

    expect(byRefId["mock-trigger-baseline-001"]).toBeDefined();
    expect(byRefId["mock-output-baseline-001"]).toBeDefined();
    expect(byRefId["mock-fix-accepted-001"]).toBeDefined();
    expect(byRefId["mock-fix-accepted-002"]).toBeDefined();
    expect(byRefId["mock-output-rerun-001"]).toBeDefined();
    expect(byRefId["mock-output-rerun-002"]).toBeDefined();

    // Rejected / pending fixes are present in the fixture (excluded only by builder)
    expect(byRefId["mock-fix-pending-001"]).toBeDefined();
    expect(byRefId["mock-fix-rejected-001"]).toBeDefined();

    // Alternate-casing node present
    expect(byRefId["mock-trigger-alt-casing-001"]).toBeDefined();
    expect(byRefId["mock-trigger-alt-casing-001"].node_type).toBe("evaltrigger");

    // Score fields — integers on outputs
    expect(byRefId["mock-output-baseline-001"].properties.n_passed).toBe(3);
    expect(byRefId["mock-output-baseline-001"].properties.n_total).toBe(5);
    expect(byRefId["mock-output-rerun-001"].properties.n_passed).toBe(4);
    expect(byRefId["mock-output-rerun-002"].properties.n_passed).toBe(5);

    // before_score / after_score are strings on fixes
    expect(byRefId["mock-fix-accepted-001"].properties.before_score).toBe("60");
    expect(byRefId["mock-fix-accepted-001"].properties.after_score).toBe("80");
    expect(byRefId["mock-fix-accepted-002"].properties.before_score).toBe("80");
    expect(byRefId["mock-fix-accepted-002"].properties.after_score).toBe("100");

    // status values
    expect(byRefId["mock-fix-accepted-001"].properties.status).toBe("accepted");
    expect(byRefId["mock-fix-accepted-002"].properties.status).toBe("accepted");
    expect(byRefId["mock-fix-pending-001"].properties.status).toBe("pending");
    expect(byRefId["mock-fix-rejected-001"].properties.status).toBe("rejected");

    // Edges: spot-check key ontology edges
    const edgeTypes = edges.map((e: any) => e.edge_type);
    expect(edgeTypes).toContain("HAS_BASELINE_TRIGGER");
    expect(edgeTypes).toContain("HAS_OUTPUT");
    expect(edgeTypes).toContain("HAS_PROPOSED_FIX");
    expect(edgeTypes).toContain("PRODUCED_BY");
    expect(edgeTypes).toContain("DERIVED_FROM");
    expect(edgeTypes).toContain("HAS_TRIGGER");
  });

  // ── multi node_type forwarding ─────────────────────────────────────────────

  test("forwards multiple node_type values as separate params", async () => {
    // Multiple node_type query params — all should be forwarded and trigger fixture selection
    const url =
      `http://localhost:3000/api/swarm/jarvis/nodes` +
      `?id=${testWorkspace.id}` +
      `&node_type=EvalTrigger` +
      `&node_type=EvalTriggerOutput` +
      `&node_type=ProposedFix`;
    const response = await makeAuthRequest(url);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);

    const nodeTypes: string[] = body.data.nodes.map((n: any) => n.node_type);
    expect(nodeTypes).toContain("EvalSet");
    expect(nodeTypes).toContain("EvalTrigger");
    expect(nodeTypes).toContain("EvalTriggerOutput");
    expect(nodeTypes).toContain("ProposedFix");
  });
});
