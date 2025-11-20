import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/task/[taskId]/route";
import { db } from "@/lib/db";
import { getServerSession } from "next-auth/next";
import { extractPrArtifact } from "@/lib/helpers/tasks";

// Mock external dependencies
vi.mock("next-auth/next", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("@/lib/helpers/tasks", () => ({
  extractPrArtifact: vi.fn(),
}));

vi.mock("@/lib/auth/options", () => ({
  authOptions: {},
}));

const mockGetServerSession = vi.mocked(getServerSession);
const mockExtractPrArtifact = vi.mocked(extractPrArtifact);

describe("GET /api/task/[taskId] - Task Details Endpoint", () => {
  let testUser: any;
  let testWorkspace: any;
  let testTask: any;
  let testRepository: any;
  let otherUser: any;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Create test user
    testUser = await db.user.create({
      data: {
        name: "Test Owner",
        email: "owner@test.com",
      },
    });

    // Create other user (not a member)
    otherUser = await db.user.create({
      data: {
        name: "Other User",
        email: "other@test.com",
      },
    });

    // Create test workspace
    testWorkspace = await db.workspace.create({
      data: {
        name: "Test Workspace",
        slug: "test-workspace",
        ownerId: testUser.id,
      },
    });

    // Create test repository
    testRepository = await db.repository.create({
      data: {
        name: "test-repo",
        repositoryUrl: "https://github.com/test/repo",
        branch: "main",
        workspaceId: testWorkspace.id,
      },
    });

    // Create test task with relations
    testTask = await db.task.create({
      data: {
        title: "Test Task",
        description: "Test task description",
        status: "TODO",
        priority: "MEDIUM",
        workflowStatus: "PENDING",
        sourceType: "USER",
        mode: "live",
        workspaceId: testWorkspace.id,
        createdById: testUser.id,
        updatedById: testUser.id,
        assigneeId: testUser.id,
        repositoryId: testRepository.id,
      },
    });

    // Create chat messages with artifacts
    const chatMessage = await db.chatMessage.create({
      data: {
        taskId: testTask.id,
        role: "ASSISTANT",
        message: "Test message",
        timestamp: new Date(),
      },
    });

    await db.artifact.create({
      data: {
        messageId: chatMessage.id,
        type: "PULL_REQUEST",
        content: JSON.stringify({
          url: "https://github.com/test/repo/pull/1",
          status: "open",
        }),
      },
    });

    // Mock PR artifact enrichment by default
    mockExtractPrArtifact.mockResolvedValue({
      id: "artifact-1",
      type: "PULL_REQUEST",
      content: {
        url: "https://github.com/test/repo/pull/1",
        status: "open",
      },
    });
  });

  afterEach(async () => {
    // Clean up in reverse order of dependencies
    await db.artifact.deleteMany({});
    await db.chatMessage.deleteMany({});
    await db.task.deleteMany({});
    await db.repository.deleteMany({});
    await db.workspaceMember.deleteMany({});
    await db.workspace.deleteMany({});
    await db.user.deleteMany({});
  });

  describe("Authentication", () => {
    test("should return 401 when no session exists", async () => {
      mockGetServerSession.mockResolvedValue(null);

      const request = new NextRequest("http://localhost:3000/api/task/123");
      const response = await GET(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.error).toBe("Unauthorized");
    });

    test("should return 401 when session has no user", async () => {
      mockGetServerSession.mockResolvedValue({ user: null } as any);

      const request = new NextRequest("http://localhost:3000/api/task/123");
      const response = await GET(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.error).toBe("Unauthorized");
    });

    test("should return 401 when user has no id", async () => {
      mockGetServerSession.mockResolvedValue({
        user: { email: "test@test.com" },
      } as any);

      const request = new NextRequest("http://localhost:3000/api/task/123");
      const response = await GET(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.error).toBe("Invalid user session");
    });
  });

  describe("Authorization", () => {
    test("should return 403 when user is not workspace owner or member", async () => {
      mockGetServerSession.mockResolvedValue({
        user: { id: otherUser.id, email: otherUser.email },
      } as any);

      const request = new NextRequest("http://localhost:3000/api/task/123");
      const response = await GET(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data.error).toBe("Access denied");
    });

    test("should allow workspace owner to access task", async () => {
      mockGetServerSession.mockResolvedValue({
        user: { id: testUser.id, email: testUser.email },
      } as any);

      const request = new NextRequest("http://localhost:3000/api/task/123");
      const response = await GET(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result.success).toBe(true);
      expect(result.data.id).toBe(testTask.id);
    });

    test("should allow workspace member to access task", async () => {
      // Add other user as workspace member
      await db.workspaceMember.create({
        data: {
          workspaceId: testWorkspace.id,
          userId: otherUser.id,
          role: "DEVELOPER",
        },
      });

      mockGetServerSession.mockResolvedValue({
        user: { id: otherUser.id, email: otherUser.email },
      } as any);

      const request = new NextRequest("http://localhost:3000/api/task/123");
      const response = await GET(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result.success).toBe(true);
      expect(result.data.id).toBe(testTask.id);
    });
  });

  describe("Task Retrieval", () => {
    test("should return 404 for non-existent task", async () => {
      mockGetServerSession.mockResolvedValue({
        user: { id: testUser.id, email: testUser.email },
      } as any);

      const request = new NextRequest("http://localhost:3000/api/task/123");
      const response = await GET(request, {
        params: Promise.resolve({ taskId: "non-existent-id" }),
      });

      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.error).toBe("Task not found");
    });

    test("should return 404 for deleted task", async () => {
      await db.task.update({
        where: { id: testTask.id },
        data: { deleted: true },
      });

      mockGetServerSession.mockResolvedValue({
        user: { id: testUser.id, email: testUser.email },
      } as any);

      const request = new NextRequest("http://localhost:3000/api/task/123");
      const response = await GET(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data.error).toBe("Task not found");
    });

    test("should return 400 when taskId is missing", async () => {
      mockGetServerSession.mockResolvedValue({
        user: { id: testUser.id, email: testUser.email },
      } as any);

      const request = new NextRequest("http://localhost:3000/api/task/123");
      const response = await GET(request, {
        params: Promise.resolve({ taskId: "" }),
      });

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBe("taskId is required");
    });

    test("should return complete task with all relations", async () => {
      mockGetServerSession.mockResolvedValue({
        user: { id: testUser.id, email: testUser.email },
      } as any);

      const request = new NextRequest("http://localhost:3000/api/task/123");
      const response = await GET(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result.success).toBe(true);

      const taskData = result.data;
      // Verify task fields
      expect(taskData.id).toBe(testTask.id);
      expect(taskData.title).toBe("Test Task");
      expect(taskData.description).toBe("Test task description");
      expect(taskData.status).toBe("TODO");
      expect(taskData.priority).toBe("MEDIUM");
      expect(taskData.workflowStatus).toBe("PENDING");
      expect(taskData.sourceType).toBe("USER");
      expect(taskData.mode).toBe("live");

      // Verify assignee relation
      expect(taskData.assignee).toBeDefined();
      expect(taskData.assignee.id).toBe(testUser.id);
      expect(taskData.assignee.name).toBe("Test Owner");

      // Verify repository relation
      expect(taskData.repository).toBeDefined();
      expect(taskData.repository.id).toBe(testRepository.id);
      expect(taskData.repository.name).toBe("test-repo");

      // Verify createdBy relation
      expect(taskData.createdBy).toBeDefined();
      expect(taskData.createdBy.id).toBe(testUser.id);

      // Verify workspace relation
      expect(taskData.workspace).toBeDefined();
      expect(taskData.workspace.id).toBe(testWorkspace.id);
      expect(taskData.workspace.slug).toBe("test-workspace");

      // Verify chat messages
      expect(taskData.chatMessages).toBeDefined();
      expect(Array.isArray(taskData.chatMessages)).toBe(true);
      expect(taskData.chatMessages.length).toBeGreaterThan(0);

      // Verify message count
      expect(taskData._count).toBeDefined();
      expect(taskData._count.chatMessages).toBeGreaterThan(0);
    });

    test("should include PR artifact in response", async () => {
      mockGetServerSession.mockResolvedValue({
        user: { id: testUser.id, email: testUser.email },
      } as any);

      const mockPrArtifact = {
        id: "artifact-123",
        type: "PULL_REQUEST",
        content: {
          url: "https://github.com/test/repo/pull/1",
          status: "merged",
        },
      };

      mockExtractPrArtifact.mockResolvedValue(mockPrArtifact as any);

      const request = new NextRequest("http://localhost:3000/api/task/123");
      const response = await GET(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result.data.prArtifact).toEqual(mockPrArtifact);
      expect(mockExtractPrArtifact).toHaveBeenCalledWith(
        expect.objectContaining({ id: testTask.id }),
        testUser.id
      );
    });

    test("should handle null PR artifact", async () => {
      mockGetServerSession.mockResolvedValue({
        user: { id: testUser.id, email: testUser.email },
      } as any);

      mockExtractPrArtifact.mockResolvedValue(null);

      const request = new NextRequest("http://localhost:3000/api/task/123");
      const response = await GET(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      expect(response.status).toBe(200);
      const result = await response.json();
      expect(result.data.prArtifact).toBeNull();
    });
  });

  describe("Chat Messages and Artifacts", () => {
    test("should return chat messages ordered by timestamp", async () => {
      // Create multiple messages with different timestamps
      const msg1 = await db.chatMessage.create({
        data: {
          taskId: testTask.id,
          role: "USER",
          message: "First message",
          timestamp: new Date("2024-01-01T10:00:00Z"),
        },
      });

      const msg2 = await db.chatMessage.create({
        data: {
          taskId: testTask.id,
          role: "ASSISTANT",
          message: "Second message",
          timestamp: new Date("2024-01-01T11:00:00Z"),
        },
      });

      mockGetServerSession.mockResolvedValue({
        user: { id: testUser.id, email: testUser.email },
      } as any);

      const request = new NextRequest("http://localhost:3000/api/task/123");
      const response = await GET(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      expect(response.status).toBe(200);
      const result = await response.json();
      const messages = result.data.chatMessages;

      expect(messages.length).toBeGreaterThanOrEqual(2);
      // Verify messages are ordered by timestamp ascending
      const timestamps = messages.map((m: any) =>
        new Date(m.timestamp).getTime()
      );
      for (let i = 1; i < timestamps.length; i++) {
        expect(timestamps[i]).toBeGreaterThanOrEqual(timestamps[i - 1]);
      }
    });

    test("should return artifacts ordered by createdAt descending", async () => {
      const msg = await db.chatMessage.create({
        data: {
          taskId: testTask.id,
          role: "ASSISTANT",
          message: "Message with artifacts",
          timestamp: new Date(),
        },
      });

      // Create multiple artifacts with different timestamps
      await db.artifact.create({
        data: {
          messageId: msg.id,
          type: "CODE",
          content: JSON.stringify({ code: "first" }),
          createdAt: new Date("2024-01-01T10:00:00Z"),
        },
      });

      await db.artifact.create({
        data: {
          messageId: msg.id,
          type: "CODE",
          content: JSON.stringify({ code: "second" }),
          createdAt: new Date("2024-01-01T11:00:00Z"),
        },
      });

      mockGetServerSession.mockResolvedValue({
        user: { id: testUser.id, email: testUser.email },
      } as any);

      const request = new NextRequest("http://localhost:3000/api/task/123");
      const response = await GET(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      expect(response.status).toBe(200);
      const result = await response.json();
      const message = result.data.chatMessages.find(
        (m: any) => m.id === msg.id
      );

      expect(message.artifacts.length).toBeGreaterThanOrEqual(2);
      // Verify artifacts are ordered by createdAt descending
      const timestamps = message.artifacts.map((a: any) =>
        new Date(a.createdAt).getTime()
      );
      for (let i = 1; i < timestamps.length; i++) {
        expect(timestamps[i]).toBeLessThanOrEqual(timestamps[i - 1]);
      }
    });
  });

  describe("Error Handling", () => {
    test("should return 500 on database error", async () => {
      mockGetServerSession.mockResolvedValue({
        user: { id: testUser.id, email: testUser.email },
      } as any);

      // Mock database error by using invalid taskId format that causes query to fail
      vi.spyOn(db.task, "findUnique").mockRejectedValueOnce(
        new Error("Database error")
      );

      const request = new NextRequest("http://localhost:3000/api/task/123");
      const response = await GET(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.error).toBe("Failed to fetch task");
    });
  });
});