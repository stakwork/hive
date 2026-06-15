import { describe, test, expect } from "vitest";
import { GET, POST } from "@/app/api/mock/evals/[evalSetId]/requirements/route";
import { NextRequest } from "next/server";

function makeGetRequest(evalSetId: string): NextRequest {
  return new NextRequest(
    `http://localhost:3000/api/mock/evals/${evalSetId}/requirements`,
    { method: "GET" },
  );
}

function makePostRequest(evalSetId: string, body: object): NextRequest {
  return new NextRequest(
    `http://localhost:3000/api/mock/evals/${evalSetId}/requirements`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

describe("GET /api/mock/evals/[evalSetId]/requirements", () => {
  test("returns seeded requirements for eval-set-1", async () => {
    const request = makeGetRequest("eval-set-1");
    const response = await GET(request, { params: Promise.resolve({ evalSetId: "eval-set-1" }) });
    const data = await response.json();

    expect(data.success).toBe(true);
    expect(data.data.nodes.length).toBeGreaterThan(0);
    expect(data.data.total).toBe(data.data.nodes.length);

    // All nodes belong to EvalRequirement type
    for (const node of data.data.nodes) {
      expect(node.node_type).toBe("EvalRequirement");
      expect(node.ref_id).toBeDefined();
      expect(node.properties.name).toBeDefined();
      expect(node.properties.prompt_snippet).toBeDefined();
      expect(Array.isArray(node.properties.desirable_cases)).toBe(true);
      expect(Array.isArray(node.properties.undesirable_cases)).toBe(true);
      expect(typeof node.properties.order).toBe("number");
    }
  });

  test("returns seeded requirements for eval-set-2", async () => {
    const request = makeGetRequest("eval-set-2");
    const response = await GET(request, { params: Promise.resolve({ evalSetId: "eval-set-2" }) });
    const data = await response.json();

    expect(data.success).toBe(true);
    expect(data.data.nodes.length).toBeGreaterThan(0);
  });

  test("eval-set-1 and eval-set-2 return different requirements", async () => {
    const res1 = await GET(makeGetRequest("eval-set-1"), { params: Promise.resolve({ evalSetId: "eval-set-1" }) });
    const res2 = await GET(makeGetRequest("eval-set-2"), { params: Promise.resolve({ evalSetId: "eval-set-2" }) });

    const data1 = await res1.json();
    const data2 = await res2.json();

    const ids1 = data1.data.nodes.map((n: { ref_id: string }) => n.ref_id);
    const ids2 = data2.data.nodes.map((n: { ref_id: string }) => n.ref_id);

    // No overlap between the two sets
    const overlap = ids1.filter((id: string) => ids2.includes(id));
    expect(overlap).toHaveLength(0);
  });

  test("returns empty array for unknown eval set id", async () => {
    const request = makeGetRequest("unknown-eval-set-xyz");
    const response = await GET(request, { params: Promise.resolve({ evalSetId: "unknown-eval-set-xyz" }) });
    const data = await response.json();

    expect(data.success).toBe(true);
    expect(data.data.nodes).toEqual([]);
    expect(data.data.total).toBe(0);
  });

  test("returns 200 status", async () => {
    const request = makeGetRequest("eval-set-1");
    const response = await GET(request, { params: Promise.resolve({ evalSetId: "eval-set-1" }) });
    expect(response.status).toBe(200);
  });
});

describe("POST /api/mock/evals/[evalSetId]/requirements", () => {
  test("creates a new requirement node and returns its ref_id", async () => {
    const body = {
      name: "Test Req",
      description: "A description",
      prompt_snippet: "When asked to do X",
      desirable_cases: ["Does X correctly"],
      undesirable_cases: ["Fails silently"],
    };
    const request = makePostRequest("eval-set-1", body);
    const response = await POST(request);
    const data = await response.json();

    expect(data.success).toBe(true);
    expect(typeof data.data.ref_id).toBe("string");
    expect(data.data.ref_id.length).toBeGreaterThan(0);
  });
});
