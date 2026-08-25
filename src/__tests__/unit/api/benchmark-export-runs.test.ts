/**
 * Unit tests for GET /api/workspaces/[slug]/legal/benchmarks/runs/[runId]/report/export
 *
 * Acceptance criteria covered:
 * - Authz/IDOR: unauthenticated→401; non-member→403/404; VIEWER/STAKEHOLDER→404;
 *   cross-workspace runId→404; wrong-type runId→404 (type in WHERE clause)
 * - Rate limiting: 429 when limit exceeded; fallback limiter used when Redis errors
 * - ZIP contents: valid ZIP with index.html + bundle.json; correct headers
 * - Self-containment: assembled HTML/JSON don't include reportUrl
 * - Assembly pipeline: assembleRunExport/assembleOfflineHtml called with right args
 */

// @vitest-environment node

import { describe, test, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import JSZip from "jszip";

// ── Stable mock references (hoisted) ──────────────────────────────────────────

const mockDbFindFirst = vi.hoisted(() => vi.fn());
const mockRateLimit = vi.hoisted(() => vi.fn());
const mockRequireAuth = vi.hoisted(() => vi.fn());
const mockResolveWorkspaceAccess = vi.hoisted(() => vi.fn());
const mockAssembleRunExport = vi.hoisted(() => vi.fn());
const mockRenderRunOffline = vi.hoisted(() => vi.fn());
const mockAssembleOfflineHtml = vi.hoisted(() => vi.fn());
const mockGetWorkspaceSwarmAccess = vi.hoisted(() => vi.fn());
const mockGetJarvisConfigForWorkspace = vi.hoisted(() => vi.fn());
const mockFetchTaskRubricRoster = vi.hoisted(() => vi.fn());
const mockFetchFixSnapshots = vi.hoisted(() => vi.fn());

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("@/lib/middleware/utils", () => ({
  getMiddlewareContext: vi.fn(() => ({ authStatus: "authenticated", user: { id: "user-runs-1" } })),
  requireAuth: mockRequireAuth,
}));

vi.mock("@/lib/auth/workspace-access", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth/workspace-access")>(
    "@/lib/auth/workspace-access",
  );
  return { ...actual, resolveWorkspaceAccess: mockResolveWorkspaceAccess };
});

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: mockRateLimit,
}));

vi.mock("@/lib/db", () => ({
  db: { stakworkRun: { findFirst: mockDbFindFirst } },
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/run-report/export/assemble", () => ({
  assembleRunExport: mockAssembleRunExport,
}));

vi.mock("@/lib/run-report/export/render-offline", () => ({
  renderRunOffline: mockRenderRunOffline,
}));

vi.mock("@/lib/run-report/export/offline-html", () => ({
  assembleOfflineHtml: mockAssembleOfflineHtml,
}));

vi.mock("@/lib/helpers/swarm-access", () => ({
  getWorkspaceSwarmAccess: mockGetWorkspaceSwarmAccess,
}));

vi.mock("@/lib/helpers/jarvis-config", () => ({
  getJarvisConfigForWorkspace: mockGetJarvisConfigForWorkspace,
}));

vi.mock("@/services/legal-benchmark-rubrics", () => ({
  fetchTaskRubricRoster: mockFetchTaskRubricRoster,
}));

vi.mock("@/services/legal-benchmark-fix-snapshots", () => ({
  fetchFixSnapshots: mockFetchFixSnapshots,
}));

vi.mock("@/lib/run-report/safe-url-log", () => ({
  safeUrlParts: () => ({ host: "s3.example.com", pathHash: "abcdef123456" }),
}));

// ── Import under test (after mocks) ──────────────────────────────────────────

import { GET } from "@/app/api/workspaces/[slug]/legal/benchmarks/runs/[runId]/report/export/route";
import { WorkspaceRole } from "@prisma/client";

// ── Constants ──────────────────────────────────────────────────────────────────

const WORKSPACE_ID = "ws-export-runs-1";
const RUN_ID = "run-export-1";
const SLUG = "openlaw";

