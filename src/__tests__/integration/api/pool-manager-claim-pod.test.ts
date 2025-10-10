import { describe, test, beforeEach, vi, expect, afterEach } from "vitest";
import { POST } from "@/app/api/pool-manager/claim-pod/[workspaceId]/route";
import { db } from "@/lib/db";
import {
  createAuthenticatedSession,
  getMockedSession,
  expectSuccess,
  expectError,
  expectUnauthorized,
  expectNotFound,
  createPostRequest,
  generateUniqueId,
} from "@/__tests__/support/helpers";
import {
  createTestWorkspaceScenario,
  createTestUser,
} from "@/__tests__/support/fixtures";
import type { User, Workspace, Swarm } from "@prisma/client";

// Mock global fetch for Pool Manager API
const mockFetch = vi.fn();
global.fetch = mockFetch as any;

// Mock swarm services that have external dependencies
vi.mock("@/services/swarm/secrets", () => ({
  getSwarmPoolApiKeyFor: vi.fn().mockResolvedValue("mock-pool-api-key"),
  updateSwarmPoolApiKeyFor: vi.fn().mockResolvedValue(undefined),
}));

// Mock EncryptionService with proper decryption
vi.mock("@/lib/encryption", () => ({
  EncryptionService: {
    getInstance: vi.fn(() => ({
      decryptField: vi.fn((fieldName: string, encryptedData: any) => {
        if (fieldName === "poolApiKey") {
          return "decrypted-pool-api-key";
        }
        return "decrypted-value";
      }),
    })),
  },
}));

