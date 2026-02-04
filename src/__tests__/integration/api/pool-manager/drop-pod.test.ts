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
import { createTestPod } from "@/__tests__/support/factories/pod.factory";
import { db } from "@/lib/db";

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

describe("POST /api/pool-manager/drop-pod/[workspaceId] - Integration Tests", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

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

      const swarm = await createTestSwarm({
        workspaceId: workspace.id,
        name: "test-swarm",
        status: "ACTIVE",
        poolName: "test-pool",
        poolApiKey: "test-api-key",
      });

      // Create a pod in the database
      const pod = await createTestPod({
        podId: "pod-owner-test",
        swarmId: swarm.id,
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const request = createPostRequest(
        `http://localhost:3000/api/pool-manager/drop-pod/${workspace.id}?podId=${pod.podId}`
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
        poolName: "test-pool",
        poolApiKey: "test-api-key",
      });

      // Create a pod in the database
      const pod = await createTestPod({
        podId: "pod-member-test",
        swarmId: swarm.id,
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(memberUser));

      const request = createPostRequest(
        `http://localhost:3000/api/pool-manager/drop-pod/${workspace.id}?podId=${pod.podId}`
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

      const swarm = await createTestSwarm({
        workspaceId: workspace.id,
        name: "test-swarm",
        status: "ACTIVE",
        poolName: "test-pool",
        poolApiKey: "test-api-key",
      });

      // Create a pod in the database
      const pod = await createTestPod({
        podId: "pod-123",
        swarmId: swarm.id,
        portMappings: {
          "3000": "30000",
          "3010": "30010",
          "15551": "31551",
          "15552": "31552",
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const request = createPostRequest(
        `http://localhost:3000/api/pool-manager/drop-pod/${workspace.id}?podId=${pod.podId}`
      );

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      const data = await expectSuccess(response, 200);
      expect(data.success).toBe(true);
      expect(data.message).toBe("Pod dropped successfully");
    });

    test("returns 404 when pod does not exist", async () => {
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
        `http://localhost:3000/api/pool-manager/drop-pod/${workspace.id}?podId=nonexistent-pod&latest=true`
      );

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      await expectNotFound(response, "Pod not found");
    });
  });

  describe("Optional Repository Reset", () => {
    test("resets repositories when latest=true and pod exists", async () => {
      const { owner, workspace } = await createTestWorkspaceScenario();

      const swarm = await createTestSwarm({
        workspaceId: workspace.id,
        name: "test-swarm",
        status: "ACTIVE",
        poolName: "test-pool",
        poolApiKey: "test-api-key",
      });

      // Create a pod in the database with control port
      const pod = await createTestPod({
        podId: "pod-with-repos",
        swarmId: swarm.id,
        portMappings: {
          "3000": "30000",
          "3010": "30010",
          "15551": "31551",
          "15552": "https://control.example.com", // Control port
        },
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

      // Mock updatePodRepositories fetch call
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
        text: async () => "Success",
      });

      const request = createPostRequest(
        `http://localhost:3000/api/pool-manager/drop-pod/${workspace.id}?podId=${pod.podId}&latest=true`
      );

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      await expectSuccess(response, 200);

      // Should call updatePodRepositories
      expect(mockFetch).toHaveBeenCalledWith(
        "https://control.example.com/latest",
        expect.objectContaining({
          method: "PUT",
        })
      );
    });

    test("handles missing control port gracefully when latest=true", async () => {
      const { owner, workspace } = await createTestWorkspaceScenario();

      const swarm = await createTestSwarm({
        workspaceId: workspace.id,
        name: "test-swarm",
        status: "ACTIVE",
        poolName: "test-pool",
        poolApiKey: "test-api-key",
      });

      // Create a pod without control port
      const pod = await createTestPod({
        podId: "pod-no-control",
        swarmId: swarm.id,
        portMappings: {
          "3000": "30000",
        },
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

      const request = createPostRequest(
        `http://localhost:3000/api/pool-manager/drop-pod/${workspace.id}?podId=${pod.podId}&latest=true`
      );

      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      // Should succeed despite missing control port
      await expectSuccess(response, 200);

      // Should not call updatePodRepositories
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });
});
