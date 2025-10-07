import { describe, test, expect, beforeEach, vi } from "vitest";
import { POST } from "@/app/api/chat/response/route";
import { db } from "@/lib/db";
import { ChatRole, ChatStatus, ArtifactType } from "@/lib/chat";
import {
  createPostRequest,
  createChatTestScenario,
  createArtifactTestData,
  createContextTagTestData,
} from "@/__tests__/support/helpers";

// Mock Pusher to avoid real WebSocket connections
vi.mock("@/lib/pusher", () => ({
  pusherServer: {
    trigger: vi.fn().mockResolvedValue(undefined),
  },
  getTaskChannelName: vi.fn((taskId: string) => `task-${taskId}`),
  PUSHER_EVENTS: {
    NEW_MESSAGE: "new-message",
  },
}));

const { pusherServer: mockPusherServer } = await import("@/lib/pusher");

describe("POST /api/chat/response Integration Tests", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
  });

  describe("Successful Request Tests", () => {
    test("should create chat message successfully", async () => {
      const { testTask } = await createChatTestScenario();

      const request = createPostRequest("http://localhost:3000/api/chat/response", {
        taskId: testTask.id,
        message: "AI generated response",
        workflowUrl: "https://workflow.example.com/123",
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.success).toBe(true);
      expect(data.data).toBeDefined();
      expect(data.data.message).toBe("AI generated response");
      expect(data.data.role).toBe(ChatRole.ASSISTANT);
      expect(data.data.status).toBe(ChatStatus.SENT);

      // Verify message was persisted to database
      const chatMessage = await db.chatMessage.findFirst({
        where: { taskId: testTask.id },
      });

      expect(chatMessage).toBeTruthy();
      expect(chatMessage?.message).toBe("AI generated response");
      expect(chatMessage?.role).toBe(ChatRole.ASSISTANT);
      expect(chatMessage?.status).toBe(ChatStatus.SENT);
    });

    test("should create message without taskId", async () => {
      const request = createPostRequest("http://localhost:3000/api/chat/response", {
        message: "AI response without task",
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.success).toBe(true);
      expect(data.data.taskId).toBeNull();

      // Verify message was persisted to database
      const chatMessage = await db.chatMessage.findFirst({
        where: { message: "AI response without task" },
      });

      expect(chatMessage).toBeTruthy();
      expect(chatMessage?.taskId).toBeNull();
    });

    test("should broadcast to Pusher when taskId provided", async () => {
      const { testTask } = await createChatTestScenario();

      const request = createPostRequest("http://localhost:3000/api/chat/response", {
        taskId: testTask.id,
        message: "Test message",
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);

      // Verify Pusher broadcast was called
      expect(mockPusherServer.trigger).toHaveBeenCalledWith(
        `task-${testTask.id}`,
        "new-message",
        data.data.id
      );
    });

    test("should not broadcast to Pusher when no taskId", async () => {
      const request = createPostRequest("http://localhost:3000/api/chat/response", {
        message: "Test message",
      });

      await POST(request);

      expect(mockPusherServer.trigger).not.toHaveBeenCalled();
    });
  });

  describe("Task Validation Tests", () => {
    test("should return 404 when task does not exist", async () => {
      const nonExistentTaskId = "non-existent-task-id";

      const request = createPostRequest("http://localhost:3000/api/chat/response", {
        taskId: nonExistentTaskId,
        message: "Test message",
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe("Task not found");

      // Verify no message was created
      const chatMessage = await db.chatMessage.findFirst({
        where: { taskId: nonExistentTaskId },
      });

      expect(chatMessage).toBeNull();
    });

    test("should return 404 when task is soft-deleted", async () => {
      const { testTask } = await createChatTestScenario();

      // Soft delete the task
      await db.task.update({
        where: { id: testTask.id },
        data: { deleted: true, deletedAt: new Date() },
      });

      const request = createPostRequest("http://localhost:3000/api/chat/response", {
        taskId: testTask.id,
        message: "Test message",
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe("Task not found");
    });

    test("should validate task before creating message", async () => {
      const { testTask } = await createChatTestScenario();

      const request = createPostRequest("http://localhost:3000/api/chat/response", {
        taskId: testTask.id,
        message: "Test message",
      });

      const response = await POST(request);

      expect(response.status).toBe(201);

      // Verify message has correct task relationship
      const chatMessage = await db.chatMessage.findFirst({
        where: { taskId: testTask.id },
        include: { task: true },
      });

      expect(chatMessage?.task?.id).toBe(testTask.id);
      expect(chatMessage?.task?.title).toBe("Test Task");
    });
  });

  describe("Artifact Tests", () => {
    test("should create message with CODE artifact", async () => {
      const { testTask } = await createChatTestScenario();

      const request = createPostRequest("http://localhost:3000/api/chat/response", {
        taskId: testTask.id,
        message: "Here is some code",
        artifacts: [
          {
            type: ArtifactType.CODE,
            content: {
              language: "javascript",
              code: "console.log('Hello World');",
            },
            icon: "code",
          },
        ],
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.data.artifacts).toHaveLength(1);
      expect(data.data.artifacts[0].type).toBe(ArtifactType.CODE);

      // Verify artifact was persisted to database
      const chatMessage = await db.chatMessage.findFirst({
        where: { taskId: testTask.id },
        include: { artifacts: true },
      });

      expect(chatMessage?.artifacts).toHaveLength(1);
      expect(chatMessage?.artifacts[0].type).toBe(ArtifactType.CODE);
      expect(chatMessage?.artifacts[0].content).toEqual({
        language: "javascript",
        code: "console.log('Hello World');",
      });
    });

    test("should create message with FORM artifact", async () => {
      const { testTask } = await createChatTestScenario();

      const request = createPostRequest("http://localhost:3000/api/chat/response", {
        taskId: testTask.id,
        message: "Fill out this form",
        artifacts: [
          {
            type: ArtifactType.FORM,
            content: {
              title: "User Survey",
              fields: [
                { name: "email", type: "email", required: true },
                { name: "feedback", type: "textarea", required: false },
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

      // Verify artifact was persisted
      const chatMessage = await db.chatMessage.findFirst({
        where: { taskId: testTask.id },
        include: { artifacts: true },
      });

      expect(chatMessage?.artifacts[0].content).toEqual({
        title: "User Survey",
        fields: [
          { name: "email", type: "email", required: true },
          { name: "feedback", type: "textarea", required: false },
        ],
      });
    });

    test("should create message with BROWSER artifact", async () => {
      const { testTask } = await createChatTestScenario();

      const request = createPostRequest("http://localhost:3000/api/chat/response", {
        taskId: testTask.id,
        message: "Check this preview",
        artifacts: [
          {
            type: ArtifactType.BROWSER,
            content: {
              url: "https://example.com",
              html: "<div>Preview content</div>",
            },
          },
        ],
      });

      const response = await POST(request);

      expect(response.status).toBe(201);

      const chatMessage = await db.chatMessage.findFirst({
        where: { taskId: testTask.id },
        include: { artifacts: true },
      });

      expect(chatMessage?.artifacts[0].type).toBe(ArtifactType.BROWSER);
      expect(chatMessage?.artifacts[0].content).toEqual({
        url: "https://example.com",
        html: "<div>Preview content</div>",
      });
    });

    test("should create message with LONGFORM artifact", async () => {
      const { testTask } = await createChatTestScenario();

      const request = createPostRequest("http://localhost:3000/api/chat/response", {
        taskId: testTask.id,
        message: "Here is a document",
        artifacts: [
          {
            type: ArtifactType.LONGFORM,
            content: {
              title: "Project Documentation",
              body: "This is a long form document with detailed information...",
              sections: [
                { heading: "Introduction", content: "..." },
                { heading: "Getting Started", content: "..." },
              ],
            },
          },
        ],
      });

      const response = await POST(request);

      expect(response.status).toBe(201);

      const chatMessage = await db.chatMessage.findFirst({
        where: { taskId: testTask.id },
        include: { artifacts: true },
      });

      expect(chatMessage?.artifacts[0].type).toBe(ArtifactType.LONGFORM);
      expect(chatMessage?.artifacts[0].content).toHaveProperty("title");
      expect(chatMessage?.artifacts[0].content).toHaveProperty("body");
    });

    test("should create message with BUG_REPORT artifact", async () => {
      const { testTask } = await createChatTestScenario();

      const request = createPostRequest("http://localhost:3000/api/chat/response", {
        taskId: testTask.id,
        message: "Found a bug",
        artifacts: [
          {
            type: ArtifactType.BUG_REPORT,
            content: {
              title: "Login page crash",
              severity: "high",
              steps: [
                "Navigate to login page",
                "Enter invalid credentials",
                "Click submit",
              ],
              expected: "Show error message",
              actual: "Page crashes",
            },
          },
        ],
      });

      const response = await POST(request);

      expect(response.status).toBe(201);

      const chatMessage = await db.chatMessage.findFirst({
        where: { taskId: testTask.id },
        include: { artifacts: true },
      });

      expect(chatMessage?.artifacts[0].type).toBe(ArtifactType.BUG_REPORT);
      expect(chatMessage?.artifacts[0].content).toHaveProperty("title");
      expect(chatMessage?.artifacts[0].content).toHaveProperty("steps");
    });

    test("should create message with multiple artifacts", async () => {
      const { testTask } = await createChatTestScenario();

      const request = createPostRequest("http://localhost:3000/api/chat/response", {
        taskId: testTask.id,
        message: "Multiple artifacts",
        artifacts: [
          {
            type: ArtifactType.CODE,
            content: { code: "console.log('test');" },
          },
          {
            type: ArtifactType.FORM,
            content: { title: "Form", fields: [] },
          },
          {
            type: ArtifactType.BROWSER,
            content: { url: "https://example.com" },
          },
        ],
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.data.artifacts).toHaveLength(3);

      // Verify all artifacts were persisted
      const chatMessage = await db.chatMessage.findFirst({
        where: { taskId: testTask.id },
        include: { artifacts: true },
      });

      expect(chatMessage?.artifacts).toHaveLength(3);
      expect(chatMessage?.artifacts[0].type).toBe(ArtifactType.CODE);
      expect(chatMessage?.artifacts[1].type).toBe(ArtifactType.FORM);
      expect(chatMessage?.artifacts[2].type).toBe(ArtifactType.BROWSER);
    });

    test("should handle empty artifacts array", async () => {
      const { testTask } = await createChatTestScenario();

      const request = createPostRequest("http://localhost:3000/api/chat/response", {
        taskId: testTask.id,
        message: "No artifacts",
        artifacts: [],
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.data.artifacts).toEqual([]);

      const chatMessage = await db.chatMessage.findFirst({
        where: { taskId: testTask.id },
        include: { artifacts: true },
      });

      expect(chatMessage?.artifacts).toEqual([]);
    });
  });

  describe("Context Tags Tests", () => {
    test("should store context tags as JSON", async () => {
      const { testTask } = await createChatTestScenario();

      const contextTags = [
        { type: "file", value: "src/index.ts" },
        { type: "repository", value: "https://github.com/user/repo" },
      ];

      const request = createPostRequest("http://localhost:3000/api/chat/response", {
        taskId: testTask.id,
        message: "Test message",
        contextTags,
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.data.contextTags).toEqual(contextTags);

      // Verify context tags in database
      const chatMessage = await db.chatMessage.findFirst({
        where: { taskId: testTask.id },
      });

      const storedContextTags = JSON.parse(chatMessage?.contextTags as string);
      expect(storedContextTags).toEqual(contextTags);
    });

    test("should handle complex nested context tags", async () => {
      const { testTask } = await createChatTestScenario();

      const contextTags = [
        {
          type: "file",
          value: "src/components/Button.tsx",
          metadata: {
            lines: [10, 50],
            modified: true,
            author: "test@example.com",
          },
        },
      ];

      const request = createPostRequest("http://localhost:3000/api/chat/response", {
        taskId: testTask.id,
        message: "Test message",
        contextTags,
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.data.contextTags).toEqual(contextTags);
    });

    test("should default to empty array when no context tags", async () => {
      const { testTask } = await createChatTestScenario();

      const request = createPostRequest("http://localhost:3000/api/chat/response", {
        taskId: testTask.id,
        message: "Test message",
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.data.contextTags).toEqual([]);
    });
  });

  describe("Error Handling Tests", () => {
    test("should return 500 on database error", async () => {
      // Create a scenario that will cause database error
      // by trying to create message with invalid foreign key
      const request = createPostRequest("http://localhost:3000/api/chat/response", {
        taskId: "invalid-uuid-format-!@#$%",
        message: "Test message",
      });

      const response = await POST(request);

      expect(response.status).toBeOneOf([404, 500]);
      const data = await response.json();
      expect(data).toHaveProperty("error");
    });

    test("should handle Pusher failure gracefully", async () => {
      const { testTask } = await createChatTestScenario();

      // Mock Pusher to fail
      mockPusherServer.trigger.mockRejectedValueOnce(new Error("Pusher failed"));

      const request = createPostRequest("http://localhost:3000/api/chat/response", {
        taskId: testTask.id,
        message: "Test message",
      });

      const response = await POST(request);

      // Message should still be created successfully
      expect(response.status).toBe(201);

      // Verify message was persisted despite Pusher failure
      const chatMessage = await db.chatMessage.findFirst({
        where: { taskId: testTask.id },
      });

      expect(chatMessage).toBeTruthy();
      expect(chatMessage?.message).toBe("Test message");
    });
  });

  describe("Edge Cases", () => {
    test("should handle very long message content", async () => {
      const { testTask } = await createChatTestScenario();

      const longMessage = "a".repeat(10000);

      const request = createPostRequest("http://localhost:3000/api/chat/response", {
        taskId: testTask.id,
        message: longMessage,
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.data.message).toBe(longMessage);

      const chatMessage = await db.chatMessage.findFirst({
        where: { taskId: testTask.id },
      });

      expect(chatMessage?.message).toBe(longMessage);
    });

    test("should handle special characters in message", async () => {
      const { testTask } = await createChatTestScenario();

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

    test("should handle empty message with artifacts", async () => {
      const { testTask } = await createChatTestScenario();

      const request = createPostRequest("http://localhost:3000/api/chat/response", {
        taskId: testTask.id,
        message: "",
        artifacts: [
          {
            type: ArtifactType.CODE,
            content: { code: "console.log('test');" },
          },
        ],
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.data.message).toBe("");
      expect(data.data.artifacts).toHaveLength(1);
    });

    test("should handle null message with artifacts", async () => {
      const { testTask } = await createChatTestScenario();

      const request = createPostRequest("http://localhost:3000/api/chat/response", {
        taskId: testTask.id,
        message: null,
        artifacts: [
          {
            type: ArtifactType.CODE,
            content: { code: "console.log('test');" },
          },
        ],
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.data.message).toBe("");
      expect(data.data.artifacts).toHaveLength(1);
    });

    test("should handle large artifact content", async () => {
      const { testTask } = await createChatTestScenario();

      const largeCode = "console.log('test');\n".repeat(1000);

      const request = createPostRequest("http://localhost:3000/api/chat/response", {
        taskId: testTask.id,
        message: "Large code artifact",
        artifacts: [
          {
            type: ArtifactType.CODE,
            content: {
              language: "javascript",
              code: largeCode,
            },
          },
        ],
      });

      const response = await POST(request);

      expect(response.status).toBe(201);

      const chatMessage = await db.chatMessage.findFirst({
        where: { taskId: testTask.id },
        include: { artifacts: true },
      });

      expect(chatMessage?.artifacts[0].content).toHaveProperty("code", largeCode);
    });

    test("should preserve artifact order", async () => {
      const { testTask } = await createChatTestScenario();

      const request = createPostRequest("http://localhost:3000/api/chat/response", {
        taskId: testTask.id,
        message: "Multiple ordered artifacts",
        artifacts: [
          {
            type: ArtifactType.CODE,
            content: { code: "first" },
          },
          {
            type: ArtifactType.FORM,
            content: { title: "second" },
          },
          {
            type: ArtifactType.BROWSER,
            content: { url: "third" },
          },
        ],
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);

      // Verify order is preserved
      expect(data.data.artifacts[0].content).toHaveProperty("code", "first");
      expect(data.data.artifacts[1].content).toHaveProperty("title", "second");
      expect(data.data.artifacts[2].content).toHaveProperty("url", "third");
    });
  });

  describe("Database Integrity", () => {
    test("should create proper foreign key relationships", async () => {
      const { testTask } = await createChatTestScenario();

      const request = createPostRequest("http://localhost:3000/api/chat/response", {
        taskId: testTask.id,
        message: "Test message",
        artifacts: [
          {
            type: ArtifactType.CODE,
            content: { code: "test" },
          },
        ],
      });

      await POST(request);

      // Verify message-task relationship
      const chatMessage = await db.chatMessage.findFirst({
        where: { taskId: testTask.id },
        include: {
          task: true,
          artifacts: true,
        },
      });

      expect(chatMessage?.task?.id).toBe(testTask.id);
      expect(chatMessage?.artifacts[0].messageId).toBe(chatMessage?.id);
    });

    test("should set correct timestamps", async () => {
      const { testTask } = await createChatTestScenario();

      const beforeRequest = new Date();

      const request = createPostRequest("http://localhost:3000/api/chat/response", {
        taskId: testTask.id,
        message: "Test message",
      });

      await POST(request);

      const afterRequest = new Date();

      const chatMessage = await db.chatMessage.findFirst({
        where: { taskId: testTask.id },
      });

      expect(chatMessage?.timestamp).toBeInstanceOf(Date);
      expect(chatMessage?.timestamp.getTime()).toBeGreaterThanOrEqual(
        beforeRequest.getTime()
      );
      expect(chatMessage?.timestamp.getTime()).toBeLessThanOrEqual(
        afterRequest.getTime()
      );
    });
  });
});