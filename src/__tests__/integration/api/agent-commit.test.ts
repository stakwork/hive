import { describe, test, expect, beforeEach, vi } from "vitest";
import { POST } from "@/app/api/agent/commit/route";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { TaskStatus, Priority } from "@prisma/client";
import {
  createAuthenticatedSession,
  mockUnauthenticatedSession,
  expectSuccess,
  expectError,
  expectUnauthorized,
  expectForbidden,
  expectNotFound,
  generateUniqueId,
  generateUniqueSlug,
  createPostRequest,
  getMockedSession,
} from "@/__tests__/support/helpers";
import { createTestUser } from "@/__tests__/support/fixtures/user";

// Mock external dependencies
global.fetch = vi.fn();

// Mock encryption service
vi.mock("@/lib/encryption", () => ({
  EncryptionService: {
    getInstance: vi.fn(() => ({
      decryptField: vi.fn((fieldName: string, value: string) => {
        // Return mock decrypted values
        if (fieldName === "poolApiKey") return "test-pool-api-key";
        if (fieldName === "source_control_token") return "github_pat_test_token";
        return "decrypted-value";
      }),
      encryptField: vi.fn((fieldName: string, value: string) => ({
        data: Buffer.from(value).toString("base64"),
        iv: "test-iv",
        tag: "test-tag",
        version: "v1",
        encryptedAt: new Date().toISOString(),
      })),
    })),
  },
}));

// Mock pod utility functions
vi.mock("@/lib/pods/utils", () => ({
  getPodFromPool: vi.fn(),
  POD_PORTS: {
    CONTROL: "3010",
  },
}));

// Mock GitHub App functions
vi.mock("@/lib/githubApp", () => ({
  getUserAppTokens: vi.fn(),
}));

const mockFetch = global.fetch as vi.MockedFunction<typeof global.fetch>;

