import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { POST } from "@/app/api/pool-manager/claim-pod/[workspaceId]/route";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import type { User, Workspace, Swarm } from "@prisma/client";
import {
  createAuthenticatedSession,
  mockUnauthenticatedSession,
  expectSuccess,
  expectUnauthorized,
  expectError,
  expectNotFound,
  expectForbidden,
  generateUniqueId,
  getMockedSession,
} from "@/__tests__/support/helpers";
import { createTestWorkspaceScenario } from "@/__tests__/support/fixtures/workspace";
import { getSwarmPoolApiKeyFor, updateSwarmPoolApiKeyFor } from "@/services/swarm/secrets";

// Mock environment configuration
vi.mock("@/lib/env", () => ({
  config: {
    POOL_MANAGER_BASE_URL: "https://pool-manager.test.com",
  },
}));

// Mock swarm secrets services to prevent external calls
vi.mock("@/services/swarm/secrets", () => ({
  getSwarmPoolApiKeyFor: vi.fn(),
  updateSwarmPoolApiKeyFor: vi.fn(),
}));

// Mock EncryptionService for decrypting poolApiKey
vi.mock("@/lib/encryption", () => ({
  EncryptionService: {
    getInstance: vi.fn(() => ({
      decryptField: vi.fn((fieldName: string, encryptedData: string) => {
        // Return predictable decrypted values for testing
        if (fieldName === "poolApiKey") {
          return "decrypted-pool-api-key-12345";
        }
        return "decrypted-value";
      }),
      encryptField: vi.fn((fieldName: string, value: string) => ({
        data: "encrypted-data",
        iv: "initialization-vector",
        tag: "auth-tag",
        keyId: "test-key",
        version: "1",
        encryptedAt: new Date().toISOString(),
      })),
    })),
  },
}));