describe("POST /api/pool-manager/claim-pod/[workspaceId] - Integration Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset environment variable
    delete process.env.MOCK_BROWSER_URL;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Authentication Tests", () => {
    test("returns 401 when not authenticated", async () => {
      // Arrange
      getMockedSession().mockResolvedValue(null);

      // Act
      const request = createPostRequest(
        "http://localhost/api/pool-manager/claim-pod/test-workspace-id",
        {}
      );
      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: "test-workspace-id" }),
      });

      // Assert
      await expectUnauthorized(response);
    });

    test("returns 401 when session has no user", async () => {
      // Arrange
      getMockedSession().mockResolvedValue({ user: null } as any);

      // Act
      const request = createPostRequest(
        "http://localhost/api/pool-manager/claim-pod/test-workspace-id",
        {}
      );
      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: "test-workspace-id" }),
      });

      // Assert
      await expectUnauthorized(response);
    });

    test("returns 401 when user session is invalid (missing id)", async () => {
      // Arrange
      getMockedSession().mockResolvedValue({
        user: { email: "test@example.com" }, // Missing id field
        expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      } as any);

      // Act
      const request = createPostRequest(
        "http://localhost/api/pool-manager/claim-pod/test-workspace-id",
        {}
      );
      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: "test-workspace-id" }),
      });

      // Assert
      const data = await response.json();
      expect(response.status).toBe(401);
      expect(data.error).toBe("Invalid user session");
    });
  });

  describe("Authorization Tests", () => {
    let owner: User;
    let workspace: Workspace;
    let swarm: Swarm;
    let memberDeveloper: User;
    let memberViewer: User;
    let nonMember: User;

    beforeEach(async () => {
      await db.$transaction(async (tx) => {
        // Create workspace scenario with owner and members
        const scenario = await createTestWorkspaceScenario({
          owner: { name: "Claim Pod Owner" },
          members: [
            { role: "DEVELOPER", user: { name: "Developer User" } },
            { role: "VIEWER", user: { name: "Viewer User" } },
          ],
          withSwarm: true,
          swarm: {
            name: `claim-pod-swarm-${generateUniqueId("swarm")}`,
            status: "ACTIVE",
          },
        });

        owner = scenario.owner;
        workspace = scenario.workspace;
        swarm = scenario.swarm!;
        memberDeveloper = scenario.members[0];
        memberViewer = scenario.members[1];

        // Create non-member user
        nonMember = await tx.user.create({
          data: {
            id: generateUniqueId("nonmember"),
            email: `nonmember-${generateUniqueId()}@example.com`,
            name: "Non Member User",
          },
        });

        // Update swarm with encrypted poolApiKey and poolName using raw JSON
        // The route expects encrypted data, so we store it as properly formatted encrypted JSON
        await tx.swarm.update({
          where: { id: swarm.id },
          data: {
            poolApiKey: JSON.stringify({
              data: "mock-encrypted-data",
              iv: "mock-iv", 
              tag: "mock-tag",
              version: "v1",
              encryptedAt: new Date().toISOString(),
            }),
            poolName: "test-pool",
          },
        });
      });
    });

    test("allows workspace owner to claim pod", async () => {
      // Arrange
      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      mockFetch.mockResolvedValue({
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
            fqdn: "workspace.example.com",
            state: "running",
          },
        }),
      });

      // Act
      const request = createPostRequest(
        `http://localhost/api/pool-manager/claim-pod/${workspace.id}`,
        {}
      );
      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      // Assert
      const data = await expectSuccess(response);
      expect(data.success).toBe(true);
      expect(data.message).toBe("Pod claimed successfully");
      expect(data.frontend).toBe("https://frontend.example.com");
    });

    test("allows workspace member (developer) to claim pod", async () => {
      // Arrange
      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(memberDeveloper)
      );

      mockFetch.mockResolvedValue({
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
      });

      // Act
      const request = createPostRequest(
        `http://localhost/api/pool-manager/claim-pod/${workspace.id}`,
        {}
      );
      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      // Assert
      const data = await expectSuccess(response);
      expect(data.success).toBe(true);
    });

    test("allows workspace member (viewer) to claim pod", async () => {
      // Arrange
      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(memberViewer)
      );

      mockFetch.mockResolvedValue({
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
      });

      // Act
      const request = createPostRequest(
        `http://localhost/api/pool-manager/claim-pod/${workspace.id}`,
        {}
      );
      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      // Assert
      const data = await expectSuccess(response);
      expect(data.success).toBe(true);
    });

    test("returns 403 for non-member access (workspace isolation)", async () => {
      // Arrange
      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(nonMember)
      );

      // Act
      const request = createPostRequest(
        `http://localhost/api/pool-manager/claim-pod/${workspace.id}`,
        {}
      );
      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      // Assert
      const data = await response.json();
      expect(response.status).toBe(403);
      expect(data.error).toBe("Access denied");
    });
  });

  describe("Workspace Validation Tests", () => {
    test("returns 400 when workspaceId is missing", async () => {
      // Arrange
      const user = await createTestUser();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      // Act
      const request = createPostRequest(
        "http://localhost/api/pool-manager/claim-pod/",
        {}
      );
      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: "" }),
      });

      // Assert
      await expectError(response, "Missing required field: workspaceId", 400);
    });

    test("returns 404 for non-existent workspace", async () => {
      // Arrange
      const user = await createTestUser();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const nonExistentWorkspaceId = "non-existent-workspace-id";

      // Act
      const request = createPostRequest(
        `http://localhost/api/pool-manager/claim-pod/${nonExistentWorkspaceId}`,
        {}
      );
      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: nonExistentWorkspaceId }),
      });

      // Assert
      await expectNotFound(response, "Workspace not found");
    });

    test("returns 404 when workspace has no associated swarm", async () => {
      // Arrange
      const scenario = await createTestWorkspaceScenario({
        owner: { name: "No Swarm Owner" },
        withSwarm: false, // Explicitly no swarm
      });

      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(scenario.owner)
      );

      // Act
      const request = createPostRequest(
        `http://localhost/api/pool-manager/claim-pod/${scenario.workspace.id}`,
        {}
      );
      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: scenario.workspace.id }),
      });

      // Assert
      await expectNotFound(response, "No swarm found for this workspace");
    });
  });

  describe("Pool Configuration Validation Tests", () => {
    let owner: User;
    let workspace: Workspace;
    let swarm: Swarm;

    beforeEach(async () => {
      const scenario = await createTestWorkspaceScenario({
        owner: { name: "Pool Config Owner" },
        withSwarm: true,
        swarm: {
          name: `pool-config-swarm-${generateUniqueId("swarm")}`,
          status: "ACTIVE",
        },
      });

      owner = scenario.owner;
      workspace = scenario.workspace;
      swarm = scenario.swarm!;
    });

    test("returns 400 when swarm poolName is missing", async () => {
      // Arrange
      await db.swarm.update({
        where: { id: swarm.id },
        data: {
          poolName: null,
          poolApiKey: JSON.stringify({ data: "encrypted", iv: "test", tag: "test", version: "v1" }),
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      // Act
      const request = createPostRequest(
        `http://localhost/api/pool-manager/claim-pod/${workspace.id}`,
        {}
      );
      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      // Assert
      await expectError(
        response,
        "Swarm not properly configured with pool information",
        400
      );
    });

    test("returns 400 when swarm poolApiKey is missing (service fallback fails)", async () => {
      // Arrange
      await db.swarm.update({
        where: { id: swarm.id },
        data: {
          poolName: "test-pool",
          poolApiKey: null,
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      // Act
      const request = createPostRequest(
        `http://localhost/api/pool-manager/claim-pod/${workspace.id}`,
        {}
      );
      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      // Assert - The route returns 400 when pool configuration is missing after service call
      await expectError(
        response,
        "Swarm not properly configured with pool information", 
        400
      );
    });
  });

  describe("Port Mapping Logic Tests", () => {
    let owner: User;
    let workspace: Workspace;
    let swarm: Swarm;

    beforeEach(async () => {
      const scenario = await createTestWorkspaceScenario({
        owner: { name: "Port Mapping Owner" },
        withSwarm: true,
        swarm: {
          name: `port-mapping-swarm-${generateUniqueId("swarm")}`,
          status: "ACTIVE",
        },
      });

      owner = scenario.owner;
      workspace = scenario.workspace;
      swarm = scenario.swarm!;

      // Store encrypted poolApiKey for Port Mapping tests
      await db.swarm.update({
        where: { id: swarm.id },
        data: {
          poolApiKey: JSON.stringify({
            data: "mock-encrypted-data",
            iv: "mock-iv", 
            tag: "mock-tag",
            version: "v1", 
            encryptedAt: new Date().toISOString(),
          }),
          poolName: "test-pool",
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));
    });

    test("prioritizes port 3000 when multiple app ports exist", async () => {
      // Arrange
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          workspace: {
            portMappings: {
              "8080": "https://app1.example.com",
              "3000": "https://frontend.example.com",
              "4000": "https://app2.example.com",
              "15552": "https://internal1.example.com",
              "15553": "https://internal2.example.com",
            },
          },
        }),
      });

      // Act
      const request = createPostRequest(
        `http://localhost/api/pool-manager/claim-pod/${workspace.id}`,
        {}
      );
      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      // Assert
      const data = await expectSuccess(response);
      expect(data.frontend).toBe("https://frontend.example.com");
    });

    test("uses single app port when only one non-internal port exists", async () => {
      // Arrange
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          workspace: {
            portMappings: {
              "8080": "https://app.example.com",
              "15552": "https://internal1.example.com",
              "15553": "https://internal2.example.com",
            },
          },
        }),
      });

      // Act
      const request = createPostRequest(
        `http://localhost/api/pool-manager/claim-pod/${workspace.id}`,
        {}
      );
      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      // Assert
      const data = await expectSuccess(response);
      expect(data.frontend).toBe("https://app.example.com");
    });

    test("filters out internal ports 15552 and 15553", async () => {
      // Arrange
      mockFetch.mockResolvedValue({
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
          },
        }),
      });

      // Act
      const request = createPostRequest(
        `http://localhost/api/pool-manager/claim-pod/${workspace.id}`,
        {}
      );
      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      // Assert
      const data = await expectSuccess(response);
      expect(data.frontend).toBe("https://frontend.example.com");
      // Verify internal ports were not used
      expect(data.frontend).not.toContain("internal1");
      expect(data.frontend).not.toContain("internal2");
    });

    test("returns 500 when no frontend port mapping found (only internal ports)", async () => {
      // Arrange
      mockFetch.mockResolvedValue({
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
      });

      // Act
      const request = createPostRequest(
        `http://localhost/api/pool-manager/claim-pod/${workspace.id}`,
        {}
      );
      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      // Assert
      await expectError(response, "Failed to claim pod", 500);
    });

    test("returns 500 when multiple app ports exist but no port 3000", async () => {
      // Arrange - Multiple app ports but port 3000 doesn't exist
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          workspace: {
            portMappings: {
              "8080": "https://app1.example.com",
              "4000": "https://app2.example.com",
              "5000": "https://app3.example.com",
              "15552": "https://internal1.example.com",
            },
          },
        }),
      });

      // Act
      const request = createPostRequest(
        `http://localhost/api/pool-manager/claim-pod/${workspace.id}`,
        {}
      );
      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      // Assert
      await expectError(response, "Failed to claim pod", 500);
    });
  });

  describe("External API Integration Tests", () => {
    let owner: User;
    let workspace: Workspace;
    let swarm: Swarm;

    beforeEach(async () => {
      const scenario = await createTestWorkspaceScenario({
        owner: { name: "External API Owner" },
        withSwarm: true,
        swarm: {
          name: `external-api-swarm-${generateUniqueId("swarm")}`,
          status: "ACTIVE",
        },
      });

      owner = scenario.owner;
      workspace = scenario.workspace;
      swarm = scenario.swarm!;

      // Store encrypted poolApiKey for External API tests
      await db.swarm.update({
        where: { id: swarm.id },
        data: {
          poolApiKey: JSON.stringify({
            data: "mock-encrypted-data",
            iv: "mock-iv",
            tag: "mock-tag",
            version: "v1",
            encryptedAt: new Date().toISOString(),
          }),
          poolName: "test-pool",
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));
    });

    test("successfully claims pod from Pool Manager API", async () => {
      // Arrange
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          workspace: {
            id: "pod-123",
            fqdn: "workspace.example.com",
            state: "running",
            portMappings: {
              "3000": "https://frontend.example.com",
              "15552": "https://internal1.example.com",
            },
          },
        }),
      });

      // Act
      const request = createPostRequest(
        `http://localhost/api/pool-manager/claim-pod/${workspace.id}`,
        {}
      );
      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      // Assert
      const data = await expectSuccess(response);
      expect(data.success).toBe(true);
      expect(data.message).toBe("Pod claimed successfully");
      expect(data.frontend).toBe("https://frontend.example.com");

      // Verify fetch was called with correct parameters
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/pools/test-pool/workspace"),
        expect.objectContaining({
          method: "GET",
          headers: expect.objectContaining({
            Authorization: "Bearer decrypted-pool-api-key",
            "Content-Type": "application/json",
          }),
        })
      );
    });

    test("handles Pool Manager API error (non-200 status)", async () => {
      // Arrange
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => "Internal Server Error",
      });

      // Act
      const request = createPostRequest(
        `http://localhost/api/pool-manager/claim-pod/${workspace.id}`,
        {}
      );
      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      // Assert
      await expectError(response, "Failed to claim pod", 500);
    });

    test("handles Pool Manager API network error", async () => {
      // Arrange
      mockFetch.mockRejectedValue(new Error("Network timeout"));

      // Act
      const request = createPostRequest(
        `http://localhost/api/pool-manager/claim-pod/${workspace.id}`,
        {}
      );
      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      // Assert
      await expectError(response, "Failed to claim pod", 500);
    });

    test("handles Pool Manager API 404 error", async () => {
      // Arrange
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        text: async () => "Pool not found",
      });

      // Act
      const request = createPostRequest(
        `http://localhost/api/pool-manager/claim-pod/${workspace.id}`,
        {}
      );
      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      // Assert
      await expectError(response, "Failed to claim pod", 500);
    });

    test("handles Pool Manager API 401 unauthorized", async () => {
      // Arrange
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => "Unauthorized",
      });

      // Act
      const request = createPostRequest(
        `http://localhost/api/pool-manager/claim-pod/${workspace.id}`,
        {}
      );
      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      // Assert
      await expectError(response, "Failed to claim pod", 500);
    });

    test("calls Pool Manager API with correct authentication header", async () => {
      // Arrange
      mockFetch.mockResolvedValue({
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
      });

      // Act
      const request = createPostRequest(
        `http://localhost/api/pool-manager/claim-pod/${workspace.id}`,
        {}
      );
      await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      // Assert - Verify fetch was called with decrypted API key
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/pools/test-pool/workspace"),
        expect.objectContaining({
          method: "GET",
          headers: expect.objectContaining({
            Authorization: "Bearer decrypted-pool-api-key",
            "Content-Type": "application/json",
          }),
        })
      );
    });
  });

  describe("MOCK_BROWSER_URL Bypass Tests", () => {
    test("bypasses Pool Manager API when MOCK_BROWSER_URL is set", async () => {
      // Arrange
      process.env.MOCK_BROWSER_URL = "https://mock-browser.example.com";

      const scenario = await createTestWorkspaceScenario({
        owner: { name: "Mock Browser Owner" },
        withSwarm: true,
        swarm: {
          name: `mock-swarm-${generateUniqueId("swarm")}`,
          status: "ACTIVE",
        },
      });

      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(scenario.owner)
      );

      // Act
      const request = createPostRequest(
        `http://localhost/api/pool-manager/claim-pod/${scenario.workspace.id}`,
        {}
      );
      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: scenario.workspace.id }),
      });

      // Assert
      const data = await expectSuccess(response);
      expect(data.success).toBe(true);
      expect(data.message).toBe("Pod claimed successfully");
      expect(data.frontend).toBe("https://mock-browser.example.com");

      // Verify fetch was NOT called (bypassed)
      expect(mockFetch).not.toHaveBeenCalled();

      // Cleanup
      delete process.env.MOCK_BROWSER_URL;
    });
  });

  describe("Error Handling Tests", () => {
    test("handles malformed Pool Manager API response", async () => {
      // Arrange
      const scenario = await createTestWorkspaceScenario({
        owner: { name: "Malformed Response Owner" },
        withSwarm: true,
        swarm: {
          name: `malformed-swarm-${generateUniqueId("swarm")}`,
          status: "ACTIVE",
        },
      });

      await db.swarm.update({
        where: { id: scenario.swarm!.id },
        data: {
          poolApiKey: JSON.stringify({ data: "encrypted", iv: "test", tag: "test", version: "v1" }),
          poolName: "test-pool",
        },
      });

      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(scenario.owner)
      );

      // Mock malformed response (missing portMappings)
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          workspace: {
            id: "pod-123",
            state: "running",
            // Missing portMappings
          },
        }),
      });

      // Act
      const request = createPostRequest(
        `http://localhost/api/pool-manager/claim-pod/${scenario.workspace.id}`,
        {}
      );
      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: scenario.workspace.id }),
      });

      // Assert
      await expectError(response, "Failed to claim pod", 500);
    });

    test("handles ApiError with custom status propagation", async () => {
      // Arrange
      const scenario = await createTestWorkspaceScenario({
        owner: { name: "ApiError Owner" },
        withSwarm: true,
        swarm: {
          name: `api-error-swarm-${generateUniqueId("swarm")}`,
          status: "ACTIVE",
        },
      });

      await db.swarm.update({
        where: { id: scenario.swarm!.id },
        data: {
          poolApiKey: JSON.stringify({ data: "encrypted", iv: "test", tag: "test", version: "v1" }),
          poolName: "test-pool",
        },
      });

      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(scenario.owner)
      );

      // Mock error that looks like ApiError
      const apiError = {
        status: 503,
        message: "Service temporarily unavailable",
        service: "pool-manager",
        details: { reason: "maintenance" },
      };

      mockFetch.mockRejectedValue(apiError);

      // Act
      const request = createPostRequest(
        `http://localhost/api/pool-manager/claim-pod/${scenario.workspace.id}`,
        {}
      );
      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: scenario.workspace.id }),
      });

      // Assert
      const data = await response.json();
      expect(response.status).toBe(503);
      expect(data.error).toBe("Service temporarily unavailable");
      expect(data.service).toBe("pool-manager");
      expect(data.details).toEqual({ reason: "maintenance" });
    });
  });
});
