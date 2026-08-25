/**
 * Unit tests for GET .../consolidated/[runId]/report/export
 *
 * Covers: authz/IDOR, rate limiting, ZIP contents (with documents/),
 * type constraint (CONSOLIDATED only), self-containment.
 */

// @vitest-environment node

import { describe, test, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import JSZip from "jszip";

// ── Stable mock references ────────────────────────────────────────────────────

const mockDbFindFirst = vi.hoisted(() => vi.fn());
const mockRateLimit = vi.hoisted(() => vi.fn());
const mockRequireAuth = vi.hoisted(() => vi.fn());
const mockResolveWorkspaceAccess = vi.hoisted(() => vi.fn());
const mockAssembleConsolidatedExport = vi.hoisted(() => vi.fn());
const mockRenderConsolidatedOffline = vi.hoisted(() => vi.fn());
const mockAssembleOfflineHtml = vi.hoisted(() => vi.fn());

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("@/lib/middleware/utils", () => ({
  getMiddlewareContext: vi.fn(() => ({ authStatus: "authenticated", user: { id: "user-cons-1" } })),
  requireAuth: mockRequireAuth,
}));

vi.mock("@/lib/auth/workspace-access", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth/workspace-access")>(
    "@/lib/auth/workspace-access",
  );
  return { ...actual, resolveWorkspaceAccess: mockResolveWorkspaceAccess };
});

vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mockRateLimit }));

