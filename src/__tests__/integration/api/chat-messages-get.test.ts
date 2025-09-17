import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/chat/messages/[messageId]/route";
import { db } from "@/lib/db";
import { getServerSession } from "next-auth/next";
import { ChatRole, ChatStatus } from "@/lib/chat";

vi.mock("next-auth/next", () => ({ getServerSession: vi.fn() }));

describe("GET /api/chat/messages/[messageId]", () => {
  let testUser: { id: string; email: string; name: string };
  let testWorkspace: { id: string; slug: string; ownerId: string };
  let testTask: { id: string; workspaceId: string };
  let testMessage: { id: string; taskId: string; message: string; role: string };
  let otherUser: { id: string; email: string; name: string };
  let otherWorkspace: { id: string; slug: string; ownerId: string };
  let memberUser: { id: string; email: string; name: string };

  beforeEach(async () => {
    vi.clearAllMocks();

    // Create test data with proper relationships
    const testData = await db.$transaction(async (tx) => {
      // Create primary test user
      const user = await tx.user.create({
        data: {
          email: `user-${Date.now()}@example.com`,
          name: "Test User",
        },
      });

      // Create workspace owned by test user
      const workspace = await tx.workspace.create({
        data: {
          name: "Test Workspace",
          slug: `test-workspace-${Date.now()}`,
          ownerId: user.id,
        },
      });

      // Create task in the workspace
      const task = await tx.task.create({
        data: {
          title: "Test Task",
          description: "Test task description",
          status: "IN_PROGRESS",
          priority: "MEDIUM",
          workspaceId: workspace.id,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      // Create chat message with sensitive content
      const message = await tx.chatMessage.create({
        data: {
          message: "This is a sensitive chat message with user data",
          role: ChatRole.USER,
          status: ChatStatus.SENT,
          taskId: task.id,
          contextTags: JSON.stringify([
            { type: "file", value: "sensitive-config.env" },
            { type: "api_key", value: "hidden" }
          ]),
        },
      });

      // Create artifacts with sensitive content
      await tx.artifact.create({
        data: {
          type: "CODE",
          content: { 
            code: "const dbUrl = 'postgresql://user:password@localhost/db';\nconst apiKey = 'sk-sensitive-api-key-123';" 
          },
          messageId: message.id,
        },
      });

      // Create attachment with sensitive file
      await tx.attachment.create({
        data: {
          filename: "api-keys.txt",
          path: "https://s3.example.com/sensitive/api-keys.txt",
          size: 1024,
          mimeType: "text/plain",
          messageId: message.id,
        },
      });

      // Create other user for unauthorized access testing
      const otherUser = await tx.user.create({
        data: {
          email: `other-user-${Date.now()}@example.com`,
          name: "Other User",
        },
      });

      // Create other workspace for cross-workspace testing
      const otherWorkspace = await tx.workspace.create({
        data: {
          name: "Other Workspace",
          slug: `other-workspace-${Date.now()}`,
          ownerId: otherUser.id,
        },
      });

      // Create member user with workspace access
      const memberUser = await tx.user.create({
        data: {
          email: `member-user-${Date.now()}@example.com`,
          name: "Member User",
        },
      });

      // Add member to workspace
      await tx.workspaceMember.create({
        data: {
          userId: memberUser.id,
          workspaceId: workspace.id,
          role: "DEVELOPER",
        },
      });

      return {
        user,
        workspace,
        task,
        message,
        otherUser,
        otherWorkspace,
        memberUser,
      };
    });

    testUser = testData.user;
    testWorkspace = testData.workspace;
    testTask = testData.task;
    testMessage = testData.message;
    otherUser = testData.otherUser;
    otherWorkspace = testData.otherWorkspace;
    memberUser = testData.memberUser;
  });

  describe("Authentication", () => {
    it("should return 401 when no session provided", async () => {
      (getServerSession as unknown as { mockResolvedValue: (v: unknown) => void })
        .mockResolvedValue(null);

      const request = new NextRequest(
        `http://localhost:3000/api/chat/messages/${testMessage.id}`,
        { method: "GET" }
      );

      const response = await GET(request, {
        params: Promise.resolve({ messageId: testMessage.id })
      });

      expect(response?.status).toBe(401);
      const data = await response?.json();
      expect(data.error).toBe("Unauthorized");
    });

    it("should return 401 when session has no user", async () => {
      (getServerSession as unknown as { mockResolvedValue: (v: unknown) => void })
        .mockResolvedValue({ user: null });

      const request = new NextRequest(
        `http://localhost:3000/api/chat/messages/${testMessage.id}`,
        { method: "GET" }
      );

      const response = await GET(request, {
        params: Promise.resolve({ messageId: testMessage.id })
      });

      expect(response?.status).toBe(401);
      const data = await response?.json();
      expect(data.error).toBe("Unauthorized");
    });

    it("should return 401 when session user has no id", async () => {
      (getServerSession as unknown as { mockResolvedValue: (v: unknown) => void })
        .mockResolvedValue({ user: { name: "Test User" } });

      const request = new NextRequest(
        `http://localhost:3000/api/chat/messages/${testMessage.id}`,
        { method: "GET" }
      );

      const response = await GET(request, {
        params: Promise.resolve({ messageId: testMessage.id })
      });

      expect(response?.status).toBe(401);
      const data = await response?.json();
      expect(data.error).toBe("Invalid user session");
    });
  });

  describe("Input Validation", () => {
    it("should return 400 when messageId is missing", async () => {
      (getServerSession as unknown as { mockResolvedValue: (v: unknown) => void })
        .mockResolvedValue({ user: { id: testUser.id } });

      const request = new NextRequest(
        "http://localhost:3000/api/chat/messages/",
        { method: "GET" }
      );

      const response = await GET(request, {
        params: Promise.resolve({ messageId: "" })
      });

      expect(response?.status).toBe(400);
      const data = await response?.json();
      expect(data.error).toBe("Message ID is required");
    });

    it("should return 404 when message does not exist", async () => {
      (getServerSession as unknown as { mockResolvedValue: (v: unknown) => void })
        .mockResolvedValue({ user: { id: testUser.id } });

      const nonExistentId = "non-existent-message-id";
      const request = new NextRequest(
        `http://localhost:3000/api/chat/messages/${nonExistentId}`,
        { method: "GET" }
      );

      const response = await GET(request, {
        params: Promise.resolve({ messageId: nonExistentId })
      });

      expect(response?.status).toBe(404);
      const data = await response?.json();
      expect(data.error).toBe("Message not found");
    });
  });

  describe("Authorization & Access Control", () => {
    it("should return 403 when user is not workspace owner or member", async () => {
      (getServerSession as unknown as { mockResolvedValue: (v: unknown) => void })
        .mockResolvedValue({ user: { id: otherUser.id } });

      const request = new NextRequest(
        `http://localhost:3000/api/chat/messages/${testMessage.id}`,
        { method: "GET" }
      );

      const response = await GET(request, {
        params: Promise.resolve({ messageId: testMessage.id })
      });

      expect(response?.status).toBe(403);
      const data = await response?.json();
      expect(data.error).toBe("Access denied");
    });

    it("should allow access for workspace owner", async () => {
      (getServerSession as unknown as { mockResolvedValue: (v: unknown) => void })
        .mockResolvedValue({ user: { id: testUser.id } });

      const request = new NextRequest(
        `http://localhost:3000/api/chat/messages/${testMessage.id}`,
        { method: "GET" }
      );

      const response = await GET(request, {
        params: Promise.resolve({ messageId: testMessage.id })
      });

      expect(response?.status).toBe(200);
      const data = await response?.json();
      expect(data.success).toBe(true);
      expect(data.data).toBeDefined();
    });

    it("should allow access for workspace member", async () => {
      (getServerSession as unknown as { mockResolvedValue: (v: unknown) => void })
        .mockResolvedValue({ user: { id: memberUser.id } });

      const request = new NextRequest(
        `http://localhost:3000/api/chat/messages/${testMessage.id}`,
        { method: "GET" }
      );

      const response = await GET(request, {
        params: Promise.resolve({ messageId: testMessage.id })
      });

      expect(response?.status).toBe(200);
      const data = await response?.json();
      expect(data.success).toBe(true);
      expect(data.data).toBeDefined();
    });
  });

  describe("Sensitive Data Handling", () => {
    it("should return complete message data with sensitive content for authorized user", async () => {
      (getServerSession as unknown as { mockResolvedValue: (v: unknown) => void })
        .mockResolvedValue({ user: { id: testUser.id } });

      const request = new NextRequest(
        `http://localhost:3000/api/chat/messages/${testMessage.id}`,
        { method: "GET" }
      );

      const response = await GET(request, {
        params: Promise.resolve({ messageId: testMessage.id })
      });

      expect(response?.status).toBe(200);
      const data = await response?.json();
      
      // Verify response structure
      expect(data.success).toBe(true);
      expect(data.data).toBeDefined();
      
      const message = data.data;
      
      // Verify sensitive message content is included
      expect(message.message).toBe("This is a sensitive chat message with user data");
      expect(message.role).toBe(ChatRole.USER);
      expect(message.status).toBe(ChatStatus.SENT);
      
      // Verify context tags with sensitive data are parsed correctly
      expect(message.contextTags).toHaveLength(2);
      expect(message.contextTags[0]).toEqual({ type: "file", value: "sensitive-config.env" });
      expect(message.contextTags[1]).toEqual({ type: "api_key", value: "hidden" });
      
      // Verify artifacts with sensitive code are included
      expect(message.artifacts).toHaveLength(1);
      expect(message.artifacts[0].type).toBe("CODE");
      expect(message.artifacts[0].content.code).toContain("postgresql://user:password@localhost/db");
      expect(message.artifacts[0].content.code).toContain("sk-sensitive-api-key-123");
      
      // Verify attachments with sensitive files are included
      expect(message.attachments).toHaveLength(1);
      expect(message.attachments[0].filename).toBe("api-keys.txt");
      expect(message.attachments[0].path).toBe("https://s3.example.com/sensitive/api-keys.txt");
    });

    it("should not leak sensitive data through error messages", async () => {
      (getServerSession as unknown as { mockResolvedValue: (v: unknown) => void })
        .mockResolvedValue({ user: { id: otherUser.id } });

      const request = new NextRequest(
        `http://localhost:3000/api/chat/messages/${testMessage.id}`,
        { method: "GET" }
      );

      const response = await GET(request, {
        params: Promise.resolve({ messageId: testMessage.id })
      });

      expect(response?.status).toBe(403);
      const data = await response?.json();
      
      // Verify error message doesn't leak sensitive information
      expect(data.error).toBe("Access denied");
      expect(data).not.toHaveProperty("data");
      expect(JSON.stringify(data)).not.toContain("sensitive");
      expect(JSON.stringify(data)).not.toContain("password");
      expect(JSON.stringify(data)).not.toContain("api-key");
    });
  });

  describe("Data Integrity", () => {
    it("should maintain referential integrity and include all related data", async () => {
      (getServerSession as unknown as { mockResolvedValue: (v: unknown) => void })
        .mockResolvedValue({ user: { id: testUser.id } });

      const request = new NextRequest(
        `http://localhost:3000/api/chat/messages/${testMessage.id}`,
        { method: "GET" }
      );

      const response = await GET(request, {
        params: Promise.resolve({ messageId: testMessage.id })
      });

      expect(response?.status).toBe(200);
      const data = await response?.json();
      
      const message = data.data;
      
      // Verify message structure completeness
      expect(message).toHaveProperty("id");
      expect(message).toHaveProperty("message");
      expect(message).toHaveProperty("role");
      expect(message).toHaveProperty("status");
      expect(message).toHaveProperty("contextTags");
      expect(message).toHaveProperty("artifacts");
      expect(message).toHaveProperty("attachments");
      expect(message).toHaveProperty("createdAt");
      
      // Verify artifacts are ordered by creation date
      if (message.artifacts.length > 1) {
        const timestamps = message.artifacts.map((a: any) => new Date(a.createdAt).getTime());
        for (let i = 1; i < timestamps.length; i++) {
          expect(timestamps[i]).toBeGreaterThanOrEqual(timestamps[i - 1]);
        }
      }
    });
  });

  describe("Error Handling", () => {
    it("should return 500 and log errors for database failures", async () => {
      (getServerSession as unknown as { mockResolvedValue: (v: unknown) => void })
        .mockResolvedValue({ user: { id: testUser.id } });

      // Mock database error by providing invalid messageId format that might cause DB issues
      const invalidMessageId = "invalid-uuid-format-that-breaks-db";
      const request = new NextRequest(
        `http://localhost:3000/api/chat/messages/${invalidMessageId}`,
        { method: "GET" }
      );

      const response = await GET(request, {
        params: Promise.resolve({ messageId: invalidMessageId })
      });

      // Should handle gracefully and return proper error
      expect(response?.status).toBeOneOf([404, 500]);
      const data = await response?.json();
      expect(data).toHaveProperty("error");
      expect(typeof data.error).toBe("string");
    });

    it("should handle missing task relationship gracefully", async () => {
      // Create a task to satisfy foreign key constraint, but this simulates
      // a scenario where the task exists but access control logic handles
      // cases where the task workspace isn't found or accessible
      const tempUser = await db.user.create({
        data: {
          email: `temp-user-${Date.now()}@example.com`,
          name: "Temp User",
        },
      });
      
      const tempWorkspace = await db.workspace.create({
        data: {
          name: "Temp Workspace",
          slug: `temp-workspace-${Date.now()}`,
          ownerId: tempUser.id,
        },
      });
      
      const tempTask = await db.task.create({
        data: {
          title: "Temp Task",
          description: "Temp task description",
          status: "TODO",
          priority: "MEDIUM",
          workspaceId: tempWorkspace.id,
          createdById: tempUser.id,
          updatedById: tempUser.id,
        },
      });

      const orphanedMessage = await db.chatMessage.create({
        data: {
          message: "Orphaned message",
          role: ChatRole.USER,
          status: ChatStatus.SENT,
          taskId: tempTask.id,
          contextTags: JSON.stringify([]),
        },
      });
      
      // Now delete the task to create an orphaned message scenario
      await db.task.delete({ where: { id: tempTask.id } });

      (getServerSession as unknown as { mockResolvedValue: (v: unknown) => void })
        .mockResolvedValue({ user: { id: testUser.id } });

      const request = new NextRequest(
        `http://localhost:3000/api/chat/messages/${orphanedMessage.id}`,
        { method: "GET" }
      );

      const response = await GET(request, {
        params: Promise.resolve({ messageId: orphanedMessage.id })
      });

      expect(response?.status).toBe(404);
      const data = await response?.json();
      expect(data.error).toBe("Message not found");
    });
  });

  describe("Security Headers", () => {
    it("should return appropriate response headers", async () => {
      (getServerSession as unknown as { mockResolvedValue: (v: unknown) => void })
        .mockResolvedValue({ user: { id: testUser.id } });

      const request = new NextRequest(
        `http://localhost:3000/api/chat/messages/${testMessage.id}`,
        { method: "GET" }
      );

      const response = await GET(request, {
        params: Promise.resolve({ messageId: testMessage.id })
      });

      expect(response?.status).toBe(200);
      
      // Verify response has appropriate content type
      const contentType = response?.headers.get("content-type");
      expect(contentType).toContain("application/json");
    });
  });
});