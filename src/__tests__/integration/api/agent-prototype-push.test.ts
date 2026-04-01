import { describe, test, expect, beforeEach, vi } from "vitest";
import { POST } from "@/app/api/agent/prototype-push/[taskId]/route";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { TaskStatus, Priority } from "@prisma/client";
import {
  createAuthenticatedSession,
  mockUnauthenticatedSession,
  expectUnauthorized,
  generateUniqueSlug,
  getMockedSession,
} from "@/__tests__/support/helpers";
import { createTestUser } from "@/__tests__/support/factories/user.factory";
import { generateUniqueId } from "@/__tests__/support/helpers/ids";

// Mock external dependencies
global.fetch = vi.fn();

vi.mock("@/lib/encryption", () => ({
  EncryptionService: {
    getInstance: vi.fn(() => ({
      decryptField: vi.fn((_fieldName: string, _value: string) => "decrypted-value"),
      encryptField: vi.fn((_fieldName: string, value: string) => ({
        data: Buffer.from(value).toString("base64"),
        iv: "test-iv",
        tag: "test-tag",
        version: "v1",
        encryptedAt: new Date().toISOString(),
      })),
    })),
  },
}));

vi.mock("@/lib/pods", () => ({
  getPodDetails: vi.fn(),
  POD_PORTS: { CONTROL: "3010" },
  buildPodUrl: (podId: string, port: string) =>
    `https://${podId}-${port}.workspaces.sphinx.chat`,
}));

vi.mock("@/lib/githubApp", () => ({
  getUserAppTokens: vi.fn(),
}));

vi.mock("@/lib/ai/commit-msg", () => ({
  generateCommitMessage: vi.fn(),
}));

vi.mock("@/lib/pods/utils", () => ({
  releaseTaskPod: vi.fn().mockResolvedValue({ success: true, podDropped: true, taskCleared: true }),
}));

const mockFetch = global.fetch as ReturnType<typeof vi.fn>;

