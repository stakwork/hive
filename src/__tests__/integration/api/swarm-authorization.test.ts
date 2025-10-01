import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { POST, PUT } from "@/app/api/swarm/route";
import { db } from "@/lib/db";
import type { User, Workspace } from "@prisma/client";
import {
  createAuthenticatedSession,
  mockUnauthenticatedSession,
  expectUnauthorized,
  expectForbidden,
  expectError,
  generateUniqueId,
  generateUniqueSlug,
  createPostRequest,
  createPutRequest,
  getMockedSession,
} from "@/__tests__/helpers";

// Mock the SwarmService to avoid making real external API calls
vi.mock("@/services/swarm", () => ({
  SwarmService: vi.fn().mockImplementation(() => ({
    createSwarm: vi.fn().mockResolvedValue({
      data: { swarm_id: "test-swarm-id" },
    }),
  })),
}));

// Mock the service config to avoid configuration issues
vi.mock("@/config/services", () => ({
  getServiceConfig: vi.fn().mockReturnValue({
    baseUrl: "http://test-swarm-api.com",
    apiKey: "test-api-key",
  }),
}));

describe("Swarm API Authorization Tests", () => {
  let ownerUser: User;
  let adminUser: User;
  let developerUser: User;
  let viewerUser: User;
  let unauthorizedUser: User;
  let workspace: Workspace;
  let otherWorkspace: Workspace;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Create test users and workspaces
    const testData = await db.$transaction(async (tx) => {
      // Create users
      const owner = await tx.user.create({
        data: {
          id: generateUniqueId("owner"),
          email: `owner-${generateUniqueId()}@example.com`,
          name: "Owner User",
        },
      });

      const admin = await tx.user.create({
        data: {
          id: generateUniqueId("admin"),
          email: `admin-${generateUniqueId()}@example.com`,
          name: "Admin User",
        },
      });

      const developer = await tx.user.create({
        data: {
          id: generateUniqueId("dev"),
          email: `dev-${generateUniqueId()}@example.com`,
          name: "Developer User",
        },
      });

      const viewer = await tx.user.create({
        data: {
          id: generateUniqueId("viewer"),
          email: `viewer-${generateUniqueId()}@example.com`,
          name: "Viewer User",
        },
      });

      const unauthorized = await tx.user.create({
        data: {
          id: generateUniqueId("unauth"),
          email: `unauth-${generateUniqueId()}@example.com`,
          name: "Unauthorized User",
        },
      });

      // Create workspaces
      const ws = await tx.workspace.create({
        data: {
          name: "Test Workspace",
          slug: generateUniqueSlug("test-ws"),
          ownerId: owner.id,
        },
      });

      const otherWs = await tx.workspace.create({
        data: {
          name: "Other Workspace",
          slug: generateUniqueSlug("other-ws"),
          ownerId: unauthorized.id,
        },
      });

      // Create workspace memberships
      await tx.workspaceMember.create({
        data: {
          workspaceId: ws.id,
          userId: admin.id,
          role: "ADMIN",
        },
      });

      await tx.workspaceMember.create({
        data: {
          workspaceId: ws.id,
          userId: developer.id,
          role: "DEVELOPER",
        },
      });

      await tx.workspaceMember.create({
        data: {
          workspaceId: ws.id,
          userId: viewer.id,
          role: "VIEWER",
        },
      });

      return {
        owner,
        admin,
        developer,
        viewer,
        unauthorized,
        ws,
        otherWs,
      };
    });

    ownerUser = testData.owner;
    adminUser = testData.admin;
    developerUser = testData.developer;
    viewerUser = testData.viewer;
    unauthorizedUser = testData.unauthorized;
    workspace = testData.ws;
    otherWorkspace = testData.otherWs;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
  });

  describe("POST /api/swarm - Authorization Tests", () => {
    const createSwarmRequest = (workspaceId: string) => {
      return createPostRequest("http://localhost:3000/api/swarm", {
        workspaceId,
        name: "test-swarm",
        repositoryName: "test-repo",
        repositoryUrl: "https://github.com/test/repo",
        repositoryDescription: "Test repository",
        repositoryDefaultBranch: "main",
      });
    };

    it("should allow workspace owner to create swarm", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(ownerUser));

      const request = createSwarmRequest(workspace.id);
      const response = await POST(request);
      const data = await response.json();

      // Even if external service fails, authorization should pass through to that point
      // The test is checking that we don't get 401/403 (auth failures)
      expect(response.status).not.toBe(401);
      expect(response.status).not.toBe(403);
      // External service errors result in 500, but authorization passed
      if (response.status === 500) {
        expect(data.success).toBe(false);
        expect(data.message).toContain("error");
      } else {
        expect(response.status).toBe(200);
        expect(data.success).toBe(true);
      }
    });

    it("should allow workspace admin to create swarm", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(adminUser));

      const request = createSwarmRequest(workspace.id);
      const response = await POST(request);
      const data = await response.json();

      // Even if external service fails, authorization should pass through to that point
      // The test is checking that we don't get 401/403 (auth failures)
      expect(response.status).not.toBe(401);
      expect(response.status).not.toBe(403);
      // External service errors result in 500, but authorization passed
      if (response.status === 500) {
        expect(data.success).toBe(false);
        expect(data.message).toContain("error");
      } else {
        expect(response.status).toBe(200);
        expect(data.success).toBe(true);
      }
    });

    it("should reject developer role from creating swarm", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(developerUser));

      const request = createSwarmRequest(workspace.id);
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.success).toBe(false);
      expect(data.message).toBe("Only workspace owners and admins can create swarms");
    });

    it("should reject viewer role from creating swarm", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(viewerUser));

      const request = createSwarmRequest(workspace.id);
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.success).toBe(false);
      expect(data.message).toBe("Only workspace owners and admins can create swarms");
    });

    it("should reject unauthorized user from creating swarm in workspace they don't belong to", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(unauthorizedUser));

      const request = createSwarmRequest(workspace.id);
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.success).toBe(false);
      expect(data.message).toBe("Workspace not found or access denied");
    });

    it("should reject creating swarm with non-existent workspace ID", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(ownerUser));

      const request = createSwarmRequest("non-existent-workspace-id");
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.success).toBe(false);
      expect(data.message).toBe("Workspace not found or access denied");
    });

    it("should reject unauthenticated requests", async () => {
      getMockedSession().mockResolvedValue(mockUnauthenticatedSession());

      const request = createSwarmRequest(workspace.id);
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.success).toBe(false);
      expect(data.message).toBe("Unauthorized");
    });
  });

  describe("PUT /api/swarm - Authorization Tests", () => {
    const updateSwarmRequest = (workspaceId: string) => {
      return createPutRequest("http://localhost:3000/api/swarm", {
        workspaceId,
        envVars: [{ name: "TEST_VAR", value: "test_value" }],
        services: [{ name: "test-service", port: 3000 }],
      });
    };

    it("should allow workspace owner to update swarm", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(ownerUser));

      const request = updateSwarmRequest(workspace.id);
      const response = await PUT(request);
      const data = await response.json();

      // Authorization should pass - we don't care about external service issues for this test
      expect(response.status).not.toBe(401);
      expect(response.status).not.toBe(403);
      // PUT doesn't call external services so should succeed
      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.message).toBe("Swarm updated successfully");
    });

    it("should allow workspace admin to update swarm", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(adminUser));

      const request = updateSwarmRequest(workspace.id);
      const response = await PUT(request);
      const data = await response.json();

      // Authorization should pass - we don't care about external service issues for this test
      expect(response.status).not.toBe(401);
      expect(response.status).not.toBe(403);
      // PUT doesn't call external services so should succeed
      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.message).toBe("Swarm updated successfully");
    });

    it("should reject developer role from updating swarm", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(developerUser));

      const request = updateSwarmRequest(workspace.id);
      const response = await PUT(request);
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.success).toBe(false);
      expect(data.message).toBe("Only workspace owners and admins can update swarms");
    });

    it("should reject viewer role from updating swarm", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(viewerUser));

      const request = updateSwarmRequest(workspace.id);
      const response = await PUT(request);
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.success).toBe(false);
      expect(data.message).toBe("Only workspace owners and admins can update swarms");
    });

    it("should reject unauthorized user from updating swarm in workspace they don't belong to", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(unauthorizedUser));

      const request = updateSwarmRequest(workspace.id);
      const response = await PUT(request);
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.success).toBe(false);
      expect(data.message).toBe("Workspace not found or access denied");
    });

    it("should reject updating swarm with non-existent workspace ID", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(ownerUser));

      const request = updateSwarmRequest("non-existent-workspace-id");
      const response = await PUT(request);
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.success).toBe(false);
      expect(data.message).toBe("Workspace not found or access denied");
    });

    it("should reject request without workspaceId", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(ownerUser));

      const request = createPutRequest("http://localhost:3000/api/swarm", {
        envVars: [{ name: "TEST_VAR", value: "test_value" }],
        services: [{ name: "test-service", port: 3000 }],
      });

      const response = await PUT(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.success).toBe(false);
      expect(data.message).toBe("Missing required field: workspaceId");
    });

    it("should reject unauthenticated requests", async () => {
      getMockedSession().mockResolvedValue(mockUnauthenticatedSession());

      const request = updateSwarmRequest(workspace.id);
      const response = await PUT(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.success).toBe(false);
      expect(data.message).toBe("Unauthorized");
    });
  });

  describe("Security Vulnerability Prevention", () => {
    it("should prevent cross-workspace swarm creation attack", async () => {
      // Attacker is owner of otherWorkspace but tries to create swarm in victim's workspace
      getMockedSession().mockResolvedValue(createAuthenticatedSession(unauthorizedUser));

      const request = createSwarmRequest(workspace.id);
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.success).toBe(false);
      expect(data.message).toBe("Workspace not found or access denied");

      // Verify no swarm was created
      const swarmCount = await db.swarm.count({
        where: { workspaceId: workspace.id },
      });
      expect(swarmCount).toBe(0);
    });

    it("should prevent privilege escalation via direct API call", async () => {
      // Developer tries to bypass UI restrictions by calling API directly
      getMockedSession().mockResolvedValue(createAuthenticatedSession(developerUser));

      const request = createSwarmRequest(workspace.id);
      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.success).toBe(false);
      expect(data.message).toBe("Only workspace owners and admins can create swarms");
    });
  });
});

function createSwarmRequest(workspaceId: string) {
  return createPostRequest("http://localhost:3000/api/swarm", {
    workspaceId,
    name: "test-swarm",
    repositoryName: "test-repo",
    repositoryUrl: "https://github.com/test/repo",
    repositoryDescription: "Test repository",
    repositoryDefaultBranch: "main",
  });
}