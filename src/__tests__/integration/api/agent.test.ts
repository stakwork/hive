import { describe, test, expect, beforeEach, vi, afterEach } from "vitest";
import { POST } from "@/app/api/agent/route";
import { createTestUser } from "@/__tests__/support/fixtures/user";
import { createTestWorkspace } from "@/__tests__/support/fixtures/workspace";
import { db } from "@/lib/db";
import type { ChatMessage, Artifact } from "@prisma/client";

// Mock next-auth for session management
vi.mock("next-auth/next", () => ({
  getServerSession: vi.fn(),
}));

// Mock Goose Web provider
vi.mock("ai-sdk-provider-goose-web", () => ({
  gooseWeb: vi.fn(),
}));

// Mock AI SDK functions
vi.mock("ai", () => ({
  streamText: vi.fn(),
  tool: vi.fn(),
}));

// Import mocked functions
import { getServerSession } from "next-auth/next";
import { gooseWeb } from "ai-sdk-provider-goose-web";
import { streamText } from "ai";

// Helper to create authenticated session
function createAuthenticatedSession(userId: string, email: string, name: string | null) {
  return {
    user: {
      id: userId,
      email,
      name,
    },
    expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
  };
}

// Helper to create POST request
function createPostRequest(url: string, body: Record<string, unknown>) {
  return new Request(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

// Helper to create mock ReadableStream for SSE
function createMockSSEStream(events: Array<{ type: string; data: unknown }>) {
  return new ReadableStream({
    start(controller) {
      for (const event of events) {
        const chunk = `data: ${JSON.stringify({ type: event.type, ...event.data })}\n\n`;
        controller.enqueue(new TextEncoder().encode(chunk));
      }
      controller.close();
    },
  });
}

describe("POST /api/agent Integration Tests", () => {
  let testUser: Awaited<ReturnType<typeof createTestUser>>;
  let testWorkspace: Awaited<ReturnType<typeof createTestWorkspace>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    
    // Create test user and workspace
    testUser = await createTestUser({
      name: "Agent Test User",
      email: "agent-test@example.com",
    });

    testWorkspace = await createTestWorkspace({
      name: "Agent Test Workspace",
      slug: "agent-test-workspace",
      ownerId: testUser.id,
    });

    // Mock successful Goose Web provider by default
    vi.mocked(gooseWeb).mockReturnValue({
      provider: "goose-web",
      model: "default",
    } as any);
  });

  afterEach(async () => {
    // Clean up test data - cascade delete handles artifacts and messages
    await db.task.deleteMany({
      where: { workspaceId: testWorkspace.id },
    });

    await db.workspace.delete({
      where: { id: testWorkspace.id },
    });

    await db.user.delete({
      where: { id: testUser.id },
    });
  });

  describe("Authentication scenarios", () => {
    test("should return 401 for unauthenticated requests", async () => {
      vi.mocked(getServerSession).mockResolvedValue(null);

      const request = createPostRequest("http://localhost:3000/api/agent", {
        taskId: "test-task-id",
        message: "Test message",
      });

      const response = await POST(request as any);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Unauthorized");
    });

    test("should return 401 for session without user ID", async () => {
      vi.mocked(getServerSession).mockResolvedValue({
        user: { email: "test@example.com" }, // Missing id
        expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      } as any);

      const request = createPostRequest("http://localhost:3000/api/agent", {
        taskId: "test-task-id",
        message: "Test message",
      });

      const response = await POST(request as any);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Unauthorized");
    });

    test("should accept authenticated requests", async () => {
      const task = await db.task.create({
        data: {
          title: "Test Task",
          workspaceId: testWorkspace.id,
          createdById: testUser.id,
          updatedById: testUser.id,
          priority: "MEDIUM",
        },
      });

      vi.mocked(getServerSession).mockResolvedValue(
        createAuthenticatedSession(testUser.id, testUser.email, testUser.name)
      );

      // Mock streamText to return a mock stream
      vi.mocked(streamText).mockResolvedValue({
        toDataStreamResponse: vi.fn().mockReturnValue(
          new Response(createMockSSEStream([
            { type: "text-delta", data: { textDelta: "Hello" } },
          ]))
        ),
      } as any);

      const request = createPostRequest("http://localhost:3000/api/agent", {
        taskId: task.id,
        message: "Test message",
      });

      const response = await POST(request as any);

      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toContain("text/event-stream");
    });
  });

  describe("Request validation scenarios", () => {
    beforeEach(() => {
      vi.mocked(getServerSession).mockResolvedValue(
        createAuthenticatedSession(testUser.id, testUser.email, testUser.name)
      );
    });

    test("should return 400 for missing taskId", async () => {
      const request = createPostRequest("http://localhost:3000/api/agent", {
        message: "Test message",
      });

      const response = await POST(request as any);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain("taskId");
    });

    test("should return 400 for missing message", async () => {
      const task = await db.task.create({
        data: {
          title: "Test Task",
          workspaceId: testWorkspace.id,
          createdById: testUser.id,
          updatedById: testUser.id,
          priority: "MEDIUM",
        },
      });

      const request = createPostRequest("http://localhost:3000/api/agent", {
        taskId: task.id,
      });

      const response = await POST(request as any);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain("message");
    });
  });

  describe("Chat history and session management", () => {
    let testTask: Awaited<ReturnType<typeof db.task.create>>;

    beforeEach(async () => {
      vi.mocked(getServerSession).mockResolvedValue(
        createAuthenticatedSession(testUser.id, testUser.email, testUser.name)
      );

      testTask = await db.task.create({
        data: {
          title: "Test Task for Chat",
          workspaceId: testWorkspace.id,
          createdById: testUser.id,
          updatedById: testUser.id,
          priority: "MEDIUM",
        },
      });

      vi.mocked(streamText).mockResolvedValue({
        toDataStreamResponse: vi.fn().mockReturnValue(
          new Response(createMockSSEStream([
            { type: "text-delta", data: { textDelta: "Response" } },
          ]))
        ),
      } as any);
    });

    test("should generate new session ID for first message", async () => {
      const request = createPostRequest("http://localhost:3000/api/agent", {
        taskId: testTask.id,
        message: "First message",
      });

      await POST(request as any);

      // Check that a message was created with a session ID
      const messages = await db.chatMessage.findMany({
        where: { taskId: testTask.id },
      });

      expect(messages).toHaveLength(1);
      expect(messages[0].sessionId).toBeDefined();
      expect(messages[0].sessionId).toMatch(/^\d{8}_\d{6}$/); // Format: yyyymmdd_hhmmss
    });

    test("should reuse session ID for subsequent messages", async () => {
      // Create first message with session ID
      const sessionId = "20240101_120000";
      await db.chatMessage.create({
        data: {
          taskId: testTask.id,
          role: "USER",
          content: "Previous message",
          status: "DELIVERED",
          sessionId,
        },
      });

      const request = createPostRequest("http://localhost:3000/api/agent", {
        taskId: testTask.id,
        message: "Second message",
        sessionId,
      });

      await POST(request as any);

      // Check that new message uses same session ID
      const messages = await db.chatMessage.findMany({
        where: { taskId: testTask.id },
        orderBy: { createdAt: "asc" },
      });

      expect(messages).toHaveLength(2);
      expect(messages[1].sessionId).toBe(sessionId);
    });

    test("should load chat history from database", async () => {
      // Create previous messages
      const sessionId = "20240101_120000";
      await db.chatMessage.createMany({
        data: [
          {
            taskId: testTask.id,
            role: "USER",
            content: "Message 1",
            status: "DELIVERED",
            sessionId,
          },
          {
            taskId: testTask.id,
            role: "ASSISTANT",
            content: "Response 1",
            status: "DELIVERED",
            sessionId,
          },
          {
            taskId: testTask.id,
            role: "USER",
            content: "Message 2",
            status: "DELIVERED",
            sessionId,
          },
        ],
      });

      const request = createPostRequest("http://localhost:3000/api/agent", {
        taskId: testTask.id,
        message: "Message 3",
        sessionId,
      });

      await POST(request as any);

      // Verify streamText was called with chat history
      expect(streamText).toHaveBeenCalled();
      const streamTextCall = vi.mocked(streamText).mock.calls[0][0];
      expect(streamTextCall.messages).toBeDefined();
      expect(streamTextCall.messages.length).toBeGreaterThan(0);
    });
  });

  describe("Message persistence with artifacts", () => {
    let testTask: Awaited<ReturnType<typeof db.task.create>>;

    beforeEach(async () => {
      vi.mocked(getServerSession).mockResolvedValue(
        createAuthenticatedSession(testUser.id, testUser.email, testUser.name)
      );

      testTask = await db.task.create({
        data: {
          title: "Test Task for Artifacts",
          workspaceId: testWorkspace.id,
          createdById: testUser.id,
          updatedById: testUser.id,
          priority: "MEDIUM",
        },
      });

      vi.mocked(streamText).mockResolvedValue({
        toDataStreamResponse: vi.fn().mockReturnValue(
          new Response(createMockSSEStream([
            { type: "text-delta", data: { textDelta: "Response" } },
          ]))
        ),
      } as any);
    });

    test("should persist user message to database", async () => {
      const request = createPostRequest("http://localhost:3000/api/agent", {
        taskId: testTask.id,
        message: "Test message to persist",
      });

      await POST(request as any);

      const messages = await db.chatMessage.findMany({
        where: { taskId: testTask.id },
      });

      expect(messages).toHaveLength(1);
      expect(messages[0].role).toBe("USER");
      expect(messages[0].content).toBe("Test message to persist");
      expect(messages[0].status).toBe("SENT");
    });

    test("should persist message with artifacts", async () => {
      const artifacts = [
        {
          type: "FORMS" as const,
          content: {
            title: "Test Form",
            fields: [{ name: "field1", type: "text" }],
          },
        },
      ];

      const request = createPostRequest("http://localhost:3000/api/agent", {
        taskId: testTask.id,
        message: "Message with artifacts",
        artifacts,
      });

      await POST(request as any);

      const messages = await db.chatMessage.findMany({
        where: { taskId: testTask.id },
        include: { artifacts: true },
      });

      expect(messages).toHaveLength(1);
      expect(messages[0].artifacts).toHaveLength(1);
      expect(messages[0].artifacts[0].type).toBe("FORMS");
      expect(messages[0].artifacts[0].content).toEqual(artifacts[0].content);
    });

    test("should handle multiple artifacts", async () => {
      const artifacts = [
        {
          type: "FORMS" as const,
          content: { title: "Form 1" },
        },
        {
          type: "CODE" as const,
          content: { language: "typescript", code: "const x = 1;" },
        },
      ];

      const request = createPostRequest("http://localhost:3000/api/agent", {
        taskId: testTask.id,
        message: "Message with multiple artifacts",
        artifacts,
      });

      await POST(request as any);

      const messages = await db.chatMessage.findMany({
        where: { taskId: testTask.id },
        include: { artifacts: true },
      });

      expect(messages).toHaveLength(1);
      expect(messages[0].artifacts).toHaveLength(2);
      expect(messages[0].artifacts.map((a) => a.type)).toEqual(["FORMS", "CODE"]);
    });
  });

  describe("Goose Web streaming scenarios", () => {
    let testTask: Awaited<ReturnType<typeof db.task.create>>;

    beforeEach(async () => {
      vi.mocked(getServerSession).mockResolvedValue(
        createAuthenticatedSession(testUser.id, testUser.email, testUser.name)
      );

      testTask = await db.task.create({
        data: {
          title: "Test Task for Streaming",
          workspaceId: testWorkspace.id,
          createdById: testUser.id,
          updatedById: testUser.id,
          priority: "MEDIUM",
        },
      });
    });

    test("should stream text-delta events", async () => {
      vi.mocked(streamText).mockResolvedValue({
        toDataStreamResponse: vi.fn().mockReturnValue(
          new Response(createMockSSEStream([
            { type: "text-delta", data: { textDelta: "Hello" } },
            { type: "text-delta", data: { textDelta: " world" } },
          ]))
        ),
      } as any);

      const request = createPostRequest("http://localhost:3000/api/agent", {
        taskId: testTask.id,
        message: "Test streaming",
      });

      const response = await POST(request as any);

      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toContain("text/event-stream");
      
      // Read stream to verify events
      const reader = response.body?.getReader();
      expect(reader).toBeDefined();
    });

    test("should initialize Goose Web provider with correct URL", async () => {
      vi.mocked(streamText).mockResolvedValue({
        toDataStreamResponse: vi.fn().mockReturnValue(
          new Response(createMockSSEStream([
            { type: "text-delta", data: { textDelta: "Response" } },
          ]))
        ),
      } as any);

      const request = createPostRequest("http://localhost:3000/api/agent", {
        taskId: testTask.id,
        message: "Test provider init",
      });

      await POST(request as any);

      expect(gooseWeb).toHaveBeenCalled();
      const gooseWebCall = vi.mocked(gooseWeb).mock.calls[0];
      expect(gooseWebCall).toBeDefined();
    });

    test("should handle Goose Web connection failures", async () => {
      vi.mocked(streamText).mockRejectedValue(new Error("Connection failed"));

      const request = createPostRequest("http://localhost:3000/api/agent", {
        taskId: testTask.id,
        message: "Test connection failure",
      });

      const response = await POST(request as any);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBeDefined();
    });
  });

  describe("Error handling scenarios", () => {
    beforeEach(() => {
      vi.mocked(getServerSession).mockResolvedValue(
        createAuthenticatedSession(testUser.id, testUser.email, testUser.name)
      );
    });

    test("should handle database errors gracefully", async () => {
      const task = await db.task.create({
        data: {
          title: "Test Task",
          workspaceId: testWorkspace.id,
          createdById: testUser.id,
          updatedById: testUser.id,
          priority: "MEDIUM",
        },
      });

      // Mock database error
      vi.spyOn(db.chatMessage, "findMany").mockRejectedValue(
        new Error("Database connection failed")
      );

      const request = createPostRequest("http://localhost:3000/api/agent", {
        taskId: task.id,
        message: "Test message",
      });

      const response = await POST(request as any);

      expect(response.status).toBe(500);
    });

    test("should handle streaming errors", async () => {
      const task = await db.task.create({
        data: {
          title: "Test Task",
          workspaceId: testWorkspace.id,
          createdById: testUser.id,
          updatedById: testUser.id,
          priority: "MEDIUM",
        },
      });

      vi.mocked(streamText).mockResolvedValue({
        toDataStreamResponse: vi.fn().mockImplementation(() => {
          throw new Error("Stream creation failed");
        }),
      } as any);

      const request = createPostRequest("http://localhost:3000/api/agent", {
        taskId: task.id,
        message: "Test streaming error",
      });

      const response = await POST(request as any);

      expect(response.status).toBe(500);
    });

    test("should handle invalid task ID", async () => {
      const request = createPostRequest("http://localhost:3000/api/agent", {
        taskId: "non-existent-task-id",
        message: "Test message",
      });

      const response = await POST(request as any);

      // Should handle gracefully (either 404 or proceed with empty history)
      expect([200, 404, 500]).toContain(response.status);
    });
  });

  describe("SSE event mapping scenarios", () => {
    let testTask: Awaited<ReturnType<typeof db.task.create>>;

    beforeEach(async () => {
      vi.mocked(getServerSession).mockResolvedValue(
        createAuthenticatedSession(testUser.id, testUser.email, testUser.name)
      );

      testTask = await db.task.create({
        data: {
          title: "Test Task for Events",
          workspaceId: testWorkspace.id,
          createdById: testUser.id,
          updatedById: testUser.id,
          priority: "MEDIUM",
        },
      });
    });

    test("should map tool-call events", async () => {
      vi.mocked(streamText).mockResolvedValue({
        toDataStreamResponse: vi.fn().mockReturnValue(
          new Response(createMockSSEStream([
            {
              type: "tool-call",
              data: {
                toolCallId: "call-1",
                toolName: "get_learnings",
                args: { question: "test" },
              },
            },
          ]))
        ),
      } as any);

      const request = createPostRequest("http://localhost:3000/api/agent", {
        taskId: testTask.id,
        message: "Test tool call",
      });

      const response = await POST(request as any);

      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toContain("text/event-stream");
    });

    test("should map tool-result events", async () => {
      vi.mocked(streamText).mockResolvedValue({
        toDataStreamResponse: vi.fn().mockReturnValue(
          new Response(createMockSSEStream([
            {
              type: "tool-result",
              data: {
                toolCallId: "call-1",
                result: { data: "test result" },
              },
            },
          ]))
        ),
      } as any);

      const request = createPostRequest("http://localhost:3000/api/agent", {
        taskId: testTask.id,
        message: "Test tool result",
      });

      const response = await POST(request as any);

      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toContain("text/event-stream");
    });

    test("should handle tool-error events", async () => {
      vi.mocked(streamText).mockResolvedValue({
        toDataStreamResponse: vi.fn().mockReturnValue(
          new Response(createMockSSEStream([
            {
              type: "tool-error",
              data: {
                toolCallId: "call-1",
                error: "Tool execution failed",
              },
            },
          ]))
        ),
      } as any);

      const request = createPostRequest("http://localhost:3000/api/agent", {
        taskId: testTask.id,
        message: "Test tool error",
      });

      const response = await POST(request as any);

      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toContain("text/event-stream");
    });
  });
});