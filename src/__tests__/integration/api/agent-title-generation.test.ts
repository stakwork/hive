/**
 * Integration tests for agent endpoint automatic title generation
 * 
 * NOTE: These tests are currently COMMENTED OUT because the production code
 * has not been implemented yet in src/app/api/agent/route.ts.
 * 
 * UNCOMMENT AND RUN after implementing the title generation logic in the agent endpoint's after() block.
 * 
 * Expected implementation (around line 308 in agent/route.ts):
 * 1. After final save with SENT status in after() block
 * 2. Check if first conversation: if (chatHistory.length === 0)
 * 3. Fetch task with workspace info
 * 4. Generate title using generateChatTitle(message, accumulatedText)
 * 5. Skip if title unchanged
 * 6. Update database with new title
 * 7. Broadcast via Pusher to both task and workspace channels
 * 8. Wrap in try-catch with error logging (don't throw)
 */

import { describe, test, beforeEach, vi, expect, afterEach } from "vitest";
import { POST } from "@/app/api/agent/route";
import {
  createAuthenticatedSession,
  getMockedSession,
  createPostRequest,
} from "@/__tests__/support/helpers";
import { createTestUser } from "@/__tests__/support/fixtures/user";
import { createTestWorkspace } from "@/__tests__/support/fixtures/workspace";
import { resetDatabase } from "@/__tests__/support/fixtures/database";
import { db } from "@/lib/db";
import { ChatRole, ChatStatus } from "@prisma/client";

// Mock dependencies
vi.mock("ai-sdk-provider-goose-web", () => ({
  gooseWeb: vi.fn(),
  validateGooseSession: vi.fn().mockResolvedValue({ valid: true }),
}));

vi.mock("@/lib/pusher", () => ({
  pusherServer: {
    trigger: vi.fn().mockResolvedValue({} as any),
  },
  getTaskChannelName: vi.fn((taskId: string) => `task-${taskId}`),
  getWorkspaceChannelName: vi.fn((slug: string) => `workspace-${slug}`),
  PUSHER_EVENTS: {
    TASK_TITLE_UPDATE: "task-title-update",
    WORKSPACE_TASK_TITLE_UPDATE: "workspace-task-title-update",
  },
}));

// Mock the title generation utility
vi.mock("@/lib/ai/generate-chat-title", () => ({
  generateChatTitle: vi.fn().mockResolvedValue("Generated Chat Title"),
}));

// Mock AI SDK
vi.mock("ai", () => ({
  streamText: vi.fn(async () => {
    // Create a mock readable stream that simulates streaming
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        // Simulate text chunks
        controller.enqueue(encoder.encode('data: {"type":"text-delta","text":"Mock "}\n\n'));
        controller.enqueue(encoder.encode('data: {"type":"text-delta","text":"response"}\n\n'));
        controller.enqueue(encoder.encode('data: {"type":"finish","finishReason":"stop"}\n\n'));
        controller.close();
      },
    });

    return {
      fullStream: {
        tee: () => [
          // Frontend stream
          (async function* () {
            yield { type: "text-delta", text: "Mock " };
            yield { type: "text-delta", text: "response" };
            yield { type: "finish", finishReason: "stop" };
          })(),
          // DB stream
          (async function* () {
            yield { type: "text-delta", text: "Mock " };
            yield { type: "text-delta", text: "response" };
            yield { type: "finish", finishReason: "stop" };
          })(),
        ],
      },
      toDataStreamResponse: () => new Response(stream),
    };
  }),
}));

