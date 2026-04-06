import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { POST } from "@/app/api/workspaces/[slug]/graph-admin/cmd/route";
import { db } from "@/lib/db";
import {
  createTestUser,
  createTestWorkspace,
  createTestMembership,
  createTestSwarm,
} from "@/__tests__/support/factories";
import {
  createAuthenticatedSession,
  mockUnauthenticatedSession,
  getMockedSession,
} from "@/__tests__/support/helpers";
import { createPostRequest } from "@/__tests__/support/helpers/request-builders";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("next-auth/next", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("@/lib/auth/nextauth", () => ({
  authOptions: {},
}));

vi.mock("@/services/swarm/cmd", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/swarm/cmd")>();
  return {
    ...actual,
    getSwarmCmdJwt: vi.fn(),
    swarmCmdRequest: vi.fn(),
  };
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRequest(slug: string, body: object) {
  return createPostRequest(
    `http://localhost:3000/api/workspaces/${slug}/graph-admin/cmd`,
    body,
  );
}

async function callRoute(slug: string, body: object) {
  const request = makeRequest(slug, body);
  return POST(request as any, { params: Promise.resolve({ slug }) });
}

const GRAPH_ADMIN_CMDS = [
  { type: "Swarm", data: { cmd: "GetBoltwallAccessibility" } },
  { type: "Swarm", data: { cmd: "UpdateBoltwallAccessibility", content: true } },
  { type: "Swarm", data: { cmd: "ListPaidEndpoint" } },
  { type: "Swarm", data: { cmd: "UpdatePaidEndpoint", content: { id: 1, status: false } } },
] as const;

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /api/workspaces/[slug]/graph-admin/cmd", () => {
  let owner: Awaited<ReturnType<typeof createTestUser>>;
  let nonAdminUser: Awaited<ReturnType<typeof createTestUser>>;
  let workspace: Awaited<ReturnType<typeof createTestWorkspace>>;
  let nonGraphWorkspace: Awaited<ReturnType<typeof createTestWorkspace>>;

  const createdEntityIds = {
    userIds: [] as string[],
    workspaceIds: [] as string[],
    swarmIds: [] as string[],
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    getMockedSession().mockResolvedValue(null);

    owner = await createTestUser({ email: `graph-admin-owner-${Date.now()}@test.com` });
    nonAdminUser = await createTestUser({ email: `graph-admin-viewer-${Date.now()}@test.com` });
    createdEntityIds.userIds.push(owner.id, nonAdminUser.id);

    workspace = await createTestWorkspace({
      ownerId: owner.id,
      slug: `graph-admin-test-${Date.now()}`,
      name: "Graph Admin Test Workspace",
    });
    await db.workspace.update({
      where: { id: workspace.id },
      data: { workspaceKind: "graph_mindset" },
    });
    createdEntityIds.workspaceIds.push(workspace.id);

    // Owner is implicitly the workspace owner — add them as OWNER member so
    // validateWorkspaceAccess recognises admin access
    await createTestMembership({
      workspaceId: workspace.id,
      userId: owner.id,
      role: "OWNER",
    });
    await createTestMembership({
      workspaceId: workspace.id,
      userId: nonAdminUser.id,
      role: "VIEWER",
    });

    nonGraphWorkspace = await createTestWorkspace({
      ownerId: owner.id,
      slug: `non-graph-test-${Date.now()}`,
      name: "Non Graph Workspace",
    });
    createdEntityIds.workspaceIds.push(nonGraphWorkspace.id);
    await createTestMembership({
      workspaceId: nonGraphWorkspace.id,
      userId: owner.id,
      role: "OWNER",
    });
  });

  afterEach(async () => {
    if (createdEntityIds.swarmIds.length) {
      await db.swarm.deleteMany({ where: { id: { in: createdEntityIds.swarmIds } } });
      createdEntityIds.swarmIds.length = 0;
    }
    if (createdEntityIds.workspaceIds.length) {
      await db.workspace.deleteMany({ where: { id: { in: createdEntityIds.workspaceIds } } });
      createdEntityIds.workspaceIds.length = 0;
    }
    if (createdEntityIds.userIds.length) {
      await db.user.deleteMany({ where: { id: { in: createdEntityIds.userIds } } });
      createdEntityIds.userIds.length = 0;
    }
  });

  // ── Authentication ────────────────────────────────────────────────────────

  test("returns 401 when unauthenticated", async () => {
    getMockedSession().mockResolvedValue(mockUnauthenticatedSession());

    const response = await callRoute(workspace.slug, {
      cmd: GRAPH_ADMIN_CMDS[0],
    });

    expect(response.status).toBe(401);
    const data = await response.json();
    expect(data.error).toMatch(/unauthorized/i);
  });

  // ── Authorization ─────────────────────────────────────────────────────────

  test("returns 403 when non-admin user", async () => {
    getMockedSession().mockResolvedValue(createAuthenticatedSession(nonAdminUser));

    const response = await callRoute(workspace.slug, {
      cmd: GRAPH_ADMIN_CMDS[0],
    });

    expect(response.status).toBe(403);
    const data = await response.json();
    expect(data.error).toMatch(/admin/i);
  });

  test("returns 403 when workspace is not graph_mindset kind", async () => {
    getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

    const response = await callRoute(nonGraphWorkspace.slug, {
      cmd: GRAPH_ADMIN_CMDS[0],
    });

    expect(response.status).toBe(403);
    const data = await response.json();
    expect(data.error).toMatch(/graphmindset/i);
  });

  // ── Missing infrastructure ────────────────────────────────────────────────

  test("returns 404 when swarm not configured", async () => {
    getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

    const response = await callRoute(workspace.slug, {
      cmd: GRAPH_ADMIN_CMDS[0],
    });

    expect(response.status).toBe(404);
    const data = await response.json();
    expect(data.error).toMatch(/swarm not configured/i);
  });

  test("returns 502 when swarm has no swarmPassword", async () => {
    getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

    const swarm = await createTestSwarm({
      workspaceId: workspace.id,
      swarmUrl: `https://${workspace.slug}.sphinx.chat`,
    });
    createdEntityIds.swarmIds.push(swarm.id);

    const response = await callRoute(workspace.slug, {
      cmd: GRAPH_ADMIN_CMDS[0],
    });

    expect(response.status).toBe(502);
    const data = await response.json();
    expect(data.error).toMatch(/swarm password not configured/i);
  });

  // ── Swarm auth failure ────────────────────────────────────────────────────

  test("returns 502 when getSwarmCmdJwt throws", async () => {
    getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

    const swarm = await createTestSwarm({
      workspaceId: workspace.id,
      swarmUrl: `https://${workspace.slug}.sphinx.chat`,
      swarmPassword: "test-password",
    });
    createdEntityIds.swarmIds.push(swarm.id);

    const { getSwarmCmdJwt } = await import("@/services/swarm/cmd");
    vi.mocked(getSwarmCmdJwt).mockRejectedValue(new Error("Swarm login failed (401)"));

    const response = await callRoute(workspace.slug, {
      cmd: GRAPH_ADMIN_CMDS[0],
    });

    expect(response.status).toBe(502);
    const data = await response.json();
    expect(data.error).toMatch(/swarm login failed/i);
  });

  // ── Success cases ─────────────────────────────────────────────────────────

  describe("200 success for all four cmd types", () => {
    let swarm: Awaited<ReturnType<typeof createTestSwarm>>;

    beforeEach(async () => {
      swarm = await createTestSwarm({
        workspaceId: workspace.id,
        swarmUrl: `https://${workspace.slug}.sphinx.chat`,
        swarmPassword: "test-password-123",
      });
      createdEntityIds.swarmIds.push(swarm.id);

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const { getSwarmCmdJwt, swarmCmdRequest } = await import("@/services/swarm/cmd");
      vi.mocked(getSwarmCmdJwt).mockResolvedValue("mock-jwt-token");
      vi.mocked(swarmCmdRequest).mockResolvedValue({
        ok: true,
        status: 200,
        data: { success: true },
      });
    });

    test("GetBoltwallAccessibility returns 200", async () => {
      const { swarmCmdRequest } = await import("@/services/swarm/cmd");
      vi.mocked(swarmCmdRequest).mockResolvedValue({
        ok: true,
        status: 200,
        data: { isPublic: false },
      });

      const response = await callRoute(workspace.slug, {
        cmd: { type: "Swarm", data: { cmd: "GetBoltwallAccessibility" } },
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.isPublic).toBe(false);

      expect(vi.mocked(swarmCmdRequest)).toHaveBeenCalledWith(
        expect.objectContaining({
          swarmUrl: swarm.swarmUrl,
          jwt: "mock-jwt-token",
          cmd: { type: "Swarm", data: { cmd: "GetBoltwallAccessibility" } },
        }),
      );
    });

    test("UpdateBoltwallAccessibility returns 200", async () => {
      const { swarmCmdRequest } = await import("@/services/swarm/cmd");
      vi.mocked(swarmCmdRequest).mockResolvedValue({
        ok: true,
        status: 200,
        data: { success: true },
      });

      const response = await callRoute(workspace.slug, {
        cmd: { type: "Swarm", data: { cmd: "UpdateBoltwallAccessibility", content: true } },
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
    });

    test("ListPaidEndpoint returns 200", async () => {
      const endpoints = [
        { id: 1, route: "v2/search", method: "GET", status: true, fee: 10 },
      ];
      const { swarmCmdRequest } = await import("@/services/swarm/cmd");
      vi.mocked(swarmCmdRequest).mockResolvedValue({
        ok: true,
        status: 200,
        data: { endpoints },
      });

      const response = await callRoute(workspace.slug, {
        cmd: { type: "Swarm", data: { cmd: "ListPaidEndpoint" } },
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.endpoints).toHaveLength(1);
    });

    test("UpdatePaidEndpoint returns 200", async () => {
      const { swarmCmdRequest } = await import("@/services/swarm/cmd");
      vi.mocked(swarmCmdRequest).mockResolvedValue({
        ok: true,
        status: 200,
        data: { success: true },
      });

      const response = await callRoute(workspace.slug, {
        cmd: { type: "Swarm", data: { cmd: "UpdatePaidEndpoint", content: { id: 1, status: false } } },
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
    });
  });

  // ── Invalid cmd ────────────────────────────────────────────────────────────

  test("returns 400 for disallowed cmd type", async () => {
    getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

    const swarm = await createTestSwarm({
      workspaceId: workspace.id,
      swarmUrl: `https://${workspace.slug}.sphinx.chat`,
      swarmPassword: "test-password",
    });
    createdEntityIds.swarmIds.push(swarm.id);

    const response = await callRoute(workspace.slug, {
      cmd: { type: "Swarm", data: { cmd: "UpdateNeo4jConfig", content: {} } },
    });

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toMatch(/invalid cmd/i);
  });
});
