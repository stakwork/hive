import { describe, test, expect, beforeEach, vi } from "vitest";
import { POST } from "@/app/api/chat/message/route";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { config } from "@/config/env";
import { ChatRole, ChatStatus, ArtifactType } from "@/lib/chat";
import { WorkflowStatus } from "@prisma/client";
import {
  createAuthenticatedSession,
  mockUnauthenticatedSession,
  expectUnauthorized,
  generateUniqueId,
  createPostRequest,
  getMockedSession,
} from "@/__tests__/support/helpers";
import { createTestUser } from "@/__tests__/support/fixtures/user";

// Mock environment config
vi.mock("@/config/env", () => ({
  config: {
    STAKWORK_API_KEY: "test-stakwork-key",
    STAKWORK_BASE_URL: "https://test-stakwork.com",
    STAKWORK_WORKFLOW_ID: "123,456,789",
  },
}));

// Mock external services
global.fetch = vi.fn();

// Mock S3 service
vi.mock("@/services/s3", () => ({
  getS3Service: () => ({
    generatePresignedDownloadUrl: vi.fn().mockResolvedValue("https://s3.test.com/file.jpg"),
  }),
}));

// Mock auth functions
vi.mock("@/lib/auth/nextauth", () => ({
  authOptions: {},
  getGithubUsernameAndPAT: vi.fn().mockResolvedValue({
    username: "testuser",
    token: "github_pat_test_token",
  }),
}));

// Mock utility functions
vi.mock("@/lib/utils", () => ({
  getBaseUrl: vi.fn().mockReturnValue("http://localhost:3000"),
}));

vi.mock("@/lib/utils/swarm", () => ({
  transformSwarmUrlToRepo2Graph: vi.fn().mockReturnValue("http://test-repo2graph:3355"),
}));

const mockFetch = global.fetch as vi.MockedFunction<typeof global.fetch>;

