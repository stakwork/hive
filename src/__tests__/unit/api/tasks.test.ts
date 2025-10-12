import { describe, test, expect, vi, beforeEach, Mock } from "vitest";
import { POST } from "@/app/api/tasks/route";
import { db } from "@/lib/db";
import { TaskStatus, Priority } from "@prisma/client";
import {
  createPostRequest,
  createAuthenticatedPostRequest,
} from "@/__tests__/support/helpers";

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
    },
  },
}));

describe("POST /api/tasks - Unit Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetAllMocks();
  });

  const mockUser = {
    id: "user1",
    name: "Test User",
    email: "test@example.com",
  };

  const mockWorkspace = {
    id: "workspace1",
    ownerId: "user1",
    members: [{ role: "DEVELOPER" }],
  };

  const mockAssignee = {
    id: "assignee1",
    name: "Assignee User",
    email: "assignee@example.com",
    deleted: false,
  };

  const mockRepository = {
    id: "repo1",
    name: "Test Repo",
    workspaceId: "workspace1",
  };

  const mockCreatedTask = {
    id: "task1",
    title: "Test Task",
    description: "Test Description",
    workspaceId: "workspace1",
    status: TaskStatus.TODO,
    priority: Priority.MEDIUM,
    assigneeId: "assignee1",
    repositoryId: "repo1",
    estimatedHours: 5,
    actualHours: null,
    createdById: "user1",
    updatedById: "user1",
    createdAt: new Date("2024-01-01"),
    updatedAt: new Date("2024-01-01"),
    assignee: mockAssignee,
    repository: mockRepository,
    createdBy: {
      id: "user1",
      name: "Test User",
      email: "test@example.com",
      image: null,
      githubAuth: null,
    },
    workspace: {
      id: "workspace1",
      name: "Test Workspace",
      slug: "test-workspace",
    },
  };

  test("should create task successfully with all fields", async () => {
    (db.workspace.findFirst as Mock).mockResolvedValue(mockWorkspace);
    (db.user.findUnique as Mock).mockResolvedValue(mockUser);
    (db.user.findFirst as Mock).mockResolvedValue(mockAssignee);
    (db.repository.findFirst as Mock).mockResolvedValue(mockRepository);
    (db.task.create as Mock).mockResolvedValue(mockCreatedTask);

    const request = createAuthenticatedPostRequest(
      "http://localhost:3000/api/tasks",
      {
        title: "Test Task",
        description: "Test Description",
        workspaceSlug: "test-workspace",
        status: "TODO",
        priority: "MEDIUM",
        assigneeId: "assignee1",
        repositoryId: "repo1",
        estimatedHours: 5,
        actualHours: null,
      },
      mockUser
    );

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(201);
    expect(data.success).toBe(true);
    expect(data.data).toMatchObject({
      id: "task1",
      title: "Test Task",
      description: "Test Description",
      status: TaskStatus.TODO,
      priority: Priority.MEDIUM,
    });

    expect(db.task.create).toHaveBeenCalledWith({
      data: {
        title: "Test Task",
        description: "Test Description",
        workspaceId: "workspace1",
        status: TaskStatus.TODO,
        priority: Priority.MEDIUM,
        assigneeId: "assignee1",
        repositoryId: "repo1",
        estimatedHours: 5,
        actualHours: null,
        createdById: "user1",
        updatedById: "user1",
      },
      include: {
        assignee: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        repository: {
          select: {
            id: true,
            name: true,
            repositoryUrl: true,
          },
        },
        createdBy: {
          select: {
            id: true,
            name: true,
            email: true,
            image: true,
            githubAuth: {
              select: {
                githubUsername: true,
              },
            },
          },
        },
        workspace: {
          select: {
            id: true,
            name: true,
            slug: true,
          },
        },
      },
    });
  });

  test("should create task with minimal required fields", async () => {
    const minimalTask = {
      ...mockCreatedTask,
      description: null,
      assigneeId: null,
      repositoryId: null,
      estimatedHours: null,
      assignee: null,
      repository: null,
    };

    (db.workspace.findFirst as Mock).mockResolvedValue(mockWorkspace);
    (db.user.findUnique as Mock).mockResolvedValue(mockUser);
    (db.task.create as Mock).mockResolvedValue(minimalTask);

    const request = createAuthenticatedPostRequest(
      "http://localhost:3000/api/tasks",
      {
        title: "Test Task",
        workspaceSlug: "test-workspace",
      },
      mockUser
    );

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(201);
    expect(data.success).toBe(true);
    expect(db.task.create).toHaveBeenCalledWith({
      data: {
        title: "Test Task",
        description: null,
        workspaceId: "workspace1",
        status: TaskStatus.TODO,
        priority: Priority.MEDIUM,
        assigneeId: null,
        repositoryId: null,
        estimatedHours: null,
        actualHours: null,
        createdById: "user1",
        updatedById: "user1",
      },
      include: expect.any(Object),
    });
  });

  test("should return 401 for unauthenticated user", async () => {
    const request = createPostRequest(
      "http://localhost:3000/api/tasks",
      {
        title: "Test Task",
        workspaceSlug: "test-workspace",
      }
    );

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.error).toBe("Unauthorized");
    expect(db.task.create).not.toHaveBeenCalled();
  });

  test("should return 401 for invalid user session", async () => {
    const request = createPostRequest(
      "http://localhost:3000/api/tasks",
      {
        title: "Test Task",
        workspaceSlug: "test-workspace",
      }
    );

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(401);
    expect(data.error).toBe("Unauthorized");
    expect(db.task.create).not.toHaveBeenCalled();
  });

  test("should return 400 for missing required fields", async () => {
    const request = createAuthenticatedPostRequest(
      "http://localhost:3000/api/tasks",
      {
        description: "Missing title and workspaceSlug",
      },
      mockUser
    );

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe("Missing required fields: title, workspaceId");
    expect(db.task.create).not.toHaveBeenCalled();
  });

  test("should return 404 for non-existent workspace", async () => {
    (db.workspace.findFirst as Mock).mockResolvedValue(null);

    const request = createAuthenticatedPostRequest(
      "http://localhost:3000/api/tasks",
      {
        title: "Test Task",
        workspaceSlug: "non-existent-workspace",
      },
      mockUser
    );

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data.error).toBe("Workspace not found");
    expect(db.task.create).not.toHaveBeenCalled();
  });

  test("should return 404 for non-existent user", async () => {
    (db.workspace.findFirst as Mock).mockResolvedValue(mockWorkspace);
    (db.user.findUnique as Mock).mockResolvedValue(null);

    const request = createAuthenticatedPostRequest(
      "http://localhost:3000/api/tasks",
      {
        title: "Test Task",
        workspaceSlug: "test-workspace",
      },
      mockUser
    );

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data.error).toBe("User not found");
    expect(db.task.create).not.toHaveBeenCalled();
  });

  test("should return 403 for user without workspace access", async () => {
    const workspaceWithoutAccess = {
      id: "workspace1",
      ownerId: "different-user",
      members: [], // No members
    };

    (db.workspace.findFirst as Mock).mockResolvedValue(workspaceWithoutAccess);
    (db.user.findUnique as Mock).mockResolvedValue(mockUser);

    const request = createAuthenticatedPostRequest(
      "http://localhost:3000/api/tasks",
      {
        title: "Test Task",
        workspaceSlug: "test-workspace",
      },
      mockUser
    );

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data.error).toBe("Access denied");
    expect(db.task.create).not.toHaveBeenCalled();
  });

  test("should return 400 for invalid status", async () => {
    (db.workspace.findFirst as Mock).mockResolvedValue(mockWorkspace);
    (db.user.findUnique as Mock).mockResolvedValue(mockUser);

    const request = createAuthenticatedPostRequest(
      "http://localhost:3000/api/tasks",
      {
        title: "Test Task",
        workspaceSlug: "test-workspace",
        status: "INVALID_STATUS",
      },
      mockUser
    );

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toContain("Invalid status");
    expect(db.task.create).not.toHaveBeenCalled();
  });

  test("should return 400 for invalid priority", async () => {
    (db.workspace.findFirst as Mock).mockResolvedValue(mockWorkspace);
    (db.user.findUnique as Mock).mockResolvedValue(mockUser);

    const request = createAuthenticatedPostRequest(
      "http://localhost:3000/api/tasks",
      {
        title: "Test Task",
        workspaceSlug: "test-workspace",
        priority: "INVALID_PRIORITY",
      },
      mockUser
    );

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toContain("Invalid priority");
    expect(db.task.create).not.toHaveBeenCalled();
  });

  test("should return 400 for non-existent assignee", async () => {
    (db.workspace.findFirst as Mock).mockResolvedValue(mockWorkspace);
    (db.user.findUnique as Mock).mockResolvedValue(mockUser);
    (db.user.findFirst as Mock).mockResolvedValue(null);

    const request = createAuthenticatedPostRequest(
      "http://localhost:3000/api/tasks",
      {
        title: "Test Task",
        workspaceSlug: "test-workspace",
        assigneeId: "non-existent-user",
      },
      mockUser
    );

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe("Assignee not found");
    expect(db.task.create).not.toHaveBeenCalled();
  });

  test("should return 400 for repository not in workspace", async () => {
    const repositoryInDifferentWorkspace = {
      id: "repo1",
      name: "Test Repo",
      workspaceId: "different-workspace",
    };

    (db.workspace.findFirst as Mock).mockResolvedValue(mockWorkspace);
    (db.user.findUnique as Mock).mockResolvedValue(mockUser);
    (db.repository.findFirst as Mock).mockResolvedValue(repositoryInDifferentWorkspace);

    const request = createAuthenticatedPostRequest(
      "http://localhost:3000/api/tasks",
      {
        title: "Test Task",
        workspaceSlug: "test-workspace",
        repositoryId: "repo1",
      },
      mockUser
    );

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe("Repository not found or does not belong to this workspace");
    expect(db.task.create).not.toHaveBeenCalled();
  });

  test("should handle status mapping from 'active' to IN_PROGRESS", async () => {
    (db.workspace.findFirst as Mock).mockResolvedValue(mockWorkspace);
    (db.user.findUnique as Mock).mockResolvedValue(mockUser);
    (db.task.create as Mock).mockResolvedValue({
      ...mockCreatedTask,
      status: TaskStatus.IN_PROGRESS,
    });

    const request = createAuthenticatedPostRequest(
      "http://localhost:3000/api/tasks",
      {
        title: "Test Task",
        workspaceSlug: "test-workspace",
        status: "active",
      },
      mockUser
    );

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(201);
    expect(db.task.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        status: TaskStatus.IN_PROGRESS,
      }),
      include: expect.any(Object),
    });
  });

  test("should handle database error gracefully", async () => {
    (db.workspace.findFirst as Mock).mockResolvedValue(mockWorkspace);
    (db.user.findUnique as Mock).mockResolvedValue(mockUser);
    (db.task.create as Mock).mockRejectedValue(new Error("Database connection failed"));

    const request = createAuthenticatedPostRequest(
      "http://localhost:3000/api/tasks",
      {
        title: "Test Task",
        workspaceSlug: "test-workspace",
      },
      mockUser
    );

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(500);
    expect(data.error).toBe("Failed to create task");
  });

  test("should validate workspace member access (member case)", async () => {
    const workspaceWithMember = {
      id: "workspace1",
      ownerId: "different-user",
      members: [{ role: "DEVELOPER" }], // User is a member
    };

    (db.workspace.findFirst as Mock).mockResolvedValue(workspaceWithMember);
    (db.user.findUnique as Mock).mockResolvedValue(mockUser);
    (db.task.create as Mock).mockResolvedValue(mockCreatedTask);

    const request = createAuthenticatedPostRequest(
      "http://localhost:3000/api/tasks",
      {
        title: "Test Task",
        workspaceSlug: "test-workspace",
      },
      mockUser
    );

    const response = await POST(request);

    expect(response.status).toBe(201);
    expect(db.task.create).toHaveBeenCalled();
  });
});