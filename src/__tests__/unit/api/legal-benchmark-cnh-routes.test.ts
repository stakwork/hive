/**
 * Unit tests for C&H Law Firm matter routes:
 *  - GET /api/workspaces/[slug]/legal/benchmarks/cnh/matters
 *  - GET /api/workspaces/[slug]/legal/benchmarks/cnh/matters/[matterId]
 *  - POST /api/workspaces/[slug]/legal/benchmarks/cnh/matters/[matterId]/ingest
 *
 * Test cases:
 * Matter list (GET /cnh/matters):
 *  1. Non-LEGAL_SLUG → 404
 *  2. Unauthenticated → 401
 *  3. swarmAccess failure → 403
 *  4. GitHub fetch failure → 502
 *  5. Groups are correctly formed with client prefix and matter IDs
 *  6. Total count reflects only dir entries (not files)
 *  7. Groups sorted ascending by clientCode
 *
 * Matter detail (GET /cnh/matters/[matterId]):
 *  8. Non-LEGAL_SLUG → 404
 *  9. Invalid matterId (no regex match) → 400
 * 10. Path traversal attempt → 400
 * 11. Valid matterId fetches category subdirs and their files in parallel
 * 12. GitHub fetch failure for matter root → 502
 *
 * Ingest trigger (POST /cnh/matters/[matterId]/ingest):
 * 13. Non-LEGAL_SLUG → 404
 * 14. Invalid matterId → 400
 * 15. Stakwork POST failure → rollback run row, return 500
 * 16. Success → run created IN_PROGRESS, returns { run_id, project_id }
 * 17. Missing swarmSecretAlias → 400, no DB write
 * 18. Credential injection — graph_base_url, secret, workspace_id in workflow_params
 */