describe("POST /api/agent/prototype-push/[taskId]", () => {
  const encryptionService = EncryptionService.getInstance();

  async function createTestData(options: { podId?: string } = {}) {
    return await db.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: `test-${generateUniqueId()}@example.com`,
          name: "Test User",
        },
      });

      const sourceControlOrg = await tx.sourceControlOrg.create({
        data: {
          githubLogin: "test-org",
          githubInstallationId: Math.floor(Math.random() * 1_000_000),
          type: "ORG",
          name: "Test Organization",
        },
      });

      const encryptedToken = encryptionService.encryptField(
        "source_control_token",
        "github_pat_test_token",
      );
      await tx.sourceControlToken.create({
        data: {
          userId: user.id,
          sourceControlOrgId: sourceControlOrg.id,
          token: JSON.stringify(encryptedToken),
          scopes: ["repo", "write:org"],
        },
      });

      const workspace = await tx.workspace.create({
        data: {
          name: "Test Workspace",
          slug: generateUniqueSlug("test-ws"),
          ownerId: user.id,
          sourceControlOrgId: sourceControlOrg.id,
        },
      });

      const encryptedPoolApiKey = encryptionService.encryptField(
        "poolApiKey",
        "test-pool-api-key",
      );
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

      const repository = await tx.repository.create({
        data: {
          name: "test-repo",
          repositoryUrl: "https://github.com/test-org/test-repo",
          branch: "main",
          status: "SYNCED",
          workspaceId: workspace.id,
        },
      });

      let pod;
      if (options.podId) {
        const encryptedPassword = encryptionService.encryptField("password" as any, "test-password");
        pod = await tx.pod.create({
          data: {
            podId: options.podId,
            swarmId: swarm.id,
            password: JSON.stringify(encryptedPassword),
            portMappings: [3000, 3010, 15551, 15552],
            status: "RUNNING",
            usageStatus: "USED",
          },
        });
      }

      const task = await tx.task.create({
        data: {
          workspaceId: workspace.id,
          title: "Prototype Task",
          status: TaskStatus.TODO,
          priority: Priority.MEDIUM,
          order: 1,
          sourceType: "PROTOTYPE",
          createdById: user.id,
          updatedById: user.id,
          podId: options.podId ?? null,
          repositoryId: repository.id,
        },
      });

      return { user, workspace, swarm, repository, task, pod };
    });
  }

  function createRequest(taskId: string) {
    return new Request(`http://localhost:3000/api/agent/prototype-push/${taskId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    }) as any;
  }

  function buildParams(taskId: string) {
    return { params: Promise.resolve({ taskId }) };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockClear();
  });

  describe("Authentication", () => {
    test("returns 401 when not authenticated", async () => {
      getMockedSession().mockResolvedValue(mockUnauthenticatedSession());

      const response = await POST(createRequest("any-task-id"), buildParams("any-task-id"));
      await expectUnauthorized(response);
    });
  });

  describe("Validation", () => {
    test("returns 400 when task.podId is null", async () => {
      const { user, task } = await createTestData(); // no podId
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const response = await POST(createRequest(task.id), buildParams(task.id));

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain("No pod assigned");
    });

    test("returns 404 when task does not exist", async () => {
      const user = await createTestUser({ email: `u-${generateUniqueId()}@test.com` });
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const response = await POST(createRequest("nonexistent-task-id"), buildParams("nonexistent-task-id"));

      expect(response.status).toBe(404);
    });
  });

  describe("GitHub token handling", () => {
    test("returns 401 when getUserAppTokens returns null", async () => {
      const podId = `pod-${generateUniqueId()}`;
      const { user, task } = await createTestData({ podId });
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const { generateCommitMessage } = await import("@/lib/ai/commit-msg");
      vi.mocked(generateCommitMessage).mockResolvedValue({
        commit_message: "feat: prototype UI",
        branch_name: "feat/dashboard-ui",
      });

      const { getPodDetails } = await import("@/lib/pods");
      vi.mocked(getPodDetails).mockResolvedValue({
        podId,
        password: "test-password",
        portMappings: [3010],
      } as any);

      const { getUserAppTokens } = await import("@/lib/githubApp");
      vi.mocked(getUserAppTokens).mockResolvedValue(null);

      const response = await POST(createRequest(task.id), buildParams(task.id));

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.error).toContain("GitHub token not found");
    });
  });

  describe("Successful push", () => {
    test("calls /push?commit=true&pr=false and returns branchName", async () => {
      const podId = `pod-${generateUniqueId()}`;
      const { user, task } = await createTestData({ podId });
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const { generateCommitMessage } = await import("@/lib/ai/commit-msg");
      vi.mocked(generateCommitMessage).mockResolvedValue({
        commit_message: "feat: prototype dashboard filter UI",
        branch_name: "feat/dashboard-filter-ui",
      });

      const { getPodDetails } = await import("@/lib/pods");
      vi.mocked(getPodDetails).mockResolvedValue({
        podId,
        password: "test-password",
        portMappings: [3010],
      } as any);

      const { getUserAppTokens } = await import("@/lib/githubApp");
      vi.mocked(getUserAppTokens).mockResolvedValue({
        accessToken: "github_pat_test_token",
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          branches: { "test-repo": "feat/dashboard-filter-ui" },
        }),
      } as Response);

      const response = await POST(createRequest(task.id), buildParams(task.id));

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.branchName).toBe("feat/dashboard-filter-ui");
      expect(data.commitMessage).toBe("feat: prototype dashboard filter UI");

      // Assert push URL uses ?commit=true&pr=false
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [fetchUrl, fetchOptions] = mockFetch.mock.calls[0];
      expect(fetchUrl).toContain("commit=true");
      expect(fetchUrl).toContain("pr=false");
      expect(fetchUrl).not.toContain("pr=true");
    });

    test("payload includes repos and git_credentials with correct shape", async () => {
      const podId = `pod-${generateUniqueId()}`;
      const { user, task } = await createTestData({ podId });
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const { generateCommitMessage } = await import("@/lib/ai/commit-msg");
      vi.mocked(generateCommitMessage).mockResolvedValue({
        commit_message: "feat: prototype",
        branch_name: "feat/dashboard-ui",
      });

      const { getPodDetails } = await import("@/lib/pods");
      vi.mocked(getPodDetails).mockResolvedValue({
        podId,
        password: "test-password",
        portMappings: [3010],
      } as any);

      const { getUserAppTokens } = await import("@/lib/githubApp");
      vi.mocked(getUserAppTokens).mockResolvedValue({
        accessToken: "github_pat_test_token",
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          branches: { "test-repo": "feat/dashboard-ui" },
        }),
      } as Response);

      await POST(createRequest(task.id), buildParams(task.id));

      const [, fetchOptions] = mockFetch.mock.calls[0];
      const body = JSON.parse((fetchOptions as RequestInit).body as string);

      expect(body).toHaveProperty("repos");
      expect(body.repos).toHaveLength(1);
      expect(body.repos[0]).toMatchObject({
        url: "https://github.com/test-org/test-repo",
        branch_name: "feat/dashboard-ui",
        commit_name: "feat: prototype",
        base_branch: "main",
      });
      expect(body).toHaveProperty("git_credentials");
      expect(body.git_credentials).toMatchObject({
        provider: "github",
        auth_type: "app",
        auth_data: { token: "github_pat_test_token" },
      });
    });

    test("generateCommitMessage is called without a branchPrefix", async () => {
      const podId = `pod-${generateUniqueId()}`;
      const { user, task } = await createTestData({ podId });
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const { generateCommitMessage } = await import("@/lib/ai/commit-msg");
      vi.mocked(generateCommitMessage).mockResolvedValue({
        commit_message: "feat: prototype",
        branch_name: "feat/dashboard-ui",
      });

      const { getPodDetails } = await import("@/lib/pods");
      vi.mocked(getPodDetails).mockResolvedValue({
        podId,
        password: "test-password",
        portMappings: [3010],
      } as any);

      const { getUserAppTokens } = await import("@/lib/githubApp");
      vi.mocked(getUserAppTokens).mockResolvedValue({
        accessToken: "github_pat_test_token",
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ branches: {} }),
      } as Response);

      await POST(createRequest(task.id), buildParams(task.id));

      expect(vi.mocked(generateCommitMessage)).toHaveBeenCalledWith(
        task.id,
        undefined,
        undefined,
      );
    });

    test("marks task as DONE and releases pod after successful push", async () => {
      const podId = `pod-${generateUniqueId()}`;
      const { user, task } = await createTestData({ podId });
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const { generateCommitMessage } = await import("@/lib/ai/commit-msg");
      vi.mocked(generateCommitMessage).mockResolvedValue({
        commit_message: "feat: prototype done",
        branch_name: "feat/done-branch",
      });

      const { getPodDetails } = await import("@/lib/pods");
      vi.mocked(getPodDetails).mockResolvedValue({
        podId,
        password: "test-password",
        portMappings: [3010],
      } as any);

      const { getUserAppTokens } = await import("@/lib/githubApp");
      vi.mocked(getUserAppTokens).mockResolvedValue({
        accessToken: "github_pat_test_token",
      });

      const { releaseTaskPod } = await import("@/lib/pods/utils");

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ branches: { "test-repo": "feat/done-branch" } }),
      } as Response);

      const response = await POST(createRequest(task.id), buildParams(task.id));
      expect(response.status).toBe(200);

      // Task should be marked DONE in DB
      const updatedTask = await db.task.findUnique({ where: { id: task.id } });
      expect(updatedTask?.status).toBe(TaskStatus.DONE);

      // releaseTaskPod should have been called
      expect(vi.mocked(releaseTaskPod)).toHaveBeenCalledWith(
        expect.objectContaining({
          taskId: task.id,
          podId,
          verifyOwnership: false,
          clearTaskFields: true,
          newWorkflowStatus: "COMPLETED",
        }),
      );
    });

    test("still returns 200 with branchName even if post-push side effects throw", async () => {
      const podId = `pod-${generateUniqueId()}`;
      const { user, task } = await createTestData({ podId });
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const { generateCommitMessage } = await import("@/lib/ai/commit-msg");
      vi.mocked(generateCommitMessage).mockResolvedValue({
        commit_message: "feat: prototype error",
        branch_name: "feat/error-branch",
      });

      const { getPodDetails } = await import("@/lib/pods");
      vi.mocked(getPodDetails).mockResolvedValue({
        podId,
        password: "test-password",
        portMappings: [3010],
      } as any);

      const { getUserAppTokens } = await import("@/lib/githubApp");
      vi.mocked(getUserAppTokens).mockResolvedValue({
        accessToken: "github_pat_test_token",
      });

      // Simulate releaseTaskPod failure — route uses Promise.allSettled so response must still succeed
      const { releaseTaskPod } = await import("@/lib/pods/utils");
      vi.mocked(releaseTaskPod).mockRejectedValueOnce(new Error("Pod release failure"));

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ branches: { "test-repo": "feat/error-branch" } }),
      } as Response);

      const response = await POST(createRequest(task.id), buildParams(task.id));
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(true);
      expect(data.branchName).toBe("feat/error-branch");
    });

    test("falls back to Object.values(branches)[0] when repo name key missing", async () => {
      const podId = `pod-${generateUniqueId()}`;
      const { user, task } = await createTestData({ podId });
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const { generateCommitMessage } = await import("@/lib/ai/commit-msg");
      vi.mocked(generateCommitMessage).mockResolvedValue({
        commit_message: "feat: prototype",
        branch_name: "feat/fallback-branch",
      });

      const { getPodDetails } = await import("@/lib/pods");
      vi.mocked(getPodDetails).mockResolvedValue({
        podId,
        password: "test-password",
        portMappings: [3010],
      } as any);

      const { getUserAppTokens } = await import("@/lib/githubApp");
      vi.mocked(getUserAppTokens).mockResolvedValue({
        accessToken: "github_pat_test_token",
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          // key is different from repo.name ("test-repo")
          branches: { "other-key": "feat/actual-branch" },
        }),
      } as Response);

      const response = await POST(createRequest(task.id), buildParams(task.id));
      const data = await response.json();

      expect(data.branchName).toBe("feat/actual-branch");
    });
  });
});
