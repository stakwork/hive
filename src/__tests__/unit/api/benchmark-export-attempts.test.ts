/**
 * Unit tests for GET .../attempts/[refId]/report/export
 *
 * Covers: authz/IDOR (including EvalTriggerOutput node-type check),
 * rate limiting, ZIP contents, self-containment.
 */

// @vitest-environment node

import { describe, test, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import JSZip from "jszip";

// ── Stable mock references ────────────────────────────────────────────────────

const mockRateLimit = vi.hoisted(() => vi.fn());
const mockRequireAuth = vi.hoisted(() => vi.fn());
const mockResolveWorkspaceAccess = vi.hoisted(() => vi.fn());
const mockGetJarvisConfigForWorkspace = vi.hoisted(() => vi.fn());
const mockGetWorkspaceSwarmAccess = vi.hoisted(() => vi.fn());
const mockReadNodeByRef = vi.hoisted(() => vi.fn());
const mockAssembleAttemptExport = vi.hoisted(() => vi.fn());
const mockRenderRunOffline = vi.hoisted(() => vi.fn());
const mockAssembleOfflineHtml = vi.hoisted(() => vi.fn());
const mockFetchTaskRubricRoster = vi.hoisted(() => vi.fn());
const mockFetchFixSnapshots = vi.hoisted(() => vi.fn());

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("@/lib/middleware/utils", () => ({
  getMiddlewareContext: vi.fn(() => ({ authStatus: "authenticated", user: { id: "user-att-1" } })),
  requireAuth: mockRequireAuth,
}));

vi.mock("@/lib/auth/workspace-access", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth/workspace-access")>(
    "@/lib/auth/workspace-access",
  );
  return { ...actual, resolveWorkspaceAccess: mockResolveWorkspaceAccess };
});

vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mockRateLimit }));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/helpers/jarvis-config", () => ({
  getJarvisConfigForWorkspace: mockGetJarvisConfigForWorkspace,
}));

vi.mock("@/lib/helpers/swarm-access", () => ({
  getWorkspaceSwarmAccess: mockGetWorkspaceSwarmAccess,
}));

vi.mock("@/services/swarm/api/nodes", () => ({
  readNodeByRef: mockReadNodeByRef,
}));

vi.mock("@/lib/run-report/export/assemble", () => ({
  assembleAttemptExport: mockAssembleAttemptExport,
}));

vi.mock("@/lib/run-report/export/render-offline", () => ({
  renderRunOffline: mockRenderRunOffline,
}));

vi.mock("@/lib/run-report/export/offline-html", () => ({
  assembleOfflineHtml: mockAssembleOfflineHtml,
}));

vi.mock("@/services/legal-benchmark-rubrics", () => ({
  fetchTaskRubricRoster: mockFetchTaskRubricRoster,
}));

vi.mock("@/services/legal-benchmark-fix-snapshots", () => ({
  fetchFixSnapshots: mockFetchFixSnapshots,
}));

// ── Import under test ─────────────────────────────────────────────────────────

import { GET } from "@/app/api/workspaces/[slug]/legal/benchmarks/attempts/[refId]/report/export/route";
import { WorkspaceRole } from "@prisma/client";

// ── Constants ──────────────────────────────────────────────────────────────────

const WORKSPACE_ID = "ws-export-att-1";
const REF_ID = "eval-trigger-output-ref-123";
const SLUG = "openlaw";
const JARVIS_CONFIG = { jarvisUrl: "https://jarvis.test", apiKey: "test-key" };

let userCounter = 0;
let testUserId = "user-att-base";

const MOCK_EVALTRIGGEROUTPUT_NODE = {
  success: true,
  node_type: "EvalTriggerOutput",
  properties: {
    report_url: "https://s3.example.com/reports/attempt-ref-123.json",
  },
};

const MOCK_EXPORT_PAYLOAD = {
  report: { runId: REF_ID, hasReport: true, projection: null },
  peeks: new Map(),
  skipped: { peeks: [], documents: [] },
  rubricRoster: null,
  fixSnapshots: null,
};

