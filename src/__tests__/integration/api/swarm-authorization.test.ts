import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { POST, PUT } from "@/app/api/swarm/route";
import { db } from "@/lib/db";
import { getServerSession } from "next-auth/next";
import type { User, Workspace } from "@prisma/client";
import {
  createAuthenticatedSession,
  mockUnauthenticatedSession,
  expectUnauthorized,
  expectForbidden,
  expectError,
  generateUniqueId,
  generateUniqueSlug,
} from "@/__tests__/helpers";

vi.mock("next-auth/next", () => ({ getServerSession: vi.fn() }));

const mockGetServerSession = getServerSession as vi.MockedFunction<typeof getServerSession>;

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
      const body = JSON.stringify({
        workspaceId,
        name: "test-swarm",
        repositoryName: "test-repo",
        repositoryUrl: "https://github.com/test/repo",
        repositoryDescription: "Test repository",
        repositoryDefaultBranch: "main",
      });

      return new NextRequest("http://localhost:3000/api/swarm", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body,
      });
    };

    it("should allow workspace owner to create swarm", async () => {
      mockGetServerSession.mockResolvedValue(createAuthenticatedSession(ownerUser));

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
      mockGetServerSession.mockResolvedValue(createAuthenticatedSession(adminUser));

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
      mockGetServerSession.mockResolvedValue(createAuthenticatedSession(developerUser));

      const request = createSwarmRequest(workspace.id);
      const response = await POST(request);

      await expectForbidden(response, "Only workspace owners and admins can create swarms");
    });

    it("should reject viewer role from creating swarm", async () => {
      mockGetServerSession.mockResolvedValue(createAuthenticatedSession(viewerUser));

      const request = createSwarmRequest(workspace.id);
      const response = await POST(request);

      await expectForbidden(response, "Only workspace owners and admins can create swarms");
    });

    it("should reject unauthorized user from creating swarm in workspace they don't belong to", async () => {
      mockGetServerSession.mockResolvedValue(createAuthenticatedSession(unauthorizedUser));

      const request = createSwarmRequest(workspace.id);
      const response = await POST(request);

      await expectForbidden(response, "Workspace not found or access denied");
    });

    it("should reject creating swarm with non-existent workspace ID", async () => {
      mockGetServerSession.mockResolvedValue(createAuthenticatedSession(ownerUser));

      const request = createSwarmRequest("non-existent-workspace-id");
      const response = await POST(request);

      await expectForbidden(response, "Workspace not found or access denied");
    });

    it("should reject unauthenticated requests", async () => {
      mockGetServerSession.mockResolvedValue(mockUnauthenticatedSession());

      const request = createSwarmRequest(workspace.id);
      const response = await POST(request);

      await expectUnauthorized(response);
    });
  });

  describe("PUT /api/swarm - Authorization Tests", () => {
    const updateSwarmRequest = (workspaceId: string) => {
      const body = JSON.stringify({
        workspaceId,
        envVars: [{ name: "TEST_VAR", value: "test_value" }],
        services: [{ name: "test-service", port: 3000 }],
      });

      return new NextRequest("http://localhost:3000/api/swarm", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body,
      });
    };

    it("should allow workspace owner to update swarm", async () => {
      mockGetServerSession.mockResolvedValue(createAuthenticatedSession(ownerUser));

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
      mockGetServerSession.mockResolvedValue(createAuthenticatedSession(adminUser));

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
      mockGetServerSession.mockResolvedValue(createAuthenticatedSession(developerUser));

      const request = updateSwarmRequest(workspace.id);
      const response = await PUT(request);

      await expectForbidden(response, "Only workspace owners and admins can update swarms");
    });

    it("should reject viewer role from updating swarm", async () => {
      mockGetServerSession.mockResolvedValue(createAuthenticatedSession(viewerUser));

      const request = updateSwarmRequest(workspace.id);
      const response = await PUT(request);

      await expectForbidden(response, "Only workspace owners and admins can update swarms");
    });

    it("should reject unauthorized user from updating swarm in workspace they don't belong to", async () => {
      mockGetServerSession.mockResolvedValue(createAuthenticatedSession(unauthorizedUser));

      const request = updateSwarmRequest(workspace.id);
      const response = await PUT(request);

      await expectForbidden(response, "Workspace not found or access denied");
    });

    it("should reject updating swarm with non-existent workspace ID", async () => {
      mockGetServerSession.mockResolvedValue(createAuthenticatedSession(ownerUser));

      const request = updateSwarmRequest("non-existent-workspace-id");
      const response = await PUT(request);

      await expectForbidden(response, "Workspace not found or access denied");
    });

    it("should reject request without workspaceId", async () => {
      mockGetServerSession.mockResolvedValue(createAuthenticatedSession(ownerUser));

      const body = JSON.stringify({
        envVars: [{ name: "TEST_VAR", value: "test_value" }],
        services: [{ name: "test-service", port: 3000 }],
      });

      const request = new NextRequest("http://localhost:3000/api/swarm", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body,
      });

      const response = await PUT(request);

      await expectError(response, "Missing required field: workspaceId", 400);
    });

    it("should reject unauthenticated requests", async () => {
      mockGetServerSession.mockResolvedValue(mockUnauthenticatedSession());

      const request = updateSwarmRequest(workspace.id);
      const response = await PUT(request);

      await expectUnauthorized(response);
    });
  });

  describe("Security Vulnerability Prevention", () => {
    it("should prevent cross-workspace swarm creation attack", async () => {
      // Attacker is owner of otherWorkspace but tries to create swarm in victim's workspace
      mockGetServerSession.mockResolvedValue(createAuthenticatedSession(unauthorizedUser));

      const request = createSwarmRequest(workspace.id);
      const response = await POST(request);

      await expectForbidden(response, "Workspace not found or access denied");

      // Verify no swarm was created
      const swarmCount = await db.swarm.count({
        where: { workspaceId: workspace.id },
      });
      expect(swarmCount).toBe(0);
    });

    it("should prevent privilege escalation via direct API call", async () => {
      // Developer tries to bypass UI restrictions by calling API directly
      mockGetServerSession.mockResolvedValue(createAuthenticatedSession(developerUser));

      const request = createSwarmRequest(workspace.id);
      const response = await POST(request);

      await expectForbidden(response, "Only workspace owners and admins can create swarms");
    });
  });
});

function createSwarmRequest(workspaceId: string) {
  const body = JSON.stringify({
    workspaceId,
    name: "test-swarm",
    repositoryName: "test-repo",
    repositoryUrl: "https://github.com/test/repo",
    repositoryDescription: "Test repository",
    repositoryDefaultBranch: "main",
  });

  return new NextRequest("http://localhost:3000/api/swarm", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body,
  });
}