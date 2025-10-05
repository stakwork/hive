import { describe, test, expect, vi, beforeEach, Mock } from "vitest";
import { POST } from "@/app/api/pool-manager/claim-pod/[workspaceId]/route";
import {
  createTestWorkspaceScenario,
  createTestUser,
} from "@/__tests__/support/fixtures";
import {
  getMockedSession,
  createAuthenticatedSession,
  mockUnauthenticatedSession,
} from "@/__tests__/support/helpers/auth";
import {
  expectSuccess,
  expectError,
  expectUnauthorized,
} from "@/__tests__/support/helpers/api-assertions";
import { EncryptionService } from "@/lib/encryption";
import { config } from "@/lib/env";

// Mock external dependencies
vi.mock("@/lib/env", () => ({
  config: {
    POOL_MANAGER_BASE_URL: "https://pool-manager.test.com",
  },
}));

vi.mock("@/lib/encryption", () => ({
  EncryptionService: {
    getInstance: vi.fn(),
  },
}));

vi.mock("@/services/swarm/secrets", () => ({
  getSwarmPoolApiKeyFor: vi.fn(),
  updateSwarmPoolApiKeyFor: vi.fn(),
}));

// Mock global fetch
global.fetch = vi.fn();

const mockEncryptionService = {
  encryptField: vi.fn(),
  decryptField: vi.fn(),
};