import { describe, test, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ─── Stable mock references (hoisted) ────────────────────────────────────────

const mockRequireAuth = vi.hoisted(() => vi.fn());
const mockGetWorkspaceSwarmAccess = vi.hoisted(() => vi.fn());
const mockDbStakworkRunCreate = vi.hoisted(() => vi.fn());
const mockDbStakworkRunUpdate = vi.hoisted(() => vi.fn());
const mockDbStakworkRunDeleteMany = vi.hoisted(() => vi.fn());
const mockFetch = vi.hoisted(() => vi.fn());

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock("@/lib/middleware/utils", () => ({
  getMiddlewareContext: vi.fn(() => ({ userId: "user-1" })),
  requireAuth: mockRequireAuth,
}));

vi.mock("@/lib/helpers/swarm-access", () => ({
  getWorkspaceSwarmAccess: mockGetWorkspaceSwarmAccess,
}));

vi.mock("@/lib/db", () => ({
  db: {
    stakworkRun: {
      create: mockDbStakworkRunCreate,
      update: mockDbStakworkRunUpdate,
      deleteMany: mockDbStakworkRunDeleteMany,
    },
  },
}));

vi.mock("@/config/env", () => ({
  optionalEnvVars: {
    STAKWORK_BASE_URL: "https://api.stakwork.com/api/v1",
    STAKWORK_API_KEY: "test-key",
    STAKWORK_CNH_INGEST_WORKFLOW_ID: "57982",
  },
}));

// ─── Import subjects under test ───────────────────────────────────────────────

import { GET as listMatters } from "@/app/api/workspaces/[slug]/legal/benchmarks/cnh/matters/route";
import { GET as getMatterDetail } from "@/app/api/workspaces/[slug]/legal/benchmarks/cnh/matters/[matterId]/route";
import { POST as ingestMatter } from "@/app/api/workspaces/[slug]/legal/benchmarks/cnh/matters/[matterId]/ingest/route";
import { getJarvisUrl } from "@/lib/utils/swarm";

// ─── Shared fixture data ──────────────────────────────────────────────────────

const WORKSPACE_ID = "ws-openlaw";

const MOCK_SWARM_ACCESS = {
  success: true,
  data: {
    workspaceId: WORKSPACE_ID,
    swarmName: "openlaw-swarm",
    swarmUrl: "https://swarm.example.com",
    swarmApiKey: "decrypted-key",
    swarmStatus: "ACTIVE",
    poolName: "pool",
    swarmSecretAlias: "openlaw-alias",
  },
};

const MOCK_MATTERS_DIRS = [
  { name: "1001-00001", type: "dir", path: "tasks/firm-knowledge/dms/matters/1001-00001", size: 0 },
  { name: "1001-00002", type: "dir", path: "tasks/firm-knowledge/dms/matters/1001-00002", size: 0 },
  { name: "1002-00001", type: "dir", path: "tasks/firm-knowledge/dms/matters/1002-00001", size: 0 },
  { name: "2001-00001", type: "dir", path: "tasks/firm-knowledge/dms/matters/2001-00001", size: 0 },
  // A file entry that should be filtered out
  { name: "README.md", type: "file", path: "tasks/firm-knowledge/dms/matters/README.md", size: 1024 },
];

const MOCK_MATTER_CHILDREN = [
  { name: "Antitrust Analysis", type: "dir", path: "tasks/firm-knowledge/dms/matters/1001-00001/Antitrust Analysis", size: 0 },
  { name: "Contracts", type: "dir", path: "tasks/firm-knowledge/dms/matters/1001-00001/Contracts", size: 0 },
];

const MOCK_CATEGORY_FILES = [
  { name: "doc1.pdf", type: "file", path: "tasks/.../doc1.pdf", size: 102400 },
  { name: "doc2.pdf", type: "file", path: "tasks/.../doc2.pdf", size: 204800 },
];

// ─── Helper: make a request ────────────────────────────────────────────────────

function makeRequest(
  slug: string,
  options: { method?: string } = {},
): NextRequest {
  return new NextRequest(
    `http://localhost/api/workspaces/${slug}/legal/benchmarks/cnh/matters`,
    { method: options.method ?? "GET" },
  );
}

// ─── beforeEach reset ─────────────────────────────────────────────────────────

beforeEach(() => {
  vi.resetAllMocks();
  mockRequireAuth.mockReturnValue({ id: "user-1" });
  mockGetWorkspaceSwarmAccess.mockResolvedValue(MOCK_SWARM_ACCESS);
  // Reset global fetch
  global.fetch = mockFetch;
  process.env.NEXTAUTH_URL = "http://localhost:3000";
  process.env.NEXTAUTH_SECRET = "test-secret";
});

// ─── Matter List Route ────────────────────────────────────────────────────────

describe("GET /cnh/matters — Matter List", () => {
  test("1. Non-LEGAL_SLUG slug → 404", async () => {
    const req = makeRequest("other-workspace");
    const res = await listMatters(req, {
      params: Promise.resolve({ slug: "other-workspace" }),
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("Not found");
  });

  test("2. Unauthenticated → 401 (NextResponse from requireAuth)", async () => {
    const { NextResponse } = await import("next/server");
    mockRequireAuth.mockReturnValue(
      NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    );
    const req = makeRequest("openlaw");
    const res = await listMatters(req, {
      params: Promise.resolve({ slug: "openlaw" }),
    });
    expect(res.status).toBe(401);
  });

  test("3. swarmAccess failure → 403", async () => {
    mockGetWorkspaceSwarmAccess.mockResolvedValue({
      success: false,
      error: { type: "ACCESS_DENIED" },
    });
    const req = makeRequest("openlaw");
    const res = await listMatters(req, {
      params: Promise.resolve({ slug: "openlaw" }),
    });
    expect(res.status).toBe(403);
  });

  test("4. GitHub fetch failure → 502", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404, json: async () => ({}) });
    const req = makeRequest("openlaw");
    const res = await listMatters(req, {
      params: Promise.resolve({ slug: "openlaw" }),
    });
    expect(res.status).toBe(502);
  });

  test("5. Groups formed correctly by client prefix", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => MOCK_MATTERS_DIRS,
    });
    const req = makeRequest("openlaw");
    const res = await listMatters(req, {
      params: Promise.resolve({ slug: "openlaw" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.groups).toHaveLength(3); // 1001, 1002, 2001
    const group1001 = body.groups.find(
      (g: { clientCode: string }) => g.clientCode === "1001",
    );
    expect(group1001).toBeDefined();
    expect(group1001.matters).toHaveLength(2);
    expect(group1001.matters[0].matterId).toBe("1001-00001");
    expect(group1001.matters[1].matterId).toBe("1001-00002");
  });

  test("6. Total count reflects only dir entries (not files)", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => MOCK_MATTERS_DIRS,
    });
    const req = makeRequest("openlaw");
    const res = await listMatters(req, {
      params: Promise.resolve({ slug: "openlaw" }),
    });
    const body = await res.json();
    // MOCK_MATTERS_DIRS has 4 dirs and 1 file — total should be 4
    expect(body.total).toBe(4);
  });

  test("7. Groups sorted ascending by clientCode", async () => {
    const unsortedDirs = [
      { name: "2001-00001", type: "dir", path: "p", size: 0 },
      { name: "1001-00001", type: "dir", path: "p", size: 0 },
      { name: "1002-00001", type: "dir", path: "p", size: 0 },
    ];
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => unsortedDirs,
    });
    const req = makeRequest("openlaw");
    const res = await listMatters(req, {
      params: Promise.resolve({ slug: "openlaw" }),
    });
    const body = await res.json();
    const codes = body.groups.map((g: { clientCode: string }) => g.clientCode);
    expect(codes).toEqual(["1001", "1002", "2001"]);
  });
});

