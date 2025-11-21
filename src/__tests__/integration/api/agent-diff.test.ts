import { describe, test, expect, beforeEach, vi } from "vitest";
import { POST } from "@/app/api/agent/diff/route";
import { db } from "@/lib/db";
import { ChatRole, ChatStatus } from "@prisma/client";
import {
  createAuthenticatedSession,
  mockUnauthenticatedSession,
  expectSuccess,
  expectError,
  expectUnauthorized,
  expectForbidden,
  expectNotFound,
  generateUniqueSlug,
  createPostRequest,
  getMockedSession,
} from "@/__tests__/support/helpers";
import { createTestUser, createTestWorkspaceScenario, createTestTask } from "@/__tests__/support/fixtures";

// Mock external dependencies
global.fetch = vi.fn();

// Mock encryption service
vi.mock("@/lib/encryption", () => ({
  EncryptionService: {
    getInstance: vi.fn(() => ({
      decryptField: vi.fn((fieldName: string, value: string) => {
        // Return mock decrypted values
        if (fieldName === "poolApiKey") return "test-pool-api-key";
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
    CONTROL: "15552",
  },
}));

const mockFetch = global.fetch as vi.MockedFunction<typeof global.fetch>;

describe("POST /api/agent/diff Integration Tests", () => {
  // Helper to create complete test data with all required relationships
  async function createTestDataWithDiffCapabilities() {
    return await db.$transaction(async (tx) => {
      // Create test user
      const user = await tx.user.create({
        data: {
          email: `test-${Date.now()}@example.com`,
          name: "Test User",
        },
      });

      // Create workspace
      const workspace = await tx.workspace.create({
        data: {
          name: "Test Workspace",
          slug: generateUniqueSlug("test-workspace"),
          ownerId: user.id,
        },
      });

      // Create swarm with encrypted poolApiKey
      const swarm = await tx.swarm.create({
        data: {
          name: `test-swarm-${Date.now()}`,
          swarmId: `swarm-${Date.now()}`,
          status: "ACTIVE",
          instanceType: "XL",
          workspaceId: workspace.id,
          poolState: "COMPLETE",
          poolName: "test-pool",
          poolApiKey: JSON.stringify({ data: "encrypted-key", iv: "test-iv" }),
          swarmApiKey: "test-swarm-api-key",
          swarmSecretAlias: "{{SWARM_TEST_API_KEY}}",
        },
      });

      // Create test task
      const task = await tx.task.create({
        data: {
          workspaceId: workspace.id,
          title: "Test Task",
          status: "TODO",
          priority: "MEDIUM",
          order: 1,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      return { user, workspace, swarm, task };
    });
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    mockFetch.mockClear();
  });

  describe("Authentication Tests", () => {
    test("returns 401 when user not authenticated", async () => {
      getMockedSession().mockResolvedValue(mockUnauthenticatedSession());

      const request = createPostRequest("http://localhost:3000/api/agent/diff", {
        podId: "test-pod-id",
        workspaceId: "test-workspace-id",
        taskId: "test-task-id",
      });

      const response = await POST(request);
      await expectUnauthorized(response);
    });

    test("returns 401 when user session has no id", async () => {
      getMockedSession().mockResolvedValue({
        user: { email: "test@example.com", name: "Test User" },
      });

      const request = createPostRequest("http://localhost:3000/api/agent/diff", {
        podId: "test-pod-id",
        workspaceId: "test-workspace-id",
        taskId: "test-task-id",
      });

      const response = await POST(request);

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "Invalid user session" });
    });
  });

  describe("Validation Tests", () => {
    test("returns 400 when podId is missing", async () => {
      const { user, workspace } = await createTestDataWithDiffCapabilities();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createPostRequest("http://localhost:3000/api/agent/diff", {
        workspaceId: workspace.id,
        taskId: "test-task-id",
      });

      const response = await POST(request);
      await expectError(response, "Missing required field: podId", 400);
    });

    test("returns 400 when workspaceId is missing", async () => {
      const { user } = await createTestDataWithDiffCapabilities();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createPostRequest("http://localhost:3000/api/agent/diff", {
        podId: "test-pod-id",
        taskId: "test-task-id",
      });

      const response = await POST(request);
      await expectError(response, "Missing required field: workspaceId", 400);
    });

    test("returns 400 when taskId is missing", async () => {
      const { user, workspace } = await createTestDataWithDiffCapabilities();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createPostRequest("http://localhost:3000/api/agent/diff", {
        podId: "test-pod-id",
        workspaceId: workspace.id,
      });

      const response = await POST(request);
      await expectError(response, "Missing required field: taskId", 400);
    });
  });

  describe("Authorization Tests", () => {
    test("returns 404 when workspace not found", async () => {
      const user = await createTestUser();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createPostRequest("http://localhost:3000/api/agent/diff", {
        podId: "test-pod-id",
        workspaceId: "non-existent-workspace-id",
        taskId: "test-task-id",
      });

      const response = await POST(request);
      await expectNotFound(response, "Workspace not found");
    });

    test("returns 403 when user is not workspace owner or member", async () => {
      const { workspace } = await createTestDataWithDiffCapabilities();
      const unauthorizedUser = await createTestUser({ name: "Unauthorized User" });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(unauthorizedUser));

      const request = createPostRequest("http://localhost:3000/api/agent/diff", {
        podId: "test-pod-id",
        workspaceId: workspace.id,
        taskId: "test-task-id",
      });

      const response = await POST(request);
      await expectForbidden(response);
    });

    test("allows workspace owner to fetch diff", async () => {
      const { user, workspace, task } = await createTestDataWithDiffCapabilities();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      // Set mock mode to bypass pod communication
      process.env.MOCK_BROWSER_URL = "http://mock.dev";

      const request = createPostRequest("http://localhost:3000/api/agent/diff", {
        podId: "test-pod-id",
        workspaceId: workspace.id,
        taskId: task.id,
      });

      const response = await POST(request);
      const data = await expectSuccess(response);

      expect(data.success).toBe(true);
      expect(data.message).toBeDefined();

      // Cleanup
      delete process.env.MOCK_BROWSER_URL;
    });

    test("allows workspace member to fetch diff", async () => {
      const { workspace, task } = await createTestDataWithDiffCapabilities();
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

      const request = createPostRequest("http://localhost:3000/api/agent/diff", {
        podId: "test-pod-id",
        workspaceId: workspace.id,
        taskId: task.id,
      });

      const response = await POST(request);
      const data = await expectSuccess(response);

      expect(data.success).toBe(true);
      expect(data.message).toBeDefined();

      // Cleanup
      delete process.env.MOCK_BROWSER_URL;
    });
  });

  describe("Configuration Tests", () => {
    test("returns 404 when workspace has no swarm", async () => {
      const user = await createTestUser();
      const workspace = await db.workspace.create({
        data: {
          name: "Test Workspace",
          slug: generateUniqueSlug("test-workspace"),
          ownerId: user.id,
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createPostRequest("http://localhost:3000/api/agent/diff", {
        podId: "test-pod-id",
        workspaceId: workspace.id,
        taskId: "test-task-id",
      });

      const response = await POST(request);
      await expectNotFound(response, "No swarm found for this workspace");
    });

    test("returns 400 when swarm has no pool configuration", async () => {
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

      const request = createPostRequest("http://localhost:3000/api/agent/diff", {
        podId: "test-pod-id",
        workspaceId: workspace.id,
        taskId: "test-task-id",
      });

      const response = await POST(request);
      await expectError(response, "Swarm not properly configured with pool information", 400);
    });
  });

  describe("Pod Communication Tests", () => {
    test("successfully fetches diff from control port", async () => {
      const { user, workspace, task } = await createTestDataWithDiffCapabilities();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      // Mock getPodFromPool
      const { getPodFromPool } = await import("@/lib/pods/utils");
      vi.mocked(getPodFromPool).mockResolvedValue({
        id: "test-pod-id",
        password: "test-password",
        portMappings: { "15552": "http://localhost:15552" },
        url: "http://test-pod.dev",
        state: "running",
      } as any);

      // Mock successful diff response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [
          {
            file: "src/test.ts",
            action: "modify",
            content: "diff content",
            repoName: "test-repo",
          },
        ],
      } as Response);

      const request = createPostRequest("http://localhost:3000/api/agent/diff", {
        podId: "test-pod-id",
        workspaceId: workspace.id,
        taskId: task.id,
      });

      const response = await POST(request);
      const data = await expectSuccess(response, 200);

      expect(data.success).toBe(true);
      expect(data.message).toBeDefined();
      expect(data.message.artifacts).toHaveLength(1);
      expect(data.message.artifacts[0].type).toBe("DIFF");
      expect(data.message.artifacts[0].content.diffs).toHaveLength(1);
      expect(data.message.artifacts[0].content.diffs[0]).toMatchObject({
        file: "src/test.ts",
        action: "modify",
        content: "diff content",
        repoName: "test-repo",
      });
    });

    test("handles empty diffs gracefully", async () => {
      const { user, workspace, task } = await createTestDataWithDiffCapabilities();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      // Mock getPodFromPool
      const { getPodFromPool } = await import("@/lib/pods/utils");
      vi.mocked(getPodFromPool).mockResolvedValue({
        id: "test-pod-id",
        password: "test-password",
        portMappings: { "15552": "http://localhost:15552" },
      } as any);

      // Mock empty diff response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      } as Response);

      const request = createPostRequest("http://localhost:3000/api/agent/diff", {
        podId: "test-pod-id",
        workspaceId: workspace.id,
        taskId: task.id,
      });

      const response = await POST(request);
      const data = await expectSuccess(response, 200);

      expect(data.success).toBe(true);
      expect(data.noDiffs).toBe(true);
    });

    test("handles control port errors", async () => {
      const { user, workspace, task } = await createTestDataWithDiffCapabilities();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      // Mock getPodFromPool
      const { getPodFromPool } = await import("@/lib/pods/utils");
      vi.mocked(getPodFromPool).mockResolvedValue({
        id: "test-pod-id",
        password: "test-password",
        portMappings: { "15552": "http://localhost:15552" },
      } as any);

      // Mock failed control port response
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => "Internal pod error",
      } as Response);

      const request = createPostRequest("http://localhost:3000/api/agent/diff", {
        podId: "test-pod-id",
        workspaceId: workspace.id,
        taskId: task.id,
      });

      const response = await POST(request);

      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.error).toContain("Failed to fetch diff: 500");
      expect(data.details).toBe("Internal pod error");
    });

    test("returns 500 when control port not found in pod mappings", async () => {
      const { user, workspace, task } = await createTestDataWithDiffCapabilities();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      // Mock getPodFromPool with missing control port
      const { getPodFromPool } = await import("@/lib/pods/utils");
      vi.mocked(getPodFromPool).mockResolvedValue({
        id: "test-pod-id",
        password: "test-password",
        portMappings: {}, // Empty port mappings
      } as any);

      const request = createPostRequest("http://localhost:3000/api/agent/diff", {
        podId: "test-pod-id",
        workspaceId: workspace.id,
        taskId: task.id,
      });

      const response = await POST(request);

      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.error).toContain("Control port (15552) not found in port mappings");
    });
  });

  describe("Database Operations Tests", () => {
    test("creates ChatMessage with DIFF artifact", async () => {
      const { user, workspace, task } = await createTestDataWithDiffCapabilities();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      // Mock getPodFromPool
      const { getPodFromPool } = await import("@/lib/pods/utils");
      vi.mocked(getPodFromPool).mockResolvedValue({
        id: "test-pod-id",
        password: "test-password",
        portMappings: { "15552": "http://localhost:15552" },
      } as any);

      // Mock successful diff response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [
          {
            file: "src/example.ts",
            action: "modify",
            content: "test diff content",
            repoName: "test/repo",
          },
        ],
      } as Response);

      const request = createPostRequest("http://localhost:3000/api/agent/diff", {
        podId: "test-pod-id",
        workspaceId: workspace.id,
        taskId: task.id,
      });

      const response = await POST(request);
      await expectSuccess(response, 200);

      // Verify database state
      const messages = await db.chatMessage.findMany({
        where: { taskId: task.id },
        include: { artifacts: true },
      });

      expect(messages).toHaveLength(1);
      expect(messages[0].role).toBe(ChatRole.ASSISTANT);
      expect(messages[0].status).toBe(ChatStatus.SENT);
      expect(messages[0].artifacts).toHaveLength(1);
      expect(messages[0].artifacts[0].type).toBe("DIFF");
    });

    test("artifact contains correct diff structure", async () => {
      const { user, workspace, task } = await createTestDataWithDiffCapabilities();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      // Mock getPodFromPool
      const { getPodFromPool } = await import("@/lib/pods/utils");
      vi.mocked(getPodFromPool).mockResolvedValue({
        id: "test-pod-id",
        password: "test-password",
        portMappings: { "15552": "http://localhost:15552" },
      } as any);

      // Mock successful diff response with multiple files
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [
          {
            file: "src/file1.ts",
            action: "create",
            content: "new file content",
            repoName: "test/repo",
          },
          {
            file: "src/file2.ts",
            action: "modify",
            content: "modified content",
            repoName: "test/repo",
          },
        ],
      } as Response);

      const request = createPostRequest("http://localhost:3000/api/agent/diff", {
        podId: "test-pod-id",
        workspaceId: workspace.id,
        taskId: task.id,
      });

      const response = await POST(request);
      const data = await expectSuccess(response, 200);

      const diffContent = data.message.artifacts[0].content;
      expect(diffContent.diffs).toBeInstanceOf(Array);
      expect(diffContent.diffs).toHaveLength(2);
      expect(diffContent.diffs[0]).toHaveProperty("file");
      expect(diffContent.diffs[0]).toHaveProperty("action");
      expect(diffContent.diffs[0]).toHaveProperty("content");
      expect(diffContent.diffs[0]).toHaveProperty("repoName");
      expect(["create", "modify", "rewrite", "delete"]).toContain(diffContent.diffs[0].action);
    });

    test("does not create message when diffs are empty", async () => {
      const { user, workspace, task } = await createTestDataWithDiffCapabilities();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      // Mock getPodFromPool
      const { getPodFromPool } = await import("@/lib/pods/utils");
      vi.mocked(getPodFromPool).mockResolvedValue({
        id: "test-pod-id",
        password: "test-password",
        portMappings: { "15552": "http://localhost:15552" },
      } as any);

      // Mock empty diff response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      } as Response);

      const request = createPostRequest("http://localhost:3000/api/agent/diff", {
        podId: "test-pod-id",
        workspaceId: workspace.id,
        taskId: task.id,
      });

      await POST(request);

      // Verify no message was created
      const messages = await db.chatMessage.findMany({
        where: { taskId: task.id },
      });

      expect(messages).toHaveLength(0);
    });
  });

  describe("Error Handling Tests", () => {
    test("handles getPodFromPool failure", async () => {
      const { user, workspace, task } = await createTestDataWithDiffCapabilities();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      // Mock getPodFromPool to throw error
      const { getPodFromPool } = await import("@/lib/pods/utils");
      vi.mocked(getPodFromPool).mockRejectedValue(new Error("Failed to get workspace from pool: 404"));

      const request = createPostRequest("http://localhost:3000/api/agent/diff", {
        podId: "test-pod-id",
        workspaceId: workspace.id,
        taskId: task.id,
      });

      const response = await POST(request);

      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.error).toBe("Failed to fetch diff");
    });

    test("handles network errors during diff fetch", async () => {
      const { user, workspace, task } = await createTestDataWithDiffCapabilities();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      // Mock getPodFromPool
      const { getPodFromPool } = await import("@/lib/pods/utils");
      vi.mocked(getPodFromPool).mockResolvedValue({
        id: "test-pod-id",
        password: "test-password",
        portMappings: { "15552": "http://localhost:15552" },
      } as any);

      // Mock network error
      mockFetch.mockRejectedValue(new Error("Network error: ECONNREFUSED"));

      const request = createPostRequest("http://localhost:3000/api/agent/diff", {
        podId: "test-pod-id",
        workspaceId: workspace.id,
        taskId: task.id,
      });

      const response = await POST(request);

      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.error).toBe("Failed to fetch diff");
    });
  });

  describe("Mock Mode Tests", () => {
    test("returns mock data when MOCK_BROWSER_URL set", async () => {
      const { user, workspace, task } = await createTestDataWithDiffCapabilities();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      // Set mock mode
      process.env.MOCK_BROWSER_URL = "http://mock.dev";

      const request = createPostRequest("http://localhost:3000/api/agent/diff", {
        podId: "mock-pod",
        workspaceId: workspace.id,
        taskId: task.id,
      });

      const response = await POST(request);
      const data = await expectSuccess(response, 200);

      expect(data.success).toBe(true);
      expect(data.message.artifacts[0].type).toBe("DIFF");
      expect(data.message.artifacts[0].content.diffs).toHaveLength(1);
      expect(data.message.artifacts[0].content.diffs[0].file).toBe("example.ts");

      // Verify no pod communication occurred
      expect(mockFetch).not.toHaveBeenCalled();

      // Cleanup
      delete process.env.MOCK_BROWSER_URL;
    });

    test("returns mock data when CUSTOM_GOOSE_URL set", async () => {
      const { user, workspace, task } = await createTestDataWithDiffCapabilities();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      // Set custom goose mode
      process.env.CUSTOM_GOOSE_URL = "http://custom-goose.dev";

      const request = createPostRequest("http://localhost:3000/api/agent/diff", {
        podId: "mock-pod",
        workspaceId: workspace.id,
        taskId: task.id,
      });

      const response = await POST(request);
      const data = await expectSuccess(response, 200);

      expect(data.success).toBe(true);
      expect(data.message.artifacts[0].type).toBe("DIFF");

      // Verify no pod communication occurred
      expect(mockFetch).not.toHaveBeenCalled();

      // Cleanup
      delete process.env.CUSTOM_GOOSE_URL;
    });
  });

  describe("Integration Tests", () => {
    test("completes full diff retrieval workflow with all validations", async () => {
      const { user, workspace, task } = await createTestDataWithDiffCapabilities();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      // Mock getPodFromPool
      const { getPodFromPool } = await import("@/lib/pods/utils");
      vi.mocked(getPodFromPool).mockResolvedValue({
        id: "test-pod-id",
        password: "secure-password",
        portMappings: { "15552": "http://pod-control.test:15552" },
        url: "http://test-pod.dev",
        state: "running",
      } as any);

      // Mock successful diff response with multiple actions
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [
          {
            file: "src/components/Button.tsx",
            action: "modify",
            content: "diff --git a/src/components/Button.tsx...",
            repoName: "test-org/frontend",
          },
          {
            file: "src/utils/helpers.ts",
            action: "create",
            content: "export function newHelper() {...}",
            repoName: "test-org/frontend",
          },
        ],
      } as Response);

      const request = createPostRequest("http://localhost:3000/api/agent/diff", {
        podId: "test-pod-id",
        workspaceId: workspace.id,
        taskId: task.id,
      });

      const response = await POST(request);
      const data = await expectSuccess(response, 200);

      // Verify response structure
      expect(data).toMatchObject({
        success: true,
        message: expect.objectContaining({
          id: expect.any(String),
          taskId: task.id,
          role: ChatRole.ASSISTANT,
          status: ChatStatus.SENT,
          artifacts: expect.arrayContaining([
            expect.objectContaining({
              type: "DIFF",
              content: expect.objectContaining({
                diffs: expect.arrayContaining([
                  expect.objectContaining({
                    file: expect.any(String),
                    action: expect.stringMatching(/^(create|modify|rewrite|delete)$/),
                    content: expect.any(String),
                    repoName: expect.any(String),
                  }),
                ]),
              }),
            }),
          ]),
        }),
      });

      // Verify getPodFromPool was called with correct params
      expect(getPodFromPool).toHaveBeenCalledWith("test-pod-id", "test-pool-api-key");

      // Verify diff fetch request structure
      const diffCall = mockFetch.mock.calls[0];
      expect(diffCall[0]).toBe("http://pod-control.test:15552/diff");
      expect(diffCall[1]?.method).toBe("GET");
      expect(diffCall[1]?.headers).toMatchObject({
        Authorization: "Bearer secure-password",
      });

      // Verify database persistence
      const messages = await db.chatMessage.findMany({
        where: { taskId: task.id },
        include: { artifacts: true },
      });

      expect(messages).toHaveLength(1);
      expect(messages[0].artifacts[0].content).toMatchObject({
        diffs: expect.arrayContaining([
          expect.objectContaining({
            file: "src/components/Button.tsx",
            action: "modify",
          }),
          expect.objectContaining({
            file: "src/utils/helpers.ts",
            action: "create",
          }),
        ]),
      });
    });
  });
});
