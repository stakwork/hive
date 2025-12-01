import { describe, test, expect, beforeEach, vi, afterEach } from "vitest";
import { GET } from "@/app/api/stakwork/workflow/[projectId]/route";
import {
  createAuthenticatedSession,
  mockUnauthenticatedSession,
  getMockedSession,
  createGetRequest,
  expectSuccess,
  expectError,
  expectUnauthorized,
} from "@/__tests__/support/helpers";
import { createTestUser } from "@/__tests__/support/fixtures/user";
import {
  createDefaultMockWorkflowResponse,
  createMockWorkflowResponse,
  createEmptyWorkflowResponse,
  createStakworkApiError,
} from "@/__tests__/support/helpers/stakwork-workflow-helpers";

// Mock config
vi.mock("@/config/env", () => ({
  config: {
    STAKWORK_API_KEY: "test-stakwork-api-key",
    STAKWORK_BASE_URL: "https://api.stakwork.com/api/v1",
  },
  optionalEnvVars: {
    STAKWORK_BASE_URL: "https://api.stakwork.com/api/v1",
    POOL_MANAGER_BASE_URL: "https://workspaces.sphinx.chat/api",
    API_TIMEOUT: 10000,
  },
}));

describe("GET /api/stakwork/workflow/[projectId] - Integration Tests", () => {
  let fetchSpy: any;

  beforeEach(() => {
    vi.clearAllMocks();
    
    // Mock successful Stakwork API response with default data
    fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(createDefaultMockWorkflowResponse());

    process.env.STAKWORK_API_KEY = "test-stakwork-api-key";
    process.env.STAKWORK_BASE_URL = "https://api.stakwork.com/api/v1";
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    vi.restoreAllMocks();
  });

  describe("Authentication & Authorization", () => {
    test("should return 401 for unauthenticated requests", async () => {
      getMockedSession().mockResolvedValue(mockUnauthenticatedSession());

      const request = createGetRequest("http://localhost:3000/api/stakwork/workflow/123");
      
      const response = await GET(request, {
        params: Promise.resolve({ projectId: "123" }),
      });

      await expectUnauthorized(response);
    });

    test("should return 401 for invalid user session (missing user)", async () => {
      getMockedSession().mockResolvedValue({
        expires: new Date(Date.now() + 86400000).toISOString(),
      });

      const request = createGetRequest("http://localhost:3000/api/stakwork/workflow/123");
      
      const response = await GET(request, {
        params: Promise.resolve({ projectId: "123" }),
      });

      await expectUnauthorized(response);
    });

    test("should allow any authenticated user to access workflow data (no workspace authorization)", async () => {
      // NOTE: This test documents a security gap - the endpoint only validates session authentication
      // but does NOT enforce workspace or project-level authorization. Any authenticated user
      // can access workflow data for any projectId.
      const user = await createTestUser();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createGetRequest("http://localhost:3000/api/stakwork/workflow/12345");
      
      const response = await GET(request, {
        params: Promise.resolve({ projectId: "12345" }),
      });

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toHaveProperty("workflowData");
      expect(data).toHaveProperty("status");
    });
  });

  describe("Request Validation", () => {
    test("should return 400 for missing projectId parameter", async () => {
      const user = await createTestUser();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createGetRequest("http://localhost:3000/api/stakwork/workflow/");
      
      const response = await GET(request, {
        params: Promise.resolve({ projectId: "" }),
      });

      await expectError(response, "Missing required parameter: projectId", 400);
    });
  });

  describe("Workflow Data Retrieval", () => {
    test("should successfully retrieve workflow data for valid projectId", async () => {
      const user = await createTestUser();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createGetRequest("http://localhost:3000/api/stakwork/workflow/12345");
      
      const response = await GET(request, {
        params: Promise.resolve({ projectId: "12345" }),
      });

      const data = await expectSuccess(response, 200);

      // Verify response structure matches WorkflowData interface
      expect(data).toHaveProperty("workflowData");
      expect(data).toHaveProperty("status");
      expect(data.status).toBe("in_progress");
      
      // Verify workflowData contains expected fields
      expect(data.workflowData).toHaveProperty("transitions");
      expect(data.workflowData).toHaveProperty("connections");
      expect(data.workflowData).toHaveProperty("project");
      expect(Array.isArray(data.workflowData.transitions)).toBe(true);
      expect(Array.isArray(data.workflowData.connections)).toBe(true);
    });

    test("should call Stakwork API with correct projectId", async () => {
      const user = await createTestUser();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const testProjectId = "98765";
      const request = createGetRequest(`http://localhost:3000/api/stakwork/workflow/${testProjectId}`);
      
      await GET(request, {
        params: Promise.resolve({ projectId: testProjectId }),
      });

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url] = fetchSpy.mock.calls[0];
      expect(url).toContain(`/projects/${testProjectId}.json`);
    });

    test("should include authentication headers in Stakwork API request", async () => {
      const user = await createTestUser();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const request = createGetRequest("http://localhost:3000/api/stakwork/workflow/12345");
      
      await GET(request, {
        params: Promise.resolve({ projectId: "12345" }),
      });

      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [, options] = fetchSpy.mock.calls[0];
      expect(options.headers).toHaveProperty("Authorization");
      expect(options.headers.Authorization).toContain("Token token=");
    });
  });

  describe("Data Aggregation", () => {
    test("should correctly aggregate workflow transitions data", async () => {
      const user = await createTestUser();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            transitions: [
              { id: "t1", title: "Step 1", status: "completed" },
              { id: "t2", title: "Step 2", status: "in_progress" },
              { id: "t3", title: "Step 3", status: "pending" }
            ],
            connections: [
              { source: "t1", target: "t2" },
              { source: "t2", target: "t3" }
            ],
            project: {
              workflow_state: "in_progress"
            }
          }
        }),
        statusText: "OK",
      } as Response);

      const request = createGetRequest("http://localhost:3000/api/stakwork/workflow/12345");
      
      const response = await GET(request, {
        params: Promise.resolve({ projectId: "12345" }),
      });

      const data = await expectSuccess(response, 200);

      expect(data.workflowData.transitions).toHaveLength(3);
      expect(data.workflowData.connections).toHaveLength(2);
      expect(data.workflowData.transitions[0]).toMatchObject({
        id: "t1",
        title: "Step 1",
        status: "completed"
      });
    });

    test("should extract workflow status from project.workflow_state", async () => {
      const user = await createTestUser();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            transitions: [],
            connections: [],
            project: {
              workflow_state: "completed"
            }
          }
        }),
        statusText: "OK",
      } as Response);

      const request = createGetRequest("http://localhost:3000/api/stakwork/workflow/12345");
      
      const response = await GET(request, {
        params: Promise.resolve({ projectId: "12345" }),
      });

      const data = await expectSuccess(response, 200);
      expect(data.status).toBe("completed");
    });

    test("should handle workflow with empty transitions and connections", async () => {
      const user = await createTestUser();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            transitions: [],
            connections: [],
            project: {
              workflow_state: "pending"
            }
          }
        }),
        statusText: "OK",
      } as Response);

      const request = createGetRequest("http://localhost:3000/api/stakwork/workflow/12345");
      
      const response = await GET(request, {
        params: Promise.resolve({ projectId: "12345" }),
      });

      const data = await expectSuccess(response, 200);
      expect(data.workflowData.transitions).toEqual([]);
      expect(data.workflowData.connections).toEqual([]);
      expect(data.status).toBe("pending");
    });
  });

  describe("Error Handling", () => {
    test("should return 500 for generic errors", async () => {
      const user = await createTestUser();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      fetchSpy.mockRejectedValueOnce(new Error("Network error"));

      const request = createGetRequest("http://localhost:3000/api/stakwork/workflow/12345");
      
      const response = await GET(request, {
        params: Promise.resolve({ projectId: "12345" }),
      });

      // Error message includes service name and context prefix
      await expectError(response, "stakwork stakworkRequest /projects/12345.json: Network error", 500);
    });

    test("should propagate ApiError with correct status code", async () => {
      const user = await createTestUser();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const apiError = {
        message: "Project not found",
        status: 404,
        service: "stakwork",
        details: { projectId: "12345" }
      };

      fetchSpy.mockRejectedValueOnce(apiError);

      const request = createGetRequest("http://localhost:3000/api/stakwork/workflow/12345");
      
      const response = await GET(request, {
        params: Promise.resolve({ projectId: "12345" }),
      });

      expect(response.status).toBe(404);
      const data = await response.json();
      // Error message includes service name and context prefix from BaseServiceClass.handleRequest
      expect(data.error).toBe("stakwork stakworkRequest /projects/12345.json: Project not found");
      expect(data.service).toBe("stakwork");
      expect(data.details).toEqual({ projectId: "12345" });
    });

    test("should handle Stakwork API 401 Unauthorized", async () => {
      const user = await createTestUser();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const apiError = {
        message: "Invalid API key",
        status: 401,
        service: "stakwork",
      };

      fetchSpy.mockRejectedValueOnce(apiError);

      const request = createGetRequest("http://localhost:3000/api/stakwork/workflow/12345");
      
      const response = await GET(request, {
        params: Promise.resolve({ projectId: "12345" }),
      });

      expect(response.status).toBe(401);
      const data = await response.json();
      // Error message includes service name and context prefix from BaseServiceClass.handleRequest
      expect(data.error).toBe("stakwork stakworkRequest /projects/12345.json: Invalid API key");
      expect(data.service).toBe("stakwork");
    });

    test("should handle Stakwork API 403 Forbidden", async () => {
      const user = await createTestUser();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const apiError = {
        message: "Access denied to project",
        status: 403,
        service: "stakwork",
        details: { reason: "insufficient_permissions" }
      };

      fetchSpy.mockRejectedValueOnce(apiError);

      const request = createGetRequest("http://localhost:3000/api/stakwork/workflow/12345");
      
      const response = await GET(request, {
        params: Promise.resolve({ projectId: "12345" }),
      });

      expect(response.status).toBe(403);
      const data = await response.json();
      // Error message includes service name and context prefix from BaseServiceClass.handleRequest
      expect(data.error).toBe("stakwork stakworkRequest /projects/12345.json: Access denied to project");
      expect(data.service).toBe("stakwork");
      expect(data.details).toEqual({ reason: "insufficient_permissions" });
    });

    test("should handle Stakwork API 404 Not Found", async () => {
      const user = await createTestUser();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const apiError = {
        message: "Workflow not found",
        status: 404,
        service: "stakwork",
      };

      fetchSpy.mockRejectedValueOnce(apiError);

      const request = createGetRequest("http://localhost:3000/api/stakwork/workflow/nonexistent");
      
      const response = await GET(request, {
        params: Promise.resolve({ projectId: "nonexistent" }),
      });

      expect(response.status).toBe(404);
      const data = await response.json();
      // Error message includes service name and context prefix from BaseServiceClass.handleRequest
      expect(data.error).toBe("stakwork stakworkRequest /projects/nonexistent.json: Workflow not found");
      expect(data.service).toBe("stakwork");
    });

    test("should handle Stakwork API 500 Internal Server Error", async () => {
      const user = await createTestUser();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      const apiError = {
        message: "Stakwork service unavailable",
        status: 500,
        service: "stakwork",
      };

      fetchSpy.mockRejectedValueOnce(apiError);

      const request = createGetRequest("http://localhost:3000/api/stakwork/workflow/12345");
      
      const response = await GET(request, {
        params: Promise.resolve({ projectId: "12345" }),
      });

      expect(response.status).toBe(500);
      const data = await response.json();
      // Error message includes service name and context prefix from BaseServiceClass.handleRequest
      expect(data.error).toBe("stakwork stakworkRequest /projects/12345.json: Stakwork service unavailable");
      expect(data.service).toBe("stakwork");
    });
  });

  describe("Workflow Status Scenarios", () => {
    test("should handle workflow in PENDING status", async () => {
      const user = await createTestUser();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            transitions: [{ id: "t1", title: "Init", status: "pending" }],
            connections: [],
            project: {
              workflow_state: "pending"
            }
          }
        }),
        statusText: "OK",
      } as Response);

      const request = createGetRequest("http://localhost:3000/api/stakwork/workflow/12345");
      
      const response = await GET(request, {
        params: Promise.resolve({ projectId: "12345" }),
      });

      const data = await expectSuccess(response, 200);
      expect(data.status).toBe("pending");
    });

    test("should handle workflow in IN_PROGRESS status", async () => {
      const user = await createTestUser();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            transitions: [
              { id: "t1", title: "Step 1", status: "completed" },
              { id: "t2", title: "Step 2", status: "in_progress" }
            ],
            connections: [{ source: "t1", target: "t2" }],
            project: {
              workflow_state: "in_progress"
            }
          }
        }),
        statusText: "OK",
      } as Response);

      const request = createGetRequest("http://localhost:3000/api/stakwork/workflow/12345");
      
      const response = await GET(request, {
        params: Promise.resolve({ projectId: "12345" }),
      });

      const data = await expectSuccess(response, 200);
      expect(data.status).toBe("in_progress");
    });

    test("should handle workflow in COMPLETED status", async () => {
      const user = await createTestUser();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            transitions: [
              { id: "t1", title: "Step 1", status: "completed" },
              { id: "t2", title: "Step 2", status: "completed" }
            ],
            connections: [{ source: "t1", target: "t2" }],
            project: {
              workflow_state: "completed"
            }
          }
        }),
        statusText: "OK",
      } as Response);

      const request = createGetRequest("http://localhost:3000/api/stakwork/workflow/12345");
      
      const response = await GET(request, {
        params: Promise.resolve({ projectId: "12345" }),
      });

      const data = await expectSuccess(response, 200);
      expect(data.status).toBe("completed");
    });

    test("should handle workflow in ERROR status", async () => {
      const user = await createTestUser();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            transitions: [
              { id: "t1", title: "Step 1", status: "completed" },
              { id: "t2", title: "Step 2", status: "error" }
            ],
            connections: [{ source: "t1", target: "t2" }],
            project: {
              workflow_state: "error"
            }
          }
        }),
        statusText: "OK",
      } as Response);

      const request = createGetRequest("http://localhost:3000/api/stakwork/workflow/12345");
      
      const response = await GET(request, {
        params: Promise.resolve({ projectId: "12345" }),
      });

      const data = await expectSuccess(response, 200);
      expect(data.status).toBe("error");
    });

    test("should handle workflow in FAILED status", async () => {
      const user = await createTestUser();
      getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

      fetchSpy.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            transitions: [{ id: "t1", title: "Step 1", status: "failed" }],
            connections: [],
            project: {
              workflow_state: "failed"
            }
          }
        }),
        statusText: "OK",
      } as Response);

      const request = createGetRequest("http://localhost:3000/api/stakwork/workflow/12345");
      
      const response = await GET(request, {
        params: Promise.resolve({ projectId: "12345" }),
      });

      const data = await expectSuccess(response, 200);
      expect(data.status).toBe("failed");
    });
  });
});