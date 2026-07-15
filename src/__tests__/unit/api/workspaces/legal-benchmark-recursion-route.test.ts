/**
 * Unit tests for the legal benchmark recursion API routes:
 *   POST   /api/workspaces/[slug]/legal/benchmarks/recursion
 *   GET    /api/workspaces/[slug]/legal/benchmarks/recursion
 *   DELETE /api/workspaces/[slug]/legal/benchmarks/recursion/[id]
 *
 * Test cases:
 *  POST
 *   1. 201 happy path — creates and returns entry
 *   2. 400 invalid taskSlug pattern
 *   3. 404 foreign runId IDOR (run not found in workspace)
 *   4. 409 duplicate taskSlug enrollment
 *   5. 404 non-openlaw slug
 *  GET
 *   6. 200 returns array of entries
 *  DELETE
 *   7. 200 happy path — removes entry
 *   8. 404 IDOR — wrong workspace
 */

import { describe, test, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ─── Stable mock references (hoisted) ────────────────────────────────────────

const mockDbStakworkRunFindUnique = vi.hoisted(() => vi.fn());
const mockDbLegalBenchmarkRecursionFindUnique = vi.hoisted(() => vi.fn());
const mockDbLegalBenchmarkRecursionFindFirst = vi.hoisted(() => vi.fn());
const mockDbLegalBenchmarkRecursionFindMany = vi.hoisted(() => vi.fn());
const mockDbLegalBenchmarkRecursionCreate = vi.hoisted(() => vi.fn());
const mockDbLegalBenchmarkRecursionDelete = vi.hoisted(() => vi.fn());
const mockGetWorkspaceSwarmAccess = vi.hoisted(() => vi.fn());

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock("@/lib/db", () => ({
  db: {
    stakworkRun: {
      findUnique: mockDbStakworkRunFindUnique,
    },
    legalBenchmarkRecursion: {
      findUnique: mockDbLegalBenchmarkRecursionFindUnique,
      findFirst: mockDbLegalBenchmarkRecursionFindFirst,
      findMany: mockDbLegalBenchmarkRecursionFindMany,
      create: mockDbLegalBenchmarkRecursionCreate,
      delete: mockDbLegalBenchmarkRecursionDelete,
    },
  },
}));

vi.mock("@/lib/middleware/utils", () => ({
  getMiddlewareContext: vi.fn(() => ({ userId: "user-1" })),
  requireAuth: vi.fn(() => ({ id: "user-1" })),
}));

vi.mock("@/lib/helpers/swarm-access", () => ({
  getWorkspaceSwarmAccess: mockGetWorkspaceSwarmAccess,
}));

vi.mock("@/config/env", () => ({
  optionalEnvVars: {
    STAKWORK_BASE_URL: "https://api.stakwork.com/api/v1",
    STAKWORK_API_KEY: "test-key",
  },
}));

// ─── Import subjects under test ───────────────────────────────────────────────

import { POST, GET } from "@/app/api/workspaces/[slug]/legal/benchmarks/recursion/route";
import { DELETE } from "@/app/api/workspaces/[slug]/legal/benchmarks/recursion/[id]/route";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const WORKSPACE_ID = "ws-openlaw-1";

function makeSwarmSuccess() {
  mockGetWorkspaceSwarmAccess.mockResolvedValue({
    success: true,
    data: {
      workspaceId: WORKSPACE_ID,
      swarmUrl: "https://swarm.example.com",
      swarmSecretAlias: "alias-abc",
      swarmApiKey: "decrypted-key",
      swarmName: "openlaw-swarm",
      swarmStatus: "ACTIVE",
      poolName: "pool-1",
    },
  });
}

function makeParams(slug: string, extra?: Record<string, string>) {
  return { params: Promise.resolve({ slug, ...extra }) };
}

function makePostRequest(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/workspaces/openlaw/legal/benchmarks/recursion", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeGetRequest() {
  return new NextRequest("http://localhost/api/workspaces/openlaw/legal/benchmarks/recursion");
}

function makeDeleteRequest(id: string) {
  return new NextRequest(
    `http://localhost/api/workspaces/openlaw/legal/benchmarks/recursion/${id}`,
    { method: "DELETE" },
  );
}

const SAMPLE_ENTRY = {
  id: "rec-1",
  workspaceId: WORKSPACE_ID,
  taskSlug: "corporate/m-and-a/draft-loi",
  status: "ACTIVE" as const,
  runId: "run-abc",
  lastRunId: null,
  lastRunAt: null,
  lastScore: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("POST /api/workspaces/[slug]/legal/benchmarks/recursion", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  test("1. returns 201 on happy path", async () => {
    makeSwarmSuccess();
    mockDbStakworkRunFindUnique.mockResolvedValue({ id: "run-abc" });
    mockDbLegalBenchmarkRecursionFindUnique.mockResolvedValue(null);
    mockDbLegalBenchmarkRecursionCreate.mockResolvedValue(SAMPLE_ENTRY);

    const req = makePostRequest({ taskSlug: "corporate/m-and-a/draft-loi", runId: "run-abc" });
    const res = await POST(req, makeParams("openlaw"));

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toBe("rec-1");
    expect(body.taskSlug).toBe("corporate/m-and-a/draft-loi");
  });

  test("2. returns 400 for invalid taskSlug pattern", async () => {
    makeSwarmSuccess();

    const req = makePostRequest({ taskSlug: "../../etc/passwd", runId: "run-abc" });
    const res = await POST(req, makeParams("openlaw"));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("Invalid taskSlug");
  });

  test("3. returns 404 when runId belongs to foreign workspace (IDOR)", async () => {
    makeSwarmSuccess();
    mockDbStakworkRunFindUnique.mockResolvedValue(null); // not found in this workspace

    const req = makePostRequest({ taskSlug: "corporate/draft-loi", runId: "foreign-run-id" });
    const res = await POST(req, makeParams("openlaw"));

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("Run not found");
  });

  test("4. returns 409 when taskSlug is already enrolled", async () => {
    makeSwarmSuccess();
    mockDbStakworkRunFindUnique.mockResolvedValue({ id: "run-abc" });
    mockDbLegalBenchmarkRecursionFindUnique.mockResolvedValue({ id: "existing-rec" });

    const req = makePostRequest({ taskSlug: "corporate/m-and-a/draft-loi", runId: "run-abc" });
    const res = await POST(req, makeParams("openlaw"));

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe("Already enrolled");
  });

  test("5. returns 404 for non-openlaw slug", async () => {
    const req = makePostRequest({ taskSlug: "corporate/draft-loi", runId: "run-abc" });
    const res = await POST(req, makeParams("other-workspace"));

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("Not found");
    // Should not call swarm access for non-openlaw slugs
    expect(mockGetWorkspaceSwarmAccess).not.toHaveBeenCalled();
  });
});

describe("GET /api/workspaces/[slug]/legal/benchmarks/recursion", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  test("6. returns 200 with correct array shape", async () => {
    makeSwarmSuccess();
    mockDbLegalBenchmarkRecursionFindMany.mockResolvedValue([
      SAMPLE_ENTRY,
      { ...SAMPLE_ENTRY, id: "rec-2", taskSlug: "tax/review-contract", status: "INACTIVE" },
    ]);

    const req = makeGetRequest();
    const res = await GET(req, makeParams("openlaw"));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(2);
    expect(body[0]).toMatchObject({
      id: "rec-1",
      taskSlug: "corporate/m-and-a/draft-loi",
      status: "ACTIVE",
      workspaceId: WORKSPACE_ID,
    });
    expect(body[1]).toMatchObject({
      id: "rec-2",
      taskSlug: "tax/review-contract",
      status: "INACTIVE",
    });
  });
});