vi.mock("@/lib/db", () => ({
  db: { stakworkRun: { findFirst: mockDbFindFirst } },
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("@/lib/run-report/export/assemble", () => ({
  assembleConsolidatedExport: mockAssembleConsolidatedExport,
}));

vi.mock("@/lib/run-report/export/render-offline", () => ({
  renderConsolidatedOffline: mockRenderConsolidatedOffline,
}));

vi.mock("@/lib/run-report/export/offline-html", () => ({
  assembleOfflineHtml: mockAssembleOfflineHtml,
}));

vi.mock("@/lib/run-report/safe-url-log", () => ({
  safeUrlParts: () => ({ host: "s3.example.com", pathHash: "abcdef" }),
}));

// ── Import under test ─────────────────────────────────────────────────────────

import { GET } from "@/app/api/workspaces/[slug]/legal/benchmarks/consolidated/[runId]/report/export/route";
import { WorkspaceRole } from "@prisma/client";

// ── Constants ──────────────────────────────────────────────────────────────────

const WORKSPACE_ID = "ws-export-cons-1";
const RUN_ID = "consolidated-run-1";
const SLUG = "openlaw";

let userCounter = 0;
let testUserId = "user-cons-base";

const MOCK_RUN = {
  id: RUN_ID,
  result: JSON.stringify({ taskSlug: "corporate/merger-reps" }),
  reportUrl: "https://s3.example.com/reports/consolidated-1.json",
};

const MOCK_EXPORT_PAYLOAD = {
  report: { runId: RUN_ID, hasReport: true, projection: { consolidated: true, runs: [], rubricMatrix: [], rubricDetails: [], taskDescription: "", sourceFileLinks: [] } },
  packedDocuments: [
    { url: "https://s3.example.com/doc1.pdf", entryName: "doc1.pdf", bytes: new Uint8Array([1, 2, 3]) },
  ],
  skipped: { peeks: [], documents: [] },
};

function makeRequest(slug = SLUG, runId = RUN_ID) {
  return new NextRequest(`http://localhost/api/workspaces/${slug}/legal/benchmarks/consolidated/${runId}/report/export`);
}

function makeParams(slug = SLUG, runId = RUN_ID) {
  return { params: Promise.resolve({ slug, runId }) };
}

function memberAccess(role: WorkspaceRole = WorkspaceRole.DEVELOPER) {
  return { kind: "member" as const, userId: testUserId, workspaceId: WORKSPACE_ID, slug: SLUG, role };
}

beforeEach(() => {
  vi.clearAllMocks();
  testUserId = `user-cons-${++userCounter}`;

  mockRequireAuth.mockReturnValue({ id: testUserId });
  mockResolveWorkspaceAccess.mockResolvedValue(memberAccess());
  mockRateLimit.mockResolvedValue({ allowed: true });
  mockDbFindFirst.mockResolvedValue(MOCK_RUN);
  mockAssembleConsolidatedExport.mockResolvedValue(MOCK_EXPORT_PAYLOAD);
  mockRenderConsolidatedOffline.mockReturnValue({
    markup: "<div data-testid='consolidated-report-view'>Matrix</div>",
    ok: true,
  });
  mockAssembleOfflineHtml.mockReturnValue({
    indexHtml: "<!DOCTYPE html><html><body><div>Consolidated</div></body></html>",
    bundleJson: "{}",
  });
});

describe("GET .../consolidated/[runId]/report/export", () => {
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
    test("returns 404 for VIEWER — no DB fetch", async () => {
      mockResolveWorkspaceAccess.mockResolvedValue(memberAccess(WorkspaceRole.VIEWER));
      const res = await GET(makeRequest(), makeParams());
      expect(res.status).toBe(404);
      expect(mockDbFindFirst).not.toHaveBeenCalled();
    });

    test("returns 404 for STAKEHOLDER — no DB fetch", async () => {
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

    test("allows DEVELOPER role", async () => {
      const res = await GET(makeRequest(), makeParams());
      expect(res.status).toBe(200);
    });
  });

  describe("IDOR — type constraint (CONSOLIDATED only)", () => {
    test("returns 404 when runId not found (cross-workspace)", async () => {
      mockDbFindFirst.mockResolvedValue(null);
      const res = await GET(makeRequest(), makeParams());
      expect(res.status).toBe(404);
    });

    test("DB findFirst WHERE clause includes id + workspaceId + CONSOLIDATED type", async () => {
      await GET(makeRequest(), makeParams());
      const call = mockDbFindFirst.mock.calls[0][0] as {
        where: { id: string; workspaceId: string; type: string };
      };
      expect(call.where.id).toBe(RUN_ID);
      expect(call.where.workspaceId).toBe(WORKSPACE_ID);
      expect(call.where.type).toBe("LEGAL_BENCHMARK_CONSOLIDATED");
    });

    test("RUNNER-type runId returns null from DB → 404 (wrong type)", async () => {
      mockDbFindFirst.mockResolvedValue(null);
      const res = await GET(makeRequest(), makeParams());
      expect(res.status).toBe(404);
    });
  });

  describe("Rate limiting", () => {
    test("returns 429 when rate limit exceeded", async () => {
      mockRateLimit.mockResolvedValue({ allowed: false, retryAfter: 30 });
      const res = await GET(makeRequest(), makeParams());
      expect(res.status).toBe(429);
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

    test("ZIP contains index.html and bundle.json", async () => {
      const res = await GET(makeRequest(), makeParams());
      const buffer = await res.arrayBuffer();
      const zip = await JSZip.loadAsync(buffer);
      expect(Object.keys(zip.files)).toContain("index.html");
      expect(Object.keys(zip.files)).toContain("bundle.json");
    });

    test("ZIP contains packed documents/ entries from assembleConsolidatedExport", async () => {
      const res = await GET(makeRequest(), makeParams());
      const buffer = await res.arrayBuffer();
      const zip = await JSZip.loadAsync(buffer);
      expect(Object.keys(zip.files)).toContain("documents/doc1.pdf");
    });

    test("packed document bytes are written to ZIP entry", async () => {
      const res = await GET(makeRequest(), makeParams());
      const buffer = await res.arrayBuffer();
      const zip = await JSZip.loadAsync(buffer);
      const docBytes = await zip.files["documents/doc1.pdf"].async("uint8array");
      expect(docBytes).toEqual(new Uint8Array([1, 2, 3]));
    });

    test("ZIP has no documents/ entries when no documents were packed", async () => {
      mockAssembleConsolidatedExport.mockResolvedValue({
        ...MOCK_EXPORT_PAYLOAD,
        packedDocuments: [],
      });
      const res = await GET(makeRequest(), makeParams());
      const buffer = await res.arrayBuffer();
      const zip = await JSZip.loadAsync(buffer);
      const docEntries = Object.keys(zip.files).filter((f) => f.startsWith("documents/"));
      expect(docEntries).toHaveLength(0);
    });
  });

  describe("Self-containment", () => {
    test("assembleOfflineHtml receives projection (not reportUrl)", async () => {
      await GET(makeRequest(), makeParams());
      const callArgs = mockAssembleOfflineHtml.mock.calls[0];
      const serialized = JSON.stringify(callArgs[1]);
      expect(serialized).not.toContain("reportUrl");
    });
  });
});
