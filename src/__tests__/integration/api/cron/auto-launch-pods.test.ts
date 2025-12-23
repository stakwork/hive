import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { GET } from "@/app/api/cron/auto-launch-pods/route";
import { db } from "@/lib/db";
import { resetDatabase } from "@/__tests__/support/fixtures";
import { PoolState } from "@prisma/client";
import { NextRequest } from "next/server";

/**
 * Integration tests for GET /api/cron/auto-launch-pods endpoint
 * 
 * Tests verify:
 * - Authentication via CRON_SECRET
 * - Feature flag gating (AUTO_LAUNCH_PODS_ENABLED)
 * - Response structure validation
 * - Database query integration
 * 
 * Note: Pool creation logic is tested separately in Phase 2
 * This phase focuses on configuration and feature flag behavior
 * 
 * Test Database: Real PostgreSQL with sequential execution
 * Cleanup: resetDatabase() in beforeEach for test isolation
 */

// Helper function to create mock NextRequest with authorization header
function createMockRequest(authHeader?: string): NextRequest {
  const headers = new Headers();
  if (authHeader) {
    headers.set("authorization", authHeader);
  }
  return new NextRequest("http://localhost:3000/api/cron/auto-launch-pods", {
    headers,
  });
}

// Helper to create authenticated request for tests
function createAuthenticatedRequest(): NextRequest {
  return createMockRequest("Bearer test-secret-123");
}

