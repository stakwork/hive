import { describe, test, expect, vi, beforeEach, Mock } from "vitest";
import { NextRequest } from "next/server";
import { PATCH } from "@/app/api/tasks/[taskId]/route";
import { getServerSession } from "next-auth/next";
import { db } from "@/lib/db";
import { TaskStatus, Priority } from "@prisma/client";

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
    task: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    user: {
      findFirst: vi.fn(),
    },
    repository: {
      findFirst: vi.fn(),
    },
  },
}));

describe("PATCH /api/tasks/[taskId] - Unit Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetAllMocks();
  });

  const mockSession = {
    user: { id: "user1" },
  };

  const mockTask = {
    id: "task1",
    title: "Original Title",
    description: "Original Description",
    workspaceId: "workspace1",
    status: TaskStatus.TODO,
    priority: Priority.MEDIUM,
    assigneeId: null,
    repositoryId: null,
    estimatedHours: null,
    actualHours: null,
    createdById: "user1",
    updatedById: "user1",
    workspace: {
      id: "workspace1",
      ownerId: "user1",
      members: [],
    },
  };

  const mockUpdatedTask = {
    ...mockTask,
    title: "Updated Title",
    description: "Updated Description",
    status: TaskStatus.IN_PROGRESS,
    priority: Priority.HIGH,
    updatedById: "user1",
    assignee: null,
    repository: null,
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

  const mockAssignee = {
    id: "assignee1",
    name: "Assignee User",
    deleted: false,
  };

  const mockRepository = {
    id: "repo1",
    name: "Test Repo",
    workspaceId: "workspace1",
  };

  describe("Authentication", () => {
    test("should return 401 for unauthenticated user", async () => {
      (getServerSession as Mock).mockResolvedValue(null);

      const request = new NextRequest(
        "http://localhost:3000/api/tasks/task1",
        {
          method: "PATCH",
          body: JSON.stringify({ title: "Updated Title" }),
        }
      );

      const response = await PATCH(request, {
        params: Promise.resolve({ taskId: "task1" }),
      });
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Unauthorized");
      expect(db.task.update).not.toHaveBeenCalled();
    });

    test("should return 401 for invalid user session", async () => {
      (getServerSession as Mock).mockResolvedValue({ user: {} });

      const request = new NextRequest(
        "http://localhost:3000/api/tasks/task1",
        {
          method: "PATCH",
          body: JSON.stringify({ title: "Updated Title" }),
        }
      );

      const response = await PATCH(request, {
        params: Promise.resolve({ taskId: "task1" }),
      });
      const data = await response.json();

      expect(response.status).toBe(401);
      expect(data.error).toBe("Invalid user session");
      expect(db.task.update).not.toHaveBeenCalled();
    });
  });

  describe("Task Validation", () => {
    test("should return 404 for non-existent task", async () => {
      (getServerSession as Mock).mockResolvedValue(mockSession);
      (db.task.findFirst as Mock).mockResolvedValue(null);

      const request = new NextRequest(
        "http://localhost:3000/api/tasks/non-existent",
        {
          method: "PATCH",
          body: JSON.stringify({ title: "Updated Title" }),
        }
      );

      const response = await PATCH(request, {
        params: Promise.resolve({ taskId: "non-existent" }),
      });
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe("Task not found");
      expect(db.task.update).not.toHaveBeenCalled();
    });

    test("should return 403 for user without workspace access", async () => {
      const taskWithoutAccess = {
        ...mockTask,
        workspace: {
          id: "workspace1",
          ownerId: "different-user",
          members: [], // User is not a member
        },
      };

      (getServerSession as Mock).mockResolvedValue(mockSession);
      (db.task.findFirst as Mock).mockResolvedValue(taskWithoutAccess);

      const request = new NextRequest(
        "http://localhost:3000/api/tasks/task1",
        {
          method: "PATCH",
          body: JSON.stringify({ title: "Updated Title" }),
        }
      );

      const response = await PATCH(request, {
        params: Promise.resolve({ taskId: "task1" }),
      });
      const data = await response.json();

      expect(response.status).toBe(403);
      expect(data.error).toBe("Access denied");
      expect(db.task.update).not.toHaveBeenCalled();
    });
  });

  describe("Field Updates", () => {
    test("should update title successfully", async () => {
      (getServerSession as Mock).mockResolvedValue(mockSession);
      (db.task.findFirst as Mock).mockResolvedValue(mockTask);
      (db.task.update as Mock).mockResolvedValue({
        ...mockUpdatedTask,
        title: "New Title",
      });

      const request = new NextRequest(
        "http://localhost:3000/api/tasks/task1",
        {
          method: "PATCH",
          body: JSON.stringify({ title: "New Title" }),
        }
      );

      const response = await PATCH(request, {
        params: Promise.resolve({ taskId: "task1" }),
      });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.title).toBe("New Title");

      expect(db.task.update).toHaveBeenCalledWith({
        where: { id: "task1" },
        data: {
          title: "New Title",
          updatedById: "user1",
        },
        include: expect.any(Object),
      });
    });

    test("should update multiple fields simultaneously", async () => {
      (getServerSession as Mock).mockResolvedValue(mockSession);
      (db.task.findFirst as Mock).mockResolvedValue(mockTask);
      (db.task.update as Mock).mockResolvedValue(mockUpdatedTask);

      const request = new NextRequest(
        "http://localhost:3000/api/tasks/task1",
        {
          method: "PATCH",
          body: JSON.stringify({
            title: "Updated Title",
            description: "Updated Description",
            status: "IN_PROGRESS",
            priority: "HIGH",
            estimatedHours: 10,
          }),
        }
      );

      const response = await PATCH(request, {
        params: Promise.resolve({ taskId: "task1" }),
      });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(db.task.update).toHaveBeenCalledWith({
        where: { id: "task1" },
        data: {
          title: "Updated Title",
          description: "Updated Description",
          status: TaskStatus.IN_PROGRESS,
          priority: Priority.HIGH,
          estimatedHours: 10,
          updatedById: "user1",
        },
        include: expect.any(Object),
      });
    });

    test("should trim title and description", async () => {
      (getServerSession as Mock).mockResolvedValue(mockSession);
      (db.task.findFirst as Mock).mockResolvedValue(mockTask);
      (db.task.update as Mock).mockResolvedValue(mockUpdatedTask);

      const request = new NextRequest(
        "http://localhost:3000/api/tasks/task1",
        {
          method: "PATCH",
          body: JSON.stringify({
            title: "  Trimmed Title  ",
            description: "  Trimmed Description  ",
          }),
        }
      );

      await PATCH(request, {
        params: Promise.resolve({ taskId: "task1" }),
      });

      expect(db.task.update).toHaveBeenCalledWith({
        where: { id: "task1" },
        data: {
          title: "Trimmed Title",
          description: "Trimmed Description",
          updatedById: "user1",
        },
        include: expect.any(Object),
      });
    });

    test("should handle null values for optional fields", async () => {
      (getServerSession as Mock).mockResolvedValue(mockSession);
      (db.task.findFirst as Mock).mockResolvedValue(mockTask);
      (db.task.update as Mock).mockResolvedValue(mockUpdatedTask);

      const request = new NextRequest(
        "http://localhost:3000/api/tasks/task1",
        {
          method: "PATCH",
          body: JSON.stringify({
            description: null,
            assigneeId: null,
            repositoryId: null,
          }),
        }
      );

      const response = await PATCH(request, {
        params: Promise.resolve({ taskId: "task1" }),
      });

      expect(response.status).toBe(200);
      expect(db.task.update).toHaveBeenCalledWith({
        where: { id: "task1" },
        data: {
          description: null,
          assigneeId: null,
          repositoryId: null,
          updatedById: "user1",
        },
        include: expect.any(Object),
      });
    });
  });

  describe("Status Mapping", () => {
    test("should map 'active' to IN_PROGRESS", async () => {
      (getServerSession as Mock).mockResolvedValue(mockSession);
      (db.task.findFirst as Mock).mockResolvedValue(mockTask);
      (db.task.update as Mock).mockResolvedValue(mockUpdatedTask);

      const request = new NextRequest(
        "http://localhost:3000/api/tasks/task1",
        {
          method: "PATCH",
          body: JSON.stringify({ status: "active" }),
        }
      );

      await PATCH(request, {
        params: Promise.resolve({ taskId: "task1" }),
      });

      expect(db.task.update).toHaveBeenCalledWith({
        where: { id: "task1" },
        data: {
          status: TaskStatus.IN_PROGRESS,
          updatedById: "user1",
        },
        include: expect.any(Object),
      });
    });

    test("should return 400 for invalid status", async () => {
      (getServerSession as Mock).mockResolvedValue(mockSession);
      (db.task.findFirst as Mock).mockResolvedValue(mockTask);

      const request = new NextRequest(
        "http://localhost:3000/api/tasks/task1",
        {
          method: "PATCH",
          body: JSON.stringify({ status: "INVALID_STATUS" }),
        }
      );

      const response = await PATCH(request, {
        params: Promise.resolve({ taskId: "task1" }),
      });
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain("Invalid status");
      expect(db.task.update).not.toHaveBeenCalled();
    });

    test("should return 400 for invalid priority", async () => {
      (getServerSession as Mock).mockResolvedValue(mockSession);
      (db.task.findFirst as Mock).mockResolvedValue(mockTask);

      const request = new NextRequest(
        "http://localhost:3000/api/tasks/task1",
        {
          method: "PATCH",
          body: JSON.stringify({ priority: "INVALID_PRIORITY" }),
        }
      );

      const response = await PATCH(request, {
        params: Promise.resolve({ taskId: "task1" }),
      });
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toContain("Invalid priority");
      expect(db.task.update).not.toHaveBeenCalled();
    });
  });

  describe("Entity Validation", () => {
    test("should return 400 for non-existent assignee", async () => {
      (getServerSession as Mock).mockResolvedValue(mockSession);
      (db.task.findFirst as Mock).mockResolvedValue(mockTask);
      (db.user.findFirst as Mock).mockResolvedValue(null);

      const request = new NextRequest(
        "http://localhost:3000/api/tasks/task1",
        {
          method: "PATCH",
          body: JSON.stringify({ assigneeId: "non-existent-user" }),
        }
      );

      const response = await PATCH(request, {
        params: Promise.resolve({ taskId: "task1" }),
      });
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe("Assignee not found");
      expect(db.task.update).not.toHaveBeenCalled();
    });

    test("should update assignee successfully", async () => {
      (getServerSession as Mock).mockResolvedValue(mockSession);
      (db.task.findFirst as Mock).mockResolvedValue(mockTask);
      (db.user.findFirst as Mock).mockResolvedValue(mockAssignee);
      (db.task.update as Mock).mockResolvedValue(mockUpdatedTask);

      const request = new NextRequest(
        "http://localhost:3000/api/tasks/task1",
        {
          method: "PATCH",
          body: JSON.stringify({ assigneeId: "assignee1" }),
        }
      );

      const response = await PATCH(request, {
        params: Promise.resolve({ taskId: "task1" }),
      });

      expect(response.status).toBe(200);
      expect(db.task.update).toHaveBeenCalledWith({
        where: { id: "task1" },
        data: {
          assigneeId: "assignee1",
          updatedById: "user1",
        },
        include: expect.any(Object),
      });
    });

    test("should return 400 for repository not in workspace", async () => {
      const repositoryInDifferentWorkspace = {
        id: "repo1",
        name: "Test Repo",
        workspaceId: "different-workspace",
      };

      (getServerSession as Mock).mockResolvedValue(mockSession);
      (db.task.findFirst as Mock).mockResolvedValue(mockTask);
      (db.repository.findFirst as Mock).mockResolvedValue(
        repositoryInDifferentWorkspace
      );

      const request = new NextRequest(
        "http://localhost:3000/api/tasks/task1",
        {
          method: "PATCH",
          body: JSON.stringify({ repositoryId: "repo1" }),
        }
      );

      const response = await PATCH(request, {
        params: Promise.resolve({ taskId: "task1" }),
      });
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe(
        "Repository not found or does not belong to this workspace"
      );
      expect(db.task.update).not.toHaveBeenCalled();
    });

    test("should update repository successfully", async () => {
      (getServerSession as Mock).mockResolvedValue(mockSession);
      (db.task.findFirst as Mock).mockResolvedValue(mockTask);
      (db.repository.findFirst as Mock).mockResolvedValue(mockRepository);
      (db.task.update as Mock).mockResolvedValue(mockUpdatedTask);

      const request = new NextRequest(
        "http://localhost:3000/api/tasks/task1",
        {
          method: "PATCH",
          body: JSON.stringify({ repositoryId: "repo1" }),
        }
      );

      const response = await PATCH(request, {
        params: Promise.resolve({ taskId: "task1" }),
      });

      expect(response.status).toBe(200);
      expect(db.task.update).toHaveBeenCalledWith({
        where: { id: "task1" },
        data: {
          repositoryId: "repo1",
          updatedById: "user1",
        },
        include: expect.any(Object),
      });
    });
  });

  describe("Authorization", () => {
    test("should allow workspace owner to update task", async () => {
      (getServerSession as Mock).mockResolvedValue(mockSession);
      (db.task.findFirst as Mock).mockResolvedValue(mockTask);
      (db.task.update as Mock).mockResolvedValue(mockUpdatedTask);

      const request = new NextRequest(
        "http://localhost:3000/api/tasks/task1",
        {
          method: "PATCH",
          body: JSON.stringify({ title: "Updated by Owner" }),
        }
      );

      const response = await PATCH(request, {
        params: Promise.resolve({ taskId: "task1" }),
      });

      expect(response.status).toBe(200);
      expect(db.task.update).toHaveBeenCalled();
    });

    test("should allow workspace member to update task", async () => {
      const taskWithMember = {
        ...mockTask,
        workspace: {
          id: "workspace1",
          ownerId: "different-user",
          members: [{ role: "DEVELOPER" }], // User is a member
        },
      };

      (getServerSession as Mock).mockResolvedValue(mockSession);
      (db.task.findFirst as Mock).mockResolvedValue(taskWithMember);
      (db.task.update as Mock).mockResolvedValue(mockUpdatedTask);

      const request = new NextRequest(
        "http://localhost:3000/api/tasks/task1",
        {
          method: "PATCH",
          body: JSON.stringify({ title: "Updated by Member" }),
        }
      );

      const response = await PATCH(request, {
        params: Promise.resolve({ taskId: "task1" }),
      });

      expect(response.status).toBe(200);
      expect(db.task.update).toHaveBeenCalled();
    });
  });

  describe("Audit Trail", () => {
    test("should update updatedById field", async () => {
      (getServerSession as Mock).mockResolvedValue(mockSession);
      (db.task.findFirst as Mock).mockResolvedValue(mockTask);
      (db.task.update as Mock).mockResolvedValue(mockUpdatedTask);

      const request = new NextRequest(
        "http://localhost:3000/api/tasks/task1",
        {
          method: "PATCH",
          body: JSON.stringify({ title: "Updated Title" }),
        }
      );

      await PATCH(request, {
        params: Promise.resolve({ taskId: "task1" }),
      });

      expect(db.task.update).toHaveBeenCalledWith({
        where: { id: "task1" },
        data: expect.objectContaining({
          updatedById: "user1",
        }),
        include: expect.any(Object),
      });
    });
  });

  describe("Error Handling", () => {
    test("should return 500 on database error", async () => {
      (getServerSession as Mock).mockResolvedValue(mockSession);
      (db.task.findFirst as Mock).mockResolvedValue(mockTask);
      (db.task.update as Mock).mockRejectedValue(
        new Error("Database connection failed")
      );

      const request = new NextRequest(
        "http://localhost:3000/api/tasks/task1",
        {
          method: "PATCH",
          body: JSON.stringify({ title: "Updated Title" }),
        }
      );

      const response = await PATCH(request, {
        params: Promise.resolve({ taskId: "task1" }),
      });
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe("Failed to update task");
    });
  });
});