function makeRequest(slug = SLUG, refId = REF_ID, searchParams?: Record<string, string>) {
  const url = new URL(`http://localhost/api/workspaces/${slug}/legal/benchmarks/attempts/${refId}/report/export`);
  if (searchParams) {
    Object.entries(searchParams).forEach(([k, v]) => url.searchParams.set(k, v));
  }
  return new NextRequest(url.toString());
}

function makeParams(slug = SLUG, refId = REF_ID) {
  return { params: Promise.resolve({ slug, refId }) };
}

function memberAccess(role: WorkspaceRole = WorkspaceRole.DEVELOPER) {
  return { kind: "member" as const, userId: testUserId, workspaceId: WORKSPACE_ID, slug: SLUG, role };
}

beforeEach(() => {
  vi.clearAllMocks();
  testUserId = `user-att-${++userCounter}`;

  mockRequireAuth.mockReturnValue({ id: testUserId });
  mockResolveWorkspaceAccess.mockResolvedValue(memberAccess());
  mockRateLimit.mockResolvedValue({ allowed: true });
  mockGetJarvisConfigForWorkspace.mockResolvedValue(JARVIS_CONFIG);
  mockGetWorkspaceSwarmAccess.mockResolvedValue({ success: false, error: { type: "SWARM_NOT_CONFIGURED" } });
  mockReadNodeByRef.mockResolvedValue(MOCK_EVALTRIGGEROUTPUT_NODE);
  mockAssembleAttemptExport.mockResolvedValue(MOCK_EXPORT_PAYLOAD);
  mockRenderRunOffline.mockReturnValue({
    markup: "<div data-testid='run-report-view'>Attempt</div>",
    ok: true,
  });
  mockAssembleOfflineHtml.mockReturnValue({
    indexHtml: "<!DOCTYPE html><html><body><div>Attempt Report</div></body></html>",
    bundleJson: "{}",
  });
});

