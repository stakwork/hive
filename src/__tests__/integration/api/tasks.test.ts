import { describe, test, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { getServerSession } from "next-auth/next";
import { GET, POST } from "@/app/api/tasks/route";
import { db } from "@/lib/db";
import {
  TaskStatus,
  Priority,
  WorkflowStatus,
  ChatRole,
  ChatStatus,
  ArtifactType,
  WorkspaceRole,
} from "@prisma/client";

type MockedGetServerSession = vi.MockedFunction<typeof getServerSession>;

vi.mock("next-auth/next", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("@/lib/auth/nextauth", () => ({
  authOptions: {},
}));

const mockGetServerSession = getServerSession as MockedGetServerSession;

const baseUrl = "http://localhost:3000";

function uniqueSuffix() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function createUser(overrides: Partial<{ id: string; email: string; name: string }> = {}) {
  const { id, email, name, ...rest } = overrides;
  return db.user.create({
    data: {
      id: id ?? `user-${uniqueSuffix()}`,
      email: email ?? `user-${uniqueSuffix()}@example.com`,
      name: name ?? "Test User",
      ...rest,
    },
  });
}

async function createWorkspace(
  ownerId: string,
  overrides: Partial<{ id: string; name: string; slug: string; description: string }> = {},
) {
  const { id, name, slug, description, ...rest } = overrides;
  return db.workspace.create({
    data: {
      id: id ?? `workspace-${uniqueSuffix()}`,
      name: name ?? `Workspace ${uniqueSuffix()}`,
      slug: slug ?? `workspace-${uniqueSuffix()}`,
      description: description ?? "Test workspace",
      ownerId,
      ...rest,
    },
  });
}

async function addWorkspaceMember(workspaceId: string, userId: string, role = WorkspaceRole.DEVELOPER) {
  return db.workspaceMember.create({
    data: {
      workspaceId,
      userId,
      role,
    },
  });
}

describe("/api/tasks integration tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET /api/tasks", () => {
    test("returns 401 when session is missing", async () => {
      mockGetServerSession.mockResolvedValueOnce(null);

      const request = new NextRequest(
        `${baseUrl}/api/tasks?workspaceId=test-workspace&page=1&limit=1`,
      );

      const response = await GET(request);
      const body = await response.json();

      expect(response.status).toBe(401);
      expect(body).toEqual({ error: "Unauthorized" });
    });

    test("returns 403 when user is not a workspace member", async () => {
      const owner = await createUser({ name: "Owner" });
      const workspace = await createWorkspace(owner.id, { name: "Workspace" });
      const outsider = await createUser({ name: "Outsider" });

      mockGetServerSession.mockResolvedValueOnce({
        user: { id: outsider.id, email: outsider.email ?? "outsider@example.com" },
      });

      const request = new NextRequest(
        `${baseUrl}/api/tasks?workspaceId=${workspace.id}&page=1&limit=5`,
      );

      const response = await GET(request);
      const body = await response.json();

      expect(response.status).toBe(403);
      expect(body).toEqual({ error: "Access denied" });
    });

    test("returns paginated tasks with action artifact metadata", async () => {
      const owner = await createUser({ name: "Owner" });
      const workspace = await createWorkspace(owner.id, { slug: `tasks-${uniqueSuffix()}` });

      mockGetServerSession.mockResolvedValueOnce({
        user: { id: owner.id, email: owner.email ?? "owner@example.com" },
      });

      await db.task.create({
        data: {
          id: `task-${uniqueSuffix()}`,
          title: "Background task",
          workspaceId: workspace.id,
          status: TaskStatus.IN_PROGRESS,
          priority: Priority.LOW,
          workflowStatus: WorkflowStatus.COMPLETED,
          createdById: owner.id,
          updatedById: owner.id,
        },
      });

      const taskWithArtifact = await db.task.create({
        data: {
          id: `task-${uniqueSuffix()}`,
          title: "Primary task",
          workspaceId: workspace.id,
          status: TaskStatus.TODO,
          priority: Priority.MEDIUM,
          workflowStatus: WorkflowStatus.PENDING,
          createdById: owner.id,
          updatedById: owner.id,
        },
      });

      const chatMessage = await db.chatMessage.create({
        data: {
          taskId: taskWithArtifact.id,
          message: "Latest update",
          role: ChatRole.ASSISTANT,
          status: ChatStatus.SENT,
          timestamp: new Date(Date.now() + 1000),
        },
      });

      await db.artifact.create({
        data: {
          messageId: chatMessage.id,
          type: ArtifactType.FORM,
          content: { fields: [] },
        },
      });

      const request = new NextRequest(
        `${baseUrl}/api/tasks?workspaceId=${workspace.id}&includeLatestMessage=true&page=1&limit=1`,
      );

      const response = await GET(request);
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data).toHaveLength(1);
      expect(body.pagination).toEqual({
        page: 1,
        limit: 1,
        totalCount: 2,
        totalPages: 2,
        hasMore: true,
      });
      expect(body.data[0].id).toBe(taskWithArtifact.id);
      expect(body.data[0].hasActionArtifact).toBe(true);
      expect(body.data[0].workflowStatus).toBe(WorkflowStatus.PENDING);
    });

    test("returns 400 for invalid pagination parameters", async () => {
      const owner = await createUser({ name: "Owner" });
      const workspace = await createWorkspace(owner.id);
      await addWorkspaceMember(workspace.id, owner.id, WorkspaceRole.OWNER);

      mockGetServerSession.mockResolvedValueOnce({
        user: { id: owner.id, email: owner.email ?? "owner@example.com" },
      });

      const request = new NextRequest(
        `${baseUrl}/api/tasks?workspaceId=${workspace.id}&page=0&limit=1`,
      );

      const response = await GET(request);
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toContain("Invalid pagination parameters");
    });
  });

  describe("POST /api/tasks", () => {
    test("creates a task with default status and priority", async () => {
      const owner = await createUser({ name: "Owner" });
      const workspace = await createWorkspace(owner.id, { slug: `workspace-${uniqueSuffix()}` });

      mockGetServerSession.mockResolvedValueOnce({
        user: { id: owner.id, email: owner.email ?? "owner@example.com" },
      });

      const requestBody = {
        title: "New integration task",
        workspaceSlug: workspace.slug,
      };

      const request = new NextRequest(`${baseUrl}/api/tasks`, {
        method: "POST",
        body: JSON.stringify(requestBody),
        headers: { "Content-Type": "application/json" },
      });

      const response = await POST(request);
      const body = await response.json();

      expect(response.status).toBe(201);
      expect(body.success).toBe(true);
      expect(body.data.status).toBe(TaskStatus.TODO);
      expect(body.data.priority).toBe(Priority.MEDIUM);
      expect(body.data.workspace.id).toBe(workspace.id);
      expect(body.data.createdBy.id).toBe(owner.id);

      const persistedTask = await db.task.findUnique({
        where: { id: body.data.id },
        include: { workspace: true, createdBy: true },
      });

      expect(persistedTask).not.toBeNull();
      expect(persistedTask?.workspaceId).toBe(workspace.id);
      expect(persistedTask?.createdById).toBe(owner.id);
    });

    test("returns 403 when user is not part of the workspace", async () => {
      const owner = await createUser({ name: "Owner" });
      const workspace = await createWorkspace(owner.id, { slug: `workspace-${uniqueSuffix()}` });
      const outsider = await createUser({ name: "Outsider" });

      mockGetServerSession.mockResolvedValueOnce({
        user: { id: outsider.id, email: outsider.email ?? "outsider@example.com" },
      });

      const request = new NextRequest(`${baseUrl}/api/tasks`, {
        method: "POST",
        body: JSON.stringify({
          title: "Unauthorized task",
          workspaceSlug: workspace.slug,
        }),
        headers: { "Content-Type": "application/json" },
      });

      const response = await POST(request);
      const body = await response.json();

      expect(response.status).toBe(403);
      expect(body).toEqual({ error: "Access denied" });
    });

    test("returns 400 when repository belongs to another workspace", async () => {
      const owner = await createUser({ name: "Owner" });
      const workspace = await createWorkspace(owner.id, { slug: `workspace-${uniqueSuffix()}` });
      const otherWorkspace = await createWorkspace(owner.id, {
        slug: `workspace-${uniqueSuffix()}`,
        name: "Foreign",
      });

      const foreignRepository = await db.repository.create({
        data: {
          name: "Foreign Repository",
          repositoryUrl: `https://github.com/example/${uniqueSuffix()}`,
          workspaceId: otherWorkspace.id,
        },
      });

      mockGetServerSession.mockResolvedValueOnce({
        user: { id: owner.id, email: owner.email ?? "owner@example.com" },
      });

      const request = new NextRequest(`${baseUrl}/api/tasks`, {
        method: "POST",
        body: JSON.stringify({
          title: "Task with foreign repo",
          workspaceSlug: workspace.slug,
          repositoryId: foreignRepository.id,
        }),
        headers: { "Content-Type": "application/json" },
      });

      const response = await POST(request);
      const body = await response.json();

      expect(response.status).toBe(400);
      expect(body.error).toBe(
        "Repository not found or does not belong to this workspace",
      );
    });
  });
});
