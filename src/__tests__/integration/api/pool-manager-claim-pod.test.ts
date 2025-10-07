import { describe, test, expect, beforeEach, vi } from "vitest";
import { POST } from "@/app/api/pool-manager/claim-pod/[workspaceId]/route";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import {
  createAuthenticatedSession,
  mockUnauthenticatedSession,
  getMockedSession,
  expectSuccess,
  expectError,
  expectUnauthorized,
  generateUniqueId,
} from "@/__tests__/support/helpers";
import {
  createTestWorkspaceScenario,
  type TestWorkspaceScenarioResult,
} from "@/__tests__/support/fixtures/workspace";

// Mock environment configuration
vi.mock("@/lib/env", () => ({
  config: {
    POOL_MANAGER_BASE_URL: "https://pool-manager.test",
  },
}));

// Mock encryption service - directly mock the decryptField method
vi.mock("@/lib/encryption", () => ({
  EncryptionService: {
    getInstance: vi.fn(() => ({
      decryptField: vi.fn((fieldType: string, encryptedValue: string) => {
        return "decrypted-pool-api-key";
      }),
      encryptField: vi.fn((fieldType: string, value: string) => {
        return { data: "encrypted-data" };
      }),
    })),
  },
}));

// Mock swarm secrets functions
vi.mock("@/services/swarm/secrets", () => ({
  getSwarmPoolApiKeyFor: vi.fn(),
  updateSwarmPoolApiKeyFor: vi.fn(),
}));

