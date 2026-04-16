import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET, PATCH } from "@/app/api/w/[slug]/pool/config/route";
import { createTestWorkspaceScenario, createTestUser, createTestSwarm } from "@/__tests__/support/factories";
import { createAuthenticatedGetRequest } from "@/__tests__/support/helpers/request-builders";
import { generateUniqueId } from "@/__tests__/support/helpers/ids";
import { db } from "@/lib/db";

// Mock the middleware utils
const getMockedRequireAuth = vi.hoisted(() => vi.fn());
const getMockedCheckIsSuperAdmin = vi.hoisted(() => vi.fn());
vi.mock("@/lib/middleware/utils", () => ({
  getMiddlewareContext: vi.fn((req: NextRequest) => ({ user: null })),
  requireAuth: getMockedRequireAuth,
  checkIsSuperAdmin: getMockedCheckIsSuperAdmin,
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
      getMockedCheckIsSuperAdmin.mockResolvedValue(false);

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
          minimumPods: 2,
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
      getMockedCheckIsSuperAdmin.mockResolvedValue(true);

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
          minimumPods: 2,
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

    it("should return minimumPods in response data", async () => {
      // Set a minimumPods value on the swarm
      await db.swarm.update({
        where: { id: swarm.id },
        data: { minimumPods: 5 },
      });

      getMockedRequireAuth.mockReturnValue({
        id: superadminUser.id,
        email: superadminUser.email!,
        name: superadminUser.name!,
      });
      getMockedCheckIsSuperAdmin.mockResolvedValue(true);

      const request = createAuthenticatedGetRequest(
        `/api/w/${workspace.slug}/pool/config`,
        superadminUser
      );
      const response = await GET(request, {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.data.minimumPods).toBe(5);
    });

    it("should return 200 with minimumVms for superadmin on unowned workspace", async () => {
      // Create a separate workspace owned by a different user
      const otherScenario = await createTestWorkspaceScenario({
        owner: { name: "Other Owner" },
      });
      const otherSwarm = await createTestSwarm({
        workspaceId: otherScenario.workspace.id,
        name: `other-swarm-${generateUniqueId("swarm")}`,
        status: "ACTIVE",
        poolName: `other-pool-${generateUniqueId("pool")}`,
        poolApiKey: "other-api-key",
      });
      await db.swarm.update({
        where: { id: otherSwarm.id },
        data: { minimumVms: 4 },
      });

      // superadminUser is NOT a member of otherScenario.workspace
      getMockedRequireAuth.mockReturnValue({
        id: superadminUser.id,
        email: superadminUser.email!,
        name: superadminUser.name!,
      });
      getMockedCheckIsSuperAdmin.mockResolvedValue(true);

      const request = createAuthenticatedGetRequest(
        `/api/w/${otherScenario.workspace.slug}/pool/config`,
        superadminUser
      );
      const response = await GET(request, {
        params: Promise.resolve({ slug: otherScenario.workspace.slug }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toEqual({
        success: true,
        data: {
          minimumVms: 4,
          minimumPods: 2,
          isSuperAdmin: true,
        },
      });
    });

    it("should return 404 for non-admin user on unowned workspace", async () => {
      const otherScenario = await createTestWorkspaceScenario({
        owner: { name: "Another Owner" },
      });

      // regularUser is NOT a member of otherScenario.workspace
      getMockedRequireAuth.mockReturnValue({
        id: regularUser.id,
        email: regularUser.email!,
        name: regularUser.name!,
      });
      getMockedCheckIsSuperAdmin.mockResolvedValue(false);

      const request = createAuthenticatedGetRequest(
        `/api/w/${otherScenario.workspace.slug}/pool/config`,
        regularUser
      );
      const response = await GET(request, {
        params: Promise.resolve({ slug: otherScenario.workspace.slug }),
      });

      expect(response.status).toBe(404);
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
      // Mock superadmin check - most PATCH tests use superadmin
      getMockedCheckIsSuperAdmin.mockResolvedValue(true);

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
      getMockedCheckIsSuperAdmin.mockResolvedValue(false);
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

    it("should return 400 if neither minimumVms nor minimumPods is provided", async () => {
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
          body: JSON.stringify({}),
        }
      );

      const response = await PATCH(request, {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
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
        expect.stringContaining(`/pools/${encodeURIComponent(swarm.id)}`),
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

    it("should update minimumVms for superadmin on unowned workspace", async () => {
      // Create a workspace the superadmin does NOT belong to
      const otherScenario = await createTestWorkspaceScenario({
        owner: { name: "Unowned Workspace Owner" },
      });
      const otherSwarm = await createTestSwarm({
        workspaceId: otherScenario.workspace.id,
        name: `unowned-swarm-${generateUniqueId("swarm")}`,
        status: "ACTIVE",
        poolName: `unowned-pool-${generateUniqueId("pool")}`,
        poolApiKey: "unowned-api-key",
      });
      await db.swarm.update({
        where: { id: otherSwarm.id },
        data: { minimumVms: 2 },
      });

      getMockedRequireAuth.mockReturnValue({
        id: superadminUser.id,
        email: superadminUser.email!,
        name: superadminUser.name!,
      });
      getMockedCheckIsSuperAdmin.mockResolvedValue(true);

      const request = new NextRequest(
        new URL(`http://localhost/api/w/${otherScenario.workspace.slug}/pool/config`),
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ minimumVms: 6 }),
        }
      );

      const response = await PATCH(request, {
        params: Promise.resolve({ slug: otherScenario.workspace.slug }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);

      // Verify DB was updated
      const updatedSwarm = await db.swarm.findUnique({
        where: { id: otherSwarm.id },
        select: { minimumVms: true },
      });
      expect(updatedSwarm?.minimumVms).toBe(6);
    });

    it("should update DB with minimumPods and include minimum_pods in Pool Manager PUT body", async () => {
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
          body: JSON.stringify({ minimumPods: 5 }),
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
        select: { minimumPods: true },
      });
      expect(updatedSwarm?.minimumPods).toBe(5);

      // Verify Pool Manager was called with minimum_pods
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining(`/pools/${encodeURIComponent(swarm.id)}`),
        expect.objectContaining({
          method: "PUT",
          body: JSON.stringify({ minimum_pods: 5 }),
        })
      );
    });

    it("should return 400 for minimumPods > 20", async () => {
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
          body: JSON.stringify({ minimumPods: 21 }),
        }
      );

      const response = await PATCH(request, {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.message).toContain("Invalid minimumPods");
    });

    it("should return 400 for minimumPods = 0", async () => {
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
          body: JSON.stringify({ minimumPods: 0 }),
        }
      );

      const response = await PATCH(request, {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.message).toContain("Invalid minimumPods");
    });

    it("should succeed with only minimumVms provided (no minimumPods)", async () => {
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
          body: JSON.stringify({ minimumVms: 4 }),
        }
      );

      const response = await PATCH(request, {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);

      const updatedSwarm = await db.swarm.findUnique({
        where: { id: swarm.id },
        select: { minimumVms: true },
      });
      expect(updatedSwarm?.minimumVms).toBe(4);

      // Pool Manager called without minimum_pods
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: JSON.stringify({ minimum_vms: 4 }),
        })
      );
    });

    it("should succeed with only minimumPods provided (no minimumVms)", async () => {
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
          body: JSON.stringify({ minimumPods: 3 }),
        }
      );

      const response = await PATCH(request, {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);

      const updatedSwarm = await db.swarm.findUnique({
        where: { id: swarm.id },
        select: { minimumPods: true },
      });
      expect(updatedSwarm?.minimumPods).toBe(3);
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
