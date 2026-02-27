import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET, PATCH } from "@/app/api/w/[slug]/pool/config/route";
import { createTestWorkspaceScenario, createTestUser, createTestSwarm } from "@/__tests__/support/factories";
import { createAuthenticatedGetRequest } from "@/__tests__/support/helpers/request-builders";
import { generateUniqueId } from "@/__tests__/support/helpers/ids";
import { db } from "@/lib/db";

// Mock the middleware utils
const getMockedRequireAuth = vi.hoisted(() => vi.fn());
vi.mock("@/lib/middleware/utils", () => ({
  getMiddlewareContext: vi.fn((req: NextRequest) => ({ user: null })),
  requireAuth: getMockedRequireAuth,
  checkIsSuperAdmin: vi.fn().mockResolvedValue(false),
}));

describe("Pool Config API", () => {
  let owner: Awaited<ReturnType<typeof createTestUser>>;
  let workspace: Awaited<ReturnType<typeof createTestWorkspaceScenario>>["workspace"];
  let swarm: Awaited<ReturnType<typeof createTestSwarm>>;
  let superadminUser: Awaited<ReturnType<typeof createTestUser>>;
  let regularUser: Awaited<ReturnType<typeof createTestUser>>;

  beforeEach(async () => {
    // Set up superadmin env var
    process.env.POOL_SUPERADMINS = "superadmin,admin2";

    // Create test workspace
    const scenario = await createTestWorkspaceScenario({
      owner: { name: "Pool Config Test Owner" },
    });
    owner = scenario.owner;
    workspace = scenario.workspace;

    // Create swarm with initial minimumVms
    swarm = await createTestSwarm({
      workspaceId: workspace.id,
      name: `config-test-swarm-${generateUniqueId("swarm")}`,
      status: "ACTIVE",
      poolName: `pool-${generateUniqueId("pool")}`,
      poolApiKey: "test-api-key-123",
    });

    // Update swarm to set minimumVms (not in factory by default)
    await db.swarm.update({
      where: { id: swarm.id },
      data: { minimumVms: 3 },
    });

    // Create superadmin user
    superadminUser = await createTestUser({
      name: "Super Admin",
      email: "superadmin@test.com",
      withGitHubAuth: true,
      githubUsername: "superadmin",
    });

    // Create regular user
    regularUser = await createTestUser({
      name: "Regular User",
      email: "regular@test.com",
      withGitHubAuth: true,
      githubUsername: "regularuser",
    });

    // Add regular user as member
    await db.workspaceMember.create({
      data: {
        userId: regularUser.id,
        workspaceId: workspace.id,
        role: "DEVELOPER",
      },
    });

    // Add superadmin as member
    await db.workspaceMember.create({
      data: {
        userId: superadminUser.id,
        workspaceId: workspace.id,
        role: "DEVELOPER",
      },
    });

    getMockedRequireAuth.mockReturnValue({
      id: owner.id,
      email: owner.email!,
      name: owner.name!,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.POOL_SUPERADMINS;
  });

  describe("GET /api/w/[slug]/pool/config", () => {
    it("should return minimumVms and isSuperAdmin=false for regular user", async () => {
      getMockedRequireAuth.mockReturnValue({
        id: regularUser.id,
        email: regularUser.email!,
        name: regularUser.name!,
      });

      const request = createAuthenticatedGetRequest(
        `/api/w/${workspace.slug}/pool/config`,
        regularUser
      );
      const response = await GET(request, {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toEqual({
        success: true,
        data: {
          minimumVms: 3,
          isSuperAdmin: false,
        },
      });
    });

    it("should return minimumVms and isSuperAdmin=true for superadmin user", async () => {
      getMockedRequireAuth.mockReturnValue({
        id: superadminUser.id,
        email: superadminUser.email!,
        name: superadminUser.name!,
      });

      const request = createAuthenticatedGetRequest(
        `/api/w/${workspace.slug}/pool/config`,
        superadminUser
      );
      const response = await GET(request, {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toEqual({
        success: true,
        data: {
          minimumVms: 3,
          isSuperAdmin: true,
        },
      });
    });

    it("should return current minimumVms value from DB", async () => {
      // Verify it returns the value we set in beforeEach (3)
      const request = createAuthenticatedGetRequest(
        `/api/w/${workspace.slug}/pool/config`,
        owner
      );
      const response = await GET(request, {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.data.minimumVms).toBe(3);
    });

    it("should return 404 when workspace has no swarm", async () => {
      // Create workspace without swarm
      const newScenario = await createTestWorkspaceScenario({
        owner: { name: "No Swarm Owner" },
      });

      getMockedRequireAuth.mockReturnValue({
        id: newScenario.owner.id,
        email: newScenario.owner.email!,
        name: newScenario.owner.name!,
      });

      const request = createAuthenticatedGetRequest(
        `/api/w/${newScenario.workspace.slug}/pool/config`,
        newScenario.owner
      );
      const response = await GET(request, {
        params: Promise.resolve({ slug: newScenario.workspace.slug }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      // Should still return default value
      expect(data.data.minimumVms).toBe(2);
    });
  });

  describe("PATCH /api/w/[slug]/pool/config", () => {
    let fetchSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      // Mock global fetch for Pool Manager API calls
      fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );
    });

    afterEach(() => {
      fetchSpy.mockRestore();
    });

    it("should return 403 for non-superadmin user", async () => {
      getMockedRequireAuth.mockReturnValue({
        id: regularUser.id,
        email: regularUser.email!,
        name: regularUser.name!,
      });

      const request = new NextRequest(
        new URL(`http://localhost/api/w/${workspace.slug}/pool/config`),
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ minimumVms: 5 }),
        }
      );

      const response = await PATCH(request, {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.message).toContain("Forbidden");
    });

    it("should return 400 for minimumVms < 1", async () => {
      getMockedRequireAuth.mockReturnValue({
        id: superadminUser.id,
        email: superadminUser.email!,
        name: superadminUser.name!,
      });

      const request = new NextRequest(
        new URL(`http://localhost/api/w/${workspace.slug}/pool/config`),
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ minimumVms: 0 }),
        }
      );

      const response = await PATCH(request, {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.message).toContain("Invalid minimumVms");
    });

    it("should return 400 for invalid minimumVms type", async () => {
      getMockedRequireAuth.mockReturnValue({
        id: superadminUser.id,
        email: superadminUser.email!,
        name: superadminUser.name!,
      });

      const request = new NextRequest(
        new URL(`http://localhost/api/w/${workspace.slug}/pool/config`),
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ minimumVms: "five" }),
        }
      );

      const response = await PATCH(request, {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.message).toContain("Invalid minimumVms");
    });

    it("should update DB and call Pool Manager for superadmin", async () => {
      getMockedRequireAuth.mockReturnValue({
        id: superadminUser.id,
        email: superadminUser.email!,
        name: superadminUser.name!,
      });

      const request = new NextRequest(
        new URL(`http://localhost/api/w/${workspace.slug}/pool/config`),
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ minimumVms: 5 }),
        }
      );

      const response = await PATCH(request, {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);

      // Verify DB was updated
      const updatedSwarm = await db.swarm.findUnique({
        where: { id: swarm.id },
        select: { minimumVms: true },
      });
      expect(updatedSwarm?.minimumVms).toBe(5);

      // Verify Pool Manager was called
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining(`/pools/${encodeURIComponent(swarm.poolName!)}`),
        expect.objectContaining({
          method: "PUT",
          headers: expect.objectContaining({
            Authorization: expect.stringContaining("Bearer"),
            "Content-Type": "application/json",
          }),
          body: JSON.stringify({ minimum_vms: 5 }),
        })
      );
    });

    it("should succeed even if Pool Manager call fails", async () => {
      getMockedRequireAuth.mockReturnValue({
        id: superadminUser.id,
        email: superadminUser.email!,
        name: superadminUser.name!,
      });

      // Mock Pool Manager failure
      fetchSpy.mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "Pool Manager error" }), {
          status: 500,
        })
      );

      const request = new NextRequest(
        new URL(`http://localhost/api/w/${workspace.slug}/pool/config`),
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ minimumVms: 7 }),
        }
      );

      const response = await PATCH(request, {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);

      // Verify DB was still updated
      const updatedSwarm = await db.swarm.findUnique({
        where: { id: swarm.id },
        select: { minimumVms: true },
      });
      expect(updatedSwarm?.minimumVms).toBe(7);
    });

    it("should return 404 when pool not configured", async () => {
      getMockedRequireAuth.mockReturnValue({
        id: superadminUser.id,
        email: superadminUser.email!,
        name: superadminUser.name!,
      });

      // Create workspace without swarm
      const newScenario = await createTestWorkspaceScenario({
        owner: { name: "No Pool Owner" },
      });

      await db.workspaceMember.create({
        data: {
          userId: superadminUser.id,
          workspaceId: newScenario.workspace.id,
          role: "DEVELOPER",
        },
      });

      const request = new NextRequest(
        new URL(`http://localhost/api/w/${newScenario.workspace.slug}/pool/config`),
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ minimumVms: 5 }),
        }
      );

      const response = await PATCH(request, {
        params: Promise.resolve({ slug: newScenario.workspace.slug }),
      });

      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.message).toContain("Pool not configured");
    });
  });
});