// ─── Matter Detail Route ──────────────────────────────────────────────────────

describe("GET /cnh/matters/[matterId] — Matter Detail", () => {
  test("8. Non-LEGAL_SLUG → 404", async () => {
    const req = makeRequest("other-workspace");
    const res = await getMatterDetail(req, {
      params: Promise.resolve({ slug: "other-workspace", matterId: "1001-00001" }),
    });
    expect(res.status).toBe(404);
  });

  test("9. Invalid matterId (missing second segment) → 400", async () => {
    const req = makeRequest("openlaw");
    const res = await getMatterDetail(req, {
      params: Promise.resolve({ slug: "openlaw", matterId: "1001" }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/invalid/i);
  });

  test("10. Path traversal attempt → 400", async () => {
    const req = makeRequest("openlaw");
    const res = await getMatterDetail(req, {
      params: Promise.resolve({ slug: "openlaw", matterId: "../evil" }),
    });
    expect(res.status).toBe(400);
  });

  test("11. Valid matterId fetches categories and files in parallel", async () => {
    // First call: matter root children
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => MOCK_MATTER_CHILDREN,
    });
    // Subsequent calls: one per category dir
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => MOCK_CATEGORY_FILES,
    });

    const req = makeRequest("openlaw");
    const res = await getMatterDetail(req, {
      params: Promise.resolve({ slug: "openlaw", matterId: "1001-00001" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.matterId).toBe("1001-00001");
    expect(body.categories).toHaveLength(2);
    expect(body.categories[0].name).toBe("Antitrust Analysis");
    expect(body.categories[0].files).toHaveLength(2);
    expect(body.categories[0].files[0].name).toBe("doc1.pdf");
    expect(body.categories[0].files[0].size).toBe(102400);
  });

  test("12. GitHub fetch failure for matter root → 502", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404, json: async () => ({}) });
    const req = makeRequest("openlaw");
    const res = await getMatterDetail(req, {
      params: Promise.resolve({ slug: "openlaw", matterId: "1001-00001" }),
    });
    expect(res.status).toBe(502);
  });
});

// ─── Ingest Trigger Route ─────────────────────────────────────────────────────

