/**
 * Unit tests for the seed-node filter in the evals triggers GET handler.
 *
 * Jarvis's `/v2/nodes/:ref_id?expand=edges` endpoint returns the seed node
 * (the trigger itself) inside `nodes` when no HAS_OUTPUT edges exist.
 * The filter on line 82 of the triggers route must strip it so a trigger
 * never appears in its own `outputs` list.
 */

import { describe, test, expect, vi, beforeEach, Mock } from "vitest";
import { NextRequest, NextResponse } from "next/server";

// ---------------------------------------------------------------------------
// Hoisted mocks — must come before any import of the module under test
// ---------------------------------------------------------------------------

vi.mock("@/lib/middleware/utils", () => ({
  getMiddlewareContext: vi.fn(),
  requireAuth: vi.fn(),
}));

vi.mock("@/lib/helpers/swarm-access", () => ({
  getWorkspaceSwarmAccess: vi.fn(),
}));

vi.mock("@/lib/utils/swarm", () => ({
  getJarvisUrl: vi.fn(() => "https://jarvis.test"),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { GET } from "@/app/api/workspaces/[slug]/evals/[evalSetId]/requirements/[reqId]/triggers/route";
import { getMiddlewareContext, requireAuth } from "@/lib/middleware/utils";
import { getWorkspaceSwarmAccess } from "@/lib/helpers/swarm-access";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(slug: string) {
  return new NextRequest(
    `http://localhost:3000/api/workspaces/${slug}/evals/set-1/requirements/req-1/triggers`,
    { method: "GET" },
  );
}

function setupAuth(userId = "user-1") {
  (getMiddlewareContext as Mock).mockReturnValue({ user: { id: userId } });
  (requireAuth as Mock).mockReturnValue({ id: userId });
}

function setupSwarmAccess(swarmName = "swarm1", swarmApiKey = "key-abc") {
  (getWorkspaceSwarmAccess as Mock).mockResolvedValue({
    success: true,
    data: { swarmName, swarmApiKey, swarmUrl: "https://jarvis.test", swarmStatus: "ACTIVE", poolName: "pool1", workspaceId: "ws-1" },
  });
}

const ROUTE_PARAMS = {
  params: Promise.resolve({ slug: "my-workspace", evalSetId: "set-1", reqId: "req-1" }),
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  // Override USE_MOCKS so the real Jarvis fetch path is exercised, not the mock endpoint.
  process.env.USE_MOCKS = "false";
  setupAuth();
  setupSwarmAccess();
});

afterEach(() => {
  process.env.USE_MOCKS = "true"; // restore PM2 default
});

describe("GET triggers — seed-node filter", () => {
  /**
   * AC-1: When Jarvis returns the trigger itself as the only output node
   * (seed node behaviour — no HAS_OUTPUT edges), outputs must be [].
   */
  test("filters out seed node so outputs is empty when Jarvis returns only the trigger ref_id", async () => {
    const triggerNode = {
      ref_id: "trigger-123",
      node_type: "EvalTrigger",
      properties: { agent: "Reviewer" },
    };

    // First fetch: trigger list
    // Second fetch: outputs — Jarvis returns the seed node (the trigger itself)
    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ nodes: [triggerNode] }),
      } as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ nodes: [{ ref_id: "trigger-123", node_type: "EvalTrigger", properties: { agent: "Reviewer" } }] }),
      } as any);

    const response = await GET(makeRequest("my-workspace"), ROUTE_PARAMS);

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.data.nodes).toHaveLength(1);
    expect(data.data.nodes[0].ref_id).toBe("trigger-123");
    // Seed node must be stripped — outputs should be empty
    expect(data.data.nodes[0].outputs).toEqual([]);
  });

  /**
   * AC-2: When Jarvis returns one real output node plus the seed node,
   * only the real output remains in `outputs`.
   */
  test("keeps real output nodes and removes the seed node from outputs", async () => {
    const triggerNode = {
      ref_id: "trigger-123",
      node_type: "EvalTrigger",
      properties: { agent: "Reviewer" },
    };
    const realOutput = {
      ref_id: "output-abc",
      node_type: "EvalTriggerOutput",
      properties: { result: "pass", score: 1 },
    };

    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ nodes: [triggerNode] }),
      } as any)
      .mockResolvedValueOnce({
        ok: true,
        // Jarvis returns both the real output AND the seed trigger node
        json: async () => ({ nodes: [realOutput, { ref_id: "trigger-123", node_type: "EvalTrigger" }] }),
      } as any);

    const response = await GET(makeRequest("my-workspace"), ROUTE_PARAMS);

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.data.nodes[0].outputs).toHaveLength(1);
    expect(data.data.nodes[0].outputs[0].ref_id).toBe("output-abc");
  });

  /**
   * Regression guard: genuine output nodes with different ref_ids are NOT filtered.
   */
  test("does not filter output nodes whose ref_id differs from the trigger ref_id", async () => {
    const triggerNode = { ref_id: "trigger-123", node_type: "EvalTrigger", properties: { agent: "Agent" } };
    const output1 = { ref_id: "output-001", node_type: "EvalTriggerOutput", properties: { result: "pass" } };
    const output2 = { ref_id: "output-002", node_type: "EvalTriggerOutput", properties: { result: "fail" } };

    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ nodes: [triggerNode] }),
      } as any)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ nodes: [output1, output2] }),
      } as any);

    const response = await GET(makeRequest("my-workspace"), ROUTE_PARAMS);

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.data.nodes[0].outputs).toHaveLength(2);
    const outputIds = data.data.nodes[0].outputs.map((n: { ref_id: string }) => n.ref_id);
    expect(outputIds).toContain("output-001");
    expect(outputIds).toContain("output-002");
  });
});
