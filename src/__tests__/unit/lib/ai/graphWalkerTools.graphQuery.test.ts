/**
 * Unit tests for the admin-gated `graph_query` agent tool (T2).
 *
 * Covers:
 *   1. Input schema bounds — `limit` outside 1–200 rejected; `query` over 4096 chars rejected
 *   2. Org mismatch — slug outside this session's sourceControlOrgId → { error }, no service call
 *   3. Rate-limit rejection → { error } carrying retry-after guidance, no service call
 *   4. Service 403 → exact terminal non-retryable phrasing
 *   5. Other service failures map onto { error } without throwing
 *   6. Truncation — large synthetic sets flag `truncated` and respect MCP_TOTAL_CHAR_BUDGET
 *   7. Success shape — columns echoed alongside positional rows (+ limitRewritten note)
 *   8. Every failure path returns { error }, incl. a forced service exception (never throws)
 *   9. USE_MOCKS=true chain — real service short-circuits to the T1 fixture, zero outbound fetches
 */

// @vitest-environment node

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — declared before module imports
// ---------------------------------------------------------------------------

/** Stash of the REAL @/services/graph/query exports (for pass-through impls). */
const graphQueryActual = vi.hoisted(() => ({
  current: undefined as typeof import("@/services/graph/query") | undefined,
}));

vi.mock("@/services/graph/query", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/services/graph/query")>();
  graphQueryActual.current = actual;
  // Default: bare spy. The USE_MOCKS test re-points it at the real function so
  // the full tool → service → fixture chain is exercised.
  return { ...actual, runWorkspaceGraphQuery: vi.fn() };
});

vi.mock("@/lib/db", () => ({
  db: {
    workspace: { findFirst: vi.fn(), findMany: vi.fn() },
    sourceControlOrg: { findUnique: vi.fn() },
    canvas: { findUnique: vi.fn(), findMany: vi.fn() },
    feature: { findMany: vi.fn() },
    initiative: { findMany: vi.fn() },
    milestone: { findMany: vi.fn() },
    task: { findMany: vi.fn() },
    repository: { findMany: vi.fn() },
    research: { findMany: vi.fn() },
    htmlPage: { findMany: vi.fn() },
    connection: { findMany: vi.fn() },
    $queryRaw: vi.fn(),
  },
}));

vi.mock("@/services/workspace", () => ({
  validateWorkspaceAccess: vi.fn(),
}));

vi.mock("@/lib/helpers/swarm-access", () => ({
  getSwarmAccessByWorkspaceId: vi.fn(),
}));

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: vi.fn(),
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

// Sibling modules pulled in by graphWalkerTools.ts — stub so none load for real.
vi.mock("@/lib/canvas/io", () => ({ asBlob: vi.fn() }));
vi.mock("@/lib/urn", () => ({
  parseUrn: vi.fn(),
  formatUrn: vi.fn(),
  UrnEdge: { neighborsOf: vi.fn() },
  resolvePgNode: vi.fn(),
  resolveCanvasNode: vi.fn(),
  parseCanvasId: vi.fn(),
}));
vi.mock("@/lib/graph-walker", () => ({ pgNeighbors: vi.fn() }));
vi.mock("@/lib/urn/resolvers/kg", () => ({ resolveKgSeam: vi.fn() }));
vi.mock("@/lib/utils/swarm", () => ({ getJarvisUrl: vi.fn() }));
vi.mock("@/lib/ai/kg-adapter", () => ({
  kgGetNode: vi.fn(),
  kgGetNeighbors: vi.fn(),
  kgGetNodesByRefs: vi.fn(),
  kgSearch: vi.fn(),
  kgGetOntology: vi.fn(),
  kgGetOntologyType: vi.fn(),
  KG_ONTOLOGY_TYPE_SWARM_UNAVAILABLE: "swarm-unavailable",
  KG_ONTOLOGY_TYPE_UNKNOWN: "unknown-type",
}));
vi.mock("ai", () => ({ tool: (t: unknown) => t }));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { db } from "@/lib/db";
import { validateWorkspaceAccess } from "@/services/workspace";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  buildGraphWalkerTools,
  GRAPH_QUERY_FORBIDDEN_MESSAGE,
} from "@/lib/ai/graphWalkerTools";
import {
  MCP_FIELD_CHAR_CAP,
  MCP_TOTAL_CHAR_BUDGET,
} from "@/lib/ai/mcpResult";
import { buildMockGraphQueryResult } from "@/app/api/mock/graph/query/fixture";
import {
  GRAPH_QUERY_MAX_LENGTH,
  runWorkspaceGraphQuery,
  type WorkspaceGraphQuerySuccess,
} from "@/services/graph/query";

// ---------------------------------------------------------------------------
// Typed mock aliases / constants
// ---------------------------------------------------------------------------

