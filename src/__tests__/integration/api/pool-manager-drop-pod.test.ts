import { describe, test, beforeEach, vi, expect } from "vitest";
import { POST } from "@/app/api/pool-manager/drop-pod/[workspaceId]/route";
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
import {
  createTestUser,
  createTestWorkspaceScenario,
  createTestSwarm,
} from "@/__tests__/support/fixtures";
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

describe("POST /api/pool-manager/drop-pod/[workspaceId] - Integration Tests", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch = vi.fn();
    global.fetch = mockFetch;
  });

  describe("Authentication", () => {
    test("returns 401 when session is missing", async () => {
      getMockedSession().mockResolvedValue(null);

      const request = createPostRequest(
        "http://localhost:3000/api/pool-manager/drop-pod/test-workspace-id?podId=pod-123"
      );

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: "test-workspace-id" }),
      });

      await expectUnauthorized(response);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    test("returns 401 when user is missing from session", async () => {
      getMockedSession().mockResolvedValue({ user: null } as any);

      const request = createPostRequest(
        "http://localhost:3000/api/pool-manager/drop-pod/test-workspace-id?podId=pod-123"
      );

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

      const request = createPostRequest(
        "http://localhost:3000/api/pool-manager/drop-pod/test-workspace-id?podId=pod-123"
      );

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

      const request = createPostRequest(
        "http://localhost:3000/api/pool-manager/drop-pod/?podId=pod-123"
      );

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: "" }),
      });

      await expectError(response, "Missing required field: workspaceId", 400);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    test("returns 400 when podId query parameter is missing", async () => {
      const user = await createTestUser();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createPostRequest(
        "http://localhost:3000/api/pool-manager/drop-pod/test-workspace-id"
      );

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: "test-workspace-id" }),
      });

      await expectError(response, "Missing required field: podId", 400);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    test("returns 404 when workspace does not exist", async () => {
      const user = await createTestUser();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createPostRequest(
        "http://localhost:3000/api/pool-manager/drop-pod/nonexistent-workspace-id?podId=pod-123"
      );

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

      const request = createPostRequest(
        `http://localhost:3000/api/pool-manager/drop-pod/${workspace.id}?podId=pod-123`
      );

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      await expectNotFound(response, "No swarm found for this workspace");
      expect(mockFetch).not.toHaveBeenCalled();
    });

    test("returns 400 when swarm missing poolName", async () => {
      const { owner, workspace } = await createTestWorkspaceScenario();

      const swarm = await createTestSwarm({
        workspaceId: workspace.id,
        name: "test-swarm",
        status: "ACTIVE",
      });

      // Set poolApiKey but leave poolName null
      await db.swarm.update({
        where: { id: swarm.id },
        data: { poolName: null, poolApiKey: JSON.stringify({ encrypted: "key" }) },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const request = createPostRequest(
        `http://localhost:3000/api/pool-manager/drop-pod/${workspace.id}?podId=pod-123`
      );

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      await expectError(response, "Swarm not properly configured with pool information", 400);
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

      const request = createPostRequest(
        `http://localhost:3000/api/pool-manager/drop-pod/${workspace.id}?podId=pod-123`
      );

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

      const request = createPostRequest(
        `http://localhost:3000/api/pool-manager/drop-pod/${workspace.id}?podId=pod-123`
      );

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      await expectForbidden(response, "Access denied");
      expect(mockFetch).not.toHaveBeenCalled();
    });

    test("allows workspace owner to drop pod", async () => {
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

      // Mock successful drop
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => "Pod dropped successfully",
      });

      const request = createPostRequest(
        `http://localhost:3000/api/pool-manager/drop-pod/${workspace.id}?podId=pod-123`
      );

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      await expectSuccess(response, 200);
    });

    test("allows workspace member to drop pod", async () => {
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

      // Mock successful drop
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => "Pod dropped successfully",
      });

      const request = createPostRequest(
        `http://localhost:3000/api/pool-manager/drop-pod/${workspace.id}?podId=pod-123`
      );

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      await expectSuccess(response, 200);
    });
  });

  describe("Successful Pod Dropping", () => {
    test("successfully drops pod without repository reset", async () => {
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

      // Mock successful drop
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => "Pod dropped successfully",
      });

      const request = createPostRequest(
        `http://localhost:3000/api/pool-manager/drop-pod/${workspace.id}?podId=pod-123`
      );

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      const data = await expectSuccess(response, 200);
      expect(data.success).toBe(true);
      expect(data.message).toBe("Pod dropped successfully");

      // Verify only one API call (markWorkspaceAsUnused)
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    test("verifies no local database state changes occur", async () => {
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

      const workspaceBeforeDrop = await db.workspace.findUnique({
        where: { id: workspace.id },
        include: { swarm: true },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      // Mock successful drop
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => "Pod dropped successfully",
      });

      const request = createPostRequest(
        `http://localhost:3000/api/pool-manager/drop-pod/${workspace.id}?podId=pod-123`
      );

      await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      // Verify workspace and swarm state unchanged
      const workspaceAfterDrop = await db.workspace.findUnique({
        where: { id: workspace.id },
        include: { swarm: true },
      });

      expect(workspaceAfterDrop).toEqual(workspaceBeforeDrop);
      expect(workspaceAfterDrop?.swarm?.poolState).toBe(workspaceBeforeDrop?.swarm?.poolState);
    });
  });

  describe("Repository Reset Logic", () => {
    test("resets repositories when latest=true parameter provided", async () => {
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

      // Add repository to workspace
      await db.repository.create({
        data: {
          workspaceId: workspace.id,
          repositoryUrl: "https://github.com/test/repo.git",
          name: "test-repo",
          branch: "main",
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      // Mock sequential API calls for repository reset flow
      mockFetch
        // First call: getPodFromPool
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            workspace: {
              id: "pod-123",
              password: "pod-password",
              portMappings: {
                "15552": "https://control.example.com",
              },
            },
          }),
        })
        // Second call: updatePodRepositories
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ success: true }),
        })
        // Third call: markWorkspaceAsUnused
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () => "Pod dropped successfully",
        });

      const request = createPostRequest(
        `http://localhost:3000/api/pool-manager/drop-pod/${workspace.id}?podId=pod-123&latest=true`
      );

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      await expectSuccess(response, 200);

      // Verify three API calls were made
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    test("skips repository reset when latest=false", async () => {
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

      // Mock only markWorkspaceAsUnused call
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => "Pod dropped successfully",
      });

      const request = createPostRequest(
        `http://localhost:3000/api/pool-manager/drop-pod/${workspace.id}?podId=pod-123&latest=false`
      );

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      await expectSuccess(response, 200);

      // Verify only one API call (no repository reset)
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    test("skips repository reset when no repositories exist", async () => {
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

      // Mock sequential calls but updatePodRepositories should not be called
      mockFetch
        // First call: getPodFromPool
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            workspace: {
              id: "pod-123",
              password: "pod-password",
              portMappings: {
                "15552": "https://control.example.com",
              },
            },
          }),
        })
        // Second call: markWorkspaceAsUnused (skip updatePodRepositories)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          text: async () => "Pod dropped successfully",
        });

      const request = createPostRequest(
        `http://localhost:3000/api/pool-manager/drop-pod/${workspace.id}?podId=pod-123&latest=true`
      );

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      await expectSuccess(response, 200);

      // Verify only two API calls (no updatePodRepositories)
      expect(mockFetch).toHaveBeenCalledTimes(2);
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

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => "Success",
      });

      const request = createPostRequest(
        `http://localhost:3000/api/pool-manager/drop-pod/${workspace.id}?podId=pod-123`
      );

      await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "https://pool-manager.test.com/pools/test-pool/workspaces/pod-123/mark-unused",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            Authorization: "Bearer decrypted-api-key",
            "Content-Type": "application/json",
          }),
        })
      );
    });

    test("returns 500 when Pool Manager API returns 404", async () => {
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

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: async () => "Pod not found",
      });

      const request = createPostRequest(
        `http://localhost:3000/api/pool-manager/drop-pod/${workspace.id}?podId=pod-123`
      );

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      await expectError(response, "Failed to drop pod", 500);
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

      mockFetch.mockRejectedValueOnce(new Error("Network request failed"));

      const request = createPostRequest(
        `http://localhost:3000/api/pool-manager/drop-pod/${workspace.id}?podId=pod-123`
      );

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      await expectError(response, "Failed to drop pod", 500);
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

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => "Success",
      });

      const request = createPostRequest(
        `http://localhost:3000/api/pool-manager/drop-pod/${workspace.id}?podId=pod-123`
      );

      await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      // Verify the API was called with the decrypted key (from mocked EncryptionService)
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: "Bearer decrypted-api-key",
          }),
        })
      );
    });

    test("encodes pool name in URL correctly", async () => {
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

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => "Success",
      });

      const request = createPostRequest(
        `http://localhost:3000/api/pool-manager/drop-pod/${workspace.id}?podId=pod-123`
      );

      await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "https://pool-manager.test.com/pools/test%20pool%20with%20spaces/workspaces/pod-123/mark-unused",
        expect.any(Object)
      );
    });
  });

  describe("Mock Environment Bypass", () => {
    test("returns success without API call when MOCK_BROWSER_URL is set", async () => {
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

      const request = createPostRequest(
        `http://localhost:3000/api/pool-manager/drop-pod/${workspace.id}?podId=pod-123`
      );

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      const data = await expectSuccess(response, 200);
      expect(data.success).toBe(true);
      expect(data.message).toBe("Pod dropped successfully");
      expect(mockFetch).not.toHaveBeenCalled();

      delete process.env.MOCK_BROWSER_URL;
    });
  });

  describe("Edge Cases", () => {
    test("handles podId with special characters", async () => {
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

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => "Success",
      });

      const specialPodId = "pod-123-abc_xyz.test";
      const request = createPostRequest(
        `http://localhost:3000/api/pool-manager/drop-pod/${workspace.id}?podId=${specialPodId}`
      );

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      await expectSuccess(response, 200);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining(`/workspaces/${specialPodId}/mark-unused`),
        expect.any(Object)
      );
    });
  });
});