import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { POST } from "@/app/api/project-debugger/route";
import { db } from "@/lib/db";
import { WorkflowStatus } from "@prisma/client";
import {
  createAuthenticatedSession,
  mockUnauthenticatedSession,
  getMockedSession,
  expectSuccess,
  expectError,
  expectUnauthorized,
  expectForbidden,
  expectNotFound,
  createPostRequest,
} from "@/__tests__/support/helpers";
import { createTestUser, createTestTask } from "@/__tests__/support/fixtures";

// Mock external dependencies at module level
vi.mock("@/lib/auth/nextauth", () => ({
  authOptions: {},
  getGithubUsernameAndPAT: vi.fn(),
}));

vi.mock("@/config/env", () => ({
  config: {
    STAKWORK_API_KEY: "test-stakwork-key",
    STAKWORK_BASE_URL: "https://stakwork.example.com",
    STAKWORK_WORKFLOW_PROJECT_DEBUGGER_ID: "456",
  },
}));

// Mock global fetch for Stakwork API calls
global.fetch = vi.fn();

// Mock Pusher for real-time notifications
vi.mock("@/lib/pusher", () => ({
  pusherServer: {
    trigger: vi.fn().mockResolvedValue({}),
  },
  getTaskChannelName: vi.fn((taskId: string) => `task-${taskId}`),
  PUSHER_EVENTS: {
    NEW_MESSAGE: "new-message",
    WORKFLOW_STATUS_UPDATE: "workflow-status-update",
  },
}));

vi.mock("@/lib/vercel/stakwork-token", () => ({
  getStakworkTokenReference: vi.fn().mockReturnValue("test-token-reference"),
}));

import { getGithubUsernameAndPAT } from "@/lib/auth/nextauth";

const mockGetGithubUsernameAndPAT = vi.mocked(getGithubUsernameAndPAT);
const mockFetch = global.fetch as vi.MockedFunction<typeof global.fetch>;

// Sample project data returned by Stakwork API
const mockProjectData = {
  id: 99,
  name: "Test Project",
  workflow_state: "pending",
  workflow_id: 123,
  created_at: "2024-01-01T00:00:00Z",
  updated_at: "2024-01-01T00:00:00Z",
  current_transition: null,
  project_configs: {},
};

