import { describe, test, expect, beforeEach, vi } from "vitest";
import { GET } from "@/app/api/stakwork/workflow/[projectId]/route";
import { NextRequest } from "next/server";
import {
  createAuthenticatedSession,
  mockUnauthenticatedSession,
  expectSuccess,
  expectError,
  expectUnauthorized,
  getMockedSession,
} from "@/__tests__/support/helpers";
import { createTestUser } from "@/__tests__/support/fixtures/user";

// Mock the service factory
vi.mock("@/lib/service-factory", () => ({
  stakworkService: vi.fn(),
}));

// Import mocked service
import { stakworkService as mockStakworkService } from "@/lib/service-factory";

describe("GET /api/stakwork/workflow/[projectId] Integration Tests", () => {
  let testUser: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    
    // Create test data
    testUser = await createTestUser({ name: "Test User" });
  });

  describe("Authentication", () => {
    test("should return 401 when no session provided", async () => {
      getMockedSession().mockResolvedValue(mockUnauthenticatedSession());
      
      const request = new NextRequest("http://localhost:3000/api/stakwork/workflow/123");
      const response = await GET(request, {
        params: Promise.resolve({ projectId: "123" })
      });
      
      await expectUnauthorized(response);
    });

    test("should return 401 when session has no user", async () => {
      getMockedSession().mockResolvedValue({ user: null } as any);
      
      const request = new NextRequest("http://localhost:3000/api/stakwork/workflow/123");
      const response = await GET(request, {
        params: Promise.resolve({ projectId: "123" })
      });
      
      await expectUnauthorized(response);
    });

    test("should return 401 when session user is undefined", async () => {
      getMockedSession().mockResolvedValue({ user: undefined } as any);
      
      const request = new NextRequest("http://localhost:3000/api/stakwork/workflow/123");
      const response = await GET(request, {
        params: Promise.resolve({ projectId: "123" })
      });
      
      await expectUnauthorized(response);
    });
  });

  describe("Input Validation", () => {
    test("should return 400 when projectId is empty string", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));
      
      const request = new NextRequest("http://localhost:3000/api/stakwork/workflow/");
      const response = await GET(request, {
        params: Promise.resolve({ projectId: "" })
      });
      
      await expectError(response, "Missing required parameter: projectId", 400);
    });

    test("should return 400 when projectId is null", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));
      
      const request = new NextRequest("http://localhost:3000/api/stakwork/workflow/");
      const response = await GET(request, {
        params: Promise.resolve({ projectId: null as any })
      });
      
      await expectError(response, "Missing required parameter: projectId", 400);
    });

    test("should return 400 when projectId is undefined", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));
      
      const request = new NextRequest("http://localhost:3000/api/stakwork/workflow/");
      const response = await GET(request, {
        params: Promise.resolve({ projectId: undefined as any })
      });
      
      await expectError(response, "Missing required parameter: projectId", 400);
    });
  });

  describe("Success Flow", () => {
    test("should return 200 with workflow data for valid request", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));
      
      const mockWorkflowData = {
        workflowData: {
          transitions: [
            { id: "1", title: "Start", status: "completed" },
            { id: "2", title: "Process", status: "in_progress" },
          ],
          connections: [
            { from: "1", to: "2" }
          ],
        },
        status: "in_progress",
      };
      
      const mockService = {
        getWorkflowData: vi.fn().mockResolvedValue(mockWorkflowData),
      };
      vi.mocked(mockStakworkService).mockReturnValue(mockService as any);
      
      const request = new NextRequest("http://localhost:3000/api/stakwork/workflow/123");
      const response = await GET(request, {
        params: Promise.resolve({ projectId: "123" })
      });
      
      const data = await expectSuccess(response, 200);
      expect(data).toEqual(mockWorkflowData);
      expect(mockService.getWorkflowData).toHaveBeenCalledWith("123");
    });

    test("should handle numeric projectId", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));
      
      const mockWorkflowData = {
        workflowData: {
          transitions: [],
          connections: [],
        },
        status: "pending",
      };
      
      const mockService = {
        getWorkflowData: vi.fn().mockResolvedValue(mockWorkflowData),
      };
      vi.mocked(mockStakworkService).mockReturnValue(mockService as any);
      
      const request = new NextRequest("http://localhost:3000/api/stakwork/workflow/456");
      const response = await GET(request, {
        params: Promise.resolve({ projectId: "456" })
      });
      
      const data = await expectSuccess(response, 200);
      expect(data).toEqual(mockWorkflowData);
      expect(mockService.getWorkflowData).toHaveBeenCalledWith("456");
    });

    test("should return workflow data with complete structure", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));
      
      const mockWorkflowData = {
        workflowData: {
          transitions: [
            { 
              id: "1", 
              title: "Initialize", 
              status: "completed",
              position: { x: 0, y: 0 }
            },
            { 
              id: "2", 
              title: "Execute", 
              status: "in_progress",
              position: { x: 100, y: 0 }
            },
            { 
              id: "3", 
              title: "Complete", 
              status: "pending",
              position: { x: 200, y: 0 }
            },
          ],
          connections: [
            { from: "1", to: "2", type: "default" },
            { from: "2", to: "3", type: "default" },
          ],
        },
        status: "in_progress",
      };
      
      const mockService = {
        getWorkflowData: vi.fn().mockResolvedValue(mockWorkflowData),
      };
      vi.mocked(mockStakworkService).mockReturnValue(mockService as any);
      
      const request = new NextRequest("http://localhost:3000/api/stakwork/workflow/789");
      const response = await GET(request, {
        params: Promise.resolve({ projectId: "789" })
      });
      
      const data = await expectSuccess(response, 200);
      expect(data.workflowData.transitions).toHaveLength(3);
      expect(data.workflowData.connections).toHaveLength(2);
      expect(data.status).toBe("in_progress");
    });
  });

  describe("Service Errors", () => {
    test("should handle ApiError with status 404 (project not found)", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));
      
      const apiError = {
        message: "Project not found",
        status: 404,
        service: "stakwork",
        details: { projectId: "999" },
      };
      
      const mockService = {
        getWorkflowData: vi.fn().mockRejectedValue(apiError),
      };
      vi.mocked(mockStakworkService).mockReturnValue(mockService as any);
      
      const request = new NextRequest("http://localhost:3000/api/stakwork/workflow/999");
      const response = await GET(request, {
        params: Promise.resolve({ projectId: "999" })
      });
      
      expect(response.status).toBe(404);
      const data = await response.json();
      expect(data).toEqual({
        error: "Project not found",
        service: "stakwork",
        details: { projectId: "999" },
      });
    });

    test("should handle ApiError with status 500 (service error)", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));
      
      const apiError = {
        message: "Internal server error",
        status: 500,
        service: "stakwork",
        details: { error: "Connection timeout" },
      };
      
      const mockService = {
        getWorkflowData: vi.fn().mockRejectedValue(apiError),
      };
      vi.mocked(mockStakworkService).mockReturnValue(mockService as any);
      
      const request = new NextRequest("http://localhost:3000/api/stakwork/workflow/123");
      const response = await GET(request, {
        params: Promise.resolve({ projectId: "123" })
      });
      
      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data).toEqual({
        error: "Internal server error",
        service: "stakwork",
        details: { error: "Connection timeout" },
      });
    });

    test("should handle ApiError with status 503 (service unavailable)", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));
      
      const apiError = {
        message: "Service temporarily unavailable",
        status: 503,
        service: "stakwork",
        details: { retry_after: 60 },
      };
      
      const mockService = {
        getWorkflowData: vi.fn().mockRejectedValue(apiError),
      };
      vi.mocked(mockStakworkService).mockReturnValue(mockService as any);
      
      const request = new NextRequest("http://localhost:3000/api/stakwork/workflow/123");
      const response = await GET(request, {
        params: Promise.resolve({ projectId: "123" })
      });
      
      expect(response.status).toBe(503);
      const data = await response.json();
      expect(data).toEqual({
        error: "Service temporarily unavailable",
        service: "stakwork",
        details: { retry_after: 60 },
      });
    });

    test("should handle ApiError with status 422 (validation error)", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));
      
      const apiError = {
        message: "Workflow validation failed",
        status: 422,
        service: "stakwork",
        details: {
          validationErrors: ["Invalid transition state", "Missing required field"],
        },
      };
      
      const mockService = {
        getWorkflowData: vi.fn().mockRejectedValue(apiError),
      };
      vi.mocked(mockStakworkService).mockReturnValue(mockService as any);
      
      const request = new NextRequest("http://localhost:3000/api/stakwork/workflow/123");
      const response = await GET(request, {
        params: Promise.resolve({ projectId: "123" })
      });
      
      expect(response.status).toBe(422);
      const data = await response.json();
      expect(data.error).toBe("Workflow validation failed");
      expect(data.service).toBe("stakwork");
      expect(data.details).toEqual({
        validationErrors: ["Invalid transition state", "Missing required field"],
      });
    });

    test("should preserve ApiError details in response", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));
      
      const apiError = {
        message: "Workflow processing error",
        status: 400,
        service: "stakwork",
        details: {
          errorCode: "WORKFLOW_INVALID",
          timestamp: "2024-01-01T00:00:00Z",
          requestId: "req-123",
        },
      };
      
      const mockService = {
        getWorkflowData: vi.fn().mockRejectedValue(apiError),
      };
      vi.mocked(mockStakworkService).mockReturnValue(mockService as any);
      
      const request = new NextRequest("http://localhost:3000/api/stakwork/workflow/123");
      const response = await GET(request, {
        params: Promise.resolve({ projectId: "123" })
      });
      
      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toBe("Workflow processing error");
      expect(data.service).toBe("stakwork");
      expect(data.details).toEqual({
        errorCode: "WORKFLOW_INVALID",
        timestamp: "2024-01-01T00:00:00Z",
        requestId: "req-123",
      });
    });
  });

  describe("Generic Errors", () => {
    test("should return 500 for unexpected Error objects", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));
      
      const mockService = {
        getWorkflowData: vi.fn().mockRejectedValue(new Error("Unexpected error")),
      };
      vi.mocked(mockStakworkService).mockReturnValue(mockService as any);
      
      const request = new NextRequest("http://localhost:3000/api/stakwork/workflow/123");
      const response = await GET(request, {
        params: Promise.resolve({ projectId: "123" })
      });
      
      await expectError(response, "Failed to fetch workflow data", 500);
    });

    test("should return 500 for non-ApiError exceptions", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));
      
      const mockService = {
        getWorkflowData: vi.fn().mockRejectedValue("String error"),
      };
      vi.mocked(mockStakworkService).mockReturnValue(mockService as any);
      
      const request = new NextRequest("http://localhost:3000/api/stakwork/workflow/123");
      const response = await GET(request, {
        params: Promise.resolve({ projectId: "123" })
      });
      
      await expectError(response, "Failed to fetch workflow data", 500);
    });

    test("should return 500 for thrown null values", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));
      
      const mockService = {
        getWorkflowData: vi.fn().mockRejectedValue(null),
      };
      vi.mocked(mockStakworkService).mockReturnValue(mockService as any);
      
      const request = new NextRequest("http://localhost:3000/api/stakwork/workflow/123");
      const response = await GET(request, {
        params: Promise.resolve({ projectId: "123" })
      });
      
      await expectError(response, "Failed to fetch workflow data", 500);
    });

    test("should log errors to console", async () => {
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));
      
      const mockError = new Error("Service connection failed");
      const mockService = {
        getWorkflowData: vi.fn().mockRejectedValue(mockError),
      };
      vi.mocked(mockStakworkService).mockReturnValue(mockService as any);
      
      const request = new NextRequest("http://localhost:3000/api/stakwork/workflow/123");
      await GET(request, {
        params: Promise.resolve({ projectId: "123" })
      });
      
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        "Error fetching workflow data:",
        mockError
      );
      
      consoleErrorSpy.mockRestore();
    });
  });

  describe("Edge Cases", () => {
    test("should handle empty workflow data", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));
      
      const mockWorkflowData = {
        workflowData: {
          transitions: [],
          connections: [],
        },
        status: "pending",
      };
      
      const mockService = {
        getWorkflowData: vi.fn().mockResolvedValue(mockWorkflowData),
      };
      vi.mocked(mockStakworkService).mockReturnValue(mockService as any);
      
      const request = new NextRequest("http://localhost:3000/api/stakwork/workflow/123");
      const response = await GET(request, {
        params: Promise.resolve({ projectId: "123" })
      });
      
      const data = await expectSuccess(response, 200);
      expect(data.workflowData.transitions).toHaveLength(0);
      expect(data.workflowData.connections).toHaveLength(0);
    });

    test("should handle workflow with completed status", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));
      
      const mockWorkflowData = {
        workflowData: {
          transitions: [
            { id: "1", title: "Start", status: "completed" },
            { id: "2", title: "End", status: "completed" },
          ],
          connections: [{ from: "1", to: "2" }],
        },
        status: "completed",
      };
      
      const mockService = {
        getWorkflowData: vi.fn().mockResolvedValue(mockWorkflowData),
      };
      vi.mocked(mockStakworkService).mockReturnValue(mockService as any);
      
      const request = new NextRequest("http://localhost:3000/api/stakwork/workflow/123");
      const response = await GET(request, {
        params: Promise.resolve({ projectId: "123" })
      });
      
      const data = await expectSuccess(response, 200);
      expect(data.status).toBe("completed");
    });

    test("should handle very long projectId", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));
      
      const longProjectId = "a".repeat(1000);
      const mockWorkflowData = {
        workflowData: { transitions: [], connections: [] },
        status: "pending",
      };
      
      const mockService = {
        getWorkflowData: vi.fn().mockResolvedValue(mockWorkflowData),
      };
      vi.mocked(mockStakworkService).mockReturnValue(mockService as any);
      
      const request = new NextRequest(`http://localhost:3000/api/stakwork/workflow/${longProjectId}`);
      const response = await GET(request, {
        params: Promise.resolve({ projectId: longProjectId })
      });
      
      await expectSuccess(response, 200);
      expect(mockService.getWorkflowData).toHaveBeenCalledWith(longProjectId);
    });

    test("should handle special characters in projectId", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));
      
      const specialProjectId = "project-123_v2.beta";
      const mockWorkflowData = {
        workflowData: { transitions: [], connections: [] },
        status: "pending",
      };
      
      const mockService = {
        getWorkflowData: vi.fn().mockResolvedValue(mockWorkflowData),
      };
      vi.mocked(mockStakworkService).mockReturnValue(mockService as any);
      
      const request = new NextRequest(`http://localhost:3000/api/stakwork/workflow/${specialProjectId}`);
      const response = await GET(request, {
        params: Promise.resolve({ projectId: specialProjectId })
      });
      
      await expectSuccess(response, 200);
      expect(mockService.getWorkflowData).toHaveBeenCalledWith(specialProjectId);
    });

    test("should handle projectId with only numbers", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));
      
      const numericProjectId = "9876543210";
      const mockWorkflowData = {
        workflowData: { transitions: [], connections: [] },
        status: "pending",
      };
      
      const mockService = {
        getWorkflowData: vi.fn().mockResolvedValue(mockWorkflowData),
      };
      vi.mocked(mockStakworkService).mockReturnValue(mockService as any);
      
      const request = new NextRequest(`http://localhost:3000/api/stakwork/workflow/${numericProjectId}`);
      const response = await GET(request, {
        params: Promise.resolve({ projectId: numericProjectId })
      });
      
      await expectSuccess(response, 200);
      expect(mockService.getWorkflowData).toHaveBeenCalledWith(numericProjectId);
    });

    test("should handle workflow data with additional properties", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));
      
      const mockWorkflowData = {
        workflowData: {
          transitions: [],
          connections: [],
          metadata: { createdAt: "2024-01-01", version: "1.0" },
          settings: { autoSave: true },
        },
        status: "in_progress",
        progress: 50,
        estimatedCompletion: "2024-01-02",
      };
      
      const mockService = {
        getWorkflowData: vi.fn().mockResolvedValue(mockWorkflowData),
      };
      vi.mocked(mockStakworkService).mockReturnValue(mockService as any);
      
      const request = new NextRequest("http://localhost:3000/api/stakwork/workflow/123");
      const response = await GET(request, {
        params: Promise.resolve({ projectId: "123" })
      });
      
      const data = await expectSuccess(response, 200);
      expect(data.workflowData.metadata).toBeDefined();
      expect(data.workflowData.settings).toBeDefined();
      expect(data.progress).toBe(50);
    });
  });

  describe("Service Integration", () => {
    test("should call stakworkService with correct factory pattern", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));
      
      const mockWorkflowData = {
        workflowData: { transitions: [], connections: [] },
        status: "pending",
      };
      
      const mockService = {
        getWorkflowData: vi.fn().mockResolvedValue(mockWorkflowData),
      };
      vi.mocked(mockStakworkService).mockReturnValue(mockService as any);
      
      const request = new NextRequest("http://localhost:3000/api/stakwork/workflow/123");
      await GET(request, {
        params: Promise.resolve({ projectId: "123" })
      });
      
      expect(mockStakworkService).toHaveBeenCalled();
      expect(mockService.getWorkflowData).toHaveBeenCalledWith("123");
    });

    test("should handle service returning null workflow data", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));
      
      const mockService = {
        getWorkflowData: vi.fn().mockResolvedValue(null),
      };
      vi.mocked(mockStakworkService).mockReturnValue(mockService as any);
      
      const request = new NextRequest("http://localhost:3000/api/stakwork/workflow/123");
      const response = await GET(request, {
        params: Promise.resolve({ projectId: "123" })
      });
      
      // null is JSON serializable and should return successfully
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toBeNull();
    });

    test("should handle service returning undefined as error", async () => {
      getMockedSession().mockResolvedValue(createAuthenticatedSession(testUser));
      
      const mockService = {
        getWorkflowData: vi.fn().mockResolvedValue(undefined),
      };
      vi.mocked(mockStakworkService).mockReturnValue(mockService as any);
      
      const request = new NextRequest("http://localhost:3000/api/stakwork/workflow/123");
      const response = await GET(request, {
        params: Promise.resolve({ projectId: "123" })
      });
      
      // undefined is not JSON serializable, so NextResponse.json() throws an error
      // This gets caught and returns a 500 error
      await expectError(response, "Failed to fetch workflow data", 500);
    });
  });
});