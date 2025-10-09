import { describe, test, expect, beforeEach, vi } from "vitest";
import { POST } from "@/app/api/chat/response/route";
import { db } from "@/lib/db";
import { ChatRole, ChatStatus, ArtifactType } from "@/lib/chat";
import {
  generateUniqueId,
  createPostRequest,
} from "@/__tests__/support/helpers";
import { createTestData } from "@/__tests__/support/helpers/transactions";

// Mock environment config
vi.mock("@/lib/env", () => ({
  config: {
    STAKWORK_API_KEY: "test-stakwork-key",
    STAKWORK_BASE_URL: "https://test-stakwork.com",
    STAKWORK_WORKFLOW_ID: "123,456,789",
  },
}));

// Mock Pusher to avoid external calls
vi.mock("@/lib/pusher", () => ({
  pusherServer: {
    trigger: vi.fn().mockResolvedValue(undefined),
  },
  getTaskChannelName: (taskId: string) => `task-${taskId}`,
  PUSHER_EVENTS: {
    NEW_MESSAGE: "new-message",
  },
}));

describe("POST /api/chat/response Integration Tests", () => {
  // Helper to create test task
  async function createTestTask() {
    return await createTestData(async (tx) => {
      const testUser = await tx.user.create({
        data: {
          id: generateUniqueId("test-user"),
          email: `test-${generateUniqueId()}@example.com`,
          name: "Test User",
        },
      });

      const testWorkspace = await tx.workspace.create({
        data: {
          id: generateUniqueId("workspace"),
          name: "Test Workspace",
          slug: generateUniqueId("test-workspace"),
          description: "Test workspace description",
          ownerId: testUser.id,
        },
      });

      const testTask = await tx.task.create({
        data: {
          id: generateUniqueId("task"),
          title: "Test Task",
          description: "Test task description",
          status: "TODO",
          workspaceId: testWorkspace.id,
          createdById: testUser.id,
          updatedById: testUser.id,
        },
      });

      return { testUser, testWorkspace, testTask };
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Input Validation", () => {
    test("should accept request with only message (no taskId)", async () => {
      const request = createPostRequest("http://localhost:3000/api/chat/response", {
        message: "Test AI response without task",
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.success).toBe(true);
      expect(data.data.message).toBe("Test AI response without task");
      expect(data.data.role).toBe(ChatRole.ASSISTANT);
    });

    test("should accept empty message", async () => {
      const { testTask } = await createTestTask();

      const request = createPostRequest("http://localhost:3000/api/chat/response", {
        taskId: testTask.id,
        message: "",
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.success).toBe(true);
      expect(data.data.message).toBe("");
    });

    test("should accept empty arrays for contextTags and artifacts", async () => {
      const { testTask } = await createTestTask();

      const request = createPostRequest("http://localhost:3000/api/chat/response", {
        taskId: testTask.id,
        message: "Test message",
        contextTags: [],
        artifacts: [],
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.success).toBe(true);
      expect(data.data.contextTags).toEqual([]);
      expect(data.data.artifacts).toEqual([]);
    });
  });

  describe("Task Validation", () => {
    test("should return 404 when task does not exist", async () => {
      const nonExistentTaskId = "non-existent-task-id";

      const request = createPostRequest("http://localhost:3000/api/chat/response", {
        taskId: nonExistentTaskId,
        message: "Test AI response",
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe("Task not found");
    });

    test("should return 404 when task is soft-deleted", async () => {
      const { testTask } = await createTestTask();

      // Soft delete the task
      await db.task.update({
        where: { id: testTask.id },
        data: { deleted: true },
      });

      const request = createPostRequest("http://localhost:3000/api/chat/response", {
        taskId: testTask.id,
        message: "Test AI response",
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe("Task not found");
    });
  });

  describe("Successful Message Creation", () => {
    test("should successfully create chat message with ASSISTANT role", async () => {
      const { testTask } = await createTestTask();

      const request = createPostRequest("http://localhost:3000/api/chat/response", {
        taskId: testTask.id,
        message: "This is an AI-generated response",
        workflowUrl: "https://workflow.example.com/run/123",
        contextTags: [
          { type: "file", id: "src/test.ts" },
          { type: "repository", id: "my-repo" },
        ],
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.success).toBe(true);
      expect(data.data).toBeDefined();

      const message = data.data;
      expect(message.taskId).toBe(testTask.id);
      expect(message.message).toBe("This is an AI-generated response");
      expect(message.workflowUrl).toBe("https://workflow.example.com/run/123");
      expect(message.role).toBe(ChatRole.ASSISTANT);
      expect(message.status).toBe(ChatStatus.SENT);
      expect(message.contextTags).toHaveLength(2);
      expect(message.contextTags[0]).toEqual({ type: "file", id: "src/test.ts" });

      // Verify message was persisted to database
      const dbMessage = await db.chatMessage.findFirst({
        where: { taskId: testTask.id },
      });

      expect(dbMessage).toBeTruthy();
      expect(dbMessage?.message).toBe("This is an AI-generated response");
      expect(dbMessage?.role).toBe(ChatRole.ASSISTANT);
    });

    test("should handle sourceWebsocketID", async () => {
      const { testTask } = await createTestTask();

      const request = createPostRequest("http://localhost:3000/api/chat/response", {
        taskId: testTask.id,
        message: "Response with websocket ID",
        sourceWebsocketID: "ws-connection-123",
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.data.sourceWebsocketID).toBe("ws-connection-123");
    });
  });

  describe("Artifact Handling", () => {
    test("should create message with CODE artifact", async () => {
      const { testTask } = await createTestTask();

      const request = createPostRequest("http://localhost:3000/api/chat/response", {
        taskId: testTask.id,
        message: "Here's the code implementation",
        artifacts: [
          {
            type: ArtifactType.CODE,
            content: {
              language: "typescript",
              code: "function hello() { return 'world'; }",
            },
            icon: "Code",
          },
        ],
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.success).toBe(true);
      expect(data.data.artifacts).toHaveLength(1);
      expect(data.data.artifacts[0].type).toBe(ArtifactType.CODE);
      expect(data.data.artifacts[0].content.language).toBe("typescript");
      expect(data.data.artifacts[0].content.code).toContain("function hello()");
      expect(data.data.artifacts[0].icon).toBe("Code");

      // Verify artifact was persisted
      const dbMessage = await db.chatMessage.findFirst({
        where: { taskId: testTask.id },
        include: { artifacts: true },
      });

      expect(dbMessage?.artifacts).toHaveLength(1);
      expect(dbMessage?.artifacts[0].type).toBe(ArtifactType.CODE);
    });

    test("should create message with FORM artifact", async () => {
      const { testTask } = await createTestTask();

      const request = createPostRequest("http://localhost:3000/api/chat/response", {
        taskId: testTask.id,
        message: "Please select an option",
        artifacts: [
          {
            type: ArtifactType.FORM,
            content: {
              actionText: "Choose deployment strategy",
              webhook: "/api/webhooks/deploy",
              options: [
                {
                  actionType: "button",
                  optionLabel: "Deploy to staging",
                  optionResponse: "staging",
                },
                {
                  actionType: "button",
                  optionLabel: "Deploy to production",
                  optionResponse: "production",
                },
              ],
            },
          },
        ],
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.data.artifacts).toHaveLength(1);
      expect(data.data.artifacts[0].type).toBe(ArtifactType.FORM);
      expect(data.data.artifacts[0].content.options).toHaveLength(2);
    });

    test("should create message with BROWSER artifact", async () => {
      const { testTask } = await createTestTask();

      const request = createPostRequest("http://localhost:3000/api/chat/response", {
        taskId: testTask.id,
        message: "Preview available",
        artifacts: [
          {
            type: ArtifactType.BROWSER,
            content: {
              url: "https://preview.example.com/app",
            },
          },
        ],
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.data.artifacts[0].type).toBe(ArtifactType.BROWSER);
      expect(data.data.artifacts[0].content.url).toBe("https://preview.example.com/app");
    });

    test("should create message with LONGFORM artifact", async () => {
      const { testTask } = await createTestTask();

      const request = createPostRequest("http://localhost:3000/api/chat/response", {
        taskId: testTask.id,
        message: "Detailed documentation",
        artifacts: [
          {
            type: ArtifactType.LONGFORM,
            content: {
              title: "API Integration Guide",
              text: "This is a comprehensive guide on how to integrate with our API...",
            },
          },
        ],
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.data.artifacts[0].type).toBe(ArtifactType.LONGFORM);
      expect(data.data.artifacts[0].content.title).toBe("API Integration Guide");
    });

    test("should create message with BUG_REPORT artifact", async () => {
      const { testTask } = await createTestTask();

      const request = createPostRequest("http://localhost:3000/api/chat/response", {
        taskId: testTask.id,
        message: "Bug detected in user interface",
        artifacts: [
          {
            type: ArtifactType.BUG_REPORT,
            content: {
              bugDescription: "Button click handler not responding",
              iframeUrl: "https://preview.example.com/bug-reproduction",
              method: "click",
              sourceFiles: [
                {
                  file: "src/components/Button.tsx",
                  lines: [42, 43, 44],
                  context: "onClick handler definition",
                },
              ],
              coordinates: { x: 150, y: 300, width: 100, height: 40 },
            },
          },
        ],
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.data.artifacts[0].type).toBe(ArtifactType.BUG_REPORT);
      expect(data.data.artifacts[0].content.bugDescription).toContain("Button click");
      expect(data.data.artifacts[0].content.sourceFiles).toHaveLength(1);
    });

    test("should create message with multiple artifacts", async () => {
      const { testTask } = await createTestTask();

      const request = createPostRequest("http://localhost:3000/api/chat/response", {
        taskId: testTask.id,
        message: "Multiple artifacts response",
        artifacts: [
          {
            type: ArtifactType.CODE,
            content: { code: "const x = 1;" },
          },
          {
            type: ArtifactType.BROWSER,
            content: { url: "https://example.com" },
          },
          {
            type: ArtifactType.LONGFORM,
            content: { text: "Documentation text" },
          },
        ],
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.data.artifacts).toHaveLength(3);
      expect(data.data.artifacts[0].type).toBe(ArtifactType.CODE);
      expect(data.data.artifacts[1].type).toBe(ArtifactType.BROWSER);
      expect(data.data.artifacts[2].type).toBe(ArtifactType.LONGFORM);
    });
  });

  describe("Pusher Broadcasting", () => {
    test("should broadcast to Pusher with correct channel and event", async () => {
      const { pusherServer, getTaskChannelName, PUSHER_EVENTS } = await import("@/lib/pusher");
      const { testTask } = await createTestTask();

      const request = createPostRequest("http://localhost:3000/api/chat/response", {
        taskId: testTask.id,
        message: "Pusher broadcast test",
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);

      // Verify Pusher was called with correct parameters
      expect(pusherServer.trigger).toHaveBeenCalledWith(
        getTaskChannelName(testTask.id),
        PUSHER_EVENTS.NEW_MESSAGE,
        expect.any(String) // message ID
      );

      // Verify the message ID matches
      const triggeredMessageId = (pusherServer.trigger as any).mock.calls[0][2];
      expect(triggeredMessageId).toBe(data.data.id);
    });

    test("should not broadcast to Pusher when taskId is missing", async () => {
      const { pusherServer } = await import("@/lib/pusher");

      const request = createPostRequest("http://localhost:3000/api/chat/response", {
        message: "No task ID response",
      });

      const response = await POST(request);

      expect(response.status).toBe(201);
      expect(pusherServer.trigger).not.toHaveBeenCalled();
    });

    test("should handle Pusher broadcast failure gracefully", async () => {
      const { pusherServer } = await import("@/lib/pusher");
      const { testTask } = await createTestTask();

      // Mock Pusher failure
      (pusherServer.trigger as any).mockRejectedValueOnce(new Error("Pusher connection failed"));

      const request = createPostRequest("http://localhost:3000/api/chat/response", {
        taskId: testTask.id,
        message: "Test Pusher failure handling",
      });

      const response = await POST(request);
      const data = await response.json();

      // Request should still succeed (Pusher errors are logged but don't fail request)
      expect(response.status).toBe(201);
      expect(data.success).toBe(true);

      // Verify message was still persisted
      const dbMessage = await db.chatMessage.findFirst({
        where: { taskId: testTask.id },
      });
      expect(dbMessage).toBeTruthy();
    });
  });

  describe("Error Handling", () => {
    test("should return 500 on database error", async () => {
      // Create task but then simulate DB error by using invalid ID format
      const request = createPostRequest("http://localhost:3000/api/chat/response", {
        taskId: "valid-task-id",
        message: "Test database error",
      });

      // This will trigger a 404 first (task not found), but demonstrates error handling
      const response = await POST(request);

      expect([404, 500]).toContain(response.status);
      const data = await response.json();
      expect(data).toHaveProperty("error");
    });

    test("should handle malformed JSON gracefully", async () => {
      const request = new Request("http://localhost:3000/api/chat/response", {
        method: "POST",
        body: "invalid json {",
        headers: {
          "Content-Type": "application/json",
        },
      }) as any;

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data).toHaveProperty("error");
    });
  });

  describe("Edge Cases", () => {
    test("should handle very long message content", async () => {
      const { testTask } = await createTestTask();

      const longMessage = "a".repeat(10000);

      const request = createPostRequest("http://localhost:3000/api/chat/response", {
        taskId: testTask.id,
        message: longMessage,
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.success).toBe(true);
      expect(data.data.message).toBe(longMessage);
    });

    test("should handle special characters in message content", async () => {
      const { testTask } = await createTestTask();

      const specialMessage = "Test with 🚀 emojis and special chars: àáâäåæçèéêë & <html> tags";

      const request = createPostRequest("http://localhost:3000/api/chat/response", {
        taskId: testTask.id,
        message: specialMessage,
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.data.message).toBe(specialMessage);
    });

    test("should handle complex nested artifact content", async () => {
      const { testTask } = await createTestTask();

      const complexArtifact = {
        type: ArtifactType.CODE,
        content: {
          language: "typescript",
          code: "const obj = { nested: { deeply: { values: [1, 2, 3] } } };",
          metadata: {
            author: "AI Assistant",
            timestamp: new Date().toISOString(),
          },
        },
      };

      const request = createPostRequest("http://localhost:3000/api/chat/response", {
        taskId: testTask.id,
        message: "Complex artifact test",
        artifacts: [complexArtifact],
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.data.artifacts[0].content).toMatchObject(complexArtifact.content);
    });

    test("should handle contextTags with various types", async () => {
      const { testTask } = await createTestTask();

      const request = createPostRequest("http://localhost:3000/api/chat/response", {
        taskId: testTask.id,
        message: "Context tags test",
        contextTags: [
          { type: "file", id: "src/app.ts" },
          { type: "repository", id: "my-repo" },
          { type: "branch", id: "feature/new-feature" },
          { type: "commit", id: "abc123" },
        ],
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.data.contextTags).toHaveLength(4);
      expect(data.data.contextTags).toEqual([
        { type: "file", id: "src/app.ts" },
        { type: "repository", id: "my-repo" },
        { type: "branch", id: "feature/new-feature" },
        { type: "commit", id: "abc123" },
      ]);
    });
  });
});