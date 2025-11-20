import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { GET } from "@/app/api/task/[taskId]/route";
import { db } from "@/lib/db";
import { ArtifactType, ChatRole, ChatStatus } from "@prisma/client";
import { getUserAppTokens } from "@/lib/githubApp";
import {
  createAuthenticatedSession,
  getMockedSession,
  mockUnauthenticatedSession,
  createGetRequest,
  expectSuccess,
  expectUnauthorized,
  expectNotFound,
  generateUniqueId,
  generateUniqueSlug,
} from "@/__tests__/support/helpers";

// Mock NextAuth
vi.mock("next-auth/next", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("@/lib/auth/nextauth", () => ({
  authOptions: {},
}));

vi.mock("@/lib/githubApp", () => ({
  getUserAppTokens: vi.fn(),
}));

describe("GET /api/task/[taskId] - Integration Tests", () => {
  let testUser: { id: string; email: string; name: string };
  let testWorkspace: { id: string; slug: string; ownerId: string };
  let testTask: { id: string; workspaceId: string };
  let testRepository: { id: string; workspaceId: string };
  let otherUser: { id: string; email: string; name: string };
  let memberUser: { id: string; email: string; name: string };

  beforeEach(async () => {
    vi.clearAllMocks();

    // Create test data using transaction for atomicity
    const testData = await db.$transaction(async (tx) => {
      // Create primary test user
      const user = await tx.user.create({
        data: {
          email: `user-${generateUniqueId()}@example.com`,
          name: "Test User",
        },
      });

      // Create workspace owned by test user
      const workspace = await tx.workspace.create({
        data: {
          name: "Test Workspace",
          slug: generateUniqueSlug("test-workspace"),
          ownerId: user.id,
        },
      });

      // Create repository linked to workspace
      const repository = await tx.repository.create({
        data: {
          name: "test-repo",
          repositoryUrl: "https://github.com/test-user/test-repo",
          workspaceId: workspace.id,
          status: "SYNCED",
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
          repositoryId: repository.id,
          createdById: user.id,
          updatedById: user.id,
          workflowStatus: "IN_PROGRESS",
          assigneeId: user.id,
        },
      });

      // Create other user for unauthorized access testing
      const otherUser = await tx.user.create({
        data: {
          email: `other-user-${generateUniqueId()}@example.com`,
          name: "Other User",
        },
      });

      // Create member user with workspace access
      const memberUser = await tx.user.create({
        data: {
          email: `member-user-${generateUniqueId()}@example.com`,
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
        repository,
        task,
        otherUser,
        memberUser,
      };
    });

    testUser = testData.user;
    testWorkspace = testData.workspace;
    testRepository = testData.repository;
    testTask = testData.task;
    otherUser = testData.otherUser;
    memberUser = testData.memberUser;

    // Reset fetch mock
    global.fetch = vi.fn();
  });

  afterEach(async () => {
    // Clean up test data
    await db.chatMessage.deleteMany({
      where: { taskId: testTask.id },
    });
    await db.task.deleteMany({
      where: { workspaceId: testWorkspace.id },
    });
    await db.repository.deleteMany({
      where: { workspaceId: testWorkspace.id },
    });
    await db.workspaceMember.deleteMany({
      where: { workspaceId: testWorkspace.id },
    });
    await db.workspace.deleteMany({
      where: { id: testWorkspace.id },
    });
    await db.user.deleteMany({
      where: {
        id: {
          in: [testUser.id, otherUser.id, memberUser.id],
        },
      },
    });
  });

  describe("Authentication", () => {
    it("should return 401 when no session provided", async () => {
      getMockedSession().mockResolvedValue(mockUnauthenticatedSession());

      const request = createGetRequest(
        `http://localhost:3000/api/task/${testTask.id}`
      );

      const response = await GET(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      expect(response?.status).toBe(401);
      const data = await response?.json();
      expect(data.error).toBe("Unauthorized");
    });

    it("should return 401 when session has no user", async () => {
      getMockedSession().mockResolvedValue({ user: null });

      const request = createGetRequest(
        `http://localhost:3000/api/task/${testTask.id}`
      );

      const response = await GET(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      expect(response?.status).toBe(401);
      const data = await response?.json();
      expect(data.error).toBe("Unauthorized");
    });

    it("should return 401 when session user has no id", async () => {
      getMockedSession().mockResolvedValue({ user: { name: "Test User" } });

      const request = createGetRequest(
        `http://localhost:3000/api/task/${testTask.id}`
      );

      const response = await GET(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      expect(response?.status).toBe(401);
      const data = await response?.json();
      expect(data.error).toBe("Invalid user session");
    });
  });

  describe("Input Validation", () => {
    it("should return 400 when taskId is missing", async () => {
      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );

      const request = createGetRequest("http://localhost:3000/api/task/");

      const response = await GET(request, {
        params: Promise.resolve({ taskId: "" }),
      });

      expect(response?.status).toBe(400);
      const data = await response?.json();
      expect(data.error).toBe("taskId is required");
    });

    it("should return 404 when task does not exist", async () => {
      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );

      const nonExistentId = "non-existent-task-id";
      const request = createGetRequest(
        `http://localhost:3000/api/task/${nonExistentId}`
      );

      const response = await GET(request, {
        params: Promise.resolve({ taskId: nonExistentId }),
      });

      expect(response?.status).toBe(404);
      const data = await response?.json();
      expect(data.error).toBe("Task not found");
    });

    it("should return 404 for soft-deleted tasks", async () => {
      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );

      // Soft-delete the task
      await db.task.update({
        where: { id: testTask.id },
        data: { deleted: true, deletedAt: new Date() },
      });

      const request = createGetRequest(
        `http://localhost:3000/api/task/${testTask.id}`
      );

      const response = await GET(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      expect(response?.status).toBe(404);
      const data = await response?.json();
      expect(data.error).toBe("Task not found");
    });
  });

  describe("Authorization & Access Control", () => {
    it("should return 403 when user is not workspace owner or member", async () => {
      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(otherUser)
      );

      const request = createGetRequest(
        `http://localhost:3000/api/task/${testTask.id}`
      );

      const response = await GET(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      expect(response?.status).toBe(403);
      const data = await response?.json();
      expect(data.error).toBe("Access denied");
    });

    it("should allow access for workspace owner", async () => {
      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );

      const request = createGetRequest(
        `http://localhost:3000/api/task/${testTask.id}`
      );

      const response = await GET(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      expect(response?.status).toBe(200);
      const data = await response?.json();
      expect(data.success).toBe(true);
      expect(data.data).toBeDefined();
    });

    it("should allow access for workspace member", async () => {
      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(memberUser)
      );

      const request = createGetRequest(
        `http://localhost:3000/api/task/${testTask.id}`
      );

      const response = await GET(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      expect(response?.status).toBe(200);
      const data = await response?.json();
      expect(data.success).toBe(true);
      expect(data.data).toBeDefined();
    });
  });

  describe("Task Retrieval with Relations", () => {
    it("should return task with all relations (workspace, repository, assignee)", async () => {
      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );

      const request = createGetRequest(
        `http://localhost:3000/api/task/${testTask.id}`
      );

      const response = await GET(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      expect(response?.status).toBe(200);
      const data = await response?.json();

      expect(data.success).toBe(true);
      expect(data.data).toBeDefined();
      expect(data.data.id).toBe(testTask.id);
      expect(data.data.title).toBe("Test Task");
      expect(data.data.workspace).toBeDefined();
      expect(data.data.workspace.id).toBe(testWorkspace.id);
      expect(data.data.repository).toBeDefined();
      expect(data.data.repository.id).toBe(testRepository.id);
      expect(data.data.assignee).toBeDefined();
      expect(data.data.assignee.id).toBe(testUser.id);
    });

    it("should include chat messages with artifacts when present", async () => {
      // Create chat message with artifact
      await db.chatMessage.create({
        data: {
          taskId: testTask.id,
          message: "Test message with artifact",
          role: ChatRole.ASSISTANT,
          status: ChatStatus.SENT,
          timestamp: new Date(),
          contextTags: JSON.stringify([]),
          artifacts: {
            create: [
              {
                type: ArtifactType.CODE,
                content: {
                  language: "typescript",
                  code: "console.log('test');",
                },
              },
            ],
          },
        },
      });

      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );

      const request = createGetRequest(
        `http://localhost:3000/api/task/${testTask.id}`
      );

      const response = await GET(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      expect(response?.status).toBe(200);
      const data = await response?.json();

      expect(data.data.chatMessages).toBeDefined();
      expect(data.data.chatMessages).toHaveLength(1);
      expect(data.data.chatMessages[0].message).toBe(
        "Test message with artifact"
      );
      expect(data.data.chatMessages[0].artifacts).toBeDefined();
      expect(data.data.chatMessages[0].artifacts).toHaveLength(1);
      expect(data.data.chatMessages[0].artifacts[0].type).toBe(
        ArtifactType.CODE
      );
    });

    it("should return task without chat messages when none exist", async () => {
      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );

      const request = createGetRequest(
        `http://localhost:3000/api/task/${testTask.id}`
      );

      const response = await GET(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      expect(response?.status).toBe(200);
      const data = await response?.json();

      expect(data.data.chatMessages).toBeDefined();
      expect(data.data.chatMessages).toHaveLength(0);
    });
  });

  describe("PR Artifact Synchronization", () => {
    it("should sync PR artifact status from GitHub API", async () => {
      // Mock getUserAppTokens to return valid tokens
      (getUserAppTokens as any).mockResolvedValue({
        accessToken: "mock-github-token",
      });

      // Create chat message with PULL_REQUEST artifact
      const prUrl = "https://github.com/test-user/test-repo/pull/123";
      await db.chatMessage.create({
        data: {
          taskId: testTask.id,
          message: "PR created",
          role: ChatRole.ASSISTANT,
          status: ChatStatus.SENT,
          timestamp: new Date(),
          contextTags: JSON.stringify([]),
          artifacts: {
            create: [
              {
                type: ArtifactType.PULL_REQUEST,
                content: {
                  repo: "test-user/test-repo",
                  url: prUrl,
                  status: "open",
                },
              },
            ],
          },
        },
      });

      // Mock GitHub API response
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({
          state: "open",
          merged_at: null,
        }),
      });

      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );

      const request = createGetRequest(
        `http://localhost:3000/api/task/${testTask.id}`
      );

      const response = await GET(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      expect(response?.status).toBe(200);
      const data = await response?.json();

      expect(data.data.prArtifact).toBeDefined();
      expect(data.data.prArtifact.content.url).toBe(prUrl);
    });

    it("should update task to DONE when PR is merged", async () => {
      // Mock getUserAppTokens to return valid tokens
      (getUserAppTokens as any).mockResolvedValue({
        accessToken: "mock-github-token",
      });

      // Create chat message with PULL_REQUEST artifact
      await db.chatMessage.create({
        data: {
          taskId: testTask.id,
          message: "PR created",
          role: ChatRole.ASSISTANT,
          status: ChatStatus.SENT,
          timestamp: new Date(),
          contextTags: JSON.stringify([]),
          artifacts: {
            create: [
              {
                type: ArtifactType.PULL_REQUEST,
                content: {
                  repo: "test-user/test-repo",
                  url: "https://github.com/test-user/test-repo/pull/123",
                  status: "open",
                },
              },
            ],
          },
        },
      });

      // Mock GitHub API response showing merged PR
      (global.fetch as any).mockResolvedValue({
        ok: true,
        json: async () => ({
          state: "closed",
          merged_at: "2024-01-01T10:00:00Z",
        }),
      });

      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );

      const request = createGetRequest(
        `http://localhost:3000/api/task/${testTask.id}`
      );

      const response = await GET(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      expect(response?.status).toBe(200);

      // Verify task status was updated in database
      const updatedTask = await db.task.findUnique({
        where: { id: testTask.id },
        select: { status: true },
      });

      expect(updatedTask?.status).toBe("DONE");
    });

    it("should handle GitHub API errors gracefully", async () => {
      // Create chat message with PULL_REQUEST artifact
      await db.chatMessage.create({
        data: {
          taskId: testTask.id,
          message: "PR created",
          role: ChatRole.ASSISTANT,
          status: ChatStatus.SENT,
          timestamp: new Date(),
          contextTags: JSON.stringify([]),
          artifacts: {
            create: [
              {
                type: ArtifactType.PULL_REQUEST,
                content: {
                  repo: "test-user/test-repo",
                  url: "https://github.com/test-user/test-repo/pull/123",
                  status: "open",
                },
              },
            ],
          },
        },
      });

      // Mock GitHub API error
      (global.fetch as any).mockRejectedValue(new Error("GitHub API error"));

      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );

      const request = createGetRequest(
        `http://localhost:3000/api/task/${testTask.id}`
      );

      const response = await GET(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      // Should still return 200 even if PR sync fails
      expect(response?.status).toBe(200);
      const data = await response?.json();
      expect(data.success).toBe(true);
    });
  });

  describe("Data Sanitization", () => {
    it("should remove sensitive agentPassword field from response", async () => {
      // Update task with agent credentials
      await db.task.update({
        where: { id: testTask.id },
        data: {
          agentUrl: "http://agent.example.com",
          agentPassword: "secret-password-123",
        },
      });

      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );

      const request = createGetRequest(
        `http://localhost:3000/api/task/${testTask.id}`
      );

      const response = await GET(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      expect(response?.status).toBe(200);
      const data = await response?.json();

      expect(data.data).not.toHaveProperty("agentPassword");
      expect(data.data).not.toHaveProperty("agentUrl");
    });

    it("should sanitize task even when no agent credentials exist", async () => {
      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );

      const request = createGetRequest(
        `http://localhost:3000/api/task/${testTask.id}`
      );

      const response = await GET(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      expect(response?.status).toBe(200);
      const data = await response?.json();

      // Verify sensitive fields are not present
      expect(data.data).not.toHaveProperty("agentPassword");
      expect(data.data).not.toHaveProperty("agentUrl");
    });
  });

  describe("Response Structure", () => {
    it("should return correct response structure", async () => {
      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );

      const request = createGetRequest(
        `http://localhost:3000/api/task/${testTask.id}`
      );

      const response = await GET(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      expect(response?.status).toBe(200);
      const data = await response?.json();

      // Verify top-level structure
      expect(data).toHaveProperty("success", true);
      expect(data).toHaveProperty("data");

      // Verify task structure
      expect(data.data).toHaveProperty("id");
      expect(data.data).toHaveProperty("title");
      expect(data.data).toHaveProperty("description");
      expect(data.data).toHaveProperty("status");
      expect(data.data).toHaveProperty("priority");
      expect(data.data).toHaveProperty("workflowStatus");
      expect(data.data).toHaveProperty("workspace");
      expect(data.data).toHaveProperty("repository");
      expect(data.data).toHaveProperty("assignee");
      expect(data.data).toHaveProperty("createdBy");
      expect(data.data).toHaveProperty("chatMessages");
    });

    it("should return appropriate content-type header", async () => {
      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );

      const request = createGetRequest(
        `http://localhost:3000/api/task/${testTask.id}`
      );

      const response = await GET(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      expect(response?.status).toBe(200);

      const contentType = response?.headers.get("content-type");
      expect(contentType).toContain("application/json");
    });
  });

  describe("Error Handling", () => {
    it("should handle database errors gracefully", async () => {
      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );

      // Use invalid task ID format that might cause database issues
      const invalidTaskId = "invalid-uuid-format";
      const request = createGetRequest(
        `http://localhost:3000/api/task/${invalidTaskId}`
      );

      const response = await GET(request, {
        params: Promise.resolve({ taskId: invalidTaskId }),
      });

      // Should handle gracefully with proper error response
      expect([404, 500]).toContain(response?.status);
      const data = await response?.json();
      expect(data).toHaveProperty("error");
      expect(typeof data.error).toBe("string");
    });

    it("should return 500 when unexpected error occurs", async () => {
      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );

      // Mock db.task.findUnique to throw error
      const originalFindUnique = db.task.findUnique;
      vi.spyOn(db.task, "findUnique").mockRejectedValue(
        new Error("Database connection failed")
      );

      const request = createGetRequest(
        `http://localhost:3000/api/task/${testTask.id}`
      );

      const response = await GET(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      expect(response?.status).toBe(500);
      const data = await response?.json();
      expect(data.error).toBe("Failed to fetch task");

      // Restore original implementation
      db.task.findUnique = originalFindUnique;
    });
  });

  describe("Edge Cases", () => {
    it("should handle task with null optional fields", async () => {
      // Create task with minimal required fields
      const minimalTask = await db.task.create({
        data: {
          title: "Minimal Task",
          workspaceId: testWorkspace.id,
          createdById: testUser.id,
          updatedById: testUser.id,
          status: "TODO",
          priority: "LOW",
          description: null,
          assigneeId: null,
          repositoryId: null,
        },
      });

      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );

      const request = createGetRequest(
        `http://localhost:3000/api/task/${minimalTask.id}`
      );

      const response = await GET(request, {
        params: Promise.resolve({ taskId: minimalTask.id }),
      });

      expect(response?.status).toBe(200);
      const data = await response?.json();

      expect(data.data.description).toBeNull();
      expect(data.data.assignee).toBeNull();
      expect(data.data.repository).toBeNull();
    });

    it("should handle task with archived status", async () => {
      // Archive the task
      await db.task.update({
        where: { id: testTask.id },
        data: { archived: true, archivedAt: new Date() },
      });

      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );

      const request = createGetRequest(
        `http://localhost:3000/api/task/${testTask.id}`
      );

      const response = await GET(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      expect(response?.status).toBe(200);
      const data = await response?.json();

      expect(data.data.archived).toBe(true);
    });

    it("should handle task with multiple chat messages and artifacts", async () => {
      // Create multiple messages with artifacts
      for (let i = 0; i < 3; i++) {
        await db.chatMessage.create({
          data: {
            taskId: testTask.id,
            message: `Message ${i + 1}`,
            role: i % 2 === 0 ? ChatRole.USER : ChatRole.ASSISTANT,
            status: ChatStatus.SENT,
            timestamp: new Date(Date.now() + i * 1000),
            contextTags: JSON.stringify([]),
            artifacts: {
              create: [
                {
                  type: ArtifactType.CODE,
                  content: { code: `console.log('artifact ${i}');` },
                },
              ],
            },
          },
        });
      }

      getMockedSession().mockResolvedValue(
        createAuthenticatedSession(testUser)
      );

      const request = createGetRequest(
        `http://localhost:3000/api/task/${testTask.id}`
      );

      const response = await GET(request, {
        params: Promise.resolve({ taskId: testTask.id }),
      });

      expect(response?.status).toBe(200);
      const data = await response?.json();

      expect(data.data.chatMessages).toHaveLength(3);
      data.data.chatMessages.forEach((msg: any, idx: number) => {
        expect(msg.message).toBe(`Message ${idx + 1}`);
        expect(msg.artifacts).toHaveLength(1);
      });
    });
  });
});