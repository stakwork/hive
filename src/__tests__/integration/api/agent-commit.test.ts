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
import { createTestUser } from "@/__tests__/support/factories/user.factory";

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

// Mock pod query functions
vi.mock("@/lib/pods", () => ({
  getPodDetails: vi.fn(),
  POD_PORTS: {
    CONTROL: "3010",
  },
  buildPodUrl: (podId: string, port: number | string) => `https://${podId}-${port}.workspaces.sphinx.chat`,
}));

// Mock GitHub App functions
vi.mock("@/lib/githubApp", () => ({
  getUserAppTokens: vi.fn(),
}));

const mockFetch = global.fetch as vi.MockedFunction<typeof global.fetch>;

describe("POST /api/agent/commit Integration Tests", () => {
  const encryptionService = EncryptionService.getInstance();

  // Helper to create complete test data with all required relationships
  async function createTestDataWithCommitCapabilities(options: {pod_id?: string } = {}) {
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
        data: {user_id: user.id,github_user_id: "12345",github_username: "testuser",
          githubNodeId: "test-node-id",
        },
      });

      // Create source control org
      const sourceControlOrg = await tx.sourceControlOrg.create({
        data: {github_login: "test-org",github_installation_id: 123456,
          type: "ORG",
          name: "Test Organization",
        },
      });

      // Create source control token (encrypted)
      const encryptedToken = encryptionService.encryptField("source_control_token", "github_pat_test_token");
      await tx.sourceControlToken.create({
        data: {user_id: user.id,source_control_org_id: sourceControlOrg.id,
          token: JSON.stringify(encryptedToken),
          scopes: ["repo", "write:org"],
        },
      });

      // Create workspace
      const workspace = await tx.workspace.create({
        data: {
          name: "Test Workspace",
          slug: generateUniqueSlug("test-workspace"),owner_id: user.id,source_control_org_id: sourceControlOrg.id,
        },
      });

      // Create swarm with encrypted poolApiKey
      const encryptedPoolApiKey = encryptionService.encryptField("poolApiKey", "test-pool-api-key");
      const swarm = await tx.swarm.create({
        data: {
          name: `test-swarm-${Date.now()}`,swarm_id: `swarm-${Date.now()}`,
          status: "ACTIVE",instance_type: "XL",workspace_id: workspace.id,pool_state: "COMPLETE",pool_name: "test-pool",pool_api_key: JSON.stringify(encryptedPoolApiKey),swarm_api_key: "test-swarm-api-key",swarm_secret_alias: "{{SWARM_TEST_API_KEY}}",
        },
      });

      // Create repositories
      const repository = await tx.repository.create({
        data: {
          name: "test-repo",repository_url: "https://github.com/test-org/test-repo",
          branch: "main",
          status: "SYNCED",workspace_id: workspace.id,
        },
      });
      const feature = await tx.feature.create({
        data: {
          title: "Test Feature",workspace_id: workspace.id,created_by_id: user.id,updated_by_id: user.id,
        },
      });

      // Create pod if podId is provided
      let pod;
      if (options.podId) {
        const encryptedPassword = encryptionService.encryptField("password", "test-password");
        pod = await tx.pod.create({
          data: {pod_id: options.podId,swarm_id: swarm.id,
            password: JSON.stringify(encryptedPassword),
            portMappings: [3000, 3010, 15551, 15552],
            status: "RUNNING",
            usageStatus: "USED",
          },
        });
      }

      // Create test task with optional podId
      const task = await tx.task.create({
        data: {workspace_id: workspace.id,
          title: "Task 2",feature_id: feature.id,
          status: TaskStatus.TODO,
          priority: Priority.MEDIUM,
          order: 1,created_by_id: user.id,updated_by_id: user.id,pod_id: options.podId,
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

      const request = createPostRequest("http://localhost:3000/api/agent/commit", {workspace_id: "test-workspace-id",task_id: "test-task-id",
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

      const request = createPostRequest("http://localhost:3000/api/agent/commit", {workspace_id: "test-workspace-id",task_id: "test-task-id",
        commitMessage: "Test commit",
        branchName: "feature/test",
      });

      const response = await POST(request);

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "Invalid user session" });
    });
  });

  describe("Validation Tests", () => {
    test("should return 400 when task has no podId assigned", async () => {
      // Create task without podId
      const { user, workspace, task } = await createTestDataWithCommitCapabilities();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createPostRequest("http://localhost:3000/api/agent/commit", {workspace_id: workspace.id,task_id: task.id,
        commitMessage: "Test commit",
        branchName: "feature/test",
      });

      const response = await POST(request);
      await expectError(response, "No pod assigned to this task", 400);
    });

    test("should return 400 when workspaceId is missing", async () => {
      const { user, task } = await createTestDataWithCommitCapabilities({pod_id: "test-pod-id" });
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createPostRequest("http://localhost:3000/api/agent/commit", {task_id: task.id,
        commitMessage: "Test commit",
        branchName: "feature/test",
      });

      const response = await POST(request);
      await expectError(response, "Missing required field: workspaceId", 400);
    });

    test("should return 400 when taskId is missing", async () => {
      const { user, workspace } = await createTestDataWithCommitCapabilities({pod_id: "test-pod-id" });
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createPostRequest("http://localhost:3000/api/agent/commit", {workspace_id: workspace.id,
        commitMessage: "Test commit",
        branchName: "feature/test",
      });

      const response = await POST(request);
      await expectError(response, "Missing required field: taskId", 400);
    });

    test("should return 400 when commitMessage is missing", async () => {
      const { user, workspace, task } = await createTestDataWithCommitCapabilities({pod_id: "test-pod-id" });
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createPostRequest("http://localhost:3000/api/agent/commit", {workspace_id: workspace.id,task_id: task.id,
        branchName: "feature/test",
      });

      const response = await POST(request);
      await expectError(response, "Missing required field: commitMessage", 400);
    });

    test("should return 400 when branchName is missing", async () => {
      const { user, workspace, task } = await createTestDataWithCommitCapabilities({pod_id: "test-pod-id" });
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createPostRequest("http://localhost:3000/api/agent/commit", {workspace_id: workspace.id,task_id: task.id,
        commitMessage: "Test commit",
      });

      const response = await POST(request);
      await expectError(response, "Missing required field: branchName", 400);
    });
  });

  describe("Authorization Tests", () => {
    test("should return 404 when workspace not found", async () => {
      // Create a task with podId so we can test workspace not found
      const { task } = await createTestDataWithCommitCapabilities({pod_id: "test-pod-id" });
      const user = await createTestUser();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createPostRequest("http://localhost:3000/api/agent/commit", {workspace_id: "non-existent-workspace-id",task_id: task.id,
        commitMessage: "Test commit",
        branchName: "feature/test",
      });

      const response = await POST(request);
      await expectNotFound(response, "Workspace not found");
    });

    test("should return 403 when user is not workspace owner or member", async () => {
      const { workspace, task } = await createTestDataWithCommitCapabilities({pod_id: "test-pod-id" });
      const unauthorizedUser = await createTestUser({ name: "Unauthorized User" });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(unauthorizedUser));

      const request = createPostRequest("http://localhost:3000/api/agent/commit", {workspace_id: workspace.id,task_id: task.id,
        commitMessage: "Test commit",
        branchName: "feature/test",
      });

      const response = await POST(request);
      await expectForbidden(response);
    });

    test("should allow workspace owner to commit", async () => {
      const { user, workspace, task } = await createTestDataWithCommitCapabilities({pod_id: "test-pod-id" });
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      // Set mock mode to bypass pod communication
      process.env.MOCK_BROWSER_URL = "http://mock.dev";

      const request = createPostRequest("http://localhost:3000/api/agent/commit", {workspace_id: workspace.id,task_id: task.id,
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
      const { workspace, task } = await createTestDataWithCommitCapabilities({pod_id: "test-pod-id" });
      const memberUser = await createTestUser({ name: "Member User" });

      // Add user as workspace member
      await db.workspace_members.create({
        data: {user_id: memberUser.id,workspace_id: workspace.id,
          role: "DEVELOPER",
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(memberUser));

      // Set mock mode to bypass pod communication
      process.env.MOCK_BROWSER_URL = "http://mock.dev";

      const request = createPostRequest("http://localhost:3000/api/agent/commit", {workspace_id: workspace.id,task_id: task.id,
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
      const workspace = await db.workspaces.create({
        data: {
          name: "Test Workspace",
          slug: generateUniqueSlug("test-workspace"),owner_id: user.id,
        },
      });

      // Create task with podId in workspace without swarm
      const task = await db.tasks.create({
        data: {workspace_id: workspace.id,
          title: "Test Task",
          status: "TODO",
          priority: "MEDIUM",
          order: 1,created_by_id: user.id,updated_by_id: user.id,pod_id: "test-pod-id",
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createPostRequest("http://localhost:3000/api/agent/commit", {workspace_id: workspace.id,task_id: task.id,
        commitMessage: "Test commit",
        branchName: "feature/test",
      });

      const response = await POST(request);
      await expectNotFound(response, "No swarm found for this workspace");
    });



    test("should return 400 when workspace has no source control org", async () => {
      const user = await createTestUser();
      const workspace = await db.workspaces.create({
        data: {
          name: "Test Workspace",
          slug: generateUniqueSlug("test-workspace"),owner_id: user.id,
        },
      });

      const encryptedPoolApiKey = encryptionService.encryptField("poolApiKey", "test-pool-api-key");
      await db.swarms.create({
        data: {
          name: `test-swarm-${Date.now()}`,
          status: "ACTIVE",instance_type: "XL",workspace_id: workspace.id,pool_state: "COMPLETE",pool_api_key: JSON.stringify(encryptedPoolApiKey),
        },
      });

      // Create task with podId
      const task = await db.tasks.create({
        data: {workspace_id: workspace.id,
          title: "Test Task",
          status: "TODO",
          priority: "MEDIUM",
          order: 1,created_by_id: user.id,updated_by_id: user.id,pod_id: "test-pod-id",
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      // Mock getPodDetails
      const { getPodDetails } = await import("@/lib/pods");
      vi.mocked(getPodDetails).mockResolvedValue({pod_id: "test-pod-id",
        password: "test-password",
        portMappings: [3010],
      } as any);

      const request = createPostRequest("http://localhost:3000/api/agent/commit", {workspace_id: workspace.id,task_id: task.id,
        commitMessage: "Test commit",
        branchName: "feature/test",
      });

      const response = await POST(request);
      await expectError(response, "No GitHub organization linked to this workspace", 400);
    });
  });

  describe("GitHub Authentication Tests", () => {
    test("should return 401 when GitHub access token not found", async () => {
      const { user, workspace, task } = await createTestDataWithCommitCapabilities({pod_id: "test-pod-id" });
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      // Mock getPodDetails
      const { getPodDetails } = await import("@/lib/pods");
      vi.mocked(getPodDetails).mockResolvedValue({pod_id: "test-pod-id",
        password: "test-password",
        portMappings: [3010],
      } as any);

      // Mock getUserAppTokens to return null (no token)
      const { getUserAppTokens } = await import("@/lib/githubApp");
      vi.mocked(getUserAppTokens).mockResolvedValue(null);

      const request = createPostRequest("http://localhost:3000/api/agent/commit", {workspace_id: workspace.id,task_id: task.id,
        commitMessage: "Test commit",
        branchName: "feature/test",
      });

      const response = await POST(request);

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.error).toBe("GitHub authentication required. Please reconnect your GitHub account.");
    });

    test("should return 401 when GitHub username not found", async () => {
      const { user, workspace, task } = await createTestDataWithCommitCapabilities({pod_id: "test-pod-id" });

      // Remove GitHub auth
      await db.github_auth.deleteMany({ where: {user_id: user.id } });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      // Mock getPodDetails
      const { getPodDetails } = await import("@/lib/pods");
      vi.mocked(getPodDetails).mockResolvedValue({pod_id: "test-pod-id",
        password: "test-password",
        portMappings: [3010],
      } as any);

      // Mock getUserAppTokens to return token
      const { getUserAppTokens } = await import("@/lib/githubApp");
      vi.mocked(getUserAppTokens).mockResolvedValue({access_token: "github_pat_test_token",
      });

      const request = createPostRequest("http://localhost:3000/api/agent/commit", {workspace_id: workspace.id,task_id: task.id,
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
      const { user, workspace, repository, task } = await createTestDataWithCommitCapabilities({pod_id: "test-pod-id",
      });
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      // Mock getPodDetails
      const { getPodDetails } = await import("@/lib/pods");
      vi.mocked(getPodDetails).mockResolvedValue({pod_id: "test-pod-id",
        password: "test-password",
        portMappings: [3010],
      } as any);

      // Mock getUserAppTokens
      const { getUserAppTokens } = await import("@/lib/githubApp");
      vi.mocked(getUserAppTokens).mockResolvedValue({access_token: "github_pat_test_token",
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

      const request = createPostRequest("http://localhost:3000/api/agent/commit", {workspace_id: workspace.id,task_id: task.id,
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
      const pushCall = mockFetch.mock.calls[0];
      expect(pushCall[0]).toBe("https://test-pod-id-3010.workspaces.sphinx.chat/push?pr=true&commit=true&label=agent");
      expect(pushCall[1]).toMatchObject({
        method: "POST",
        headers: {
          Authorization: "Bearer test-password",
          "Content-Type": "application/json",
        },
      });
      const pushBody = JSON.parse(pushCall[1]!.body as string);
      expect(pushBody.repos[0].commit_name).toBe("Test commit message");
    });

    test("should handle commit failure from pod", async () => {
      const { user, workspace, task } = await createTestDataWithCommitCapabilities({pod_id: "test-pod-id" });
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      // Mock getPodDetails
      const { getPodDetails } = await import("@/lib/pods");
      vi.mocked(getPodDetails).mockResolvedValue({pod_id: "test-pod-id",
        password: "test-password",
        portMappings: [3010],
      } as any);

      // Mock getUserAppTokens
      const { getUserAppTokens } = await import("@/lib/githubApp");
      vi.mocked(getUserAppTokens).mockResolvedValue({access_token: "github_pat_test_token",
      });

      // Mock failed push response (push includes commit now)
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => "Internal pod error",
      } as Response);

      const request = createPostRequest("http://localhost:3000/api/agent/commit", {workspace_id: workspace.id,task_id: task.id,
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
      const { user, workspace, task } = await createTestDataWithCommitCapabilities({pod_id: "test-pod-id" });
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      // Mock getPodDetails
      const { getPodDetails } = await import("@/lib/pods");
      vi.mocked(getPodDetails).mockResolvedValue({pod_id: "test-pod-id",
        password: "test-password",
        portMappings: [3010],
      } as any);

      // Mock getUserAppTokens
      const { getUserAppTokens } = await import("@/lib/githubApp");
      vi.mocked(getUserAppTokens).mockResolvedValue({access_token: "github_pat_test_token",
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

      const request = createPostRequest("http://localhost:3000/api/agent/commit", {workspace_id: workspace.id,task_id: task.id,
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
      const { user, workspace, task } = await createTestDataWithCommitCapabilities({pod_id: "test-pod-id" });
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      // Mock getPodDetails with missing control port
      const { getPodDetails } = await import("@/lib/pods");
      vi.mocked(getPodDetails).mockResolvedValue({pod_id: "test-pod-id",
        password: "test-password",
        portMappings: [], // Empty port mappings
      } as any);

      const request = createPostRequest("http://localhost:3000/api/agent/commit", {workspace_id: workspace.id,task_id: task.id,
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
      const { user, workspace, task } = await createTestDataWithCommitCapabilities({pod_id: "test-pod-id" });

      // Add additional repositories
      await db.repositories.create({
        data: {
          name: "test-repo-2",repository_url: "https://github.com/test-org/test-repo-2",
          branch: "main",
          status: "SYNCED",workspace_id: workspace.id,
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      // Mock getPodDetails
      const { getPodDetails } = await import("@/lib/pods");
      vi.mocked(getPodDetails).mockResolvedValue({pod_id: "test-pod-id",
        password: "test-password",
        portMappings: [3010],
      } as any);

      // Mock getUserAppTokens
      const { getUserAppTokens } = await import("@/lib/githubApp");
      vi.mocked(getUserAppTokens).mockResolvedValue({access_token: "github_pat_test_token",
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

      const request = createPostRequest("http://localhost:3000/api/agent/commit", {workspace_id: workspace.id,task_id: task.id,
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
      const { user, workspace, task } = await createTestDataWithCommitCapabilities({pod_id: "test-pod-id" });

      // Update repository URL with .git suffix
      const repository = await db.repositories.findFirst({
        where: {workspace_id: workspace.id },
      });

      await db.repositories.update({
        where: { id: repository!.id },
        data: {repository_url: "https://github.com/test-org/test-repo.git" },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      // Mock dependencies
      const { getPodDetails } = await import("@/lib/pods");
      vi.mocked(getPodDetails).mockResolvedValue({pod_id: "test-pod-id",
        password: "test-password",
        portMappings: [3010],
      } as any);

      const { getUserAppTokens } = await import("@/lib/githubApp");
      vi.mocked(getUserAppTokens).mockResolvedValue({access_token: "github_pat_test_token",
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          prs: { "test-org/test-repo": "https://github.com/test-org/test-repo/pull/123" },
        }),
      } as Response);

      const request = createPostRequest("http://localhost:3000/api/agent/commit", {workspace_id: workspace.id,task_id: task.id,
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
    test("should handle getPodDetails failure", async () => {
      const { user, workspace, task } = await createTestDataWithCommitCapabilities({pod_id: "test-pod-id" });
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      // Mock getPodDetails to throw error
      const { getPodDetails } = await import("@/lib/pods");
      vi.mocked(getPodDetails).mockRejectedValue(new Error("Failed to get workspace from pool: 404"));

      const request = createPostRequest("http://localhost:3000/api/agent/commit", {workspace_id: workspace.id,task_id: task.id,
        commitMessage: "Test commit",
        branchName: "feature/test",
      });

      const response = await POST(request);

      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.error).toBe("Failed to commit");
    });

    test("should handle network errors during commit", async () => {
      const { user, workspace, task } = await createTestDataWithCommitCapabilities({pod_id: "test-pod-id" });
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      // Mock dependencies
      const { getPodDetails } = await import("@/lib/pods");
      vi.mocked(getPodDetails).mockResolvedValue({pod_id: "test-pod-id",
        password: "test-password",
        portMappings: [3010],
      } as any);

      const { getUserAppTokens } = await import("@/lib/githubApp");
      vi.mocked(getUserAppTokens).mockResolvedValue({access_token: "github_pat_test_token",
      });

      // Mock network error
      mockFetch.mockRejectedValue(new Error("Network error: ECONNREFUSED"));

      const request = createPostRequest("http://localhost:3000/api/agent/commit", {workspace_id: workspace.id,task_id: task.id,
        commitMessage: "Test commit",
        branchName: "feature/test",
      });

      const response = await POST(request);

      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.error).toBe("Failed to commit");
    });

    test("should handle decryption errors gracefully", async () => {
      const { user, workspace, task } = await createTestDataWithCommitCapabilities({pod_id: "test-pod-id" });
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      // Mock decryptField to throw error
      const encService = EncryptionService.getInstance();
      vi.mocked(encService.decryptField).mockImplementation(() => {
        throw new Error("Decryption failed");
      });

      const request = createPostRequest("http://localhost:3000/api/agent/commit", {workspace_id: workspace.id,task_id: task.id,
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
      const { user, workspace, task } = await createTestDataWithCommitCapabilities({pod_id: "test-pod-id" });
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      // Set mock mode
      process.env.MOCK_BROWSER_URL = "http://mock.dev";

      const request = createPostRequest("http://localhost:3000/api/agent/commit", {workspace_id: workspace.id,task_id: task.id,
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
      const { user, workspace, repository, githubAuth, task } = await createTestDataWithCommitCapabilities({pod_id: "test-pod-id",
      });
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      // Mock all dependencies
      const { getPodDetails } = await import("@/lib/pods");
      vi.mocked(getPodDetails).mockResolvedValue({pod_id: "test-pod-id",
        password: "secure-password",
        portMappings: [3010],
      } as any);

      const { getUserAppTokens } = await import("@/lib/githubApp");
      vi.mocked(getUserAppTokens).mockResolvedValue({access_token: "github_pat_valid_token",
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

      const request = createPostRequest("http://localhost:3000/api/agent/commit", {workspace_id: workspace.id,task_id: task.id,
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

      // Verify getPodDetails was called with correct params
      expect(getPodDetails).toHaveBeenCalledWith("test-pod-id");

      // Verify getUserAppTokens was called with correct params
      expect(getUserAppTokens).toHaveBeenCalledWith(user.id, "test-org");

      // Verify push request structure (includes commit)
      const pushCall = mockFetch.mock.calls[0];
      expect(pushCall[0]).toBe("https://test-pod-id-3010.workspaces.sphinx.chat/push?pr=true&commit=true&label=agent");
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
