import { describe, test, expect, beforeEach, vi, afterEach } from "vitest";
import { GET } from "@/app/api/stakwork/workflow/[projectId]/route";
import { db } from "@/lib/db";
import { WorkflowStatus } from "@prisma/client";
import {
  createAuthenticatedSession,
  mockUnauthenticatedSession,
  getMockedSession,
  expectSuccess,
  expectError,
  expectUnauthorized,
  generateUniqueId,
  generateUniqueSlug,
} from "@/__tests__/support/helpers";
import { createTestUser } from "@/__tests__/support/fixtures/user";
import { createTestWorkspace } from "@/__tests__/support/fixtures/workspace";
import { createTestTask } from "@/__tests__/support/fixtures/task";

// Mock environment configuration
vi.mock("@/lib/env", () => ({
  config: {
    STAKWORK_API_KEY: "test-stakwork-api-key",
    STAKWORK_BASE_URL: "https://api.stakwork.com/api/v1",
  },
}));

// Helper to create GET request with projectId parameter
function createGetRequestWithProjectId(projectId: string) {
  const url = `http://localhost:3000/api/stakwork/workflow/${projectId}`;
  return new Request(url, {
    method: "GET",
  });
}

// Mock Stakwork API response factory
function createMockStakworkWorkflowResponse(overrides = {}) {
  return {
    success: true,
    data: {
      transitions: [
        {
          id: "trans-1",
          title: "Analyze Requirements",
          status: "completed",
          position: { x: 100, y: 100 },
        },
        {
          id: "trans-2",
          title: "Generate Tests",
          status: "in_progress",
          position: { x: 300, y: 100 },
        },
      ],
      connections: [
        { from: "trans-1", to: "trans-2" },
      ],
      project: {
        workflow_state: "in_progress",
        id: 12345,
        name: "Test Workflow",
        created_at: "2024-01-01T00:00:00Z",
      },
      ...overrides,
    },
  };
}

