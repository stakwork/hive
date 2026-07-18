import { describe, test, expect, beforeEach, vi } from "vitest";
import { GET } from "@/app/api/workspaces/[slug]/graph/map/route";
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

function createGraphMapRequest(
  slug: string,
  searchParams: Record<string, string> = {},
) {
  return createGetRequest(
    `http://localhost:3000/api/workspaces/${slug}/graph/map`,
    searchParams,
  );
}

async function callRoute(
  slug: string,
  searchParams: Record<string, string> = {},
) {
  const request = createGraphMapRequest(slug, searchParams);
  return GET(request, { params: Promise.resolve({ slug }) });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("GET /api/workspaces/[slug]/graph/map", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getMockedSession().mockResolvedValue(null);
    process.env.USE_MOCKS = "false";
  });

  // ── Authentication ─────────────────────────────────────────────────────────

  test("returns 401 when unauthenticated", async () => {
    getMockedSession().mockResolvedValue(mockUnauthenticatedSession());

    const response = await callRoute("some-slug", { ref_id: "node_ref_1" });

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

    const response = await callRoute("some-slug", { ref_id: "node_ref_1" });

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
        ref_id: "node_ref_1",
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
      email: `viewer-map-${Date.now()}@example.com`,
    });
    const workspace = await createTestWorkspace({ ownerId: owner.id });
    await createTestMembership({
      workspaceId: workspace.id,
      userId: viewer.id,
      role: "VIEWER",
    });

    getMockedSession().mockResolvedValue(createAuthenticatedSession(viewer));

    try {
      const response = await callRoute(workspace.slug, { ref_id: "node_ref_1" });

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
      email: `dev-map-${Date.now()}@example.com`,
    });
    const workspace = await createTestWorkspace({ ownerId: owner.id });
    await createTestMembership({
      workspaceId: workspace.id,
      userId: dev.id,
      role: "DEVELOPER",
    });

    getMockedSession().mockResolvedValue(createAuthenticatedSession(dev));

    try {
      const response = await callRoute(workspace.slug, { ref_id: "node_ref_1" });

      expect(response.status).toBe(403);
    } finally {
      await db.workspace.delete({ where: { id: workspace.id } });
      await db.user.deleteMany({
        where: { id: { in: [owner.id, dev.id] } },
      });
    }
  });

  // ── Validation ─────────────────────────────────────────────────────────────

  test("returns 400 when neither ref_id nor node_type+name provided", async () => {
    const owner = await createTestUser();
    const workspace = await createTestWorkspace({ ownerId: owner.id });

    getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

    try {
      const response = await callRoute(workspace.slug, {});

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.message).toContain("ref_id");
    } finally {
      await db.workspace.delete({ where: { id: workspace.id } });
      await db.user.delete({ where: { id: owner.id } });
    }
  });

  // ── Swarm not configured ───────────────────────────────────────────────────

  test("returns 400 when swarm is not configured", async () => {
    const owner = await createTestUser();
    const slug = generateUniqueSlug("no-swarm-map");
    const workspace = await createTestWorkspace({ ownerId: owner.id, slug });

    getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

    try {
      const response = await callRoute(workspace.slug, { ref_id: "node_ref_1" });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.message).toContain("not configured");
    } finally {
      await db.workspace.delete({ where: { id: workspace.id } });
      await db.user.delete({ where: { id: owner.id } });
    }
  });

  // ── Mock fallback ──────────────────────────────────────────────────────────

  test("returns 200 plain text ASCII tree (USE_MOCKS=true)", async () => {
    const originalUseMocks = process.env.USE_MOCKS;
    process.env.USE_MOCKS = "true";

    const owner = await createTestUser();
    const workspace = await createTestWorkspace({ ownerId: owner.id });

    getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

    try {
      const response = await callRoute(workspace.slug, {
        ref_id: "node_ref_1",
        direction: "both",
        depth: "3",
      });

      expect(response.status).toBe(200);
      // Must be plain text, not JSON
      const contentType = response.headers.get("Content-Type");
      expect(contentType).toContain("text/plain");
      const text = await response.text();
      expect(typeof text).toBe("string");
      expect(text.length).toBeGreaterThan(0);
    } finally {
      process.env.USE_MOCKS = originalUseMocks;
      await db.workspace.delete({ where: { id: workspace.id } });
      await db.user.delete({ where: { id: owner.id } });
    }
  });

  // ── Happy path with swarm ──────────────────────────────────────────────────

  test("returns 200 plain text when swarm is configured", async () => {
    const owner = await createTestUser();
    const workspace = await createTestWorkspace({ ownerId: owner.id });
    await createTestSwarmWithEncryptedApiKey(workspace.id);

    getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

    const mockTree = "<pre>\nMyNode\n└── ChildNode\n</pre>";

    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve(mockTree),
    });

    try {
      const response = await callRoute(workspace.slug, {
        ref_id: "node_ref_1",
        direction: "down",
        depth: "5",
      });

      expect(response.status).toBe(200);
      const contentType = response.headers.get("Content-Type");
      expect(contentType).toContain("text/plain");
      const text = await response.text();
      expect(text).toBe(mockTree);
    } finally {
      global.fetch = originalFetch;
      await db.workspace.delete({ where: { id: workspace.id } });
      await db.user.delete({ where: { id: owner.id } });
    }
  });
});