const mockFindFirst = db.workspace.findFirst as ReturnType<typeof vi.fn>;
const mockCheckRateLimit = checkRateLimit as ReturnType<typeof vi.fn>;
const mockRunService = runWorkspaceGraphQuery as unknown as ReturnType<typeof vi.fn>;
const mockValidate = validateWorkspaceAccess as ReturnType<typeof vi.fn>;

const ORG_ID = "org-db-id-001";
const USER_ID = "user-id-001";
const SLUG = "code-ws";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface ParseResult {
  success: boolean;
  data?: { limit?: number; query?: string; workspace?: string };
}
interface ToolUnderTest {
  inputSchema: { safeParse(value: unknown): ParseResult };
  execute(args: Record<string, unknown>): Promise<Record<string, unknown>>;
}

function graphQueryTool(): ToolUnderTest {
  const tools = buildGraphWalkerTools(ORG_ID, USER_ID);
  return tools.graph_query as unknown as ToolUnderTest;
}

function serviceOk(
  data: unknown,
  meta: Partial<{ requestedLimit: number; limitRewritten: boolean }> = {},
): WorkspaceGraphQuerySuccess {
  return {
    ok: true,
    data,
    meta: {
      requestedLimit: meta.requestedLimit ?? 50,
      limitRewritten: meta.limitRewritten ?? false,
    },
  };
}

