import { describe, test, expect, beforeEach, vi, afterEach } from "vitest";
import { POST } from "@/app/api/pool-manager/claim-pod/[workspaceId]/route";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { config } from "@/lib/env";
import type { User, Workspace, Swarm } from "@prisma/client";
import {
  createAuthenticatedSession,
  mockUnauthenticatedSession,
  getMockedSession,
  expectSuccess,
  expectUnauthorized,
  expectError,
  createPostRequest,
  generateUniqueId,
} from "@/__tests__/support/helpers";
import { createTestWorkspaceScenario } from "@/__tests__/support/fixtures/workspace";

// Mock the swarm secrets service
vi.mock("@/services/swarm/secrets", () => ({
  getSwarmPoolApiKeyFor: vi.fn().mockResolvedValue("mock-pool-api-key"),
  updateSwarmPoolApiKeyFor: vi.fn(),
}));

describe("POST /api/pool-manager/claim-pod/[workspaceId] - Integration Tests", () => {
  let ownerUser: User;
  let memberUser: User;
  let nonMemberUser: User;
  let workspace: Workspace;
  let swarm: Swarm;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Setup encryption environment
    process.env.TOKEN_ENCRYPTION_KEY =
      process.env.TOKEN_ENCRYPTION_KEY ||
      "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";
    process.env.TOKEN_ENCRYPTION_KEY_ID = "test-key-id";

    // Create test workspace with swarm
    const scenario = await createTestWorkspaceScenario({
      owner: { name: "Owner User" },
      members: [{ role: "DEVELOPER", user: { name: "Member User" } }],
      withSwarm: true,
      swarm: {
        name: "test-swarm",
        status: "ACTIVE",
      },
    });

    ownerUser = scenario.owner;
    workspace = scenario.workspace;
    memberUser = scenario.members[0];
    swarm = scenario.swarm!;

    // Create non-member user
    nonMemberUser = await db.user.create({
      data: {
        id: generateUniqueId("user"),
        email: `non-member-${generateUniqueId()}@example.com`,
        name: "Non Member User",
      },
    });

    // Configure swarm with pool settings
    const encryptedApiKey = EncryptionService.getInstance().encryptField(
      "poolApiKey",
      "test-pool-api-key"
    );

    await db.swarm.update({
      where: { id: swarm.id },
      data: {
        poolName: "test-pool",
        poolApiKey: JSON.stringify(encryptedApiKey),
      },
    });

    // Refresh swarm reference
    swarm = (await db.swarm.findUnique({ where: { id: swarm.id } }))!;

    // Setup fetch mock
    mockFetch = vi.spyOn(globalThis, "fetch") as ReturnType<typeof vi.fn>;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Authentication Tests", () => {
    test("should return 401 for unauthenticated requests", async () => {
      getMockedSession().mockResolvedValue(mockUnauthenticatedSession());

      const request = createPostRequest(
        `http://localhost:3000/api/pool-manager/claim-pod/${workspace.id}`,
        {}
      );

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      await expectUnauthorized(response);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    test("should return 401 for invalid user session (missing userId)", async () => {
      getMockedSession().mockResolvedValue({
        user: {}, // Missing id field
        expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      });

      const request = createPostRequest(
        `http://localhost:3000/api/pool-manager/claim-pod/${workspace.id}`,
        {}
      );

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      await expectError(response, "Invalid user session", 401);
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe("Authorization Tests", () => {
    test("should allow workspace owner to claim pod", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(ownerUser));

      mockFetch.mockResolvedValue(
        new Response(
          JSON.stringify({
            success: true,
            workspace: {
              portMappings: {
                "3000": "https://frontend.example.com",
                "15552": "https://internal1.example.com",
                "15553": "https://internal2.example.com",
              },
              fqdn: "test.example.com",
              state: "running",
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );

      const request = createPostRequest(
        `http://localhost:3000/api/pool-manager/claim-pod/${workspace.id}`,
        {}
      );

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      const data = await expectSuccess(response, 200);
      expect(data.success).toBe(true);
      expect(data.message).toBe("Pod claimed successfully");
      expect(data.frontend).toBe("https://frontend.example.com");
    });

    test("should allow workspace member to claim pod", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(memberUser));

      mockFetch.mockResolvedValue(
        new Response(
          JSON.stringify({
            success: true,
            workspace: {
              portMappings: {
                "3000": "https://frontend.example.com",
              },
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );

      const request = createPostRequest(
        `http://localhost:3000/api/pool-manager/claim-pod/${workspace.id}`,
        {}
      );

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      const data = await expectSuccess(response, 200);
      expect(data.success).toBe(true);
      expect(data.frontend).toBe("https://frontend.example.com");
    });

    test("should return 403 for non-member user", async () => {
      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(nonMemberUser)
      );

      const request = createPostRequest(
        `http://localhost:3000/api/pool-manager/claim-pod/${workspace.id}`,
        {}
      );

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      await expectError(response, "Access denied", 403);
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe("Validation Tests", () => {
    test("should return 400 when workspaceId is missing", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(ownerUser));

      const request = createPostRequest(
        "http://localhost:3000/api/pool-manager/claim-pod/",
        {}
      );

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: "" }),
      });

      await expectError(response, "Missing required field: workspaceId", 400);
    });

    test("should return 404 when workspace not found", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(ownerUser));

      const request = createPostRequest(
        "http://localhost:3000/api/pool-manager/claim-pod/non-existent-id",
        {}
      );

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: "non-existent-id" }),
      });

      await expectError(response, "Workspace not found", 404);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    test("should return 403 when user is not a member of workspace without swarm", async () => {
      // User needs to be a non-member to test the access check before swarm check
      getMockedSession().mockResolvedValue(createAuthenticatedSession(nonMemberUser));

      // Create workspace without swarm
      const noSwarmScenario = await createTestWorkspaceScenario({
        owner: { name: "No Swarm Owner" },
        withSwarm: false,
      });

      const request = createPostRequest(
        `http://localhost:3000/api/pool-manager/claim-pod/${noSwarmScenario.workspace.id}`,
        {}
      );

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: noSwarmScenario.workspace.id }),
      });

      await expectError(response, "Access denied", 403);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    test("should return 404 when workspace has no swarm (authorized user)", async () => {
      // Create workspace without swarm and use the owner to bypass access check
      const noSwarmScenario = await createTestWorkspaceScenario({
        owner: { name: "No Swarm Owner" },
        withSwarm: false,
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(noSwarmScenario.owner));

      const request = createPostRequest(
        `http://localhost:3000/api/pool-manager/claim-pod/${noSwarmScenario.workspace.id}`,
        {}
      );

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: noSwarmScenario.workspace.id }),
      });

      await expectError(response, "No swarm found for this workspace", 404);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    test("should return 400 when poolName is missing", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(ownerUser));

      // Update swarm to remove poolName
      await db.swarm.update({
        where: { id: swarm.id },
        data: { poolName: null },
      });

      const request = createPostRequest(
        `http://localhost:3000/api/pool-manager/claim-pod/${workspace.id}`,
        {}
      );

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      await expectError(
        response,
        "Swarm not properly configured with pool information",
        400
      );
      expect(mockFetch).not.toHaveBeenCalled();
    });

    test("should return 400 when poolApiKey is missing", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(ownerUser));

      // Update swarm to remove poolApiKey
      await db.swarm.update({
        where: { id: swarm.id },
        data: { poolApiKey: null },
      });

      const request = createPostRequest(
        `http://localhost:3000/api/pool-manager/claim-pod/${workspace.id}`,
        {}
      );

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      await expectError(
        response,
        "Swarm not properly configured with pool information",
        400
      );
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe("Resource Allocation Tests", () => {
    test("should return frontend URL from port 3000 mapping", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(ownerUser));

      mockFetch.mockResolvedValue(
        new Response(
          JSON.stringify({
            success: true,
            workspace: {
              portMappings: {
                "3000": "https://frontend.example.com",
                "8080": "https://backend.example.com",
                "15552": "https://internal1.example.com",
                "15553": "https://internal2.example.com",
              },
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );

      const request = createPostRequest(
        `http://localhost:3000/api/pool-manager/claim-pod/${workspace.id}`,
        {}
      );

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      const data = await expectSuccess(response, 200);
      expect(data.frontend).toBe("https://frontend.example.com");
    });

    test("should return single app URL when only one non-internal port exists", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(ownerUser));

      mockFetch.mockResolvedValue(
        new Response(
          JSON.stringify({
            success: true,
            workspace: {
              portMappings: {
                "8080": "https://single-app.example.com",
                "15552": "https://internal1.example.com",
                "15553": "https://internal2.example.com",
              },
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );

      const request = createPostRequest(
        `http://localhost:3000/api/pool-manager/claim-pod/${workspace.id}`,
        {}
      );

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      const data = await expectSuccess(response, 200);
      expect(data.frontend).toBe("https://single-app.example.com");
    });

    test("should filter out internal ports correctly", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(ownerUser));

      mockFetch.mockResolvedValue(
        new Response(
          JSON.stringify({
            success: true,
            workspace: {
              portMappings: {
                "3000": "https://frontend.example.com",
                "15552": "https://should-be-filtered.example.com",
                "15553": "https://should-also-be-filtered.example.com",
              },
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );

      const request = createPostRequest(
        `http://localhost:3000/api/pool-manager/claim-pod/${workspace.id}`,
        {}
      );

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      const data = await expectSuccess(response, 200);
      expect(data.frontend).toBe("https://frontend.example.com");
      expect(data.frontend).not.toContain("should-be-filtered");
    });

    test("should return 500 when no frontend port mapping found", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(ownerUser));

      mockFetch.mockResolvedValue(
        new Response(
          JSON.stringify({
            success: true,
            workspace: {
              portMappings: {
                "15552": "https://internal1.example.com",
                "15553": "https://internal2.example.com",
              },
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );

      const request = createPostRequest(
        `http://localhost:3000/api/pool-manager/claim-pod/${workspace.id}`,
        {}
      );

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      await expectError(response, "Failed to claim pod", 500);
    });

    test("should return 500 when multiple app ports without port 3000 (no default frontend)", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(ownerUser));

      mockFetch.mockResolvedValue(
        new Response(
          JSON.stringify({
            success: true,
            workspace: {
              portMappings: {
                "8080": "https://backend.example.com",
                "9000": "https://admin.example.com",
                "15552": "https://internal1.example.com",
              },
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );

      const request = createPostRequest(
        `http://localhost:3000/api/pool-manager/claim-pod/${workspace.id}`,
        {}
      );

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      // Should return 500 since no port 3000 and multiple app ports (empty frontend string)
      await expectError(response, "Failed to claim pod", 500);
    });
  });

  describe("Pool Manager API Integration Tests", () => {
    test("should call Pool Manager API with correct parameters", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(ownerUser));

      mockFetch.mockResolvedValue(
        new Response(
          JSON.stringify({
            success: true,
            workspace: {
              portMappings: {
                "3000": "https://frontend.example.com",
              },
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );

      const request = createPostRequest(
        `http://localhost:3000/api/pool-manager/claim-pod/${workspace.id}`,
        {}
      );

      await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      expect(mockFetch).toHaveBeenCalledWith(
        `${config.POOL_MANAGER_BASE_URL}/pools/test-pool/workspace`,
        expect.objectContaining({
          method: "GET",
          headers: expect.objectContaining({
            Authorization: "Bearer test-pool-api-key",
            "Content-Type": "application/json",
          }),
        })
      );
    });

    test("should decrypt poolApiKey before API call", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(ownerUser));

      mockFetch.mockResolvedValue(
        new Response(
          JSON.stringify({
            success: true,
            workspace: {
              portMappings: {
                "3000": "https://frontend.example.com",
              },
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );

      const request = createPostRequest(
        `http://localhost:3000/api/pool-manager/claim-pod/${workspace.id}`,
        {}
      );

      await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      // Verify decrypted key is used (not encrypted JSON)
      const [, requestOptions] = mockFetch.mock.calls[0];
      const headers = requestOptions.headers as Record<string, string>;
      expect(headers.Authorization).toBe("Bearer test-pool-api-key");
      expect(headers.Authorization).not.toContain("data");
      expect(headers.Authorization).not.toContain("iv");
    });

    test("should handle Pool Manager API errors (500)", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(ownerUser));

      mockFetch.mockResolvedValue(
        new Response("Internal Server Error", {
          status: 500,
          statusText: "Internal Server Error",
        })
      );

      const request = createPostRequest(
        `http://localhost:3000/api/pool-manager/claim-pod/${workspace.id}`,
        {}
      );

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      await expectError(response, "Failed to claim pod", 500);
    });

    test("should handle Pool Manager API errors (401)", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(ownerUser));

      mockFetch.mockResolvedValue(
        new Response("Unauthorized", {
          status: 401,
          statusText: "Unauthorized",
        })
      );

      const request = createPostRequest(
        `http://localhost:3000/api/pool-manager/claim-pod/${workspace.id}`,
        {}
      );

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      await expectError(response, "Failed to claim pod", 500);
    });

    test("should handle network failures gracefully", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(ownerUser));

      mockFetch.mockRejectedValue(new Error("Network error: Connection timeout"));

      const request = createPostRequest(
        `http://localhost:3000/api/pool-manager/claim-pod/${workspace.id}`,
        {}
      );

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      await expectError(response, "Failed to claim pod", 500);
    });
  });

  describe("Mock Mode Tests", () => {
    test("should return mock URL when MOCK_BROWSER_URL is set", async () => {
      process.env.MOCK_BROWSER_URL = "https://mock-frontend.example.com";

      getMockedSession().mockResolvedValue(createAuthenticatedSession(ownerUser));

      const request = createPostRequest(
        `http://localhost:3000/api/pool-manager/claim-pod/${workspace.id}`,
        {}
      );

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      const data = await expectSuccess(response, 200);
      expect(data.success).toBe(true);
      expect(data.frontend).toBe("https://mock-frontend.example.com");
      expect(mockFetch).not.toHaveBeenCalled();

      // Cleanup
      delete process.env.MOCK_BROWSER_URL;
    });
  });
});