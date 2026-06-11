import { describe, test, expect } from "vitest";
import { GET } from "@/app/api/mock/evals/agent-roles/route";
import { NextRequest } from "next/server";

function makeGetRequest(searchParams?: Record<string, string>): NextRequest {
  const url = new URL("http://localhost:3000/api/mock/evals/agent-roles");
  if (searchParams) {
    for (const [key, value] of Object.entries(searchParams)) {
      url.searchParams.set(key, value);
    }
  }
  return new NextRequest(url.toString(), { method: "GET" });
}

describe("GET /api/mock/evals/agent-roles", () => {
  test("returns all agent role nodes", async () => {
    const request = makeGetRequest();
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data.nodes.length).toBeGreaterThan(0);
    expect(data.data.total).toBe(data.data.nodes.length);

    for (const node of data.data.nodes) {
      expect(node.node_type).toBe("AgentRole");
      expect(node.ref_id).toBeDefined();
      expect(node.properties.name).toBeDefined();
    }
  });

  test("filters by name (case-insensitive)", async () => {
    const request = makeGetRequest({ name: "code" });
    const response = await GET(request);
    const data = await response.json();

    expect(data.success).toBe(true);
    expect(data.data.nodes.length).toBeGreaterThan(0);
    for (const node of data.data.nodes) {
      expect(node.properties.name.toLowerCase()).toContain("code");
    }
  });

  test("returns empty array when name filter matches nothing", async () => {
    const request = makeGetRequest({ name: "zzz-no-match-xyz" });
    const response = await GET(request);
    const data = await response.json();

    expect(data.success).toBe(true);
    expect(data.data.nodes).toEqual([]);
    expect(data.data.total).toBe(0);
  });

  test("total matches nodes length after filtering", async () => {
    const request = makeGetRequest({ name: "agent" });
    const response = await GET(request);
    const data = await response.json();

    expect(data.data.total).toBe(data.data.nodes.length);
  });
});