describe("POST /api/chat/message Integration Tests", () => {
  EncryptionService.getInstance();

  async function createTestUserWithWorkspaceAndTask() {
    return await db.$transaction(async (tx) => {
      // Create test user
      const testUser = await tx.user.create({
        data: {
          id: generateUniqueId("test-user"),
          email: `test-${generateUniqueId()}@example.com`,
          name: "Test User",
        },
      });

      // Create workspace
      const testWorkspace = await tx.workspace.create({
        data: {
          id: generateUniqueId("workspace"),
          name: "Test Workspace",
          slug: generateUniqueId("test-workspace"),
          description: "Test workspace description",
          ownerId: testUser.id,
          stakworkApiKey: "test-stakwork-key",
        },
      });

      // Create task
      const testTask = await tx.task.create({
        data: {
          id: generateUniqueId("task"),
          title: "Test Task",
          description: "Test task description",
          status: "TODO",
          workspaceId: testWorkspace.id,
          workflowStatus: WorkflowStatus.PENDING,
          createdById: testUser.id,
          updatedById: testUser.id,
        },
      });

      // Create swarm linked to workspace (optional for tests that need it)
      const testSwarm = await tx.swarm.create({
        data: {
          swarmId: `swarm-${Date.now()}`,
          name: `test-swarm-${Date.now()}`,
          status: "ACTIVE",
          instanceType: "XL",
          swarmApiKey: "test-api-key",
          swarmUrl: "https://test-swarm.com/api",
          swarmSecretAlias: "test-secret",
          poolName: "test-pool",
          environmentVariables: [],
          services: [],
          workspaceId: testWorkspace.id,
          agentRequestId: null,
          agentStatus: null,
        },
      });

      return { testUser, testWorkspace, testTask, testSwarm };
    });
  }

  beforeEach(async () => {
    vi.clearAllMocks();
  });

  describe("Authentication Tests", () => {
    test("should return 401 for unauthenticated request", async () => {
      getMockedSession().mockResolvedValue(mockUnauthenticatedSession());

      const request = createPostRequest("http://localhost:3000/api/chat/message", {
        taskId: "test-task-id",
        message: "Test message",
      });

      const response = await POST(request);

      await expectUnauthorized(response);
    });

    test("should return 401 for invalid user session", async () => {
      getMockedSession().mockResolvedValue({
        user: { email: "test@example.com" }, // Missing id
      });

      const request = createPostRequest("http://localhost:3000/api/chat/message", {
        taskId: "test-task-id",
        message: "Test message",
      });

      const response = await POST(request);

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "Invalid user session" });
    });
  });

  describe("Request Validation Tests", () => {
    test("should return 400 for missing message", async () => {
      const { testUser } = await createTestUserWithWorkspaceAndTask();

      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      const request = createPostRequest("http://localhost:3000/api/chat/message", {
        taskId: "test-task-id",
        // message missing
      });

      const response = await POST(request);

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "Message is required" });
    });

    test("should return 400 for missing taskId", async () => {
      const { testUser } = await createTestUserWithWorkspaceAndTask();

      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      const request = createPostRequest("http://localhost:3000/api/chat/message", {
        message: "Test message",
        // taskId missing
      });

      const response = await POST(request);

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "taskId is required" });
    });
  });

  describe("Database Access Control Tests", () => {
    test("should return 404 for non-existent task", async () => {
      const { testUser } = await createTestUserWithWorkspaceAndTask();

      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      const request = createPostRequest("http://localhost:3000/api/chat/message", {
        taskId: "non-existent-task-id",
        message: "Test message",
      });

      const response = await POST(request);

      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "Task not found" });
    });

    test("should return 403 for unauthorized access to task", async () => {
      const { testTask } = await createTestUserWithWorkspaceAndTask();

      // Create different user who doesn't have access
      const unauthorizedUser = await createTestUser({ name: "Unauthorized User" });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(unauthorizedUser));

      const request = createPostRequest("http://localhost:3000/api/chat/message", {
        taskId: testTask.id,
        message: "Test message",
      });

      const response = await POST(request);

      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: "Access denied" });
    });
  });

  describe("Successful Request Tests", () => {
    test("should successfully create chat message with mock service", async () => {
      const { testUser, testTask } = await createTestUserWithWorkspaceAndTask();

      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      // Mock successful mock service call
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, message: "Mock response sent" }),
      } as Response);

      // Clear STAKWORK config to use mock service
      vi.mocked(config).STAKWORK_API_KEY = "";

      const request = createPostRequest("http://localhost:3000/api/chat/message", {
        taskId: testTask.id,
        message: "Test message content",
        contextTags: [{ type: "file", value: "test.js" }],
        artifacts: [
          {
            type: ArtifactType.CODE,
            content: { language: "javascript", code: "console.log('test')" },
          },
        ],
        attachments: [
          {
            path: "uploads/test/file.jpg",
            filename: "file.jpg",
            mimeType: "image/jpeg",
            size: 1024,
          },
        ],
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.success).toBe(true);
      expect(data.message).toBeDefined();
      expect(data.message.message).toBe("Test message content");
      expect(data.message.role).toBe(ChatRole.USER);
      expect(data.message.status).toBe(ChatStatus.SENT);
      expect(data.message.artifacts).toHaveLength(1);
      expect(data.message.attachments).toHaveLength(1);

      // Verify chat message was created in database
      const chatMessage = await db.chatMessage.findFirst({
        where: { taskId: testTask.id },
        include: { artifacts: true, attachments: true },
      });

      expect(chatMessage).toBeTruthy();
      expect(chatMessage?.message).toBe("Test message content");
      expect(chatMessage?.artifacts).toHaveLength(1);
      expect(chatMessage?.attachments).toHaveLength(1);
    });

    test("should successfully create chat message with Stakwork service", async () => {
      const { testUser, testTask } = await createTestUserWithWorkspaceAndTask();

      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      // Mock successful Stakwork service call
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: { project_id: 12345 },
        }),
      } as Response);

      // Restore STAKWORK config to use Stakwork service
      vi.mocked(config).STAKWORK_API_KEY = "test-stakwork-key";

      const request = createPostRequest("http://localhost:3000/api/chat/message", {
        taskId: testTask.id,
        message: "Test Stakwork message",
        mode: "test",
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.success).toBe(true);
      expect(data.workflow.project_id).toBe(12345);

      // Verify task was updated with workflow status
      const updatedTask = await db.task.findUnique({
        where: { id: testTask.id },
      });

      expect(updatedTask?.workflowStatus).toBe(WorkflowStatus.IN_PROGRESS);
      expect(updatedTask?.stakworkProjectId).toBe(12345);
      expect(updatedTask?.workflowStartedAt).toBeDefined();
    });

    test("should handle different task modes correctly", async () => {
      const { testUser, testTask } = await createTestUserWithWorkspaceAndTask();

      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, data: {} }),
      } as Response);

      // Test live mode
      const liveRequest = createPostRequest("http://localhost:3000/api/chat/message", {
        taskId: testTask.id,
        message: "Live mode test",
        mode: "live",
      });

      const liveResponse = await POST(liveRequest);
      expect(liveResponse.status).toBe(201);

      // Test unit mode
      const unitRequest = createPostRequest("http://localhost:3000/api/chat/message", {
        taskId: testTask.id,
        message: "Unit mode test",
        mode: "unit",
      });

      const unitResponse = await POST(unitRequest);
      expect(unitResponse.status).toBe(201);

      // Test integration mode
      const integrationRequest = createPostRequest("http://localhost:3000/api/chat/message", {
        taskId: testTask.id,
        message: "Integration mode test",
        mode: "integration",
      });

      const integrationResponse = await POST(integrationRequest);
      expect(integrationResponse.status).toBe(201);
    });
  });

  describe("Error Handling Tests", () => {
    test("should handle Stakwork service failure", async () => {
      const { testUser, testTask } = await createTestUserWithWorkspaceAndTask();

      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      // Mock failed Stakwork service call
      mockFetch.mockResolvedValueOnce({
        ok: false,
        statusText: "Internal Server Error",
      } as Response);

      vi.mocked(config).STAKWORK_API_KEY = "test-stakwork-key";

      const request = createPostRequest("http://localhost:3000/api/chat/message", {
        taskId: testTask.id,
        message: "Test message",
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201); // Still creates chat message
      expect(data.success).toBe(true);

      // Verify task workflow status was set to FAILED
      const updatedTask = await db.task.findUnique({
        where: { id: testTask.id },
      });

      expect(updatedTask?.workflowStatus).toBe(WorkflowStatus.FAILED);
    });

    test("should handle mock service failure gracefully", async () => {
      const { testUser, testTask } = await createTestUserWithWorkspaceAndTask();

      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      // Mock failed mock service call
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      vi.mocked(config).STAKWORK_API_KEY = ""; // Use mock service

      const request = createPostRequest("http://localhost:3000/api/chat/message", {
        taskId: testTask.id,
        message: "Test message",
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201); // Still creates chat message
      expect(data.success).toBe(true);
      // Mock service failures don't return error in workflow response
      // We just check that the message was created successfully
    });

    test("should handle database errors gracefully", async () => {
      const { testUser } = await createTestUserWithWorkspaceAndTask();

      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      const request = createPostRequest("http://localhost:3000/api/chat/message", {
        taskId: "invalid-task-format", // This will cause database error
        message: "Test message",
      });

      const response = await POST(request);

      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "Task not found" });
    });
  });

  describe("Edge Cases", () => {
    test("should handle empty arrays for contextTags, artifacts, and attachments", async () => {
      const { testUser, testTask } = await createTestUserWithWorkspaceAndTask();

      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ success: true }),
      } as Response);

      vi.mocked(config).STAKWORK_API_KEY = "";

      const request = createPostRequest("http://localhost:3000/api/chat/message", {
        taskId: testTask.id,
        message: "Test message",
        contextTags: [],
        artifacts: [],
        attachments: [],
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.success).toBe(true);
      expect(data.message.contextTags).toEqual([]);
      expect(data.message.artifacts).toEqual([]);
      expect(data.message.attachments).toEqual([]);
    });

    test("should handle very long message content", async () => {
      const { testUser, testTask } = await createTestUserWithWorkspaceAndTask();

      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ success: true }),
      } as Response);

      vi.mocked(config).STAKWORK_API_KEY = "";

      const longMessage = "a".repeat(10000); // Very long message

      const request = createPostRequest("http://localhost:3000/api/chat/message", {
        taskId: testTask.id,
        message: longMessage,
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.success).toBe(true);
      expect(data.message.message).toBe(longMessage);
    });

    test("should handle special characters in message content", async () => {
      const { testUser, testTask } = await createTestUserWithWorkspaceAndTask();

      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ success: true }),
      } as Response);

      vi.mocked(config).STAKWORK_API_KEY = "";

      const specialMessage = "Test with 🚀 emojis and special chars: àáâäåæçèéêë & <html> tags";

      const request = createPostRequest("http://localhost:3000/api/chat/message", {
        taskId: testTask.id,
        message: specialMessage,
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.success).toBe(true);
      expect(data.message.message).toBe(specialMessage);
    });
  });
});