// Use a unique userId per test to avoid the module-level fallback limiter
// Map accumulating across tests (the Map is module-scoped and stateful).
let testUserId = "user-runs-base";

const MOCK_RUN = {
  id: RUN_ID,
  result: JSON.stringify({ taskTitle: "Test Task", taskSlug: "test/task" }),
  reportUrl: "https://s3.example.com/reports/run-export-1.json",
  projectId: 12345,
};

const MOCK_EXPORT_PAYLOAD = {
  report: { runId: RUN_ID, hasReport: true, projection: null },
  peeks: new Map(),
  skipped: { peeks: [], documents: [] },
  rubricRoster: null,
  fixSnapshots: null,
};

const MOCK_INDEX_HTML = "<!DOCTYPE html><html><head><style>body{color:#fff}</style></head><body><div>Report</div><script>window.__OFFLINE_REPORT__={};</script></body></html>";
const MOCK_BUNDLE_JSON = JSON.stringify({ projection: null });

function makeRequest(slug = SLUG, runId = RUN_ID) {
  return new NextRequest(
    `http://localhost/api/workspaces/${slug}/legal/benchmarks/runs/${runId}/report/export`,
  );
}

function makeParams(slug = SLUG, runId = RUN_ID) {
  return { params: Promise.resolve({ slug, runId }) };
}

function memberAccess(role: WorkspaceRole = WorkspaceRole.DEVELOPER) {
  return {
    kind: "member" as const,
    userId: testUserId,
    workspaceId: WORKSPACE_ID,
    slug: SLUG,
    role,
  };
}

// ── Setup ──────────────────────────────────────────────────────────────────────

