import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import {
  runWorkspaceGraphQuery,
  isWriteQuery,
  GRAPH_QUERY_TIMEOUT_MS,
  GRAPH_QUERY_MAX_LENGTH,
} from "@/services/graph/query";
import { buildMockGraphQueryResult } from "@/app/api/mock/graph/query/fixture";
import { validateWorkspaceAccess } from "@/services/workspace";
import { getSwarmAccessByWorkspaceId } from "@/lib/helpers/swarm-access";
import { db } from "@/lib/db";

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("@/services/workspace", () => ({
  validateWorkspaceAccess: vi.fn(),
}));

vi.mock("@/lib/helpers/swarm-access", () => ({
  getSwarmAccessByWorkspaceId: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    workspace: {
      findFirst: vi.fn(),
    },
  },
}));

const mockedValidate = vi.mocked(validateWorkspaceAccess);
const mockedGetSwarmAccess = vi.mocked(getSwarmAccessByWorkspaceId);
const mockedFindFirst = vi.mocked(db.workspace.findFirst);

function okAccess(): Awaited<ReturnType<typeof validateWorkspaceAccess>> {
  return {
    hasAccess: true,
    canRead: true,
    canWrite: true,
    canAdmin: true,
    userRole: "OWNER",
    workspace: {
      id: "ws-1",
      name: "WS",
      description: null,
      slug: "ws",
      ownerId: "u1",
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  } as unknown as Awaited<ReturnType<typeof validateWorkspaceAccess>>;
}

function okSwarmAccess() {
  return {
    success: true as const,
    data: {
      workspaceId: "ws-1",
      swarmName: "test-swarm",
      swarmUrl: "https://test-swarm.sphinx.chat:3355",
      swarmApiKey: "decrypted-key",
      swarmStatus: "ACTIVE",
      poolName: "pool",
      swarmSecretAlias: null,
    },
  };
}

const UPSTREAM_RESULT = {
  columns: ["n"],
  rows: [[{ ref_id: "ref_1", name: "a.ts", node_type: "File" }]],
};

async function call(args?: Partial<{
  slug: string;
  userId: string;
  query: unknown;
  limit: unknown;
  timeoutMs: number;
}>) {
  return runWorkspaceGraphQuery({
    slug: "ws",
    userId: "u1",
    query: "MATCH (n) RETURN n LIMIT 5",
    ...args,
  });
}

// ── Gate behavior ────────────────────────────────────────────────────────────

describe("runWorkspaceGraphQuery", () => {
  const originalFetch = global.fetch;
  const originalUseMocks = process.env.USE_MOCKS;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.USE_MOCKS = "false";
    mockedValidate.mockResolvedValue(okAccess());
    mockedFindFirst.mockResolvedValue({ id: "ws-1" } as never);
    mockedGetSwarmAccess.mockResolvedValue(okSwarmAccess());
  });

  afterEach(() => {
    process.env.USE_MOCKS = originalUseMocks;
    global.fetch = originalFetch;
  });

  test("returns 404 for a non-member before resolving any credentials", async () => {
    mockedValidate.mockResolvedValue({
      hasAccess: false,
      canRead: false,
      canWrite: false,
      canAdmin: false,
    } as never);

    const result = await call();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(404);
      expect(result.message).toBe("Workspace not found or access denied");
    }
    // IDOR gate must precede credential resolution and upstream calls
    expect(mockedFindFirst).not.toHaveBeenCalled();
    expect(mockedGetSwarmAccess).not.toHaveBeenCalled();
  });

  test("returns 403 for a non-admin member (e.g. DEVELOPER/VIEWER)", async () => {
    mockedValidate.mockResolvedValue({
      hasAccess: true,
      canRead: true,
      canWrite: true,
      canAdmin: false,
      userRole: "DEVELOPER",
    } as never);

    const result = await call();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(403);
      expect(result.message).toBe("Forbidden: admin access required");
    }
    // Admin gate precedes the write guard AND swarm resolution
    expect(mockedFindFirst).not.toHaveBeenCalled();
  });

  test("admin gate runs before the write guard (viewer + CREATE ⇒ 403 admin msg)", async () => {
    mockedValidate.mockResolvedValue({
      hasAccess: true,
      canRead: true,
      canWrite: true,
      canAdmin: false,
      userRole: "VIEWER",
    } as never);

    const result = await call({ query: "CREATE (n:X) RETURN n" });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(403);
      expect(result.message).toBe("Forbidden: admin access required");
    }
  });

  test("returns 400 when query is missing or not a string", async () => {
    for (const badQuery of [undefined, null, 42]) {
      const result = await call({ query: badQuery });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.status).toBe(400);
        expect(result.message).toBe("query is required");
      }
    }
  });

  test("returns 400 locally for queries over 4096 characters (no upstream call)", async () => {
    global.fetch = vi.fn();

    const longQuery = "MATCH (n) RETURN " + "x".repeat(GRAPH_QUERY_MAX_LENGTH);
    const result = await call({ query: longQuery });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.message).toBe(
        `query is too long (max ${GRAPH_QUERY_MAX_LENGTH} characters)`
      );
    }
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test("returns 400 (and does not throw) when the swarm row has no swarmApiKey", async () => {
    global.fetch = vi.fn();
    mockedGetSwarmAccess.mockResolvedValue({
      success: true,
      data: { ...okSwarmAccess().data, swarmApiKey: "" },
    });

    const result = await call();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.message).toBe(
        "Graph DB not configured for this workspace"
      );
    }
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test("returns 400 when swarm resolution fails entirely (no swarm row)", async () => {
    global.fetch = vi.fn();
    mockedGetSwarmAccess.mockResolvedValue({
      success: false,
      error: { type: "SWARM_NOT_CONFIGURED" },
    });

    const result = await call();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(400);
      expect(result.message).toContain("not configured");
    }
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test("maps an upstream timeout to 504", async () => {
    const timeoutError = Object.assign(new Error("The operation was aborted due to timeout"), {
      name: "TimeoutError",
    });
    global.fetch = vi.fn().mockRejectedValue(timeoutError);

    const result = await call({ timeoutMs: 5 });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(504);
      expect(result.message).toContain("timed out");
    }
  });

  test("maps an AbortError rejection to 504 as well", async () => {
    const abortError = Object.assign(new Error("aborted"), { name: "AbortError" });
    global.fetch = vi.fn().mockRejectedValue(abortError);

    const result = await call({ timeoutMs: 5 });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(504);
    }
  });

  test("uses a default 30s timeout when timeoutMs is omitted", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(UPSTREAM_RESULT),
    });
    global.fetch = fetchMock;

    await call();

    const [, init] = fetchMock.mock.calls[0];
    expect(init.signal).toBeDefined();
    expect(GRAPH_QUERY_TIMEOUT_MS).toBe(30_000);
  });

  test("forwards limit unclamped (limit ?? 100)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(UPSTREAM_RESULT),
    });
    global.fetch = fetchMock;

    // No clamp at this layer — 1_000_000 passes through untouched
    await call({ limit: 1_000_000 });
    let body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.limit).toBe(1_000_000);

    // Omitted limit defaults to 100
    await call({});
    body = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(body.limit).toBe(100);
  });

  test("posts language=cypher to the stakgraph /api/hive/query endpoint with token header", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(UPSTREAM_RESULT),
    });
    global.fetch = fetchMock;

    await call({ query: "MATCH (n) RETURN n" });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://test-swarm.sphinx.chat:7799/api/hive/query");
    expect(init.headers["x-api-token"]).toBe("decrypted-key");
    expect(JSON.parse(init.body)).toEqual({
      language: "cypher",
      query: "MATCH (n) RETURN n",
      limit: 100,
    });
  });

  test("honors CUSTOM_SWARM_API_KEY over the decrypted key", async () => {
    process.env.CUSTOM_SWARM_API_KEY = "override-key";
    try {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(UPSTREAM_RESULT),
      });
      global.fetch = fetchMock;

      await call();

      const [, init] = fetchMock.mock.calls[0];
      expect(init.headers["x-api-token"]).toBe("override-key");
    } finally {
      delete process.env.CUSTOM_SWARM_API_KEY;
    }
  });

  test("passes upstream payload through intact and reports meta", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(UPSTREAM_RESULT),
    });

    const result = await call({ limit: 25 });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual(UPSTREAM_RESULT);
      expect((result.data as typeof UPSTREAM_RESULT).columns).toEqual(["n"]);
      expect(result.meta).toEqual({ requestedLimit: 25, limitRewritten: true });
    }
  });

  test("meta.limitRewritten reflects a LIMIT token in the submitted query", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(UPSTREAM_RESULT),
    });
    global.fetch = fetchMock;

    const withLimit = await call({ query: "MATCH (n) RETURN n limit 10" });
    expect(withLimit.ok && withLimit.meta.limitRewritten).toBe(true);

    const withoutLimit = await call({ query: "MATCH (n) RETURN count(n)" });
    expect(withoutLimit.ok && withoutLimit.meta.limitRewritten).toBe(false);
  });

  test("returns Query failed with upstream status and parsed details on non-2xx", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      json: () => Promise.resolve({ error: "bad gateway" }),
    });

    const result = await call();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(502);
      expect(result.message).toBe("Query failed");
      expect(result.details).toEqual({ error: "bad gateway" });
    }
  });

  describe("USE_MOCKS short-circuit", () => {
    test("returns the shared fixture directly without any outbound fetch or swarm resolution", async () => {
      process.env.USE_MOCKS = "true";
      global.fetch = vi.fn();
      // Make downstream deps explode if they're ever reached
      mockedFindFirst.mockRejectedValue(new Error("must not reach swarm resolution"));

      const query = "MATCH (n)-[r]->(m) RETURN n, r, m LIMIT 10";
      const result = await call({ query });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data).toEqual(buildMockGraphQueryResult({ query }));
        expect(Array.isArray((result.data as { rows: [] }).rows)).toBe(true);
        expect(result.meta.requestedLimit).toBe(100);
      }
      expect(mockedFindFirst).not.toHaveBeenCalled();
      expect(global.fetch).not.toHaveBeenCalled();
    });

    test("guards still apply ahead of the mock branch", async () => {
      process.env.USE_MOCKS = "true";

      const denied = await call({ query: "CREATE (n:X)" });
      expect(denied.ok).toBe(false);
      if (!denied.ok) expect(denied.status).toBe(403);

      const invalid = await call({ query: 12345 });
      expect(invalid.ok).toBe(false);
      if (!invalid.ok) expect(invalid.status).toBe(400);
    });
  });
});

