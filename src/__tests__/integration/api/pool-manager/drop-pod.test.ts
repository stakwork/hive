import { describe, test, beforeEach, vi, expect, afterEach } from "vitest";
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
  generateUniqueId,
} from "@/__tests__/support/helpers";
import {
  createTestUser,
  createTestWorkspaceScenario,
  createTestSwarm,
  createTestRepository,
} from "@/__tests__/support/fixtures";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import type { User, Workspace, Swarm, Repository } from "@prisma/client";

// Mock dependencies
vi.mock("@/lib/pods", () => ({
  dropPod: vi.fn(),
  getPodFromPool: vi.fn(),
  updatePodRepositories: vi.fn(),
  POD_PORTS: {
    CONTROL: "15552",
  },
}));

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

import { dropPod, getPodFromPool, updatePodRepositories } from "@/lib/pods";

const mockDropPod = vi.mocked(dropPod);
const mockGetPodFromPool = vi.mocked(getPodFromPool);
const mockUpdatePodRepositories = vi.mocked(updatePodRepositories);

describe("POST /api/pool-manager/drop-pod/[workspaceId]", () => {
  let owner: User;
  let workspace: Workspace;
  let swarm: Swarm;
  let repository: Repository;
  const encryptionService = EncryptionService.getInstance();

  beforeEach(async () => {
    vi.clearAllMocks();

    // Create test scenario
    const scenario = await createTestWorkspaceScenario({
      owner: { name: "Pod Drop Owner", email: "owner@test.com" },
    });

    owner = scenario.owner;
    workspace = scenario.workspace;

    // Create repository
    repository = await createTestRepository({
      workspaceId: workspace.id,
      repositoryUrl: "https://github.com/test/repo",
      branch: "main",
    });

    // Create swarm
    const swarmId = generateUniqueId("swarm");
    swarm = await createTestSwarm({
      workspaceId: workspace.id,
      name: `test-swarm-${swarmId}`,
      swarmId: swarmId,
      status: "ACTIVE",
    });

    // Setup default mocks
    const encryptedApiKey = encryptionService.encryptField("poolApiKey", "test-api-key");
    await db.swarm.update({
      where: { id: swarm.id },
      data: {
        poolApiKey: JSON.stringify(encryptedApiKey),
        poolName: "test-pool",
      },
    });

    mockDropPod.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Authentication", () => {
    test("returns 401 when not authenticated", async () => {
      getMockedSession().mockResolvedValue(null);

      const request = createPostRequest(
        `http://localhost/api/pool-manager/drop-pod/${workspace.id}?podId=test-pod-123`
      );
      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      await expectUnauthorized(response);
      expect(mockDropPod).not.toHaveBeenCalled();
    });

    test("returns 401 when session has no user", async () => {
      getMockedSession().mockResolvedValue({ user: null } as any);

      const request = createPostRequest(
        `http://localhost/api/pool-manager/drop-pod/${workspace.id}?podId=test-pod-123`
      );
      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      await expectUnauthorized(response);
      expect(mockDropPod).not.toHaveBeenCalled();
    });

    test("returns 401 when session.user has no id", async () => {
      const session = createAuthenticatedSession(owner);
      delete (session.user as any).id;
      getMockedSession().mockResolvedValue(session);

      const request = createPostRequest(
        `http://localhost/api/pool-manager/drop-pod/${workspace.id}?podId=test-pod-123`
      );
      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      await expectError(response, "Invalid user session", 401);
      expect(mockDropPod).not.toHaveBeenCalled();
    });
  });

  describe("Input Validation", () => {
    test("returns 400 when workspaceId is missing", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const request = createPostRequest(
        "http://localhost/api/pool-manager/drop-pod/?podId=test-pod-123"
      );
      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: "" }),
      });

      await expectError(response, "Missing required field: workspaceId", 400);
      expect(mockDropPod).not.toHaveBeenCalled();
    });

    test("returns 400 when podId query parameter is missing", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const request = createPostRequest(
        `http://localhost/api/pool-manager/drop-pod/${workspace.id}`
      );
      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      await expectError(response, "Missing required field: podId", 400);
      expect(mockDropPod).not.toHaveBeenCalled();
    });

    test("returns 400 when podId is empty string", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const request = createPostRequest(
        `http://localhost/api/pool-manager/drop-pod/${workspace.id}?podId=`
      );
      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      await expectError(response, "Missing required field: podId", 400);
      expect(mockDropPod).not.toHaveBeenCalled();
    });
  });

  describe("Workspace Validation", () => {
    test("returns 404 when workspace not found", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const request = createPostRequest(
        "http://localhost/api/pool-manager/drop-pod/nonexistent-workspace-id?podId=test-pod-123"
      );
      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: "nonexistent-workspace-id" }),
      });

      await expectNotFound(response, "Workspace not found");
      expect(mockDropPod).not.toHaveBeenCalled();
    });

    test("returns 404 when workspace has no swarm", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      await db.swarm.delete({ where: { id: swarm.id } });

      const request = createPostRequest(
        `http://localhost/api/pool-manager/drop-pod/${workspace.id}?podId=test-pod-123`
      );
      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      await expectNotFound(response, "No swarm found for this workspace");
      expect(mockDropPod).not.toHaveBeenCalled();
    });

    test("returns 400 when swarm missing poolApiKey", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      await db.swarm.update({
        where: { id: swarm.id },
        data: { poolApiKey: null },
      });

      const request = createPostRequest(
        `http://localhost/api/pool-manager/drop-pod/${workspace.id}?podId=test-pod-123`
      );
      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      await expectError(response, "Swarm not properly configured with pool information", 400);
      expect(mockDropPod).not.toHaveBeenCalled();
    });
  });

  describe("Authorization", () => {
    test("returns 403 when user is not owner or member", async () => {
      const nonMember = await createTestUser({ email: "nonmember@test.com" });
      getMockedSession().mockResolvedValue(createAuthenticatedSession(nonMember));

      const request = createPostRequest(
        `http://localhost/api/pool-manager/drop-pod/${workspace.id}?podId=test-pod-123`
      );
      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      await expectForbidden(response, "Access denied");
      expect(mockDropPod).not.toHaveBeenCalled();
    });

    test("allows workspace owner to drop pod", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const request = createPostRequest(
        `http://localhost/api/pool-manager/drop-pod/${workspace.id}?podId=test-pod-123`
      );
      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      const data = await expectSuccess(response, 200);
      expect(data.success).toBe(true);
      expect(data.message).toBe("Pod dropped successfully");
      expect(mockDropPod).toHaveBeenCalledWith(swarm.id, "test-pod-123", "decrypted-api-key");
    });

    test("allows workspace member to drop pod", async () => {
      const member = await createTestUser({ email: "member@test.com" });
      await db.workspaceMember.create({
        data: {
          workspaceId: workspace.id,
          userId: member.id,
          role: "DEVELOPER",
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(member));

      const request = createPostRequest(
        `http://localhost/api/pool-manager/drop-pod/${workspace.id}?podId=test-pod-456`
      );
      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      const data = await expectSuccess(response, 200);
      expect(data.success).toBe(true);
      expect(data.message).toBe("Pod dropped successfully");
      expect(mockDropPod).toHaveBeenCalledWith(swarm.id, "test-pod-456", "decrypted-api-key");
    });
  });

  describe("Successful Pod Drop", () => {
    test("successfully drops pod with basic flow", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const request = createPostRequest(
        `http://localhost/api/pool-manager/drop-pod/${workspace.id}?podId=test-pod-789`
      );
      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      const data = await expectSuccess(response, 200);
      expect(data.success).toBe(true);
      expect(data.message).toBe("Pod dropped successfully");
      expect(mockDropPod).toHaveBeenCalledWith(swarm.id, "test-pod-789", "decrypted-api-key");
      expect(mockDropPod).toHaveBeenCalledTimes(1);
      expect(mockGetPodFromPool).not.toHaveBeenCalled();
      expect(mockUpdatePodRepositories).not.toHaveBeenCalled();
    });

    test("calls dropPod with correct parameters", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const request = createPostRequest(
        `http://localhost/api/pool-manager/drop-pod/${workspace.id}?podId=specific-pod-id`
      );
      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      await expectSuccess(response, 200);
      expect(mockDropPod).toHaveBeenCalledWith(
        swarm.id,
        "specific-pod-id",
        "decrypted-api-key"
      );
    });

    test("decrypts poolApiKey before dropping pod", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const request = createPostRequest(
        `http://localhost/api/pool-manager/drop-pod/${workspace.id}?podId=test-pod-123`
      );
      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      await expectSuccess(response, 200);
      expect(mockDropPod).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        "decrypted-api-key"
      );
    });
  });

  describe("Repository Reset with ?latest=true", () => {
    test("resets repositories when latest=true", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const mockPodWorkspace = {
        id: "workspace-123",
        password: "test-password",
        url: "https://ide.example.com",
        portMappings: {
          "15552": "https://control.example.com",
        },
      };

      mockGetPodFromPool.mockResolvedValue(mockPodWorkspace);
      mockUpdatePodRepositories.mockResolvedValue(undefined);

      const request = createPostRequest(
        `http://localhost/api/pool-manager/drop-pod/${workspace.id}?podId=test-pod-123&latest=true`
      );
      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      const data = await expectSuccess(response, 200);
      expect(data.success).toBe(true);
      expect(mockGetPodFromPool).toHaveBeenCalledWith("test-pod-123", "decrypted-api-key");
      expect(mockUpdatePodRepositories).toHaveBeenCalledWith(
        "https://control.example.com",
        "test-password",
        [{ url: repository.repositoryUrl }]
      );
      expect(mockDropPod).toHaveBeenCalledWith(swarm.id, "test-pod-123", "decrypted-api-key");
    });

    test("skips repository reset when control port not found", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const mockPodWorkspace = {
        id: "workspace-123",
        password: "test-password",
        url: "https://ide.example.com",
        portMappings: {},
      };

      mockGetPodFromPool.mockResolvedValue(mockPodWorkspace);

      const request = createPostRequest(
        `http://localhost/api/pool-manager/drop-pod/${workspace.id}?podId=test-pod-123&latest=true`
      );
      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      const data = await expectSuccess(response, 200);
      expect(data.success).toBe(true);
      expect(mockGetPodFromPool).toHaveBeenCalled();
      expect(mockUpdatePodRepositories).not.toHaveBeenCalled();
      expect(mockDropPod).toHaveBeenCalled();
    });

    test("continues to drop pod even if repository reset fails", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const mockPodWorkspace = {
        id: "workspace-123",
        password: "test-password",
        url: "https://ide.example.com",
        portMappings: {
          "15552": "https://control.example.com",
        },
      };

      mockGetPodFromPool.mockResolvedValue(mockPodWorkspace);
      mockUpdatePodRepositories.mockRejectedValue(new Error("Repository update failed"));

      const request = createPostRequest(
        `http://localhost/api/pool-manager/drop-pod/${workspace.id}?podId=test-pod-123&latest=true`
      );
      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      const data = await expectSuccess(response, 200);
      expect(data.success).toBe(true);
      expect(mockGetPodFromPool).toHaveBeenCalled();
      expect(mockUpdatePodRepositories).toHaveBeenCalled();
      expect(mockDropPod).toHaveBeenCalled();
    });

    test("skips repository reset when no repositories configured", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      await db.repository.delete({ where: { id: repository.id } });

      const mockPodWorkspace = {
        id: "workspace-123",
        password: "test-password",
        url: "https://ide.example.com",
        portMappings: {
          "15552": "https://control.example.com",
        },
      };

      mockGetPodFromPool.mockResolvedValue(mockPodWorkspace);

      const request = createPostRequest(
        `http://localhost/api/pool-manager/drop-pod/${workspace.id}?podId=test-pod-123&latest=true`
      );
      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      const data = await expectSuccess(response, 200);
      expect(data.success).toBe(true);
      expect(mockGetPodFromPool).toHaveBeenCalled();
      expect(mockUpdatePodRepositories).not.toHaveBeenCalled();
      expect(mockDropPod).toHaveBeenCalled();
    });

    test("does not reset repositories when latest=false", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const request = createPostRequest(
        `http://localhost/api/pool-manager/drop-pod/${workspace.id}?podId=test-pod-123&latest=false`
      );
      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      const data = await expectSuccess(response, 200);
      expect(data.success).toBe(true);
      expect(mockGetPodFromPool).not.toHaveBeenCalled();
      expect(mockUpdatePodRepositories).not.toHaveBeenCalled();
      expect(mockDropPod).toHaveBeenCalled();
    });
  });

  describe("Service Error Handling", () => {
    test("handles 404 error from Pool Manager service", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const apiError = {
        status: 404,
        service: "pool-manager",
        message: "Pod not found",
        details: { podId: "test-pod-123" },
      };

      mockDropPod.mockRejectedValue(apiError);

      const request = createPostRequest(
        `http://localhost/api/pool-manager/drop-pod/${workspace.id}?podId=test-pod-123`
      );
      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      await expectError(response, "Pod not found", 404);
    });

    test("handles 403 forbidden error from service", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const apiError = {
        status: 403,
        service: "pool-manager",
        message: "Insufficient permissions",
      };

      mockDropPod.mockRejectedValue(apiError);

      const request = createPostRequest(
        `http://localhost/api/pool-manager/drop-pod/${workspace.id}?podId=test-pod-123`
      );
      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      await expectError(response, "Insufficient permissions", 403);
    });

    test("handles 500 service unavailable error", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const apiError = {
        status: 500,
        service: "pool-manager",
        message: "Internal server error",
      };

      mockDropPod.mockRejectedValue(apiError);

      const request = createPostRequest(
        `http://localhost/api/pool-manager/drop-pod/${workspace.id}?podId=test-pod-123`
      );
      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      await expectError(response, "Internal server error", 500);
    });

    test("handles 401 invalid API key error", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const apiError = {
        status: 401,
        service: "pool-manager",
        message: "Invalid or expired API key",
      };

      mockDropPod.mockRejectedValue(apiError);

      const request = createPostRequest(
        `http://localhost/api/pool-manager/drop-pod/${workspace.id}?podId=test-pod-123`
      );
      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      await expectError(response, "Invalid or expired API key", 401);
    });

    test("handles generic errors without ApiError structure", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      mockDropPod.mockRejectedValue(new Error("Network timeout"));

      const request = createPostRequest(
        `http://localhost/api/pool-manager/drop-pod/${workspace.id}?podId=test-pod-123`
      );
      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      await expectError(response, "Failed to drop pod", 500);
    });

    test("handles network failure when dropping pod", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      mockDropPod.mockRejectedValue(new Error("fetch failed"));

      const request = createPostRequest(
        `http://localhost/api/pool-manager/drop-pod/${workspace.id}?podId=test-pod-123`
      );
      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      await expectError(response, "Failed to drop pod", 500);
    });
  });

  describe("Mock Environment Bypass", () => {
    test("returns mock success when MOCK_BROWSER_URL is set", async () => {
      process.env.MOCK_BROWSER_URL = "https://mock.example.com";

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const request = createPostRequest(
        `http://localhost/api/pool-manager/drop-pod/${workspace.id}?podId=test-pod-123`
      );
      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      const data = await expectSuccess(response, 200);
      expect(data.success).toBe(true);
      expect(data.message).toBe("Pod dropped successfully");
      expect(mockDropPod).not.toHaveBeenCalled();

      delete process.env.MOCK_BROWSER_URL;
    });

    test("bypasses all validations when MOCK_BROWSER_URL is set", async () => {
      process.env.MOCK_BROWSER_URL = "https://mock.example.com";

      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      await db.swarm.update({
        where: { id: swarm.id },
        data: { poolApiKey: null },
      });

      const request = createPostRequest(
        `http://localhost/api/pool-manager/drop-pod/${workspace.id}?podId=test-pod-123`
      );
      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      const data = await expectSuccess(response, 200);
      expect(data.success).toBe(true);
      expect(mockDropPod).not.toHaveBeenCalled();

      delete process.env.MOCK_BROWSER_URL;
    });
  });

  describe("Edge Cases", () => {
    test("handles multiple repositories in reset flow", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const repo2 = await createTestRepository({
        workspaceId: workspace.id,
        repositoryUrl: "https://github.com/test/repo2",
        branch: "develop",
      });

      const mockPodWorkspace = {
        id: "workspace-123",
        password: "test-password",
        url: "https://ide.example.com",
        portMappings: {
          "15552": "https://control.example.com",
        },
      };

      mockGetPodFromPool.mockResolvedValue(mockPodWorkspace);
      mockUpdatePodRepositories.mockResolvedValue(undefined);

      const request = createPostRequest(
        `http://localhost/api/pool-manager/drop-pod/${workspace.id}?podId=test-pod-123&latest=true`
      );
      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      const data = await expectSuccess(response, 200);
      expect(data.success).toBe(true);
      expect(mockUpdatePodRepositories).toHaveBeenCalledWith(
        "https://control.example.com",
        "test-password",
        expect.arrayContaining([
          { url: repository.repositoryUrl },
          { url: repo2.repositoryUrl },
        ])
      );
    });

    test("uses swarm.id when poolName is null", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      await db.swarm.update({
        where: { id: swarm.id },
        data: { poolName: null },
      });

      const request = createPostRequest(
        `http://localhost/api/pool-manager/drop-pod/${workspace.id}?podId=test-pod-123`
      );
      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      const data = await expectSuccess(response, 200);
      expect(data.success).toBe(true);
      expect(mockDropPod).toHaveBeenCalledWith(swarm.id, "test-pod-123", "decrypted-api-key");
    });

    test("handles special characters in podId", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(owner));

      const request = createPostRequest(
        `http://localhost/api/pool-manager/drop-pod/${workspace.id}?podId=pod-with-special-chars_123-456`
      );
      const response = await POST(request, {
        params: Promise.resolve({ workspaceId: workspace.id }),
      });

      const data = await expectSuccess(response, 200);
      expect(data.success).toBe(true);
      expect(mockDropPod).toHaveBeenCalledWith(
        swarm.id,
        "pod-with-special-chars_123-456",
        "decrypted-api-key"
      );
    });
  });
});