describe("DELETE /api/workspaces/[slug]/legal/benchmarks/recursion/[id]", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  test("7. returns 200 and deletes entry on happy path", async () => {
    makeSwarmSuccess();
    mockDbLegalBenchmarkRecursionFindFirst.mockResolvedValue({
      id: "rec-1",
      workspaceId: WORKSPACE_ID,
    });
    mockDbLegalBenchmarkRecursionDelete.mockResolvedValue({ id: "rec-1" });

    const req = makeDeleteRequest("rec-1");
    const res = await DELETE(req, makeParams("openlaw", { id: "rec-1" }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(mockDbLegalBenchmarkRecursionDelete).toHaveBeenCalledWith({
      where: { id: "rec-1" },
    });
  });

  test("8. returns 404 when entry belongs to wrong workspace (IDOR)", async () => {
    makeSwarmSuccess();
    // findFirst returns null because the where clause includes workspaceId scope
    mockDbLegalBenchmarkRecursionFindFirst.mockResolvedValue(null);

    const req = makeDeleteRequest("rec-foreign");
    const res = await DELETE(req, makeParams("openlaw", { id: "rec-foreign" }));

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("Not found");
    expect(mockDbLegalBenchmarkRecursionDelete).not.toHaveBeenCalled();
  });

  test("8b. returns 404 when entry does not exist", async () => {
    makeSwarmSuccess();
    mockDbLegalBenchmarkRecursionFindFirst.mockResolvedValue(null);

    const req = makeDeleteRequest("non-existent-id");
    const res = await DELETE(req, makeParams("openlaw", { id: "non-existent-id" }));

    expect(res.status).toBe(404);
    expect(mockDbLegalBenchmarkRecursionDelete).not.toHaveBeenCalled();
  });
});