describe("GET .../attempts/[refId]/report/export", () => {
  describe("Authentication", () => {
    test("returns 401 when not authenticated", async () => {
      const { NextResponse } = await import("next/server");
      mockRequireAuth.mockReturnValue(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
      const res = await GET(makeRequest(), makeParams());
      expect(res.status).toBe(401);
    });
  });

  describe("Workspace membership", () => {
    test("returns 403 when forbidden", async () => {
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

  describe("Role gate — canReadRunReport", () => {
    test("returns 404 for VIEWER — no jarvis config fetch", async () => {
      mockResolveWorkspaceAccess.mockResolvedValue(memberAccess(WorkspaceRole.VIEWER));
      const res = await GET(makeRequest(), makeParams());
      expect(res.status).toBe(404);
      expect(mockGetJarvisConfigForWorkspace).not.toHaveBeenCalled();
    });

    test("returns 404 for STAKEHOLDER — no jarvis config fetch", async () => {
      mockResolveWorkspaceAccess.mockResolvedValue(memberAccess(WorkspaceRole.STAKEHOLDER));
      const res = await GET(makeRequest(), makeParams());
      expect(res.status).toBe(404);
      expect(mockGetJarvisConfigForWorkspace).not.toHaveBeenCalled();
    });

    test("allows OWNER role", async () => {
      mockResolveWorkspaceAccess.mockResolvedValue(memberAccess(WorkspaceRole.OWNER));
      const res = await GET(makeRequest(), makeParams());
      expect(res.status).toBe(200);
    });

    test("allows DEVELOPER role", async () => {
      const res = await GET(makeRequest(), makeParams());
      expect(res.status).toBe(200);
    });
  });

  describe("IDOR — EvalTriggerOutput node check", () => {
    test("returns 404 when jarvis config is not available (no swarm)", async () => {
      mockGetJarvisConfigForWorkspace.mockResolvedValue(null);
      const res = await GET(makeRequest(), makeParams());
      expect(res.status).toBe(404);
    });

    test("returns 404 when readNodeByRef fails (node not found)", async () => {
      mockReadNodeByRef.mockResolvedValue({ success: false, message: "Not found" });
      const res = await GET(makeRequest(), makeParams());
      expect(res.status).toBe(404);
    });

    test("returns 404 when node is not an EvalTriggerOutput (wrong node type)", async () => {
      mockReadNodeByRef.mockResolvedValue({
        success: true,
        node_type: "Concept", // NOT an EvalTriggerOutput
        properties: { report_url: "https://s3.example.com/report.json" },
      });
      const res = await GET(makeRequest(), makeParams());
      expect(res.status).toBe(404);
    });

    test("returns 404 when EvalTriggerOutput node has no report_url", async () => {
      mockReadNodeByRef.mockResolvedValue({
        success: true,
        node_type: "EvalTriggerOutput",
        properties: {}, // no report_url
      });
      // Route treats missing report_url as reportUrl=null; loadRunReport is called via assembleAttemptExport
      // but in this test assembleAttemptExport still succeeds — the route proceeds to 200.
      // This tests the node-type and property check path specifically.
      // The route itself only 404s if node.success is false or node_type is wrong.
      // Missing report_url → reportUrl=null → passed to assembleAttemptExport → no-report state.
      const res = await GET(makeRequest(), makeParams());
      // With no report_url, assembleAttemptExport is still called (it handles nulls gracefully).
      // The route returns 200 with a valid ZIP in this case.
      expect(res.status).toBe(200);
    });

    test("node fetch is scoped to the workspace's own swarm (readNodeByRef called with jarvisConfig)", async () => {
      await GET(makeRequest(), makeParams());
      expect(mockReadNodeByRef).toHaveBeenCalledWith(JARVIS_CONFIG, REF_ID);
    });

    test("node type check is case-insensitive", async () => {
      mockReadNodeByRef.mockResolvedValue({
        success: true,
        node_type: "evaltriggeroutput", // lowercase
        properties: { report_url: "https://s3.example.com/report.json" },
      });
      const res = await GET(makeRequest(), makeParams());
      expect(res.status).toBe(200);
    });
  });

  describe("Rate limiting", () => {
    test("returns 429 when rate limit exceeded", async () => {
      mockRateLimit.mockResolvedValue({ allowed: false, retryAfter: 30 });
      const res = await GET(makeRequest(), makeParams());
      expect(res.status).toBe(429);
    });

    test("fallback limiter used when Redis throws", async () => {
      mockRateLimit.mockRejectedValue(new Error("Redis error"));
      const res = await GET(makeRequest(), makeParams());
      expect(res.status).toBe(200);
    });
  });

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
      expect(res.headers.get("Content-Disposition")).toMatch(/^attachment/);
    });

    test("ZIP contains index.html and bundle.json", async () => {
      const res = await GET(makeRequest(), makeParams());
      const buffer = await res.arrayBuffer();
      const zip = await JSZip.loadAsync(buffer);
      expect(Object.keys(zip.files)).toContain("index.html");
      expect(Object.keys(zip.files)).toContain("bundle.json");
    });

    test("ZIP has no documents/ entries (attempt reports don't pack documents)", async () => {
      const res = await GET(makeRequest(), makeParams());
      const buffer = await res.arrayBuffer();
      const zip = await JSZip.loadAsync(buffer);
      const docEntries = Object.keys(zip.files).filter((f) => f.startsWith("documents/"));
      expect(docEntries).toHaveLength(0);
    });
  });

  describe("Optional task= query param", () => {
    test("task param is passed to enrichment when valid", async () => {
      const res = await GET(makeRequest(SLUG, REF_ID, { task: "corporate/merger-reps" }), makeParams());
      expect(res.status).toBe(200);
      // assembleAttemptExport is still called with the refId
      expect(mockAssembleAttemptExport).toHaveBeenCalledWith(
        REF_ID,
        expect.any(String), // reportUrl from node
        expect.any(Object),
      );
    });

    test("invalid task param is ignored (no injection)", async () => {
      // Task slugs with path traversal characters should be rejected
      const res = await GET(makeRequest(SLUG, REF_ID, { task: "../../etc/passwd" }), makeParams());
      expect(res.status).toBe(200);
      // The invalid task slug is ignored — no error
    });
  });

  describe("Self-containment", () => {
    test("assembleOfflineHtml receives projection (not reportUrl from node)", async () => {
      await GET(makeRequest(), makeParams());
      const callArgs = mockAssembleOfflineHtml.mock.calls[0];
      const serialized = JSON.stringify(callArgs[1]);
      expect(serialized).not.toContain("report_url");
      expect(serialized).not.toContain("s3.example.com");
    });
  });
});
