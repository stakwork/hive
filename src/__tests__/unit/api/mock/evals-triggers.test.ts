import { describe, test, expect } from "vitest";
import { GET, POST } from "@/app/api/mock/evals/[evalSetId]/requirements/[reqId]/triggers/route";
import { GET as getOutputs } from "@/app/api/mock/evals/[evalSetId]/requirements/[reqId]/triggers/[triggerId]/outputs/route";
import { POST as runTrigger } from "@/app/api/mock/evals/[evalSetId]/requirements/[reqId]/triggers/[triggerId]/run/route";
import { NextRequest } from "next/server";

function makeGetRequest(evalSetId: string, reqId: string): NextRequest {
  return new NextRequest(
    `http://localhost:3000/api/mock/evals/${evalSetId}/requirements/${reqId}/triggers`,
    { method: "GET" },
  );
}

function makePostRequest(evalSetId: string, reqId: string, body: object): NextRequest {
  return new NextRequest(
    `http://localhost:3000/api/mock/evals/${evalSetId}/requirements/${reqId}/triggers`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

// ---------------------------------------------------------------------------
// GET triggers
// ---------------------------------------------------------------------------
describe("GET /api/mock/evals/[evalSetId]/requirements/[reqId]/triggers", () => {
  test("returns seeded triggers for req-1-1", async () => {
    const request = makeGetRequest("eval-set-1", "req-1-1");
    const response = await GET(request, { params: Promise.resolve({ evalSetId: "eval-set-1", reqId: "req-1-1" }) });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data.nodes.length).toBeGreaterThan(0);
    expect(data.data.total).toBe(data.data.nodes.length);

    for (const node of data.data.nodes) {
      expect(node.node_type).toBe("EvalTrigger");
      expect(node.ref_id).toBeDefined();
      expect(node.properties.agent).toBeDefined();
    }
  });

  test("returns seeded triggers for req-1-2", async () => {
    const request = makeGetRequest("eval-set-1", "req-1-2");
    const response = await GET(request, { params: Promise.resolve({ evalSetId: "eval-set-1", reqId: "req-1-2" }) });
    const data = await response.json();

    expect(data.success).toBe(true);
    expect(data.data.nodes.length).toBeGreaterThan(0);
  });

  test("returns empty array for unknown reqId", async () => {
    const request = makeGetRequest("eval-set-1", "req-unknown-xyz");
    const response = await GET(request, { params: Promise.resolve({ evalSetId: "eval-set-1", reqId: "req-unknown-xyz" }) });
    const data = await response.json();

    expect(data.success).toBe(true);
    expect(data.data.nodes).toEqual([]);
    expect(data.data.total).toBe(0);
  });

  test("req-1-1 and req-1-2 return different triggers", async () => {
    const res1 = await GET(makeGetRequest("eval-set-1", "req-1-1"), { params: Promise.resolve({ evalSetId: "eval-set-1", reqId: "req-1-1" }) });
    const res2 = await GET(makeGetRequest("eval-set-1", "req-1-2"), { params: Promise.resolve({ evalSetId: "eval-set-1", reqId: "req-1-2" }) });

    const data1 = await res1.json();
    const data2 = await res2.json();

    const ids1 = data1.data.nodes.map((n: { ref_id: string }) => n.ref_id);
    const ids2 = data2.data.nodes.map((n: { ref_id: string }) => n.ref_id);

    const overlap = ids1.filter((id: string) => ids2.includes(id));
    expect(overlap).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// POST triggers
// ---------------------------------------------------------------------------
describe("POST /api/mock/evals/[evalSetId]/requirements/[reqId]/triggers", () => {
  test("creates a new trigger and returns a ref_id", async () => {
    const body = { agent: "Test Agent", start_point: "start", end_point: "end" };
    const request = makePostRequest("eval-set-1", "req-1-1", body);
    const response = await POST(request, { params: Promise.resolve({ evalSetId: "eval-set-1", reqId: "req-1-1" }) });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(typeof data.data.ref_id).toBe("string");
    expect(data.data.ref_id.length).toBeGreaterThan(0);
  });

  test("each POST returns a unique ref_id", async () => {
    const body = { agent: "Agent" };
    const ctx = { params: Promise.resolve({ evalSetId: "e", reqId: "r" }) };
    const res1 = await POST(makePostRequest("e", "r", body), ctx);
    const res2 = await POST(makePostRequest("e", "r", body), ctx);

    const d1 = await res1.json();
    const d2 = await res2.json();

    expect(d1.data.ref_id).not.toBe(d2.data.ref_id);
  });
});

// ---------------------------------------------------------------------------
// GET trigger outputs
// ---------------------------------------------------------------------------
describe("GET /api/mock/evals/[evalSetId]/requirements/[reqId]/triggers/[triggerId]/outputs", () => {
  test("returns mock output nodes", async () => {
    const response = await getOutputs();
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data.nodes.length).toBeGreaterThan(0);
    expect(data.data.total).toBe(data.data.nodes.length);

    for (const node of data.data.nodes) {
      expect(node.node_type).toBe("EvalTriggerOutput");
      expect(node.ref_id).toBeDefined();
      expect(node.properties.result).toBeDefined();
      expect(typeof node.properties.score).toBe("number");
    }
  });

  test("returns both pass and fail results", async () => {
    const response = await getOutputs();
    const data = await response.json();

    const results = data.data.nodes.map((n: { properties: { result: string } }) => n.properties.result);
    expect(results).toContain("pass");
    expect(results).toContain("fail");
  });
});

// ---------------------------------------------------------------------------
// POST trigger run
// ---------------------------------------------------------------------------
describe("POST /api/mock/evals/[evalSetId]/requirements/[reqId]/triggers/[triggerId]/run", () => {
  test("returns success with a project_id", async () => {
    const response = await runTrigger();
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.project_id).toBeDefined();
    expect(typeof data.project_id).toBe("string");
  });
});