describe("POST /cnh/matters/[matterId]/ingest — Ingest Trigger", () => {
  test("13. Non-LEGAL_SLUG → 404", async () => {
    const req = new NextRequest(
      "http://localhost/api/workspaces/other-workspace/legal/benchmarks/cnh/matters/1001-00001/ingest",
      { method: "POST" },
    );
    const res = await ingestMatter(req, {
      params: Promise.resolve({ slug: "other-workspace", matterId: "1001-00001" }),
    });
    expect(res.status).toBe(404);
  });

  test("14. Invalid matterId → 400", async () => {
    const req = new NextRequest(
      "http://localhost/api/workspaces/openlaw/legal/benchmarks/cnh/matters/bad-id/ingest",
      { method: "POST" },
    );
    const res = await ingestMatter(req, {
      params: Promise.resolve({ slug: "openlaw", matterId: "bad-id" }),
    });
    expect(res.status).toBe(400);
  });

  test("15. Stakwork POST failure → rollback run row, return 500", async () => {
    mockDbStakworkRunCreate.mockResolvedValue({ id: "run-123" });
    mockDbStakworkRunUpdate.mockResolvedValue({});
    // Stakwork returns non-ok
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) });

    const req = new NextRequest(
      "http://localhost/api/workspaces/openlaw/legal/benchmarks/cnh/matters/1001-00001/ingest",
      { method: "POST" },
    );
    const res = await ingestMatter(req, {
      params: Promise.resolve({ slug: "openlaw", matterId: "1001-00001" }),
    });

    expect(res.status).toBe(500);
    // Run row should be deleted
    expect(mockDbStakworkRunDeleteMany).toHaveBeenCalledWith({
      where: { id: "run-123" },
    });
  });

  test("16. Success → run created IN_PROGRESS, returns { run_id, project_id }", async () => {
    const RUN_ID = "run-abc";
    const PROJECT_ID = 12345;

    mockDbStakworkRunCreate.mockResolvedValue({ id: RUN_ID });
    mockDbStakworkRunUpdate.mockResolvedValue({});
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { project_id: PROJECT_ID } }),
    });

    const req = new NextRequest(
      "http://localhost/api/workspaces/openlaw/legal/benchmarks/cnh/matters/1001-00001/ingest",
      { method: "POST" },
    );
    const res = await ingestMatter(req, {
      params: Promise.resolve({ slug: "openlaw", matterId: "1001-00001" }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.run_id).toBe(RUN_ID);
    expect(body.project_id).toBe(PROJECT_ID);

    // Verify the run was updated to IN_PROGRESS
    expect(mockDbStakworkRunUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: RUN_ID },
        data: expect.objectContaining({ status: "IN_PROGRESS" }),
      }),
    );

    // Verify graph credential vars are included in the Stakwork payload
    const successBody = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    const successVars = successBody.workflow_params.set_var.attributes.vars;
    expect(successVars.graph_base_url).toBe(getJarvisUrl(MOCK_SWARM_ACCESS.data.swarmName));
    expect(successVars.secret).toBe("openlaw-alias");
    expect(successVars.workspace_id).toBe(WORKSPACE_ID);
  });

  test("17. Missing swarmSecretAlias → 400, no DB write", async () => {
    mockGetWorkspaceSwarmAccess.mockResolvedValueOnce({
      ...MOCK_SWARM_ACCESS,
      data: { ...MOCK_SWARM_ACCESS.data, swarmSecretAlias: null },
    });

    const req = new NextRequest(
      "http://localhost/api/workspaces/openlaw/legal/benchmarks/cnh/matters/1001-00001/ingest",
      { method: "POST" },
    );
    const res = await ingestMatter(req, {
      params: Promise.resolve({ slug: "openlaw", matterId: "1001-00001" }),
    });

    expect(res.status).toBe(400);
    expect(mockDbStakworkRunCreate).toHaveBeenCalledTimes(0);
  });

  test("18. Credential injection — graph_base_url, secret, workspace_id in workflow_params", async () => {
    const RUN_ID = "run-creds";
    const PROJECT_ID = 99999;

    mockDbStakworkRunCreate.mockResolvedValue({ id: RUN_ID });
    mockDbStakworkRunUpdate.mockResolvedValue({});
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { project_id: PROJECT_ID } }),
    });

    const req = new NextRequest(
      "http://localhost/api/workspaces/openlaw/legal/benchmarks/cnh/matters/1001-00001/ingest",
      { method: "POST" },
    );
    await ingestMatter(req, {
      params: Promise.resolve({ slug: "openlaw", matterId: "1001-00001" }),
    });

    const rawBody = JSON.parse(mockFetch.mock.calls[0][1].body as string);
    const vars = rawBody.workflow_params.set_var.attributes.vars;
    expect(vars.graph_base_url).toBe(getJarvisUrl(MOCK_SWARM_ACCESS.data.swarmName));
    expect(vars.secret).toBe("openlaw-alias");
    expect(vars.workspace_id).toBe(WORKSPACE_ID);
  });
});
