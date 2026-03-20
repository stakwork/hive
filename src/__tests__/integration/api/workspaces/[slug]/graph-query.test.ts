import { describe, test, expect, beforeEach, vi } from "vitest";
import { POST } from "@/app/api/workspaces/[slug]/graph/query/route";
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
  createPostRequest,
} from "@/__tests__/support/helpers";

// ── Mocks ────────────────────────────────────────────────────────────────────

vi.mock("next-auth/next", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("@/lib/auth/nextauth", () => ({
  authOptions: {},
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function createGraphQueryRequest(slug: string, body: object) {
  return createPostRequest(
    `http://localhost:3000/api/workspaces/${slug}/graph/query`,
    body
  );
}

async function callRoute(slug: string, body: object) {
  const request = createGraphQueryRequest(slug, body);
  return POST(request, { params: Promise.resolve({ slug }) });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /api/workspaces/[slug]/graph/query", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: no session
    getMockedSession().mockResolvedValue(null);
    // Ensure mock mode is off by default so tests hit real code paths
    process.env.USE_MOCKS = "false";
  });

  // ── Authentication ─────────────────────────────────────────────────────────

  test("returns 401 when unauthenticated", async () => {
    getMockedSession().mockResolvedValue(mockUnauthenticatedSession());

    const response = await callRoute("some-slug", { query: "MATCH (n) RETURN n LIMIT 5" });

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

    const response = await callRoute("some-slug", { query: "MATCH (n) RETURN n LIMIT 5" });

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
        query: "MATCH (n) RETURN n LIMIT 5",
      });

      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.success).toBe(false);
    } finally {
      await db.users.delete({ where: { id: user.id } });
    }
  });

  test("returns 403 when user is not admin (VIEWER role)", async () => {
    const owner = await createTestUser();
    const viewer = await createTestUser({ email: `viewer-${Date.now()}@example.com` });
    const workspace = await createTestWorkspace({owner_id: owner.id });
    await createTestMembership({workspace_id: workspace.id,user_id: viewer.id,
      role: "VIEWER",
    });

    getMockedSession().mockResolvedValue(createAuthenticatedSession(viewer));

    try {
      const response = await callRoute(workspace.slug, {
        query: "MATCH (n) RETURN n LIMIT 5",
      });

      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.message).toContain("admin");
    } finally {
      await db.workspaces.delete({ where: { id: workspace.id } });
      await db.users.deleteMany({ where: { id: { in: [owner.id, viewer.id] } } });
    }
  });

  test("returns 403 when user is DEVELOPER (not admin)", async () => {
    const owner = await createTestUser();
    const dev = await createTestUser({ email: `dev-${Date.now()}@example.com` });
    const workspace = await createTestWorkspace({owner_id: owner.id });
    await createTestMembership({workspace_id: workspace.id,user_id: dev.id,
      role: "DEVELOPER",
    });

    getMockedSession().mockResolvedValue(createAuthenticatedSession(dev));

    try {
      const response = await callRoute(workspace.slug, {
        query: "MATCH (n) RETURN n LIMIT 5",
      });

      expect(response.status).toBe(403);
    } finally {
      await db.workspaces.delete({ where: { id: workspace.id } });
      await db.users.deleteMany({ where: { id: { in: [owner.id, dev.id] } } });
    }
  });

  // ── Read-only guard ────────────────────────────────────────────────────────

  const WRITE_QUERIES = [
    "CREATE (n:Node {name: 'bad'}) RETURN n",
    "MERGE (n:Node {name: 'bad'}) RETURN n",
    "MATCH (n) SET n.name = 'bad'",
    "MATCH (n) DELETE n",
    "MATCH (n) REMOVE n.name",
    "DROP INDEX myIndex",
  ];

  WRITE_QUERIES.forEach((writeQuery) => {
    test(`returns 403 for write query: ${writeQuery.slice(0, 30)}…`, async () => {
      const owner = await createTestUser();
      const workspace = await createTestWorkspace({owner_id: owner.id });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      try {
        const response = await callRoute(workspace.slug, { query: writeQuery });

        expect(response.status).toBe(403);
        const data = await response.json();
        expect(data.message).toBe("Write operations are not permitted");
      } finally {
        await db.workspaces.delete({ where: { id: workspace.id } });
        await db.users.delete({ where: { id: owner.id } });
      }
    });
  });

  // ── Mock fallback ──────────────────────────────────────────────────────────

  test("returns 200 with mock data for valid read query (USE_MOCKS=true)", async () => {
    const originalUseMocks = process.env.USE_MOCKS;
    process.env.USE_MOCKS = "true";

    const owner = await createTestUser();
    const workspace = await createTestWorkspace({owner_id: owner.id });

    getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

    try {
      const response = await callRoute(workspace.slug, {
        query: "MATCH (n)-[r]->(m) RETURN n, r, m LIMIT 10",
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(Array.isArray(data.result)).toBe(true);
      expect(data.result.length).toBeGreaterThan(0);
    } finally {
      process.env.USE_MOCKS = originalUseMocks;
      await db.workspaces.delete({ where: { id: workspace.id } });
      await db.users.delete({ where: { id: owner.id } });
    }
  });

  // ── Swarm not configured ───────────────────────────────────────────────────

  test("returns 400 when swarm is not configured", async () => {
    const owner = await createTestUser();
    const slug = generateUniqueSlug("no-swarm");
    const workspace = await createTestWorkspace({owner_id: owner.id, slug });

    getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

    try {
      const response = await callRoute(workspace.slug, {
        query: "MATCH (n) RETURN n LIMIT 5",
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.message).toContain("not configured");
    } finally {
      await db.workspaces.delete({ where: { id: workspace.id } });
      await db.users.delete({ where: { id: owner.id } });
    }
  });

  // ── Invalid body ───────────────────────────────────────────────────────────

  test("returns 400 when query field is missing", async () => {
    const owner = await createTestUser();
    const workspace = await createTestWorkspace({owner_id: owner.id });

    getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

    try {
      const response = await callRoute(workspace.slug, { limit: 50 });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.message).toContain("query");
    } finally {
      await db.workspaces.delete({ where: { id: workspace.id } });
      await db.users.delete({ where: { id: owner.id } });
    }
  });
});