async function exec(
  overrides: Partial<{
    workspace: string;
    query: string;
    limit: number;
  }> = {},
): Promise<Record<string, unknown>> {
  return graphQueryTool().execute({
    workspace: SLUG,
    query: "MATCH (f)-[:CALLS]->(fn) RETURN count(fn)",
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("graph_query tool", () => {
  const ORIGINAL_USE_MOCKS = process.env.USE_MOCKS;
  const ORIGINAL_FETCH = global.fetch;

  beforeEach(() => {
    mockFindFirst.mockReset();
    mockCheckRateLimit.mockReset();
    mockRunService.mockReset();
    mockValidate.mockReset();

    mockFindFirst.mockResolvedValue({ id: "ws-row-1" });
    mockCheckRateLimit.mockResolvedValue({ allowed: true });
  });

  afterEach(() => {
    process.env.USE_MOCKS = ORIGINAL_USE_MOCKS;
    global.fetch = ORIGINAL_FETCH;
  });

  describe("input schema bounds", () => {
    it.each([0, -1, 201, 2.5])("rejects limit outside 1–200 (%s)", (limit) => {
      const parsed = graphQueryTool().inputSchema.safeParse({
        workspace: SLUG,
        query: "MATCH (n) RETURN n",
        limit,
      });
      expect(parsed.success).toBe(false);
    });

    it.each([1, 50, 200])("accepts limit within 1–200 (%s)", (limit) => {
      const parsed = graphQueryTool().inputSchema.safeParse({
        workspace: SLUG,
        query: "MATCH (n) RETURN n",
        limit,
      });
      expect(parsed.success).toBe(true);
      expect(parsed.data?.limit).toBe(limit);
    });

    it("defaults limit to 50 when omitted", () => {
      const parsed = graphQueryTool().inputSchema.safeParse({
        workspace: SLUG,
        query: "MATCH (n) RETURN n",
      });
      expect(parsed.success).toBe(true);
      expect(parsed.data?.limit).toBe(50);
    });

    it(`rejects queries over ${GRAPH_QUERY_MAX_LENGTH} chars`, () => {
      const parsed = graphQueryTool().inputSchema.safeParse({
        workspace: SLUG,
        query: "x".repeat(GRAPH_QUERY_MAX_LENGTH + 1),
      });
      expect(parsed.success).toBe(false);
    });

    it(`accepts queries up to exactly ${GRAPH_QUERY_MAX_LENGTH} chars`, () => {
      const parsed = graphQueryTool().inputSchema.safeParse({
        workspace: SLUG,
        query: "x".repeat(GRAPH_QUERY_MAX_LENGTH),
      });
      expect(parsed.success).toBe(true);
    });

    it("requires the workspace slug", () => {
      const parsed = graphQueryTool().inputSchema.safeParse({
        query: "MATCH (n) RETURN n",
      });
      expect(parsed.success).toBe(false);
    });
  });

  describe("authorization ordering", () => {
    it("org mismatch → { error }, NO rate-limit or service call", async () => {
      mockFindFirst.mockResolvedValue(null);

      const result = await exec();

      expect(result.error).toBe("workspace not found or access denied");
      // Slug belongs to another org → must not even consume rate budget or
      // reach the shared service gate.
      expect(mockCheckRateLimit).not.toHaveBeenCalled();
      expect(mockRunService).not.toHaveBeenCalled();
    });

    it("scopes the org check to sourceControlOrgId === orgId", async () => {
      await exec();

      expect(mockFindFirst).toHaveBeenCalledTimes(1);
      const where = mockFindFirst.mock.calls[0][0] as { where: Record<string, unknown> };
      expect(where.where).toEqual({
        slug: SLUG,
        deleted: false,
        sourceControlOrgId: ORG_ID,
      });
    });

    it("rate-limit rejection → { error } with retry-after guidance, NO service call", async () => {
      mockCheckRateLimit.mockResolvedValue({ allowed: false, retryAfter: 37 });

      const result = await exec();

      expect(result.error).toBe("Rate limit exceeded — retry in 37s");
      expect(String(result.error)).toMatch(/retry/i);
      expect(mockRunService).not.toHaveBeenCalled();
    });

    it("rate-limits per org+user at 20 requests / 60 seconds", async () => {
      await exec();

      expect(mockCheckRateLimit).toHaveBeenCalledWith(
        `graph_query:${ORG_ID}:${USER_ID}`,
        20,
        60,
      );
    });
  });

  describe("service failure mapping", () => {
    it("status 403 → EXACT terminal non-retryable phrasing", async () => {
      mockRunService.mockResolvedValue({
        ok: false,
        status: 403,
        message: "Forbidden: admin access required",
      });

      const result = await exec();

      expect(result.error).toBe(GRAPH_QUERY_FORBIDDEN_MESSAGE);
      expect(result.error).toBe(
        "Forbidden: graph_query requires workspace admin or owner role for the acting user. " +
          "This will not succeed on retry — use graph_search or graph_neighbors instead.",
      );
      expect(String(result.error)).toContain("will not succeed on retry");
    });

    it("non-403 failures keep the service message and status", async () => {
      mockRunService.mockResolvedValue({
        ok: false,
        status: 400,
        message: "Write operations are not permitted",
      });

      const result = await exec();

      expect(result.error).toContain("Write operations are not permitted");
      expect(result.error).toContain("400");
    });

    it("timeouts surface the service's narrowing hint", async () => {
      mockRunService.mockResolvedValue({
        ok: false,
        status: 504,
        message: "Graph query timed out — narrow the pattern or add a more selective anchor",
      });

      const result = await exec();

      expect(result.error).toContain("narrow the pattern");
    });

    it("passes an explicit server-resolved userId to the service", async () => {
      mockRunService.mockResolvedValue(serviceOk({ columns: [], rows: [] }));

      await exec({ limit: 25 });

      expect(mockRunService).toHaveBeenCalledWith({
        slug: SLUG,
        userId: USER_ID,
        query: "MATCH (f)-[:CALLS]->(fn) RETURN count(fn)",
        limit: 25,
      });
    });
  });

  describe("success shaping", () => {
    it("echoes columns alongside positional rows", async () => {
      mockRunService.mockResolvedValue(
        serviceOk({
          columns: ["file", "callers"],
          rows: [
            ["src/a.ts", ["b.ts", "c.ts"]],
            [{ ref_id: "ref_1", node_type: "Function" }, []],
          ],
        }),
      );

      const result = await exec();

      expect(result.error).toBeUndefined();
      expect(result.columns).toEqual(["file", "callers"]);
      expect(Array.isArray(result.rows)).toBe(true);
      const rows = result.rows as unknown[][];
      expect(rows[0]).toEqual(["src/a.ts", ["b.ts", "c.ts"]]);
      expect((rows[1] as unknown[])[0]).toEqual({
        ref_id: "ref_1",
        node_type: "Function",
      });
      expect(result.rowCount).toBe(2);
      expect(result.truncated).toBe(false);
      expect(result.truncationReason).toBeUndefined();
      expect(result.notes).toBeUndefined();
    });

    it("appends a LIMIT-strip note when meta.limitRewritten is true", async () => {
      mockRunService.mockResolvedValue(
        serviceOk({ columns: ["n"], rows: [[1]] }, { limitRewritten: true }),
      );

      const result = await exec({ query: "MATCH (n) RETURN n LIMIT 999" });

      expect(result.error).toBeUndefined();
      const notes = result.notes as string[];
      expect(notes).toHaveLength(1);
      expect(notes[0]).toMatch(/stripped the LIMIT clause/i);
      expect(notes[0]).toMatch(/ORDER BY/i);
      expect(notes[0]).toMatch(/limit argument/i);
    });

    it("tolerates a column-less upstream payload", async () => {
      mockRunService.mockResolvedValue(serviceOk({ rows: [["only"]] }));

      const result = await exec();

      expect(result.columns).toEqual([]);
      expect(result.rowCount).toBe(1);
    });
  });

  describe("truncation", () => {
    it("shortens oversized fields and drops trailing rows within MCP_TOTAL_CHAR_BUDGET", async () => {
      const wideCell = "x".repeat(MCP_FIELD_CHAR_CAP + 500);
      const rows = Array.from({ length: 60 }, (_, i) => [`row-${i}`, wideCell]);
      mockRunService.mockResolvedValue(
        serviceOk({ columns: ["name", "blob"], rows }),
      );

      const result = await exec();

      expect(result.truncated).toBe(true);
      expect(result.truncationReason).toBeDefined();
      expect(String(result.truncationReason)).toMatch(/field cap/i);
      expect(String(result.truncationReason)).toMatch(/dropped/i);

      const serialized = JSON.stringify({
        columns: result.columns,
        rows: result.rows,
      });
      expect(serialized.length).toBeLessThanOrEqual(MCP_TOTAL_CHAR_BUDGET);

      const keptRows = result.rows as unknown[][];
      expect(keptRows.length).toBeGreaterThan(0);
      expect(keptRows.length).toBeLessThan(60);
      expect(result.rowCount).toBe(keptRows.length);

      // Field-level pass actually shortened the wide cell (with marker).
      expect(String(keptRows[0][1])).toContain("[truncated");
      expect(String(keptRows[0][1]).length).toBeLessThan(wideCell.length);
    });

    it("reports when every row had to be dropped", async () => {
      // One row with many wide cells — still over budget even AFTER each
      // cell is shortened to the field cap, so the trailing-row drop empties
      // the result set.
      const wideCells = Array.from(
        { length: 30 },
        () => "y".repeat(MCP_FIELD_CHAR_CAP + 500),
      );
      mockRunService.mockResolvedValue(
        serviceOk({ columns: ["huge"], rows: [wideCells] }),
      );

      const result = await exec();

      expect(result.truncated).toBe(true);
      expect(result.rowCount).toBe(0);
      expect(String(result.truncationReason)).toMatch(/every upstream row was omitted/i);
    });
  });

  describe("failure paths never throw", () => {
    it("a rejected service promise resolves to { error }", async () => {
      mockRunService.mockRejectedValue(new Error("boom"));

      const result = await exec();

      expect(result.error).toBeDefined();
      expect(String(result.error)).toContain("boom");
      expect(result.columns).toBeUndefined();
    });

    it("a SYNCHRONOUS throw inside the service resolves to { error }", async () => {
      mockRunService.mockImplementation(() => {
        throw new Error("sync detonation");
      });

      const result = await exec();

      expect(result.error).toContain("sync detonation");
    });

    it("a malformed non-object service result still maps to { error }", async () => {
      mockRunService.mockResolvedValue(42 as unknown as WorkspaceGraphQuerySuccess);

      const result = await exec();

      expect(result.error).toBeDefined();
      expect(String(result.error)).toContain("undefined"); // status/message absent
    });

    it("db lookup throwing mid-flight resolves to { error }", async () => {
      mockFindFirst.mockRejectedValue(new Error("db down"));

      const result = await exec();

      expect(result.error).toContain("db down");
    });
  });

  describe("USE_MOCKS=true chain", () => {
    it("returns the T1 fixture payload with ZERO outbound fetches", async () => {
      // Re-point the mocked export at the REAL implementation so the whole
      // tool → service → fixture path runs (guards against the tool path
      // resolving to a nonexistent `/api/mock/stakgraph/api/hive/query` route).
      const actual = graphQueryActual.current!;
      mockRunService.mockImplementation(actual.runWorkspaceGraphQuery);

      process.env.USE_MOCKS = "true";
      global.fetch = vi.fn(); // any outbound attempt must fail loudly

      mockValidate.mockResolvedValue({
        hasAccess: true,
        canRead: true,
        canWrite: true,
        canAdmin: true,
        userRole: "ADMIN",
      } as never);

      const query = "MATCH (n) RETURN n LIMIT 5";
      const result = await exec({ query, limit: 50 });

      expect(result.error).toBeUndefined();
      expect(global.fetch).not.toHaveBeenCalled();

      const fixture = buildMockGraphQueryResult({ query });
      expect(result.columns).toEqual(fixture.columns);
      expect(result.rows).toEqual(fixture.rows);
      expect(result.rowCount).toEqual(fixture.rows.length);

      // Only the TOOL's org-context lookup hits the DB — the mock branch sits
      // behind the guards but ahead of swarm resolution.
      expect(mockFindFirst).toHaveBeenCalledTimes(1);
      expect(mockValidate).toHaveBeenCalledWith(SLUG, USER_ID, true);

      // The submitted LIMIT is stripped upstream → note is surfaced.
      const notes = result.notes as string[];
      expect(notes?.[0]).toMatch(/LIMIT/);
      expect(result.truncated).toBe(false);
    });
  });
});