// ── Write detection ──────────────────────────────────────────────────────────

describe("isWriteQuery", () => {
  const WRITE_CASES: Array<[string, string]> = [
    ["CREATE (n:Node {name: 'bad'}) RETURN n", "plain CREATE"],
    ["MERGE (n:Node {name: 'bad'}) RETURN n", "plain MERGE"],
    ["MATCH (n) SET n.name = 'x'", "plain SET"],
    ["MATCH (n) DETACH DELETE n", "DETACH DELETE"],
    ["MATCH (n) REMOVE n.secret", "REMOVE property"],
    ["DROP INDEX myIndex", "DROP INDEX"],
    ["FOREACH (x IN [1,2,3] | CREATE (:Num {v:x}))", "FOREACH"],
    [
      "LOAD CSV WITH HEADERS FROM 'file:///users.csv' AS row CREATE (:User {id: row.id})",
      "LOAD CSV writing",
    ],
    ["CALL apoc.create.node(['Person'], {name:'A'})", "apoc.create.node"],
    ["CALL apoc.merge.relationship(a, 'KNOWS', {}, {}, b, {})", "apoc.merge"],
    [
      "CALL apoc.periodic.iterate('MATCH (n) RETURN n', 'SET n.seen=true', {batchSize:100})",
      "apoc.periodic.iterate",
    ],
    ["CALL apoc.atomic.add(n, 'count', 1)", "apoc.atomic"],
    ["CALL apoc.refactor.cloneNodes([n])", "apoc.refactor"],
    ["CALL dbms.security.changePassword('hunter2')", "dbms procedure"],
    ["CALL db.create.setProperty(n, 'k', 'v')", "db.create procedure"],
    [
      "MATCH (n:File) WITH n ORDER BY n.size DESC LIMIT 5 DELETE n",
      "write appended after reads",
    ],
  ];

  const READ_CASES: Array<[string, string]> = [
    ["MATCH (n) RETURN n LIMIT 5", "plain read"],
    [
      "MATCH (n) WHERE n.name CONTAINS 'delete' RETURN n",
      "write keyword inside single-quoted literal",
    ],
    ['WHERE n.title = "MERGE me please" RETURN n', "write keyword inside double-quoted literal"],
    [
      "WHERE n.summary = \"it's a delete-happy doc\" RETURN n",
      "escaped apostrophe inside double quotes",
    ],
    ["RETURN apoc.convert.toJson(collect(n))", "read-only apoc procedure"],
    [
      "CALL db.index.fulltext.queryNodes('searchIdx', 'auth') YIELD node RETURN node",
      "read-only fulltext query procedure",
    ],
    [
      "MATCH (n)-[r]->(m) WHERE n.reset_flag = true RETURN count(n)",
      "property name containing keyword chars is one word",
    ],
    [
      "WITH 'UPDATE' AS label RETURN label",
      "write keyword inside WITH-bound literal",
    ],
  ];

  test.each(WRITE_CASES)("blocks %s (%s)", (query) => {
    expect(isWriteQuery(query)).toBe(true);
  });

  test.each(READ_CASES)("allows %s (%s)", (query) => {
    expect(isWriteQuery(query)).toBe(false);
  });
});
