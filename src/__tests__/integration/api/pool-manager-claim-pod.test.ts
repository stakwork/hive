import { describe, test, beforeEach, vi, expect } from "vitest";
import { POST } from "@/app/api/pool-manager/claim-pod/[workspaceId]/route";
import {
  createAuthenticatedSession,
  getMockedSession,
  expectSuccess,
  expectUnauthorized,
  expectError,
  expectNotFound,
  expectForbidden,
  createPostRequest,
} from "@/__tests__/support/helpers";
import { createTestUser, createTestWorkspaceScenario, createTestSwarm } from "@/__tests__/support/fixtures";
import { EncryptionService } from "@/lib/encryption";
import { db } from "@/lib/db";

// Mock environment config
vi.mock("@/lib/env", () => ({
  config: {
    POOL_MANAGER_BASE_URL: "https://pool-manager.test.com",
  },
}));

// Mock EncryptionService
vi.mock("@/lib/encryption", () => ({
  EncryptionService: {
    getInstance: vi.fn(() => ({
      decryptField: vi.fn((fieldName: string, encryptedValue: string) => "decrypted-api-key"),
      encryptField: vi.fn((fieldName: string, plainValue: string) => ({
        data: "encrypted-data",
        iv: "initialization-vector",
        tag: "auth-tag",
        keyId: "default",
        version: "1",
        encryptedAt: new Date().toISOString(),
      })),
    })),
  },
}));

// Mock swarm secrets management
vi.mock("@/services/swarm/secrets", () => ({
  getSwarmPoolApiKeyFor: vi.fn(),
  updateSwarmPoolApiKeyFor: vi.fn(),
}));

