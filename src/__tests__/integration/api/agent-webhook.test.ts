import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { POST } from "@/app/api/agent/webhook/route";
import { db } from "@/lib/db";
import { pusherServer } from "@/lib/pusher";
import { ChatRole, ChatStatus, TaskStatus, WorkflowStatus } from "@prisma/client";
import jwt from "jsonwebtoken";
import { FieldEncryptionService } from "@/lib/encryption/field-encryption";
import { NextRequest } from "next/server";

// Mock only external dependencies, not the database
vi.mock("@/lib/pusher", () => ({
  pusherServer: {
    trigger: vi.fn(),
  },
  getTaskChannelName: vi.fn((taskId: string) => `task-${taskId}`),
  PUSHER_EVENTS: {
    NEW_MESSAGE: "new-message",
    DIFF_GENERATED: "diff-generated",
    WORKFLOW_STATUS_UPDATE: "workflow-status-update",
  },
}));
vi.mock("@/services/pod/diff-generator", () => ({
  generateAndSaveDiff: vi.fn(),
}));

describe("POST /api/agent/webhook", () => {
  const mockWebhookSecret = "test-secret-key";
  
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Helper to create test scenario with all required data
  const createTestScenario = async () => {
    // Create test user
    const user = await db.user.create({
      data: {
        email: `test-webhook-${Date.now()}@example.com`,
        name: "Test User",
      },
    });
    
    // Create test workspace
    const workspace = await db.workspace.create({
      data: {
        name: "Test Workspace",
        slug: `test-workspace-${Date.now()}`,
        ownerId: user.id,
      },
    });

    // Encrypt the webhook secret
    const encryptionKey = process.env.TOKEN_ENCRYPTION_KEY!;
    const encryptionService = new FieldEncryptionService(encryptionKey);
    const encryptedSecret = encryptionService.encryptField('agentWebhookSecret', mockWebhookSecret);

    // Create test task with encrypted webhook secret
    const task = await db.task.create({
      data: {
        title: "Test Task",
        description: "Test task for webhook",
        workspaceId: workspace.id,
        status: TaskStatus.IN_PROGRESS,
        agentWebhookSecret: JSON.stringify(encryptedSecret),
        agentUrl: "https://agent.example.com",
        podId: "test-pod-123",
        createdById: user.id,
        updatedById: user.id,
      },
    });

    // The webhook validates that sessionId matches taskId
    return { task, workspace, user, sessionId: task.id };
  };

  const createRequest = (taskId: string, payload: any) => {
    const token = jwt.sign({ taskId }, mockWebhookSecret, { expiresIn: "1h" });
    const url = `http://localhost:3000/api/agent/webhook?token=${token}`;
    
    const request = new NextRequest(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    
    return request;
  };

  describe("text event", () => {
    test("should create chat message and broadcast via Pusher", async () => {
      const { task, sessionId } = await createTestScenario();
      
      const request = createRequest(task.id, {
        type: "text",
        text: "Test response from agent",
        sessionId,
      });

      const response = await POST(request);

      expect(response.status).toBe(200);

      // Verify message was created in database
      const messages = await db.chatMessage.findMany({
        where: { taskId: task.id },
      });
      
      expect(messages).toHaveLength(1);
      expect(messages[0].message).toBe("Test response from agent");
      expect(messages[0].role).toBe(ChatRole.ASSISTANT);
      expect(messages[0].status).toBe(ChatStatus.SENT);

      // Verify Pusher was called
      expect(pusherServer.trigger).toHaveBeenCalledWith(
        `task-${task.id}`,
        "new-message",
        messages[0].id
      );
    });

    test("first text event fires WORKFLOW_STATUS_UPDATE with IN_PROGRESS and updates DB", async () => {
      const { task, sessionId } = await createTestScenario();

      const request = createRequest(task.id, {
        type: "text",
        text: "Hello from agent",
        sessionId,
      });

      const response = await POST(request);
      expect(response.status).toBe(200);

      // Verify DB was updated to IN_PROGRESS
      const updated = await db.task.findUnique({ where: { id: task.id }, select: { workflowStatus: true, workflowStartedAt: true } });
      expect(updated?.workflowStatus).toBe(WorkflowStatus.IN_PROGRESS);
      expect(updated?.workflowStartedAt).not.toBeNull();

      // Verify WORKFLOW_STATUS_UPDATE was fired
      expect(pusherServer.trigger).toHaveBeenCalledWith(
        `task-${task.id}`,
        "workflow-status-update",
        expect.objectContaining({ taskId: task.id, workflowStatus: WorkflowStatus.IN_PROGRESS })
      );
    });

    test("second text event does NOT re-fire WORKFLOW_STATUS_UPDATE when already IN_PROGRESS", async () => {
      const { task, sessionId } = await createTestScenario();

      // Pre-set the task to IN_PROGRESS
      await db.task.update({
        where: { id: task.id },
        data: { workflowStatus: WorkflowStatus.IN_PROGRESS, workflowStartedAt: new Date() },
      });

      const request = createRequest(task.id, {
        type: "text",
        text: "Second message",
        sessionId,
      });

      const response = await POST(request);
      expect(response.status).toBe(200);

      // WORKFLOW_STATUS_UPDATE should NOT have been called (already IN_PROGRESS)
      const workflowStatusCalls = (pusherServer.trigger as ReturnType<typeof vi.fn>).mock.calls.filter(
        (call) => call[1] === "workflow-status-update"
      );
      expect(workflowStatusCalls).toHaveLength(0);
    });
  });

  describe("tool-call event", () => {
    test("should create chat message with <logs> wrapper and broadcast via Pusher", async () => {
      const { task, sessionId } = await createTestScenario();
      const toolInput = { file: "test.ts", content: "console.log('test')" };
      
      const request = createRequest(task.id, {
        type: "tool-call",
        toolName: "str_replace_editor",
        input: toolInput,
        sessionId,
      });

      const response = await POST(request);

      expect(response.status).toBe(200);
      
      // Verify message was created in database
      const messages = await db.chatMessage.findMany({
        where: { taskId: task.id },
      });
      
      expect(messages).toHaveLength(1);
      expect(messages[0].message).toContain("<logs>");
      expect(messages[0].message).toContain("🔧 tool-call: str_replace_editor");
      expect(messages[0].message).toContain(JSON.stringify(toolInput, null, 2));
      expect(messages[0].message).toContain("</logs>");
      expect(messages[0].role).toBe(ChatRole.ASSISTANT);
      expect(messages[0].status).toBe(ChatStatus.SENT);
      
      // Verify Pusher was called
      expect(pusherServer.trigger).toHaveBeenCalledWith(
        `task-${task.id}`,
        "new-message",
        messages[0].id
      );
    });
  });

  describe("tool-result event", () => {
    test("should create chat message with <logs> wrapper for string output and broadcast via Pusher", async () => {
      const { task, sessionId } = await createTestScenario();
      const toolOutput = "File updated successfully";
      
      const request = createRequest(task.id, {
        type: "tool-result",
        toolName: "str_replace_editor",
        output: toolOutput,
        sessionId,
      });

      const response = await POST(request);

      expect(response.status).toBe(200);
      
      // Verify message was created in database
      const messages = await db.chatMessage.findMany({
        where: { taskId: task.id },
      });
      
      expect(messages).toHaveLength(1);
      expect(messages[0].message).toContain("<logs>");
      expect(messages[0].message).toContain("✅ tool-result: str_replace_editor");
      expect(messages[0].message).toContain(toolOutput);
      expect(messages[0].message).toContain("</logs>");
      expect(messages[0].role).toBe(ChatRole.ASSISTANT);
      expect(messages[0].status).toBe(ChatStatus.SENT);
      
      // Verify Pusher was called
      expect(pusherServer.trigger).toHaveBeenCalledWith(
        `task-${task.id}`,
        "new-message",
        messages[0].id
      );
    });

    test("should create chat message with <logs> wrapper for object output and broadcast via Pusher", async () => {
      const { task, sessionId } = await createTestScenario();
      const toolOutput = { success: true, filesModified: ["test.ts", "index.ts"] };
      
      const request = createRequest(task.id, {
        type: "tool-result",
        toolName: "file_search",
        output: toolOutput,
        sessionId,
      });

      const response = await POST(request);

      expect(response.status).toBe(200);
      
      // Verify message was created in database
      const messages = await db.chatMessage.findMany({
        where: { taskId: task.id },
      });
      
      expect(messages).toHaveLength(1);
      expect(messages[0].message).toContain("<logs>");
      expect(messages[0].message).toContain("✅ tool-result: file_search");
      expect(messages[0].message).toContain(JSON.stringify(toolOutput, null, 2));
      expect(messages[0].message).toContain("</logs>");
      expect(messages[0].role).toBe(ChatRole.ASSISTANT);
      expect(messages[0].status).toBe(ChatStatus.SENT);
      
      // Verify Pusher was called
      expect(pusherServer.trigger).toHaveBeenCalledWith(
        `task-${task.id}`,
        "new-message",
        messages[0].id
      );
    });
  });

  describe("finish event", () => {
    test("fires WORKFLOW_STATUS_UPDATE with COMPLETED and updates DB workflowStatus and workflowCompletedAt", async () => {
      const { task, sessionId } = await createTestScenario();

      // Set task to IN_PROGRESS first (normal pre-condition)
      await db.task.update({
        where: { id: task.id },
        data: { workflowStatus: WorkflowStatus.IN_PROGRESS, workflowStartedAt: new Date() },
      });

      const request = createRequest(task.id, {
        type: "finish",
        finishReason: "stop",
        totalUsage: { inputTokens: 100, outputTokens: 50 },
        sessionId,
      });

      const response = await POST(request);
      expect(response.status).toBe(200);

      // Verify DB updated to COMPLETED
      const updated = await db.task.findUnique({
        where: { id: task.id },
        select: { workflowStatus: true, workflowCompletedAt: true },
      });
      expect(updated?.workflowStatus).toBe(WorkflowStatus.COMPLETED);
      expect(updated?.workflowCompletedAt).not.toBeNull();

      // Verify WORKFLOW_STATUS_UPDATE fired with COMPLETED
      expect(pusherServer.trigger).toHaveBeenCalledWith(
        `task-${task.id}`,
        "workflow-status-update",
        expect.objectContaining({ taskId: task.id, workflowStatus: WorkflowStatus.COMPLETED })
      );
    });
  });

  describe("error handling", () => {
    test("should return 400 when token is missing", async () => {
      const { sessionId } = await createTestScenario();
      
      const request = new NextRequest("http://localhost:3000/api/agent/webhook", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          type: "text",
          text: "Test",
          sessionId,
        }),
      });

      const response = await POST(request);
      expect(response.status).toBe(400);
    });

    test("should return 404 when task not found", async () => {
      const { sessionId } = await createTestScenario();
      const fakeToken = jwt.sign({ taskId: "fake-task-id" }, mockWebhookSecret, { expiresIn: "1h" });
      
      const request = new NextRequest(`http://localhost:3000/api/agent/webhook?token=${fakeToken}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          type: "text",
          text: "Test",
          sessionId,
        }),
      });

      const response = await POST(request);
      expect(response.status).toBe(404);
    });

    test("should return 400 when session ID mismatch", async () => {
      const { task } = await createTestScenario();
      
      const request = createRequest(task.id, {
        type: "text",
        text: "Test",
        sessionId: "wrong-session-id",
      });

      const response = await POST(request);
      expect(response.status).toBe(400);
    });
  });
});
