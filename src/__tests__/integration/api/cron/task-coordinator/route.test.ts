import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { GET } from "@/app/api/cron/task-coordinator/route";
import { NextRequest } from "next/server";

// Mock the service layer
vi.mock("@/services/task-coordinator-cron", () => ({
  executeTaskCoordinatorRuns: vi.fn(),
}));

// Import mocked service
const { executeTaskCoordinatorRuns } = await import("@/services/task-coordinator-cron");

describe("GET /api/cron/task-coordinator - Integration", () => {
  let originalEnv: string | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    originalEnv = process.env.TASK_COORDINATOR_ENABLED;
  });

  afterEach(() => {
    // Restore original env var
    if (originalEnv !== undefined) {
      process.env.TASK_COORDINATOR_ENABLED = originalEnv;
    } else {
      delete process.env.TASK_COORDINATOR_ENABLED;
    }
  });

  describe("Environment Variable Gating", () => {
    test("should return success response when TASK_COORDINATOR_ENABLED is false", async () => {
      process.env.TASK_COORDINATOR_ENABLED = "false";

      const request = new NextRequest("http://localhost/api/cron/task-coordinator");
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({
        success: true,
        message: "Task Coordinator is disabled",
        workspacesProcessed: 0,
        tasksCreated: 0,
        errors: [],
      });
      expect(executeTaskCoordinatorRuns).not.toHaveBeenCalled();
    });

    test("should return success response when TASK_COORDINATOR_ENABLED is missing", async () => {
      delete process.env.TASK_COORDINATOR_ENABLED;

      const request = new NextRequest("http://localhost/api/cron/task-coordinator");
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({
        success: true,
        message: "Task Coordinator is disabled",
        workspacesProcessed: 0,
        tasksCreated: 0,
        errors: [],
      });
      expect(executeTaskCoordinatorRuns).not.toHaveBeenCalled();
    });

    test("should execute when TASK_COORDINATOR_ENABLED is true", async () => {
      process.env.TASK_COORDINATOR_ENABLED = "true";
      vi.mocked(executeTaskCoordinatorRuns).mockResolvedValue({
        success: true,
        workspacesProcessed: 0,
        tasksCreated: 0,
        errorCount: 0,
        errors: [],
        timestamp: new Date().toISOString(),
      });

      const request = new NextRequest("http://localhost/api/cron/task-coordinator");
      const response = await GET(request);

      expect(response.status).toBe(200);
      expect(executeTaskCoordinatorRuns).toHaveBeenCalledTimes(1);
    });
  });

  describe("Successful Execution", () => {
    beforeEach(() => {
      process.env.TASK_COORDINATOR_ENABLED = "true";
    });

    test("should return successful response with zero workspaces processed", async () => {
      const mockResult = {
        success: true,
        workspacesProcessed: 0,
        tasksCreated: 0,
        errorCount: 0,
        errors: [],
        timestamp: "2024-01-15T10:30:00.000Z",
      };

      vi.mocked(executeTaskCoordinatorRuns).mockResolvedValue(mockResult);

      const request = new NextRequest("http://localhost/api/cron/task-coordinator");
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({
        success: true,
        workspacesProcessed: 0,
        tasksCreated: 0,
        errorCount: 0,
        errors: [],
        timestamp: "2024-01-15T10:30:00.000Z",
      });
    });

    test("should return successful response with workspaces and tasks processed", async () => {
      const mockResult = {
        success: true,
        workspacesProcessed: 3,
        tasksCreated: 2,
        errorCount: 0,
        errors: [],
        timestamp: "2024-01-15T10:30:00.000Z",
      };

      vi.mocked(executeTaskCoordinatorRuns).mockResolvedValue(mockResult);

      const request = new NextRequest("http://localhost/api/cron/task-coordinator");
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({
        success: true,
        workspacesProcessed: 3,
        tasksCreated: 2,
        errorCount: 0,
        errors: [],
        timestamp: "2024-01-15T10:30:00.000Z",
      });
    });

    test("should include error details when service returns partial failures", async () => {
      const mockResult = {
        success: false,
        workspacesProcessed: 2,
        tasksCreated: 1,
        errorCount: 1,
        errors: [
          {
            workspaceSlug: "test-workspace",
            error: "Pool API connection timeout",
          },
        ],
        timestamp: "2024-01-15T10:30:00.000Z",
      };

      vi.mocked(executeTaskCoordinatorRuns).mockResolvedValue(mockResult);

      const request = new NextRequest("http://localhost/api/cron/task-coordinator");
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({
        success: false,
        workspacesProcessed: 2,
        tasksCreated: 1,
        errorCount: 1,
        errors: [
          {
            workspaceSlug: "test-workspace",
            error: "Pool API connection timeout",
          },
        ],
        timestamp: "2024-01-15T10:30:00.000Z",
      });
    });

    test("should include multiple workspace errors when multiple workspaces fail", async () => {
      const mockResult = {
        success: false,
        workspacesProcessed: 3,
        tasksCreated: 1,
        errorCount: 2,
        errors: [
          {
            workspaceSlug: "workspace-1",
            error: "Pool API error",
          },
          {
            workspaceSlug: "workspace-2",
            error: "Database connection lost",
          },
        ],
        timestamp: "2024-01-15T10:30:00.000Z",
      };

      vi.mocked(executeTaskCoordinatorRuns).mockResolvedValue(mockResult);

      const request = new NextRequest("http://localhost/api/cron/task-coordinator");
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(false);
      expect(data.errorCount).toBe(2);
      expect(data.errors).toHaveLength(2);
      expect(data.errors[0].workspaceSlug).toBe("workspace-1");
      expect(data.errors[1].workspaceSlug).toBe("workspace-2");
    });
  });

  describe("Response Structure Validation", () => {
    beforeEach(() => {
      process.env.TASK_COORDINATOR_ENABLED = "true";
    });

    test("should always include required fields in success response", async () => {
      const mockResult = {
        success: true,
        workspacesProcessed: 1,
        tasksCreated: 1,
        errorCount: 0,
        errors: [],
        timestamp: "2024-01-15T10:30:00.000Z",
      };

      vi.mocked(executeTaskCoordinatorRuns).mockResolvedValue(mockResult);

      const request = new NextRequest("http://localhost/api/cron/task-coordinator");
      const response = await GET(request);
      const data = await response.json();

      expect(data).toHaveProperty("success");
      expect(data).toHaveProperty("workspacesProcessed");
      expect(data).toHaveProperty("tasksCreated");
      expect(data).toHaveProperty("errorCount");
      expect(data).toHaveProperty("errors");
      expect(data).toHaveProperty("timestamp");

      expect(typeof data.success).toBe("boolean");
      expect(typeof data.workspacesProcessed).toBe("number");
      expect(typeof data.tasksCreated).toBe("number");
      expect(typeof data.errorCount).toBe("number");
      expect(Array.isArray(data.errors)).toBe(true);
      expect(typeof data.timestamp).toBe("string");
    });

    test("should format error objects with workspaceSlug and error fields", async () => {
      const mockResult = {
        success: false,
        workspacesProcessed: 1,
        tasksCreated: 0,
        errorCount: 1,
        errors: [
          {
            workspaceSlug: "test-workspace",
            error: "Test error message",
          },
        ],
        timestamp: "2024-01-15T10:30:00.000Z",
      };

      vi.mocked(executeTaskCoordinatorRuns).mockResolvedValue(mockResult);

      const request = new NextRequest("http://localhost/api/cron/task-coordinator");
      const response = await GET(request);
      const data = await response.json();

      expect(data.errors[0]).toHaveProperty("workspaceSlug");
      expect(data.errors[0]).toHaveProperty("error");
      expect(typeof data.errors[0].workspaceSlug).toBe("string");
      expect(typeof data.errors[0].error).toBe("string");
    });

    test("should include ISO 8601 timestamp format", async () => {
      const mockTimestamp = "2024-01-15T10:30:45.123Z";
      const mockResult = {
        success: true,
        workspacesProcessed: 0,
        tasksCreated: 0,
        errorCount: 0,
        errors: [],
        timestamp: mockTimestamp,
      };

      vi.mocked(executeTaskCoordinatorRuns).mockResolvedValue(mockResult);

      const request = new NextRequest("http://localhost/api/cron/task-coordinator");
      const response = await GET(request);
      const data = await response.json();

      expect(data.timestamp).toBe(mockTimestamp);
      expect(data.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });
  });

  describe("Error Handling - Layer 1 (Route Level)", () => {
    beforeEach(() => {
      process.env.TASK_COORDINATOR_ENABLED = "true";
    });

    test("should return 500 when service throws Error", async () => {
      vi.mocked(executeTaskCoordinatorRuns).mockRejectedValue(
        new Error("Database connection lost")
      );

      const request = new NextRequest("http://localhost/api/cron/task-coordinator");
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data).toEqual({
        success: false,
        error: "Internal server error",
        timestamp: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
      });
    });

    test("should return 500 when service throws string error", async () => {
      vi.mocked(executeTaskCoordinatorRuns).mockRejectedValue("Unexpected error");

      const request = new NextRequest("http://localhost/api/cron/task-coordinator");
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data).toEqual({
        success: false,
        error: "Internal server error",
        timestamp: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
      });
    });

    test("should return 500 when service throws non-Error object", async () => {
      vi.mocked(executeTaskCoordinatorRuns).mockRejectedValue({
        code: "ECONNREFUSED",
        message: "Connection refused",
      });

      const request = new NextRequest("http://localhost/api/cron/task-coordinator");
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data).toEqual({
        success: false,
        error: "Internal server error",
        timestamp: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
      });
    });

    test("should not expose internal error details in 500 response", async () => {
      vi.mocked(executeTaskCoordinatorRuns).mockRejectedValue(
        new Error("Sensitive database credentials: admin:password123")
      );

      const request = new NextRequest("http://localhost/api/cron/task-coordinator");
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe("Internal server error");
      expect(data.error).not.toContain("password");
      expect(data.error).not.toContain("admin");
    });
  });

  describe("Service Delegation", () => {
    beforeEach(() => {
      process.env.TASK_COORDINATOR_ENABLED = "true";
    });

    test("should call executeTaskCoordinatorRuns exactly once per request", async () => {
      vi.mocked(executeTaskCoordinatorRuns).mockResolvedValue({
        success: true,
        workspacesProcessed: 1,
        tasksCreated: 1,
        errorCount: 0,
        errors: [],
        timestamp: new Date().toISOString(),
      });

      const request = new NextRequest("http://localhost/api/cron/task-coordinator");
      await GET(request);

      expect(executeTaskCoordinatorRuns).toHaveBeenCalledTimes(1);
    });

    test("should not call executeTaskCoordinatorRuns when feature is disabled", async () => {
      process.env.TASK_COORDINATOR_ENABLED = "false";

      const request = new NextRequest("http://localhost/api/cron/task-coordinator");
      await GET(request);

      expect(executeTaskCoordinatorRuns).not.toHaveBeenCalled();
    });

    test("should propagate service result without modification", async () => {
      const mockResult = {
        success: true,
        workspacesProcessed: 5,
        tasksCreated: 3,
        errorCount: 0,
        errors: [],
        timestamp: "2024-01-15T12:00:00.000Z",
      };

      vi.mocked(executeTaskCoordinatorRuns).mockResolvedValue(mockResult);

      const request = new NextRequest("http://localhost/api/cron/task-coordinator");
      const response = await GET(request);
      const data = await response.json();

      expect(data).toEqual(mockResult);
    });
  });

  describe("Edge Cases", () => {
    test("should handle TASK_COORDINATOR_ENABLED with non-boolean truthy values", async () => {
      process.env.TASK_COORDINATOR_ENABLED = "1";

      const request = new NextRequest("http://localhost/api/cron/task-coordinator");
      const response = await GET(request);
      const data = await response.json();

      // Only "true" string should enable, "1" should be treated as disabled
      expect(data.message).toBe("Task Coordinator is disabled");
      expect(executeTaskCoordinatorRuns).not.toHaveBeenCalled();
    });

    test("should handle TASK_COORDINATOR_ENABLED with whitespace", async () => {
      process.env.TASK_COORDINATOR_ENABLED = " true ";

      const request = new NextRequest("http://localhost/api/cron/task-coordinator");
      const response = await GET(request);
      const data = await response.json();

      // Whitespace should cause strict equality to fail
      expect(data.message).toBe("Task Coordinator is disabled");
      expect(executeTaskCoordinatorRuns).not.toHaveBeenCalled();
    });

    test("should handle empty errors array", async () => {
      process.env.TASK_COORDINATOR_ENABLED = "true";
      const mockResult = {
        success: true,
        workspacesProcessed: 3,
        tasksCreated: 2,
        errorCount: 0,
        errors: [],
        timestamp: "2024-01-15T10:30:00.000Z",
      };

      vi.mocked(executeTaskCoordinatorRuns).mockResolvedValue(mockResult);

      const request = new NextRequest("http://localhost/api/cron/task-coordinator");
      const response = await GET(request);
      const data = await response.json();

      expect(data.errors).toEqual([]);
      expect(data.errorCount).toBe(0);
    });

    test("should handle SYSTEM errors from service", async () => {
      process.env.TASK_COORDINATOR_ENABLED = "true";
      const mockResult = {
        success: false,
        workspacesProcessed: 0,
        tasksCreated: 0,
        errorCount: 1,
        errors: [
          {
            workspaceSlug: "SYSTEM",
            error: "Critical execution error: Database connection lost",
          },
        ],
        timestamp: "2024-01-15T10:30:00.000Z",
      };

      vi.mocked(executeTaskCoordinatorRuns).mockResolvedValue(mockResult);

      const request = new NextRequest("http://localhost/api/cron/task-coordinator");
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(false);
      expect(data.errors[0].workspaceSlug).toBe("SYSTEM");
    });

    test("should handle very large numbers of workspaces processed", async () => {
      process.env.TASK_COORDINATOR_ENABLED = "true";
      const mockResult = {
        success: true,
        workspacesProcessed: 9999,
        tasksCreated: 5000,
        errorCount: 0,
        errors: [],
        timestamp: "2024-01-15T10:30:00.000Z",
      };

      vi.mocked(executeTaskCoordinatorRuns).mockResolvedValue(mockResult);

      const request = new NextRequest("http://localhost/api/cron/task-coordinator");
      const response = await GET(request);
      const data = await response.json();

      expect(data.workspacesProcessed).toBe(9999);
      expect(data.tasksCreated).toBe(5000);
    });
  });

  describe("HTTP Response Codes", () => {
    beforeEach(() => {
      process.env.TASK_COORDINATOR_ENABLED = "true";
    });

    test("should return 200 for successful execution", async () => {
      vi.mocked(executeTaskCoordinatorRuns).mockResolvedValue({
        success: true,
        workspacesProcessed: 1,
        tasksCreated: 1,
        errorCount: 0,
        errors: [],
        timestamp: new Date().toISOString(),
      });

      const request = new NextRequest("http://localhost/api/cron/task-coordinator");
      const response = await GET(request);

      expect(response.status).toBe(200);
    });

    test("should return 200 for partial failures (not 500)", async () => {
      vi.mocked(executeTaskCoordinatorRuns).mockResolvedValue({
        success: false,
        workspacesProcessed: 2,
        tasksCreated: 1,
        errorCount: 1,
        errors: [
          {
            workspaceSlug: "test-workspace",
            error: "Pool connection failed",
          },
        ],
        timestamp: new Date().toISOString(),
      });

      const request = new NextRequest("http://localhost/api/cron/task-coordinator");
      const response = await GET(request);

      expect(response.status).toBe(200);
    });

    test("should return 200 when disabled", async () => {
      process.env.TASK_COORDINATOR_ENABLED = "false";

      const request = new NextRequest("http://localhost/api/cron/task-coordinator");
      const response = await GET(request);

      expect(response.status).toBe(200);
    });

    test("should return 500 only for unhandled exceptions", async () => {
      vi.mocked(executeTaskCoordinatorRuns).mockRejectedValue(
        new Error("Unhandled error")
      );

      const request = new NextRequest("http://localhost/api/cron/task-coordinator");
      const response = await GET(request);

      expect(response.status).toBe(500);
    });
  });
});