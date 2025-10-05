import { describe, test, expect, vi, beforeEach, Mock } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "@/app/api/tasks/route";
import { getServerSession } from "next-auth/next";
import { db } from "@/lib/db";
import { TaskStatus, Priority, WorkflowStatus } from "@prisma/client";

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
    members: [],
  };

  const mockTasks = [
    {
      id: "task1",
      title: "Test Task 1",
      description: "Description 1",
      workspaceId: "workspace1",
      status: TaskStatus.TODO,
      priority: Priority.MEDIUM,
      workflowStatus: WorkflowStatus.PENDING,
      sourceType: "USER",
      stakworkProjectId: null,
      assigneeId: null,
      repositoryId: null,
      estimatedHours: null,
      actualHours: null,
      createdAt: new Date("2024-01-01"),
      updatedAt: new Date("2024-01-01"),
      assignee: null,
      repository: null,
      createdBy: {
        id: "user1",
        name: "Test User",
        email: "test@example.com",
        image: null,
        githubAuth: null,
      },
      _count: { chatMessages: 0 },
    },
    {
      id: "task2",
      title: "Test Task 2",
      description: "Description 2",
      workspaceId: "workspace1",
      status: TaskStatus.IN_PROGRESS,
      priority: Priority.HIGH,
      workflowStatus: WorkflowStatus.IN_PROGRESS,
      sourceType: "JANITOR",
      stakworkProjectId: 123,
      assigneeId: "assignee1",
      repositoryId: "repo1",
      estimatedHours: 5,
      actualHours: 3,
      createdAt: new Date("2024-01-02"),
      updatedAt: new Date("2024-01-02"),
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
      _count: { chatMessages: 5 },
    },
  ];

  describe("Authentication", () => {
    test("should return 401 for unauthenticated user", async () => {
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

    test("should return 401 for invalid user session", async () => {
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
  });

  describe("Query Parameter Validation", () => {
    test("should return 400 for missing workspaceId", async () => {
      (getServerSession as Mock).mockResolvedValue(mockSession);

      const request = new NextRequest("http://localhost:3000/api/tasks");

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("workspaceId query parameter is required");
      expect(db.task.findMany).not.toHaveBeenCalled();
    });

    test("should return 400 for invalid pagination parameters (page < 1)", async () => {
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

    test("should return 400 for invalid pagination parameters (limit < 1)", async () => {
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

    test("should return 400 for invalid pagination parameters (limit > 100)", async () => {
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
  });

  describe("Workspace Authorization", () => {
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

    test("should return 403 for user without workspace access", async () => {
      const workspaceWithoutAccess = {
        id: "workspace1",
        ownerId: "different-user",
        members: [], // No members
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

    test("should allow access for workspace owner", async () => {
      (getServerSession as Mock).mockResolvedValue(mockSession);
      (db.workspace.findFirst as Mock).mockResolvedValue(mockWorkspace);
      (db.task.findMany as Mock).mockResolvedValue(mockTasks);
      (db.task.count as Mock).mockResolvedValue(2);

      const request = new NextRequest(
        "http://localhost:3000/api/tasks?workspaceId=workspace1"
      );

      const response = await GET(request);

      expect(response.status).toBe(200);
      expect(db.task.findMany).toHaveBeenCalled();
    });

    test("should allow access for workspace member", async () => {
      const workspaceWithMember = {
        id: "workspace1",
        ownerId: "different-user",
        members: [{ role: "DEVELOPER" }], // User is a member
      };

      (getServerSession as Mock).mockResolvedValue(mockSession);
      (db.workspace.findFirst as Mock).mockResolvedValue(workspaceWithMember);
      (db.task.findMany as Mock).mockResolvedValue(mockTasks);
      (db.task.count as Mock).mockResolvedValue(2);

      const request = new NextRequest(
        "http://localhost:3000/api/tasks?workspaceId=workspace1"
      );

      const response = await GET(request);

      expect(response.status).toBe(200);
      expect(db.task.findMany).toHaveBeenCalled();
    });
  });

  describe("Pagination", () => {
    test("should fetch tasks with default pagination (page 1, limit 5)", async () => {
      (getServerSession as Mock).mockResolvedValue(mockSession);
      (db.workspace.findFirst as Mock).mockResolvedValue(mockWorkspace);
      (db.task.findMany as Mock).mockResolvedValue([mockTasks[0]]);
      (db.task.count as Mock).mockResolvedValue(10);

      const request = new NextRequest(
        "http://localhost:3000/api/tasks?workspaceId=workspace1"
      );

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.pagination).toEqual({
        page: 1,
        limit: 5,
        totalCount: 10,
        totalPages: 2,
        hasMore: true,
      });

      expect(db.task.findMany).toHaveBeenCalledWith({
        where: {
          workspaceId: "workspace1",
          deleted: false,
        },
        select: expect.objectContaining({
          id: true,
          title: true,
          description: true,
        }),
        orderBy: {
          createdAt: "desc",
        },
        skip: 0,
        take: 5,
      });
    });

    test("should fetch tasks with custom pagination (page 2, limit 10)", async () => {
      (getServerSession as Mock).mockResolvedValue(mockSession);
      (db.workspace.findFirst as Mock).mockResolvedValue(mockWorkspace);
      (db.task.findMany as Mock).mockResolvedValue(mockTasks);
      (db.task.count as Mock).mockResolvedValue(25);

      const request = new NextRequest(
        "http://localhost:3000/api/tasks?workspaceId=workspace1&page=2&limit=10"
      );

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.pagination).toEqual({
        page: 2,
        limit: 10,
        totalCount: 25,
        totalPages: 3,
        hasMore: true,
      });

      expect(db.task.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          skip: 10, // (page 2 - 1) * limit 10
          take: 10,
        })
      );
    });

    test("should indicate no more pages on last page", async () => {
      (getServerSession as Mock).mockResolvedValue(mockSession);
      (db.workspace.findFirst as Mock).mockResolvedValue(mockWorkspace);
      (db.task.findMany as Mock).mockResolvedValue([mockTasks[0]]);
      (db.task.count as Mock).mockResolvedValue(5);

      const request = new NextRequest(
        "http://localhost:3000/api/tasks?workspaceId=workspace1&page=1&limit=10"
      );

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.pagination).toEqual({
        page: 1,
        limit: 10,
        totalCount: 5,
        totalPages: 1,
        hasMore: false,
      });
    });
  });

  describe("Response Structure", () => {
    test("should return tasks with all relationships", async () => {
      (getServerSession as Mock).mockResolvedValue(mockSession);
      (db.workspace.findFirst as Mock).mockResolvedValue(mockWorkspace);
      (db.task.findMany as Mock).mockResolvedValue(mockTasks);
      (db.task.count as Mock).mockResolvedValue(2);

      const request = new NextRequest(
        "http://localhost:3000/api/tasks?workspaceId=workspace1"
      );

      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data).toHaveLength(2);
      expect(data.data[0]).toMatchObject({
        id: "task1",
        title: "Test Task 1",
        description: "Description 1",
        status: TaskStatus.TODO,
        priority: Priority.MEDIUM,
      });
      expect(data.data[1]).toMatchObject({
        id: "task2",
        title: "Test Task 2",
        assignee: {
          id: "assignee1",
          name: "Assignee User",
        },
        repository: {
          id: "repo1",
          name: "Test Repo",
        },
      });
    });

    test("should include message count in response", async () => {
      (getServerSession as Mock).mockResolvedValue(mockSession);
      (db.workspace.findFirst as Mock).mockResolvedValue(mockWorkspace);
      (db.task.findMany as Mock).mockResolvedValue(mockTasks);
      (db.task.count as Mock).mockResolvedValue(2);

      const request = new NextRequest(
        "http://localhost:3000/api/tasks?workspaceId=workspace1"
      );

      const response = await GET(request);
      const data = await response.json();

      expect(data.data[0]._count).toEqual({ chatMessages: 0 });
      expect(data.data[1]._count).toEqual({ chatMessages: 5 });
    });

    test("should filter soft-deleted tasks", async () => {
      (getServerSession as Mock).mockResolvedValue(mockSession);
      (db.workspace.findFirst as Mock).mockResolvedValue(mockWorkspace);
      (db.task.findMany as Mock).mockResolvedValue(mockTasks);
      (db.task.count as Mock).mockResolvedValue(2);

      const request = new NextRequest(
        "http://localhost:3000/api/tasks?workspaceId=workspace1"
      );

      await GET(request);

      expect(db.task.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            workspaceId: "workspace1",
            deleted: false,
          },
        })
      );
    });
  });

  describe("includeLatestMessage Flag", () => {
    test("should not include latest message when flag is false", async () => {
      (getServerSession as Mock).mockResolvedValue(mockSession);
      (db.workspace.findFirst as Mock).mockResolvedValue(mockWorkspace);
      (db.task.findMany as Mock).mockResolvedValue(mockTasks);
      (db.task.count as Mock).mockResolvedValue(2);

      const request = new NextRequest(
        "http://localhost:3000/api/tasks?workspaceId=workspace1&includeLatestMessage=false"
      );

      await GET(request);

      expect(db.task.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          select: expect.not.objectContaining({
            chatMessages: expect.anything(),
          }),
        })
      );
    });

    test("should include latest message when flag is true", async () => {
      const tasksWithMessages = [
        {
          ...mockTasks[0],
          chatMessages: [
            {
              id: "msg1",
              timestamp: new Date("2024-01-01"),
              artifacts: [
                {
                  id: "artifact1",
                  type: "FORM",
                },
              ],
            },
          ],
        },
      ];

      (getServerSession as Mock).mockResolvedValue(mockSession);
      (db.workspace.findFirst as Mock).mockResolvedValue(mockWorkspace);
      (db.task.findMany as Mock).mockResolvedValue(tasksWithMessages);
      (db.task.count as Mock).mockResolvedValue(1);

      const request = new NextRequest(
        "http://localhost:3000/api/tasks?workspaceId=workspace1&includeLatestMessage=true"
      );

      const response = await GET(request);
      const data = await response.json();

      expect(db.task.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          select: expect.objectContaining({
            chatMessages: {
              orderBy: {
                timestamp: "desc",
              },
              take: 1,
              select: {
                id: true,
                timestamp: true,
                artifacts: {
                  select: {
                    id: true,
                    type: true,
                  },
                },
              },
            },
          }),
        })
      );

      expect(data.data[0].hasActionArtifact).toBe(true);
    });

    test("should set hasActionArtifact to false when no FORM artifacts", async () => {
      const tasksWithMessages = [
        {
          ...mockTasks[0],
          workflowStatus: WorkflowStatus.IN_PROGRESS,
          chatMessages: [
            {
              id: "msg1",
              timestamp: new Date("2024-01-01"),
              artifacts: [
                {
                  id: "artifact1",
                  type: "CODE",
                },
              ],
            },
          ],
        },
      ];

      (getServerSession as Mock).mockResolvedValue(mockSession);
      (db.workspace.findFirst as Mock).mockResolvedValue(mockWorkspace);
      (db.task.findMany as Mock).mockResolvedValue(tasksWithMessages);
      (db.task.count as Mock).mockResolvedValue(1);

      const request = new NextRequest(
        "http://localhost:3000/api/tasks?workspaceId=workspace1&includeLatestMessage=true"
      );

      const response = await GET(request);
      const data = await response.json();

      expect(data.data[0].hasActionArtifact).toBe(false);
    });

    test("should set hasActionArtifact to false when workflow is COMPLETED", async () => {
      const tasksWithMessages = [
        {
          ...mockTasks[0],
          workflowStatus: WorkflowStatus.COMPLETED,
          chatMessages: [
            {
              id: "msg1",
              timestamp: new Date("2024-01-01"),
              artifacts: [
                {
                  id: "artifact1",
                  type: "FORM",
                },
              ],
            },
          ],
        },
      ];

      (getServerSession as Mock).mockResolvedValue(mockSession);
      (db.workspace.findFirst as Mock).mockResolvedValue(mockWorkspace);
      (db.task.findMany as Mock).mockResolvedValue(tasksWithMessages);
      (db.task.count as Mock).mockResolvedValue(1);

      const request = new NextRequest(
        "http://localhost:3000/api/tasks?workspaceId=workspace1&includeLatestMessage=true"
      );

      const response = await GET(request);
      const data = await response.json();

      expect(data.data[0].hasActionArtifact).toBe(false);
    });
  });

  describe("Error Handling", () => {
    test("should return 500 on database error", async () => {
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
  });
});