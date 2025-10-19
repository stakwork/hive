import { describe, test, expect, beforeEach, vi, afterEach } from "vitest";
import { GET } from "@/app/api/stakwork/workflow/[projectId]/route";
import { db } from "@/lib/db";
import {
  createAuthenticatedSession,
  mockUnauthenticatedSession,
  getMockedSession,
  expectSuccess,
  expectError,
  expectUnauthorized,
  generateUniqueId,
} from "@/__tests__/support/helpers";
import {
  createTestUser,
  createTestWorkspace,
  createTestTask,
} from "@/__tests__/support/fixtures";
import { NextRequest } from "next/server";

// Mock stakwork service factory
const mockGetWorkflowData = vi.fn();

vi.mock("@/lib/service-factory", () => ({
  stakworkService: () => ({
    getWorkflowData: mockGetWorkflowData,
  }),
}));

// Test data factory for creating workflow test setup
async function createWorkflowTestSetup() {
  // Create user
  const user = await createTestUser();

  // Create workspace
  const workspace = await createTestWorkspace({
    name: "Test Workspace",
    ownerId: user.id,
  });

  // Create tasks with different stakworkProjectIds
  const taskWithWorkflow = await createTestTask({
    title: "Task with Workflow",
    description: "Task linked to Stakwork project",
    workspaceId: workspace.id,
    status: "TODO",
    priority: "MEDIUM",
    sourceType: "USER",
    workflowStatus: "IN_PROGRESS",
    stakworkProjectId: 12345,
    createdById: user.id,
  });

  const taskWithoutWorkflow = await createTestTask({
    title: "Task without Workflow",
    description: "Task not linked to Stakwork",
    workspaceId: workspace.id,
    status: "TODO",
    priority: "LOW",
    sourceType: "USER",
    createdById: user.id,
  });

  return { user, workspace, taskWithWorkflow, taskWithoutWorkflow };
}

// Helper to create test request
function createGetRequest(url: string) {
  return new NextRequest(url, {
    method: "GET",
  });
}

// Mock workflow data response
function createMockWorkflowResponse(overrides = {}) {
  return {
    workflowData: {
      transitions: [
        {
          id: "step-1",
          title: "Initial Step",
          status: {
            step_state: "completed",
            workflow_state: "in_progress",
          },
        },
        {
          id: "step-2",
          title: "Processing Step",
          status: {
            step_state: "running",
            workflow_state: "in_progress",
          },
        },
      ],
      connections: [
        {
          source: "step-1",
          target: "step-2",
        },
      ],
      project: {
        workflow_state: "in_progress",
      },
    },
    status: "in_progress",
    ...overrides,
  };
}