describe("POST /api/pool-manager/claim-pod/[workspaceId] Integration Tests", () => {
  let ownerUser: User;
  let adminUser: User;
  let developerUser: User;
  let viewerUser: User;
  let unauthorizedUser: User;
  let workspace: Workspace;
  let swarm: Swarm;
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  let mockGetSwarmPoolApiKeyFor: ReturnType<typeof vi.mocked>;
  let mockUpdateSwarmPoolApiKeyFor: ReturnType<typeof vi.mocked>;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Set up mocked services
    mockGetSwarmPoolApiKeyFor = vi.mocked(getSwarmPoolApiKeyFor);
    mockUpdateSwarmPoolApiKeyFor = vi.mocked(updateSwarmPoolApiKeyFor);

    // Set up test database scenario with workspace, swarm, and multiple user roles
    const scenario = await createTestWorkspaceScenario({
      owner: { name: "Workspace Owner" },
      members: [
        { role: "ADMIN", user: { name: "Admin User" } },
        { role: "DEVELOPER", user: { name: "Developer User" } },
        { role: "VIEWER", user: { name: "Viewer User" } },
      ],
      withSwarm: true,
      swarm: {
        name: "test-swarm",
        status: "ACTIVE",
      },
    });

    ownerUser = scenario.owner;
    workspace = scenario.workspace;
    swarm = scenario.swarm!;
    adminUser = scenario.members[0];
    developerUser = scenario.members[1];
    viewerUser = scenario.members[2];

    // Create unauthorized user not in workspace
    unauthorizedUser = await db.user.create({
      data: {
        id: generateUniqueId("unauth"),
        email: `unauth-${generateUniqueId()}@example.com`,
        name: "Unauthorized User",
      },
    });

    // Update swarm with pool configuration
    await db.swarm.update({
      where: { id: swarm.id },
      data: {
        poolName: "test-pool-name",
        poolApiKey: JSON.stringify({
          data: "encrypted-pool-api-key",
          iv: "test-iv",
          tag: "test-tag",
          keyId: "test-key",
          version: "1",
          encryptedAt: new Date().toISOString(),
        }),
      },
    });

    // Refresh swarm reference
    swarm = (await db.swarm.findUnique({ where: { id: swarm.id } }))!;

    // Set up global fetch spy for Pool Manager API mocking
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Authentication Tests", () => {
    test("should return 401 for unauthenticated requests", async () => {
      getMockedSession().mockResolvedValue(mockUnauthenticatedSession());

      const request = new Request(
        `http://localhost:3000/api/pool-manager/claim-pod/${workspace.id}`,
        { method: "POST" }
      );

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      await expectUnauthorized(response);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    test("should return 401 for invalid user session (missing userId)", async () => {
      getMockedSession().mockResolvedValue({
        user: { email: "test@example.com" }, // Missing id field
        expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      });

      const request = new Request(
        `http://localhost:3000/api/pool-manager/claim-pod/${workspace.id}`,
        { method: "POST" }
      );

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      const data = await response.json();
      expect(response.status).toBe(401);
      expect(data.error).toBe("Invalid user session");
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe("Authorization Tests", () => {
    test("should allow workspace owner to claim pod", async () => {
      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(ownerUser)
      );

      // Mock successful Pool Manager API response with port 3000 mapping
      fetchSpy.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          workspace: {
            portMappings: {
              "3000": "https://frontend.example.com",
              "15552": "https://internal1.example.com",
              "15553": "https://internal2.example.com",
            },
            fqdn: "test-pod.example.com",
            state: "running",
          },
        }),
      } as Response);

      const request = new Request(
        `http://localhost:3000/api/pool-manager/claim-pod/${workspace.id}`,
        { method: "POST" }
      );

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      const data = await expectSuccess(response);
      expect(data.success).toBe(true);
      expect(data.message).toBe("Pod claimed successfully");
      expect(data.frontend).toBe("https://frontend.example.com");
    });

    test("should allow workspace admin to claim pod", async () => {
      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(adminUser)
      );

      // Mock successful Pool Manager API response
      fetchSpy.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          workspace: {
            portMappings: {
              "3000": "https://frontend.example.com",
            },
          },
        }),
      } as Response);

      const request = new Request(
        `http://localhost:3000/api/pool-manager/claim-pod/${workspace.id}`,
        { method: "POST" }
      );

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      const data = await expectSuccess(response);
      expect(data.success).toBe(true);
      expect(data.frontend).toBe("https://frontend.example.com");
    });

    test("should allow workspace developer to claim pod", async () => {
      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(developerUser)
      );

      // Mock successful Pool Manager API response
      fetchSpy.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          workspace: {
            portMappings: {
              "8080": "https://app.example.com",
            },
          },
        }),
      } as Response);

      const request = new Request(
        `http://localhost:3000/api/pool-manager/claim-pod/${workspace.id}`,
        { method: "POST" }
      );

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      const data = await expectSuccess(response);
      expect(data.success).toBe(true);
    });

    test("should allow workspace viewer to claim pod", async () => {
      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(viewerUser)
      );

      // Mock successful Pool Manager API response
      fetchSpy.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          workspace: {
            portMappings: {
              "3000": "https://frontend.example.com",
            },
          },
        }),
      } as Response);

      const request = new Request(
        `http://localhost:3000/api/pool-manager/claim-pod/${workspace.id}`,
        { method: "POST" }
      );

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      const data = await expectSuccess(response);
      expect(data.success).toBe(true);
    });

    test("should return 403 for user not in workspace", async () => {
      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(unauthorizedUser)
      );

      const request = new Request(
        `http://localhost:3000/api/pool-manager/claim-pod/${workspace.id}`,
        { method: "POST" }
      );

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      await expectForbidden(response, "Access denied");
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe("Validation Tests", () => {
    test("should return 404 for non-existent workspace", async () => {
      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(ownerUser)
      );

      const nonExistentId = generateUniqueId("workspace");

      const request = new Request(
        `http://localhost:3000/api/pool-manager/claim-pod/${nonExistentId}`,
        { method: "POST" }
      );

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: nonExistentId }),
      });

      await expectNotFound(response, "Workspace not found");
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    test("should return 404 when workspace has no swarm", async () => {
      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(ownerUser)
      );

      // Create workspace without swarm
      const workspaceWithoutSwarm = await db.workspace.create({
        data: {
          name: "No Swarm Workspace",
          slug: `no-swarm-${generateUniqueId()}`,
          ownerId: ownerUser.id,
        },
      });

      const request = new Request(
        `http://localhost:3000/api/pool-manager/claim-pod/${workspaceWithoutSwarm.id}`,
        { method: "POST" }
      );

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspaceWithoutSwarm.id }),
      });

      await expectNotFound(response, "No swarm found for this workspace");
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    test("should return 400 when swarm missing poolName", async () => {
      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(ownerUser)
      );

      // Update swarm to remove poolName
      await db.swarm.update({
        where: { id: swarm.id },
        data: { poolName: null },
      });

      const request = new Request(
        `http://localhost:3000/api/pool-manager/claim-pod/${workspace.id}`,
        { method: "POST" }
      );

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      await expectError(
        response,
        "Swarm not properly configured with pool information",
        400
      );
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    test("should return 400 when swarm missing poolApiKey", async () => {
      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(ownerUser)
      );

      // Update swarm to remove poolApiKey
      await db.swarm.update({
        where: { id: swarm.id },
        data: { poolApiKey: null },
      });

      // Mock the external service calls to return empty/null values
      mockGetSwarmPoolApiKeyFor.mockResolvedValue("");
      mockUpdateSwarmPoolApiKeyFor.mockResolvedValue(undefined);

      const request = new Request(
        `http://localhost:3000/api/pool-manager/claim-pod/${workspace.id}`,
        { method: "POST" }
      );

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      await expectError(
        response,
        "Swarm not properly configured with pool information",
        400
      );
    });
  });

  describe("Resource Allocation Tests - Port Mapping Logic", () => {
    test("should prioritize port 3000 when multiple app ports exist", async () => {
      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(ownerUser)
      );

      // Mock response with multiple app ports including 3000
      fetchSpy.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          workspace: {
            portMappings: {
              "8080": "https://app1.example.com",
              "3000": "https://frontend.example.com", // Should be prioritized
              "4200": "https://app2.example.com",
              "15552": "https://internal1.example.com", // Should be filtered
              "15553": "https://internal2.example.com", // Should be filtered
            },
          },
        }),
      } as Response);

      const request = new Request(
        `http://localhost:3000/api/pool-manager/claim-pod/${workspace.id}`,
        { method: "POST" }
      );

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      const data = await expectSuccess(response);
      expect(data.frontend).toBe("https://frontend.example.com");
    });

    test("should use single app port when only one non-internal port exists", async () => {
      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(ownerUser)
      );

      // Mock response with single app port and internal ports
      fetchSpy.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          workspace: {
            portMappings: {
              "8080": "https://single-app.example.com", // Only app port
              "15552": "https://internal1.example.com",
              "15553": "https://internal2.example.com",
            },
          },
        }),
      } as Response);

      const request = new Request(
        `http://localhost:3000/api/pool-manager/claim-pod/${workspace.id}`,
        { method: "POST" }
      );

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      const data = await expectSuccess(response);
      expect(data.frontend).toBe("https://single-app.example.com");
    });

    test("should filter out internal ports 15552 and 15553", async () => {
      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(ownerUser)
      );

      // Mock response with only internal ports and one app port
      fetchSpy.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          workspace: {
            portMappings: {
              "15552": "https://internal1.example.com", // Should be filtered
              "15553": "https://internal2.example.com", // Should be filtered
              "9000": "https://app.example.com", // Should be used
            },
          },
        }),
      } as Response);

      const request = new Request(
        `http://localhost:3000/api/pool-manager/claim-pod/${workspace.id}`,
        { method: "POST" }
      );

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      const data = await expectSuccess(response);
      expect(data.frontend).toBe("https://app.example.com");
    });

    test("should return 500 when only internal ports exist (no frontend port)", async () => {
      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(ownerUser)
      );

      // Mock response with only internal ports
      fetchSpy.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          workspace: {
            portMappings: {
              "15552": "https://internal1.example.com",
              "15553": "https://internal2.example.com",
            },
          },
        }),
      } as Response);

      const request = new Request(
        `http://localhost:3000/api/pool-manager/claim-pod/${workspace.id}`,
        { method: "POST" }
      );

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      await expectError(response, "Failed to claim pod", 500);
    });

    test("should return 500 when multiple app ports exist but no port 3000", async () => {
      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(ownerUser)
      );

      // Mock response with multiple app ports but no port 3000
      fetchSpy.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          workspace: {
            portMappings: {
              "8080": "https://app1.example.com",
              "4200": "https://app2.example.com",
              "9000": "https://app3.example.com",
            },
          },
        }),
      } as Response);

      const request = new Request(
        `http://localhost:3000/api/pool-manager/claim-pod/${workspace.id}`,
        { method: "POST" }
      );

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      await expectError(response, "Failed to claim pod", 500);
    });
  });

  describe("External API Error Tests", () => {
    test("should handle Pool Manager API non-200 response", async () => {
      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(ownerUser)
      );

      // Mock Pool Manager API returning 500 error
      fetchSpy.mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => "Internal Server Error",
      } as Response);

      const request = new Request(
        `http://localhost:3000/api/pool-manager/claim-pod/${workspace.id}`,
        { method: "POST" }
      );

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      await expectError(response, "Failed to claim pod", 500);
    });

    test("should handle Pool Manager API 404 response", async () => {
      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(ownerUser)
      );

      // Mock Pool Manager API returning 404 (pool not found)
      fetchSpy.mockResolvedValue({
        ok: false,
        status: 404,
        text: async () => "Pool not found",
      } as Response);

      const request = new Request(
        `http://localhost:3000/api/pool-manager/claim-pod/${workspace.id}`,
        { method: "POST" }
      );

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      await expectError(response, "Failed to claim pod", 500);
    });

    test("should handle network failure during Pool Manager API call", async () => {
      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(ownerUser)
      );

      // Mock network error
      fetchSpy.mockRejectedValue(new Error("Network request failed"));

      const request = new Request(
        `http://localhost:3000/api/pool-manager/claim-pod/${workspace.id}`,
        { method: "POST" }
      );

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      await expectError(response, "Failed to claim pod", 500);
    });

    test("should verify correct Pool Manager API endpoint and headers", async () => {
      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(ownerUser)
      );

      // Mock successful response
      fetchSpy.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          workspace: {
            portMappings: {
              "3000": "https://frontend.example.com",
            },
          },
        }),
      } as Response);

      const request = new Request(
        `http://localhost:3000/api/pool-manager/claim-pod/${workspace.id}`,
        { method: "POST" }
      );

      await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      // Verify fetch was called with correct URL and headers
      expect(fetchSpy).toHaveBeenCalledWith(
        "https://pool-manager.test.com/pools/test-pool-name/workspace",
        expect.objectContaining({
          method: "GET",
          headers: {
            Authorization: "Bearer decrypted-pool-api-key-12345",
            "Content-Type": "application/json",
          },
        })
      );
    });

    test("should use encrypted poolApiKey and decrypt before API call", async () => {
      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(ownerUser)
      );

      // Mock successful response
      fetchSpy.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          workspace: {
            portMappings: {
              "3000": "https://frontend.example.com",
            },
          },
        }),
      } as Response);

      const request = new Request(
        `http://localhost:3000/api/pool-manager/claim-pod/${workspace.id}`,
        { method: "POST" }
      );

      await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      // The swarm already has a poolApiKey from beforeEach setup, so encryption service should be called
      // Verify EncryptionService.decryptField was called
      const mockDecryptField = EncryptionService.getInstance().decryptField;
      expect(mockDecryptField).toHaveBeenCalledWith(
        "poolApiKey",
        expect.any(String)
      );
    });
  });

  describe("Success Scenarios", () => {
    test("should successfully claim pod and return frontend URL", async () => {
      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(ownerUser)
      );

      // Mock successful Pool Manager API response
      fetchSpy.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          workspace: {
            portMappings: {
              "3000": "https://frontend.example.com",
              "15552": "https://internal1.example.com",
              "15553": "https://internal2.example.com",
            },
            fqdn: "test-pod.example.com",
            state: "running",
          },
        }),
      } as Response);

      const request = new Request(
        `http://localhost:3000/api/pool-manager/claim-pod/${workspace.id}`,
        { method: "POST" }
      );

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      const data = await expectSuccess(response);

      // Verify response structure
      expect(data).toMatchObject({
        success: true,
        message: "Pod claimed successfully",
        frontend: "https://frontend.example.com",
      });
    });

    test("should handle MOCK_BROWSER_URL environment variable for development", async () => {
      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(ownerUser)
      );

      // Set mock environment variable
      const originalMockUrl = process.env.MOCK_BROWSER_URL;
      process.env.MOCK_BROWSER_URL = "https://mock-dev-frontend.local";

      const request = new Request(
        `http://localhost:3000/api/pool-manager/claim-pod/${workspace.id}`,
        { method: "POST" }
      );

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      const data = await expectSuccess(response);
      expect(data.frontend).toBe("https://mock-dev-frontend.local");

      // Restore original value
      if (originalMockUrl) {
        process.env.MOCK_BROWSER_URL = originalMockUrl;
      } else {
        delete process.env.MOCK_BROWSER_URL;
      }

      // Verify Pool Manager API was NOT called in mock mode
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  describe("Edge Cases and Error Handling", () => {
    test("should handle malformed Pool Manager API response", async () => {
      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(ownerUser)
      );

      // Mock response with missing workspace field
      fetchSpy.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          // Missing workspace field
        }),
      } as Response);

      const request = new Request(
        `http://localhost:3000/api/pool-manager/claim-pod/${workspace.id}`,
        { method: "POST" }
      );

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      await expectError(response, "Failed to claim pod", 500);
    });

    test("should handle Pool Manager API response with empty portMappings", async () => {
      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(ownerUser)
      );

      // Mock response with empty portMappings
      fetchSpy.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          workspace: {
            portMappings: {}, // No ports mapped
          },
        }),
      } as Response);

      const request = new Request(
        `http://localhost:3000/api/pool-manager/claim-pod/${workspace.id}`,
        { method: "POST" }
      );

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      await expectError(response, "Failed to claim pod", 500);
    });
  });
});