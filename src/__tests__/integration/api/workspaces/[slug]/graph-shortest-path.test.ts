import { describe, test, expect, beforeEach, vi } from "vitest";
import { GET } from "@/app/api/workspaces/[slug]/graph/shortest-path/route";
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

function createShortestPathRequest(
  slug: string,
  searchParams: Record<string, string> = {},
) {
  return createGetRequest(
    `http://localhost:3000/api/workspaces/${slug}/graph/shortest-path`,
    searchParams,
  );
}

async function callRoute(
  slug: string,
  searchParams: Record<string, string> = {},
) {
  const request = createShortestPathRequest(slug, searchParams);
  return GET(request, { params: Promise.resolve({ slug }) });
}

const VALID_PARAMS = {
  start_ref_id: "node_ref_start",
  end_ref_id: "node_ref_end",
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("GET /api/workspaces/[slug]/graph/shortest-path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getMockedSession().mockResolvedValue(null);
    process.env.USE_MOCKS = "false";
  });

  // ── Authentication ─────────────────────────────────────────────────────────

  test("returns 401 when unauthenticated", async () => {
    getMockedSession().mockResolvedValue(mockUnauthenticatedSession());

    const response = await callRoute("some-slug", VALID_PARAMS);

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

    const response = await callRoute("some-slug", VALID_PARAMS);

    expect(response.status).toBe(401);
    const data = await response.json();
    expect(data.message).toBe("Invalid user session");
  });

  // ── Workspace Access ───────────────────────────────────────────────────────

  test("returns 404 when workspace does not exist", async () => {
    const user = await createTestUser();
    getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

    try {
      const response = await callRoute(
        "nonexistent-workspace-slug-xyz",
        VALID_PARAMS,
      );

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
      email: `viewer-sp-${Date.now()}@example.com`,
    });
    const workspace = await createTestWorkspace({ ownerId: owner.id });
    await createTestMembership({
      workspaceId: workspace.id,
      userId: viewer.id,
      role: "VIEWER",
    });

    getMockedSession().mockResolvedValue(createAuthenticatedSession(viewer));

    try {
      const response = await callRoute(workspace.slug, VALID_PARAMS);

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
      email: `dev-sp-${Date.now()}@example.com`,
    });
    const workspace = await createTestWorkspace({ ownerId: owner.id });
    await createTestMembership({
      workspaceId: workspace.id,
      userId: dev.id,
      role: "DEVELOPER",
    });

    getMockedSession().mockResolvedValue(createAuthenticatedSession(dev));

    try {
      const response = await callRoute(workspace.slug, VALID_PARAMS);

      expect(response.status).toBe(403);
    } finally {
      await db.workspace.delete({ where: { id: workspace.id } });
      await db.user.deleteMany({
        where: { id: { in: [owner.id, dev.id] } },
      });
    }
  });

  // ── Validation ─────────────────────────────────────────────────────────────

  test("returns 400 when start_ref_id is missing", async () => {
    const owner = await createTestUser();
    const workspace = await createTestWorkspace({ ownerId: owner.id });

    getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

    try {
      const response = await callRoute(workspace.slug, {
        end_ref_id: "node_ref_end",
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.message).toContain("start_ref_id");
    } finally {
      await db.workspace.delete({ where: { id: workspace.id } });
      await db.user.delete({ where: { id: owner.id } });
    }
  });

  test("returns 400 when end_ref_id is missing", async () => {
    const owner = await createTestUser();
    const workspace = await createTestWorkspace({ ownerId: owner.id });

    getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

    try {
      const response = await callRoute(workspace.slug, {
        start_ref_id: "node_ref_start",
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.message).toContain("end_ref_id");
    } finally {
      await db.workspace.delete({ where: { id: workspace.id } });
      await db.user.delete({ where: { id: owner.id } });
    }
  });

  // ── Swarm not configured ───────────────────────────────────────────────────

  test("returns 400 when swarm is not configured", async () => {
    const owner = await createTestUser();
    const slug = generateUniqueSlug("no-swarm-sp");
    const workspace = await createTestWorkspace({ ownerId: owner.id, slug });

    getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

    try {
      const response = await callRoute(workspace.slug, VALID_PARAMS);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.message).toContain("not configured");
    } finally {
      await db.workspace.delete({ where: { id: workspace.id } });
      await db.user.delete({ where: { id: owner.id } });
    }
  });

  // ── Mock fallback ──────────────────────────────────────────────────────────

  test("returns 200 plain text path result (USE_MOCKS=true)", async () => {
    const originalUseMocks = process.env.USE_MOCKS;
    process.env.USE_MOCKS = "true";

    const owner = await createTestUser();
    const workspace = await createTestWorkspace({ ownerId: owner.id });

    getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

    try {
      const response = await callRoute(workspace.slug, VALID_PARAMS);

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

    const mockPath = "Path found:\nNodeA → NodeB → NodeC";

    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve(mockPath),
    });

    try {
      const response = await callRoute(workspace.slug, VALID_PARAMS);

      expect(response.status).toBe(200);
      const contentType = response.headers.get("Content-Type");
      expect(contentType).toContain("text/plain");
      const text = await response.text();
      expect(text).toBe(mockPath);
    } finally {
      global.fetch = originalFetch;
      await db.workspace.delete({ where: { id: workspace.id } });
      await db.user.delete({ where: { id: owner.id } });
    }
  });

  test("returns plain text even when stakgraph returns 'No path found'", async () => {
    const owner = await createTestUser();
    const workspace = await createTestWorkspace({ ownerId: owner.id });
    await createTestSwarmWithEncryptedApiKey(workspace.id);

    getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

    const noPathText = "No path found between the given nodes";

    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve(noPathText),
    });

    try {
      const response = await callRoute(workspace.slug, VALID_PARAMS);

      expect(response.status).toBe(200);
      const contentType = response.headers.get("Content-Type");
      expect(contentType).toContain("text/plain");
      const text = await response.text();
      expect(text).toBe(noPathText);
    } finally {
      global.fetch = originalFetch;
      await db.workspace.delete({ where: { id: workspace.id } });
      await db.user.delete({ where: { id: owner.id } });
    }
  });
});
