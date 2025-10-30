import { describe, test, expect, beforeEach, vi, afterEach } from "vitest";
import { GET } from "@/app/api/cron/janitors/route";
import { JanitorType } from "@prisma/client";
import type { CronExecutionResult } from "@/services/janitor-cron";

// Mock janitor-cron service functions
vi.mock("@/services/janitor-cron", () => ({
  executeScheduledJanitorRuns: vi.fn(),
}));

// Import mocked functions for type-safe mocking
import { executeScheduledJanitorRuns } from "@/services/janitor-cron";

const mockExecuteScheduledJanitorRuns = executeScheduledJanitorRuns as vi.MockedFunction<
  typeof executeScheduledJanitorRuns
>;

describe("GET /api/cron/janitors Integration Tests", () => {
  const originalEnv = process.env.JANITOR_CRON_ENABLED;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    // Restore original environment variable
    if (originalEnv !== undefined) {
      process.env.JANITOR_CRON_ENABLED = originalEnv;
    } else {
      delete process.env.JANITOR_CRON_ENABLED;
    }
  });

  describe("Feature Flag Control", () => {
    test("should return disabled message when JANITOR_CRON_ENABLED is false", async () => {
      process.env.JANITOR_CRON_ENABLED = "false";

      const response = await GET();

      expect(response.status).toBe(200);
      const data = await response.json();

      expect(data).toMatchObject({
        success: true,
        message: "Janitor cron is disabled",
        workspacesProcessed: 0,
        runsCreated: 0,
        errors: [],
      });

      // Verify executeScheduledJanitorRuns was not called
      expect(mockExecuteScheduledJanitorRuns).not.toHaveBeenCalled();
    });

    test("should return disabled message when JANITOR_CRON_ENABLED is undefined", async () => {
      delete process.env.JANITOR_CRON_ENABLED;

      const response = await GET();

      expect(response.status).toBe(200);
      const data = await response.json();

      expect(data).toMatchObject({
        success: true,
        message: "Janitor cron is disabled",
        workspacesProcessed: 0,
        runsCreated: 0,
        errors: [],
      });

      expect(mockExecuteScheduledJanitorRuns).not.toHaveBeenCalled();
    });

    test("should return disabled message when JANITOR_CRON_ENABLED is empty string", async () => {
      process.env.JANITOR_CRON_ENABLED = "";

      const response = await GET();

      expect(response.status).toBe(200);
      const data = await response.json();

      expect(data.message).toBe("Janitor cron is disabled");
      expect(mockExecuteScheduledJanitorRuns).not.toHaveBeenCalled();
    });
  });

  describe("Successful Execution", () => {
    test("should execute scheduled runs and return results when enabled", async () => {
      process.env.JANITOR_CRON_ENABLED = "true";

      const mockResult: CronExecutionResult = {
        success: true,
        workspacesProcessed: 3,
        runsCreated: 5,
        errors: [],
        timestamp: new Date("2024-01-15T10:00:00Z"),
      };

      mockExecuteScheduledJanitorRuns.mockResolvedValue(mockResult);

      const response = await GET();

      expect(response.status).toBe(200);
      const data = await response.json();

      expect(data).toMatchObject({
        success: true,
        workspacesProcessed: 3,
        runsCreated: 5,
        errorCount: 0,
        errors: [],
        timestamp: "2024-01-15T10:00:00.000Z",
      });

      expect(mockExecuteScheduledJanitorRuns).toHaveBeenCalledTimes(1);
    });

    test("should handle execution with no enabled workspaces", async () => {
      process.env.JANITOR_CRON_ENABLED = "true";

      const mockResult: CronExecutionResult = {
        success: true,
        workspacesProcessed: 0,
        runsCreated: 0,
        errors: [],
        timestamp: new Date("2024-01-15T10:00:00Z"),
      };

      mockExecuteScheduledJanitorRuns.mockResolvedValue(mockResult);

      const response = await GET();

      expect(response.status).toBe(200);
      const data = await response.json();

      expect(data).toMatchObject({
        success: true,
        workspacesProcessed: 0,
        runsCreated: 0,
        errorCount: 0,
        errors: [],
      });
    });

    test("should handle execution with multiple workspace processing", async () => {
      process.env.JANITOR_CRON_ENABLED = "true";

      const mockResult: CronExecutionResult = {
        success: true,
        workspacesProcessed: 10,
        runsCreated: 25,
        errors: [],
        timestamp: new Date("2024-01-15T10:00:00Z"),
      };

      mockExecuteScheduledJanitorRuns.mockResolvedValue(mockResult);

      const response = await GET();

      expect(response.status).toBe(200);
      const data = await response.json();

      expect(data.workspacesProcessed).toBe(10);
      expect(data.runsCreated).toBe(25);
      expect(data.success).toBe(true);
    });
  });

  describe("Partial Failure Scenarios", () => {
    test("should handle partial failures and return error details", async () => {
      process.env.JANITOR_CRON_ENABLED = "true";

      const mockResult: CronExecutionResult = {
        success: false,
        workspacesProcessed: 5,
        runsCreated: 8,
        errors: [
          {
            workspaceSlug: "workspace-1",
            janitorType: JanitorType.UNIT_TESTS,
            error: "Stakwork API timeout",
          },
          {
            workspaceSlug: "workspace-2",
            janitorType: JanitorType.INTEGRATION_TESTS,
            error: "Invalid workflow configuration",
          },
        ],
        timestamp: new Date("2024-01-15T10:00:00Z"),
      };

      mockExecuteScheduledJanitorRuns.mockResolvedValue(mockResult);

      const response = await GET();

      expect(response.status).toBe(200);
      const data = await response.json();

      expect(data).toMatchObject({
        success: false,
        workspacesProcessed: 5,
        runsCreated: 8,
        errorCount: 2,
        errors: [
          {
            workspaceSlug: "workspace-1",
            janitorType: "UNIT_TESTS",
            error: "Stakwork API timeout",
          },
          {
            workspaceSlug: "workspace-2",
            janitorType: "INTEGRATION_TESTS",
            error: "Invalid workflow configuration",
          },
        ],
      });

      expect(mockExecuteScheduledJanitorRuns).toHaveBeenCalledTimes(1);
    });

    test("should handle single workspace failure", async () => {
      process.env.JANITOR_CRON_ENABLED = "true";

      const mockResult: CronExecutionResult = {
        success: false,
        workspacesProcessed: 1,
        runsCreated: 0,
        errors: [
          {
            workspaceSlug: "failed-workspace",
            janitorType: JanitorType.E2E_TESTS,
            error: "Database connection failed",
          },
        ],
        timestamp: new Date("2024-01-15T10:00:00Z"),
      };

      mockExecuteScheduledJanitorRuns.mockResolvedValue(mockResult);

      const response = await GET();

      expect(response.status).toBe(200);
      const data = await response.json();

      expect(data.success).toBe(false);
      expect(data.errorCount).toBe(1);
      expect(data.errors).toHaveLength(1);
      expect(data.errors[0].workspaceSlug).toBe("failed-workspace");
    });

    test("should handle mixed success and failure across multiple janitor types", async () => {
      process.env.JANITOR_CRON_ENABLED = "true";

      const mockResult: CronExecutionResult = {
        success: false,
        workspacesProcessed: 3,
        runsCreated: 10,
        errors: [
          {
            workspaceSlug: "workspace-a",
            janitorType: JanitorType.UNIT_TESTS,
            error: "Workflow not found",
          },
          {
            workspaceSlug: "workspace-a",
            janitorType: JanitorType.SECURITY_REVIEW,
            error: "Missing repository access",
          },
          {
            workspaceSlug: "workspace-b",
            janitorType: JanitorType.E2E_TESTS,
            error: "Insufficient permissions",
          },
        ],
        timestamp: new Date("2024-01-15T10:00:00Z"),
      };

      mockExecuteScheduledJanitorRuns.mockResolvedValue(mockResult);

      const response = await GET();

      expect(response.status).toBe(200);
      const data = await response.json();

      expect(data.success).toBe(false);
      expect(data.workspacesProcessed).toBe(3);
      expect(data.runsCreated).toBe(10);
      expect(data.errorCount).toBe(3);
      expect(data.errors).toHaveLength(3);
    });
  });

  describe("Error Handling", () => {
    test("should return 500 status for unhandled exceptions", async () => {
      process.env.JANITOR_CRON_ENABLED = "true";

      mockExecuteScheduledJanitorRuns.mockRejectedValue(
        new Error("Unexpected database error")
      );

      const response = await GET();

      expect(response.status).toBe(500);
      const data = await response.json();

      expect(data).toMatchObject({
        success: false,
        error: "Internal server error",
      });
      expect(data.timestamp).toBeDefined();
      expect(typeof data.timestamp).toBe("string");
    });

    test("should handle service function throwing non-Error objects", async () => {
      process.env.JANITOR_CRON_ENABLED = "true";

      mockExecuteScheduledJanitorRuns.mockRejectedValue(
        "String error message"
      );

      const response = await GET();

      expect(response.status).toBe(500);
      const data = await response.json();

      expect(data.success).toBe(false);
      expect(data.error).toBe("Internal server error");
    });

    test("should handle service function throwing null", async () => {
      process.env.JANITOR_CRON_ENABLED = "true";

      mockExecuteScheduledJanitorRuns.mockRejectedValue(null);

      const response = await GET();

      expect(response.status).toBe(500);
      const data = await response.json();

      expect(data.success).toBe(false);
      expect(data.error).toBe("Internal server error");
    });
  });

  describe("Response Structure Validation", () => {
    test("should include all required fields in success response", async () => {
      process.env.JANITOR_CRON_ENABLED = "true";

      const mockResult: CronExecutionResult = {
        success: true,
        workspacesProcessed: 2,
        runsCreated: 4,
        errors: [],
        timestamp: new Date("2024-01-15T10:00:00Z"),
      };

      mockExecuteScheduledJanitorRuns.mockResolvedValue(mockResult);

      const response = await GET();

      expect(response.status).toBe(200);
      const data = await response.json();

      // Verify all required fields exist
      expect(data).toHaveProperty("success");
      expect(data).toHaveProperty("workspacesProcessed");
      expect(data).toHaveProperty("runsCreated");
      expect(data).toHaveProperty("errorCount");
      expect(data).toHaveProperty("errors");
      expect(data).toHaveProperty("timestamp");

      // Verify field types
      expect(typeof data.success).toBe("boolean");
      expect(typeof data.workspacesProcessed).toBe("number");
      expect(typeof data.runsCreated).toBe("number");
      expect(typeof data.errorCount).toBe("number");
      expect(Array.isArray(data.errors)).toBe(true);
      expect(typeof data.timestamp).toBe("string");
    });

    test("should format timestamp as ISO string", async () => {
      process.env.JANITOR_CRON_ENABLED = "true";

      const testDate = new Date("2024-01-15T14:30:45.123Z");
      const mockResult: CronExecutionResult = {
        success: true,
        workspacesProcessed: 1,
        runsCreated: 2,
        errors: [],
        timestamp: testDate,
      };

      mockExecuteScheduledJanitorRuns.mockResolvedValue(mockResult);

      const response = await GET();

      const data = await response.json();

      expect(data.timestamp).toBe("2024-01-15T14:30:45.123Z");
      expect(() => new Date(data.timestamp)).not.toThrow();
    });

    test("should include all error details in partial failure response", async () => {
      process.env.JANITOR_CRON_ENABLED = "true";

      const mockResult: CronExecutionResult = {
        success: false,
        workspacesProcessed: 2,
        runsCreated: 3,
        errors: [
          {
            workspaceSlug: "test-workspace",
            janitorType: JanitorType.UNIT_TESTS,
            error: "Test error message",
          },
        ],
        timestamp: new Date("2024-01-15T10:00:00Z"),
      };

      mockExecuteScheduledJanitorRuns.mockResolvedValue(mockResult);

      const response = await GET();

      const data = await response.json();

      expect(data.errors[0]).toHaveProperty("workspaceSlug");
      expect(data.errors[0]).toHaveProperty("janitorType");
      expect(data.errors[0]).toHaveProperty("error");
      expect(typeof data.errors[0].workspaceSlug).toBe("string");
      expect(typeof data.errors[0].janitorType).toBe("string");
      expect(typeof data.errors[0].error).toBe("string");
    });

    test("should include required fields in disabled response", async () => {
      process.env.JANITOR_CRON_ENABLED = "false";

      const response = await GET();

      const data = await response.json();

      expect(data).toHaveProperty("success");
      expect(data).toHaveProperty("message");
      expect(data).toHaveProperty("workspacesProcessed");
      expect(data).toHaveProperty("runsCreated");
      expect(data).toHaveProperty("errors");

      expect(data.success).toBe(true);
      expect(typeof data.message).toBe("string");
      expect(data.workspacesProcessed).toBe(0);
      expect(data.runsCreated).toBe(0);
      expect(Array.isArray(data.errors)).toBe(true);
      expect(data.errors).toHaveLength(0);
    });

    test("should include timestamp in error response", async () => {
      process.env.JANITOR_CRON_ENABLED = "true";

      mockExecuteScheduledJanitorRuns.mockRejectedValue(
        new Error("Test error")
      );

      const response = await GET();

      const data = await response.json();

      expect(data).toHaveProperty("success");
      expect(data).toHaveProperty("error");
      expect(data).toHaveProperty("timestamp");

      expect(data.success).toBe(false);
      expect(typeof data.error).toBe("string");
      expect(typeof data.timestamp).toBe("string");
      expect(() => new Date(data.timestamp)).not.toThrow();
    });
  });

  describe("Edge Cases", () => {
    test("should handle extremely large workspace counts", async () => {
      process.env.JANITOR_CRON_ENABLED = "true";

      const mockResult: CronExecutionResult = {
        success: true,
        workspacesProcessed: 1000,
        runsCreated: 4000,
        errors: [],
        timestamp: new Date("2024-01-15T10:00:00Z"),
      };

      mockExecuteScheduledJanitorRuns.mockResolvedValue(mockResult);

      const response = await GET();

      expect(response.status).toBe(200);
      const data = await response.json();

      expect(data.workspacesProcessed).toBe(1000);
      expect(data.runsCreated).toBe(4000);
    });

    test("should handle error count matching errors array length", async () => {
      process.env.JANITOR_CRON_ENABLED = "true";

      const errors = Array.from({ length: 50 }, (_, i) => ({
        workspaceSlug: `workspace-${i}`,
        janitorType: JanitorType.UNIT_TESTS,
        error: `Error ${i}`,
      }));

      const mockResult: CronExecutionResult = {
        success: false,
        workspacesProcessed: 50,
        runsCreated: 25,
        errors,
        timestamp: new Date("2024-01-15T10:00:00Z"),
      };

      mockExecuteScheduledJanitorRuns.mockResolvedValue(mockResult);

      const response = await GET();

      const data = await response.json();

      expect(data.errorCount).toBe(50);
      expect(data.errors).toHaveLength(50);
    });

    test("should handle execution completing at exact midnight UTC", async () => {
      process.env.JANITOR_CRON_ENABLED = "true";

      const midnightDate = new Date("2024-01-15T00:00:00.000Z");
      const mockResult: CronExecutionResult = {
        success: true,
        workspacesProcessed: 1,
        runsCreated: 1,
        errors: [],
        timestamp: midnightDate,
      };

      mockExecuteScheduledJanitorRuns.mockResolvedValue(mockResult);

      const response = await GET();

      const data = await response.json();

      expect(data.timestamp).toBe("2024-01-15T00:00:00.000Z");
    });
  });
});