describe("POST /api/pool-manager/claim-pod/[workspaceId] - Integration Tests", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  // Helper to setup successful pod claim mocks
  const setupSuccessfulPodClaimMocks = (
    portMappings: Record<string, string> = { "3000": "https://frontend.example.com" },
    frontendPort: string = "3000",
  ) => {
    mockFetch
      // First call: GET workspace from pool
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          workspace: {
            id: "workspace-123",
            password: "test-password",
            url: "https://ide.example.com",
            portMappings: {
              ...portMappings,
              "15552": "https://control.example.com",
            },
          },
        }),
        text: async () => JSON.stringify({ success: true }),
      })
      // Second call: POST mark-used
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
        text: async () => JSON.stringify({ success: true }),
      })
      // Third call: GET /jlist (process list)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => [{ pid: 123, name: "frontend", status: "online", port: frontendPort }],
        text: async () => JSON.stringify([{ pid: 123, name: "frontend", status: "online", port: frontendPort }]),
      });
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch = vi.fn();
    global.fetch = mockFetch;
  });

  describe("Authentication", () => {
    test("returns 401 when session is missing", async () => {
      getMockedSession().mockResolvedValue(null);

      const request = createPostRequest("http://localhost:3000/api/pool-manager/claim-pod/test-workspace-id");

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: "test-workspace-id" }),
      });

      await expectUnauthorized(response);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    test("returns 401 when user is missing from session", async () => {
      getMockedSession().mockResolvedValue({ user: null } as any);

      const request = createPostRequest("http://localhost:3000/api/pool-manager/claim-pod/test-workspace-id");

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: "test-workspace-id" }),
      });

      await expectUnauthorized(response);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    test("returns 401 when user ID is missing from session", async () => {
      getMockedSession().mockResolvedValue({
        user: { email: "test@example.com" },
        expires: new Date().toISOString(),
      } as any);

      const request = createPostRequest("http://localhost:3000/api/pool-manager/claim-pod/test-workspace-id");

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: "test-workspace-id" }),
      });

      await expectError(response, "Invalid user session", 401);
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe("Workspace Validation", () => {
    test("returns 400 when workspaceId is missing", async () => {
      const user = await createTestUser();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createPostRequest("http://localhost:3000/api/pool-manager/claim-pod/");

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: "" }),
      });

      await expectError(response, "Missing required field: workspaceId", 400);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    test("returns 404 when workspace does not exist", async () => {
      const user = await createTestUser();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createPostRequest("http://localhost:3000/api/pool-manager/claim-pod/nonexistent-workspace-id");

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: "nonexistent-workspace-id" }),
      });

      await expectNotFound(response, "Workspace not found");
      expect(mockFetch).not.toHaveBeenCalled();
    });

    test("returns 404 when workspace has no swarm", async () => {
      const { owner, workspace } = await createTestWorkspaceScenario({
        workspace: { name: "No Swarm Workspace" },
      });

      // Delete swarm if it exists
      await db.swarm.deleteMany({ where: { workspaceId: workspace.id } });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const request = createPostRequest(`http://localhost:3000/api/pool-manager/claim-pod/${workspace.id}`);

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      await expectNotFound(response, "No swarm found for this workspace");
      expect(mockFetch).not.toHaveBeenCalled();
    });

    test("returns 400 when swarm missing poolApiKey", async () => {
      const { owner, workspace } = await createTestWorkspaceScenario();

      const swarm = await createTestSwarm({
        workspaceId: workspace.id,
        name: "test-swarm",
        status: "ACTIVE",
      });

      // Set poolName but leave poolApiKey null
      await db.swarm.update({
        where: { id: swarm.id },
        data: { poolName: "test-pool", poolApiKey: null },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const request = createPostRequest(`http://localhost:3000/api/pool-manager/claim-pod/${workspace.id}`);

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      await expectError(response, "Swarm not properly configured with pool information", 400);
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe("Authorization", () => {
    test("returns 403 when user is neither owner nor member", async () => {
      const { workspace } = await createTestWorkspaceScenario();
      const nonMemberUser = await createTestUser({ name: "Non-member User" });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(nonMemberUser));

      const request = createPostRequest(`http://localhost:3000/api/pool-manager/claim-pod/${workspace.id}`);

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      await expectForbidden(response, "Access denied");
      expect(mockFetch).not.toHaveBeenCalled();
    });

    test("allows workspace owner to claim pod", async () => {
      const { owner, workspace } = await createTestWorkspaceScenario();

      const swarm = await createTestSwarm({
        workspaceId: workspace.id,
        name: "test-swarm",
        status: "ACTIVE",
      });

      await db.swarm.update({
        where: { id: swarm.id },
        data: {
          poolName: "test-pool",
          poolApiKey: JSON.stringify({ encrypted: "key" }),
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      setupSuccessfulPodClaimMocks();

      const request = createPostRequest(`http://localhost:3000/api/pool-manager/claim-pod/${workspace.id}`);

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      await expectSuccess(response, 200);
    });

    test("allows workspace member to claim pod", async () => {
      const { workspace, members } = await createTestWorkspaceScenario({
        members: [{ role: "DEVELOPER" }],
      });

      const memberUser = members[0];

      const swarm = await createTestSwarm({
        workspaceId: workspace.id,
        name: "test-swarm",
        status: "ACTIVE",
      });

      await db.swarm.update({
        where: { id: swarm.id },
        data: {
          poolName: "test-pool",
          poolApiKey: JSON.stringify({ encrypted: "key" }),
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(memberUser));

      setupSuccessfulPodClaimMocks();

      const request = createPostRequest(`http://localhost:3000/api/pool-manager/claim-pod/${workspace.id}`);

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      await expectSuccess(response, 200);
    });
  });

  describe("Resource Allocation - Port Mapping Logic", () => {
    test("successfully claims pod with port 3000 mapping", async () => {
      const { owner, workspace } = await createTestWorkspaceScenario();

      const swarm = await createTestSwarm({
        workspaceId: workspace.id,
        name: "test-swarm",
        status: "ACTIVE",
      });

      await db.swarm.update({
        where: { id: swarm.id },
        data: {
          poolName: "test-pool",
          poolApiKey: JSON.stringify({ encrypted: "key" }),
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      setupSuccessfulPodClaimMocks({
        "3000": "https://frontend.example.com",
      });

      const request = createPostRequest(`http://localhost:3000/api/pool-manager/claim-pod/${workspace.id}`);

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      const data = await expectSuccess(response, 200);
      expect(data.success).toBe(true);
      expect(data.message).toBe("Pod claimed successfully");
      expect(data.frontend).toBe("https://frontend.example.com");
    });

    test("filters out internal ports 15552 and 15553", async () => {
      const { owner, workspace } = await createTestWorkspaceScenario();

      const swarm = await createTestSwarm({
        workspaceId: workspace.id,
        name: "test-swarm",
        status: "ACTIVE",
      });

      await db.swarm.update({
        where: { id: swarm.id },
        data: {
          poolName: "test-pool",
          poolApiKey: JSON.stringify({ encrypted: "key" }),
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      setupSuccessfulPodClaimMocks(
        {
          "8080": "https://app.example.com",
        },
        "8080",
      );

      const request = createPostRequest(`http://localhost:3000/api/pool-manager/claim-pod/${workspace.id}`);

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      const data = await expectSuccess(response, 200);
      expect(data.frontend).toBe("https://app.example.com");
      expect(data.frontend).not.toContain("internal1");
      expect(data.frontend).not.toContain("internal2");
    });

    test("returns single app URL when only one non-internal port exists", async () => {
      const { owner, workspace } = await createTestWorkspaceScenario();

      const swarm = await createTestSwarm({
        workspaceId: workspace.id,
        name: "test-swarm",
        status: "ACTIVE",
      });

      await db.swarm.update({
        where: { id: swarm.id },
        data: {
          poolName: "test-pool",
          poolApiKey: JSON.stringify({ encrypted: "key" }),
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      setupSuccessfulPodClaimMocks(
        {
          "8080": "https://single-app.example.com",
        },
        "8080",
      );

      const request = createPostRequest(`http://localhost:3000/api/pool-manager/claim-pod/${workspace.id}`);

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      const data = await expectSuccess(response, 200);
      expect(data.frontend).toBe("https://single-app.example.com");
    });

    test("prioritizes port 3000 when multiple app ports exist", async () => {
      const { owner, workspace } = await createTestWorkspaceScenario();

      const swarm = await createTestSwarm({
        workspaceId: workspace.id,
        name: "test-swarm",
        status: "ACTIVE",
      });

      await db.swarm.update({
        where: { id: swarm.id },
        data: {
          poolName: "test-pool",
          poolApiKey: JSON.stringify({ encrypted: "key" }),
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      setupSuccessfulPodClaimMocks({
        "8080": "https://app1.example.com",
        "3000": "https://frontend.example.com",
        "9090": "https://app2.example.com",
      });

      const request = createPostRequest(`http://localhost:3000/api/pool-manager/claim-pod/${workspace.id}`);

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      const data = await expectSuccess(response, 200);
      expect(data.frontend).toBe("https://frontend.example.com");
    });

    test("uses final fallback when no frontend port mapping found", async () => {
      const { owner, workspace } = await createTestWorkspaceScenario();

      const swarm = await createTestSwarm({
        workspaceId: workspace.id,
        name: "test-swarm",
        status: "ACTIVE",
      });

      await db.swarm.update({
        where: { id: swarm.id },
        data: {
          poolName: "test-pool",
          poolApiKey: JSON.stringify({ encrypted: "key" }),
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      // Mock with portMappings that have no frontend port (only internal ports)
      // This triggers the final fallback which attempts to replace control port with frontend port in URL
      mockFetch
        // First call: GET workspace from pool (no port 3000, only internal ports)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            workspace: {
              id: "workspace-123",
              password: "test-password",
              url: "https://ide.example.com",
              portMappings: {
                "15552": "https://internal1.example.com",
                "15553": "https://internal2.example.com",
              },
            },
          }),
          text: async () => JSON.stringify({ success: true }),
        })
        // Second call: POST mark-used
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ success: true }),
          text: async () => JSON.stringify({ success: true }),
        })
        // Third call: GET /jlist (process list with frontend on port 3000)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => [{ pid: 123, name: "frontend", status: "online", port: "3000" }],
          text: async () => JSON.stringify([{ pid: 123, name: "frontend", status: "online", port: "3000" }]),
        });

      const request = createPostRequest(`http://localhost:3000/api/pool-manager/claim-pod/${workspace.id}`);

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      // The final fallback uses controlPortUrl.replace() which returns the control URL
      const data = await expectSuccess(response, 200);
      expect(data.frontend).toBe("https://internal1.example.com");
    });

    test("returns 500 when portMappings is empty", async () => {
      const { owner, workspace } = await createTestWorkspaceScenario();

      const swarm = await createTestSwarm({
        workspaceId: workspace.id,
        name: "test-swarm",
        status: "ACTIVE",
      });

      await db.swarm.update({
        where: { id: swarm.id },
        data: {
          poolName: "test-pool",
          poolApiKey: JSON.stringify({ encrypted: "key" }),
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      // Mock with empty portMappings - should fail
      mockFetch
        // First call: GET workspace from pool (empty portMappings)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            success: true,
            workspace: {
              id: "workspace-123",
              password: "test-password",
              url: "https://ide.example.com",
              portMappings: {},
            },
          }),
          text: async () => JSON.stringify({ success: true }),
        })
        // Second call: POST mark-used
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ success: true }),
          text: async () => JSON.stringify({ success: true }),
        });

      const request = createPostRequest(`http://localhost:3000/api/pool-manager/claim-pod/${workspace.id}`);

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      await expectError(response, "Failed to claim pod", 500);
    });

    test("handles multiple non-internal ports without port 3000", async () => {
      const { owner, workspace } = await createTestWorkspaceScenario();

      const swarm = await createTestSwarm({
        workspaceId: workspace.id,
        name: "test-swarm",
        status: "ACTIVE",
      });

      await db.swarm.update({
        where: { id: swarm.id },
        data: {
          poolName: "test-pool",
          poolApiKey: JSON.stringify({ encrypted: "key" }),
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      setupSuccessfulPodClaimMocks(
        {
          "8080": "https://app1.example.com",
          "9090": "https://app2.example.com",
        },
        "8080",
      );

      const request = createPostRequest(`http://localhost:3000/api/pool-manager/claim-pod/${workspace.id}`);

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      // When multiple app ports exist without port 3000, should successfully
      // return the frontend process URL from the discovered port (8080 in this case)
      const data = await expectSuccess(response, 200);
      expect(data.frontend).toBe("https://app1.example.com");
    });
  });

  describe("Pool Manager API Integration", () => {
    test("calls Pool Manager API with correct URL and headers", async () => {
      const { owner, workspace } = await createTestWorkspaceScenario();

      const swarm = await createTestSwarm({
        workspaceId: workspace.id,
        name: "test-swarm",
        status: "ACTIVE",
      });

      await db.swarm.update({
        where: { id: swarm.id },
        data: {
          poolName: "test-pool",
          poolApiKey: JSON.stringify({ encrypted: "key" }),
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      setupSuccessfulPodClaimMocks();

      const request = createPostRequest(`http://localhost:3000/api/pool-manager/claim-pod/${workspace.id}`);

      await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      // URL should now use swarm.id instead of poolName
      expect(mockFetch).toHaveBeenCalledWith(
        `https://pool-manager.test.com/pools/${swarm.id}/workspace`,
        expect.objectContaining({
          method: "GET",
          headers: expect.objectContaining({
            Authorization: "Bearer decrypted-api-key",
            "Content-Type": "application/json",
          }),
        }),
      );
    });

    test("returns 500 when Pool Manager API returns non-200 status", async () => {
      const { owner, workspace } = await createTestWorkspaceScenario();

      const swarm = await createTestSwarm({
        workspaceId: workspace.id,
        name: "test-swarm",
        status: "ACTIVE",
      });

      await db.swarm.update({
        where: { id: swarm.id },
        data: {
          poolName: "test-pool",
          poolApiKey: JSON.stringify({ encrypted: "key" }),
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => "Internal Server Error",
      });

      const request = createPostRequest(`http://localhost:3000/api/pool-manager/claim-pod/${workspace.id}`);

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      await expectError(response, "Failed to claim pod", 500);
    });

    test("returns 500 when Pool Manager API network failure", async () => {
      const { owner, workspace } = await createTestWorkspaceScenario();

      const swarm = await createTestSwarm({
        workspaceId: workspace.id,
        name: "test-swarm",
        status: "ACTIVE",
      });

      await db.swarm.update({
        where: { id: swarm.id },
        data: {
          poolName: "test-pool",
          poolApiKey: JSON.stringify({ encrypted: "key" }),
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      mockFetch.mockRejectedValue(new Error("Network request failed"));

      const request = createPostRequest(`http://localhost:3000/api/pool-manager/claim-pod/${workspace.id}`);

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      await expectError(response, "Failed to claim pod", 500);
    });

    test("decrypts poolApiKey before making API call", async () => {
      const { owner, workspace } = await createTestWorkspaceScenario();

      const swarm = await createTestSwarm({
        workspaceId: workspace.id,
        name: "test-swarm",
        status: "ACTIVE",
      });

      await db.swarm.update({
        where: { id: swarm.id },
        data: {
          poolName: "test-pool",
          poolApiKey: JSON.stringify({ encrypted: "test-encrypted-key" }),
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      setupSuccessfulPodClaimMocks();

      const request = createPostRequest(`http://localhost:3000/api/pool-manager/claim-pod/${workspace.id}`);

      await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      // Verify the API was called with the decrypted key and swarm.id (from mocked EncryptionService)
      expect(mockFetch).toHaveBeenCalledWith(
        `https://pool-manager.test.com/pools/${swarm.id}/workspace`,
        expect.objectContaining({
          method: "GET",
          headers: expect.objectContaining({
            Authorization: "Bearer decrypted-api-key",
          }),
        }),
      );
    });

    test("encodes swarm id in URL correctly", async () => {
      const { owner, workspace } = await createTestWorkspaceScenario();

      const swarm = await createTestSwarm({
        workspaceId: workspace.id,
        name: "test-swarm",
        status: "ACTIVE",
      });

      await db.swarm.update({
        where: { id: swarm.id },
        data: {
          poolName: "test pool with spaces",
          poolApiKey: JSON.stringify({ encrypted: "key" }),
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      setupSuccessfulPodClaimMocks();

      const request = createPostRequest(`http://localhost:3000/api/pool-manager/claim-pod/${workspace.id}`);

      await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      // URL should now use swarm.id (which is a cuid and doesn't need special encoding)
      expect(mockFetch).toHaveBeenCalledWith(
        `https://pool-manager.test.com/pools/${encodeURIComponent(swarm.id)}/workspace`,
        expect.any(Object),
      );
    });
  });

  describe("Mock Environment Bypass", () => {
    test("returns mock frontend URL when MOCK_BROWSER_URL is set", async () => {
      process.env.MOCK_BROWSER_URL = "https://mock.example.com";

      const { owner, workspace } = await createTestWorkspaceScenario();

      const swarm = await createTestSwarm({
        workspaceId: workspace.id,
        name: "test-swarm",
        status: "ACTIVE",
      });

      await db.swarm.update({
        where: { id: swarm.id },
        data: {
          poolName: "test-pool",
          poolApiKey: JSON.stringify({ encrypted: "key" }),
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const request = createPostRequest(`http://localhost:3000/api/pool-manager/claim-pod/${workspace.id}`);

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      const data = await expectSuccess(response, 200);
      expect(data.frontend).toBe("https://mock.example.com");
      expect(mockFetch).not.toHaveBeenCalled();

      delete process.env.MOCK_BROWSER_URL;
    });
  });
});
