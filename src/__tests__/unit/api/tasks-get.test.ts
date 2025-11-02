import { describe, test, expect, vi, beforeEach, Mock } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/tasks/route";
import { getServerSession } from "next-auth/next";
import { db } from "@/lib/db";
import { TaskStatus, Priority, WorkflowStatus } from "@prisma/client";


vi.mock("next-auth/next", () => ({
  getServerSession: vi.fn(),
}));


vi.mock("@/lib/auth/nextauth", () => ({
  authOptions: {},
}));


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
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetAllMocks();
  });

  const mockSession = {
    user: { id: "user1" },
  };

  const mockWorkspace = {
    id: "workspace1",
    ownerId: "user1",
    members: [{ role: "DEVELOPER" }],
  };

  const createMockTask = (overrides = {}) => ({
    id: "task1",
    title: "Test Task",
    description: "Test Description",
    status: TaskStatus.TODO,
    priority: Priority.MEDIUM,
    workflowStatus: WorkflowStatus.PENDING,
    sourceType: "MANUAL",
    stakworkProjectId: null,
    createdAt: new Date("2024-01-01"),
    updatedAt: new Date("2024-01-01"),
    assignee: {
      id: "assignee1",
      name: "Assignee User",
      email: "assignee@example.com",
    },
    repository: {
      id: "repo1",
      name: "Test Repo",
      repositoryUrl: "https://github.com/test/repo",
    },
    createdBy: {
      id: "user1",
      name: "Test User",
      email: "test@example.com",
      image: null,
      githubAuth: {
        githubUsername: "testuser",
      },
    },
    _count: {
      chatMessages: 5,
    },
    ...overrides,
  });


  describe("Authentication & Authorization", () => {
    test("should return 401 for unauthenticated requests", async () => {
      (getServerSession as Mock).mockResolvedValue(null);

      const request = new NextRequest(
        "http://localhost:3000/api/tasks?workspaceId=workspace1"
      );

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Unauthorized");
      expect(db.task.findMany).not.toHaveBeenCalled();
    });

    test("should return 401 for invalid session (missing userId)", async () => {
      (getServerSession as Mock).mockResolvedValue({ user: {} });

      const request = new NextRequest(
        "http://localhost:3000/api/tasks?workspaceId=workspace1"
      );

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Invalid user session");
      expect(db.task.findMany).not.toHaveBeenCalled();
    });

    test("should return 403 for users without workspace access", async () => {
      const workspaceWithoutAccess = {
        id: "workspace1",
        ownerId: "different-user",
        members: [],
      };

      (getServerSession as Mock).mockResolvedValue(mockSession);
      (db.workspace.findFirst as Mock).mockResolvedValue(workspaceWithoutAccess);

      const request = new NextRequest(
        "http://localhost:3000/api/tasks?workspaceId=workspace1"
      );

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.error).toBe("Access denied");
      expect(db.task.findMany).not.toHaveBeenCalled();
    });

    test("should allow workspace owners to list tasks", async () => {
      (getServerSession as Mock).mockResolvedValue(mockSession);
      (db.workspace.findFirst as Mock).mockResolvedValue(mockWorkspace);
      (db.task.findMany as Mock).mockResolvedValue([createMockTask()]);
      (db.task.count as Mock).mockResolvedValue(1);

      const request = new NextRequest(
        "http://localhost:3000/api/tasks?workspaceId=workspace1"
      );

      const response = await GET(request);

      expect(response.status).toBe(200);
      expect(db.task.findMany).toHaveBeenCalled();
    });

    test("should allow workspace members to list tasks", async () => {
      const workspaceAsMember = {
        id: "workspace1",
        ownerId: "different-user",
        members: [{ role: "DEVELOPER" }], 
      };

      (getServerSession as Mock).mockResolvedValue(mockSession);
      (db.workspace.findFirst as Mock).mockResolvedValue(workspaceAsMember);
      (db.task.findMany as Mock).mockResolvedValue([createMockTask()]);
      (db.task.count as Mock).mockResolvedValue(1);

      const request = new NextRequest(
        "http://localhost:3000/api/tasks?workspaceId=workspace1"
      );

      const response = await GET(request);

      expect(response.status).toBe(200);
      expect(db.task.findMany).toHaveBeenCalled();
    });
  });


  describe("Input Validation", () => {
    test("should return 400 when workspaceId is missing", async () => {
      (getServerSession as Mock).mockResolvedValue(mockSession);

      const request = new NextRequest("http://localhost:3000/api/tasks");

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("workspaceId query parameter is required");
      expect(db.task.findMany).not.toHaveBeenCalled();
    });

    test("should return 400 for page < 1", async () => {
      (getServerSession as Mock).mockResolvedValue(mockSession);

      const request = new NextRequest(
        "http://localhost:3000/api/tasks?workspaceId=workspace1&page=0"
      );

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain("Invalid pagination parameters");
      expect(db.task.findMany).not.toHaveBeenCalled();
    });

    test("should return 400 for limit < 1", async () => {
      (getServerSession as Mock).mockResolvedValue(mockSession);

      const request = new NextRequest(
        "http://localhost:3000/api/tasks?workspaceId=workspace1&limit=0"
      );

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain("Invalid pagination parameters");
      expect(db.task.findMany).not.toHaveBeenCalled();
    });

    test("should return 400 for limit > 100", async () => {
      (getServerSession as Mock).mockResolvedValue(mockSession);

      const request = new NextRequest(
        "http://localhost:3000/api/tasks?workspaceId=workspace1&limit=101"
      );

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain("Invalid pagination parameters");
      expect(db.task.findMany).not.toHaveBeenCalled();
    });

    test("should return 404 for non-existent workspace", async () => {
      (getServerSession as Mock).mockResolvedValue(mockSession);
      (db.workspace.findFirst as Mock).mockResolvedValue(null);

      const request = new NextRequest(
        "http://localhost:3000/api/tasks?workspaceId=non-existent"
      );

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe("Workspace not found");
      expect(db.task.findMany).not.toHaveBeenCalled();
    });
  });

  describe("Pagination Logic", () => {
    test("should return correct page of results with default pagination", async () => {
      const tasks = Array.from({ length: 5 }, (_, i) =>
        createMockTask({ id: `task${i + 1}`, title: `Task ${i + 1}` })
      );

      (getServerSession as Mock).mockResolvedValue(mockSession);
      (db.workspace.findFirst as Mock).mockResolvedValue(mockWorkspace);
      (db.task.findMany as Mock).mockResolvedValue(tasks);
      (db.task.count as Mock).mockResolvedValue(10);

      const request = new NextRequest(
        "http://localhost:3000/api/tasks?workspaceId=workspace1"
      );

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.data).toHaveLength(5);
      expect(db.task.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 0,
          take: 5,
        })
      );
    });

    test("should calculate totalPages correctly", async () => {
      (getServerSession as Mock).mockResolvedValue(mockSession);
      (db.workspace.findFirst as Mock).mockResolvedValue(mockWorkspace);
      (db.task.findMany as Mock).mockResolvedValue([createMockTask()]);
      (db.task.count as Mock).mockResolvedValue(23);

      const request = new NextRequest(
        "http://localhost:3000/api/tasks?workspaceId=workspace1&limit=5"
      );

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.pagination.totalPages).toBe(5); 
      expect(data.pagination.totalCount).toBe(23);
    });

    test("should set hasMore flag correctly for last page", async () => {
      (getServerSession as Mock).mockResolvedValue(mockSession);
      (db.workspace.findFirst as Mock).mockResolvedValue(mockWorkspace);
      (db.task.findMany as Mock).mockResolvedValue([createMockTask()]);
      (db.task.count as Mock).mockResolvedValue(10);

      const request = new NextRequest(
        "http://localhost:3000/api/tasks?workspaceId=workspace1&page=2&limit=5"
      );

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.pagination.hasMore).toBe(false);
      expect(data.pagination.page).toBe(2);
      expect(data.pagination.totalPages).toBe(2);
    });

    test("should set hasMore flag correctly for middle page", async () => {
      (getServerSession as Mock).mockResolvedValue(mockSession);
      (db.workspace.findFirst as Mock).mockResolvedValue(mockWorkspace);
      (db.task.findMany as Mock).mockResolvedValue([createMockTask()]);
      (db.task.count as Mock).mockResolvedValue(15);

      const request = new NextRequest(
        "http://localhost:3000/api/tasks?workspaceId=workspace1&page=2&limit=5"
      );

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.pagination.hasMore).toBe(true);
      expect(data.pagination.page).toBe(2);
      expect(data.pagination.totalPages).toBe(3);
    });

    test("should handle empty results gracefully", async () => {
      (getServerSession as Mock).mockResolvedValue(mockSession);
      (db.workspace.findFirst as Mock).mockResolvedValue(mockWorkspace);
      (db.task.findMany as Mock).mockResolvedValue([]);
      (db.task.count as Mock).mockResolvedValue(0);

      const request = new NextRequest(
        "http://localhost:3000/api/tasks?workspaceId=workspace1"
      );

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.data).toEqual([]);
      expect(data.pagination.totalCount).toBe(0);
      expect(data.pagination.totalPages).toBe(0);
      expect(data.pagination.hasMore).toBe(false);
    });

    test("should respect custom limit parameter", async () => {
      const tasks = Array.from({ length: 10 }, (_, i) =>
        createMockTask({ id: `task${i + 1}` })
      );

      (getServerSession as Mock).mockResolvedValue(mockSession);
      (db.workspace.findFirst as Mock).mockResolvedValue(mockWorkspace);
      (db.task.findMany as Mock).mockResolvedValue(tasks);
      (db.task.count as Mock).mockResolvedValue(20);

      const request = new NextRequest(
        "http://localhost:3000/api/tasks?workspaceId=workspace1&limit=10"
      );

      const response = await GET(request);
       await response.json();

      expect(response.status).toBe(200);
      expect(db.task.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 10,
        })
      );
    });
  });


  describe("Filtering & Ordering", () => {
    test("should exclude deleted tasks", async () => {
      (getServerSession as Mock).mockResolvedValue(mockSession);
      (db.workspace.findFirst as Mock).mockResolvedValue(mockWorkspace);
      (db.task.findMany as Mock).mockResolvedValue([createMockTask()]);
      (db.task.count as Mock).mockResolvedValue(1);

      const request = new NextRequest(
        "http://localhost:3000/api/tasks?workspaceId=workspace1"
      );

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

    test("should order tasks by createdAt DESC", async () => {
      (getServerSession as Mock).mockResolvedValue(mockSession);
      (db.workspace.findFirst as Mock).mockResolvedValue(mockWorkspace);
      (db.task.findMany as Mock).mockResolvedValue([createMockTask()]);
      (db.task.count as Mock).mockResolvedValue(1);

      const request = new NextRequest(
        "http://localhost:3000/api/tasks?workspaceId=workspace1"
      );

      await GET(request);

      expect(db.task.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: {
            createdAt: "desc",
          },
        })
      );
    });

    test("should only return tasks from specified workspace", async () => {
      (getServerSession as Mock).mockResolvedValue(mockSession);
      (db.workspace.findFirst as Mock).mockResolvedValue(mockWorkspace);
      (db.task.findMany as Mock).mockResolvedValue([createMockTask()]);
      (db.task.count as Mock).mockResolvedValue(1);

      const request = new NextRequest(
        "http://localhost:3000/api/tasks?workspaceId=workspace1"
      );

      await GET(request);

      expect(db.task.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            workspaceId: "workspace1",
          }),
        })
      );

      expect(db.task.count).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            workspaceId: "workspace1",
          }),
        })
      );
    });
  });


  describe("includeLatestMessage Feature", () => {
    test("should exclude latest message when flag is false", async () => {
      (getServerSession as Mock).mockResolvedValue(mockSession);
      (db.workspace.findFirst as Mock).mockResolvedValue(mockWorkspace);
      (db.task.findMany as Mock).mockResolvedValue([createMockTask()]);
      (db.task.count as Mock).mockResolvedValue(1);

      const request = new NextRequest(
        "http://localhost:3000/api/tasks?workspaceId=workspace1&includeLatestMessage=false"
      );

      const response = await GET(request);
      expect(response.status).toBe(200);

      const callArgs = (db.task.findMany as Mock).mock.calls[0][0];
      expect(callArgs.select).not.toHaveProperty("chatMessages");
    });

    test("should include latest message when flag is true", async () => {
      const taskWithMessage = {
        ...createMockTask(),
        chatMessages: [
          {
            id: "msg1",
            timestamp: new Date(),
            artifacts: [],
          },
        ],
      };

      (getServerSession as Mock).mockResolvedValue(mockSession);
      (db.workspace.findFirst as Mock).mockResolvedValue(mockWorkspace);
      (db.task.findMany as Mock).mockResolvedValue([taskWithMessage]);
      (db.task.count as Mock).mockResolvedValue(1);

      const request = new NextRequest(
        "http://localhost:3000/api/tasks?workspaceId=workspace1&includeLatestMessage=true"
      );

      await GET(request);

      const callArgs = (db.task.findMany as Mock).mock.calls[0][0];
      expect(callArgs.select.chatMessages).toBeDefined();
      expect(callArgs.select.chatMessages.take).toBe(1);
      expect(callArgs.select.chatMessages.orderBy).toEqual({ timestamp: "desc" });
    });

    test("should detect FORM artifacts correctly and set hasActionArtifact to true", async () => {
      const taskWithFormArtifact = {
        ...createMockTask({ workflowStatus: WorkflowStatus.IN_PROGRESS }),
        chatMessages: [
          {
            id: "msg1",
            timestamp: new Date(),
            artifacts: [{ id: "artifact1", type: "FORM" }],
          },
        ],
      };

      (getServerSession as Mock).mockResolvedValue(mockSession);
      (db.workspace.findFirst as Mock).mockResolvedValue(mockWorkspace);
      (db.task.findMany as Mock).mockResolvedValue([taskWithFormArtifact]);
      (db.task.count as Mock).mockResolvedValue(1);

      const request = new NextRequest(
        "http://localhost:3000/api/tasks?workspaceId=workspace1&includeLatestMessage=true"
      );

      const response = await GET(request);
      const data = await response.json();

      expect(data.data[0].hasActionArtifact).toBe(true);
    });

    test("should only set hasActionArtifact for PENDING/IN_PROGRESS tasks", async () => {
      const taskCompleted = {
        ...createMockTask({ workflowStatus: WorkflowStatus.COMPLETED }),
        chatMessages: [
          {
            id: "msg1",
            timestamp: new Date(),
            artifacts: [{ id: "artifact1", type: "FORM" }],
          },
        ],
      };

      (getServerSession as Mock).mockResolvedValue(mockSession);
      (db.workspace.findFirst as Mock).mockResolvedValue(mockWorkspace);
      (db.task.findMany as Mock).mockResolvedValue([taskCompleted]);
      (db.task.count as Mock).mockResolvedValue(1);

      const request = new NextRequest(
        "http://localhost:3000/api/tasks?workspaceId=workspace1&includeLatestMessage=true"
      );

      const response = await GET(request);
      const data = await response.json();

      expect(data.data[0].hasActionArtifact).toBe(false);
    });

    test("should set hasActionArtifact to false when no FORM artifacts", async () => {
      const taskWithoutFormArtifact = {
        ...createMockTask({ workflowStatus: WorkflowStatus.IN_PROGRESS }),
        chatMessages: [
          {
            id: "msg1",
            timestamp: new Date(),
            artifacts: [{ id: "artifact1", type: "TEXT" }],
          },
        ],
      };

      (getServerSession as Mock).mockResolvedValue(mockSession);
      (db.workspace.findFirst as Mock).mockResolvedValue(mockWorkspace);
      (db.task.findMany as Mock).mockResolvedValue([taskWithoutFormArtifact]);
      (db.task.count as Mock).mockResolvedValue(1);

      const request = new NextRequest(
        "http://localhost:3000/api/tasks?workspaceId=workspace1&includeLatestMessage=true"
      );

      const response = await GET(request);
      const data = await response.json();

      expect(data.data[0].hasActionArtifact).toBe(false);
    });

    test("should remove chatMessages array from response when processing", async () => {
      const taskWithMessage = {
        ...createMockTask({ workflowStatus: WorkflowStatus.PENDING }),
        chatMessages: [
          {
            id: "msg1",
            timestamp: new Date(),
            artifacts: [],
          },
        ],
      };

      (getServerSession as Mock).mockResolvedValue(mockSession);
      (db.workspace.findFirst as Mock).mockResolvedValue(mockWorkspace);
      (db.task.findMany as Mock).mockResolvedValue([taskWithMessage]);
      (db.task.count as Mock).mockResolvedValue(1);

      const request = new NextRequest(
        "http://localhost:3000/api/tasks?workspaceId=workspace1&includeLatestMessage=true"
      );

      const response = await GET(request);
      const data = await response.json();

      expect(data.data[0].chatMessages).toBeUndefined();
      expect(data.data[0].hasActionArtifact).toBeDefined();
    });
  });


  describe("Response Structure", () => {
    test("should return success flag", async () => {
      (getServerSession as Mock).mockResolvedValue(mockSession);
      (db.workspace.findFirst as Mock).mockResolvedValue(mockWorkspace);
      (db.task.findMany as Mock).mockResolvedValue([createMockTask()]);
      (db.task.count as Mock).mockResolvedValue(1);

      const request = new NextRequest(
        "http://localhost:3000/api/tasks?workspaceId=workspace1"
      );

      const response = await GET(request);
      const data = await response.json();

      expect(data.success).toBe(true);
    });

    test("should return data array", async () => {
      const tasks = [createMockTask({ id: "task1" }), createMockTask({ id: "task2" })];

      (getServerSession as Mock).mockResolvedValue(mockSession);
      (db.workspace.findFirst as Mock).mockResolvedValue(mockWorkspace);
      (db.task.findMany as Mock).mockResolvedValue(tasks);
      (db.task.count as Mock).mockResolvedValue(2);

      const request = new NextRequest(
        "http://localhost:3000/api/tasks?workspaceId=workspace1"
      );

      const response = await GET(request);
      const data = await response.json();

      expect(Array.isArray(data.data)).toBe(true);
      expect(data.data).toHaveLength(2);
    });

    test("should return correct pagination metadata", async () => {
      (getServerSession as Mock).mockResolvedValue(mockSession);
      (db.workspace.findFirst as Mock).mockResolvedValue(mockWorkspace);
      (db.task.findMany as Mock).mockResolvedValue([createMockTask()]);
      (db.task.count as Mock).mockResolvedValue(15);

      const request = new NextRequest(
        "http://localhost:3000/api/tasks?workspaceId=workspace1&page=2&limit=5"
      );

      const response = await GET(request);
      const data = await response.json();

      expect(data.pagination).toEqual({
        page: 2,
        limit: 5,
        totalCount: 15,
        totalPages: 3,
        hasMore: true,
      });
    });

    test("should include all required task fields", async () => {
      const task = createMockTask();

      (getServerSession as Mock).mockResolvedValue(mockSession);
      (db.workspace.findFirst as Mock).mockResolvedValue(mockWorkspace);
      (db.task.findMany as Mock).mockResolvedValue([task]);
      (db.task.count as Mock).mockResolvedValue(1);

      const request = new NextRequest(
        "http://localhost:3000/api/tasks?workspaceId=workspace1"
      );

      const response = await GET(request);
      const data = await response.json();

      const returnedTask = data.data[0];
      expect(returnedTask).toHaveProperty("id");
      expect(returnedTask).toHaveProperty("title");
      expect(returnedTask).toHaveProperty("description");
      expect(returnedTask).toHaveProperty("status");
      expect(returnedTask).toHaveProperty("priority");
      expect(returnedTask).toHaveProperty("workflowStatus");
      expect(returnedTask).toHaveProperty("createdAt");
      expect(returnedTask).toHaveProperty("updatedAt");
    });

    test("should include assignee details", async () => {
      const task = createMockTask({
        assignee: {
          id: "assignee1",
          name: "John Doe",
          email: "john@example.com",
        },
      });

      (getServerSession as Mock).mockResolvedValue(mockSession);
      (db.workspace.findFirst as Mock).mockResolvedValue(mockWorkspace);
      (db.task.findMany as Mock).mockResolvedValue([task]);
      (db.task.count as Mock).mockResolvedValue(1);

      const request = new NextRequest(
        "http://localhost:3000/api/tasks?workspaceId=workspace1"
      );

      const response = await GET(request);
      const data = await response.json();

      expect(data.data[0].assignee).toEqual({
        id: "assignee1",
        name: "John Doe",
        email: "john@example.com",
      });
    });

    test("should include repository details", async () => {
      const task = createMockTask({
        repository: {
          id: "repo1",
          name: "My Repo",
          repositoryUrl: "https://github.com/user/repo",
        },
      });

      (getServerSession as Mock).mockResolvedValue(mockSession);
      (db.workspace.findFirst as Mock).mockResolvedValue(mockWorkspace);
      (db.task.findMany as Mock).mockResolvedValue([task]);
      (db.task.count as Mock).mockResolvedValue(1);

      const request = new NextRequest(
        "http://localhost:3000/api/tasks?workspaceId=workspace1"
      );

      const response = await GET(request);
      const data = await response.json();

      expect(data.data[0].repository).toEqual({
        id: "repo1",
        name: "My Repo",
        repositoryUrl: "https://github.com/user/repo",
      });
    });

    test("should include message count", async () => {
      const task = createMockTask({
        _count: {
          chatMessages: 10,
        },
      });

      (getServerSession as Mock).mockResolvedValue(mockSession);
      (db.workspace.findFirst as Mock).mockResolvedValue(mockWorkspace);
      (db.task.findMany as Mock).mockResolvedValue([task]);
      (db.task.count as Mock).mockResolvedValue(1);

      const request = new NextRequest(
        "http://localhost:3000/api/tasks?workspaceId=workspace1"
      );

      const response = await GET(request);
      const data = await response.json();

      expect(data.data[0]._count.chatMessages).toBe(10);
    });
  });


  describe("Error Handling", () => {
    test("should handle database errors gracefully", async () => {
      (getServerSession as Mock).mockResolvedValue(mockSession);
      (db.workspace.findFirst as Mock).mockResolvedValue(mockWorkspace);
      (db.task.findMany as Mock).mockRejectedValue(
        new Error("Database connection failed")
      );

      const request = new NextRequest(
        "http://localhost:3000/api/tasks?workspaceId=workspace1"
      );

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe("Failed to fetch tasks");
    });

    test("should return 500 on unexpected errors", async () => {
      (getServerSession as Mock).mockResolvedValue(mockSession);
      (db.workspace.findFirst as Mock).mockRejectedValue(
        new Error("Unexpected error")
      );

      const request = new NextRequest(
        "http://localhost:3000/api/tasks?workspaceId=workspace1"
      );

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe("Failed to fetch tasks");
    });
  });
});