describe("GET /api/cron/auto-launch-pods", () => {
  let originalFeatureFlagValue: string | undefined;
  let originalCronSecret: string | undefined;

  beforeEach(async () => {
    // Store original env values
    originalFeatureFlagValue = process.env.AUTO_LAUNCH_PODS_ENABLED;
    originalCronSecret = process.env.CRON_SECRET;

    // Set default CRON_SECRET for tests
    process.env.CRON_SECRET = "test-secret-123";

    // Clear all mocks
    vi.clearAllMocks();

    // Reset database for test isolation
    await resetDatabase();
  });

  afterEach(() => {
    // Restore original env values
    if (originalFeatureFlagValue !== undefined) {
      process.env.AUTO_LAUNCH_PODS_ENABLED = originalFeatureFlagValue;
    } else {
      delete process.env.AUTO_LAUNCH_PODS_ENABLED;
    }

    if (originalCronSecret !== undefined) {
      process.env.CRON_SECRET = originalCronSecret;
    } else {
      delete process.env.CRON_SECRET;
    }
  });

  describe("Authentication", () => {
    it("should return 401 when no authorization header is provided", async () => {
      // Execute with no auth header
      const request = createMockRequest();
      const response = await GET(request);
      const data = await response.json();

      // Assert
      expect(response.status).toBe(401);
      expect(data.error).toBe("Unauthorized");
    });

    it("should return 401 when authorization header is invalid", async () => {
      // Execute with invalid auth header
      const request = createMockRequest("Bearer invalid-secret");
      const response = await GET(request);
      const data = await response.json();

      // Assert
      expect(response.status).toBe(401);
      expect(data.error).toBe("Unauthorized");
    });

    it("should accept request with valid CRON_SECRET", async () => {
      // Disable feature flag to get quick response
      process.env.AUTO_LAUNCH_PODS_ENABLED = "false";

      // Execute with valid auth header
      const request = createAuthenticatedRequest();
      const response = await GET(request);

      // Assert
      expect(response.status).toBe(200);
    });
  });

  describe("Feature Flag", () => {
    it("should return success with 0 processed when feature flag is disabled", async () => {
      // Set feature flag to disabled
      process.env.AUTO_LAUNCH_PODS_ENABLED = "false";

      // Execute
      const request = createAuthenticatedRequest();
      const response = await GET(request);
      const data = await response.json();

      // Assert
      expect(response.status).toBe(200);
      expect(data).toEqual({
        success: true,
        message: "Auto-launch pods cron is disabled",
        workspacesProcessed: 0,
        launchesTriggered: 0,
      });
    });

    it("should return success with 0 processed when feature flag is undefined", async () => {
      // Ensure feature flag is undefined
      delete process.env.AUTO_LAUNCH_PODS_ENABLED;

      // Execute
      const request = createAuthenticatedRequest();
      const response = await GET(request);
      const data = await response.json();

      // Assert
      expect(response.status).toBe(200);
      expect(data).toEqual({
        success: true,
        message: "Auto-launch pods cron is disabled",
        workspacesProcessed: 0,
        launchesTriggered: 0,
      });
    });

    it("should execute service when feature flag is enabled with no eligible workspaces", async () => {
      // Enable feature flag
      process.env.AUTO_LAUNCH_PODS_ENABLED = "true";

      // Execute (database is empty from resetDatabase)
      const request = createAuthenticatedRequest();
      const response = await GET(request);
      const data = await response.json();

      // Assert
      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.workspacesProcessed).toBe(0);
      expect(data.launchesTriggered).toBe(0);
      expect(data.errors).toEqual([]);
      expect(data.timestamp).toBeDefined();
    });

    it("should process eligible workspaces when feature flag is enabled", async () => {
      // Enable feature flag
      process.env.AUTO_LAUNCH_PODS_ENABLED = "true";

      // Create test data: workspace with eligible swarm
      const user = await db.user.create({
        data: {
          email: "test@example.com",
          name: "Test User",
        },
      });

      const workspace = await db.workspace.create({
        data: {
          name: "Test Workspace",
          slug: "test-workspace",
          ownerId: user.id,
        },
      });

      await db.swarm.create({
        data: {
          name: "test-swarm",
          workspaceId: workspace.id,
          containerFilesSetUp: true,
          poolState: PoolState.NOT_STARTED,
          services: [{ name: "frontend", port: 3000 }],
        },
      });

      // Execute
      const request = createAuthenticatedRequest();
      const response = await GET(request);
      const data = await response.json();

      // Assert
      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.workspacesProcessed).toBe(1);
      expect(data.launchesTriggered).toBe(1);
      expect(data.errors).toEqual([]);
      expect(data.timestamp).toBeDefined();
    });
  });

  describe("Database Integration", () => {
    it("should skip workspaces with poolState other than NOT_STARTED", async () => {
      // Enable feature flag
      process.env.AUTO_LAUNCH_PODS_ENABLED = "true";

      // Create test data: workspace with non-eligible swarm (STARTED state)
      const user = await db.user.create({
        data: {
          email: "test@example.com",
          name: "Test User",
        },
      });

      const workspace = await db.workspace.create({
        data: {
          name: "Test Workspace",
          slug: "test-workspace",
          ownerId: user.id,
        },
      });

      await db.swarm.create({
        data: {
          name: "test-swarm",
          workspaceId: workspace.id,
          containerFilesSetUp: true,
          poolState: PoolState.STARTED, // Not NOT_STARTED
          services: [{ name: "frontend", port: 3000 }],
        },
      });

      // Execute
      const request = createAuthenticatedRequest();
      const response = await GET(request);
      const data = await response.json();

      // Assert - should process 0 workspaces
      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.workspacesProcessed).toBe(0);
      expect(data.launchesTriggered).toBe(0);
    });

    it("should skip workspaces with containerFilesSetUp=false", async () => {
      // Enable feature flag
      process.env.AUTO_LAUNCH_PODS_ENABLED = "true";

      // Create test data: workspace with non-eligible swarm (containerFilesSetUp=false)
      const user = await db.user.create({
        data: {
          email: "test@example.com",
          name: "Test User",
        },
      });

      const workspace = await db.workspace.create({
        data: {
          name: "Test Workspace",
          slug: "test-workspace",
          ownerId: user.id,
        },
      });

      await db.swarm.create({
        data: {
          name: "test-swarm",
          workspaceId: workspace.id,
          containerFilesSetUp: false, // Not true
          poolState: PoolState.NOT_STARTED,
          services: [{ name: "frontend", port: 3000 }],
        },
      });

      // Execute
      const request = createAuthenticatedRequest();
      const response = await GET(request);
      const data = await response.json();

      // Assert - should process 0 workspaces
      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.workspacesProcessed).toBe(0);
      expect(data.launchesTriggered).toBe(0);
    });

    it("should skip workspaces with empty services array", async () => {
      // Enable feature flag
      process.env.AUTO_LAUNCH_PODS_ENABLED = "true";

      // Create test data: workspace with non-eligible swarm (empty services)
      const user = await db.user.create({
        data: {
          email: "test@example.com",
          name: "Test User",
        },
      });

      const workspace = await db.workspace.create({
        data: {
          name: "Test Workspace",
          slug: "test-workspace",
          ownerId: user.id,
        },
      });

      await db.swarm.create({
        data: {
          name: "test-swarm",
          workspaceId: workspace.id,
          containerFilesSetUp: true,
          poolState: PoolState.NOT_STARTED,
          services: [], // Empty array
        },
      });

      // Execute
      const request = createAuthenticatedRequest();
      const response = await GET(request);
      const data = await response.json();

      // Assert - should process 0 workspaces
      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.workspacesProcessed).toBe(0);
      expect(data.launchesTriggered).toBe(0);
    });

    it("should process multiple eligible workspaces", async () => {
      // Enable feature flag
      process.env.AUTO_LAUNCH_PODS_ENABLED = "true";

      // Create test data: multiple workspaces with eligible swarms
      const user = await db.user.create({
        data: {
          email: "test@example.com",
          name: "Test User",
        },
      });

      const workspace1 = await db.workspace.create({
        data: {
          name: "Test Workspace 1",
          slug: "test-workspace-1",
          ownerId: user.id,
        },
      });

      await db.swarm.create({
        data: {
          name: "test-swarm-1",
          workspaceId: workspace1.id,
          containerFilesSetUp: true,
          poolState: PoolState.NOT_STARTED,
          services: [{ name: "frontend", port: 3000 }],
        },
      });

      const workspace2 = await db.workspace.create({
        data: {
          name: "Test Workspace 2",
          slug: "test-workspace-2",
          ownerId: user.id,
        },
      });

      await db.swarm.create({
        data: {
          name: "test-swarm-2",
          workspaceId: workspace2.id,
          containerFilesSetUp: true,
          poolState: PoolState.NOT_STARTED,
          services: [{ name: "backend", port: 4000 }],
        },
      });

      // Execute
      const request = createAuthenticatedRequest();
      const response = await GET(request);
      const data = await response.json();

      // Assert
      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.workspacesProcessed).toBe(2);
      expect(data.launchesTriggered).toBe(2);
      expect(data.errors).toEqual([]);
    });
  });

  describe("Error Handling", () => {
    it("should return response structure on success", async () => {
      // Enable feature flag
      process.env.AUTO_LAUNCH_PODS_ENABLED = "true";

      // Execute
      const request = createAuthenticatedRequest();
      const response = await GET(request);
      const data = await response.json();

      // Assert response structure
      expect(data).toHaveProperty("success");
      expect(data).toHaveProperty("workspacesProcessed");
      expect(data).toHaveProperty("launchesTriggered");
      expect(data).toHaveProperty("errors");
      expect(data).toHaveProperty("timestamp");
      expect(Array.isArray(data.errors)).toBe(true);
    });
  });
});