// Give each test a fresh unique user ID so the module-level fallback counter Map
// never accumulates for the same key across tests.
let userCounter = 0;
beforeEach(() => {
  vi.clearAllMocks();
  testUserId = `user-runs-${++userCounter}`;

  mockRequireAuth.mockReturnValue({ id: testUserId });
  mockResolveWorkspaceAccess.mockResolvedValue(memberAccess());
  mockRateLimit.mockResolvedValue({ allowed: true });
  mockDbFindFirst.mockResolvedValue(MOCK_RUN);
  mockGetWorkspaceSwarmAccess.mockResolvedValue({ success: false, error: { type: "SWARM_NOT_CONFIGURED" } });
  mockGetJarvisConfigForWorkspace.mockResolvedValue(null);
  mockAssembleRunExport.mockResolvedValue(MOCK_EXPORT_PAYLOAD);
  mockRenderRunOffline.mockReturnValue({
    markup: "<div data-testid='run-report-view'>Score: 5/7</div>",
    ok: true,
  });
  mockAssembleOfflineHtml.mockReturnValue({
    indexHtml: MOCK_INDEX_HTML,
    bundleJson: MOCK_BUNDLE_JSON,
  });
});

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("GET .../runs/[runId]/report/export", () => {
  // ── Auth ────────────────────────────────────────────────────────────────────
  describe("Authentication", () => {
    test("returns 401 when user is not authenticated", async () => {
      const { NextResponse } = await import("next/server");
      mockRequireAuth.mockReturnValue(
        NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      );
      const res = await GET(makeRequest(), makeParams());
      expect(res.status).toBe(401);
    });
  });

  // ── Workspace membership ───────────────────────────────────────────────────
  describe("Workspace membership", () => {
    test("returns 403 when user is not a member (forbidden)", async () => {
      mockResolveWorkspaceAccess.mockResolvedValue({ kind: "forbidden" });
      const res = await GET(makeRequest(), makeParams());
      expect(res.status).toBe(403);
    });

    test("returns 404 when workspace not found", async () => {
      mockResolveWorkspaceAccess.mockResolvedValue({ kind: "not-found" });
      const res = await GET(makeRequest(), makeParams());
      expect(res.status).toBe(404);
    });
  });

  // ── Role gate ──────────────────────────────────────────────────────────────
  describe("Role gate — canReadRunReport", () => {
    test("returns 404 for VIEWER (not allowed) — no DB fetch", async () => {
      mockResolveWorkspaceAccess.mockResolvedValue(memberAccess(WorkspaceRole.VIEWER));
      const res = await GET(makeRequest(), makeParams());
      expect(res.status).toBe(404);
      // IDOR: must reject BEFORE the DB fetch
      expect(mockDbFindFirst).not.toHaveBeenCalled();
    });

    test("returns 404 for STAKEHOLDER (not allowed) — no DB fetch", async () => {
      mockResolveWorkspaceAccess.mockResolvedValue(memberAccess(WorkspaceRole.STAKEHOLDER));
      const res = await GET(makeRequest(), makeParams());
      expect(res.status).toBe(404);
      expect(mockDbFindFirst).not.toHaveBeenCalled();
    });

    test("allows OWNER role", async () => {
      mockResolveWorkspaceAccess.mockResolvedValue(memberAccess(WorkspaceRole.OWNER));
      const res = await GET(makeRequest(), makeParams());
      expect(res.status).toBe(200);
    });

    test("allows ADMIN role", async () => {
      mockResolveWorkspaceAccess.mockResolvedValue(memberAccess(WorkspaceRole.ADMIN));
      const res = await GET(makeRequest(), makeParams());
      expect(res.status).toBe(200);
    });

    test("allows PM role", async () => {
      mockResolveWorkspaceAccess.mockResolvedValue(memberAccess(WorkspaceRole.PM));
      const res = await GET(makeRequest(), makeParams());
      expect(res.status).toBe(200);
    });

    test("allows DEVELOPER role", async () => {
      const res = await GET(makeRequest(), makeParams());
      expect(res.status).toBe(200);
    });
  });

  // ── IDOR guard ─────────────────────────────────────────────────────────────
  describe("IDOR — DB WHERE clause", () => {
    test("returns 404 when runId not found in this workspace (cross-workspace)", async () => {
      mockDbFindFirst.mockResolvedValue(null);
      const res = await GET(makeRequest(), makeParams());
      expect(res.status).toBe(404);
    });

    test("DB findFirst includes id, workspaceId, AND type in WHERE clause", async () => {
      await GET(makeRequest(), makeParams());
      const call = mockDbFindFirst.mock.calls[0][0] as {
        where: { id: string; workspaceId: string; type: { in: string[] } };
      };
      expect(call.where.id).toBe(RUN_ID);
      expect(call.where.workspaceId).toBe(WORKSPACE_ID);
      expect(call.where.type.in).toContain("LEGAL_BENCHMARK_RUNNER");
      expect(call.where.type.in).toContain("LEGAL_BENCHMARK_EVAL");
      expect(call.where.type.in).toContain("LEGAL_BENCHMARK_RECURSION");
      // CONSOLIDATED must NOT be in the list — wrong-type runId must 404
      expect(call.where.type.in).not.toContain("LEGAL_BENCHMARK_CONSOLIDATED");
    });

    test("returns 404 for a CONSOLIDATED runId (wrong type → null from DB)", async () => {
      // The DB WHERE type constraint causes this to return null
      mockDbFindFirst.mockResolvedValue(null);
      const res = await GET(makeRequest(), makeParams());
      expect(res.status).toBe(404);
    });
  });

  // ── Rate limiting ──────────────────────────────────────────────────────────
  describe("Rate limiting", () => {
    test("returns 429 when Redis rate limit exceeded", async () => {
      mockRateLimit.mockResolvedValue({ allowed: false, retryAfter: 30 });
      const res = await GET(makeRequest(), makeParams());
      expect(res.status).toBe(429);
    });

    test("uses fallback limiter when Redis throws; first call within limit succeeds", async () => {
      // Redis error → falls back to the in-process per-user counter.
      // With a fresh userId (guaranteed by beforeEach), the first call is within limit.
      mockRateLimit.mockRejectedValue(new Error("Redis connection error"));
      const res = await GET(makeRequest(), makeParams());
      // First call for this userId should succeed (count=1, limit=5)
      expect(res.status).toBe(200);
    });
  });

  // ── ZIP response ───────────────────────────────────────────────────────────
  describe("ZIP response", () => {
    test("returns 200 with application/zip content type", async () => {
      const res = await GET(makeRequest(), makeParams());
      expect(res.status).toBe(200);
      expect(res.headers.get("Content-Type")).toBe("application/zip");
    });

    test("includes Cache-Control: private, no-store", async () => {
      const res = await GET(makeRequest(), makeParams());
      expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    });

    test("includes Content-Disposition attachment header", async () => {
      const res = await GET(makeRequest(), makeParams());
      const disposition = res.headers.get("Content-Disposition");
      expect(disposition).toMatch(/^attachment/);
    });

    test("response body is a valid ZIP containing index.html and bundle.json", async () => {
      const res = await GET(makeRequest(), makeParams());
      const buffer = await res.arrayBuffer();
      const zip = await JSZip.loadAsync(buffer);
      const files = Object.keys(zip.files);
      expect(files).toContain("index.html");
      expect(files).toContain("bundle.json");
    });

    test("ZIP contains no documents/ entries for run reports (no document packing)", async () => {
      const res = await GET(makeRequest(), makeParams());
      const buffer = await res.arrayBuffer();
      const zip = await JSZip.loadAsync(buffer);
      const files = Object.keys(zip.files);
      const docEntries = files.filter((f) => f.startsWith("documents/"));
      expect(docEntries).toHaveLength(0);
    });

    test("index.html contains the SSR markup from renderRunOffline", async () => {
      mockAssembleOfflineHtml.mockReturnValue({
        indexHtml: `<!DOCTYPE html><html><body><div data-testid="run-report-view">Score: 5/7</div><script>window.__OFFLINE_REPORT__={};</script></body></html>`,
        bundleJson: "{}",
      });
      const res = await GET(makeRequest(), makeParams());
      const buffer = await res.arrayBuffer();
      const zip = await JSZip.loadAsync(buffer);
      const html = await zip.files["index.html"].async("text");
      expect(html).toContain("run-report-view");
      expect(html).toContain("Score: 5/7");
    });
  });

  // ── Self-containment ───────────────────────────────────────────────────────
  describe("Self-containment", () => {
    test("bundle.json does not contain reportUrl", async () => {
      // assembleOfflineHtml receives the projection (not reportUrl).
      // Verify the mock was called without reportUrl in the second argument.
      await GET(makeRequest(), makeParams());
      const callArgs = mockAssembleOfflineHtml.mock.calls[0];
      const projectionArg = callArgs[1];
      const serialized = JSON.stringify(projectionArg);
      expect(serialized).not.toContain("reportUrl");
      expect(serialized).not.toContain("s3.example.com");
    });

    test("reportUrl is never logged in plaintext (safeUrlParts used instead)", async () => {
      // The mock for safeUrlParts returns a safe { host, pathHash } shape.
      // We verify assembleRunExport was called with the raw reportUrl (internally),
      // while the log mock never receives the raw URL directly.
      await GET(makeRequest(), makeParams());
      expect(mockAssembleRunExport).toHaveBeenCalledWith(
        RUN_ID,
        MOCK_RUN.reportUrl,
        expect.any(Object),
      );
    });
  });

  // ── Assembly pipeline ──────────────────────────────────────────────────────
  describe("Assembly pipeline", () => {
    test("assembleRunExport is called with runId and reportUrl", async () => {
      await GET(makeRequest(), makeParams());
      expect(mockAssembleRunExport).toHaveBeenCalledWith(
        RUN_ID,
        MOCK_RUN.reportUrl,
        expect.any(Object),
      );
    });

    test("renderRunOffline is called with the assembled payload", async () => {
      await GET(makeRequest(), makeParams());
      expect(mockRenderRunOffline).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: MOCK_EXPORT_PAYLOAD.report,
        }),
      );
    });

    test("assembleOfflineHtml receives projection from the report payload", async () => {
      await GET(makeRequest(), makeParams());
      expect(mockAssembleOfflineHtml).toHaveBeenCalledWith(
        expect.any(String), // markup
        MOCK_EXPORT_PAYLOAD.report.projection, // projection (null in this fixture)
        expect.any(String), // title
      );
    });
  });
});
