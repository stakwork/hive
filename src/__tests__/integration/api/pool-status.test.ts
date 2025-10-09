import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GET } from "@/app/api/w/[slug]/pool/status/route";
import { db } from "@/lib/db";
import type { User, Workspace, Swarm } from "@prisma/client";
import {
  createAuthenticatedSession,
  mockUnauthenticatedSession,
  getMockedSession,
} from "@/__tests__/support/helpers/auth";
import { createTestWorkspaceScenario } from "@/__tests__/support/fixtures/workspace";
import { EncryptionService } from "@/lib/encryption";
import type { PoolStatusResponse } from "@/types/pool-manager";

// Mock the service factory to avoid real API calls and provide controlled service instances
vi.mock("@/config/services", () => ({
  getServiceConfig: vi.fn(),
}));

vi.mock("@/services/pool-manager", () => ({
  PoolManagerService: vi.fn(),
}));

// Import mocked service for type-safe assertions
import { PoolManagerService } from "@/services/pool-manager";
import { getServiceConfig } from "@/config/services";

describe("GET /api/w/[slug]/pool/status - Integration Tests", () => {
  let ownerUser: User;
  let adminUser: User;
  let unauthorizedUser: User;
  let workspace: Workspace;
  let swarm: Swarm;

  // Helper function to create and setup mock PoolManagerService instance
  const createMockPoolManagerService = (mockResponse?: PoolStatusResponse, shouldReject = false, errorMessage?: string) => {
    const mockInstance = {
      getPoolStatus: vi.fn(),
    };

    if (shouldReject) {
      mockInstance.getPoolStatus.mockRejectedValue(new Error(errorMessage || "Mock error"));
    } else if (mockResponse) {
      mockInstance.getPoolStatus.mockResolvedValue(mockResponse);
    }

    vi.mocked(PoolManagerService).mockReturnValue(mockInstance as any);
    return mockInstance;
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    // Setup service config mock before any service instantiation
    vi.mocked(getServiceConfig).mockReturnValue({
      baseURL: "http://test-pool-manager.com",
      apiKey: "test-key",
    });

    // Set up encryption environment for tests
    process.env.TOKEN_ENCRYPTION_KEY =
      process.env.TOKEN_ENCRYPTION_KEY ||
      "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";
    process.env.TOKEN_ENCRYPTION_KEY_ID = "test-key-id";

    // Create test scenario with workspace, users, and swarm
    const scenario = await createTestWorkspaceScenario({
      owner: { name: "Owner User" },
      members: [{ role: "ADMIN", user: { name: "Admin User" } }],
      withSwarm: true,
      swarm: {
        name: "test-swarm",
      },
    });

    ownerUser = scenario.owner;
    workspace = scenario.workspace;
    swarm = scenario.swarm!;
    adminUser = scenario.members[0];

    // Create unauthorized user not in workspace
    unauthorizedUser = await db.user.create({
      data: {
        email: `unauthorized-${Date.now()}@example.com`,
        name: "Unauthorized User",
      },
    });

    // Update swarm with encrypted poolApiKey
    const encryptedPoolApiKey = JSON.stringify(
      EncryptionService.getInstance().encryptField(
        "poolApiKey",
        "test-pool-api-key"
      )
    );

    await db.swarm.update({
      where: { id: swarm.id },
      data: {
        poolApiKey: encryptedPoolApiKey,
      },
    });

    // Refresh swarm reference
    swarm = (await db.swarm.findUnique({ where: { id: swarm.id } }))!;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Authentication Tests", () => {
    it("should return 401 for unauthenticated requests", async () => {
      getMockedSession().mockResolvedValue(mockUnauthenticatedSession());

      const url = new URL(
        `http://localhost:3000/api/w/${workspace.slug}/pool/status`
      );
      const request = new Request(url.toString(), { method: "GET" });

      const response = await GET(request as any, {
        params: Promise.resolve({ slug: workspace.slug }),
      });
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Unauthorized");
    });

    it("should return 401 for invalid user session", async () => {
      getMockedSession().mockResolvedValue({
        user: {}, // Missing id field
        expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      });

      const url = new URL(
        `http://localhost:3000/api/w/${workspace.slug}/pool/status`
      );
      const request = new Request(url.toString(), { method: "GET" });

      const response = await GET(request as any, {
        params: Promise.resolve({ slug: workspace.slug }),
      });
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Unauthorized");
    });
  });

  describe("Authorization Tests", () => {
    it("should allow workspace owner to get pool status", async () => {
      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(ownerUser)
      );

      const mockPoolStatus: PoolStatusResponse = {
        status: {
          runningVms: 5,
          pendingVms: 2,
          failedVms: 0,
          usedVms: 3,
          unusedVms: 4,
          lastCheck: new Date().toISOString(),
        },
      };

      createMockPoolManagerService(mockPoolStatus);

      const url = new URL(
        `http://localhost:3000/api/w/${workspace.slug}/pool/status`
      );
      const request = new Request(url.toString(), { method: "GET" });

      const response = await GET(request as any, {
        params: Promise.resolve({ slug: workspace.slug }),
      });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data).toBeDefined();
      expect(data.data.status).toBeDefined();
    });

    it("should allow workspace admin to get pool status", async () => {
      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(adminUser)
      );

      const mockPoolStatus: PoolStatusResponse = {
        status: {
          runningVms: 5,
          pendingVms: 2,
          failedVms: 0,
          usedVms: 3,
          unusedVms: 4,
          lastCheck: new Date().toISOString(),
        },
      };

      createMockPoolManagerService(mockPoolStatus);

      const url = new URL(
        `http://localhost:3000/api/w/${workspace.slug}/pool/status`
      );
      const request = new Request(url.toString(), { method: "GET" });

      const response = await GET(request as any, {
        params: Promise.resolve({ slug: workspace.slug }),
      });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
    });

    it("should reject unauthorized user from accessing pool status", async () => {
      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(unauthorizedUser)
      );

      const url = new URL(
        `http://localhost:3000/api/w/${workspace.slug}/pool/status`
      );
      const request = new Request(url.toString(), { method: "GET" });

      const response = await GET(request as any, {
        params: Promise.resolve({ slug: workspace.slug }),
      });
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe("Workspace not found or access denied");
    });
  });

  describe("Validation Tests", () => {
    it("should return 400 when workspace slug is missing", async () => {
      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(ownerUser)
      );

      const url = new URL(`http://localhost:3000/api/w//pool/status`);
      const request = new Request(url.toString(), { method: "GET" });

      const response = await GET(request as any, {
        params: Promise.resolve({ slug: "" }),
      });
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("Workspace slug is required");
    });

    it("should return 404 when workspace not found", async () => {
      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(ownerUser)
      );

      const url = new URL(
        `http://localhost:3000/api/w/non-existent-workspace/pool/status`
      );
      const request = new Request(url.toString(), { method: "GET" });

      const response = await GET(request as any, {
        params: Promise.resolve({ slug: "non-existent-workspace" }),
      });
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe("Workspace not found or access denied");
    });

    it("should return 404 when swarm not configured for workspace", async () => {
      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(ownerUser)
      );

      // Delete the swarm
      await db.swarm.delete({
        where: { id: swarm.id },
      });

      const url = new URL(
        `http://localhost:3000/api/w/${workspace.slug}/pool/status`
      );
      const request = new Request(url.toString(), { method: "GET" });

      const response = await GET(request as any, {
        params: Promise.resolve({ slug: workspace.slug }),
      });
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.success).toBe(false);
      expect(data.message).toBe("Pool not configured for this workspace");
    });

    it("should return 404 when poolApiKey not set", async () => {
      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(ownerUser)
      );

      // Remove poolApiKey
      await db.swarm.update({
        where: { id: swarm.id },
        data: { poolApiKey: null },
      });

      const url = new URL(
        `http://localhost:3000/api/w/${workspace.slug}/pool/status`
      );
      const request = new Request(url.toString(), { method: "GET" });

      const response = await GET(request as any, {
        params: Promise.resolve({ slug: workspace.slug }),
      });
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.success).toBe(false);
      expect(data.message).toBe("Pool not configured for this workspace");
    });
  });

  describe("Service Integration Tests", () => {
    it("should successfully fetch pool status from PoolManagerService", async () => {
      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(ownerUser)
      );

      const mockPoolStatus: PoolStatusResponse = {
        status: {
          runningVms: 10,
          pendingVms: 3,
          failedVms: 1,
          usedVms: 7,
          unusedVms: 6,
          lastCheck: new Date().toISOString(),
        },
      };

      createMockPoolManagerService(mockPoolStatus);

      const url = new URL(
        `http://localhost:3000/api/w/${workspace.slug}/pool/status`
      );
      const request = new Request(url.toString(), { method: "GET" });

      const response = await GET(request as any, {
        params: Promise.resolve({ slug: workspace.slug }),
      });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data).toBeDefined();
      expect(data.data.status).toBeDefined();
      expect(data.data.status.runningVms).toBe(10);
      expect(data.data.status.pendingVms).toBe(3);
      expect(data.data.status.failedVms).toBe(1);
      expect(data.data.status.usedVms).toBe(7);
      expect(data.data.status.unusedVms).toBe(6);
      expect(data.data.status.lastCheck).toBeDefined();
    });

    it("should validate response structure matches PoolStatusResponse type", async () => {
      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(ownerUser)
      );

      const mockPoolStatus: PoolStatusResponse = {
        status: {
          runningVms: 5,
          pendingVms: 2,
          failedVms: 0,
          usedVms: 3,
          unusedVms: 4,
          lastCheck: new Date().toISOString(),
        },
      };

      createMockPoolManagerService(mockPoolStatus);

      const url = new URL(
        `http://localhost:3000/api/w/${workspace.slug}/pool/status`
      );
      const request = new Request(url.toString(), { method: "GET" });

      const response = await GET(request as any, {
        params: Promise.resolve({ slug: workspace.slug }),
      });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toHaveProperty("success");
      expect(data).toHaveProperty("data");
      expect(data.data).toHaveProperty("status");

      const status = data.data.status;
      expect(status).toHaveProperty("runningVms");
      expect(status).toHaveProperty("pendingVms");
      expect(status).toHaveProperty("failedVms");
      expect(status).toHaveProperty("usedVms");
      expect(status).toHaveProperty("unusedVms");
      expect(status).toHaveProperty("lastCheck");

      // Verify field types
      expect(typeof status.runningVms).toBe("number");
      expect(typeof status.pendingVms).toBe("number");
      expect(typeof status.failedVms).toBe("number");
      expect(typeof status.usedVms).toBe("number");
      expect(typeof status.unusedVms).toBe("number");
      expect(typeof status.lastCheck).toBe("string");
    });

    it("should call PoolManagerService.getPoolStatus with correct parameters", async () => {
      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(ownerUser)
      );

      const mockPoolStatus: PoolStatusResponse = {
        status: {
          runningVms: 5,
          pendingVms: 2,
          failedVms: 0,
          usedVms: 3,
          unusedVms: 4,
          lastCheck: new Date().toISOString(),
        },
      };

      const mockInstance = createMockPoolManagerService(mockPoolStatus);

      const url = new URL(
        `http://localhost:3000/api/w/${workspace.slug}/pool/status`
      );
      const request = new Request(url.toString(), { method: "GET" });

      await GET(request as any, {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      expect(mockInstance.getPoolStatus).toHaveBeenCalledWith(
        swarm.id,
        swarm.poolApiKey
      );
      expect(mockInstance.getPoolStatus).toHaveBeenCalledTimes(1);
    });
  });

  describe("Error Handling Tests", () => {
    it("should return 503 when PoolManagerService throws error", async () => {
      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(ownerUser)
      );

      createMockPoolManagerService(undefined, true, "Unable to fetch pool metrics at the moment");

      const url = new URL(
        `http://localhost:3000/api/w/${workspace.slug}/pool/status`
      );
      const request = new Request(url.toString(), { method: "GET" });

      const response = await GET(request as any, {
        params: Promise.resolve({ slug: workspace.slug }),
      });
      const data = await response.json();

      expect(response.status).toBe(503);
      expect(data.success).toBe(false);
      expect(data.message).toBe("Unable to fetch pool metrics at the moment");
    });

    it("should return 503 when PoolManagerService throws connection error", async () => {
      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(ownerUser)
      );

      createMockPoolManagerService(undefined, true, "Unable to connect to pool service");

      const url = new URL(
        `http://localhost:3000/api/w/${workspace.slug}/pool/status`
      );
      const request = new Request(url.toString(), { method: "GET" });

      const response = await GET(request as any, {
        params: Promise.resolve({ slug: workspace.slug }),
      });
      const data = await response.json();

      expect(response.status).toBe(503);
      expect(data.success).toBe(false);
      expect(data.message).toBe("Unable to connect to pool service");
    });

    it("should handle generic service errors gracefully", async () => {
      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(ownerUser)
      );

      createMockPoolManagerService(undefined, true, "Unexpected service error");

      const url = new URL(
        `http://localhost:3000/api/w/${workspace.slug}/pool/status`
      );
      const request = new Request(url.toString(), { method: "GET" });

      const response = await GET(request as any, {
        params: Promise.resolve({ slug: workspace.slug }),
      });
      const data = await response.json();

      expect(response.status).toBe(503);
      expect(data.success).toBe(false);
      expect(data.message).toBe("Unexpected service error");
    });
  });

  describe("Encryption Security Tests", () => {
    it("should verify poolApiKey is stored encrypted in database", async () => {
      const swarmData = await db.swarm.findUnique({
        where: { id: swarm.id },
      });

      expect(swarmData?.poolApiKey).toBeTruthy();

      // Verify it's encrypted JSON format
      const encryptedData = JSON.parse(swarmData!.poolApiKey!);
      expect(encryptedData).toHaveProperty("data");
      expect(encryptedData).toHaveProperty("iv");
      expect(encryptedData).toHaveProperty("tag");
      expect(encryptedData).toHaveProperty("keyId");
    });

    it("should successfully decrypt poolApiKey for PoolManagerService", async () => {
      const swarmData = await db.swarm.findUnique({
        where: { id: swarm.id },
      });

      expect(swarmData?.poolApiKey).toBeTruthy();

      // Verify decryption works
      const decrypted = EncryptionService.getInstance().decryptField(
        "poolApiKey",
        swarmData!.poolApiKey!
      );
      expect(decrypted).toBe("test-pool-api-key");
    });
  });

  describe("Operational Transparency Tests", () => {
    it("should provide accurate VM metrics for monitoring", async () => {
      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(ownerUser)
      );

      const mockPoolStatus: PoolStatusResponse = {
        status: {
          runningVms: 8,
          pendingVms: 1,
          failedVms: 0,
          usedVms: 5,
          unusedVms: 4,
          lastCheck: new Date().toISOString(),
        },
      };

      createMockPoolManagerService(mockPoolStatus);

      const url = new URL(
        `http://localhost:3000/api/w/${workspace.slug}/pool/status`
      );
      const request = new Request(url.toString(), { method: "GET" });

      const response = await GET(request as any, {
        params: Promise.resolve({ slug: workspace.slug }),
      });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.data.status.runningVms).toBe(8);
      expect(data.data.status.pendingVms).toBe(1);
      expect(data.data.status.failedVms).toBe(0);
      expect(data.data.status.usedVms).toBe(5);
      expect(data.data.status.unusedVms).toBe(4);

      // Verify timestamp is recent
      const lastCheck = new Date(data.data.status.lastCheck);
      const now = new Date();
      expect(lastCheck.getTime()).toBeLessThanOrEqual(now.getTime());
    });

    it("should expose all required metrics for operational monitoring", async () => {
      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(ownerUser)
      );

      const mockPoolStatus: PoolStatusResponse = {
        status: {
          runningVms: 10,
          pendingVms: 2,
          failedVms: 1,
          usedVms: 7,
          unusedVms: 6,
          lastCheck: new Date().toISOString(),
        },
      };

      createMockPoolManagerService(mockPoolStatus);

      const url = new URL(
        `http://localhost:3000/api/w/${workspace.slug}/pool/status`
      );
      const request = new Request(url.toString(), { method: "GET" });

      const response = await GET(request as any, {
        params: Promise.resolve({ slug: workspace.slug }),
      });
      const data = await response.json();

      const status = data.data.status;

      // Verify all operational metrics are present
      expect(status.runningVms).toBeDefined();
      expect(status.pendingVms).toBeDefined();
      expect(status.failedVms).toBeDefined();
      expect(status.usedVms).toBeDefined();
      expect(status.unusedVms).toBeDefined();
      expect(status.lastCheck).toBeDefined();

      // Verify metrics are valid numbers
      expect(status.runningVms).toBeGreaterThanOrEqual(0);
      expect(status.pendingVms).toBeGreaterThanOrEqual(0);
      expect(status.failedVms).toBeGreaterThanOrEqual(0);
      expect(status.usedVms).toBeGreaterThanOrEqual(0);
      expect(status.unusedVms).toBeGreaterThanOrEqual(0);
    });
  });
});
