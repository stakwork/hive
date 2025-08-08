import { POST } from "@/app/api/tasks/route";
import { getServerSession } from "next-auth/next";
import { db } from "@/lib/db";
import { TaskStatus, Priority } from "@prisma/client";
import {
  mockRequestWithBody,
  mockGetServerSession,
  expectErrorResponse,
  expectSuccessResponse,
  mockConsole,
} from "@/tests/utils/test-helpers";
import {
  mockUsers,
  mockWorkspaces,
  mockRepositories,
  mockSessions,
  mockTaskPayloads,
} from "@/tests/utils/mock-data";

// Mock NextAuth and database
jest.mock("next-auth/next");
jest.mock("@/lib/db", () => ({
  db: {
    workspace: {
      findFirst: jest.fn(),
    },
    user: {
      findFirst: jest.fn(),
    },
    repository: {
      findFirst: jest.fn(),
    },
    task: {
      create: jest.fn(),
    },
  },
}));

describe("POST /api/tasks", () => {
  mockConsole();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("Authentication", () => {
    it("should return 401 when no session", async () => {
      mockGetServerSession(null);
      const request = mockRequestWithBody("http://localhost:3000/api/tasks", mockTaskPayloads.minimal);
      const response = await POST(request);
      expectErrorResponse(response, 401, "Unauthorized");
    });

    it("should return 401 when session has no user", async () => {
      mockGetServerSession({ expires: "future-date" });
      const request = mockRequestWithBody("http://localhost:3000/api/tasks", mockTaskPayloads.minimal);
      const response = await POST(request);
      expectErrorResponse(response, 401, "Unauthorized");
    });

    it("should return 401 when session user has no ID", async () => {
      mockGetServerSession(mockSessions.invalidUser);
      const request = mockRequestWithBody("http://localhost:3000/api/tasks", mockTaskPayloads.minimal);
      const response = await POST(request);
      expectErrorResponse(response, 401, "Invalid user session");
    });
  });

  describe("Request Validation", () => {
    beforeEach(() => {
      mockGetServerSession(mockSessions.owner);
    });

    it("should return 400 when title is missing", async () => {
      const payload = { workspaceSlug: mockWorkspaces.primary.slug };
      const request = mockRequestWithBody("http://localhost:3000/api/tasks", payload);
      const response = await POST(request);
      expectErrorResponse(response, 400, "Missing required fields: title, workspaceId");
    });

    it("should return 400 when title is empty string", async () => {
      const request = mockRequestWithBody("http://localhost:3000/api/tasks", mockTaskPayloads.invalid);
      const response = await POST(request);
      expectErrorResponse(response, 400, "Missing required fields: title, workspaceId");
    });

    it("should return 400 when workspaceSlug is missing", async () => {
      const payload = { title: "Test Task" };
      const request = mockRequestWithBody("http://localhost:3000/api/tasks", payload);
      const response = await POST(request);
      expectErrorResponse(response, 400, "Missing required fields: title, workspaceId");
    });

    it("should accept minimal valid payload", async () => {
      (db.workspace.findFirst as jest.Mock).mockResolvedValue({
        id: mockWorkspaces.primary.id,
        ownerId: mockUsers.owner.id,
        members: [],
      });
      (db.task.create as jest.Mock).mockResolvedValue({
        id: "new-task-id",
        title: "New Task",
      });

      const request = mockRequestWithBody("http://localhost:3000/api/tasks", mockTaskPayloads.minimal);
      const response = await POST(request);
      expectSuccessResponse(response, 201);
    });
  });

  describe("Workspace Validation", () => {
    beforeEach(() => {
      mockGetServerSession(mockSessions.owner);
    });

    it("should return 404 when workspace not found", async () => {
      (db.workspace.findFirst as jest.Mock).mockResolvedValue(null);
      const request = mockRequestWithBody("http://localhost:3000/api/tasks", mockTaskPayloads.minimal);
      const response = await POST(request);
      expectErrorResponse(response, 404, "Workspace not found");
    });

    it("should exclude deleted workspaces", async () => {
      (db.workspace.findFirst as jest.Mock).mockResolvedValue(null);
      const request = mockRequestWithBody("http://localhost:3000/api/tasks", mockTaskPayloads.minimal);
      await POST(request);

      expect(db.workspace.findFirst).toHaveBeenCalledWith({
        where: {
          slug: mockWorkspaces.primary.slug,
          deleted: false,
        },
        select: {
          id: true,
          ownerId: true,
          members: {
            where: {
              userId: mockUsers.owner.id,
            },
            select: {
              role: true,
            },
          },
        },
      });
    });

    it("should allow workspace owner to create tasks", async () => {
      (db.workspace.findFirst as jest.Mock).mockResolvedValue({
        id: mockWorkspaces.primary.id,
        ownerId: mockUsers.owner.id,
        members: [],
      });
      (db.task.create as jest.Mock).mockResolvedValue({ id: "new-task", title: "New Task" });

      const request = mockRequestWithBody("http://localhost:3000/api/tasks", mockTaskPayloads.minimal);
      const response = await POST(request);
      expectSuccessResponse(response, 201);
    });

    it("should allow workspace member to create tasks", async () => {
      mockGetServerSession(mockSessions.member);
      (db.workspace.findFirst as jest.Mock).mockResolvedValue({
        id: mockWorkspaces.primary.id,
        ownerId: mockUsers.owner.id,
        members: [{ role: "MEMBER" }],
      });
      (db.task.create as jest.Mock).mockResolvedValue({ id: "new-task", title: "New Task" });

      const request = mockRequestWithBody("http://localhost:3000/api/tasks", mockTaskPayloads.minimal);
      const response = await POST(request);
      expectSuccessResponse(response, 201);
    });

    it("should return 403 when user is not owner or member", async () => {
      mockGetServerSession(mockSessions.nonMember);
      (db.workspace.findFirst as jest.Mock).mockResolvedValue({
        id: mockWorkspaces.primary.id,
        ownerId: mockUsers.owner.id,
        members: [],
      });

      const request = mockRequestWithBody("http://localhost:3000/api/tasks", mockTaskPayloads.minimal);
      const response = await POST(request);
      expectErrorResponse(response, 403, "Access denied");
    });
  });

  describe("Status Validation", () => {
    beforeEach(() => {
      mockGetServerSession(mockSessions.owner);
      (db.workspace.findFirst as jest.Mock).mockResolvedValue({
        id: mockWorkspaces.primary.id,
        ownerId: mockUsers.owner.id,
        members: [],
      });
      (db.task.create as jest.Mock).mockResolvedValue({ id: "new-task", title: "New Task" });
    });

    it("should use TODO as default status when not provided", async () => {
      const request = mockRequestWithBody("http://localhost:3000/api/tasks", mockTaskPayloads.minimal);
      await POST(request);

      expect(db.task.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: TaskStatus.TODO,
          }),
        })
      );
    });

    it("should map 'active' status to IN_PROGRESS", async () => {
      const request = mockRequestWithBody("http://localhost:3000/api/tasks", mockTaskPayloads.withActiveStatus);
      await POST(request);

      expect(db.task.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: TaskStatus.IN_PROGRESS,
          }),
        })
      );
    });

    it("should accept valid TaskStatus enum values", async () => {
      const payload = { ...mockTaskPayloads.minimal, status: TaskStatus.DONE };
      const request = mockRequestWithBody("http://localhost:3000/api/tasks", payload);
      await POST(request);

      expect(db.task.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: TaskStatus.DONE,
          }),
        })
      );
    });

    it("should return 400 for invalid status", async () => {
      const request = mockRequestWithBody("http://localhost:3000/api/tasks", mockTaskPayloads.invalidStatus);
      const response = await POST(request);
      expectErrorResponse(response, 400);
      expect(response.data.error).toContain("Invalid status");
    });
  });

  describe("Priority Validation", () => {
    beforeEach(() => {
      mockGetServerSession(mockSessions.owner);
      (db.workspace.findFirst as jest.Mock).mockResolvedValue({
        id: mockWorkspaces.primary.id,
        ownerId: mockUsers.owner.id,
        members: [],
      });
      (db.task.create as jest.Mock).mockResolvedValue({ id: "new-task", title: "New Task" });
    });

    it("should use MEDIUM as default priority when not provided", async () => {
      const request = mockRequestWithBody("http://localhost:3000/api/tasks", mockTaskPayloads.minimal);
      await POST(request);

      expect(db.task.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            priority: Priority.MEDIUM,
          }),
        })
      );
    });

    it("should accept valid Priority enum values", async () => {
      const payload = { ...mockTaskPayloads.minimal, priority: Priority.HIGH };
      const request = mockRequestWithBody("http://localhost:3000/api/tasks", payload);
      await POST(request);

      expect(db.task.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            priority: Priority.HIGH,
          }),
        })
      );
    });

    it("should return 400 for invalid priority", async () => {
      const request = mockRequestWithBody("http://localhost:3000/api/tasks", mockTaskPayloads.invalidPriority);
      const response = await POST(request);
      expectErrorResponse(response, 400);
      expect(response.data.error).toContain("Invalid priority");
    });
  });

  describe("Assignee Validation", () => {
    beforeEach(() => {
      mockGetServerSession(mockSessions.owner);
      (db.workspace.findFirst as jest.Mock).mockResolvedValue({
        id: mockWorkspaces.primary.id,
        ownerId: mockUsers.owner.id,
        members: [],
      });
      (db.task.create as jest.Mock).mockResolvedValue({ id: "new-task", title: "New Task" });
    });

    it("should create task without assignee when not provided", async () => {
      const request = mockRequestWithBody("http://localhost:3000/api/tasks", mockTaskPayloads.minimal);
      await POST(request);

      expect(db.task.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            assigneeId: null,
          }),
        })
      );
    });

    it("should validate assignee exists when provided", async () => {
      (db.user.findFirst as jest.Mock).mockResolvedValue({
        id: mockUsers.assignee.id,
        name: mockUsers.assignee.name,
      });

      const payload = { ...mockTaskPayloads.minimal, assigneeId: mockUsers.assignee.id };
      const request = mockRequestWithBody("http://localhost:3000/api/tasks", payload);
      await POST(request);

      expect(db.user.findFirst).toHaveBeenCalledWith({
        where: {
          id: mockUsers.assignee.id,
          deleted: false,
        },
      });
    });

    it("should return 400 when assignee not found", async () => {
      (db.user.findFirst as jest.Mock).mockResolvedValue(null);
      const request = mockRequestWithBody("http://localhost:3000/api/tasks", mockTaskPayloads.nonExistentAssignee);
      const response = await POST(request);
      expectErrorResponse(response, 400, "Assignee not found");
    });

    it("should exclude deleted assignees", async () => {
      (db.user.findFirst as jest.Mock).mockResolvedValue(null);
      const payload = { ...mockTaskPayloads.minimal, assigneeId: "deleted-user-id" };
      const request = mockRequestWithBody("http://localhost:3000/api/tasks", payload);
      await POST(request);

      expect(db.user.findFirst).toHaveBeenCalledWith({
        where: {
          id: "deleted-user-id",
          deleted: false,
        },
      });
    });
  });

  describe("Repository Validation", () => {
    beforeEach(() => {
      mockGetServerSession(mockSessions.owner);
      (db.workspace.findFirst as jest.Mock).mockResolvedValue({
        id: mockWorkspaces.primary.id,
        ownerId: mockUsers.owner.id,
        members: [],
      });
      (db.task.create as jest.Mock).mockResolvedValue({ id: "new-task", title: "New Task" });
    });

    it("should create task without repository when not provided", async () => {
      const request = mockRequestWithBody("http://localhost:3000/api/tasks", mockTaskPayloads.minimal);
      await POST(request);

      expect(db.task.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            repositoryId: null,
          }),
        })
      );
    });

    it("should validate repository exists and belongs to workspace", async () => {
      (db.repository.findFirst as jest.Mock).mockResolvedValue({
        id: mockRepositories.primary.id,
        name: mockRepositories.primary.name,
        workspaceId: mockWorkspaces.primary.id,
      });

      const payload = { ...mockTaskPayloads.minimal, repositoryId: mockRepositories.primary.id };
      const request = mockRequestWithBody("http://localhost:3000/api/tasks", payload);
      await POST(request);

      expect(db.repository.findFirst).toHaveBeenCalledWith({
        where: {
          id: mockRepositories.primary.id,
          workspaceId: mockWorkspaces.primary.id,
        },
      });
    });

    it("should return 400 when repository not found", async () => {
      (db.repository.findFirst as jest.Mock).mockResolvedValue(null);
      const request = mockRequestWithBody("http://localhost:3000/api/tasks", mockTaskPayloads.nonExistentRepository);
      const response = await POST(request);
      expectErrorResponse(response, 400, "Repository not found or does not belong to this workspace");
    });

    it("should return 400 when repository belongs to different workspace", async () => {
      (db.repository.findFirst as jest.Mock).mockResolvedValue(null);
      const request = mockRequestWithBody("http://localhost:3000/api/tasks", mockTaskPayloads.otherWorkspaceRepository);
      const response = await POST(request);
      expectErrorResponse(response, 400, "Repository not found or does not belong to this workspace");
    });
  });

  describe("Task Creation", () => {
    beforeEach(() => {
      mockGetServerSession(mockSessions.owner);
      (db.workspace.findFirst as jest.Mock).mockResolvedValue({
        id: mockWorkspaces.primary.id,
        ownerId: mockUsers.owner.id,
        members: [],
      });
    });

    it("should create task with all provided fields", async () => {
      (db.user.findFirst as jest.Mock).mockResolvedValue({ id: mockUsers.assignee.id });
      (db.repository.findFirst as jest.Mock).mockResolvedValue({ id: mockRepositories.primary.id });
      const mockCreatedTask = {
        id: "new-task-id",
        title: mockTaskPayloads.complete.title,
        description: mockTaskPayloads.complete.description,
        workspaceId: mockWorkspaces.primary.id,
        status: mockTaskPayloads.complete.status,
        priority: mockTaskPayloads.complete.priority,
        assigneeId: mockTaskPayloads.complete.assigneeId,
        repositoryId: mockTaskPayloads.complete.repositoryId,
        estimatedHours: mockTaskPayloads.complete.estimatedHours,
        actualHours: mockTaskPayloads.complete.actualHours,
        createdById: mockUsers.owner.id,
        updatedById: mockUsers.owner.id,
      };
      (db.task.create as jest.Mock).mockResolvedValue(mockCreatedTask);

      const request = mockRequestWithBody("http://localhost:3000/api/tasks", mockTaskPayloads.complete);
      await POST(request);

      expect(db.task.create).toHaveBeenCalledWith({
        data: {
          title: mockTaskPayloads.complete.title.trim(),
          description: mockTaskPayloads.complete.description?.trim() || null,
          workspaceId: mockWorkspaces.primary.id,
          status: mockTaskPayloads.complete.status,
          priority: mockTaskPayloads.complete.priority,
          assigneeId: mockTaskPayloads.complete.assigneeId,
          repositoryId: mockTaskPayloads.complete.repositoryId,
          estimatedHours: mockTaskPayloads.complete.estimatedHours,
          actualHours: mockTaskPayloads.complete.actualHours,
          createdById: mockUsers.owner.id,
          updatedById: mockUsers.owner.id,
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

    it("should trim title and description", async () => {
      const payloadWithWhitespace = {
        title: "  Task with whitespace  ",
        description: "  Description with whitespace  ",
        workspaceSlug: mockWorkspaces.primary.slug,
      };
      (db.task.create as jest.Mock).mockResolvedValue({ id: "new-task", title: "Trimmed Task" });

      const request = mockRequestWithBody("http://localhost:3000/api/tasks", payloadWithWhitespace);
      await POST(request);

      expect(db.task.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            title: "Task with whitespace",
            description: "Description with whitespace",
          }),
        })
      );
    });

    it("should set description to null when empty", async () => {
      const payloadWithEmptyDescription = {
        ...mockTaskPayloads.minimal,
        description: "",
      };
      (db.task.create as jest.Mock).mockResolvedValue({ id: "new-task", title: "Task" });

      const request = mockRequestWithBody("http://localhost:3000/api/tasks", payloadWithEmptyDescription);
      await POST(request);

      expect(db.task.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            description: null,
          }),
        })
      );
    });

    it("should return created task with includes", async () => {
      const mockCreatedTask = {
        id: "new-task-id",
        title: "New Task",
        assignee: { id: "user-1", name: "User 1", email: "user1@example.com" },
        repository: { id: "repo-1", name: "Repo 1", repositoryUrl: "https://github.com/test/repo" },
        createdBy: { id: mockUsers.owner.id, name: mockUsers.owner.name, email: mockUsers.owner.email },
        workspace: { id: mockWorkspaces.primary.id, name: mockWorkspaces.primary.name, slug: mockWorkspaces.primary.slug },
      };
      (db.task.create as jest.Mock).mockResolvedValue(mockCreatedTask);

      const request = mockRequestWithBody("http://localhost:3000/api/tasks", mockTaskPayloads.minimal);
      const response = await POST(request);

      expectSuccessResponse(response, 201);
      expect(response.data.data).toEqual(mockCreatedTask);
    });
  });

  describe("Error Handling", () => {
    beforeEach(() => {
      mockGetServerSession(mockSessions.owner);
    });

    it("should handle workspace query errors", async () => {
      (db.workspace.findFirst as jest.Mock).mockRejectedValue(new Error("Database error"));
      const request = mockRequestWithBody("http://localhost:3000/api/tasks", mockTaskPayloads.minimal);
      const response = await POST(request);

      expectErrorResponse(response, 500, "Failed to create task");
      expect(console.error).toHaveBeenCalledWith("Error creating task:", expect.any(Error));
    });

    it("should handle task creation errors", async () => {
      (db.workspace.findFirst as jest.Mock).mockResolvedValue({
        id: mockWorkspaces.primary.id,
        ownerId: mockUsers.owner.id,
        members: [],
      });
      (db.task.create as jest.Mock).mockRejectedValue(new Error("Failed to create task"));

      const request = mockRequestWithBody("http://localhost:3000/api/tasks", mockTaskPayloads.minimal);
      const response = await POST(request);

      expectErrorResponse(response, 500, "Failed to create task");
    });

    it("should handle malformed JSON in request body", async () => {
      const request = new Request("http://localhost:3000/api/tasks", {
        method: "POST",
        body: "invalid json",
        headers: { "Content-Type": "application/json" },
      });

      const response = await POST(request as any);
      expectErrorResponse(response, 500, "Failed to create task");
    });

    it("should handle assignee validation errors", async () => {
      (db.workspace.findFirst as jest.Mock).mockResolvedValue({
        id: mockWorkspaces.primary.id,
        ownerId: mockUsers.owner.id,
        members: [],
      });
      (db.user.findFirst as jest.Mock).mockRejectedValue(new Error("User query failed"));

      const payload = { ...mockTaskPayloads.minimal, assigneeId: "test-user" };
      const request = mockRequestWithBody("http://localhost:3000/api/tasks", payload);
      const response = await POST(request);

      expectErrorResponse(response, 500, "Failed to create task");
    });

    it("should handle repository validation errors", async () => {
      (db.workspace.findFirst as jest.Mock).mockResolvedValue({
        id: mockWorkspaces.primary.id,
        ownerId: mockUsers.owner.id,
        members: [],
      });
      (db.repository.findFirst as jest.Mock).mockRejectedValue(new Error("Repository query failed"));

      const payload = { ...mockTaskPayloads.minimal, repositoryId: "test-repo" };
      const request = mockRequestWithBody("http://localhost:3000/api/tasks", payload);
      const response = await POST(request);

      expectErrorResponse(response, 500, "Failed to create task");
    });
  });
});