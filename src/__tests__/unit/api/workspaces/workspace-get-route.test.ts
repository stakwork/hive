import { describe, test, expect, vi, beforeEach, type Mock } from "vitest";
import { NextRequest } from "next/server";

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock("@/lib/middleware/utils", () => ({
  getMiddlewareContext: vi.fn(),
  requireAuth: vi.fn(),
  checkIsSuperAdmin: vi.fn(),
}));

vi.mock("@/services/workspace", () => ({
  getWorkspaceBySlug: vi.fn(),
  getPublicWorkspaceBySlug: vi.fn(),
  deleteWorkspaceBySlug: vi.fn(),
  updateWorkspace: vi.fn(),
}));

vi.mock("@/lib/schemas/workspace", () => ({
  updateWorkspaceSchema: { parse: vi.fn((v) => v) },
}));

// ─── Import after mocks ───────────────────────────────────────────────────────

const utilsMock = vi.mocked(await import("@/lib/middleware/utils"));
const workspaceMock = vi.mocked(await import("@/services/workspace"));

const mockGetMiddlewareContext = utilsMock.getMiddlewareContext as Mock;
const mockRequireAuth = utilsMock.requireAuth as Mock;
const mockCheckIsSuperAdmin = utilsMock.checkIsSuperAdmin as Mock;
const mockGetWorkspaceBySlug = workspaceMock.getWorkspaceBySlug as Mock;
const mockGetPublicWorkspaceBySlug = workspaceMock.getPublicWorkspaceBySlug as Mock;

const { GET } = await import("@/app/api/workspaces/[slug]/route");

// ─── Constants ────────────────────────────────────────────────────────────────

const SLUG = "acme-corp";
const USER_ID = "user-abc";

// ─── Shared workspace shapes ──────────────────────────────────────────────────

const OWNER_SHAPE = {
  id: "ws-1",
  slug: SLUG,
  role: "OWNER",
  isPublicViewable: false,
};