describe("POST /api/project-debugger Integration Tests", () => {
  async function createTestDataWithStakworkWorkspace() {
    return await db.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: `test-pd-${Date.now()}@example.com`,
          name: "Test User",
        },
      });

      const workspace = await tx.workspace.create({
        data: {
          name: "Stakwork Workspace",
          slug: "stakwork",
          ownerId: user.id,
        },
      });

      const task = await tx.task.create({
        data: {
          workspaceId: workspace.id,
          title: "Debug Task",
          status: "TODO",
          priority: "MEDIUM",
          order: 1,
          createdById: user.id,
          updatedById: user.id,
        },
      });

      return { user, workspace, task };
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockClear();

    mockGetGithubUsernameAndPAT.mockResolvedValue({
      username: "testuser",
      token: "ghp_test_token",
    });

    // Default: project fetch succeeds, then Stakwork API succeeds
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: { project: mockProjectData } }),
        statusText: "OK",
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ success: true, data: { project_id: 12345 } }),
        statusText: "OK",
      } as Response);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Authentication Tests", () => {
    test("returns 401 when user not authenticated", async () => {
      getMockedSession().mockResolvedValue(mockUnauthenticatedSession());

      const request = createPostRequest("http://localhost:3000/api/project-debugger", {
        taskId: "task-id",
        message: "Debug this",
        projectId: "123",
      });

      const response = await POST(request);
      await expectUnauthorized(response);
    });

    test("returns 401 when user session has no id", async () => {
      getMockedSession().mockResolvedValue({
        user: { email: "test@example.com", name: "Test User" },
      } as any);

      const request = createPostRequest("http://localhost:3000/api/project-debugger", {
        taskId: "task-id",
        message: "Debug this",
        projectId: "123",
      });

      const response = await POST(request);
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "Unauthorized" });
    });
  });

  describe("Field Validation Tests", () => {
    test("returns 400 when required fields are missing", async () => {
      const { user } = await createTestDataWithStakworkWorkspace();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createPostRequest("http://localhost:3000/api/project-debugger", {
        taskId: "task-id",
        // message and projectId missing
      });

      const response = await POST(request);
      await expectError(response, "Missing required fields: taskId, message, projectId", 400);
    });
  });

  describe("Authorization Tests", () => {
    test("returns 404 when task not found", async () => {
      const { user } = await createTestDataWithStakworkWorkspace();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createPostRequest("http://localhost:3000/api/project-debugger", {
        taskId: "non-existent-task-id",
        message: "Debug this",
        projectId: "123",
      });

      const response = await POST(request);
      await expectNotFound(response, "Task not found");
    });

    test("returns 403 when user is not workspace owner or member", async () => {
      const { task } = await createTestDataWithStakworkWorkspace();
      const unauthorizedUser = await createTestUser({ name: "Unauthorized User" });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(unauthorizedUser));

      const request = createPostRequest("http://localhost:3000/api/project-debugger", {
        taskId: task.id,
        message: "Debug this",
        projectId: "123",
      });

      const response = await POST(request);
      await expectForbidden(response);
    });
  });

  describe("Workflow Guard Tests", () => {
    test("returns 400 when task workflow is IN_PROGRESS", async () => {
      const { user, workspace } = await createTestDataWithStakworkWorkspace();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const task = await createTestTask({
        workspaceId: workspace.id,
        createdById: user.id,
        workflowStatus: WorkflowStatus.IN_PROGRESS,
      });

      const request = createPostRequest("http://localhost:3000/api/project-debugger", {
        taskId: task.id,
        message: "Debug this",
        projectId: "123",
      });

      const response = await POST(request);
      await expectError(response, "A workflow is already in progress for this task", 400);

      // No chatMessage should be created and no Stakwork API calls
      const messages = await db.chatMessage.findMany({ where: { taskId: task.id } });
      expect(messages).toHaveLength(0);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    test("allows request when task workflow is PENDING", async () => {
      const { user, workspace } = await createTestDataWithStakworkWorkspace();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const task = await createTestTask({
        workspaceId: workspace.id,
        createdById: user.id,
        workflowStatus: "PENDING",
      });

      const request = createPostRequest("http://localhost:3000/api/project-debugger", {
        taskId: task.id,
        message: "Debug this",
        projectId: "123",
      });

      const response = await POST(request);
      const data = await expectSuccess(response, 201);

      expect(data.success).toBe(true);
    });

    test("allows request when task workflow status is null", async () => {
      const { user, task } = await createTestDataWithStakworkWorkspace();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createPostRequest("http://localhost:3000/api/project-debugger", {
        taskId: task.id,
        message: "Debug this",
        projectId: "123",
      });

      const response = await POST(request);
      const data = await expectSuccess(response, 201);

      expect(data.success).toBe(true);
    });
  });

  describe("Successful Request Tests", () => {
    test("creates chat message and triggers workflow on success", async () => {
      const { user, task } = await createTestDataWithStakworkWorkspace();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createPostRequest("http://localhost:3000/api/project-debugger", {
        taskId: task.id,
        message: "Debug project 123",
        projectId: "123",
      });

      const response = await POST(request);
      const data = await expectSuccess(response, 201);

      expect(data.success).toBe(true);
      expect(data.message).toBeDefined();
      expect(data.project).toBeDefined();

      // Verify chat message created
      const messages = await db.chatMessage.findMany({ where: { taskId: task.id } });
      expect(messages.length).toBeGreaterThan(0);

      // Verify task workflow status updated
      const updatedTask = await db.task.findUnique({ where: { id: task.id } });
      expect(updatedTask?.workflowStatus).toBe(WorkflowStatus.IN_PROGRESS);
    });
  });
});