describe("POST /api/agent/commit Integration Tests", () => {
  const encryptionService = EncryptionService.getInstance();

  // Helper to create complete test data with all required relationships
  async function createTestDataWithCommitCapabilities() {
    return await db.$transaction(async (tx) => {
      // Create test user
      const user = await tx.user.create({
        data: {
          email: `test-${generateUniqueId()}@example.com`,
          name: "Test User",
        },
      });

      // Create GitHub auth for user
      const githubAuth = await tx.gitHubAuth.create({
        data: {
          userId: user.id,
          githubUserId: "12345",
          githubUsername: "testuser",
          githubNodeId: "test-node-id",
        },
      });

      // Create source control org
      const sourceControlOrg = await tx.sourceControlOrg.create({
        data: {
          githubLogin: "test-org",
          githubInstallationId: 123456,
          type: "ORG",
          name: "Test Organization",
        },
      });

      // Create source control token (encrypted)
      const encryptedToken = encryptionService.encryptField("source_control_token", "github_pat_test_token");
      await tx.sourceControlToken.create({
        data: {
          userId: user.id,
          sourceControlOrgId: sourceControlOrg.id,
          token: JSON.stringify(encryptedToken),
          scopes: ["repo", "write:org"],
        },
      });

      // Create workspace
      const workspace = await tx.workspace.create({
        data: {
          name: "Test Workspace",
          slug: generateUniqueSlug("test-workspace"),
          ownerId: user.id,
          sourceControlOrgId: sourceControlOrg.id,
        },
      });

      // Create swarm with encrypted poolApiKey
      const encryptedPoolApiKey = encryptionService.encryptField("poolApiKey", "test-pool-api-key");
      const swarm = await tx.swarm.create({
        data: {
          name: `test-swarm-${Date.now()}`,
          swarmId: `swarm-${Date.now()}`,
          status: "ACTIVE",
          instanceType: "XL",
          workspaceId: workspace.id,
          poolState: "COMPLETE",
          poolName: "test-pool",
          poolApiKey: JSON.stringify(encryptedPoolApiKey),
          swarmApiKey: "test-swarm-api-key",
          swarmSecretAlias: "{{SWARM_TEST_API_KEY}}",
        },
      });

      // Create repositories
      const repository = await tx.repository.create({
        data: {
          name: "test-repo",
          repositoryUrl: "https://github.com/test-org/test-repo",
          branch: "main",
          status: "SYNCED",
          workspaceId: workspace.id,
        },
      });
      const feature = await tx.feature.create({
        data: {
          title: "Test Feature",
          workspaceId: workspace.id,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      // Create test task
      const task = await tx.task.create({
        data: {
          workspaceId: workspace.id,
          title: "Task 2",
          featureId: feature.id,
          status: TaskStatus.TODO,
          priority: Priority.MEDIUM,
          order: 1,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      return {
        user,
        githubAuth,
        sourceControlOrg,
        workspace,
        swarm,
        repository,
        task,
      };
    });
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    mockFetch.mockClear();
  });

  describe("Authentication Tests", () => {
    test("should return 401 when user not authenticated", async () => {
      getMockedSession().mockResolvedValue(mockUnauthenticatedSession());

      const request = createPostRequest("http://localhost:3000/api/agent/commit", {
        podId: "test-pod-id",
        workspaceId: "test-workspace-id",
        taskId: "test-task-id",
        commitMessage: "Test commit",
        branchName: "feature/test",
      });

      const response = await POST(request);
      await expectUnauthorized(response);
    });

    test("should return 401 when user session has no id", async () => {
      getMockedSession().mockResolvedValue({
        user: { email: "test@example.com", name: "Test User" },
      });

      const request = createPostRequest("http://localhost:3000/api/agent/commit", {
        podId: "test-pod-id",
        workspaceId: "test-workspace-id",
        taskId: "test-task-id",
        commitMessage: "Test commit",
        branchName: "feature/test",
      });

      const response = await POST(request);

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "Invalid user session" });
    });
  });

  describe("Validation Tests", () => {
    test("should return 400 when podId is missing", async () => {
      const { user, workspace } = await createTestDataWithCommitCapabilities();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createPostRequest("http://localhost:3000/api/agent/commit", {
        workspaceId: workspace.id,
        taskId: "test-task-id",
        commitMessage: "Test commit",
        branchName: "feature/test",
      });

      const response = await POST(request);
      await expectError(response, "Missing required field: podId", 400);
    });

    test("should return 400 when workspaceId is missing", async () => {
      const { user } = await createTestDataWithCommitCapabilities();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createPostRequest("http://localhost:3000/api/agent/commit", {
        podId: "test-pod-id",
        taskId: "test-task-id",
        commitMessage: "Test commit",
        branchName: "feature/test",
      });

      const response = await POST(request);
      await expectError(response, "Missing required field: workspaceId", 400);
    });

    test("should return 400 when taskId is missing", async () => {
      const { user, workspace } = await createTestDataWithCommitCapabilities();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createPostRequest("http://localhost:3000/api/agent/commit", {
        podId: "test-pod-id",
        workspaceId: workspace.id,
        commitMessage: "Test commit",
        branchName: "feature/test",
      });

      const response = await POST(request);
      await expectError(response, "Missing required field: taskId", 400);
    });

    test("should return 400 when commitMessage is missing", async () => {
      const { user, workspace } = await createTestDataWithCommitCapabilities();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createPostRequest("http://localhost:3000/api/agent/commit", {
        podId: "test-pod-id",
        workspaceId: workspace.id,
        taskId: "test-task-id",
        branchName: "feature/test",
      });

      const response = await POST(request);
      await expectError(response, "Missing required field: commitMessage", 400);
    });

    test("should return 400 when branchName is missing", async () => {
      const { user, workspace } = await createTestDataWithCommitCapabilities();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createPostRequest("http://localhost:3000/api/agent/commit", {
        podId: "test-pod-id",
        workspaceId: workspace.id,
        taskId: "test-task-id",
        commitMessage: "Test commit",
      });

      const response = await POST(request);
      await expectError(response, "Missing required field: branchName", 400);
    });
  });

  describe("Authorization Tests", () => {
    test("should return 404 when workspace not found", async () => {
      const user = await createTestUser();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createPostRequest("http://localhost:3000/api/agent/commit", {
        podId: "test-pod-id",
        workspaceId: "non-existent-workspace-id",
        taskId: "test-task-id",
        commitMessage: "Test commit",
        branchName: "feature/test",
      });

      const response = await POST(request);
      await expectNotFound(response, "Workspace not found");
    });

    test("should return 403 when user is not workspace owner or member", async () => {
      const { workspace } = await createTestDataWithCommitCapabilities();
      const unauthorizedUser = await createTestUser({ name: "Unauthorized User" });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(unauthorizedUser));

      const request = createPostRequest("http://localhost:3000/api/agent/commit", {
        podId: "test-pod-id",
        workspaceId: workspace.id,
        taskId: "test-task-id",
        commitMessage: "Test commit",
        branchName: "feature/test",
      });

      const response = await POST(request);
      await expectForbidden(response);
    });

    test("should allow workspace owner to commit", async () => {
      const { user, workspace } = await createTestDataWithCommitCapabilities();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      // Set mock mode to bypass pod communication
      process.env.MOCK_BROWSER_URL = "http://mock.dev";

      const request = createPostRequest("http://localhost:3000/api/agent/commit", {
        podId: "test-pod-id",
        workspaceId: workspace.id,
        taskId: "test-task-id",
        commitMessage: "Test commit",
        branchName: "feature/test",
      });

      const response = await POST(request);
      const data = await expectSuccess(response);

      expect(data.success).toBe(true);
      expect(data.message).toBe("Commit successful (mock)");

      // Cleanup
      delete process.env.MOCK_BROWSER_URL;
    });

    test("should allow workspace member to commit", async () => {
      const { workspace } = await createTestDataWithCommitCapabilities();
      const memberUser = await createTestUser({ name: "Member User" });

      // Add user as workspace member
      await db.workspaceMember.create({
        data: {
          userId: memberUser.id,
          workspaceId: workspace.id,
          role: "DEVELOPER",
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(memberUser));

      // Set mock mode to bypass pod communication
      process.env.MOCK_BROWSER_URL = "http://mock.dev";

      const request = createPostRequest("http://localhost:3000/api/agent/commit", {
        podId: "test-pod-id",
        workspaceId: workspace.id,
        taskId: "test-task-id",
        commitMessage: "Test commit",
        branchName: "feature/test",
      });

      const response = await POST(request);
      const data = await expectSuccess(response);

      expect(data.success).toBe(true);
      expect(data.message).toBe("Commit successful (mock)");

      // Cleanup
      delete process.env.MOCK_BROWSER_URL;
    });
  });

  describe("Configuration Tests", () => {
    test("should return 404 when workspace has no swarm", async () => {
      const user = await createTestUser();
      const workspace = await db.workspace.create({
        data: {
          name: "Test Workspace",
          slug: generateUniqueSlug("test-workspace"),
          ownerId: user.id,
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createPostRequest("http://localhost:3000/api/agent/commit", {
        podId: "test-pod-id",
        workspaceId: workspace.id,
        taskId: "test-task-id",
        commitMessage: "Test commit",
        branchName: "feature/test",
      });

      const response = await POST(request);
      await expectNotFound(response, "No swarm found for this workspace");
    });

    test("should return 400 when swarm has no pool configuration", async () => {
      const user = await createTestUser();
      const workspace = await db.workspace.create({
        data: {
          name: "Test Workspace",
          slug: generateUniqueSlug("test-workspace"),
          ownerId: user.id,
        },
      });

      // Create swarm without poolApiKey
      await db.swarm.create({
        data: {
          name: `test-swarm-${Date.now()}`,
          status: "ACTIVE",
          instanceType: "XL",
          workspaceId: workspace.id,
          poolState: "COMPLETE",
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createPostRequest("http://localhost:3000/api/agent/commit", {
        podId: "test-pod-id",
        workspaceId: workspace.id,
        taskId: "test-task-id",
        commitMessage: "Test commit",
        branchName: "feature/test",
      });

      const response = await POST(request);
      await expectError(response, "Swarm not properly configured with pool information", 400);
    });

    test("should return 400 when workspace has no source control org", async () => {
      const user = await createTestUser();
      const workspace = await db.workspace.create({
        data: {
          name: "Test Workspace",
          slug: generateUniqueSlug("test-workspace"),
          ownerId: user.id,
        },
      });

      const encryptedPoolApiKey = encryptionService.encryptField("poolApiKey", "test-pool-api-key");
      await db.swarm.create({
        data: {
          name: `test-swarm-${Date.now()}`,
          status: "ACTIVE",
          instanceType: "XL",
          workspaceId: workspace.id,
          poolState: "COMPLETE",
          poolApiKey: JSON.stringify(encryptedPoolApiKey),
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      // Mock getPodFromPool
      const { getPodFromPool } = await import("@/lib/pods/utils");
      vi.mocked(getPodFromPool).mockResolvedValue({
        id: "test-pod-id",
        password: "test-password",
        portMappings: { "3010": "http://localhost:3010" },
      } as any);

      const request = createPostRequest("http://localhost:3000/api/agent/commit", {
        podId: "test-pod-id",
        workspaceId: workspace.id,
        taskId: "test-task-id",
        commitMessage: "Test commit",
        branchName: "feature/test",
      });

      const response = await POST(request);
      await expectError(response, "No GitHub organization linked to this workspace", 400);
    });
  });

  describe("GitHub Authentication Tests", () => {
    test("should return 401 when GitHub access token not found", async () => {
      const { user, workspace } = await createTestDataWithCommitCapabilities();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      // Mock getPodFromPool
      const { getPodFromPool } = await import("@/lib/pods/utils");
      vi.mocked(getPodFromPool).mockResolvedValue({
        id: "test-pod-id",
        password: "test-password",
        portMappings: { "3010": "http://localhost:3010" },
      } as any);

      // Mock getUserAppTokens to return null (no token)
      const { getUserAppTokens } = await import("@/lib/githubApp");
      vi.mocked(getUserAppTokens).mockResolvedValue(null);

      const request = createPostRequest("http://localhost:3000/api/agent/commit", {
        podId: "test-pod-id",
        workspaceId: workspace.id,
        taskId: "test-task-id",
        commitMessage: "Test commit",
        branchName: "feature/test",
      });

      const response = await POST(request);

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.error).toBe("GitHub authentication required. Please reconnect your GitHub account.");
    });

    test("should return 401 when GitHub username not found", async () => {
      const { user, workspace } = await createTestDataWithCommitCapabilities();

      // Remove GitHub auth
      await db.gitHubAuth.deleteMany({ where: { userId: user.id } });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      // Mock getPodFromPool
      const { getPodFromPool } = await import("@/lib/pods/utils");
      vi.mocked(getPodFromPool).mockResolvedValue({
        id: "test-pod-id",
        password: "test-password",
        portMappings: { "3010": "http://localhost:3010" },
      } as any);

      // Mock getUserAppTokens to return token
      const { getUserAppTokens } = await import("@/lib/githubApp");
      vi.mocked(getUserAppTokens).mockResolvedValue({
        accessToken: "github_pat_test_token",
      });

      const request = createPostRequest("http://localhost:3000/api/agent/commit", {
        podId: "test-pod-id",
        workspaceId: workspace.id,
        taskId: "test-task-id",
        commitMessage: "Test commit",
        branchName: "feature/test",
      });

      const response = await POST(request);

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.error).toBe("GitHub username not found. Please reconnect your GitHub account.");
    });
  });

  describe("Pod Communication Tests", () => {
    test("should successfully commit and push to pod control port", async () => {
      const { user, workspace, repository, task } = await createTestDataWithCommitCapabilities();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      // Mock getPodFromPool
      const { getPodFromPool } = await import("@/lib/pods/utils");
      vi.mocked(getPodFromPool).mockResolvedValue({
        id: "test-pod-id",
        password: "test-password",
        portMappings: { "3010": "http://localhost:3010" },
        url: "http://test-pod.dev",
        state: "running",
        repositories: ["https://github.com/test-org/test-repo"],
      } as any);

      // Mock getUserAppTokens
      const { getUserAppTokens } = await import("@/lib/githubApp");
      vi.mocked(getUserAppTokens).mockResolvedValue({
        accessToken: "github_pat_test_token",
      });

      // Mock successful push response with prs
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          message: "Push successful",
          prs: { "test-org/test-repo": "https://github.com/test-org/test-repo/pull/123" },
        }),
      } as Response);

      const request = createPostRequest("http://localhost:3000/api/agent/commit", {
        podId: "test-pod-id",
        workspaceId: workspace.id,
        taskId: task.id,
        commitMessage: "Test commit message",
        branchName: "feature/test-branch",
      });

      const response = await POST(request);
      const data = await expectSuccess(response);

      expect(data.success).toBe(true);
      expect(data.message).toBe("Commit and push successful");
      expect(Object.keys(data.data.prs)).toHaveLength(1);
      expect(data.data.prs["test-org/test-repo"]).toBe("https://github.com/test-org/test-repo/pull/123");

      // Verify fetch was called once for push with commit
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Verify push request includes commit
      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3010/push?pr=true&commit=true",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            Authorization: "Bearer test-password",
            "Content-Type": "application/json",
          }),
          body: expect.stringContaining("Test commit message"),
        }),
      );
    });

    test("should handle commit failure from pod", async () => {
      const { user, workspace } = await createTestDataWithCommitCapabilities();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      // Mock getPodFromPool
      const { getPodFromPool } = await import("@/lib/pods/utils");
      vi.mocked(getPodFromPool).mockResolvedValue({
        id: "test-pod-id",
        password: "test-password",
        portMappings: { "3010": "http://localhost:3010" },
      } as any);

      // Mock getUserAppTokens
      const { getUserAppTokens } = await import("@/lib/githubApp");
      vi.mocked(getUserAppTokens).mockResolvedValue({
        accessToken: "github_pat_test_token",
      });

      // Mock failed push response (push includes commit now)
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => "Internal pod error",
      } as Response);

      const request = createPostRequest("http://localhost:3000/api/agent/commit", {
        podId: "test-pod-id",
        workspaceId: workspace.id,
        taskId: "test-task-id",
        commitMessage: "Test commit",
        branchName: "feature/test",
      });

      const response = await POST(request);

      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.error).toContain("Failed to push: 500");
      expect(data.details).toBe("Internal pod error");
    });

    test.skip("should handle push failure from pod", async () => {
      const { user, workspace } = await createTestDataWithCommitCapabilities();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      // Mock getPodFromPool
      const { getPodFromPool } = await import("@/lib/pods/utils");
      vi.mocked(getPodFromPool).mockResolvedValue({
        id: "test-pod-id",
        password: "test-password",
        portMappings: { "3010": "http://localhost:3010" },
      } as any);

      // Mock getUserAppTokens
      const { getUserAppTokens } = await import("@/lib/githubApp");
      vi.mocked(getUserAppTokens).mockResolvedValue({
        accessToken: "github_pat_test_token",
      });

      // Mock successful commit but failed push
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ success: true }),
        } as Response)
        .mockResolvedValueOnce({
          ok: false,
          status: 403,
          text: async () => "Push rejected",
        } as Response);

      const request = createPostRequest("http://localhost:3000/api/agent/commit", {
        podId: "test-pod-id",
        workspaceId: workspace.id,
        taskId: "test-task-id",
        commitMessage: "Test commit",
        branchName: "feature/test",
      });

      const response = await POST(request);

      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data.error).toContain("Failed to push: 403");
      expect(data.details).toBe("Push rejected");
    });

    test("should return 500 when control port not found in pod mappings", async () => {
      const { user, workspace } = await createTestDataWithCommitCapabilities();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      // Mock getPodFromPool with missing control port
      const { getPodFromPool } = await import("@/lib/pods/utils");
      vi.mocked(getPodFromPool).mockResolvedValue({
        id: "test-pod-id",
        password: "test-password",
        portMappings: {}, // Empty port mappings
      } as any);

      const request = createPostRequest("http://localhost:3000/api/agent/commit", {
        podId: "test-pod-id",
        workspaceId: workspace.id,
        taskId: "test-task-id",
        commitMessage: "Test commit",
        branchName: "feature/test",
      });

      const response = await POST(request);

      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.error).toContain("Control port (3010) not found in port mappings");
    });
  });

  describe("PR URL Generation Tests", () => {
    test("should generate correct PR URLs for multiple repositories", async () => {
      const { user, workspace, task } = await createTestDataWithCommitCapabilities();

      // Add additional repositories
      await db.repository.create({
        data: {
          name: "test-repo-2",
          repositoryUrl: "https://github.com/test-org/test-repo-2",
          branch: "main",
          status: "SYNCED",
          workspaceId: workspace.id,
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      // Mock getPodFromPool
      const { getPodFromPool } = await import("@/lib/pods/utils");
      vi.mocked(getPodFromPool).mockResolvedValue({
        id: "test-pod-id",
        password: "test-password",
        portMappings: { "3010": "http://localhost:3010" },
      } as any);

      // Mock getUserAppTokens
      const { getUserAppTokens } = await import("@/lib/githubApp");
      vi.mocked(getUserAppTokens).mockResolvedValue({
        accessToken: "github_pat_test_token",
      });

      // Mock successful push with multiple PRs
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          prs: {
            "test-org/test-repo": "https://github.com/test-org/test-repo/pull/123",
            "test-org/test-repo-2": "https://github.com/test-org/test-repo-2/pull/124",
          },
        }),
      } as Response);

      const request = createPostRequest("http://localhost:3000/api/agent/commit", {
        podId: "test-pod-id",
        workspaceId: workspace.id,
        taskId: task.id,
        commitMessage: "Test commit",
        branchName: "feature/multi-repo",
      });

      const response = await POST(request);
      const data = await expectSuccess(response);

      expect(Object.keys(data.data.prs)).toHaveLength(2);
      expect(data.data.prs["test-org/test-repo"]).toBe("https://github.com/test-org/test-repo/pull/123");
      expect(data.data.prs["test-org/test-repo-2"]).toBe("https://github.com/test-org/test-repo-2/pull/124");
    });

    test("should handle repository URLs with .git suffix", async () => {
      const { user, workspace, task } = await createTestDataWithCommitCapabilities();

      // Update repository URL with .git suffix
      const repository = await db.repository.findFirst({
        where: { workspaceId: workspace.id },
      });

      await db.repository.update({
        where: { id: repository!.id },
        data: { repositoryUrl: "https://github.com/test-org/test-repo.git" },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      // Mock dependencies
      const { getPodFromPool } = await import("@/lib/pods/utils");
      vi.mocked(getPodFromPool).mockResolvedValue({
        id: "test-pod-id",
        password: "test-password",
        portMappings: { "3010": "http://localhost:3010" },
      } as any);

      const { getUserAppTokens } = await import("@/lib/githubApp");
      vi.mocked(getUserAppTokens).mockResolvedValue({
        accessToken: "github_pat_test_token",
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          prs: { "test-org/test-repo": "https://github.com/test-org/test-repo/pull/123" },
        }),
      } as Response);

      const request = createPostRequest("http://localhost:3000/api/agent/commit", {
        podId: "test-pod-id",
        workspaceId: workspace.id,
        taskId: task.id,
        commitMessage: "Test commit",
        branchName: "feature/test",
      });

      const response = await POST(request);
      const data = await expectSuccess(response);

      expect(Object.keys(data.data.prs)).toHaveLength(1);
      expect(data.data.prs["test-org/test-repo"]).toBe("https://github.com/test-org/test-repo/pull/123");
    });
  });

  describe("Error Handling Tests", () => {
    test("should handle getPodFromPool failure", async () => {
      const { user, workspace } = await createTestDataWithCommitCapabilities();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      // Mock getPodFromPool to throw error
      const { getPodFromPool } = await import("@/lib/pods/utils");
      vi.mocked(getPodFromPool).mockRejectedValue(new Error("Failed to get workspace from pool: 404"));

      const request = createPostRequest("http://localhost:3000/api/agent/commit", {
        podId: "test-pod-id",
        workspaceId: workspace.id,
        taskId: "test-task-id",
        commitMessage: "Test commit",
        branchName: "feature/test",
      });

      const response = await POST(request);

      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.error).toBe("Failed to commit");
    });

    test("should handle network errors during commit", async () => {
      const { user, workspace } = await createTestDataWithCommitCapabilities();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      // Mock dependencies
      const { getPodFromPool } = await import("@/lib/pods/utils");
      vi.mocked(getPodFromPool).mockResolvedValue({
        id: "test-pod-id",
        password: "test-password",
        portMappings: { "3010": "http://localhost:3010" },
      } as any);

      const { getUserAppTokens } = await import("@/lib/githubApp");
      vi.mocked(getUserAppTokens).mockResolvedValue({
        accessToken: "github_pat_test_token",
      });

      // Mock network error
      mockFetch.mockRejectedValue(new Error("Network error: ECONNREFUSED"));

      const request = createPostRequest("http://localhost:3000/api/agent/commit", {
        podId: "test-pod-id",
        workspaceId: workspace.id,
        taskId: "test-task-id",
        commitMessage: "Test commit",
        branchName: "feature/test",
      });

      const response = await POST(request);

      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.error).toBe("Failed to commit");
    });

    test("should handle decryption errors gracefully", async () => {
      const { user, workspace } = await createTestDataWithCommitCapabilities();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      // Mock decryptField to throw error
      const encService = EncryptionService.getInstance();
      vi.mocked(encService.decryptField).mockImplementation(() => {
        throw new Error("Decryption failed");
      });

      const request = createPostRequest("http://localhost:3000/api/agent/commit", {
        podId: "test-pod-id",
        workspaceId: workspace.id,
        taskId: "test-task-id",
        commitMessage: "Test commit",
        branchName: "feature/test",
      });

      const response = await POST(request);

      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.error).toBe("Failed to commit");
    });
  });

  describe("Mock Mode Tests", () => {
    test("should bypass pod communication in mock mode", async () => {
      const { user, workspace } = await createTestDataWithCommitCapabilities();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      // Set mock mode
      process.env.MOCK_BROWSER_URL = "http://mock.dev";

      const request = createPostRequest("http://localhost:3000/api/agent/commit", {
        podId: "test-pod-id",
        workspaceId: workspace.id,
        taskId: "test-task-id",
        commitMessage: "Test commit",
        branchName: "feature/test",
      });

      const response = await POST(request);
      const data = await expectSuccess(response);

      expect(data.success).toBe(true);
      expect(data.message).toBe("Commit successful (mock)");

      // Verify no pod communication occurred
      expect(mockFetch).not.toHaveBeenCalled();

      // Cleanup
      delete process.env.MOCK_BROWSER_URL;
    });
  });

  describe("Integration Tests", () => {
    test("should complete full commit workflow with all validations", async () => {
      const { user, workspace, repository, githubAuth, task } = await createTestDataWithCommitCapabilities();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      // Mock all dependencies
      const { getPodFromPool } = await import("@/lib/pods/utils");
      vi.mocked(getPodFromPool).mockResolvedValue({
        id: "test-pod-id",
        password: "secure-password",
        portMappings: { "3010": "http://pod-control.test:3010" },
        url: "http://test-pod.dev",
        state: "running",
      } as any);

      const { getUserAppTokens } = await import("@/lib/githubApp");
      vi.mocked(getUserAppTokens).mockResolvedValue({
        accessToken: "github_pat_valid_token",
        refreshToken: "refresh_token",
      });

      // Mock successful push with PRs
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          message: "Push successful",
          prs: { "test-org/test-repo": "https://github.com/test-org/test-repo/pull/123" },
        }),
      } as Response);

      const request = createPostRequest("http://localhost:3000/api/agent/commit", {
        podId: "test-pod-id",
        workspaceId: workspace.id,
        taskId: task.id,
        commitMessage: "feat: add integration test coverage",
        branchName: "feature/integration-tests",
      });

      const response = await POST(request);

      const data = await expectSuccess(response);

      // Verify response structure
      expect(data).toMatchObject({
        success: true,
        message: "Commit and push successful",
        data: {
          prs: expect.objectContaining({
            "test-org/test-repo": expect.stringMatching(/^https:\/\/github\.com\/test-org\/test-repo\/pull\/\d+$/),
          }),
        },
      });

      // Verify getPodFromPool was called with correct params
      expect(getPodFromPool).toHaveBeenCalledWith("test-pod-id", "test-pool-api-key");

      // Verify getUserAppTokens was called with correct params
      expect(getUserAppTokens).toHaveBeenCalledWith(user.id, "test-org");

      // Verify push request structure (includes commit)
      const pushCall = mockFetch.mock.calls[0];
      expect(pushCall[0]).toBe("http://pod-control.test:3010/push?pr=true&commit=true");
      const pushBody = JSON.parse(pushCall[1]!.body as string);
      expect(pushBody).toMatchObject({
        repos: [
          {
            url: repository.repositoryUrl,
            commit_name: "feat: add integration test coverage",
            branch_name: "feature/integration-tests",
          },
        ],
        git_credentials: {
          provider: "github",
          auth_type: "app",
          auth_data: {
            token: "github_pat_valid_token",
            username: githubAuth.githubUsername,
          },
        },
      });
    });
  });
});