const PUBLIC_VIEWER_SHAPE = {
  id: "ws-1",
  slug: SLUG,
  role: "VIEWER",
  isPublicViewable: true,
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeRequest(slug = SLUG) {
  return new NextRequest(`http://localhost/api/workspaces/${slug}`);
}

function makeParams(slug = SLUG) {
  return { params: Promise.resolve({ slug }) };
}

/** Set up the middleware context to look like an authenticated user. */
function setupAuth(userId = USER_ID) {
  mockGetMiddlewareContext.mockReturnValue({});
  mockRequireAuth.mockReturnValue({ id: userId });
}

/** Set up the middleware context to look like an unauthenticated visitor. */
function setupUnauthenticated() {
  mockGetMiddlewareContext.mockReturnValue({});
  // requireAuth returns a NextResponse (401) when unauthenticated
  const { NextResponse } = require("next/server");
  mockRequireAuth.mockReturnValue(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("GET /api/workspaces/[slug]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Owner / member — hot path ─────────────────────────────────────────────

  describe("Owner / member — hot path", () => {
    test("returns 200 with workspace when user is owner/member", async () => {
      setupAuth();
      // First (pure membership) call returns workspace immediately.
      mockGetWorkspaceBySlug.mockResolvedValueOnce(OWNER_SHAPE);

      const res = await GET(makeRequest(), makeParams());

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.workspace.role).toBe("OWNER");
    });

    test("does NOT call checkIsSuperAdmin when first membership lookup succeeds", async () => {
      setupAuth();
      mockGetWorkspaceBySlug.mockResolvedValueOnce(OWNER_SHAPE);

      await GET(makeRequest(), makeParams());

      expect(mockCheckIsSuperAdmin).not.toHaveBeenCalled();
    });

    test("first call to getWorkspaceBySlug uses no options (pure membership check)", async () => {
      setupAuth();
      mockGetWorkspaceBySlug.mockResolvedValueOnce(OWNER_SHAPE);

      await GET(makeRequest(), makeParams());

      // First call must NOT pass allowPublicViewer or isSuperAdmin.
      expect(mockGetWorkspaceBySlug).toHaveBeenNthCalledWith(1, SLUG, USER_ID);
    });
  });

  // ── Non-member super admin ────────────────────────────────────────────────

  describe("Non-member super admin", () => {
    test("returns 200 with OWNER shape for non-member super admin", async () => {
      setupAuth();
      // First call (pure membership) returns null — caller is a non-member.
      mockGetWorkspaceBySlug.mockResolvedValueOnce(null);
      mockCheckIsSuperAdmin.mockResolvedValueOnce(true);
      // Elevate retry with isSuperAdmin: true returns OWNER shape.
      mockGetWorkspaceBySlug.mockResolvedValueOnce(OWNER_SHAPE);

      const res = await GET(makeRequest(), makeParams());

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.workspace.role).toBe("OWNER");
    });

    test("elevate retry is called with { isSuperAdmin: true } only after first call returns null", async () => {
      setupAuth();
      mockGetWorkspaceBySlug.mockResolvedValueOnce(null);
      mockCheckIsSuperAdmin.mockResolvedValueOnce(true);
      mockGetWorkspaceBySlug.mockResolvedValueOnce(OWNER_SHAPE);

      await GET(makeRequest(), makeParams());

      expect(mockGetWorkspaceBySlug).toHaveBeenCalledTimes(2);
      expect(mockGetWorkspaceBySlug).toHaveBeenNthCalledWith(1, SLUG, USER_ID);
      expect(mockGetWorkspaceBySlug).toHaveBeenNthCalledWith(2, SLUG, USER_ID, { isSuperAdmin: true });
    });

    test("checkIsSuperAdmin is called only in the non-member branch", async () => {
      setupAuth();
      mockGetWorkspaceBySlug.mockResolvedValueOnce(null);
      mockCheckIsSuperAdmin.mockResolvedValueOnce(true);
      mockGetWorkspaceBySlug.mockResolvedValueOnce(OWNER_SHAPE);

      await GET(makeRequest(), makeParams());

      expect(mockCheckIsSuperAdmin).toHaveBeenCalledOnce();
      expect(mockCheckIsSuperAdmin).toHaveBeenCalledWith(USER_ID);
    });

    test("non-member super admin on isPublicViewable workspace gets OWNER shape, NOT VIEWER", async () => {
      setupAuth();
      // First (pure membership) call → null even for a public workspace,
      // because we do NOT pass allowPublicViewer on the first attempt.
      mockGetWorkspaceBySlug.mockResolvedValueOnce(null);
      mockCheckIsSuperAdmin.mockResolvedValueOnce(true);
      // Elevate retry returns OWNER shape (not the public VIEWER shape).
      mockGetWorkspaceBySlug.mockResolvedValueOnce({
        ...OWNER_SHAPE,
        isPublicViewable: true,
        role: "OWNER",
      });

      const res = await GET(makeRequest(), makeParams());

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.workspace.role).toBe("OWNER");
    });
  });

  // ── Non-member, non-super-admin ───────────────────────────────────────────

  describe("Non-member, non-super-admin", () => {
    test("returns 404 for non-member on a private workspace", async () => {
      setupAuth();
      // First call → null (non-member).
      mockGetWorkspaceBySlug.mockResolvedValueOnce(null);
      mockCheckIsSuperAdmin.mockResolvedValueOnce(false);
      // Public-viewer retry → also null (workspace is not public).
      mockGetWorkspaceBySlug.mockResolvedValueOnce(null);

      const res = await GET(makeRequest(), makeParams());

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error).toMatch(/not found|access denied/i);
    });

    test("returns public VIEWER shape for non-member on isPublicViewable workspace", async () => {
      setupAuth();
      // First call → null (non-member, no allowPublicViewer yet).
      mockGetWorkspaceBySlug.mockResolvedValueOnce(null);
      mockCheckIsSuperAdmin.mockResolvedValueOnce(false);
      // Public-viewer fallback retry returns the sanitized VIEWER shape.
      mockGetWorkspaceBySlug.mockResolvedValueOnce(PUBLIC_VIEWER_SHAPE);

      const res = await GET(makeRequest(), makeParams());

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.workspace.role).toBe("VIEWER");
    });

    test("public-viewer fallback retry is called with { allowPublicViewer: true }", async () => {
      setupAuth();
      mockGetWorkspaceBySlug.mockResolvedValueOnce(null);
      mockCheckIsSuperAdmin.mockResolvedValueOnce(false);
      mockGetWorkspaceBySlug.mockResolvedValueOnce(PUBLIC_VIEWER_SHAPE);

      await GET(makeRequest(), makeParams());

      expect(mockGetWorkspaceBySlug).toHaveBeenNthCalledWith(
        2,
        SLUG,
        USER_ID,
        { allowPublicViewer: true },
      );
    });
  });

  // ── Unauthenticated visitor ───────────────────────────────────────────────

  describe("Unauthenticated visitor", () => {
    test("falls back to getPublicWorkspaceBySlug and returns public workspace", async () => {
      setupUnauthenticated();
      mockGetPublicWorkspaceBySlug.mockResolvedValueOnce(PUBLIC_VIEWER_SHAPE);

      const res = await GET(makeRequest(), makeParams());

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.workspace.role).toBe("VIEWER");
      expect(mockGetWorkspaceBySlug).not.toHaveBeenCalled();
    });

    test("returns 404 when workspace is not public and user is unauthenticated", async () => {
      setupUnauthenticated();
      mockGetPublicWorkspaceBySlug.mockResolvedValueOnce(null);

      const res = await GET(makeRequest(), makeParams());

      expect(res.status).toBe(404);
    });
  });

  // ── Slug validation ───────────────────────────────────────────────────────

  describe("Slug validation", () => {
    test("returns 400 when slug is empty string", async () => {
      setupAuth();

      const res = await GET(makeRequest(""), makeParams(""));

      expect(res.status).toBe(400);
    });
  });
});