describe("POST /api/pool-manager/claim-pod/[workspaceId] - Integration Tests", () => {
  let mockFetch: ReturnType<typeof vi.spyOn>;
  let mockDecryptField: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch = vi.spyOn(globalThis as any, "fetch");
    
    // Get the mock instance to access the spy
    const mockInstance = EncryptionService.getInstance();
    mockDecryptField = mockInstance.decryptField;
  });

  describe("Authentication", () => {
    test("should return 401 when user is not authenticated", async () => {
      getMockedSession().mockResolvedValue(mockUnauthenticatedSession());

      const request = new Request(
        "http://localhost:3000/api/pool-manager/claim-pod/workspace-123",
        { method: "POST" }
      );

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: "workspace-123" }),
      });

      await expectUnauthorized(response);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    test("should return 401 when session exists but user is missing", async () => {
      getMockedSession().mockResolvedValue({
        expires: new Date().toISOString(),
      } as any);

      const request = new Request(
        "http://localhost:3000/api/pool-manager/claim-pod/workspace-123",
        { method: "POST" }
      );

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: "workspace-123" }),
      });

      await expectUnauthorized(response);
    });

    test("should return 401 when session.user.id is missing", async () => {
      getMockedSession().mockResolvedValue({
        user: { email: "test@example.com" },
        expires: new Date().toISOString(),
      } as any);

      const request = new Request(
        "http://localhost:3000/api/pool-manager/claim-pod/workspace-123",
        { method: "POST" }
      );

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: "workspace-123" }),
      });

      await expectUnauthorized(response);
    });
  });

  describe("Workspace Validation", () => {
    test("should return 404 when workspace does not exist", async () => {
      const { owner } = await createTestWorkspaceScenario();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const nonExistentWorkspaceId = generateUniqueId("nonexistent");

      const request = new Request(
        `http://localhost:3000/api/pool-manager/claim-pod/${nonExistentWorkspaceId}`,
        { method: "POST" }
      );

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: nonExistentWorkspaceId }),
      });

      await expectError(response, "Workspace not found", 404);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    test("should return 404 when workspace has no swarm", async () => {
      const { owner, workspace } = await createTestWorkspaceScenario({
        withSwarm: false,
      });
      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const request = new Request(
        `http://localhost:3000/api/pool-manager/claim-pod/${workspace.id}`,
        { method: "POST" }
      );

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      await expectError(response, "No swarm found for this workspace", 404);
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe("Authorization", () => {
    test("should return 403 when user is not workspace owner or member", async () => {
      const { workspace } = await createTestWorkspaceScenario({
        withSwarm: true,
      });

      // Create a different user not associated with the workspace
      const unauthorizedUser = await db.user.create({
        data: {
          id: generateUniqueId("unauthorized"),
          email: `unauthorized-${generateUniqueId()}@example.com`,
          name: "Unauthorized User",
        },
      });

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

      await expectError(response, "Access denied", 403);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    test("should allow workspace owner to claim pod", async () => {
      const encryptionService = EncryptionService.getInstance();
      const { owner, workspace } = await createTestWorkspaceScenario({
        withSwarm: true,
        swarm: {
          poolName: "test-pool",
        },
      });

      // Update swarm with encrypted poolApiKey
      const encryptedApiKey = JSON.stringify(
        encryptionService.encryptField("poolApiKey", "test-pool-key")
      );

      await db.swarm.update({
        where: { workspaceId: workspace.id },
        data: { poolApiKey: encryptedApiKey },
      });

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
            fqdn: "test.example.com",
            state: "running",
          },
        }),
      } as any);

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

    test("should allow workspace member to claim pod", async () => {
      const encryptionService = EncryptionService.getInstance();
      const { members, workspace } = await createTestWorkspaceScenario({
        memberCount: 1,
        withSwarm: true,
        swarm: {
          poolName: "test-pool",
        },
      });

      // Update swarm with encrypted poolApiKey
      const encryptedApiKey = JSON.stringify(
        encryptionService.encryptField("poolApiKey", "test-pool-key")
      );

      await db.swarm.update({
        where: { workspaceId: workspace.id },
        data: { poolApiKey: encryptedApiKey },
      });

      const member = members[0];
      getMockedSession().mockResolvedValue(createAuthenticatedSession(member));

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          workspace: {
            portMappings: {
              "3000": "https://frontend.example.com",
            },
            fqdn: "test.example.com",
            state: "running",
          },
        }),
      } as any);

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
  });

  describe("Swarm Configuration Validation", () => {
    test("should return 400 when poolName is missing", async () => {
      const encryptionService = EncryptionService.getInstance();
      const { owner, workspace } = await createTestWorkspaceScenario({
        withSwarm: true,
      });

      // Update swarm with poolApiKey but no poolName
      const encryptedApiKey = JSON.stringify(
        encryptionService.encryptField("poolApiKey", "test-pool-key")
      );

      await db.swarm.update({
        where: { workspaceId: workspace.id },
        data: {
          poolName: null,
          poolApiKey: encryptedApiKey,
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

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
      expect(mockFetch).not.toHaveBeenCalled();
    });

    test("should return 400 when poolApiKey is missing", async () => {
      const { owner, workspace } = await createTestWorkspaceScenario({
        withSwarm: true,
        swarm: {
          poolName: "test-pool",
        },
      });

      // Ensure poolApiKey is null
      await db.swarm.update({
        where: { workspaceId: workspace.id },
        data: { poolApiKey: null },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

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
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe("Resource Allocation - Port Mapping Logic", () => {
    test("should return frontend URL from port 3000 mapping", async () => {
      const encryptionService = EncryptionService.getInstance();
      const { owner, workspace } = await createTestWorkspaceScenario({
        withSwarm: true,
        swarm: {
          poolName: "test-pool",
        },
      });

      const encryptedApiKey = JSON.stringify(
        encryptionService.encryptField("poolApiKey", "test-pool-key")
      );

      await db.swarm.update({
        where: { workspaceId: workspace.id },
        data: { poolApiKey: encryptedApiKey },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          workspace: {
            portMappings: {
              "3000": "https://frontend.example.com",
              "8080": "https://api.example.com",
              "15552": "https://internal1.example.com",
              "15553": "https://internal2.example.com",
            },
            fqdn: "test.example.com",
            state: "running",
          },
        }),
      } as any);

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

    test("should return single app URL when only one non-internal port exists", async () => {
      const encryptionService = EncryptionService.getInstance();
      const { owner, workspace } = await createTestWorkspaceScenario({
        withSwarm: true,
        swarm: {
          poolName: "test-pool",
        },
      });

      const encryptedApiKey = JSON.stringify(
        encryptionService.encryptField("poolApiKey", "test-pool-key")
      );

      await db.swarm.update({
        where: { workspaceId: workspace.id },
        data: { poolApiKey: encryptedApiKey },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          workspace: {
            portMappings: {
              "8080": "https://single-app.example.com",
              "15552": "https://internal1.example.com",
              "15553": "https://internal2.example.com",
            },
            fqdn: "test.example.com",
            state: "running",
          },
        }),
      } as any);

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

    test("should return 500 when no frontend port mapping found", async () => {
      const encryptionService = EncryptionService.getInstance();
      const { owner, workspace } = await createTestWorkspaceScenario({
        withSwarm: true,
        swarm: {
          poolName: "test-pool",
        },
      });

      const encryptedApiKey = JSON.stringify(
        encryptionService.encryptField("poolApiKey", "test-pool-key")
      );

      await db.swarm.update({
        where: { workspaceId: workspace.id },
        data: { poolApiKey: encryptedApiKey },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

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
            fqdn: "test.example.com",
            state: "running",
          },
        }),
      } as any);

      const request = new Request(
        `http://localhost:3000/api/pool-manager/claim-pod/${workspace.id}`,
        { method: "POST" }
      );

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      await expectError(response, "Failed to claim pod", 500);
    });

    test("should correctly filter out internal ports 15552 and 15553", async () => {
      const encryptionService = EncryptionService.getInstance();
      const { owner, workspace } = await createTestWorkspaceScenario({
        withSwarm: true,
        swarm: {
          poolName: "test-pool",
        },
      });

      const encryptedApiKey = JSON.stringify(
        encryptionService.encryptField("poolApiKey", "test-pool-key")
      );

      await db.swarm.update({
        where: { workspaceId: workspace.id },
        data: { poolApiKey: encryptedApiKey },
      });

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
            fqdn: "test.example.com",
            state: "running",
          },
        }),
      } as any);

      const request = new Request(
        `http://localhost:3000/api/pool-manager/claim-pod/${workspace.id}`,
        { method: "POST" }
      );

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      const data = await expectSuccess(response);
      // Should return port 3000 URL, not internal ports
      expect(data.frontend).toBe("https://frontend.example.com");
      expect(data.frontend).not.toContain("internal1");
      expect(data.frontend).not.toContain("internal2");
    });
  });

  describe("Pool Manager API Integration", () => {
    test("should call Pool Manager API with correct parameters", async () => {
      const encryptionService = EncryptionService.getInstance();
      const { owner, workspace } = await createTestWorkspaceScenario({
        withSwarm: true,
        swarm: {
          poolName: "test-pool",
        },
      });

      const encryptedApiKey = JSON.stringify(
        encryptionService.encryptField("poolApiKey", "test-pool-key")
      );

      await db.swarm.update({
        where: { workspaceId: workspace.id },
        data: { poolApiKey: encryptedApiKey },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          workspace: {
            portMappings: {
              "3000": "https://frontend.example.com",
            },
            fqdn: "test.example.com",
            state: "running",
          },
        }),
      } as any);

      const request = new Request(
        `http://localhost:3000/api/pool-manager/claim-pod/${workspace.id}`,
        { method: "POST" }
      );

      await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "https://pool-manager.test/pools/test-pool/workspace",
        expect.objectContaining({
          method: "GET",
          headers: expect.objectContaining({
            Authorization: "Bearer decrypted-pool-api-key",
            "Content-Type": "application/json",
          }),
        })
      );
    });

    test("should return 400 when Pool Manager API returns non-200 status", async () => {
      const encryptionService = EncryptionService.getInstance();
      const { owner, workspace } = await createTestWorkspaceScenario({
        withSwarm: true,
        swarm: {
          poolName: "test-pool",
        },
      });

      const encryptedApiKey = JSON.stringify(
        encryptionService.encryptField("poolApiKey", "test-pool-key")
      );

      await db.swarm.update({
        where: { workspaceId: workspace.id },
        data: { poolApiKey: encryptedApiKey },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => "Internal Server Error",
      } as any);

      const request = new Request(
        `http://localhost:3000/api/pool-manager/claim-pod/${workspace.id}`,
        { method: "POST" }
      );

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      await expectError(response, "Failed to claim pod", 500);
    });

    test("should return 400 when Pool Manager API throws network error", async () => {
      const encryptionService = EncryptionService.getInstance();
      const { owner, workspace } = await createTestWorkspaceScenario({
        withSwarm: true,
        swarm: {
          poolName: "test-pool",
        },
      });

      const encryptedApiKey = JSON.stringify(
        encryptionService.encryptField("poolApiKey", "test-pool-key")
      );

      await db.swarm.update({
        where: { workspaceId: workspace.id },
        data: { poolApiKey: encryptedApiKey },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      mockFetch.mockRejectedValue(new Error("Network error"));

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

  describe("Encryption", () => {
    test("should decrypt poolApiKey before making API call", async () => {
      const encryptionService = EncryptionService.getInstance();
      const { owner, workspace } = await createTestWorkspaceScenario({
        withSwarm: true,
        swarm: {
          poolName: "test-pool",
        },
      });

      const encryptedApiKey = JSON.stringify(
        encryptionService.encryptField("poolApiKey", "test-pool-key")
      );

      await db.swarm.update({
        where: { workspaceId: workspace.id },
        data: { poolApiKey: encryptedApiKey },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          workspace: {
            portMappings: {
              "3000": "https://frontend.example.com",
            },
            fqdn: "test.example.com",
            state: "running",
          },
        }),
      } as any);

      const request = new Request(
        `http://localhost:3000/api/pool-manager/claim-pod/${workspace.id}`,
        { method: "POST" }
      );

      await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      expect(mockDecryptField).toHaveBeenCalledWith(
        "poolApiKey",
        expect.any(String)
      );
    });

    test("should not expose encrypted key in response", async () => {
      const encryptionService = EncryptionService.getInstance();
      const { owner, workspace } = await createTestWorkspaceScenario({
        withSwarm: true,
        swarm: {
          poolName: "test-pool",
        },
      });

      const encryptedApiKey = JSON.stringify(
        encryptionService.encryptField("poolApiKey", "test-pool-key")
      );

      await db.swarm.update({
        where: { workspaceId: workspace.id },
        data: { poolApiKey: encryptedApiKey },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          workspace: {
            portMappings: {
              "3000": "https://frontend.example.com",
            },
            fqdn: "test.example.com",
            state: "running",
          },
        }),
      } as any);

      const request = new Request(
        `http://localhost:3000/api/pool-manager/claim-pod/${workspace.id}`,
        { method: "POST" }
      );

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      const responseText = await response.text();
      expect(responseText).not.toContain("decrypted-pool-api-key");
      expect(responseText).not.toContain("test-pool-key");
    });
  });

  describe("Edge Cases", () => {
    test("should handle workspace with multiple app ports and prioritize port 3000", async () => {
      const encryptionService = EncryptionService.getInstance();
      const { owner, workspace } = await createTestWorkspaceScenario({
        withSwarm: true,
        swarm: {
          poolName: "test-pool",
        },
      });

      const encryptedApiKey = JSON.stringify(
        encryptionService.encryptField("poolApiKey", "test-pool-key")
      );

      await db.swarm.update({
        where: { workspaceId: workspace.id },
        data: { poolApiKey: encryptedApiKey },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          workspace: {
            portMappings: {
              "8000": "https://app1.example.com",
              "3000": "https://main-app.example.com",
              "9000": "https://app2.example.com",
              "15552": "https://internal1.example.com",
              "15553": "https://internal2.example.com",
            },
            fqdn: "test.example.com",
            state: "running",
          },
        }),
      } as any);

      const request = new Request(
        `http://localhost:3000/api/pool-manager/claim-pod/${workspace.id}`,
        { method: "POST" }
      );

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      const data = await expectSuccess(response);
      expect(data.frontend).toBe("https://main-app.example.com");
    });

    test("should handle empty port mappings response", async () => {
      const encryptionService = EncryptionService.getInstance();
      const { owner, workspace } = await createTestWorkspaceScenario({
        withSwarm: true,
        swarm: {
          poolName: "test-pool",
        },
      });

      const encryptedApiKey = JSON.stringify(
        encryptionService.encryptField("poolApiKey", "test-pool-key")
      );

      await db.swarm.update({
        where: { workspaceId: workspace.id },
        data: { poolApiKey: encryptedApiKey },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          workspace: {
            portMappings: {},
            fqdn: "test.example.com",
            state: "running",
          },
        }),
      } as any);

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