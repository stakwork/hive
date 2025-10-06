import { describe, test, expect, vi, beforeEach, Mock } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/tasks/route";
import { getServerSession } from "next-auth/next";
import { db } from "@/lib/db";
import { WorkflowStatus } from "@prisma/client";
import {
  createMockTask,
  createMinimalMockTask,
  createMockTaskList,
  createMockTaskWithActionArtifact,
  buildTasksQueryParams,
} from "@/__tests__/support/fixtures/task";

// Mock next-auth
vi.mock("next-auth/next", () => ({
  getServerSession: vi.fn(),
}));

// Mock authOptions
vi.mock("@/lib/auth/nextauth", () => ({
  authOptions: {},
}));

// Mock the database
vi.mock("@/lib/db", () => ({
  db: {
    workspace: {
      findFirst: vi.fn(),
    },
    task: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
  },
}));

describe("GET /api/tasks - Unit Tests", () => {
  const mockWorkspaceId = "workspace-123";
  const mockUserId = "user-123";

  const mockSession = {
    user: { id: mockUserId },
  };

  const mockWorkspace = {
    id: mockWorkspaceId,
    ownerId: mockUserId,
    members: [],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetAllMocks();
  });

  describe("Authentication", () => {
    test("should return 401 if no session", async () => {
      (getServerSession as Mock).mockResolvedValue(null);

      const queryParams = buildTasksQueryParams({ workspaceId: mockWorkspaceId });
      const request = new NextRequest(`http://localhost:3000/api/tasks?${queryParams}`);

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Unauthorized");
      expect(db.task.findMany).not.toHaveBeenCalled();
    });

    test("should return 401 if no user in session", async () => {
      (getServerSession as Mock).mockResolvedValue({ user: null });

      const queryParams = buildTasksQueryParams({ workspaceId: mockWorkspaceId });
      const request = new NextRequest(`http://localhost:3000/api/tasks?${queryParams}`);

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Unauthorized");
      expect(db.task.findMany).not.toHaveBeenCalled();
    });

    test("should return 401 if no user id in session", async () => {
      (getServerSession as Mock).mockResolvedValue({ user: { name: "Test" } });

      const queryParams = buildTasksQueryParams({ workspaceId: mockWorkspaceId });
      const request = new NextRequest(`http://localhost:3000/api/tasks?${queryParams}`);

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Invalid user session");
      expect(db.task.findMany).not.toHaveBeenCalled();
    });
  });

  describe("Input Validation", () => {
    test("should return 400 if workspaceId is missing", async () => {
      (getServerSession as Mock).mockResolvedValue(mockSession);

      const request = new NextRequest("http://localhost:3000/api/tasks");

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("workspaceId query parameter is required");
      expect(db.task.findMany).not.toHaveBeenCalled();
    });

    test("should return 400 if page is less than 1", async () => {
      (getServerSession as Mock).mockResolvedValue(mockSession);
      (db.workspace.findFirst as Mock).mockResolvedValue(mockWorkspace);

      const queryParams = buildTasksQueryParams({ workspaceId: mockWorkspaceId, page: 0 });
      const request = new NextRequest(`http://localhost:3000/api/tasks?${queryParams}`);

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain("Invalid pagination parameters");
      expect(db.task.findMany).not.toHaveBeenCalled();
    });

    test("should return 400 if limit is less than 1", async () => {
      (getServerSession as Mock).mockResolvedValue(mockSession);
      (db.workspace.findFirst as Mock).mockResolvedValue(mockWorkspace);

      const queryParams = buildTasksQueryParams({ workspaceId: mockWorkspaceId, limit: 0 });
      const request = new NextRequest(`http://localhost:3000/api/tasks?${queryParams}`);

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain("Invalid pagination parameters");
      expect(db.task.findMany).not.toHaveBeenCalled();
    });

    test("should return 400 if limit exceeds 100", async () => {
      (getServerSession as Mock).mockResolvedValue(mockSession);
      (db.workspace.findFirst as Mock).mockResolvedValue(mockWorkspace);

      const queryParams = buildTasksQueryParams({ workspaceId: mockWorkspaceId, limit: 101 });
      const request = new NextRequest(`http://localhost:3000/api/tasks?${queryParams}`);

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain("Invalid pagination parameters");
      expect(db.task.findMany).not.toHaveBeenCalled();
    });
  });

  describe("Workspace Access Control", () => {
    test("should return 404 if workspace not found", async () => {
      (getServerSession as Mock).mockResolvedValue(mockSession);
      (db.workspace.findFirst as Mock).mockResolvedValue(null);

      const queryParams = buildTasksQueryParams({ workspaceId: mockWorkspaceId });
      const request = new NextRequest(`http://localhost:3000/api/tasks?${queryParams}`);

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe("Workspace not found");
      expect(db.task.findMany).not.toHaveBeenCalled();
    });

    test("should return 403 if user is not workspace owner or member", async () => {
      const workspaceWithDifferentOwner = {
        id: mockWorkspaceId,
        ownerId: "different-user-id",
        members: [],
      };

      (getServerSession as Mock).mockResolvedValue(mockSession);
      (db.workspace.findFirst as Mock).mockResolvedValue(workspaceWithDifferentOwner);

      const queryParams = buildTasksQueryParams({ workspaceId: mockWorkspaceId });
      const request = new NextRequest(`http://localhost:3000/api/tasks?${queryParams}`);

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.error).toBe("Access denied");
      expect(db.task.findMany).not.toHaveBeenCalled();
    });

    test("should allow access if user is workspace owner", async () => {
      (getServerSession as Mock).mockResolvedValue(mockSession);
      (db.workspace.findFirst as Mock).mockResolvedValue(mockWorkspace);
      (db.task.findMany as Mock).mockResolvedValue([]);
      (db.task.count as Mock).mockResolvedValue(0);

      const queryParams = buildTasksQueryParams({ workspaceId: mockWorkspaceId });
      const request = new NextRequest(`http://localhost:3000/api/tasks?${queryParams}`);

      const response = await GET(request);

      expect(response.status).toBe(200);
      expect(db.task.findMany).toHaveBeenCalled();
    });

    test("should allow access if user is workspace member", async () => {
      const workspaceWithMember = {
        id: mockWorkspaceId,
        ownerId: "different-user-id",
        members: [{ role: "DEVELOPER" }],
      };

      (getServerSession as Mock).mockResolvedValue(mockSession);
      (db.workspace.findFirst as Mock).mockResolvedValue(workspaceWithMember);
      (db.task.findMany as Mock).mockResolvedValue([]);
      (db.task.count as Mock).mockResolvedValue(0);

      const queryParams = buildTasksQueryParams({ workspaceId: mockWorkspaceId });
      const request = new NextRequest(`http://localhost:3000/api/tasks?${queryParams}`);

      const response = await GET(request);

      expect(response.status).toBe(200);
      expect(db.task.findMany).toHaveBeenCalled();
    });
  });

  describe("Pagination", () => {
    test("should use default pagination values (page=1, limit=5)", async () => {
      const mockTasks = createMockTaskList(3);

      (getServerSession as Mock).mockResolvedValue(mockSession);
      (db.workspace.findFirst as Mock).mockResolvedValue(mockWorkspace);
      (db.task.findMany as Mock).mockResolvedValue(mockTasks);
      (db.task.count as Mock).mockResolvedValue(3);

      const queryParams = buildTasksQueryParams({ workspaceId: mockWorkspaceId });
      const request = new NextRequest(`http://localhost:3000/api/tasks?${queryParams}`);

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.pagination).toEqual({
        page: 1,
        limit: 5,
        totalCount: 3,
        totalPages: 1,
        hasMore: false,
      });

      expect(db.task.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 0,
          take: 5,
        })
      );
    });

    test("should handle custom page and limit", async () => {
      const mockTasks = createMockTaskList(10);

      (getServerSession as Mock).mockResolvedValue(mockSession);
      (db.workspace.findFirst as Mock).mockResolvedValue(mockWorkspace);
      (db.task.findMany as Mock).mockResolvedValue(mockTasks.slice(10, 20));
      (db.task.count as Mock).mockResolvedValue(25);

      const queryParams = buildTasksQueryParams({
        workspaceId: mockWorkspaceId,
        page: 2,
        limit: 10,
      });
      const request = new NextRequest(`http://localhost:3000/api/tasks?${queryParams}`);

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.pagination).toEqual({
        page: 2,
        limit: 10,
        totalCount: 25,
        totalPages: 3,
        hasMore: true,
      });

      expect(db.task.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 10,
          take: 10,
        })
      );
    });

    test("should calculate totalPages and hasMore correctly", async () => {
      (getServerSession as Mock).mockResolvedValue(mockSession);
      (db.workspace.findFirst as Mock).mockResolvedValue(mockWorkspace);
      (db.task.findMany as Mock).mockResolvedValue(createMockTaskList(5));
      (db.task.count as Mock).mockResolvedValue(23);

      const queryParams = buildTasksQueryParams({
        workspaceId: mockWorkspaceId,
        page: 3,
        limit: 5,
      });
      const request = new NextRequest(`http://localhost:3000/api/tasks?${queryParams}`);

      const response = await GET(request);
      const data = await response.json();

      expect(data.pagination).toEqual({
        page: 3,
        limit: 5,
        totalCount: 23,
        totalPages: 5,
        hasMore: true,
      });
    });

    test("should return empty results when page exceeds total pages", async () => {
      (getServerSession as Mock).mockResolvedValue(mockSession);
      (db.workspace.findFirst as Mock).mockResolvedValue(mockWorkspace);
      (db.task.findMany as Mock).mockResolvedValue([]);
      (db.task.count as Mock).mockResolvedValue(10);

      const queryParams = buildTasksQueryParams({
        workspaceId: mockWorkspaceId,
        page: 100,
        limit: 5,
      });
      const request = new NextRequest(`http://localhost:3000/api/tasks?${queryParams}`);

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.data).toEqual([]);
      expect(data.pagination.hasMore).toBe(false);
    });
  });

  describe("Query Parameters", () => {
    test("should not include latest message by default", async () => {
      const mockTasks = createMockTaskList(3);

      (getServerSession as Mock).mockResolvedValue(mockSession);
      (db.workspace.findFirst as Mock).mockResolvedValue(mockWorkspace);
      (db.task.findMany as Mock).mockResolvedValue(mockTasks);
      (db.task.count as Mock).mockResolvedValue(3);

      const queryParams = buildTasksQueryParams({ workspaceId: mockWorkspaceId });
      const request = new NextRequest(`http://localhost:3000/api/tasks?${queryParams}`);

      await GET(request);

      expect(db.task.findMany).toHaveBeenCalledWith(
        expect.not.objectContaining({
          chatMessages: expect.anything(),
        })
      );
    });

    test("should include latest message when includeLatestMessage is true", async () => {
      const mockTaskWithMessage = createMockTaskWithActionArtifact();

      (getServerSession as Mock).mockResolvedValue(mockSession);
      (db.workspace.findFirst as Mock).mockResolvedValue(mockWorkspace);
      (db.task.findMany as Mock).mockResolvedValue([mockTaskWithMessage]);
      (db.task.count as Mock).mockResolvedValue(1);

      const queryParams = buildTasksQueryParams({
        workspaceId: mockWorkspaceId,
        includeLatestMessage: true,
      });
      const request = new NextRequest(`http://localhost:3000/api/tasks?${queryParams}`);

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.data[0].hasActionArtifact).toBe(true);
    });
  });

  describe("Task Relations", () => {
    test("should include assignee relation", async () => {
      const mockTask = createMockTask();

      (getServerSession as Mock).mockResolvedValue(mockSession);
      (db.workspace.findFirst as Mock).mockResolvedValue(mockWorkspace);
      (db.task.findMany as Mock).mockResolvedValue([mockTask]);
      (db.task.count as Mock).mockResolvedValue(1);

      const queryParams = buildTasksQueryParams({ workspaceId: mockWorkspaceId });
      const request = new NextRequest(`http://localhost:3000/api/tasks?${queryParams}`);

      const response = await GET(request);
      const data = await response.json();

      expect(data.data[0].assignee).toEqual({
        id: "assignee-123",
        name: "John Assignee",
        email: "assignee@example.com",
      });
    });

    test("should include repository relation", async () => {
      const mockTask = createMockTask();

      (getServerSession as Mock).mockResolvedValue(mockSession);
      (db.workspace.findFirst as Mock).mockResolvedValue(mockWorkspace);
      (db.task.findMany as Mock).mockResolvedValue([mockTask]);
      (db.task.count as Mock).mockResolvedValue(1);

      const queryParams = buildTasksQueryParams({ workspaceId: mockWorkspaceId });
      const request = new NextRequest(`http://localhost:3000/api/tasks?${queryParams}`);

      const response = await GET(request);
      const data = await response.json();

      expect(data.data[0].repository).toEqual({
        id: "repo-123",
        name: "test-repo",
        repositoryUrl: "https://github.com/test/repo",
      });
    });

    test("should include createdBy relation with github username", async () => {
      const mockTask = createMockTask();

      (getServerSession as Mock).mockResolvedValue(mockSession);
      (db.workspace.findFirst as Mock).mockResolvedValue(mockWorkspace);
      (db.task.findMany as Mock).mockResolvedValue([mockTask]);
      (db.task.count as Mock).mockResolvedValue(1);

      const queryParams = buildTasksQueryParams({ workspaceId: mockWorkspaceId });
      const request = new NextRequest(`http://localhost:3000/api/tasks?${queryParams}`);

      const response = await GET(request);
      const data = await response.json();

      expect(data.data[0].createdBy).toEqual({
        id: "creator-123",
        name: "Jane Creator",
        email: "creator@example.com",
        image: "https://avatar.example.com/jane.jpg",
        githubAuth: {
          githubUsername: "janecreator",
        },
      });
    });

    test("should include message count", async () => {
      const mockTask = createMockTask();

      (getServerSession as Mock).mockResolvedValue(mockSession);
      (db.workspace.findFirst as Mock).mockResolvedValue(mockWorkspace);
      (db.task.findMany as Mock).mockResolvedValue([mockTask]);
      (db.task.count as Mock).mockResolvedValue(1);

      const queryParams = buildTasksQueryParams({ workspaceId: mockWorkspaceId });
      const request = new NextRequest(`http://localhost:3000/api/tasks?${queryParams}`);

      const response = await GET(request);
      const data = await response.json();

      expect(data.data[0]._count.chatMessages).toBe(3);
    });

    test("should handle tasks with null relations", async () => {
      const minimalTask = createMinimalMockTask();

      (getServerSession as Mock).mockResolvedValue(mockSession);
      (db.workspace.findFirst as Mock).mockResolvedValue(mockWorkspace);
      (db.task.findMany as Mock).mockResolvedValue([minimalTask]);
      (db.task.count as Mock).mockResolvedValue(1);

      const queryParams = buildTasksQueryParams({ workspaceId: mockWorkspaceId });
      const request = new NextRequest(`http://localhost:3000/api/tasks?${queryParams}`);

      const response = await GET(request);
      const data = await response.json();

      expect(data.data[0].assignee).toBeNull();
      expect(data.data[0].repository).toBeNull();
      expect(data.data[0].description).toBeNull();
    });
  });

  describe("hasActionArtifact Flag", () => {
    test("should set hasActionArtifact to true when task has FORM artifact and workflow is IN_PROGRESS", async () => {
      const mockTask = createMockTaskWithActionArtifact({
        workflowStatus: WorkflowStatus.IN_PROGRESS,
      });

      (getServerSession as Mock).mockResolvedValue(mockSession);
      (db.workspace.findFirst as Mock).mockResolvedValue(mockWorkspace);
      (db.task.findMany as Mock).mockResolvedValue([mockTask]);
      (db.task.count as Mock).mockResolvedValue(1);

      const queryParams = buildTasksQueryParams({
        workspaceId: mockWorkspaceId,
        includeLatestMessage: true,
      });
      const request = new NextRequest(`http://localhost:3000/api/tasks?${queryParams}`);

      const response = await GET(request);
      const data = await response.json();

      expect(data.data[0].hasActionArtifact).toBe(true);
    });

    test("should set hasActionArtifact to true when task has FORM artifact and workflow is PENDING", async () => {
      const mockTask = createMockTaskWithActionArtifact({
        workflowStatus: WorkflowStatus.PENDING,
      });

      (getServerSession as Mock).mockResolvedValue(mockSession);
      (db.workspace.findFirst as Mock).mockResolvedValue(mockWorkspace);
      (db.task.findMany as Mock).mockResolvedValue([mockTask]);
      (db.task.count as Mock).mockResolvedValue(1);

      const queryParams = buildTasksQueryParams({
        workspaceId: mockWorkspaceId,
        includeLatestMessage: true,
      });
      const request = new NextRequest(`http://localhost:3000/api/tasks?${queryParams}`);

      const response = await GET(request);
      const data = await response.json();

      expect(data.data[0].hasActionArtifact).toBe(true);
    });

    test("should set hasActionArtifact to false when workflow is COMPLETED", async () => {
      const mockTask = createMockTask({ workflowStatus: WorkflowStatus.COMPLETED });
      mockTask.chatMessages = [
        {
          id: "message-1",
          timestamp: new Date("2024-01-01T12:00:00Z"),
          artifacts: [{ id: "artifact-1", type: "FORM" }],
        },
      ];

      (getServerSession as Mock).mockResolvedValue(mockSession);
      (db.workspace.findFirst as Mock).mockResolvedValue(mockWorkspace);
      (db.task.findMany as Mock).mockResolvedValue([mockTask]);
      (db.task.count as Mock).mockResolvedValue(1);

      const queryParams = buildTasksQueryParams({
        workspaceId: mockWorkspaceId,
        includeLatestMessage: true,
      });
      const request = new NextRequest(`http://localhost:3000/api/tasks?${queryParams}`);

      const response = await GET(request);
      const data = await response.json();

      expect(data.data[0].hasActionArtifact).toBe(false);
    });

    test("should not calculate hasActionArtifact when includeLatestMessage is false", async () => {
      const mockTask = createMockTask();

      (getServerSession as Mock).mockResolvedValue(mockSession);
      (db.workspace.findFirst as Mock).mockResolvedValue(mockWorkspace);
      (db.task.findMany as Mock).mockResolvedValue([mockTask]);
      (db.task.count as Mock).mockResolvedValue(1);

      const queryParams = buildTasksQueryParams({ workspaceId: mockWorkspaceId });
      const request = new NextRequest(`http://localhost:3000/api/tasks?${queryParams}`);

      const response = await GET(request);
      const data = await response.json();

      expect(data.data[0].hasActionArtifact).toBeUndefined();
    });
  });

  describe("Soft-Delete Filtering", () => {
    test("should only return non-deleted tasks", async () => {
      const mockTasks = createMockTaskList(5);

      (getServerSession as Mock).mockResolvedValue(mockSession);
      (db.workspace.findFirst as Mock).mockResolvedValue(mockWorkspace);
      (db.task.findMany as Mock).mockResolvedValue(mockTasks);
      (db.task.count as Mock).mockResolvedValue(5);

      const queryParams = buildTasksQueryParams({ workspaceId: mockWorkspaceId });
      const request = new NextRequest(`http://localhost:3000/api/tasks?${queryParams}`);

      await GET(request);

      expect(db.task.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            deleted: false,
          }),
        })
      );

      expect(db.task.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            deleted: false,
          }),
        })
      );
    });
  });

  describe("Error Handling", () => {
    test("should return 500 on database error", async () => {
      (getServerSession as Mock).mockResolvedValue(mockSession);
      (db.workspace.findFirst as Mock).mockResolvedValue(mockWorkspace);
      (db.task.findMany as Mock).mockRejectedValue(new Error("Database connection failed"));

      const queryParams = buildTasksQueryParams({ workspaceId: mockWorkspaceId });
      const request = new NextRequest(`http://localhost:3000/api/tasks?${queryParams}`);

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe("Failed to fetch tasks");
    });

    test("should handle malformed query parameters gracefully", async () => {
      (getServerSession as Mock).mockResolvedValue(mockSession);
      (db.workspace.findFirst as Mock).mockResolvedValue(mockWorkspace);

      const request = new NextRequest(
        `http://localhost:3000/api/tasks?workspaceId=${mockWorkspaceId}&page=-1`
      );

      const response = await GET(request);

      expect(response.status).toBe(400);
    });
  });

  describe("Success Scenarios", () => {
    test("should return tasks successfully with all fields", async () => {
      const mockTasks = createMockTaskList(3);

      (getServerSession as Mock).mockResolvedValue(mockSession);
      (db.workspace.findFirst as Mock).mockResolvedValue(mockWorkspace);
      (db.task.findMany as Mock).mockResolvedValue(mockTasks);
      (db.task.count as Mock).mockResolvedValue(3);

      const queryParams = buildTasksQueryParams({ workspaceId: mockWorkspaceId });
      const request = new NextRequest(`http://localhost:3000/api/tasks?${queryParams}`);

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data).toHaveLength(3);
      expect(data.data[0]).toMatchObject({
        id: expect.any(String),
        title: expect.any(String),
        status: expect.any(String),
        priority: expect.any(String),
        createdAt: expect.any(String),
      });
    });

    test("should return empty array when no tasks exist", async () => {
      (getServerSession as Mock).mockResolvedValue(mockSession);
      (db.workspace.findFirst as Mock).mockResolvedValue(mockWorkspace);
      (db.task.findMany as Mock).mockResolvedValue([]);
      (db.task.count as Mock).mockResolvedValue(0);

      const queryParams = buildTasksQueryParams({ workspaceId: mockWorkspaceId });
      const request = new NextRequest(`http://localhost:3000/api/tasks?${queryParams}`);

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data).toEqual([]);
      expect(data.pagination.totalCount).toBe(0);
      expect(data.pagination.totalPages).toBe(0);
      expect(data.pagination.hasMore).toBe(false);
    });

    test("should order tasks by createdAt descending", async () => {
      const mockTasks = createMockTaskList(5);

      (getServerSession as Mock).mockResolvedValue(mockSession);
      (db.workspace.findFirst as Mock).mockResolvedValue(mockWorkspace);
      (db.task.findMany as Mock).mockResolvedValue(mockTasks);
      (db.task.count as Mock).mockResolvedValue(5);

      const queryParams = buildTasksQueryParams({ workspaceId: mockWorkspaceId });
      const request = new NextRequest(`http://localhost:3000/api/tasks?${queryParams}`);

      await GET(request);

      expect(db.task.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: {
            createdAt: "desc",
          },
        })
      );
    });
  });
});