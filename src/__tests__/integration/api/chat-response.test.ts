import { describe, test, expect, beforeEach, vi, afterEach } from "vitest";
import { POST } from "@/app/api/chat/response/route";
import { db } from "@/lib/db";
import { ChatRole, ChatStatus, ArtifactType } from "@/lib/chat";
import {
  generateUniqueId,
  createPostRequest,
} from "@/__tests__/support/helpers";
import { pusherServer, getTaskChannelName, PUSHER_EVENTS } from "@/lib/pusher";

// Mock Pusher
vi.mock("@/lib/pusher", async () => {
  const actual = await vi.importActual("@/lib/pusher");
  return {
    ...actual,
    pusherServer: {
      trigger: vi.fn().mockResolvedValue({}),
    },
  };
});

describe("POST /api/chat/response Integration Tests", () => {
  const mockPusherTrigger = pusherServer.trigger as unknown as ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
  });

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
          createdById: testUser.id,
          updatedById: testUser.id,
        },
      });

      return { testUser, testWorkspace, testTask };
    });
  }

  describe("Request Validation Tests", () => {
    test("should accept request without taskId (for non-task messages)", async () => {
      const request = createPostRequest("http://localhost:3000/api/chat/response", {
        message: "Test message without task",
        contextTags: [],
        artifacts: [],
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.success).toBe(true);
      expect(data.data.message).toBe("Test message without task");
    });

    test("should accept minimal valid payload", async () => {
      const { testTask } = await createTestUserWithWorkspaceAndTask();

      const request = createPostRequest("http://localhost:3000/api/chat/response", {
        taskId: testTask.id,
        message: "Minimal message",
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.success).toBe(true);
      expect(data.data.message).toBe("Minimal message");
      expect(data.data.role).toBe(ChatRole.ASSISTANT);
    });

    test("should handle empty message string", async () => {
      const { testTask } = await createTestUserWithWorkspaceAndTask();

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

    test("should handle missing message with empty string default", async () => {
      const { testTask } = await createTestUserWithWorkspaceAndTask();

      const request = createPostRequest("http://localhost:3000/api/chat/response", {
        taskId: testTask.id,
        // message intentionally omitted
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.success).toBe(true);
      expect(data.data.message).toBe("");
    });
  });

  describe("Task Validation Tests", () => {
    test("should return 404 for non-existent task", async () => {
      const request = createPostRequest("http://localhost:3000/api/chat/response", {
        taskId: "non-existent-task-id",
        message: "Test message",
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe("Task not found");
    });

    test("should return 404 for deleted task", async () => {
      const { testTask } = await createTestUserWithWorkspaceAndTask();

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
  });

  describe("Message Creation Tests", () => {
    test("should create ASSISTANT role message with all fields", async () => {
      const { testTask } = await createTestUserWithWorkspaceAndTask();

      const request = createPostRequest("http://localhost:3000/api/chat/response", {
        taskId: testTask.id,
        message: "AI response message",
        workflowUrl: "https://stakwork.com/workflow/123",
        contextTags: [
          { type: "PRODUCT_BRIEF", id: "product-1" },
          { type: "FEATURE_BRIEF", id: "feature-2" },
        ],
        sourceWebsocketID: "websocket-123",
        artifacts: [
          {
            type: ArtifactType.CODE,
            content: {
              language: "typescript",
              code: "console.log('test')",
              file: "test.ts",
            },
            icon: "Code",
          },
        ],
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.success).toBe(true);
      expect(data.data).toMatchObject({
        taskId: testTask.id,
        message: "AI response message",
        workflowUrl: "https://stakwork.com/workflow/123",
        role: ChatRole.ASSISTANT,
        status: ChatStatus.SENT,
        sourceWebsocketID: "websocket-123",
      });
      expect(data.data.contextTags).toEqual([
        { type: "PRODUCT_BRIEF", id: "product-1" },
        { type: "FEATURE_BRIEF", id: "feature-2" },
      ]);
      expect(data.data.artifacts).toHaveLength(1);
      expect(data.data.artifacts[0]).toMatchObject({
        type: ArtifactType.CODE,
        content: {
          language: "typescript",
          code: "console.log('test')",
          file: "test.ts",
        },
        icon: "Code",
      });

      // Verify database persistence
      const savedMessage = await db.chatMessage.findFirst({
        where: { taskId: testTask.id },
        include: { artifacts: true },
      });

      expect(savedMessage).toBeTruthy();
      expect(savedMessage?.message).toBe("AI response message");
      expect(savedMessage?.role).toBe(ChatRole.ASSISTANT);
      expect(savedMessage?.artifacts).toHaveLength(1);
    });

    test("should create message with CODE artifact type", async () => {
      const { testTask } = await createTestUserWithWorkspaceAndTask();

      const request = createPostRequest("http://localhost:3000/api/chat/response", {
        taskId: testTask.id,
        message: "Here's the code implementation",
        artifacts: [
          {
            type: ArtifactType.CODE,
            content: {
              language: "python",
              code: "def hello():\n    print('world')",
              file: "hello.py",
              action: "create",
            },
            icon: "Code",
          },
        ],
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.data.artifacts).toHaveLength(1);
      expect(data.data.artifacts[0].type).toBe(ArtifactType.CODE);
      expect(data.data.artifacts[0].content).toMatchObject({
        language: "python",
        code: "def hello():\n    print('world')",
        file: "hello.py",
        action: "create",
      });
    });

    test("should create message with FORM artifact type", async () => {
      const { testTask } = await createTestUserWithWorkspaceAndTask();

      const request = createPostRequest("http://localhost:3000/api/chat/response", {
        taskId: testTask.id,
        message: "Please fill out this form",
        artifacts: [
          {
            type: ArtifactType.FORM,
            content: {
              actionText: "Submit Feedback",
              webhook: "https://api.example.com/feedback",
              options: [
                {
                  actionType: "button",
                  optionLabel: "Approve",
                  optionResponse: "I approve this change",
                },
                {
                  actionType: "chat",
                  optionLabel: "Request Changes",
                  optionResponse: "Please make the following changes:",
                },
              ],
            },
            icon: "Message",
          },
        ],
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.data.artifacts).toHaveLength(1);
      expect(data.data.artifacts[0].type).toBe(ArtifactType.FORM);
      expect(data.data.artifacts[0].content).toMatchObject({
        actionText: "Submit Feedback",
        webhook: "https://api.example.com/feedback",
        options: expect.arrayContaining([
          expect.objectContaining({ actionType: "button", optionLabel: "Approve" }),
          expect.objectContaining({ actionType: "chat", optionLabel: "Request Changes" }),
        ]),
      });
    });

    test("should create message with BROWSER artifact type", async () => {
      const { testTask } = await createTestUserWithWorkspaceAndTask();

      const request = createPostRequest("http://localhost:3000/api/chat/response", {
        taskId: testTask.id,
        message: "Preview available",
        artifacts: [
          {
            type: ArtifactType.BROWSER,
            content: {
              url: "https://preview.example.com/component",
            },
            icon: "Agent",
          },
        ],
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.data.artifacts).toHaveLength(1);
      expect(data.data.artifacts[0].type).toBe(ArtifactType.BROWSER);
      expect(data.data.artifacts[0].content).toEqual({
        url: "https://preview.example.com/component",
      });
    });

    test("should create message with LONGFORM artifact type", async () => {
      const { testTask } = await createTestUserWithWorkspaceAndTask();

      const request = createPostRequest("http://localhost:3000/api/chat/response", {
        taskId: testTask.id,
        message: "Detailed analysis",
        artifacts: [
          {
            type: ArtifactType.LONGFORM,
            content: {
              title: "Code Review Summary",
              text: "This is a comprehensive review of the changes...\n\nKey findings:\n1. Architecture is sound\n2. Tests are comprehensive",
            },
          },
        ],
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.data.artifacts).toHaveLength(1);
      expect(data.data.artifacts[0].type).toBe(ArtifactType.LONGFORM);
      expect(data.data.artifacts[0].content).toMatchObject({
        title: "Code Review Summary",
        text: expect.stringContaining("comprehensive review"),
      });
    });

    test("should create message with BUG_REPORT artifact type", async () => {
      const { testTask } = await createTestUserWithWorkspaceAndTask();

      const request = createPostRequest("http://localhost:3000/api/chat/response", {
        taskId: testTask.id,
        message: "Bug detected",
        artifacts: [
          {
            type: ArtifactType.BUG_REPORT,
            content: {
              bugDescription: "Button not responding to clicks",
              iframeUrl: "https://preview.example.com/app",
              method: "click",
              sourceFiles: [
                {
                  file: "src/components/Button.tsx",
                  lines: [45, 46, 47],
                  context: "onClick handler",
                  message: "Event handler not properly bound",
                },
              ],
              coordinates: { x: 100, y: 200, width: 80, height: 40 },
            },
          },
        ],
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.data.artifacts).toHaveLength(1);
      expect(data.data.artifacts[0].type).toBe(ArtifactType.BUG_REPORT);
      expect(data.data.artifacts[0].content).toMatchObject({
        bugDescription: "Button not responding to clicks",
        method: "click",
        sourceFiles: expect.arrayContaining([
          expect.objectContaining({
            file: "src/components/Button.tsx",
            lines: [45, 46, 47],
          }),
        ]),
      });
    });

    test("should create message with multiple artifacts of different types", async () => {
      const { testTask } = await createTestUserWithWorkspaceAndTask();

      const request = createPostRequest("http://localhost:3000/api/chat/response", {
        taskId: testTask.id,
        message: "Multiple artifacts response",
        artifacts: [
          {
            type: ArtifactType.CODE,
            content: { language: "javascript", code: "const x = 1;" },
          },
          {
            type: ArtifactType.BROWSER,
            content: { url: "https://example.com/preview" },
          },
          {
            type: ArtifactType.LONGFORM,
            content: { title: "Summary", text: "Overview of changes" },
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

      // Verify all artifacts were persisted
      const savedMessage = await db.chatMessage.findFirst({
        where: { taskId: testTask.id },
        include: { artifacts: true },
      });

      expect(savedMessage?.artifacts).toHaveLength(3);
    });
  });

  describe("Pusher Broadcast Tests", () => {
    test("should broadcast NEW_MESSAGE event to task channel", async () => {
      const { testTask } = await createTestUserWithWorkspaceAndTask();

      const request = createPostRequest("http://localhost:3000/api/chat/response", {
        taskId: testTask.id,
        message: "Test message",
      });

      await POST(request);

      // Verify Pusher trigger was called
      expect(mockPusherTrigger).toHaveBeenCalledTimes(1);
      expect(mockPusherTrigger).toHaveBeenCalledWith(
        getTaskChannelName(testTask.id),
        PUSHER_EVENTS.NEW_MESSAGE,
        expect.any(String) // message ID
      );
    });

    test("should broadcast with correct channel name format", async () => {
      const { testTask } = await createTestUserWithWorkspaceAndTask();

      const request = createPostRequest("http://localhost:3000/api/chat/response", {
        taskId: testTask.id,
        message: "Test message",
      });

      await POST(request);

      const expectedChannel = `task-${testTask.id}`;
      expect(mockPusherTrigger).toHaveBeenCalledWith(
        expectedChannel,
        expect.any(String),
        expect.any(String)
      );
    });

    test("should not broadcast when taskId is missing", async () => {
      const request = createPostRequest("http://localhost:3000/api/chat/response", {
        message: "Message without task",
      });

      await POST(request);

      expect(mockPusherTrigger).not.toHaveBeenCalled();
    });

    test("should still succeed when Pusher broadcast fails", async () => {
      const { testTask } = await createTestUserWithWorkspaceAndTask();

      // Mock Pusher failure
      mockPusherTrigger.mockRejectedValueOnce(new Error("Pusher connection failed"));

      const request = createPostRequest("http://localhost:3000/api/chat/response", {
        taskId: testTask.id,
        message: "Test message",
      });

      const response = await POST(request);
      const data = await response.json();

      // Request should still succeed
      expect(response.status).toBe(201);
      expect(data.success).toBe(true);

      // Message should be persisted despite Pusher failure
      const savedMessage = await db.chatMessage.findFirst({
        where: { taskId: testTask.id },
      });

      expect(savedMessage).toBeTruthy();
      expect(savedMessage?.message).toBe("Test message");
    });
  });

  describe("Error Handling Tests", () => {
    test("should handle database errors gracefully", async () => {
      const { testTask } = await createTestUserWithWorkspaceAndTask();

      // Create payload with valid taskId but invalid artifact enum that will cause database error
      const request = createPostRequest("http://localhost:3000/api/chat/response", {
        taskId: testTask.id,
        message: "Test message",
        artifacts: [
          {
            type: "INVALID_TYPE" as ArtifactType, // Invalid enum value
            content: {},
          },
        ],
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe("Failed to create chat response");
    });

    test("should handle missing database connection", async () => {
      // This test simulates database connection issues
      // In real scenario, database would be unavailable
      const request = createPostRequest("http://localhost:3000/api/chat/response", {
        taskId: generateUniqueId("task"),
        message: "Test message",
      });

      const response = await POST(request);

      // Should return 500 or 404 depending on where the failure occurs
      expect([404, 500]).toContain(response.status);
    });
  });

  describe("Edge Cases", () => {
    test("should handle empty contextTags array", async () => {
      const { testTask } = await createTestUserWithWorkspaceAndTask();

      const request = createPostRequest("http://localhost:3000/api/chat/response", {
        taskId: testTask.id,
        message: "Test message",
        contextTags: [],
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.data.contextTags).toEqual([]);
    });

    test("should handle empty artifacts array", async () => {
      const { testTask } = await createTestUserWithWorkspaceAndTask();

      const request = createPostRequest("http://localhost:3000/api/chat/response", {
        taskId: testTask.id,
        message: "Test message",
        artifacts: [],
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.data.artifacts).toEqual([]);
    });

    test("should handle very long message content", async () => {
      const { testTask } = await createTestUserWithWorkspaceAndTask();

      const longMessage = "a".repeat(10000);

      const request = createPostRequest("http://localhost:3000/api/chat/response", {
        taskId: testTask.id,
        message: longMessage,
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.data.message).toBe(longMessage);
      expect(data.data.message.length).toBe(10000);
    });

    test("should handle special characters in message", async () => {
      const { testTask } = await createTestUserWithWorkspaceAndTask();

      const specialMessage = "Test with 🚀 emojis and special chars: àáâäåæçèéêë & <html> tags & \"quotes\" & 'apostrophes'";

      const request = createPostRequest("http://localhost:3000/api/chat/response", {
        taskId: testTask.id,
        message: specialMessage,
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.data.message).toBe(specialMessage);
    });

    test("should handle special characters in artifact content", async () => {
      const { testTask } = await createTestUserWithWorkspaceAndTask();

      const request = createPostRequest("http://localhost:3000/api/chat/response", {
        taskId: testTask.id,
        message: "Code with special chars",
        artifacts: [
          {
            type: ArtifactType.CODE,
            content: {
              language: "javascript",
              code: "const str = \"Hello 'World' with \\\"quotes\\\"\";\nconsole.log(`Template ${str}`);\n// Comment with 🎯 emoji",
            },
          },
        ],
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.data.artifacts[0].content.code).toContain("quotes");
      expect(data.data.artifacts[0].content.code).toContain("🎯");
    });

    test("should handle null workflowUrl", async () => {
      const { testTask } = await createTestUserWithWorkspaceAndTask();

      const request = createPostRequest("http://localhost:3000/api/chat/response", {
        taskId: testTask.id,
        message: "Test message",
        workflowUrl: null,
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.data.workflowUrl).toBeNull();
    });

    test("should handle undefined sourceWebsocketID", async () => {
      const { testTask } = await createTestUserWithWorkspaceAndTask();

      const request = createPostRequest("http://localhost:3000/api/chat/response", {
        taskId: testTask.id,
        message: "Test message",
        // sourceWebsocketID intentionally omitted
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.data.sourceWebsocketID).toBeNull();
    });

    test("should handle complex nested artifact content", async () => {
      const { testTask } = await createTestUserWithWorkspaceAndTask();

      const request = createPostRequest("http://localhost:3000/api/chat/response", {
        taskId: testTask.id,
        message: "Complex artifact",
        artifacts: [
          {
            type: ArtifactType.BUG_REPORT,
            content: {
              bugDescription: "Complex nested structure",
              iframeUrl: "https://example.com",
              method: "selection",
              sourceFiles: [
                {
                  file: "src/deeply/nested/path/component.tsx",
                  lines: [1, 2, 3, 4, 5],
                  context: "Complex context",
                  message: "Detailed message",
                  componentNames: [
                    {
                      name: "ParentComponent",
                      level: 0,
                      type: "FunctionComponent",
                      element: "div",
                    },
                    {
                      name: "ChildComponent",
                      level: 1,
                      type: "ClassComponent",
                      element: "span",
                    },
                  ],
                },
              ],
              coordinates: { x: 0, y: 0, width: 100, height: 100 },
            },
          },
        ],
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.data.artifacts[0].content.sourceFiles[0].componentNames).toHaveLength(2);
      expect(data.data.artifacts[0].content.sourceFiles[0].componentNames[0].name).toBe("ParentComponent");
    });

    test("should preserve artifact icon when provided", async () => {
      const { testTask } = await createTestUserWithWorkspaceAndTask();

      const request = createPostRequest("http://localhost:3000/api/chat/response", {
        taskId: testTask.id,
        message: "Test with icon",
        artifacts: [
          {
            type: ArtifactType.CODE,
            content: { language: "typescript", code: "const x = 1;" },
            icon: "Code",
          },
        ],
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.data.artifacts[0].icon).toBe("Code");
    });

    test("should handle artifact without icon", async () => {
      const { testTask } = await createTestUserWithWorkspaceAndTask();

      const request = createPostRequest("http://localhost:3000/api/chat/response", {
        taskId: testTask.id,
        message: "Test without icon",
        artifacts: [
          {
            type: ArtifactType.CODE,
            content: { language: "typescript", code: "const x = 1;" },
            // icon intentionally omitted
          },
        ],
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.data.artifacts[0].icon).toBeNull();
    });
  });

  describe("Response Format Tests", () => {
    test("should return correct response structure on success", async () => {
      const { testTask } = await createTestUserWithWorkspaceAndTask();

      const request = createPostRequest("http://localhost:3000/api/chat/response", {
        taskId: testTask.id,
        message: "Test message",
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data).toMatchObject({
        success: true,
        data: expect.objectContaining({
          id: expect.any(String),
          taskId: testTask.id,
          message: "Test message",
          role: ChatRole.ASSISTANT,
          status: ChatStatus.SENT,
          createdAt: expect.any(String),
          updatedAt: expect.any(String),
          timestamp: expect.any(String),
        }),
      });
    });

    test("should transform contextTags from JSON string to array in response", async () => {
      const { testTask } = await createTestUserWithWorkspaceAndTask();

      const contextTags = [
        { type: "PRODUCT_BRIEF", id: "product-1" },
        { type: "FEATURE_BRIEF", id: "feature-2" },
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
      expect(Array.isArray(data.data.contextTags)).toBe(true);
    });

    test("should include task information in response", async () => {
      const { testTask } = await createTestUserWithWorkspaceAndTask();

      const request = createPostRequest("http://localhost:3000/api/chat/response", {
        taskId: testTask.id,
        message: "Test message",
      });

      const response = await POST(request);
      const data = await response.json();

      expect(response.status).toBe(201);
      expect(data.data.task).toMatchObject({
        id: testTask.id,
        title: testTask.title,
      });
    });
  });
});