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
import { db } from "@/lib/db";
import { pusherServer } from "@/lib/pusher";

// Mock environment config
vi.mock("@/config/env", () => ({
  config: {
    POOL_MANAGER_BASE_URL: "https://pool-manager.test.com",
  },
}));

// Mock EncryptionService
vi.mock("@/lib/encryption", () => ({
  EncryptionService: {
    getInstance: vi.fn(() => ({
      decryptField: vi.fn(() => "decrypted-api-key"),
      encryptField: vi.fn(() => ({
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

// Mock Pusher
vi.mock("@/lib/pusher", () => ({
  pusherServer: {
    trigger: vi.fn(),
  },
  getWorkspaceChannelName: vi.fn((slug: string) => `workspace-${slug}`),
}));

describe("POST /api/pool-manager/drop-pod/[workspaceId] - Integration Tests", () => {
  let mockFetch: ReturnType<typeof vi.fn>;
  let mockPusherTrigger: ReturnType<typeof vi.fn>;

  // Helper to setup successful pod drop mocks
  const setupSuccessfulPodDropMocks = (
    includeRepositoryReset: boolean = false
  ) => {
    if (includeRepositoryReset) {
      mockFetch
        // First call: GET workspace details (for repository reset)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            id: "pod-workspace-123",
            password: "pod-password",
            portMappings: {
              "15552": "https://control.example.com",
              "3000": "https://frontend.example.com",
            },
          }),
          text: async () => JSON.stringify({}),
        })
        // Second call: PUT /latest (repository reset)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ success: true }),
          text: async () => "Success",
        })
        // Third call: POST mark-unused
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ success: true }),
          text: async () => "Success",
        });
    } else {
      mockFetch
        // Single call: POST mark-unused
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ success: true }),
          text: async () => "Success",
        });
    }
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch = vi.fn();
    global.fetch = mockFetch;
    mockPusherTrigger = vi.mocked(pusherServer.trigger);
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
      const { owner, workspace } = await createTestWorkspaceScenario();

      await createTestSwarm({
        workspaceId: workspace.id,
        name: "test-swarm",
        status: "ACTIVE",
        poolName: "test-pool",
        poolApiKey: "test-api-key",
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const request = createPostRequest(
        `http://localhost:3000/api/pool-manager/drop-pod/${workspace.id}`
      );

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
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

      await createTestSwarm({
        workspaceId: workspace.id,
        name: "test-swarm",
        status: "ACTIVE",
        poolName: "test-pool",
        poolApiKey: "test-api-key",
      });

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

      await createTestSwarm({
        workspaceId: workspace.id,
        name: "test-swarm",
        status: "ACTIVE",
        poolName: "test-pool",
        poolApiKey: "test-api-key",
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      setupSuccessfulPodDropMocks(false);

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

      await createTestSwarm({
        workspaceId: workspace.id,
        name: "test-swarm",
        status: "ACTIVE",
        poolName: "test-pool",
        poolApiKey: "test-api-key",
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(memberUser));

      setupSuccessfulPodDropMocks(false);

      const request = createPostRequest(
        `http://localhost:3000/api/pool-manager/drop-pod/${workspace.id}?podId=pod-123`
      );

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      await expectSuccess(response, 200);
    });
  });

  describe("Pod Deallocation", () => {
    test("successfully drops pod with required parameters", async () => {
      const { owner, workspace } = await createTestWorkspaceScenario();

      await createTestSwarm({
        workspaceId: workspace.id,
        name: "test-swarm",
        status: "ACTIVE",
        poolName: "test-pool",
        poolApiKey: "test-api-key",
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      setupSuccessfulPodDropMocks(false);

      const request = createPostRequest(
        `http://localhost:3000/api/pool-manager/drop-pod/${workspace.id}?podId=pod-123`
      );

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      const data = await expectSuccess(response, 200);
      expect(data.success).toBe(true);
      expect(data.message).toBe("Pod dropped successfully");
    });

    test("calls Pool Manager API with correct URL and headers", async () => {
      const { owner, workspace } = await createTestWorkspaceScenario();

      const swarm = await createTestSwarm({
        workspaceId: workspace.id,
        name: "test-swarm",
        status: "ACTIVE",
        poolName: "test-pool",
        poolApiKey: "test-api-key",
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      setupSuccessfulPodDropMocks(false);

      const request = createPostRequest(
        `http://localhost:3000/api/pool-manager/drop-pod/${workspace.id}?podId=pod-123`
      );

      await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      // Verify Pool Manager API call (using swarm.id as poolName)
      expect(mockFetch).toHaveBeenCalledWith(
        `https://pool-manager.test.com/pools/${encodeURIComponent(swarm.id)}/workspaces/pod-123/mark-unused`,
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            Authorization: "Bearer decrypted-api-key",
            "Content-Type": "application/json",
          }),
        })
      );
    });

    test("decrypts poolApiKey before making API call", async () => {
      const { owner, workspace } = await createTestWorkspaceScenario();

      await createTestSwarm({
        workspaceId: workspace.id,
        name: "test-swarm",
        status: "ACTIVE",
        poolName: "test-pool",
        poolApiKey: "test-api-key",
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      setupSuccessfulPodDropMocks(false);

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

    test("returns 500 when Pool Manager API returns non-200 status", async () => {
      const { owner, workspace } = await createTestWorkspaceScenario();

      await createTestSwarm({
        workspaceId: workspace.id,
        name: "test-swarm",
        status: "ACTIVE",
        poolName: "test-pool",
        poolApiKey: "test-api-key",
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => "Internal Server Error",
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

      await createTestSwarm({
        workspaceId: workspace.id,
        name: "test-swarm",
        status: "ACTIVE",
        poolName: "test-pool",
        poolApiKey: "test-api-key",
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      mockFetch.mockRejectedValue(new Error("Network request failed"));

      const request = createPostRequest(
        `http://localhost:3000/api/pool-manager/drop-pod/${workspace.id}?podId=pod-123`
      );

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      await expectError(response, "Failed to drop pod", 500);
    });
  });

  describe("Optional Repository Reset", () => {
    test("skips repository reset when latest parameter is not provided", async () => {
      const { owner, workspace } = await createTestWorkspaceScenario();

      await createTestSwarm({
        workspaceId: workspace.id,
        name: "test-swarm",
        status: "ACTIVE",
        poolName: "test-pool",
        poolApiKey: "test-api-key",
      });

      // Add a repository to the workspace
      await db.repository.create({
        data: {
          name: "test-repo",
          repositoryUrl: "https://github.com/test/repo",
          workspaceId: workspace.id,
          status: "SYNCED",
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      setupSuccessfulPodDropMocks(false);

      const request = createPostRequest(
        `http://localhost:3000/api/pool-manager/drop-pod/${workspace.id}?podId=pod-123`
      );

      await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      // Should only call mark-unused, not getPodFromPool or updatePodRepositories
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    test("resets repositories when latest=true", async () => {
      const { owner, workspace } = await createTestWorkspaceScenario();

      await createTestSwarm({
        workspaceId: workspace.id,
        name: "test-swarm",
        status: "ACTIVE",
        poolName: "test-pool",
        poolApiKey: "test-api-key",
      });

      // Add repositories to the workspace
      await db.repository.create({
        data: {
          name: "test-repo",
          repositoryUrl: "https://github.com/test/repo",
          workspaceId: workspace.id,
          status: "SYNCED",
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      setupSuccessfulPodDropMocks(true);

      const request = createPostRequest(
        `http://localhost:3000/api/pool-manager/drop-pod/${workspace.id}?podId=pod-123&latest=true`
      );

      await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      // Should call: getPodFromPool, updatePodRepositories, mark-unused
      expect(mockFetch).toHaveBeenCalledTimes(3);

      // Verify getPodFromPool call
      expect(mockFetch).toHaveBeenNthCalledWith(
        1,
        "https://pool-manager.test.com/workspaces/pod-123",
        expect.objectContaining({
          method: "GET",
          headers: expect.objectContaining({
            Authorization: "Bearer decrypted-api-key",
          }),
        })
      );

      // Verify updatePodRepositories call
      expect(mockFetch).toHaveBeenNthCalledWith(
        2,
        "https://control.example.com/latest",
        expect.objectContaining({
          method: "PUT",
          headers: expect.objectContaining({
            Authorization: "Bearer pod-password",
          }),
        })
      );

      // Verify mark-unused call
      expect(mockFetch).toHaveBeenNthCalledWith(
        3,
        expect.stringContaining("/mark-unused"),
        expect.objectContaining({
          method: "POST",
        })
      );
    });

    test("handles missing control port gracefully when latest=true", async () => {
      const { owner, workspace } = await createTestWorkspaceScenario();

      await createTestSwarm({
        workspaceId: workspace.id,
        name: "test-swarm",
        status: "ACTIVE",
        poolName: "test-pool",
        poolApiKey: "test-api-key",
      });

      await db.repository.create({
        data: {
          name: "test-repo",
          repositoryUrl: "https://github.com/test/repo",
          workspaceId: workspace.id,
          status: "SYNCED",
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      mockFetch
        // getPodFromPool returns workspace without control port
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            id: "pod-workspace-123",
            password: "pod-password",
            portMappings: {
              "3000": "https://frontend.example.com",
            },
          }),
          text: async () => JSON.stringify({}),
        })
        // mark-unused succeeds
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ success: true }),
          text: async () => "Success",
        });

      const request = createPostRequest(
        `http://localhost:3000/api/pool-manager/drop-pod/${workspace.id}?podId=pod-123&latest=true`
      );

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      // Should succeed despite missing control port
      await expectSuccess(response, 200);

      // Should call getPodFromPool and mark-unused, but skip updatePodRepositories
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    test("handles empty repository list when latest=true", async () => {
      const { owner, workspace } = await createTestWorkspaceScenario();

      await createTestSwarm({
        workspaceId: workspace.id,
        name: "test-swarm",
        status: "ACTIVE",
        poolName: "test-pool",
        poolApiKey: "test-api-key",
      });

      // No repositories added to workspace

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      mockFetch
        // getPodFromPool returns workspace with control port
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            id: "pod-workspace-123",
            password: "pod-password",
            portMappings: {
              "15552": "https://control.example.com",
              "3000": "https://frontend.example.com",
            },
          }),
          text: async () => JSON.stringify({}),
        })
        // mark-unused succeeds
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ success: true }),
          text: async () => "Success",
        });

      const request = createPostRequest(
        `http://localhost:3000/api/pool-manager/drop-pod/${workspace.id}?podId=pod-123&latest=true`
      );

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      await expectSuccess(response, 200);

      // Should call getPodFromPool and mark-unused, but skip updatePodRepositories (no repos)
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    test("continues pod drop even if repository reset fails", async () => {
      const { owner, workspace } = await createTestWorkspaceScenario();

      await createTestSwarm({
        workspaceId: workspace.id,
        name: "test-swarm",
        status: "ACTIVE",
        poolName: "test-pool",
        poolApiKey: "test-api-key",
      });

      await db.repository.create({
        data: {
          name: "test-repo",
          repositoryUrl: "https://github.com/test/repo",
          workspaceId: workspace.id,
          status: "SYNCED",
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      mockFetch
        // getPodFromPool succeeds
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            id: "pod-workspace-123",
            password: "pod-password",
            portMappings: {
              "15552": "https://control.example.com",
              "3000": "https://frontend.example.com",
            },
          }),
          text: async () => JSON.stringify({}),
        })
        // updatePodRepositories fails
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          text: async () => "Failed to update repositories",
        })
        // mark-unused succeeds
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ success: true }),
          text: async () => "Success",
        });

      const request = createPostRequest(
        `http://localhost:3000/api/pool-manager/drop-pod/${workspace.id}?podId=pod-123&latest=true`
      );

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      // Should succeed despite repository reset failure
      await expectSuccess(response, 200);
    });
  });

  describe("Task podId Cleanup", () => {
    test("clears podId from all tasks associated with the pod", async () => {
      const { owner, workspace } = await createTestWorkspaceScenario();

      await createTestSwarm({
        workspaceId: workspace.id,
        name: "test-swarm",
        status: "ACTIVE",
        poolName: "test-pool",
        poolApiKey: "test-api-key",
      });

      // Create multiple tasks with the same podId
      const task1 = await db.task.create({
        data: {
          title: "Task 1",
          workspaceId: workspace.id,
          status: "IN_PROGRESS",
          podId: "pod-123",
          agentUrl: "https://agent.example.com",
          agentPassword: "password123",
          createdById: owner.id,
          updatedById: owner.id,
        },
      });

      const task2 = await db.task.create({
        data: {
          title: "Task 2",
          workspaceId: workspace.id,
          status: "IN_PROGRESS",
          podId: "pod-123",
          agentUrl: "https://agent.example.com",
          agentPassword: "password123",
          createdById: owner.id,
          updatedById: owner.id,
        },
      });

      // Create a task with a different podId
      const task3 = await db.task.create({
        data: {
          title: "Task 3",
          workspaceId: workspace.id,
          status: "IN_PROGRESS",
          podId: "pod-456",
          agentUrl: "https://agent.example.com",
          agentPassword: "password456",
          createdById: owner.id,
          updatedById: owner.id,
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));
      setupSuccessfulPodDropMocks(false);

      const request = createPostRequest(
        `http://localhost:3000/api/pool-manager/drop-pod/${workspace.id}?podId=pod-123`
      );

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      await expectSuccess(response, 200);

      // Verify task1 and task2 have podId cleared
      const updatedTask1 = await db.task.findUnique({ where: { id: task1.id } });
      const updatedTask2 = await db.task.findUnique({ where: { id: task2.id } });
      const updatedTask3 = await db.task.findUnique({ where: { id: task3.id } });

      expect(updatedTask1?.podId).toBeNull();
      expect(updatedTask2?.podId).toBeNull();
      // Task 3 should still have its podId
      expect(updatedTask3?.podId).toBe("pod-456");
    });

    test("clears additional pod fields when taskId is provided", async () => {
      const { owner, workspace } = await createTestWorkspaceScenario();

      await createTestSwarm({
        workspaceId: workspace.id,
        name: "test-swarm",
        status: "ACTIVE",
        poolName: "test-pool",
        poolApiKey: "test-api-key",
      });

      const task = await db.task.create({
        data: {
          title: "Test Task",
          workspaceId: workspace.id,
          status: "IN_PROGRESS",
          workflowStatus: "IN_PROGRESS",
          podId: "pod-123",
          agentUrl: "https://agent.example.com",
          agentPassword: "password123",
          createdById: owner.id,
          updatedById: owner.id,
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));
      
      // Mock getPodUsage to verify ownership
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            user_info: task.id,
          }),
          text: async () => JSON.stringify({ user_info: task.id }),
        })
        // Mock mark-unused
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ success: true }),
          text: async () => "Success",
        });

      const request = createPostRequest(
        `http://localhost:3000/api/pool-manager/drop-pod/${workspace.id}?podId=pod-123&taskId=${task.id}`
      );

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      const data = await expectSuccess(response, 200);
      expect(data.taskCleared).toBe(true);

      // Verify all pod fields and workflowStatus are cleared/updated
      const updatedTask = await db.task.findUnique({ where: { id: task.id } });
      expect(updatedTask?.podId).toBeNull();
      expect(updatedTask?.agentUrl).toBeNull();
      expect(updatedTask?.agentPassword).toBeNull();
      expect(updatedTask?.workflowStatus).toBe("COMPLETED");
    });

    test("handles pod reassignment gracefully", async () => {
      const { owner, workspace } = await createTestWorkspaceScenario();

      await createTestSwarm({
        workspaceId: workspace.id,
        name: "test-swarm",
        status: "ACTIVE",
        poolName: "test-pool",
        poolApiKey: "test-api-key",
      });

      const task1 = await db.task.create({
        data: {
          title: "Original Task",
          workspaceId: workspace.id,
          status: "IN_PROGRESS",
          podId: "pod-123",
          agentUrl: "https://agent.example.com",
          createdById: owner.id,
          updatedById: owner.id,
        },
      });

      const task2 = await db.task.create({
        data: {
          title: "New Task",
          workspaceId: workspace.id,
          status: "IN_PROGRESS",
          createdById: owner.id,
          updatedById: owner.id,
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));
      
      // Mock getPodUsage to show pod is reassigned to task2
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          user_info: task2.id,
        }),
        text: async () => JSON.stringify({ user_info: task2.id }),
      });

      const request = createPostRequest(
        `http://localhost:3000/api/pool-manager/drop-pod/${workspace.id}?podId=pod-123&taskId=${task1.id}`
      );

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      // Should return 409 conflict
      await expectError(response, "Pod has been reassigned to another task", 409);

      // Verify task1 has stale pod fields cleared
      const updatedTask1 = await db.task.findUnique({ where: { id: task1.id } });
      expect(updatedTask1?.podId).toBeNull();
      expect(updatedTask1?.agentUrl).toBeNull();
      expect(updatedTask1?.agentPassword).toBeNull();
      expect(updatedTask1?.workflowStatus).toBe("COMPLETED");

      // Verify pod was NOT dropped (only 1 fetch call for getPodUsage)
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    test("broadcasts Pusher event when pod is dropped successfully", async () => {
      // Set PUSHER_APP_ID to enable broadcasting
      process.env.PUSHER_APP_ID = "test-app-id";

      const { owner, workspace } = await createTestWorkspaceScenario();

      await createTestSwarm({
        workspaceId: workspace.id,
        name: "test-swarm",
        status: "ACTIVE",
        poolName: "test-pool",
        poolApiKey: "test-api-key",
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));
      setupSuccessfulPodDropMocks(false);
      mockPusherTrigger.mockResolvedValueOnce({ ok: true });

      const request = createPostRequest(
        `http://localhost:3000/api/pool-manager/drop-pod/${workspace.id}?podId=pod-123`
      );

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      await expectSuccess(response, 200);

      // Verify Pusher event was broadcast
      expect(mockPusherTrigger).toHaveBeenCalledWith(
        `workspace-${workspace.slug}`,
        'WORKSPACE_TASK_UPDATE',
        { action: 'pod-released', podId: 'pod-123' }
      );

      delete process.env.PUSHER_APP_ID;
    });

    test("continues successfully even if Pusher broadcast fails", async () => {
      // Set PUSHER_APP_ID to enable broadcasting
      process.env.PUSHER_APP_ID = "test-app-id";

      const { owner, workspace } = await createTestWorkspaceScenario();

      await createTestSwarm({
        workspaceId: workspace.id,
        name: "test-swarm",
        status: "ACTIVE",
        poolName: "test-pool",
        poolApiKey: "test-api-key",
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));
      setupSuccessfulPodDropMocks(false);
      mockPusherTrigger.mockRejectedValueOnce(new Error("Pusher error"));

      const request = createPostRequest(
        `http://localhost:3000/api/pool-manager/drop-pod/${workspace.id}?podId=pod-123`
      );

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      // Should still succeed despite Pusher failure
      await expectSuccess(response, 200);

      delete process.env.PUSHER_APP_ID;
    });
  });

  describe("Mock Environment Bypass", () => {
    test("returns mock success when MOCK_BROWSER_URL is set", async () => {
      process.env.MOCK_BROWSER_URL = "https://mock.example.com";

      const { owner, workspace } = await createTestWorkspaceScenario();

      await createTestSwarm({
        workspaceId: workspace.id,
        name: "test-swarm",
        status: "ACTIVE",
        poolName: "test-pool",
        poolApiKey: "test-api-key",
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
      expect(mockFetch).not.toHaveBeenCalled();

      delete process.env.MOCK_BROWSER_URL;
    });
  });
});
