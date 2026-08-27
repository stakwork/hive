import { describe, test, expect, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET, POST } from "@/app/api/mock/jarvis/v2/nodes/route";
import { mockSearchNodes, resolveMockNodeNamespace } from "@/app/api/mock/jarvis/v2/nodes/search-fixtures";
import { kgSearch } from "@/lib/ai/kg-adapter";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASE_URL = "http://localhost:3000/api/mock/jarvis/v2/nodes";

function makeGetRequest(params: Record<string, string> = {}, url = BASE_URL): NextRequest {
  const parsed = new URL(url);
  for (const [key, value] of Object.entries(params)) {
    parsed.searchParams.set(key, value);
  }
  return new NextRequest(parsed.toString(), { method: "GET" });
}

async function getNodes(
  params: Record<string, string> = {},
): Promise<{ status: number; data: { status?: string; nodes?: unknown[] } }> {
  const res = await GET(makeGetRequest(params));
  return { status: res.status, data: await res.json() };
}

function refIds(nodes: unknown[]): string[] {
  return (nodes as Array<{ ref_id: string }>).map((n) => n.ref_id).sort();
}

async function postScenario(body: Record<string, unknown>): Promise<{
  status: number;
  data: Record<string, unknown>;
}> {
  const req = new NextRequest(BASE_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const res = await POST(req);
  return { status: res.status, data: await res.json() };
}

// ---------------------------------------------------------------------------
// Fixture corpus shape — must match what kgSearch parses
// ---------------------------------------------------------------------------

describe("search-fixtures corpus", () => {
  test("every fixture has ref_id, node_type, and a descriptive field", () => {
    expect(mockSearchNodes.length).toBeGreaterThan(0);
    for (const node of mockSearchNodes) {
      expect(node.ref_id).toBeTruthy();
      expect(node.node_type).toBeTruthy();
      const props = node.properties ?? {};
      const hasDescription =
        typeof props.description === "string" || typeof props.summary === "string" || typeof props.text === "string";
      expect(hasDescription).toBe(true);
    }
  });

  test("covers at least 2 distinct namespaces plus default-partition fixtures", () => {
    const resolved = mockSearchNodes.map((n) => resolveMockNodeNamespace(n));
    const distinct = new Set(resolved.filter((ns): ns is string => ns !== null));
    expect(distinct.size).toBeGreaterThanOrEqual(2);
    // At least one fixture with NO namespace anywhere (default partition).
    expect(resolved.filter((ns) => ns === null).length).toBeGreaterThanOrEqual(1);
  });

  test("has a properties-only, a top-level-only, and a conflicting dual-placement fixture", () => {
    // properties-only
    const pr = mockSearchNodes.find((n) => n.ref_id === "pr-5175");
    expect(resolveMockNodeNamespace(pr)).toBe("acme-core");
    // top-level-only fallback
    const concept = mockSearchNodes.find((n) => n.ref_id === "concept-error-budgets");
    expect(concept?.namespace).toBe("platform-governance");
    expect(concept?.properties?.namespace).toBeUndefined();
    expect(resolveMockNodeNamespace(concept)).toBe("platform-governance");
    // no namespace at all
    const fn = mockSearchNodes.find((n) => n.ref_id === "fn-auth-token-verify");
    expect(resolveMockNodeNamespace(fn)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// GET /v2/nodes — namespace filtering
// ---------------------------------------------------------------------------

describe("GET /api/mock/jarvis/v2/nodes", () => {
  test("no namespace param returns the full corpus with HTTP 200", async () => {
    const { status, data } = await getNodes();
    expect(status).toBe(200);
    expect(data.status).toBe("success");
    expect(refIds(data.nodes ?? [])).toEqual(refIds(mockSearchNodes));
  });

  test("blank namespace param is treated as no filter", async () => {
    const { status, data } = await getNodes({ namespace: "   " });
    expect(status).toBe(200);
    expect(refIds(data.nodes ?? [])).toEqual(refIds(mockSearchNodes));
  });

  test("matching namespace returns only that subset (properties.namespace)", async () => {
    const { status, data } = await getNodes({ namespace: "acme-core" });
    expect(status).toBe(200);
    const ids = refIds(data.nodes ?? []);
    expect(ids).toContain("repo-hive-main");
    expect(ids).toContain("pr-5175");
    expect(ids).not.toContain("feat-graph-walker");
    expect(ids).not.toContain("fn-auth-token-verify");
    for (const node of data.nodes ?? []) {
      expect(resolveMockNodeNamespace(node as never)).toBe("acme-core");
    }
  });

  test("second matching namespace returns its own disjoint subset", async () => {
    const { data } = await getNodes({ namespace: "research-lab" });
    expect(refIds(data.nodes ?? [])).toEqual(["feat-graph-walker", "task-ns-parity"]);
  });

  test("namespace lookup falls back to a top-level namespace field", async () => {
    const { status, data } = await getNodes({ namespace: "platform-governance" });
    expect(status).toBe(200);
    expect(refIds(data.nodes ?? [])).toEqual(["concept-error-budgets"]);
  });

  test("properties.namespace wins over a conflicting top-level namespace", async () => {
    // pr-5175 declares properties.namespace="acme-core" AND top-level
    // namespace="audit-archive". Filtering by the top-level value must NOT
    // match it; filtering by the properties value must.
    const viaTopLevel = await getNodes({ namespace: "audit-archive" });
    expect(viaTopLevel.status).toBe(200);
    expect(viaTopLevel.data.nodes).toEqual([]);

    const viaProperties = await getNodes({ namespace: "acme-core" });
    expect(refIds(viaProperties.data.nodes ?? [])).toContain("pr-5175");
  });

  test("unknown namespace returns an empty set with HTTP 200 (not 4xx)", async () => {
    const { status, data } = await getNodes({ namespace: "no-such-partition" });
    expect(status).toBe(200);
    expect(data.status).toBe("success");
    expect(data.nodes).toEqual([]);
  });

  test("respects limit after namespace filtering", async () => {
    const all = await getNodes();
    expect((all.data.nodes ?? []).length).toBe(mockSearchNodes.length);

    const limited = await getNodes({ limit: "3" });
    expect((limited.data.nodes ?? []).length).toBe(3);

    const zero = await getNodes({ limit: "0" });
    expect(zero.status).toBe(200);
    expect(zero.data.nodes).toEqual([]);

    // limit applies to the filtered subset, not the whole corpus
    const scoped = await getNodes({ namespace: "acme-core", limit: "2" });
    expect((scoped.data.nodes ?? []).length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// GET /v2/nodes — other query params kgSearch sends
// ---------------------------------------------------------------------------

describe("GET /api/mock/jarvis/v2/nodes — q/type/domains/edge counts", () => {
  test("include_edge_counts=true attaches a plausible edges map to every node", async () => {
    const { data } = await getNodes({ include_edge_counts: "true" });
    for (const node of data.nodes ?? []) {
      const edges = (node as { edges?: Record<string, unknown> }).edges;
      expect(edges).toBeDefined();
      expect(Object.keys(edges ?? {}).length).toBeGreaterThan(0);
      for (const count of Object.values(edges ?? {})) {
        expect(typeof count).toBe("number");
      }
    }
  });

  test("without include_edge_counts, synthetic edges are not attached", async () => {
    const { data } = await getNodes();
    for (const node of data.nodes ?? []) {
      const typed = node as { ref_id: string; edges?: unknown };
      if (!mockSearchNodes.find((f) => f.ref_id === typed.ref_id)?.edges) {
        expect(typed.edges).toBeUndefined();
      }
    }
  });

  test("static fixture edge maps are preserved verbatim when present", async () => {
    const { data } = await getNodes({ include_edge_counts: "true", type: "Repository" });
    const repo = (data.nodes ?? [])[0] as { ref_id: string; edges?: Record<string, number> };
    expect(repo.ref_id).toBe("repo-hive-main");
    expect(repo.edges).toEqual({ OWNS: 12, PUSHED: 5 });
  });

  test("type filter matches node types case-insensitively", async () => {
    const { data } = await getNodes({ type: "file,hivetask" });
    expect(refIds(data.nodes ?? [])).toEqual(["file-kg-adapter-ts", "readme-root-md", "task-ns-parity"]);
  });

  test("q filter matches name/description text case-insensitively", async () => {
    const { data } = await getNodes({ q: "PaRsEcOnFiG" });
    expect(refIds(data.nodes ?? [])).toEqual(["fn-parse-config"]);
  });

  test("domains filter excludes fixtures whose declared domains do not intersect", async () => {
    const { data } = await getNodes({ domains: "content" });
    const ids = refIds(data.nodes ?? []);
    expect(ids).toContain("readme-root-md"); // declares ["content"]
    expect(ids).not.toContain("repo-hive-main"); // declares ["entity"]
    expect(ids).not.toContain("file-kg-adapter-ts"); // declares ["entity"]
    // undeclared fixtures stay visible
    expect(ids).toContain("fn-auth-token-verify");
  });

  test("filters combine (namespace + type + include_edge_counts)", async () => {
    const { status, data } = await getNodes({
      namespace: "acme-core",
      type: "file",
      include_edge_counts: "true",
    });
    expect(status).toBe(200);
    const nodes = data.nodes ?? [];
    expect(nodes).toHaveLength(1);
    const file = nodes[0] as { ref_id: string; node_type: string; edges?: Record<string, number> };
    expect(file.ref_id).toBe("file-kg-adapter-ts");
    expect(file.node_type).toBe("File");
    expect(file.edges).toEqual({ IMPORTS: 4, HAS_FUNCTION: 2 });
  });
});

// ---------------------------------------------------------------------------
// POST /v2/nodes — untouched, _mock_scenario behaviour
// ---------------------------------------------------------------------------

describe("POST /api/mock/jarvis/v2/nodes", () => {
  test("default scenario returns success with a mock ref_id", async () => {
    const { status, data } = await postScenario({ node_type: "File", node_data: {} });
    expect(status).toBe(200);
    expect(data.status).toBe("success");
    expect(data.data).toEqual({ ref_id: "mock-node-ref-001" });
  });

  test("warning scenario returns Warning status", async () => {
    const { status, data } = await postScenario({ _mock_scenario: "warning" });
    expect(status).toBe(200);
    expect(data.status).toBe("Warning");
    expect(data.data).toEqual({ ref_id: "mock-node-ref-001" });
  });

  test("fail scenario returns a failure message", async () => {
    const { status, data } = await postScenario({ _mock_scenario: "fail" });
    expect(status).toBe(200);
    expect(data.status).toBe("fail");
    expect(typeof data.message).toBe("string");
  });
});

// ---------------------------------------------------------------------------
// Response-shape parity — real kgSearch parses the mock response
// ---------------------------------------------------------------------------

describe("response-shape parity with kgSearch", () => {
  test("kgSearch turns the mock GET response into well-formed hits", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      // Serve the captured request through the real mock GET handler.
      return (await GET(makeGetRequest({}, url))) as unknown as Response;
    });

    try {
      const hits = await kgSearch("http://mock-jarvis.test", "test-key", "namespace");
      expect(hits.length).toBeGreaterThan(0);
      for (const hit of hits) {
        expect(hit.ref_id).toBeTruthy();
        expect(hit.node_type).toBeTruthy();
        expect(typeof hit.name).toBe("string");
        expect(typeof hit.description).toBe("string");
        expect(hit.edges).toBeTypeOf("object");
      }
      // The "namespace" query text matched via the fixture's `text` property,
      // and the hardcoded include_edge_counts=true produced a connectivity map.
      const task = hits.find((h) => h.ref_id === "task-ns-parity");
      expect(task).toBeDefined();
      expect(task?.description).toContain("namespace");
      expect(Object.keys(task?.edges ?? {}).length).toBeGreaterThan(0);
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