describe("GET /api/stakwork/workflow/[projectId] - Integration Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default: Mock successful workflow data retrieval
    mockGetWorkflowData.mockResolvedValue(createMockWorkflowResponse());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Authentication & Authorization", () => {
    test("should return 401 for unauthenticated requests", async () => {
      getMockedSession().mockResolvedValue(mockUnauthenticatedSession());

      const request = createGetRequest(
        "http://localhost:3000/api/stakwork/workflow/12345"
      );
      const params = Promise.resolve({ projectId: "12345" });

      const response = await GET(request, { params });

      await expectUnauthorized(response);
      expect(mockGetWorkflowData).not.toHaveBeenCalled();
    });

    test("should return 401 for invalid user session (missing user object)", async () => {
      getMockedSession().mockResolvedValue({
        expires: new Date(Date.now() + 86400000).toISOString(),
      } as any);

      const request = createGetRequest(
        "http://localhost:3000/api/stakwork/workflow/12345"
      );
      const params = Promise.resolve({ projectId: "12345" });

      const response = await GET(request, { params });

      await expectUnauthorized(response);
      expect(mockGetWorkflowData).not.toHaveBeenCalled();
    });

    test("should allow authenticated users to retrieve workflow data", async () => {
      const { user } = await createWorkflowTestSetup();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createGetRequest(
        "http://localhost:3000/api/stakwork/workflow/12345"
      );
      const params = Promise.resolve({ projectId: "12345" });

      const response = await GET(request, { params });

      expect(response.status).toBe(200);
      expect(mockGetWorkflowData).toHaveBeenCalledWith("12345");
    });
  });

  describe("Request Validation", () => {
    test("should return 400 for missing projectId parameter", async () => {
      const { user } = await createWorkflowTestSetup();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createGetRequest(
        "http://localhost:3000/api/stakwork/workflow/"
      );
      const params = Promise.resolve({ projectId: "" });

      const response = await GET(request, { params });

      await expectError(
        response,
        "Missing required parameter: projectId",
        400
      );
      expect(mockGetWorkflowData).not.toHaveBeenCalled();
    });

    test("should return 400 for undefined projectId", async () => {
      const { user } = await createWorkflowTestSetup();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createGetRequest(
        "http://localhost:3000/api/stakwork/workflow/"
      );
      const params = Promise.resolve({ projectId: undefined as any });

      const response = await GET(request, { params });

      await expectError(
        response,
        "Missing required parameter: projectId",
        400
      );
      expect(mockGetWorkflowData).not.toHaveBeenCalled();
    });

    test("should accept numeric projectId as string", async () => {
      const { user } = await createWorkflowTestSetup();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createGetRequest(
        "http://localhost:3000/api/stakwork/workflow/67890"
      );
      const params = Promise.resolve({ projectId: "67890" });

      const response = await GET(request, { params });

      expect(response.status).toBe(200);
      expect(mockGetWorkflowData).toHaveBeenCalledWith("67890");
    });

    test("should accept alphanumeric projectId", async () => {
      const { user } = await createWorkflowTestSetup();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createGetRequest(
        "http://localhost:3000/api/stakwork/workflow/project-abc-123"
      );
      const params = Promise.resolve({ projectId: "project-abc-123" });

      const response = await GET(request, { params });

      expect(response.status).toBe(200);
      expect(mockGetWorkflowData).toHaveBeenCalledWith("project-abc-123");
    });
  });

  describe("Successful Workflow Data Retrieval", () => {
    test("should return complete workflow data for valid projectId", async () => {
      const { user } = await createWorkflowTestSetup();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const mockData = createMockWorkflowResponse();
      mockGetWorkflowData.mockResolvedValue(mockData);

      const request = createGetRequest(
        "http://localhost:3000/api/stakwork/workflow/12345"
      );
      const params = Promise.resolve({ projectId: "12345" });

      const response = await GET(request, { params });
      const data = await expectSuccess(response, 200);

      expect(data).toEqual(mockData);
      expect(data.workflowData).toHaveProperty("transitions");
      expect(data.workflowData).toHaveProperty("connections");
      expect(data).toHaveProperty("status", "in_progress");
    });

    test("should return workflow data with completed status", async () => {
      const { user } = await createWorkflowTestSetup();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const completedData = createMockWorkflowResponse({
        status: "completed",
        workflowData: {
          transitions: [
            {
              id: "final-step",
              title: "Completed Step",
              status: {
                step_state: "completed",
                workflow_state: "completed",
              },
            },
          ],
          connections: [],
          project: {
            workflow_state: "completed",
          },
        },
      });
      mockGetWorkflowData.mockResolvedValue(completedData);

      const request = createGetRequest(
        "http://localhost:3000/api/stakwork/workflow/99999"
      );
      const params = Promise.resolve({ projectId: "99999" });

      const response = await GET(request, { params });
      const data = await expectSuccess(response, 200);

      expect(data.status).toBe("completed");
      expect(data.workflowData.project.workflow_state).toBe("completed");
    });

    test("should return workflow data with error status", async () => {
      const { user } = await createWorkflowTestSetup();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const errorData = createMockWorkflowResponse({
        status: "failed",
        workflowData: {
          transitions: [
            {
              id: "error-step",
              title: "Failed Step",
              status: {
                step_state: "failed",
                workflow_state: "failed",
              },
              error: "Processing error occurred",
            },
          ],
          connections: [],
          project: {
            workflow_state: "failed",
          },
        },
      });
      mockGetWorkflowData.mockResolvedValue(errorData);

      const request = createGetRequest(
        "http://localhost:3000/api/stakwork/workflow/88888"
      );
      const params = Promise.resolve({ projectId: "88888" });

      const response = await GET(request, { params });
      const data = await expectSuccess(response, 200);

      expect(data.status).toBe("failed");
      expect(data.workflowData.project.workflow_state).toBe("failed");
    });

    test("should handle workflow with empty transitions array", async () => {
      const { user } = await createWorkflowTestSetup();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const emptyWorkflowData = createMockWorkflowResponse({
        workflowData: {
          transitions: [],
          connections: [],
          project: {
            workflow_state: "pending",
          },
        },
        status: "pending",
      });
      mockGetWorkflowData.mockResolvedValue(emptyWorkflowData);

      const request = createGetRequest(
        "http://localhost:3000/api/stakwork/workflow/77777"
      );
      const params = Promise.resolve({ projectId: "77777" });

      const response = await GET(request, { params });
      const data = await expectSuccess(response, 200);

      expect(data.workflowData.transitions).toEqual([]);
      expect(data.status).toBe("pending");
    });
  });

  describe("Error Handling - Stakwork Service Failures", () => {
    test("should return 404 when Stakwork service returns 404 ApiError", async () => {
      const { user } = await createWorkflowTestSetup();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const apiError = {
        message: "Project not found",
        status: 404,
        service: "stakwork",
        details: { projectId: "non-existent" },
      };
      mockGetWorkflowData.mockRejectedValue(apiError);

      const request = createGetRequest(
        "http://localhost:3000/api/stakwork/workflow/non-existent"
      );
      const params = Promise.resolve({ projectId: "non-existent" });

      const response = await GET(request, { params });

      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data).toEqual({
        error: "Project not found",
        service: "stakwork",
        details: { projectId: "non-existent" },
      });
    });

    test("should return 500 when Stakwork service returns 500 ApiError", async () => {
      const { user } = await createWorkflowTestSetup();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const apiError = {
        message: "Internal server error",
        status: 500,
        service: "stakwork",
        details: { reason: "Database connection failed" },
      };
      mockGetWorkflowData.mockRejectedValue(apiError);

      const request = createGetRequest(
        "http://localhost:3000/api/stakwork/workflow/12345"
      );
      const params = Promise.resolve({ projectId: "12345" });

      const response = await GET(request, { params });

      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data).toEqual({
        error: "Internal server error",
        service: "stakwork",
        details: { reason: "Database connection failed" },
      });
    });

    test("should return 503 when Stakwork service is unavailable", async () => {
      const { user } = await createWorkflowTestSetup();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const apiError = {
        message: "Service temporarily unavailable",
        status: 503,
        service: "stakwork",
        details: { reason: "Maintenance in progress" },
      };
      mockGetWorkflowData.mockRejectedValue(apiError);

      const request = createGetRequest(
        "http://localhost:3000/api/stakwork/workflow/12345"
      );
      const params = Promise.resolve({ projectId: "12345" });

      const response = await GET(request, { params });

      expect(response.status).toBe(503);
      const data = await response.json();
      expect(data).toEqual({
        error: "Service temporarily unavailable",
        service: "stakwork",
        details: { reason: "Maintenance in progress" },
      });
    });

    test("should return 500 for generic errors without status", async () => {
      const { user } = await createWorkflowTestSetup();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      mockGetWorkflowData.mockRejectedValue(new Error("Network timeout"));

      const request = createGetRequest(
        "http://localhost:3000/api/stakwork/workflow/12345"
      );
      const params = Promise.resolve({ projectId: "12345" });

      const response = await GET(request, { params });

      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.error).toBe("Failed to fetch workflow data");
    });

    test("should handle null error gracefully", async () => {
      const { user } = await createWorkflowTestSetup();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      mockGetWorkflowData.mockRejectedValue(null);

      const request = createGetRequest(
        "http://localhost:3000/api/stakwork/workflow/12345"
      );
      const params = Promise.resolve({ projectId: "12345" });

      const response = await GET(request, { params });

      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.error).toBe("Failed to fetch workflow data");
    });
  });

  describe("Task-Stakwork Project Linkage Validation", () => {
    test("should retrieve workflow data for task with stakworkProjectId", async () => {
      const { user, taskWithWorkflow } = await createWorkflowTestSetup();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createGetRequest(
        `http://localhost:3000/api/stakwork/workflow/${taskWithWorkflow.stakworkProjectId}`
      );
      const params = Promise.resolve({
        projectId: taskWithWorkflow.stakworkProjectId!.toString(),
      });

      const response = await GET(request, { params });
      const data = await expectSuccess(response, 200);

      expect(data).toHaveProperty("workflowData");
      expect(data).toHaveProperty("status");
      expect(mockGetWorkflowData).toHaveBeenCalledWith(
        taskWithWorkflow.stakworkProjectId!.toString()
      );

      // Verify Task record still exists with stakworkProjectId intact
      const dbTask = await db.task.findUnique({
        where: { id: taskWithWorkflow.id },
      });
      expect(dbTask).toBeDefined();
      expect(dbTask?.stakworkProjectId).toBe(
        taskWithWorkflow.stakworkProjectId
      );
    });

    test("should handle multiple tasks with different stakworkProjectIds", async () => {
      const { user, workspace } = await createWorkflowTestSetup();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      // Create additional tasks with different stakworkProjectIds
      const task1 = await db.task.create({
        data: {
          title: "Task 1",
          workspaceId: workspace.id,
          status: "TODO",
          priority: "HIGH",
          sourceType: "USER",
          stakworkProjectId: 11111,
          workflowStatus: "COMPLETED",
          createdById: user.id,
          updatedById: user.id,
        },
      });

      const task2 = await db.task.create({
        data: {
          title: "Task 2",
          workspaceId: workspace.id,
          status: "IN_PROGRESS",
          priority: "MEDIUM",
          sourceType: "JANITOR",
          stakworkProjectId: 22222,
          workflowStatus: "IN_PROGRESS",
          createdById: user.id,
          updatedById: user.id,
        },
      });

      // Retrieve workflow for task1
      const request1 = createGetRequest(
        `http://localhost:3000/api/stakwork/workflow/${task1.stakworkProjectId}`
      );
      const params1 = Promise.resolve({
        projectId: task1.stakworkProjectId!.toString(),
      });

      const response1 = await GET(request1, { params: params1 });
      await expectSuccess(response1, 200);
      expect(mockGetWorkflowData).toHaveBeenCalledWith("11111");

      // Retrieve workflow for task2
      mockGetWorkflowData.mockClear();
      const request2 = createGetRequest(
        `http://localhost:3000/api/stakwork/workflow/${task2.stakworkProjectId}`
      );
      const params2 = Promise.resolve({
        projectId: task2.stakworkProjectId!.toString(),
      });

      const response2 = await GET(request2, { params: params2 });
      await expectSuccess(response2, 200);
      expect(mockGetWorkflowData).toHaveBeenCalledWith("22222");

      // Verify both tasks still exist with correct stakworkProjectIds
      const dbTask1 = await db.task.findUnique({ where: { id: task1.id } });
      const dbTask2 = await db.task.findUnique({ where: { id: task2.id } });
      expect(dbTask1?.stakworkProjectId).toBe(11111);
      expect(dbTask2?.stakworkProjectId).toBe(22222);
    });

    test("should retrieve workflow data without requiring Task entity existence", async () => {
      // This test verifies that the endpoint is not dependent on Task existence
      // It only needs authentication and valid projectId
      const { user } = await createWorkflowTestSetup();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      // Use a projectId that has no corresponding Task
      const orphanedProjectId = "99999";

      const request = createGetRequest(
        `http://localhost:3000/api/stakwork/workflow/${orphanedProjectId}`
      );
      const params = Promise.resolve({ projectId: orphanedProjectId });

      const response = await GET(request, { params });
      const data = await expectSuccess(response, 200);

      expect(data).toHaveProperty("workflowData");
      expect(mockGetWorkflowData).toHaveBeenCalledWith(orphanedProjectId);

      // Verify no Task exists with this stakworkProjectId
      const dbTask = await db.task.findFirst({
        where: { stakworkProjectId: parseInt(orphanedProjectId) },
      });
      expect(dbTask).toBeNull();
    });

    test("should maintain stakworkProjectId linkage across workflow state changes", async () => {
      const { user, taskWithWorkflow, workspace } =
        await createWorkflowTestSetup();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const projectId = taskWithWorkflow.stakworkProjectId!.toString();

      // Simulate workflow state progression
      const states = [
        { status: "pending", workflowStatus: "PENDING" as const },
        { status: "in_progress", workflowStatus: "IN_PROGRESS" as const },
        { status: "completed", workflowStatus: "COMPLETED" as const },
      ];

      for (const state of states) {
        // Update task workflow status
        await db.task.update({
          where: { id: taskWithWorkflow.id },
          data: { workflowStatus: state.workflowStatus },
        });

        // Mock workflow data for this state
        mockGetWorkflowData.mockResolvedValue(
          createMockWorkflowResponse({ status: state.status })
        );

        // Retrieve workflow data
        const request = createGetRequest(
          `http://localhost:3000/api/stakwork/workflow/${projectId}`
        );
        const params = Promise.resolve({ projectId });

        const response = await GET(request, { params });
        const data = await expectSuccess(response, 200);

        expect(data.status).toBe(state.status);

        // Verify stakworkProjectId remains unchanged
        const dbTask = await db.task.findUnique({
          where: { id: taskWithWorkflow.id },
        });
        expect(dbTask?.stakworkProjectId).toBe(
          taskWithWorkflow.stakworkProjectId
        );
        expect(dbTask?.workflowStatus).toBe(state.workflowStatus);
      }
    });
  });

  describe("Workflow Data Structure Validation", () => {
    test("should return workflow data with all expected fields", async () => {
      const { user } = await createWorkflowTestSetup();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const completeWorkflowData = {
        workflowData: {
          transitions: [
            {
              id: "step-1",
              unique_id: "unique-step-1",
              display_id: "display-step-1",
              display_name: "First Step",
              name: "first_step",
              title: "First Step",
              skill: { type: "automated" as const },
              position: { x: 100, y: 100 },
              connections: {},
              step: { attributes: {}, params: {} },
              status: {
                step_state: "completed",
                workflow_state: "in_progress",
                job_statuses: [],
              },
            },
          ],
          connections: [
            {
              source: "step-1",
              target: "step-2",
            },
          ],
          project: {
            workflow_state: "in_progress",
            id: 12345,
            name: "Test Workflow",
          },
        },
        status: "in_progress",
      };
      mockGetWorkflowData.mockResolvedValue(completeWorkflowData);

      const request = createGetRequest(
        "http://localhost:3000/api/stakwork/workflow/12345"
      );
      const params = Promise.resolve({ projectId: "12345" });

      const response = await GET(request, { params });
      const data = await expectSuccess(response, 200);

      expect(data.workflowData).toHaveProperty("transitions");
      expect(data.workflowData).toHaveProperty("connections");
      expect(data.workflowData).toHaveProperty("project");
      expect(data.workflowData.transitions[0]).toHaveProperty("id");
      expect(data.workflowData.transitions[0]).toHaveProperty("title");
      expect(data.workflowData.transitions[0]).toHaveProperty("status");
    });

    test("should handle workflow data with complex nested structures", async () => {
      const { user } = await createWorkflowTestSetup();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const complexWorkflowData = {
        workflowData: {
          transitions: [
            {
              id: "complex-step",
              title: "Complex Step",
              step: {
                attributes: {
                  nested: {
                    deeply: {
                      value: "test",
                    },
                  },
                },
                params: {
                  array: [1, 2, 3],
                  object: { key: "value" },
                },
              },
              status: {
                step_state: "running",
                workflow_state: "in_progress",
                job_statuses: [
                  { job_id: "job1", status: "completed" },
                  { job_id: "job2", status: "running" },
                ],
              },
              output: {
                results: ["result1", "result2"],
                metadata: { processed: true },
              },
            },
          ],
          connections: [],
          project: {
            workflow_state: "in_progress",
          },
        },
        status: "in_progress",
      };
      mockGetWorkflowData.mockResolvedValue(complexWorkflowData);

      const request = createGetRequest(
        "http://localhost:3000/api/stakwork/workflow/12345"
      );
      const params = Promise.resolve({ projectId: "12345" });

      const response = await GET(request, { params });
      const data = await expectSuccess(response, 200);

      expect(data.workflowData.transitions[0].step.attributes.nested.deeply.value).toBe("test");
      expect(data.workflowData.transitions[0].output.results).toEqual([
        "result1",
        "result2",
      ]);
    });
  });

  describe("Edge Cases", () => {
    test("should handle very large projectId values", async () => {
      const { user } = await createWorkflowTestSetup();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const largeProjectId = "999999999999999";

      const request = createGetRequest(
        `http://localhost:3000/api/stakwork/workflow/${largeProjectId}`
      );
      const params = Promise.resolve({ projectId: largeProjectId });

      const response = await GET(request, { params });

      expect(response.status).toBe(200);
      expect(mockGetWorkflowData).toHaveBeenCalledWith(largeProjectId);
    });

    test("should handle projectId with special characters", async () => {
      const { user } = await createWorkflowTestSetup();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const specialProjectId = "project-id-with-dashes_and_underscores.123";

      const request = createGetRequest(
        `http://localhost:3000/api/stakwork/workflow/${specialProjectId}`
      );
      const params = Promise.resolve({ projectId: specialProjectId });

      const response = await GET(request, { params });

      expect(response.status).toBe(200);
      expect(mockGetWorkflowData).toHaveBeenCalledWith(specialProjectId);
    });

    test("should handle concurrent requests for same projectId", async () => {
      const { user } = await createWorkflowTestSetup();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const projectId = "12345";
      const requests = Array.from({ length: 5 }, () =>
        GET(
          createGetRequest(
            `http://localhost:3000/api/stakwork/workflow/${projectId}`
          ),
          { params: Promise.resolve({ projectId }) }
        )
      );

      const responses = await Promise.all(requests);

      responses.forEach((response) => {
        expect(response.status).toBe(200);
      });
      expect(mockGetWorkflowData).toHaveBeenCalledTimes(5);
    });

    test("should handle concurrent requests for different projectIds", async () => {
      const { user } = await createWorkflowTestSetup();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const projectIds = ["11111", "22222", "33333", "44444", "55555"];
      const requests = projectIds.map((projectId) =>
        GET(
          createGetRequest(
            `http://localhost:3000/api/stakwork/workflow/${projectId}`
          ),
          { params: Promise.resolve({ projectId }) }
        )
      );

      const responses = await Promise.all(requests);

      responses.forEach((response) => {
        expect(response.status).toBe(200);
      });
      projectIds.forEach((projectId) => {
        expect(mockGetWorkflowData).toHaveBeenCalledWith(projectId);
      });
    });
  });
});