describe("GET /api/stakwork/workflow/[projectId] - Integration Tests", () => {
  let fetchSpy: any;

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock successful Stakwork API response by default
    fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      json: async () => createMockStakworkWorkflowResponse(),
      statusText: "OK",
    } as Response);
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    vi.restoreAllMocks();
  });

  describe("Authentication & Authorization", () => {
    test("should return 401 for unauthenticated requests", async () => {
      getMockedSession().mockResolvedValue(mockUnauthenticatedSession());

      const request = createGetRequestWithProjectId("12345");
      const response = await GET(request, {
        params: Promise.resolve({ projectId: "12345" }),
      });

      await expectUnauthorized(response);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    test("should return 401 for invalid user session (missing user)", async () => {
      getMockedSession().mockResolvedValue({
        expires: new Date(Date.now() + 86400000).toISOString(),
      });

      const request = createGetRequestWithProjectId("12345");
      const response = await GET(request, {
        params: Promise.resolve({ projectId: "12345" }),
      });

      await expectUnauthorized(response);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    test("should allow authenticated user to access workflow data", async () => {
      const user = await createTestUser();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createGetRequestWithProjectId("12345");
      const response = await GET(request, {
        params: Promise.resolve({ projectId: "12345" }),
      });

      expect(response.status).toBe(200);
      expect(fetchSpy).toHaveBeenCalled();
    });
  });

  describe("Parameter Validation", () => {
    test("should return 400 when projectId is missing", async () => {
      const user = await createTestUser();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createGetRequestWithProjectId("");
      const response = await GET(request, {
        params: Promise.resolve({ projectId: "" }),
      });

      await expectError(response, "Missing required parameter: projectId", 400);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    test("should accept valid projectId parameter", async () => {
      const user = await createTestUser();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const projectId = "67890";
      const request = createGetRequestWithProjectId(projectId);
      const response = await GET(request, {
        params: Promise.resolve({ projectId }),
      });

      expect(response.status).toBe(200);
      
      // Verify Stakwork API was called with correct projectId
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining(`/projects/${projectId}.json`),
        expect.any(Object)
      );
    });
  });

  describe("Successful Workflow Data Retrieval", () => {
    test("should successfully retrieve workflow data from Stakwork API", async () => {
      const user = await createTestUser();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const projectId = "12345";
      const mockWorkflowData = createMockStakworkWorkflowResponse({
        project: {
          workflow_state: "completed",
          id: 12345,
          name: "Integration Test Workflow",
        },
      });

      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => mockWorkflowData,
      } as Response);

      const request = createGetRequestWithProjectId(projectId);
      const response = await GET(request, {
        params: Promise.resolve({ projectId }),
      });

      const data = await expectSuccess(response, 200);

      // Verify response structure
      expect(data).toHaveProperty("workflowData");
      expect(data).toHaveProperty("status");
      expect(data.workflowData).toEqual(mockWorkflowData.data);
      expect(data.status).toBe("completed");
    });

    test("should return workflow data with transitions and connections", async () => {
      const user = await createTestUser();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const projectId = "99999";
      const request = createGetRequestWithProjectId(projectId);
      const response = await GET(request, {
        params: Promise.resolve({ projectId }),
      });

      const data = await expectSuccess(response, 200);

      // Verify workflow structure
      expect(data.workflowData).toHaveProperty("transitions");
      expect(data.workflowData).toHaveProperty("connections");
      expect(data.workflowData).toHaveProperty("project");
      expect(Array.isArray(data.workflowData.transitions)).toBe(true);
      expect(Array.isArray(data.workflowData.connections)).toBe(true);
    });

    test("should include Stakwork API authorization header", async () => {
      const user = await createTestUser();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const projectId = "12345";
      const request = createGetRequestWithProjectId(projectId);
      await GET(request, {
        params: Promise.resolve({ projectId }),
      });

      // Verify authorization header was included
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: expect.stringContaining("Token token="),
          }),
        })
      );
    });
  });

  describe("Workflow State Transitions", () => {
    test("should retrieve workflow in PENDING state", async () => {
      const user = await createTestUser();
      const workspace = await createTestWorkspace({ ownerId: user.id });
      const task = await createTestTask({
        workspaceId: workspace.id,
        createdById: user.id,
        status: "TODO",
      });

      // Update task with stakworkProjectId and PENDING status
      await db.task.update({
        where: { id: task.id },
        data: {
          stakworkProjectId: 11111,
          workflowStatus: WorkflowStatus.PENDING,
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => createMockStakworkWorkflowResponse({
          project: { workflow_state: "pending" },
        }),
      } as Response);

      const request = createGetRequestWithProjectId("11111");
      const response = await GET(request, {
        params: Promise.resolve({ projectId: "11111" }),
      });

      const data = await expectSuccess(response, 200);
      expect(data.status).toBe("pending");

      // Verify task workflow status in database
      const updatedTask = await db.task.findUnique({
        where: { id: task.id },
      });
      expect(updatedTask?.workflowStatus).toBe(WorkflowStatus.PENDING);
    });

    test("should retrieve workflow in IN_PROGRESS state", async () => {
      const user = await createTestUser();
      const workspace = await createTestWorkspace({ ownerId: user.id });
      const task = await createTestTask({
        workspaceId: workspace.id,
        createdById: user.id,
        status: "IN_PROGRESS",
      });

      await db.task.update({
        where: { id: task.id },
        data: {
          stakworkProjectId: 22222,
          workflowStatus: WorkflowStatus.IN_PROGRESS,
          workflowStartedAt: new Date(),
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => createMockStakworkWorkflowResponse({
          project: { workflow_state: "in_progress" },
        }),
      } as Response);

      const request = createGetRequestWithProjectId("22222");
      const response = await GET(request, {
        params: Promise.resolve({ projectId: "22222" }),
      });

      const data = await expectSuccess(response, 200);
      expect(data.status).toBe("in_progress");

      // Verify task has workflowStartedAt timestamp
      const updatedTask = await db.task.findUnique({
        where: { id: task.id },
      });
      expect(updatedTask?.workflowStatus).toBe(WorkflowStatus.IN_PROGRESS);
      expect(updatedTask?.workflowStartedAt).toBeTruthy();
    });

    test("should retrieve workflow in COMPLETED state", async () => {
      const user = await createTestUser();
      const workspace = await createTestWorkspace({ ownerId: user.id });
      const task = await createTestTask({
        workspaceId: workspace.id,
        createdById: user.id,
        status: "DONE",
      });

      await db.task.update({
        where: { id: task.id },
        data: {
          stakworkProjectId: 33333,
          workflowStatus: WorkflowStatus.COMPLETED,
          workflowStartedAt: new Date(Date.now() - 3600000),
          workflowCompletedAt: new Date(),
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => createMockStakworkWorkflowResponse({
          project: { workflow_state: "completed" },
        }),
      } as Response);

      const request = createGetRequestWithProjectId("33333");
      const response = await GET(request, {
        params: Promise.resolve({ projectId: "33333" }),
      });

      const data = await expectSuccess(response, 200);
      expect(data.status).toBe("completed");

      // Verify task has completion timestamp
      const updatedTask = await db.task.findUnique({
        where: { id: task.id },
      });
      expect(updatedTask?.workflowStatus).toBe(WorkflowStatus.COMPLETED);
      expect(updatedTask?.workflowCompletedAt).toBeTruthy();
    });

    test("should retrieve workflow in FAILED state", async () => {
      const user = await createTestUser();
      const workspace = await createTestWorkspace({ ownerId: user.id });
      const task = await createTestTask({
        workspaceId: workspace.id,
        createdById: user.id,
        status: "CANCELLED",
      });

      await db.task.update({
        where: { id: task.id },
        data: {
          stakworkProjectId: 44444,
          workflowStatus: WorkflowStatus.FAILED,
          workflowCompletedAt: new Date(),
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => createMockStakworkWorkflowResponse({
          project: { workflow_state: "failed" },
        }),
      } as Response);

      const request = createGetRequestWithProjectId("44444");
      const response = await GET(request, {
        params: Promise.resolve({ projectId: "44444" }),
      });

      const data = await expectSuccess(response, 200);
      expect(data.status).toBe("failed");

      const updatedTask = await db.task.findUnique({
        where: { id: task.id },
      });
      expect(updatedTask?.workflowStatus).toBe(WorkflowStatus.FAILED);
    });
  });

  describe("Error Handling", () => {
    test("should handle Stakwork API 404 error", async () => {
      const user = await createTestUser();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      fetchSpy.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: "Not Found",
        json: async () => ({ error: "Project not found" }),
      } as Response);

      const request = createGetRequestWithProjectId("99999");
      const response = await GET(request, {
        params: Promise.resolve({ projectId: "99999" }),
      });

      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data).toHaveProperty("error");
    });

    test("should handle Stakwork API 500 error", async () => {
      const user = await createTestUser();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      fetchSpy.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        json: async () => ({ error: "Server error" }),
      } as Response);

      const request = createGetRequestWithProjectId("12345");
      const response = await GET(request, {
        params: Promise.resolve({ projectId: "12345" }),
      });

      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data).toHaveProperty("error");
    });

    test("should handle network errors to Stakwork API", async () => {
      const user = await createTestUser();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      fetchSpy.mockRejectedValueOnce(new Error("Network error"));

      const request = createGetRequestWithProjectId("12345");
      const response = await GET(request, {
        params: Promise.resolve({ projectId: "12345" }),
      });

      expect(response.status).toBe(500);
      const data = await response.json();
      // The error gets wrapped by BaseServiceClass with service context
      expect(data.error).toContain("Network error");
      expect(data.service).toBe("stakwork");
    });

    test("should handle ApiError with service details", async () => {
      const user = await createTestUser();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      // Mock an ApiError response
      const apiError = {
        status: 503,
        message: "Service Unavailable",
        service: "stakwork",
        details: "External API temporarily unavailable",
      };

      fetchSpy.mockRejectedValueOnce(apiError);

      const request = createGetRequestWithProjectId("12345");
      const response = await GET(request, {
        params: Promise.resolve({ projectId: "12345" }),
      });

      // The endpoint should catch and handle ApiError
      expect(response.status).toBeGreaterThanOrEqual(400);
    });
  });

  describe("Integration with Related Services", () => {
    test("should support workflow data retrieval for task with stakworkProjectId", async () => {
      const user = await createTestUser();
      const workspace = await createTestWorkspace({ ownerId: user.id });
      const task = await createTestTask({
        workspaceId: workspace.id,
        createdById: user.id,
      });

      const stakworkProjectId = 55555;
      await db.task.update({
        where: { id: task.id },
        data: {
          stakworkProjectId,
          workflowStatus: WorkflowStatus.IN_PROGRESS,
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createGetRequestWithProjectId(stakworkProjectId.toString());
      const response = await GET(request, {
        params: Promise.resolve({ projectId: stakworkProjectId.toString() }),
      });

      const data = await expectSuccess(response, 200);
      expect(data.workflowData).toBeDefined();

      // Verify task exists with correct stakworkProjectId
      const dbTask = await db.task.findFirst({
        where: { stakworkProjectId },
      });
      expect(dbTask).toBeTruthy();
      expect(dbTask?.id).toBe(task.id);
    });

    test("should retrieve workflow data compatible with webhook status updates", async () => {
      const user = await createTestUser();
      const workspace = await createTestWorkspace({ ownerId: user.id });
      const task = await createTestTask({
        workspaceId: workspace.id,
        createdById: user.id,
      });

      const stakworkProjectId = 66666;
      await db.task.update({
        where: { id: task.id },
        data: {
          stakworkProjectId,
          workflowStatus: WorkflowStatus.PENDING,
        },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => createMockStakworkWorkflowResponse({
          project: {
            workflow_state: "in_progress",
            id: stakworkProjectId,
          },
        }),
      } as Response);

      const request = createGetRequestWithProjectId(stakworkProjectId.toString());
      const response = await GET(request, {
        params: Promise.resolve({ projectId: stakworkProjectId.toString() }),
      });

      const data = await expectSuccess(response, 200);

      // Verify workflow state from API matches expected format for webhook
      expect(data.status).toBe("in_progress");
      expect(data.workflowData.project.id).toBe(stakworkProjectId);

      // Simulate webhook would update this task's status based on project_id
      const taskToUpdate = await db.task.findFirst({
        where: { stakworkProjectId },
      });
      expect(taskToUpdate?.id).toBe(task.id);
    });

    test("should handle workflow data for multiple tasks with different projects", async () => {
      const user = await createTestUser();
      const workspace = await createTestWorkspace({ ownerId: user.id });

      // Create multiple tasks with different stakworkProjectIds
      const task1 = await createTestTask({
        workspaceId: workspace.id,
        createdById: user.id,
        title: "Task 1",
      });
      const task2 = await createTestTask({
        workspaceId: workspace.id,
        createdById: user.id,
        title: "Task 2",
      });

      await db.task.update({
        where: { id: task1.id },
        data: { stakworkProjectId: 77777, workflowStatus: WorkflowStatus.IN_PROGRESS },
      });

      await db.task.update({
        where: { id: task2.id },
        data: { stakworkProjectId: 88888, workflowStatus: WorkflowStatus.COMPLETED },
      });

      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      // Retrieve workflow data for first project
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => createMockStakworkWorkflowResponse({
          project: { workflow_state: "in_progress", id: 77777 },
        }),
      } as Response);

      const request1 = createGetRequestWithProjectId("77777");
      const response1 = await GET(request1, {
        params: Promise.resolve({ projectId: "77777" }),
      });

      const data1 = await expectSuccess(response1, 200);
      expect(data1.status).toBe("in_progress");

      // Retrieve workflow data for second project
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => createMockStakworkWorkflowResponse({
          project: { workflow_state: "completed", id: 88888 },
        }),
      } as Response);

      const request2 = createGetRequestWithProjectId("88888");
      const response2 = await GET(request2, {
        params: Promise.resolve({ projectId: "88888" }),
      });

      const data2 = await expectSuccess(response2, 200);
      expect(data2.status).toBe("completed");

      // Verify both tasks exist with correct project IDs
      const tasks = await db.task.findMany({
        where: {
          stakworkProjectId: { in: [77777, 88888] },
        },
      });
      expect(tasks).toHaveLength(2);
    });
  });

  describe("Data Format Validation", () => {
    test("should return workflow data in expected format", async () => {
      const user = await createTestUser();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createGetRequestWithProjectId("12345");
      const response = await GET(request, {
        params: Promise.resolve({ projectId: "12345" }),
      });

      const data = await expectSuccess(response, 200);

      // Verify response structure
      expect(data).toMatchObject({
        workflowData: expect.objectContaining({
          transitions: expect.any(Array),
          connections: expect.any(Array),
          project: expect.objectContaining({
            workflow_state: expect.any(String),
          }),
        }),
        status: expect.any(String),
      });
    });

    test("should handle empty transitions array", async () => {
      const user = await createTestUser();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => createMockStakworkWorkflowResponse({
          transitions: [],
          connections: [],
        }),
      } as Response);

      const request = createGetRequestWithProjectId("12345");
      const response = await GET(request, {
        params: Promise.resolve({ projectId: "12345" }),
      });

      const data = await expectSuccess(response, 200);
      expect(data.workflowData.transitions).toEqual([]);
      expect(data.workflowData.connections).toEqual([]);
    });

    test("should preserve workflow metadata from Stakwork API", async () => {
      const user = await createTestUser();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const customMetadata = {
        project: {
          workflow_state: "in_progress",
          id: 12345,
          name: "Custom Workflow Name",
          created_at: "2024-01-01T00:00:00Z",
          updated_at: "2024-01-02T00:00:00Z",
          metadata: { custom_field: "custom_value" },
        },
      };

      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => createMockStakworkWorkflowResponse(customMetadata),
      } as Response);

      const request = createGetRequestWithProjectId("12345");
      const response = await GET(request, {
        params: Promise.resolve({ projectId: "12345" }),
      });

      const data = await expectSuccess(response, 200);
      expect(data.workflowData.project).toMatchObject(customMetadata.project);
    });
  });
});