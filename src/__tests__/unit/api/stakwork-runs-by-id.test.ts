/**
 * Unit tests for:
 * - getStakworkRuns: omits `result` by default, includes it when includeResult=true
 * - getStakworkRunById: IDOR-safe, returns null for cross-workspace/unauthorized
 * - GET /api/stakwork/runs/[runId]: 401 unauthenticated, 404 not-found/unauthorized, 200 authorized
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ─── Hoisted mocks ────────────────────────────────────────────────────────────

const mockDbStakworkRunFindMany = vi.hoisted(() => vi.fn());
const mockDbStakworkRunFindFirst = vi.hoisted(() => vi.fn());
const mockDbStakworkRunCount = vi.hoisted(() => vi.fn());
const mockDbWorkspaceFindUnique = vi.hoisted(() => vi.fn());
const mockRequireAuth = vi.hoisted(() => vi.fn());
const mockGetMiddlewareContext = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db", () => ({
  db: {
    stakworkRun: {
      findMany: mockDbStakworkRunFindMany,
      findFirst: mockDbStakworkRunFindFirst,
      count: mockDbStakworkRunCount,
    },
    workspace: {
      findUnique: mockDbWorkspaceFindUnique,
    },
  },
}));

vi.mock("@/lib/middleware/utils", () => ({
  getMiddlewareContext: mockGetMiddlewareContext,
  requireAuth: mockRequireAuth,
}));

import { getStakworkRuns, getStakworkRunById } from "@/services/stakwork-run";
import { GET } from "@/app/api/stakwork/runs/[runId]/route";
import { NextResponse } from "next/server";

// ─── Shared fixtures ──────────────────────────────────────────────────────────

const WORKSPACE_ID = "clx0000000000000000000001";
const USER_ID = "clx0000000000000000000002";
const RUN_ID = "clx0000000000000000000003";

const BASE_QUERY = {
  workspaceId: WORKSPACE_ID,
  limit: 20,
  offset: 0,
  includeResult: false,
};

const MOCK_RUN_ROW = {
  id: RUN_ID,
  type: "LEGAL_BENCHMARK_RUNNER",
  status: "COMPLETED",
  workspaceId: WORKSPACE_ID,
  featureId: null,
  projectId: 42,
  dataType: "json",
  decision: null,
  feedback: null,
  createdAt: new Date("2025-01-01"),
  updatedAt: new Date("2025-01-01"),
  result: '{"score":1}',
  feature: null,
};

// ─── getStakworkRuns ──────────────────────────────────────────────────────────

describe("getStakworkRuns", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDbWorkspaceFindUnique.mockResolvedValue({
      id: WORKSPACE_ID,
      ownerId: USER_ID,
      deleted: false,
      members: [],
    });
    mockDbStakworkRunCount.mockResolvedValue(1);
  });

  it("omits `result` from the select when includeResult is false", async () => {
    mockDbStakworkRunFindMany.mockResolvedValue([
      { ...MOCK_RUN_ROW, result: undefined },
    ]);

    await getStakworkRuns({ ...BASE_QUERY, includeResult: false }, USER_ID);

    const call = mockDbStakworkRunFindMany.mock.calls[0][0];
    expect(call.select).toBeDefined();
    expect(call.select.result).toBeFalsy();
    // All response-map fields are present
    expect(call.select.id).toBe(true);
    expect(call.select.type).toBe(true);
    expect(call.select.status).toBe(true);
    expect(call.select.workspaceId).toBe(true);
    expect(call.select.featureId).toBe(true);
    expect(call.select.projectId).toBe(true);
    expect(call.select.dataType).toBe(true);
    expect(call.select.decision).toBe(true);
    expect(call.select.feedback).toBe(true);
    expect(call.select.createdAt).toBe(true);
    expect(call.select.updatedAt).toBe(true);
    expect(call.select.feature).toBeDefined();
  });

  it("includes `result` in the select when includeResult is true", async () => {
    mockDbStakworkRunFindMany.mockResolvedValue([MOCK_RUN_ROW]);

    await getStakworkRuns({ ...BASE_QUERY, includeResult: true }, USER_ID);

    const call = mockDbStakworkRunFindMany.mock.calls[0][0];
    expect(call.select.result).toBe(true);
  });

  it("throws 'Access denied' for non-member non-owner", async () => {
    mockDbWorkspaceFindUnique.mockResolvedValue({
      id: WORKSPACE_ID,
      ownerId: "other-user",
      deleted: false,
      members: [],
    });

    await expect(
      getStakworkRuns(BASE_QUERY, USER_ID)
    ).rejects.toThrow("Access denied");
  });
});

// ─── getStakworkRunById ───────────────────────────────────────────────────────

describe("getStakworkRunById", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the run for the workspace owner", async () => {
    mockDbStakworkRunFindFirst.mockResolvedValue(MOCK_RUN_ROW);

    const run = await getStakworkRunById(RUN_ID, USER_ID);
    expect(run).not.toBeNull();
    expect(run?.id).toBe(RUN_ID);

    // Verify the WHERE clause requires both id and authorized workspace
    const whereArg = mockDbStakworkRunFindFirst.mock.calls[0][0].where;
    expect(whereArg.id).toBe(RUN_ID);
    expect(whereArg.workspace).toBeDefined();
    expect(whereArg.workspace.OR).toEqual(
      expect.arrayContaining([
        { ownerId: USER_ID },
        { members: { some: { userId: USER_ID } } },
      ])
    );
  });

  it("returns null for a cross-workspace or unauthorized runId (IDOR guard)", async () => {
    // Simulate DB returning null when workspace constraint doesn't match
    mockDbStakworkRunFindFirst.mockResolvedValue(null);

    const run = await getStakworkRunById("foreign-run-id", USER_ID);
    expect(run).toBeNull();

    // Only one query — no fetch-then-check
    expect(mockDbStakworkRunFindFirst).toHaveBeenCalledTimes(1);
  });
});

// ─── GET /api/stakwork/runs/[runId] ──────────────────────────────────────────

function makeRequest(runId: string): NextRequest {
  return new NextRequest(`http://localhost/api/stakwork/runs/${runId}`, {
    method: "GET",
  });
}

describe("GET /api/stakwork/runs/[runId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when not authenticated (before any DB read)", async () => {
    mockGetMiddlewareContext.mockReturnValue({});
    mockRequireAuth.mockReturnValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    );

    const res = await GET(makeRequest(RUN_ID), {
      params: Promise.resolve({ runId: RUN_ID }),
    });

    expect(res.status).toBe(401);
    // DB must not be queried
    expect(mockDbStakworkRunFindFirst).not.toHaveBeenCalled();
  });

  it("returns 404 (not 403) for a cross-workspace/unauthorized runId", async () => {
    mockGetMiddlewareContext.mockReturnValue({ userId: USER_ID });
    mockRequireAuth.mockReturnValue({ id: USER_ID });
    mockDbStakworkRunFindFirst.mockResolvedValue(null);

    const res = await GET(makeRequest("foreign-run"), {
      params: Promise.resolve({ runId: "foreign-run" }),
    });

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("Not found");
  });

  it("returns 200 with full run including result for an authorized caller", async () => {
    mockGetMiddlewareContext.mockReturnValue({ userId: USER_ID });
    mockRequireAuth.mockReturnValue({ id: USER_ID });
    mockDbStakworkRunFindFirst.mockResolvedValue(MOCK_RUN_ROW);

    const res = await GET(makeRequest(RUN_ID), {
      params: Promise.resolve({ runId: RUN_ID }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.run.id).toBe(RUN_ID);
    expect(body.run.result).toBe('{"score":1}');
  });
});
