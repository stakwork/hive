import { describe, test, expect, beforeEach, vi } from "vitest";
import { GET } from "@/app/api/workspaces/[slug]/graph/search/route";
import { db } from "@/lib/db";
import {
  createTestUser,
  createTestWorkspace,
  createTestMembership,
  createTestSwarmWithEncryptedApiKey,
} from "@/__tests__/support/fixtures";
import {
  createAuthenticatedSession,
  mockUnauthenticatedSession,
  getMockedSession,
  generateUniqueSlug,
  createGetRequest,
} from "@/__tests__/support/helpers";

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("next-auth/next", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("@/lib/auth/nextauth", () => ({
  authOptions: {},
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function createGraphSearchRequest(
  slug: string,
  searchParams: Record<string, string> = {},
) {
  return createGetRequest(
    `http://localhost:3000/api/workspaces/${slug}/graph/search`,
    searchParams,
  );
}

async function callRoute(
  slug: string,
  searchParams: Record<string, string> = {},
) {
  const request = createGraphSearchRequest(slug, searchParams);
  return GET(request, { params: Promise.resolve({ slug }) });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("GET /api/workspaces/[slug]/graph/search", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getMockedSession().mockResolvedValue(null);
    process.env.USE_MOCKS = "false";
  });

  // ── Authentication ─────────────────────────────────────────────────────────

  test("returns 401 when unauthenticated", async () => {
    getMockedSession().mockResolvedValue(mockUnauthenticatedSession());

    const response = await callRoute("some-slug", { query: "auth" });

    expect(response.status).toBe(401);
    const data = await response.json();
    expect(data.success).toBe(false);
    expect(data.message).toBe("Unauthorized");
  });

  test("returns 401 when userId is missing from session", async () => {
    getMockedSession().mockResolvedValue({
      user: { email: "test@example.com" },
      expires: new Date(Date.now() + 86400000).toISOString(),
    });

    const response = await callRoute("some-slug", { query: "auth" });

    expect(response.status).toBe(401);
    const data = await response.json();
    expect(data.message).toBe("Invalid user session");
  });

  // ── Workspace Access ───────────────────────────────────────────────────────

  test("returns 404 when workspace does not exist", async () => {
    const user = await createTestUser();
    getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

    try {
      const response = await callRoute("nonexistent-workspace-slug-xyz", {
        query: "auth",
      });

      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.success).toBe(false);
    } finally {
      await db.user.delete({ where: { id: user.id } });
    }
  });

  test("returns 403 when user is not admin (VIEWER role)", async () => {
    const owner = await createTestUser();
    const viewer = await createTestUser({
      email: `viewer-search-${Date.now()}@example.com`,
    });
    const workspace = await createTestWorkspace({ ownerId: owner.id });
    await createTestMembership({
      workspaceId: workspace.id,
      userId: viewer.id,
      role: "VIEWER",
    });

    getMockedSession().mockResolvedValue(createAuthenticatedSession(viewer));

    try {
      const response = await callRoute(workspace.slug, { query: "auth" });

      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.message).toContain("admin");
    } finally {
      await db.workspace.delete({ where: { id: workspace.id } });
      await db.user.deleteMany({
        where: { id: { in: [owner.id, viewer.id] } },
      });
    }
  });

  test("returns 403 when user is DEVELOPER (not admin)", async () => {
    const owner = await createTestUser();
    const dev = await createTestUser({
      email: `dev-search-${Date.now()}@example.com`,
    });
    const workspace = await createTestWorkspace({ ownerId: owner.id });
    await createTestMembership({
      workspaceId: workspace.id,
      userId: dev.id,
      role: "DEVELOPER",
    });

    getMockedSession().mockResolvedValue(createAuthenticatedSession(dev));

    try {
      const response = await callRoute(workspace.slug, { query: "auth" });

      expect(response.status).toBe(403);
    } finally {
      await db.workspace.delete({ where: { id: workspace.id } });
      await db.user.deleteMany({
        where: { id: { in: [owner.id, dev.id] } },
      });
    }
  });

  // ── Validation ─────────────────────────────────────────────────────────────

  test("returns 400 when query param is missing", async () => {
    const owner = await createTestUser();
    const workspace = await createTestWorkspace({ ownerId: owner.id });

    getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

    try {
      const response = await callRoute(workspace.slug, {});

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.message).toContain("query");
    } finally {
      await db.workspace.delete({ where: { id: workspace.id } });
      await db.user.delete({ where: { id: owner.id } });
    }
  });

  // ── Swarm not configured ───────────────────────────────────────────────────

  test("returns 400 when swarm is not configured", async () => {
    const owner = await createTestUser();
    const slug = generateUniqueSlug("no-swarm-search");
    const workspace = await createTestWorkspace({ ownerId: owner.id, slug });

    getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

    try {
      const response = await callRoute(workspace.slug, { query: "auth" });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.message).toContain("not configured");
    } finally {
      await db.workspace.delete({ where: { id: workspace.id } });
      await db.user.delete({ where: { id: owner.id } });
    }
  });

  // ── Mock fallback ──────────────────────────────────────────────────────────

  test("returns 200 with mock search results (USE_MOCKS=true)", async () => {
    const originalUseMocks = process.env.USE_MOCKS;
    process.env.USE_MOCKS = "true";

    const owner = await createTestUser();
    const workspace = await createTestWorkspace({ ownerId: owner.id });

    getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

    try {
      const response = await callRoute(workspace.slug, { query: "auth" });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBeGreaterThan(0);
      // Verify shape: { name, file, ref_id }
      const first = data[0];
      expect(first).toHaveProperty("name");
      expect(first).toHaveProperty("file");
      expect(first).toHaveProperty("ref_id");
    } finally {
      process.env.USE_MOCKS = originalUseMocks;
      await db.workspace.delete({ where: { id: workspace.id } });
      await db.user.delete({ where: { id: owner.id } });
    }
  });

  // ── Happy path with swarm ──────────────────────────────────────────────────

  test("returns 200 with search results when swarm is configured", async () => {
    const owner = await createTestUser();
    const workspace = await createTestWorkspace({ ownerId: owner.id });
    await createTestSwarmWithEncryptedApiKey(workspace.id);

    getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

    const mockResults = [
      { name: "AuthService", file: "src/lib/auth.ts", ref_id: "AuthService_ref" },
    ];

    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(mockResults),
    });

    try {
      const response = await callRoute(workspace.slug, {
        query: "auth",
        method: "hybrid",
        limit: "10",
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(Array.isArray(data)).toBe(true);
    } finally {
      global.fetch = originalFetch;
      await db.workspace.delete({ where: { id: workspace.id } });
      await db.user.delete({ where: { id: owner.id } });
    }
  });
});