describe.skip("POST /api/agent - Title Generation Integration Tests", () => {
  let user: Awaited<ReturnType<typeof createTestUser>>;
  let workspace: Awaited<ReturnType<typeof createTestWorkspace>>;
  let task: Awaited<ReturnType<typeof db.task.create>>;

  beforeEach(async () => {
    await resetDatabase();
    vi.clearAllMocks();

    // Create test user and workspace
    user = await createTestUser();
    workspace = await createTestWorkspace(user.id);

    // Create a task in agent mode with credentials
    task = await db.task.create({
      data: {
        title: "Initial long title that should be replaced by AI generation after first message",
        description: "Test task description",
        workspaceId: workspace.id,
        creatorId: user.id,
        mode: "agent",
        agentUrl: "ws://localhost:8888/ws",
        agentPassword: JSON.stringify({
          data: "encrypted-password",
          iv: "test-iv",
          tag: "test-tag",
          version: "1",
          encryptedAt: new Date().toISOString(),
        }),
      },
    });

    // Mock authenticated session
    getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

    // Set environment variables for testing
    process.env.CUSTOM_GOOSE_URL = "ws://localhost:8888/ws";
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.CUSTOM_GOOSE_URL;
  });

  describe("First Message - Title Generation", () => {
    test("should generate and update title after first assistant response", async () => {
      const { generateChatTitle } = await import("@/lib/ai/generate-chat-title");
      const { pusherServer, PUSHER_EVENTS } = await import("@/lib/pusher");

      const userMessage = "How do I implement authentication in Next.js?";

      const request = createPostRequest("http://localhost/api/agent", {
        message: userMessage,
        taskId: task.id,
      });

      await POST(request);

      // Wait for after() block to complete
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify title was generated with correct arguments
      expect(generateChatTitle).toHaveBeenCalledWith(
        userMessage,
        "Mock response"
      );

      // Verify task title was updated in database
      const updatedTask = await db.task.findUnique({
        where: { id: task.id },
      });
      expect(updatedTask?.title).toBe("Generated Chat Title");

      // Verify Pusher events were broadcasted
      expect(pusherServer.trigger).toHaveBeenCalledWith(
        `task-${task.id}`,
        PUSHER_EVENTS.TASK_TITLE_UPDATE,
        expect.objectContaining({
          taskId: task.id,
          newTitle: "Generated Chat Title",
          previousTitle: task.title,
          timestamp: expect.any(Date),
        })
      );

      expect(pusherServer.trigger).toHaveBeenCalledWith(
        `workspace-${workspace.slug}`,
        PUSHER_EVENTS.WORKSPACE_TASK_TITLE_UPDATE,
        expect.objectContaining({
          taskId: task.id,
          newTitle: "Generated Chat Title",
        })
      );
    });

    test("should not update title if generated title matches existing title", async () => {
      const { generateChatTitle } = await import("@/lib/ai/generate-chat-title");
      const { pusherServer } = await import("@/lib/pusher");

      // Create task with a title that matches what will be generated
      const taskWithMatchingTitle = await db.task.create({
        data: {
          title: "Same Title",
          description: "Test task",
          workspaceId: workspace.id,
          creatorId: user.id,
          mode: "agent",
          agentUrl: "ws://localhost:8888/ws",
          agentPassword: JSON.stringify({
            data: "encrypted-password",
            iv: "test-iv",
            tag: "test-tag",
            version: "1",
            encryptedAt: new Date().toISOString(),
          }),
        },
      });

      // Mock generation to return the same title
      vi.mocked(generateChatTitle).mockResolvedValue("Same Title");

      const request = createPostRequest("http://localhost/api/agent", {
        message: "Test message",
        taskId: taskWithMatchingTitle.id,
      });

      await POST(request);

      // Wait for after() block
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify no Pusher events were sent
      expect(pusherServer.trigger).not.toHaveBeenCalled();

      // Verify title wasn't updated
      const unchangedTask = await db.task.findUnique({
        where: { id: taskWithMatchingTitle.id },
      });
      expect(unchangedTask?.title).toBe("Same Title");
    });

    test("should only generate title on first message exchange", async () => {
      const { generateChatTitle } = await import("@/lib/ai/generate-chat-title");

      // Create existing chat history
      await db.chatMessage.create({
        data: {
          taskId: task.id,
          message: "Previous user message",
          role: ChatRole.USER,
          status: ChatStatus.SENT,
          contextTags: JSON.stringify([]),
          sourceWebsocketID: "existing-session-id",
        },
      });

      await db.chatMessage.create({
        data: {
          taskId: task.id,
          message: "Previous assistant response",
          role: ChatRole.ASSISTANT,
          status: ChatStatus.SENT,
          contextTags: JSON.stringify([]),
          sourceWebsocketID: "existing-session-id",
        },
      });

      const request = createPostRequest("http://localhost/api/agent", {
        message: "Second user message",
        taskId: task.id,
      });

      await POST(request);

      // Wait for after() block
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify title generation was NOT called (chatHistory.length > 0)
      expect(generateChatTitle).not.toHaveBeenCalled();
    });
  });

  describe("Error Handling", () => {
    test("should not break chat functionality if title generation fails", async () => {
      const { generateChatTitle } = await import("@/lib/ai/generate-chat-title");

      // Mock title generation to throw error
      vi.mocked(generateChatTitle).mockRejectedValue(
        new Error("AI service unavailable")
      );

      const request = createPostRequest("http://localhost/api/agent", {
        message: "Test message",
        taskId: task.id,
      });

      const response = await POST(request);

      // Response should still succeed
      expect(response.status).toBe(200);

      // Wait for after() block
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify assistant message was still saved
      const messages = await db.chatMessage.findMany({
        where: { taskId: task.id, role: ChatRole.ASSISTANT },
      });
      expect(messages.length).toBeGreaterThan(0);
      expect(messages[0].status).toBe(ChatStatus.SENT);
    });

    test("should log error when title generation fails", async () => {
      const { generateChatTitle } = await import("@/lib/ai/generate-chat-title");
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      vi.mocked(generateChatTitle).mockRejectedValue(
        new Error("AI service unavailable")
      );

      const request = createPostRequest("http://localhost/api/agent", {
        message: "Test message",
        taskId: task.id,
      });

      await POST(request);

      // Wait for after() block
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("Error generating/updating task title"),
        expect.any(Error)
      );

      consoleErrorSpy.mockRestore();
    });

    test("should handle task not found gracefully during title update", async () => {
      const { generateChatTitle } = await import("@/lib/ai/generate-chat-title");

      // Delete the task to simulate race condition
      await db.task.delete({ where: { id: task.id } });

      const request = createPostRequest("http://localhost/api/agent", {
        message: "Test message",
        taskId: task.id,
      });

      const response = await POST(request);

      // Response should indicate task not found
      expect(response.status).toBe(404);

      // Title generation should not be called
      expect(generateChatTitle).not.toHaveBeenCalled();
    });

    test("should continue if Pusher broadcast fails", async () => {
      const { generateChatTitle } = await import("@/lib/ai/generate-chat-title");
      const { pusherServer } = await import("@/lib/pusher");
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      // Mock Pusher to fail
      vi.mocked(pusherServer.trigger).mockRejectedValue(
        new Error("Pusher connection failed")
      );

      const request = createPostRequest("http://localhost/api/agent", {
        message: "Test message",
        taskId: task.id,
      });

      await POST(request);

      // Wait for after() block
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify title was still generated and saved
      expect(generateChatTitle).toHaveBeenCalled();

      const updatedTask = await db.task.findUnique({
        where: { id: task.id },
      });
      expect(updatedTask?.title).toBe("Generated Chat Title");

      // Error should be logged but not thrown
      expect(consoleErrorSpy).toHaveBeenCalled();

      consoleErrorSpy.mockRestore();
    });
  });

  describe("Pusher Broadcasting", () => {
    test("should broadcast to both task and workspace channels", async () => {
      const { pusherServer, getTaskChannelName, getWorkspaceChannelName, PUSHER_EVENTS } =
        await import("@/lib/pusher");

      const request = createPostRequest("http://localhost/api/agent", {
        message: "Test message",
        taskId: task.id,
      });

      await POST(request);

      // Wait for after() block
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify channel name helpers were called
      expect(getTaskChannelName).toHaveBeenCalledWith(task.id);
      expect(getWorkspaceChannelName).toHaveBeenCalledWith(workspace.slug);

      // Verify both channels received events
      const triggerCalls = vi.mocked(pusherServer.trigger).mock.calls;
      expect(triggerCalls.length).toBe(2);

      // Task channel
      expect(triggerCalls[0]).toEqual([
        `task-${task.id}`,
        PUSHER_EVENTS.TASK_TITLE_UPDATE,
        expect.objectContaining({
          taskId: task.id,
          newTitle: "Generated Chat Title",
          previousTitle: task.title,
        }),
      ]);

      // Workspace channel
      expect(triggerCalls[1]).toEqual([
        `workspace-${workspace.slug}`,
        PUSHER_EVENTS.WORKSPACE_TASK_TITLE_UPDATE,
        expect.objectContaining({
          taskId: task.id,
          newTitle: "Generated Chat Title",
        }),
      ]);
    });

    test("should include timestamp in Pusher payload", async () => {
      const { pusherServer } = await import("@/lib/pusher");

      const request = createPostRequest("http://localhost/api/agent", {
        message: "Test message",
        taskId: task.id,
      });

      await POST(request);

      // Wait for after() block
      await new Promise((resolve) => setTimeout(resolve, 100));

      const triggerCalls = vi.mocked(pusherServer.trigger).mock.calls;
      const payload = triggerCalls[0][2];

      expect(payload).toHaveProperty("timestamp");
      expect(payload.timestamp).toBeInstanceOf(Date);
    });

    test("should include previousTitle in Pusher payload", async () => {
      const { pusherServer } = await import("@/lib/pusher");

      const originalTitle = task.title;

      const request = createPostRequest("http://localhost/api/agent", {
        message: "Test message",
        taskId: task.id,
      });

      await POST(request);

      // Wait for after() block
      await new Promise((resolve) => setTimeout(resolve, 100));

      const triggerCalls = vi.mocked(pusherServer.trigger).mock.calls;
      const payload = triggerCalls[0][2];

      expect(payload.previousTitle).toBe(originalTitle);
      expect(payload.newTitle).toBe("Generated Chat Title");
    });
  });

  describe("Background Processing", () => {
    test("should run title generation in after() block without blocking response", async () => {
      const { generateChatTitle } = await import("@/lib/ai/generate-chat-title");

      // Add delay to title generation to verify it doesn't block
      vi.mocked(generateChatTitle).mockImplementation(
        () =>
          new Promise((resolve) => setTimeout(() => resolve("Delayed Title"), 200))
      );

      const startTime = Date.now();

      const request = createPostRequest("http://localhost/api/agent", {
        message: "Test message",
        taskId: task.id,
      });

      const response = await POST(request);

      const responseTime = Date.now() - startTime;

      // Response should come back quickly (< 100ms), not wait for title generation (200ms)
      expect(responseTime).toBeLessThan(100);
      expect(response.status).toBe(200);

      // Wait for background processing
      await new Promise((resolve) => setTimeout(resolve, 300));

      // Verify title was eventually updated
      const updatedTask = await db.task.findUnique({
        where: { id: task.id },
      });
      expect(updatedTask?.title).toBe("Delayed Title");
    });

    test("should save assistant message before title generation", async () => {
      const { generateChatTitle } = await import("@/lib/ai/generate-chat-title");

      // Track when title generation is called
      let titleGenerationCalled = false;
      vi.mocked(generateChatTitle).mockImplementation(async () => {
        titleGenerationCalled = true;
        return "Generated Title";
      });

      const request = createPostRequest("http://localhost/api/agent", {
        message: "Test message",
        taskId: task.id,
      });

      await POST(request);

      // Wait for after() block
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify assistant message was saved
      const assistantMessages = await db.chatMessage.findMany({
        where: { taskId: task.id, role: ChatRole.ASSISTANT },
      });

      expect(assistantMessages.length).toBeGreaterThan(0);
      expect(assistantMessages[0].status).toBe(ChatStatus.SENT);
      expect(titleGenerationCalled).toBe(true);
    });
  });

  describe("Title Trimming", () => {
    test("should trim whitespace from generated title before saving", async () => {
      const { generateChatTitle } = await import("@/lib/ai/generate-chat-title");

      vi.mocked(generateChatTitle).mockResolvedValue("  Title With Spaces  ");

      const request = createPostRequest("http://localhost/api/agent", {
        message: "Test message",
        taskId: task.id,
      });

      await POST(request);

      // Wait for after() block
      await new Promise((resolve) => setTimeout(resolve, 100));

      const updatedTask = await db.task.findUnique({
        where: { id: task.id },
      });
      expect(updatedTask?.title).toBe("Title With Spaces");
    });

    test("should handle title with newlines", async () => {
      const { generateChatTitle } = await import("@/lib/ai/generate-chat-title");

      vi.mocked(generateChatTitle).mockResolvedValue("Title\nWith\nNewlines");

      const request = createPostRequest("http://localhost/api/agent", {
        message: "Test message",
        taskId: task.id,
      });

      await POST(request);

      // Wait for after() block
      await new Promise((resolve) => setTimeout(resolve, 100));

      const updatedTask = await db.task.findUnique({
        where: { id: task.id },
      });
      // Should trim but preserve the content
      expect(updatedTask?.title).toBe("Title\nWith\nNewlines");
    });
  });
});
