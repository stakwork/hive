import { describe, test, expect, beforeEach, vi, afterEach } from "vitest";
import { createTestUser } from "@/__tests__/support/fixtures/user";
import { createTestWorkspace } from "@/__tests__/support/fixtures/workspace";
import { createDeleteRequest, createAuthenticatedDeleteRequest } from "@/__tests__/support/helpers/request-builders";
import { db } from "@/lib/db";
import { WorkspaceRole } from "@prisma/client";

// Mock the pool manager service
vi.mock("@/lib/service-factory", () => ({
  poolManagerService: vi.fn(() => ({
    deletePool: vi.fn(),
  })),
}));

import { poolManagerService } from "@/lib/service-factory";
import { DELETE } from "@/app/api/pool-manager/delete-pool/route";

describe("DELETE /api/pool-manager/delete-pool - Authorization", () => {
  let testUser: Awaited<ReturnType<typeof createTestUser>>;
  let otherUser: Awaited<ReturnType<typeof createTestUser>>;
  let workspace: Awaited<ReturnType<typeof createTestWorkspace>>;
  let swarm: Awaited<ReturnType<typeof db.swarm.create>>;
  let mockDeletePool: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    // Reset mocks
    vi.clearAllMocks();

    // Create test users
    testUser = await createTestUser({
      email: "test@example.com",
      name: "Test User",
    });

    otherUser = await createTestUser({
      email: "other@example.com",
      name: "Other User",
    });

    // Create test workspace with owner
    workspace = await createTestWorkspace({
      name: "Test Workspace",
      slug: "test-workspace",
      ownerId: testUser.id,
    });

    // Create test swarm with pool
    swarm = await db.swarm.create({
      data: {
        name: `${workspace.slug}.sphinx.chat`,
        workspaceId: workspace.id,
        poolName: `pool-${workspace.id}`,
        status: "ACTIVE",
      },
    });

    // Setup mock pool manager service
    mockDeletePool = vi.fn().mockResolvedValue({
      id: swarm.poolName,
      name: swarm.poolName,
      status: "deleted",
    });

    vi.mocked(poolManagerService).mockReturnValue({
      deletePool: mockDeletePool,
    } as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Authentication", () => {
    test("returns 401 when user is not authenticated", async () => {
      const request = createDeleteRequest(
        "/api/pool-manager/delete-pool",
        { name: swarm.poolName }
      );

      const response = await DELETE(request);

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.error).toBe("Unauthorized");
      expect(mockDeletePool).not.toHaveBeenCalled();
    });
  });

  describe("Input Validation", () => {
    test("returns 400 when pool name is missing", async () => {
      const request = createAuthenticatedDeleteRequest(
        "/api/pool-manager/delete-pool",
        testUser,
        {} // missing name
      );

      const response = await DELETE(request);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBe("Missing required field: name");
      expect(mockDeletePool).not.toHaveBeenCalled();
    });
  });

  describe("Workspace Access Control", () => {
    test("returns 404 when pool does not exist", async () => {
      const request = createAuthenticatedDeleteRequest(
        "/api/pool-manager/delete-pool",
        testUser,
        { name: "non-existent-pool" }
      );

      const response = await DELETE(request);

      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.error).toBe("Pool not found or not associated with any workspace");
      expect(mockDeletePool).not.toHaveBeenCalled();
    });

    test("returns 403 when user is not a workspace member", async () => {
      const request = createAuthenticatedDeleteRequest(
        "/api/pool-manager/delete-pool",
        otherUser,
        { name: swarm.poolName }
      );

      const response = await DELETE(request);

      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data.error).toBe("Access denied: You must be a workspace member to delete this pool");
      expect(mockDeletePool).not.toHaveBeenCalled();
    });
  });

  describe("Role-Based Access Control", () => {
    test("returns 403 when member has VIEWER role", async () => {
      // Add other user as VIEWER
      await db.workspaceMember.create({
        data: {
          workspaceId: workspace.id,
          userId: otherUser.id,
          role: WorkspaceRole.VIEWER,
        },
      });

      const request = createAuthenticatedDeleteRequest(
        "/api/pool-manager/delete-pool",
        otherUser,
        { name: swarm.poolName }
      );

      const response = await DELETE(request);

      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data.error).toBe("Access denied: Only workspace owners and admins can delete pools");
      expect(mockDeletePool).not.toHaveBeenCalled();
    });

    test("returns 403 when member has DEVELOPER role", async () => {
      // Add other user as DEVELOPER
      await db.workspaceMember.create({
        data: {
          workspaceId: workspace.id,
          userId: otherUser.id,
          role: WorkspaceRole.DEVELOPER,
        },
      });

      const request = createAuthenticatedDeleteRequest(
        "/api/pool-manager/delete-pool",
        otherUser,
        { name: swarm.poolName }
      );

      const response = await DELETE(request);

      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data.error).toBe("Access denied: Only workspace owners and admins can delete pools");
      expect(mockDeletePool).not.toHaveBeenCalled();
    });

    test("returns 403 when member has PM role", async () => {
      // Add other user as PM
      await db.workspaceMember.create({
        data: {
          workspaceId: workspace.id,
          userId: otherUser.id,
          role: WorkspaceRole.PM,
        },
      });

      const request = createAuthenticatedDeleteRequest(
        "/api/pool-manager/delete-pool",
        otherUser,
        { name: swarm.poolName }
      );

      const response = await DELETE(request);

      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data.error).toBe("Access denied: Only workspace owners and admins can delete pools");
      expect(mockDeletePool).not.toHaveBeenCalled();
    });

    test("returns 403 when member has STAKEHOLDER role", async () => {
      // Add other user as STAKEHOLDER
      await db.workspaceMember.create({
        data: {
          workspaceId: workspace.id,
          userId: otherUser.id,
          role: WorkspaceRole.STAKEHOLDER,
        },
      });

      const request = createAuthenticatedDeleteRequest(
        "/api/pool-manager/delete-pool",
        otherUser,
        { name: swarm.poolName }
      );

      const response = await DELETE(request);

      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data.error).toBe("Access denied: Only workspace owners and admins can delete pools");
      expect(mockDeletePool).not.toHaveBeenCalled();
    });

    test("returns 200 when member has ADMIN role", async () => {
      // Add other user as ADMIN
      await db.workspaceMember.create({
        data: {
          workspaceId: workspace.id,
          userId: otherUser.id,
          role: WorkspaceRole.ADMIN,
        },
      });

      const request = createAuthenticatedDeleteRequest(
        "/api/pool-manager/delete-pool",
        otherUser,
        { name: swarm.poolName }
      );

      const response = await DELETE(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.pool).toBeDefined();
      expect(data.message).toContain("successfully deleted");
      expect(mockDeletePool).toHaveBeenCalledWith({ name: swarm.poolName });
    });

    test("returns 200 when user is workspace owner", async () => {
      const request = createAuthenticatedDeleteRequest(
        "/api/pool-manager/delete-pool",
        testUser,
        { name: swarm.poolName }
      );

      const response = await DELETE(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.pool).toBeDefined();
      expect(data.message).toContain("successfully deleted");
      expect(data.message).toContain(workspace.name);
      expect(mockDeletePool).toHaveBeenCalledWith({ name: swarm.poolName });
    });
  });

  describe("External API Error Handling", () => {
    test("returns structured error when Pool Manager API fails", async () => {
      // Mock Pool Manager service error
      const apiError = {
        message: "Pool Manager service unavailable",
        service: "poolManager",
        details: "Connection timeout",
        status: 503,
      };

      mockDeletePool.mockRejectedValue(apiError);

      const request = createAuthenticatedDeleteRequest(
        "/api/pool-manager/delete-pool",
        testUser,
        { name: swarm.poolName }
      );

      const response = await DELETE(request);

      expect(response.status).toBe(503);
      const data = await response.json();
      expect(data.error).toBe("Pool Manager service unavailable");
      expect(data.service).toBe("poolManager");
      expect(data.details).toBe("Connection timeout");
    });

    test("returns 500 for unexpected errors", async () => {
      // Mock unexpected error
      mockDeletePool.mockRejectedValue(new Error("Unexpected database error"));

      const request = createAuthenticatedDeleteRequest(
        "/api/pool-manager/delete-pool",
        testUser,
        { name: swarm.poolName }
      );

      const response = await DELETE(request);

      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.error).toBe("Failed to delete pool");
    });
  });

  describe("Success Scenarios", () => {
    test("successfully deletes pool with proper workspace context", async () => {
      const request = createAuthenticatedDeleteRequest(
        "/api/pool-manager/delete-pool",
        testUser,
        { name: swarm.poolName }
      );

      const response = await DELETE(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      
      // Verify response structure
      expect(data.pool).toBeDefined();
      expect(data.pool.id).toBe(swarm.poolName);
      expect(data.pool.status).toBe("deleted");
      expect(data.message).toContain(swarm.poolName);
      expect(data.message).toContain(workspace.name);

      // Verify Pool Manager service was called correctly
      expect(mockDeletePool).toHaveBeenCalledTimes(1);
      expect(mockDeletePool).toHaveBeenCalledWith({ name: swarm.poolName });
    });
  });
});
