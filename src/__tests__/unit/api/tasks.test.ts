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
    user: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
    },
    repository: {
      findFirst: vi.fn(),
    },
    task: {
      create: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      findFirst: vi.fn(),
    },
  },
}));

// Mock Pusher for PUT title endpoint tests
vi.mock("@/lib/pusher", () => ({
  pusherServer: {
    trigger: vi.fn().mockResolvedValue(true),
  },
  getTaskChannelName: vi.fn((taskId: string) => `task-${taskId}`),
  getWorkspaceChannelName: vi.fn((slug: string) => `workspace-${slug}`),
  PUSHER_EVENTS: {
    TASK_TITLE_UPDATE: "task-title-update",
    WORKSPACE_TASK_TITLE_UPDATE: "workspace-task-title-update",
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
      status: TaskStatus.TODO,
      priority: Priority.MEDIUM,
      workflowStatus: WorkflowStatus.PENDING,
      sourceType: "USER",
      stakworkProjectId: null,
      createdAt: new Date("2024-01-01"),
      updatedAt: new Date("2024-01-01"),
      assignee: { id: "user2", name: "Assignee", email: "assignee@example.com" },
      repository: { id: "repo1", name: "Test Repo", repositoryUrl: "https://github.com/test/repo" },
      createdBy: {
        id: "user1",
        name: "Creator",
        email: "creator@example.com",
        image: null,
        githubAuth: { githubUsername: "creator" },
      },
      _count: { chatMessages: 2 },
    },
    {
      id: "task2",
      title: "Test Task 2",
      description: "Description 2",
      status: TaskStatus.IN_PROGRESS,
      priority: Priority.HIGH,
      workflowStatus: WorkflowStatus.IN_PROGRESS,
      sourceType: "JANITOR",
      stakworkProjectId: 123,
      createdAt: new Date("2024-01-02"),
      updatedAt: new Date("2024-01-02"),
      assignee: null,
      repository: null,
      createdBy: {
        id: "user1",
        name: "Creator",
        email: "creator@example.com",
        image: null,
        githubAuth: null,
      },
      _count: { chatMessages: 0 },
    },
  ];

  test("should fetch tasks successfully with default pagination", async () => {
    (getServerSession as Mock).mockResolvedValue(mockSession);
    (db.workspace.findFirst as Mock).mockResolvedValue(mockWorkspace);
    (db.task.findMany as Mock).mockResolvedValue(mockTasks);
    (db.task.count as Mock).mockResolvedValue(10);

    const request = new NextRequest(
      "http://localhost:3000/api/tasks?workspaceId=workspace1"
    );

    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data).toHaveLength(2);
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
        status: true,
        priority: true,
        workflowStatus: true,
      }),
      orderBy: { createdAt: "desc" },
      skip: 0,
      take: 5,
    });
  });

  test("should fetch tasks with custom pagination parameters", async () => {
    (getServerSession as Mock).mockResolvedValue(mockSession);
    (db.workspace.findFirst as Mock).mockResolvedValue(mockWorkspace);
    (db.task.findMany as Mock).mockResolvedValue([mockTasks[0]]);
    (db.task.count as Mock).mockResolvedValue(25);

    const request = new NextRequest(
      "http://localhost:3000/api/tasks?workspaceId=workspace1&page=3&limit=10"
    );

    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.pagination).toEqual({
      page: 3,
      limit: 10,
      totalCount: 25,
      totalPages: 3,
      hasMore: false,
    });

    expect(db.task.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 20, // (3 - 1) * 10
        take: 10,
      })
    );
  });

  test("should return 400 for missing workspaceId parameter", async () => {
    (getServerSession as Mock).mockResolvedValue(mockSession);

    const request = new NextRequest("http://localhost:3000/api/tasks");

    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe("workspaceId query parameter is required");
    expect(db.task.findMany).not.toHaveBeenCalled();
  });

  test("should return 400 for invalid pagination parameters - page less than 1", async () => {
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

  test("should return 400 for invalid pagination parameters - limit greater than 100", async () => {
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

  test("should return 400 for invalid pagination parameters - limit less than 1", async () => {
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
      members: [], // User not in members
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

  test("should allow workspace member to fetch tasks", async () => {
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

  test("should return empty array when no tasks exist", async () => {
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
    expect(data.success).toBe(true);
    expect(data.data).toEqual([]);
    expect(data.pagination).toEqual({
      page: 1,
      limit: 5,
      totalCount: 0,
      totalPages: 0,
      hasMore: false,
    });
  });

  test("should include hasActionArtifact flag when includeLatestMessage is true", async () => {
    const tasksWithMessages = [
      {
        ...mockTasks[0],
        workflowStatus: WorkflowStatus.IN_PROGRESS,
        chatMessages: [
          {
            id: "msg1",
            timestamp: new Date(),
            artifacts: [{ id: "art1", type: "FORM" }],
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

    expect(response.status).toBe(200);
    expect(data.data[0].hasActionArtifact).toBe(true);
    expect(data.data[0].chatMessages).toBeUndefined(); // Should be removed from response
  });

  test("should not set hasActionArtifact when workflow is not IN_PROGRESS or PENDING", async () => {
    const tasksWithMessages = [
      {
        ...mockTasks[0],
        workflowStatus: WorkflowStatus.COMPLETED,
        chatMessages: [
          {
            id: "msg1",
            timestamp: new Date(),
            artifacts: [{ id: "art1", type: "FORM" }],
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

    expect(response.status).toBe(200);
    expect(data.data[0].hasActionArtifact).toBe(false);
  });

  test("should handle database errors gracefully", async () => {
    (getServerSession as Mock).mockResolvedValue(mockSession);
    (db.workspace.findFirst as Mock).mockResolvedValue(mockWorkspace);
    (db.task.findMany as Mock).mockRejectedValue(new Error("Database connection failed"));

    const request = new NextRequest(
      "http://localhost:3000/api/tasks?workspaceId=workspace1"
    );

    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.error).toBe("Failed to fetch tasks");
  });

  test("should filter tasks by workspace and exclude deleted tasks", async () => {
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

    expect(db.task.count).toHaveBeenCalledWith({
      where: {
        workspaceId: "workspace1",
        deleted: false,
      },
    });
  });

  test("should verify workspace is not deleted", async () => {
    (getServerSession as Mock).mockResolvedValue(mockSession);
    (db.workspace.findFirst as Mock).mockResolvedValue(mockWorkspace);
    (db.task.findMany as Mock).mockResolvedValue(mockTasks);
    (db.task.count as Mock).mockResolvedValue(2);

    const request = new NextRequest(
      "http://localhost:3000/api/tasks?workspaceId=workspace1"
    );

    await GET(request);

    expect(db.workspace.findFirst).toHaveBeenCalledWith({
      where: {
        id: "workspace1",
        deleted: false,
      },
      select: expect.any(Object),
    });
  });
});

describe("PUT /api/tasks/[taskId]/title - Unit Tests", () => {
  // Import PUT handler and Pusher mocks  
  let PUT: (request: NextRequest, context: { params: Promise<{ taskId: string }> }) => Promise<Response>;
  let pusherServer: { trigger: (channel: string, event: string, data: any) => Promise<boolean> };

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetAllMocks();

    // Dynamically import to ensure mocks are applied
    const routeModule = await import("@/app/api/tasks/[taskId]/title/route");
    PUT = routeModule.PUT;

    const pusherModule = await import("@/lib/pusher");
    pusherServer = pusherModule.pusherServer;
  });

  const TEST_API_TOKEN = "test-api-token-123";

  const mockTask = {
    id: "task1",
    title: "Original Title",
    workspaceId: "workspace1",
    workspace: {
      slug: "test-workspace",
    },
  };

  const mockUpdatedTask = {
    id: "task1",
    title: "Updated Title",
    workspaceId: "workspace1",
  };

  test("should update task title successfully with valid API token", async () => {
    process.env.API_TOKEN = TEST_API_TOKEN;

    (db.task.findFirst as Mock).mockResolvedValue(mockTask);
    (db.task.update as Mock).mockResolvedValue(mockUpdatedTask);

    const request = new NextRequest(
      "http://localhost:3000/api/tasks/task1/title",
      {
        method: "PUT",
        body: JSON.stringify({ title: "Updated Title" }),
        headers: {
          "Content-Type": "application/json",
          "x-api-token": TEST_API_TOKEN,
        },
      }
    );

    const response = await PUT(request, {
      params: Promise.resolve({ taskId: "task1" }),
    });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.data.title).toBe("Updated Title");

    expect(db.task.update).toHaveBeenCalledWith({
      where: {
        id: "task1",
        deleted: false,
      },
      data: {
        title: "Updated Title",
      },
      select: expect.any(Object),
    });
  });

  test("should accept API token in authorization header", async () => {
    process.env.API_TOKEN = TEST_API_TOKEN;

    (db.task.findFirst as Mock).mockResolvedValue(mockTask);
    (db.task.update as Mock).mockResolvedValue(mockUpdatedTask);

    const request = new NextRequest(
      "http://localhost:3000/api/tasks/task1/title",
      {
        method: "PUT",
        body: JSON.stringify({ title: "Updated Title" }),
        headers: {
          "Content-Type": "application/json",
          "authorization": TEST_API_TOKEN,
        },
      }
    );

    const response = await PUT(request, {
      params: Promise.resolve({ taskId: "task1" }),
    });

    expect(response.status).toBe(200);
    expect(db.task.update).toHaveBeenCalled();
  });

  test("should return 401 for missing API token", async () => {
    process.env.API_TOKEN = TEST_API_TOKEN;

    const request = new NextRequest(
      "http://localhost:3000/api/tasks/task1/title",
      {
        method: "PUT",
        body: JSON.stringify({ title: "Updated Title" }),
        headers: {
          "Content-Type": "application/json",
        },
      }
    );

    const response = await PUT(request, {
      params: Promise.resolve({ taskId: "task1" }),
    });
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.error).toBe("Unauthorized");
    expect(db.task.update).not.toHaveBeenCalled();
  });

  test("should return 401 for invalid API token", async () => {
    process.env.API_TOKEN = TEST_API_TOKEN;

    const request = new NextRequest(
      "http://localhost:3000/api/tasks/task1/title",
      {
        method: "PUT",
        body: JSON.stringify({ title: "Updated Title" }),
        headers: {
          "Content-Type": "application/json",
          "x-api-token": "wrong-token",
        },
      }
    );

    const response = await PUT(request, {
      params: Promise.resolve({ taskId: "task1" }),
    });
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.error).toBe("Unauthorized");
    expect(db.task.update).not.toHaveBeenCalled();
  });

  test("should return 400 for missing title", async () => {
    process.env.API_TOKEN = TEST_API_TOKEN;

    const request = new NextRequest(
      "http://localhost:3000/api/tasks/task1/title",
      {
        method: "PUT",
        body: JSON.stringify({}),
        headers: {
          "Content-Type": "application/json",
          "x-api-token": TEST_API_TOKEN,
        },
      }
    );

    const response = await PUT(request, {
      params: Promise.resolve({ taskId: "task1" }),
    });
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe("Title is required and must be a string");
    expect(db.task.update).not.toHaveBeenCalled();
  });

  test("should return 400 for invalid title type", async () => {
    process.env.API_TOKEN = TEST_API_TOKEN;

    const request = new NextRequest(
      "http://localhost:3000/api/tasks/task1/title",
      {
        method: "PUT",
        body: JSON.stringify({ title: 123 }),
        headers: {
          "Content-Type": "application/json",
          "x-api-token": TEST_API_TOKEN,
        },
      }
    );

    const response = await PUT(request, {
      params: Promise.resolve({ taskId: "task1" }),
    });
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe("Title is required and must be a string");
    expect(db.task.update).not.toHaveBeenCalled();
  });

  test("should return 404 for non-existent task", async () => {
    process.env.API_TOKEN = TEST_API_TOKEN;

    (db.task.findFirst as Mock).mockResolvedValue(null);

    const request = new NextRequest(
      "http://localhost:3000/api/tasks/non-existent/title",
      {
        method: "PUT",
        body: JSON.stringify({ title: "Updated Title" }),
        headers: {
          "Content-Type": "application/json",
          "x-api-token": TEST_API_TOKEN,
        },
      }
    );

    const response = await PUT(request, {
      params: Promise.resolve({ taskId: "non-existent" }),
    });
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data.error).toBe("Task not found");
    expect(db.task.update).not.toHaveBeenCalled();
  });

  test("should skip update if title is unchanged", async () => {
    process.env.API_TOKEN = TEST_API_TOKEN;

    (db.task.findFirst as Mock).mockResolvedValue(mockTask);

    const request = new NextRequest(
      "http://localhost:3000/api/tasks/task1/title",
      {
        method: "PUT",
        body: JSON.stringify({ title: "Original Title" }),
        headers: {
          "Content-Type": "application/json",
          "x-api-token": TEST_API_TOKEN,
        },
      }
    );

    const response = await PUT(request, {
      params: Promise.resolve({ taskId: "task1" }),
    });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.message).toBe("Title unchanged");
    expect(db.task.update).not.toHaveBeenCalled();
    expect(pusherServer.trigger).not.toHaveBeenCalled();
  });

  test("should trim whitespace from title", async () => {
    process.env.API_TOKEN = TEST_API_TOKEN;

    (db.task.findFirst as Mock).mockResolvedValue(mockTask);
    (db.task.update as Mock).mockResolvedValue({
      ...mockUpdatedTask,
      title: "Trimmed Title",
    });

    const request = new NextRequest(
      "http://localhost:3000/api/tasks/task1/title",
      {
        method: "PUT",
        body: JSON.stringify({ title: "  Trimmed Title  " }),
        headers: {
          "Content-Type": "application/json",
          "x-api-token": TEST_API_TOKEN,
        },
      }
    );

    await PUT(request, {
      params: Promise.resolve({ taskId: "task1" }),
    });

    expect(db.task.update).toHaveBeenCalledWith({
      where: expect.any(Object),
      data: {
        title: "Trimmed Title",
      },
      select: expect.any(Object),
    });
  });

  test("should broadcast title update to Pusher task channel", async () => {
    process.env.API_TOKEN = TEST_API_TOKEN;

    (db.task.findFirst as Mock).mockResolvedValue(mockTask);
    (db.task.update as Mock).mockResolvedValue(mockUpdatedTask);

    const request = new NextRequest(
      "http://localhost:3000/api/tasks/task1/title",
      {
        method: "PUT",
        body: JSON.stringify({ title: "Updated Title" }),
        headers: {
          "Content-Type": "application/json",
          "x-api-token": TEST_API_TOKEN,
        },
      }
    );

    await PUT(request, {
      params: Promise.resolve({ taskId: "task1" }),
    });

    expect(pusherServer.trigger).toHaveBeenCalledWith(
      "task-task1",
      "task-title-update",
      expect.objectContaining({
        taskId: "task1",
        newTitle: "Updated Title",
        previousTitle: "Original Title",
      })
    );
  });

  test("should broadcast title update to Pusher workspace channel", async () => {
    process.env.API_TOKEN = TEST_API_TOKEN;

    (db.task.findFirst as Mock).mockResolvedValue(mockTask);
    (db.task.update as Mock).mockResolvedValue(mockUpdatedTask);

    const request = new NextRequest(
      "http://localhost:3000/api/tasks/task1/title",
      {
        method: "PUT",
        body: JSON.stringify({ title: "Updated Title" }),
        headers: {
          "Content-Type": "application/json",
          "x-api-token": TEST_API_TOKEN,
        },
      }
    );

    await PUT(request, {
      params: Promise.resolve({ taskId: "task1" }),
    });

    expect(pusherServer.trigger).toHaveBeenCalledWith(
      "workspace-test-workspace",
      "workspace-task-title-update",
      expect.objectContaining({
        taskId: "task1",
        newTitle: "Updated Title",
        previousTitle: "Original Title",
      })
    );
  });

  test("should not fail request if Pusher broadcast fails", async () => {
    process.env.API_TOKEN = TEST_API_TOKEN;

    (db.task.findFirst as Mock).mockResolvedValue(mockTask);
    (db.task.update as Mock).mockResolvedValue(mockUpdatedTask);
    (pusherServer.trigger as Mock).mockRejectedValue(
      new Error("Pusher connection failed")
    );

    const request = new NextRequest(
      "http://localhost:3000/api/tasks/task1/title",
      {
        method: "PUT",
        body: JSON.stringify({ title: "Updated Title" }),
        headers: {
          "Content-Type": "application/json",
          "x-api-token": TEST_API_TOKEN,
        },
      }
    );

    const response = await PUT(request, {
      params: Promise.resolve({ taskId: "task1" }),
    });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(db.task.update).toHaveBeenCalled();
  });

  test("should handle database update errors gracefully", async () => {
    process.env.API_TOKEN = TEST_API_TOKEN;

    (db.task.findFirst as Mock).mockResolvedValue(mockTask);
    (db.task.update as Mock).mockRejectedValue(
      new Error("Database update failed")
    );

    const request = new NextRequest(
      "http://localhost:3000/api/tasks/task1/title",
      {
        method: "PUT",
        body: JSON.stringify({ title: "Updated Title" }),
        headers: {
          "Content-Type": "application/json",
          "x-api-token": TEST_API_TOKEN,
        },
      }
    );

    const response = await PUT(request, {
      params: Promise.resolve({ taskId: "task1" }),
    });
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.error).toBe("Failed to update task title");
  });

  test("should verify task is not soft-deleted", async () => {
    process.env.API_TOKEN = TEST_API_TOKEN;

    (db.task.findFirst as Mock).mockResolvedValue(mockTask);
    (db.task.update as Mock).mockResolvedValue(mockUpdatedTask);

    const request = new NextRequest(
      "http://localhost:3000/api/tasks/task1/title",
      {
        method: "PUT",
        body: JSON.stringify({ title: "Updated Title" }),
        headers: {
          "Content-Type": "application/json",
          "x-api-token": TEST_API_TOKEN,
        },
      }
    );

    await PUT(request, {
      params: Promise.resolve({ taskId: "task1" }),
    });

    expect(db.task.findFirst).toHaveBeenCalledWith({
      where: {
        id: "task1",
        deleted: false,
      },
      select: expect.any(Object),
    });

    expect(db.task.update).toHaveBeenCalledWith({
      where: {
        id: "task1",
        deleted: false,
      },
      data: expect.any(Object),
      select: expect.any(Object),
    });
  });
});