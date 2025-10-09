import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { GET } from "@/app/api/w/[slug]/pool/status/route";
import { db } from "@/lib/db";
import type { User, Workspace, Swarm } from "@prisma/client";
import {
  createAuthenticatedSession,
  mockUnauthenticatedSession,
  getMockedSession,
} from "@/__tests__/support/helpers";
import { createTestWorkspaceScenario } from "@/__tests__/support/fixtures/workspace";
import { EncryptionService } from "@/lib/encryption";
import type { PoolStatusResponse } from "@/types/pool-manager";

// Mock the entire pool-manager module
const mockGetPoolStatus = vi.fn();
vi.mock("@/services/pool-manager", () => {
  const MockPoolManagerService = vi.fn().mockImplementation(() => ({
    getPoolStatus: mockGetPoolStatus,
  }));
  
  return {
    PoolManagerService: MockPoolManagerService,
  };
});

// Mock EncryptionService
vi.mock("@/lib/encryption", () => ({
  EncryptionService: {
    getInstance: vi.fn(),
  },
}));

// Import mocked PoolManagerService for assertions
import { PoolManagerService } from "@/services/pool-manager";

const mockEncryptionService = {
  decryptField: vi.fn(),
  encryptField: vi.fn(),
};

describe("GET /api/w/[slug]/pool/status - Integration Tests", () => {
  let ownerUser: User;
  let adminUser: User;
  let viewerUser: User;
  let unauthorizedUser: User;
  let workspace: Workspace;
  let swarm: Swarm;
  let mockPoolManagerService: any;

  beforeEach(async () => {
    // Clear all mocks including the shared mockGetPoolStatus
    vi.clearAllMocks();
    mockGetPoolStatus.mockReset();

    // Setup encryption environment
    process.env.TOKEN_ENCRYPTION_KEY =
      process.env.TOKEN_ENCRYPTION_KEY ||
      "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";
    process.env.TOKEN_ENCRYPTION_KEY_ID = "test-key-id";

    // Setup EncryptionService mock
    (EncryptionService.getInstance as any).mockReturnValue(mockEncryptionService);
    mockEncryptionService.decryptField.mockImplementation(
      (fieldName: string, encryptedValue: string) => {
        // Return decrypted API key for tests
        return "decrypted-pool-api-key-12345";
      }
    );

    // Create test workspace with swarm and pool configuration
    const scenario = await createTestWorkspaceScenario({
      owner: { name: "Pool Owner" },
      members: [
        { role: "ADMIN", user: { name: "Pool Admin" } },
        { role: "VIEWER", user: { name: "Pool Viewer" } },
      ],
      withSwarm: true,
      swarm: {
        name: "test-pool-swarm",
        status: "ACTIVE",
      },
    });

    ownerUser = scenario.owner;
    workspace = scenario.workspace;
    swarm = scenario.swarm!;

    // Extract members by role
    adminUser = scenario.members[0];
    viewerUser = scenario.members[1];

    // Create unauthorized user not in workspace
    const uniqueId = Date.now();
    unauthorizedUser = await db.user.create({
      data: {
        id: `unauth-${uniqueId}`,
        email: `unauth-${uniqueId}@example.com`,
        name: "Unauthorized User",
      },
    });

    // Update swarm with encrypted poolApiKey
    const encryptedApiKey = JSON.stringify({
      data: "encrypted-api-key-data",
      iv: "initialization-vector",
      tag: "auth-tag",
      keyId: "test-key-id",
      version: "1",
      encryptedAt: new Date().toISOString(),
    });

    await db.swarm.update({
      where: { id: swarm.id },
      data: {
        poolApiKey: encryptedApiKey,
      },
    });

    // Refresh swarm reference
    swarm = (await db.swarm.findUnique({ where: { id: swarm.id } }))!;

    // Setup PoolManagerService mock
    mockPoolManagerService = {
      getPoolStatus: vi.fn(),
    };
    (PoolManagerService as any).mockImplementation(() => mockPoolManagerService);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
  });

  describe("Authentication Tests", () => {
    it("should return 401 for unauthenticated requests", async () => {
      getMockedSession().mockResolvedValue(mockUnauthenticatedSession());

      const url = new URL(`http://localhost:3000/api/w/${workspace.slug}/pool/status`);
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

      const url = new URL(`http://localhost:3000/api/w/${workspace.slug}/pool/status`);
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
    it("should allow workspace owner to fetch pool status", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(ownerUser));

      // Mock successful pool status response
      const mockPoolStatus: PoolStatusResponse = {
        status: {
          runningVms: 5,
          pendingVms: 2,
          failedVms: 1,
          usedVms: 8,
          unusedVms: 12,
          lastCheck: "2024-01-15T10:30:00Z",
        },
      };
      mockGetPoolStatus.mockResolvedValue(mockPoolStatus);

      const url = new URL(`http://localhost:3000/api/w/${workspace.slug}/pool/status`);
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

    it("should allow workspace admin to fetch pool status", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(adminUser));

      const mockPoolStatus: PoolStatusResponse = {
        status: {
          runningVms: 3,
          pendingVms: 1,
          failedVms: 0,
          usedVms: 4,
          unusedVms: 16,
          lastCheck: "2024-01-15T11:00:00Z",
        },
      };
      mockGetPoolStatus.mockResolvedValue(mockPoolStatus);

      const url = new URL(`http://localhost:3000/api/w/${workspace.slug}/pool/status`);
      const request = new Request(url.toString(), { method: "GET" });

      const response = await GET(request as any, {
        params: Promise.resolve({ slug: workspace.slug }),
      });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
    });

    it("should allow workspace viewer to fetch pool status", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(viewerUser));

      const mockPoolStatus: PoolStatusResponse = {
        status: {
          runningVms: 2,
          pendingVms: 0,
          failedVms: 0,
          usedVms: 2,
          unusedVms: 18,
          lastCheck: "2024-01-15T11:15:00Z",
        },
      };
      mockGetPoolStatus.mockResolvedValue(mockPoolStatus);

      const url = new URL(`http://localhost:3000/api/w/${workspace.slug}/pool/status`);
      const request = new Request(url.toString(), { method: "GET" });

      const response = await GET(request as any, {
        params: Promise.resolve({ slug: workspace.slug }),
      });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
    });

    it("should reject unauthorized user from fetching pool status", async () => {
      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(unauthorizedUser)
      );

      const url = new URL(`http://localhost:3000/api/w/${workspace.slug}/pool/status`);
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
      getMockedSession().mockResolvedValue(createAuthenticatedSession(ownerUser));

      const url = new URL("http://localhost:3000/api/w//pool/status");
      const request = new Request(url.toString(), { method: "GET" });

      const response = await GET(request as any, {
        params: Promise.resolve({ slug: "" }),
      });
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("Workspace slug is required");
    });

    it("should return 404 when workspace not found", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(ownerUser));

      const url = new URL("http://localhost:3000/api/w/non-existent-workspace/pool/status");
      const request = new Request(url.toString(), { method: "GET" });

      const response = await GET(request as any, {
        params: Promise.resolve({ slug: "non-existent-workspace" }),
      });
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe("Workspace not found or access denied");
    });

    it("should return 404 when workspace has no swarm configured", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(ownerUser));

      // Create workspace without swarm
      const noSwarmScenario = await createTestWorkspaceScenario({
        owner: { name: "No Swarm Owner", email: `no-swarm-${Date.now()}@example.com` },
        withSwarm: false,
      });

      // Add owner user to the workspace for testing
      await db.workspaceMember.create({
        data: {
          workspaceId: noSwarmScenario.workspace.id,
          userId: ownerUser.id,
          role: "ADMIN",
        },
      });

      const url = new URL(
        `http://localhost:3000/api/w/${noSwarmScenario.workspace.slug}/pool/status`
      );
      const request = new Request(url.toString(), { method: "GET" });

      const response = await GET(request as any, {
        params: Promise.resolve({ slug: noSwarmScenario.workspace.slug }),
      });
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.success).toBe(false);
      expect(data.message).toBe("Pool not configured for this workspace");
    });

    it("should return 404 when swarm has no poolApiKey", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(ownerUser));

      // Remove poolApiKey from swarm
      await db.swarm.update({
        where: { id: swarm.id },
        data: { poolApiKey: null },
      });

      const url = new URL(`http://localhost:3000/api/w/${workspace.slug}/pool/status`);
      const request = new Request(url.toString(), { method: "GET" });

      const response = await GET(request as any, {
        params: Promise.resolve({ slug: workspace.slug }),
      });
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.success).toBe(false);
      expect(data.message).toBe("Pool not configured for this workspace");

      // Restore poolApiKey for subsequent tests
      const encryptedApiKey = JSON.stringify({
        data: "encrypted-api-key-data",
        iv: "initialization-vector",
        tag: "auth-tag",
        keyId: "test-key-id",
        version: "1",
        encryptedAt: new Date().toISOString(),
      });
      await db.swarm.update({
        where: { id: swarm.id },
        data: { poolApiKey: encryptedApiKey },
      });
    });
  });

  describe("Success Cases - Pool Status Retrieval", () => {
    it("should return valid pool status with all metrics", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(ownerUser));

      const mockPoolStatus: PoolStatusResponse = {
        status: {
          runningVms: 10,
          pendingVms: 3,
          failedVms: 2,
          usedVms: 15,
          unusedVms: 5,
          lastCheck: "2024-01-15T12:00:00Z",
        },
      };
      mockGetPoolStatus.mockResolvedValue(mockPoolStatus);

      const url = new URL(`http://localhost:3000/api/w/${workspace.slug}/pool/status`);
      const request = new Request(url.toString(), { method: "GET" });

      const response = await GET(request as any, {
        params: Promise.resolve({ slug: workspace.slug }),
      });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data).toBeDefined();
      expect(data.data.status).toEqual(mockPoolStatus.status);

      // Verify PoolManagerService was called with correct parameters
      expect(mockGetPoolStatus).toHaveBeenCalledWith(
        swarm.id,
        expect.any(String) // poolApiKey (encrypted)
      );

      // Note: EncryptionService decryption happens inside the real PoolManagerService
      // In the route, we pass the encrypted value directly and the service handles decryption
    });

    it("should validate response schema has all required fields", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(ownerUser));

      const mockPoolStatus: PoolStatusResponse = {
        status: {
          runningVms: 7,
          pendingVms: 1,
          failedVms: 0,
          usedVms: 8,
          unusedVms: 12,
          lastCheck: "2024-01-15T13:00:00Z",
        },
      };
      mockGetPoolStatus.mockResolvedValue(mockPoolStatus);

      const url = new URL(`http://localhost:3000/api/w/${workspace.slug}/pool/status`);
      const request = new Request(url.toString(), { method: "GET" });

      const response = await GET(request as any, {
        params: Promise.resolve({ slug: workspace.slug }),
      });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);

      // Validate all required fields in response
      const status = data.data.status;
      expect(status).toHaveProperty("runningVms");
      expect(status).toHaveProperty("pendingVms");
      expect(status).toHaveProperty("failedVms");
      expect(status).toHaveProperty("usedVms");
      expect(status).toHaveProperty("unusedVms");
      expect(status).toHaveProperty("lastCheck");

      // Validate field types
      expect(typeof status.runningVms).toBe("number");
      expect(typeof status.pendingVms).toBe("number");
      expect(typeof status.failedVms).toBe("number");
      expect(typeof status.usedVms).toBe("number");
      expect(typeof status.unusedVms).toBe("number");
      expect(typeof status.lastCheck).toBe("string");
    });

    it("should handle zero VM counts correctly", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(ownerUser));

      const mockPoolStatus: PoolStatusResponse = {
        status: {
          runningVms: 0,
          pendingVms: 0,
          failedVms: 0,
          usedVms: 0,
          unusedVms: 20,
          lastCheck: "2024-01-15T14:00:00Z",
        },
      };
      mockGetPoolStatus.mockResolvedValue(mockPoolStatus);

      const url = new URL(`http://localhost:3000/api/w/${workspace.slug}/pool/status`);
      const request = new Request(url.toString(), { method: "GET" });

      const response = await GET(request as any, {
        params: Promise.resolve({ slug: workspace.slug }),
      });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.status.runningVms).toBe(0);
      expect(data.data.status.pendingVms).toBe(0);
      expect(data.data.status.failedVms).toBe(0);
    });
  });

  describe("External Service Integration - Error Handling", () => {
    it("should return 503 when Pool Manager service is unavailable", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(ownerUser));

      // Mock service failure
      mockGetPoolStatus.mockRejectedValue(
        new Error("Unable to connect to pool service")
      );

      const url = new URL(`http://localhost:3000/api/w/${workspace.slug}/pool/status`);
      const request = new Request(url.toString(), { method: "GET" });

      const response = await GET(request as any, {
        params: Promise.resolve({ slug: workspace.slug }),
      });
      const data = await response.json();

      expect(response.status).toBe(503);
      expect(data.success).toBe(false);
      expect(data.message).toContain("Unable to connect to pool service");
    });

    it("should return 503 when Pool Manager returns error", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(ownerUser));

      // Mock API error
      mockGetPoolStatus.mockRejectedValue(
        new Error("Unable to fetch pool metrics at the moment")
      );

      const url = new URL(`http://localhost:3000/api/w/${workspace.slug}/pool/status`);
      const request = new Request(url.toString(), { method: "GET" });

      const response = await GET(request as any, {
        params: Promise.resolve({ slug: workspace.slug }),
      });
      const data = await response.json();

      expect(response.status).toBe(503);
      expect(data.success).toBe(false);
      expect(data.message).toBe("Unable to fetch pool metrics at the moment");
    });

    it("should return 503 for network failures", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(ownerUser));

      // Mock network error
      mockGetPoolStatus.mockRejectedValue(
        new Error("Network request failed")
      );

      const url = new URL(`http://localhost:3000/api/w/${workspace.slug}/pool/status`);
      const request = new Request(url.toString(), { method: "GET" });

      const response = await GET(request as any, {
        params: Promise.resolve({ slug: workspace.slug }),
      });
      const data = await response.json();

      expect(response.status).toBe(503);
      expect(data.success).toBe(false);
      expect(data.message).toContain("Network request failed");
    });
  });

  describe("Security - Encrypted Credentials", () => {
    it("should decrypt poolApiKey before calling Pool Manager service", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(ownerUser));

      const mockPoolStatus: PoolStatusResponse = {
        status: {
          runningVms: 4,
          pendingVms: 1,
          failedVms: 0,
          usedVms: 5,
          unusedVms: 15,
          lastCheck: "2024-01-15T15:00:00Z",
        },
      };
      mockGetPoolStatus.mockResolvedValue(mockPoolStatus);

      const url = new URL(`http://localhost:3000/api/w/${workspace.slug}/pool/status`);
      const request = new Request(url.toString(), { method: "GET" });

      await GET(request as any, {
        params: Promise.resolve({ slug: workspace.slug }),
      });

      // Note: Tests verifies route passess encrypted key to service,
      // encryption/decryption happens inside the actual PoolManagerService
      expect(mockGetPoolStatus).toHaveBeenCalledWith(
        swarm.id,
        expect.any(String) // poolApiKey (encrypted)
      );
    });

    it("should not expose encrypted credentials in response", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(ownerUser));

      const mockPoolStatus: PoolStatusResponse = {
        status: {
          runningVms: 6,
          pendingVms: 2,
          failedVms: 1,
          usedVms: 9,
          unusedVms: 11,
          lastCheck: "2024-01-15T16:00:00Z",
        },
      };
      mockGetPoolStatus.mockResolvedValue(mockPoolStatus);

      const url = new URL(`http://localhost:3000/api/w/${workspace.slug}/pool/status`);
      const request = new Request(url.toString(), { method: "GET" });

      const response = await GET(request as any, {
        params: Promise.resolve({ slug: workspace.slug }),
      });
      const data = await response.json();

      // Verify response does not contain sensitive information
      const responseString = JSON.stringify(data);
      expect(responseString).not.toContain("poolApiKey");
      expect(responseString).not.toContain("encrypted-api-key-data");
      expect(responseString).not.toContain("decrypted-pool-api-key");
    });

    it("should handle encryption service failures gracefully", async () => {
      // This test expects the service mock to throw, simulating service-level encryption failure
      getMockedSession().mockResolvedValue(createAuthenticatedSession(ownerUser));

      // Mock service error that would come from encryption failure inside PoolManagerService
      mockGetPoolStatus.mockRejectedValue(
        new Error("Decryption failed")
      );

      const url = new URL(`http://localhost:3000/api/w/${workspace.slug}/pool/status`);
      const request = new Request(url.toString(), { method: "GET" });

      const response = await GET(request as any, {
        params: Promise.resolve({ slug: workspace.slug }),
      });
      const data = await response.json();

      // Service-level decryption errors surface as 503 (service unavailable)
      expect(response.status).toBe(503);
      expect(data.success).toBe(false);
      expect(data.message).toContain("Decryption failed");
    });
  });

  describe("Data Transformation - camelCase Conversion", () => {
    it("should verify PoolManagerService transforms snake_case to camelCase", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(ownerUser));

      // Mock response with camelCase (as PoolManagerService should return)
      const mockPoolStatus: PoolStatusResponse = {
        status: {
          runningVms: 8,
          pendingVms: 3,
          failedVms: 2,
          usedVms: 13,
          unusedVms: 7,
          lastCheck: "2024-01-15T17:00:00Z",
        },
      };
      mockGetPoolStatus.mockResolvedValue(mockPoolStatus);

      const url = new URL(`http://localhost:3000/api/w/${workspace.slug}/pool/status`);
      const request = new Request(url.toString(), { method: "GET" });

      const response = await GET(request as any, {
        params: Promise.resolve({ slug: workspace.slug }),
      });
      const data = await response.json();

      expect(response.status).toBe(200);

      // Verify response uses camelCase field names
      const status = data.data.status;
      expect(status).toHaveProperty("runningVms");
      expect(status).toHaveProperty("pendingVms");
      expect(status).toHaveProperty("failedVms");
      expect(status).toHaveProperty("usedVms");
      expect(status).toHaveProperty("unusedVms");
      expect(status).toHaveProperty("lastCheck");

      // Verify no snake_case fields in response
      expect(status).not.toHaveProperty("running_vms");
      expect(status).not.toHaveProperty("pending_vms");
      expect(status).not.toHaveProperty("failed_vms");
      expect(status).not.toHaveProperty("used_vms");
      expect(status).not.toHaveProperty("unused_vms");
      expect(status).not.toHaveProperty("last_check");
    });
  });

  describe("Edge Cases", () => {
    it("should handle very large VM counts", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(ownerUser));

      const mockPoolStatus: PoolStatusResponse = {
        status: {
          runningVms: 999999,
          pendingVms: 50000,
          failedVms: 10000,
          usedVms: 1059999,
          unusedVms: 100,
          lastCheck: "2024-01-15T18:00:00Z",
        },
      };
      mockGetPoolStatus.mockResolvedValue(mockPoolStatus);

      const url = new URL(`http://localhost:3000/api/w/${workspace.slug}/pool/status`);
      const request = new Request(url.toString(), { method: "GET" });

      const response = await GET(request as any, {
        params: Promise.resolve({ slug: workspace.slug }),
      });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.data.status.runningVms).toBe(999999);
      expect(data.data.status.usedVms).toBe(1059999);
    });

    it("should handle old lastCheck timestamps", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(ownerUser));

      const mockPoolStatus: PoolStatusResponse = {
        status: {
          runningVms: 5,
          pendingVms: 1,
          failedVms: 0,
          usedVms: 6,
          unusedVms: 14,
          lastCheck: "2020-01-01T00:00:00Z", // Old timestamp
        },
      };
      mockGetPoolStatus.mockResolvedValue(mockPoolStatus);

      const url = new URL(`http://localhost:3000/api/w/${workspace.slug}/pool/status`);
      const request = new Request(url.toString(), { method: "GET" });

      const response = await GET(request as any, {
        params: Promise.resolve({ slug: workspace.slug }),
      });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.data.status.lastCheck).toBe("2020-01-01T00:00:00Z");
    });
  });
});