describe("/api/pool-manager/claim-pod/[workspaceId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetAllMocks();

    // Setup EncryptionService mock
    (EncryptionService.getInstance as Mock).mockReturnValue(
      mockEncryptionService
    );

    // Default mock for decryptField to return plain API key
    mockEncryptionService.decryptField.mockReturnValue(
      "decrypted-pool-api-key"
    );
  });

  describe("Authentication & Authorization", () => {
    test("returns 401 when no session exists", async () => {
      mockUnauthenticatedSession();

      const request = new Request("http://localhost:3000/api/test", {
        method: "POST",
      });

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: "workspace-123" }),
      });

      expectUnauthorized(response);
    });

    test("returns 401 when session has no user ID", async () => {
      getMockedSession().mockResolvedValue({
        user: { id: undefined },
        expires: new Date(Date.now() + 86400000).toISOString(),
      });

      const request = new Request("http://localhost:3000/api/test", {
        method: "POST",
      });

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: "workspace-123" }),
      });

      expectError(response, "Invalid user session", 401);
    });

    test("returns 404 when workspace does not exist", async () => {
      const { user } = await createTestUser({
        withGitHubAuth: true,
        githubUsername: "testuser",
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = new Request("http://localhost:3000/api/test", {
        method: "POST",
      });

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: "non-existent-workspace" }),
      });

      expectError(response, "Workspace not found", 404);
    });

    test("returns 403 when user is not workspace owner or member", async () => {
      // Create workspace owner
      const { workspace } = await createTestWorkspaceScenario({
        withSwarm: true,
        swarm: {
          poolName: "test-pool",
          poolApiKey: JSON.stringify({ data: "encrypted-key" }),
        },
      });

      // Create different user who is not a member
      const { user: unauthorizedUser } = await createTestUser({
        withGitHubAuth: true,
        githubUsername: "unauthorized-user",
      });

      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(unauthorizedUser)
      );

      const request = new Request("http://localhost:3000/api/test", {
        method: "POST",
      });

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      expectError(response, "Access denied", 403);
    });

    test("allows workspace owner to claim pod", async () => {
      const { workspace, owner } = await createTestWorkspaceScenario({
        withSwarm: true,
        swarm: {
          poolName: "test-pool",
          poolApiKey: JSON.stringify({ data: "encrypted-key" }),
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      // Mock successful Pool Manager API response
      const mockFetch = global.fetch as Mock;
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
            state: "running",
            fqdn: "pod.example.com",
          },
        }),
      } as Response);

      const request = new Request("http://localhost:3000/api/test", {
        method: "POST",
      });

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      expectSuccess(response);
    });

    test("allows workspace member to claim pod", async () => {
      const { user: member } = await createTestUser({
        withGitHubAuth: true,
        githubUsername: "member-user",
      });

      const { workspace } = await createTestWorkspaceScenario({
        withSwarm: true,
        swarm: {
          poolName: "test-pool",
          poolApiKey: JSON.stringify({ data: "encrypted-key" }),
        },
        members: [{ userId: member.id, role: "DEVELOPER" }],
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(member));

      // Mock successful Pool Manager API response
      const mockFetch = global.fetch as Mock;
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
            state: "running",
            fqdn: "pod.example.com",
          },
        }),
      } as Response);

      const request = new Request("http://localhost:3000/api/test", {
        method: "POST",
      });

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      expectSuccess(response);
    });
  });

  describe("Swarm & Pool Configuration Validation", () => {
    test("returns 404 when workspace has no swarm", async () => {
      const { workspace, owner } = await createTestWorkspaceScenario({
        withSwarm: false,
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const request = new Request("http://localhost:3000/api/test", {
        method: "POST",
      });

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      expectError(response, "No swarm found for this workspace", 404);
    });

    test("returns 400 when swarm is missing poolName", async () => {
      const { workspace, owner } = await createTestWorkspaceScenario({
        withSwarm: true,
        swarm: {
          poolName: null,
          poolApiKey: JSON.stringify({ data: "encrypted-key" }),
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const request = new Request("http://localhost:3000/api/test", {
        method: "POST",
      });

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      expectError(
        response,
        400,
        "Swarm not properly configured with pool information"
      );
    });

    test("returns 400 when swarm is missing poolApiKey", async () => {
      const { getSwarmPoolApiKeyFor } = await import(
        "@/services/swarm/secrets"
      );
      (getSwarmPoolApiKeyFor as Mock).mockResolvedValue(null);

      const { workspace, owner } = await createTestWorkspaceScenario({
        withSwarm: true,
        swarm: {
          poolName: "test-pool",
          poolApiKey: null,
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const request = new Request("http://localhost:3000/api/test", {
        method: "POST",
      });

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      expectError(
        response,
        400,
        "Swarm not properly configured with pool information"
      );
    });
  });

  describe("Pool Manager API Integration", () => {
    test("successfully claims pod with valid Pool Manager response", async () => {
      const { workspace, owner } = await createTestWorkspaceScenario({
        withSwarm: true,
        swarm: {
          poolName: "test-pool",
          poolApiKey: JSON.stringify({ data: "encrypted-key" }),
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      // Mock successful Pool Manager API response
      const mockFetch = global.fetch as Mock;
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
            state: "running",
            fqdn: "pod.example.com",
          },
        }),
      } as Response);

      const request = new Request("http://localhost:3000/api/test", {
        method: "POST",
      });

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      // Verify Pool Manager API was called with correct parameters
      expect(mockFetch).toHaveBeenCalledWith(
        `${config.POOL_MANAGER_BASE_URL}/pools/test-pool/workspace`,
        expect.objectContaining({
          method: "GET",
          headers: expect.objectContaining({
            Authorization: "Bearer decrypted-pool-api-key",
            "Content-Type": "application/json",
          }),
        })
      );

      // Verify successful response
      expectSuccess(response);
      const data = await response.json();
      expect(data).toMatchObject({
        success: true,
        message: "Pod claimed successfully",
        frontend: "https://frontend.example.com",
      });
    });

    test("returns 500 when Pool Manager API returns error status", async () => {
      const { workspace, owner } = await createTestWorkspaceScenario({
        withSwarm: true,
        swarm: {
          poolName: "test-pool",
          poolApiKey: JSON.stringify({ data: "encrypted-key" }),
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      // Mock Pool Manager API error response
      const mockFetch = global.fetch as Mock;
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => "Internal Server Error",
      } as Response);

      const request = new Request("http://localhost:3000/api/test", {
        method: "POST",
      });

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      expectError(response, "Failed to claim pod", 500);
    });

    test("returns 500 when Pool Manager API network failure occurs", async () => {
      const { workspace, owner } = await createTestWorkspaceScenario({
        withSwarm: true,
        swarm: {
          poolName: "test-pool",
          poolApiKey: JSON.stringify({ data: "encrypted-key" }),
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      // Mock network failure
      const mockFetch = global.fetch as Mock;
      mockFetch.mockRejectedValue(new Error("Network request failed"));

      const request = new Request("http://localhost:3000/api/test", {
        method: "POST",
      });

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      expectError(response, "Failed to claim pod", 500);
    });

    test("decrypts poolApiKey before calling Pool Manager API", async () => {
      const { workspace, owner } = await createTestWorkspaceScenario({
        withSwarm: true,
        swarm: {
          poolName: "test-pool",
          poolApiKey: JSON.stringify({
            data: "encrypted-data",
            iv: "initialization-vector",
            tag: "auth-tag",
          }),
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      // Mock Pool Manager API response
      const mockFetch = global.fetch as Mock;
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          workspace: {
            portMappings: {
              "3000": "https://frontend.example.com",
            },
            state: "running",
          },
        }),
      } as Response);

      const request = new Request("http://localhost:3000/api/test", {
        method: "POST",
      });

      await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      // Verify decryptField was called with correct parameters
      expect(mockEncryptionService.decryptField).toHaveBeenCalledWith(
        "poolApiKey",
        expect.stringContaining("encrypted-data")
      );
    });
  });

  describe("Port Mapping Logic", () => {
    test("prioritizes port 3000 for frontend URL", async () => {
      const { workspace, owner } = await createTestWorkspaceScenario({
        withSwarm: true,
        swarm: {
          poolName: "test-pool",
          poolApiKey: JSON.stringify({ data: "encrypted-key" }),
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      // Mock Pool Manager response with multiple ports including 3000
      const mockFetch = global.fetch as Mock;
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          workspace: {
            portMappings: {
              "8080": "https://backend.example.com",
              "3000": "https://frontend.example.com",
              "5000": "https://api.example.com",
              "15552": "https://internal1.example.com",
              "15553": "https://internal2.example.com",
            },
            state: "running",
          },
        }),
      } as Response);

      const request = new Request("http://localhost:3000/api/test", {
        method: "POST",
      });

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      expectSuccess(response);
      const data = await response.json();
      expect(data.frontend).toBe("https://frontend.example.com");
    });

    test("uses single app port when only one non-internal port exists", async () => {
      const { workspace, owner } = await createTestWorkspaceScenario({
        withSwarm: true,
        swarm: {
          poolName: "test-pool",
          poolApiKey: JSON.stringify({ data: "encrypted-key" }),
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      // Mock Pool Manager response with single app port (not 3000)
      const mockFetch = global.fetch as Mock;
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
            state: "running",
          },
        }),
      } as Response);

      const request = new Request("http://localhost:3000/api/test", {
        method: "POST",
      });

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      expectSuccess(response);
      const data = await response.json();
      expect(data.frontend).toBe("https://app.example.com");
    });

    test("filters out internal ports (15552, 15553)", async () => {
      const { workspace, owner } = await createTestWorkspaceScenario({
        withSwarm: true,
        swarm: {
          poolName: "test-pool",
          poolApiKey: JSON.stringify({ data: "encrypted-key" }),
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      // Mock Pool Manager response with app and internal ports
      const mockFetch = global.fetch as Mock;
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          workspace: {
            portMappings: {
              "3000": "https://frontend.example.com",
              "8080": "https://backend.example.com",
              "15552": "https://internal1.example.com",
              "15553": "https://internal2.example.com",
            },
            state: "running",
          },
        }),
      } as Response);

      const request = new Request("http://localhost:3000/api/test", {
        method: "POST",
      });

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      expectSuccess(response);
      const data = await response.json();
      // Should return port 3000, not internal ports
      expect(data.frontend).toBe("https://frontend.example.com");
    });

    test("returns 500 when no frontend port mapping found (only internal ports)", async () => {
      const { workspace, owner } = await createTestWorkspaceScenario({
        withSwarm: true,
        swarm: {
          poolName: "test-pool",
          poolApiKey: JSON.stringify({ data: "encrypted-key" }),
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      // Mock Pool Manager response with only internal ports
      const mockFetch = global.fetch as Mock;
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
            state: "running",
          },
        }),
      } as Response);

      const request = new Request("http://localhost:3000/api/test", {
        method: "POST",
      });

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      expectError(response, "Failed to claim pod", 500);
    });

    test("returns 500 when portMappings is empty", async () => {
      const { workspace, owner } = await createTestWorkspaceScenario({
        withSwarm: true,
        swarm: {
          poolName: "test-pool",
          poolApiKey: JSON.stringify({ data: "encrypted-key" }),
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      // Mock Pool Manager response with empty portMappings
      const mockFetch = global.fetch as Mock;
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          workspace: {
            portMappings: {},
            state: "running",
          },
        }),
      } as Response);

      const request = new Request("http://localhost:3000/api/test", {
        method: "POST",
      });

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      expectError(response, "Failed to claim pod", 500);
    });

    test("handles multiple app ports without port 3000 by selecting first available", async () => {
      const { workspace, owner } = await createTestWorkspaceScenario({
        withSwarm: true,
        swarm: {
          poolName: "test-pool",
          poolApiKey: JSON.stringify({ data: "encrypted-key" }),
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      // Mock Pool Manager response with multiple app ports, no port 3000
      const mockFetch = global.fetch as Mock;
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          workspace: {
            portMappings: {
              "8080": "https://app1.example.com",
              "5000": "https://app2.example.com",
              "15552": "https://internal1.example.com",
              "15553": "https://internal2.example.com",
            },
            state: "running",
          },
        }),
      } as Response);

      const request = new Request("http://localhost:3000/api/test", {
        method: "POST",
      });

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      // When multiple app ports exist without port 3000, frontend should be empty
      // based on the route logic (lines 157-168) - returns 500 when no frontend found
      expectError(response, "Failed to claim pod", 500);
    });
  });

  describe("Edge Cases", () => {
    test("handles pool API key auto-creation when missing", async () => {
      const { getSwarmPoolApiKeyFor, updateSwarmPoolApiKeyFor } = await import(
        "@/services/swarm/secrets"
      );

      const newApiKey = JSON.stringify({
        data: "new-encrypted-key",
        iv: "new-iv",
        tag: "new-tag",
      });

      (getSwarmPoolApiKeyFor as Mock).mockResolvedValue(newApiKey);
      (updateSwarmPoolApiKeyFor as Mock).mockResolvedValue(undefined);

      const { workspace, owner } = await createTestWorkspaceScenario({
        withSwarm: true,
        swarm: {
          poolName: "test-pool",
          poolApiKey: null, // Missing API key
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      // Mock successful Pool Manager API response
      const mockFetch = global.fetch as Mock;
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          workspace: {
            portMappings: {
              "3000": "https://frontend.example.com",
            },
            state: "running",
          },
        }),
      } as Response);

      const request = new Request("http://localhost:3000/api/test", {
        method: "POST",
      });

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      // Verify API key was auto-created
      expect(updateSwarmPoolApiKeyFor).toHaveBeenCalledWith(
        expect.any(String)
      );
      expect(getSwarmPoolApiKeyFor).toHaveBeenCalledWith(expect.any(String));

      expectSuccess(response);
    });

    test("handles encryption service errors gracefully", async () => {
      const { workspace, owner } = await createTestWorkspaceScenario({
        withSwarm: true,
        swarm: {
          poolName: "test-pool",
          poolApiKey: JSON.stringify({ data: "encrypted-key" }),
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      // Mock encryption service to throw error
      mockEncryptionService.decryptField.mockImplementation(() => {
        throw new Error("Decryption failed");
      });

      const request = new Request("http://localhost:3000/api/test", {
        method: "POST",
      });

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      expectError(response, "Failed to claim pod", 500);
    });

    test("validates required workspaceId parameter", async () => {
      const { user } = await createTestUser({
        withGitHubAuth: true,
        githubUsername: "testuser",
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = new Request("http://localhost:3000/api/test", {
        method: "POST",
      });

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: "" }),
      });

      expectError(response, "Missing required field: workspaceId", 400);
    });
  });
});