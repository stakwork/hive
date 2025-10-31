import { describe, test, beforeEach, vi, expect } from "vitest";
import { GET } from "@/app/api/cron/janitors/route";
import { executeScheduledJanitorRuns } from "@/services/janitor-cron";
import type { CronExecutionResult } from "@/services/janitor-cron";
import { JanitorType } from "@prisma/client";

// Type for error objects in the response
interface CronErrorResponse {
  workspaceSlug: string;
  janitorType: JanitorType;
  error: string;
}

// Mock the janitor-cron service
vi.mock("@/services/janitor-cron", () => ({
  executeScheduledJanitorRuns: vi.fn(),
}));

const getMockedExecuteScheduledJanitorRuns = () =>
  executeScheduledJanitorRuns as ReturnType<typeof vi.fn>;

describe("GET /api/cron/janitors Integration Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset environment variables
    delete process.env.JANITOR_CRON_ENABLED;
  });

  describe("Feature Flag - JANITOR_CRON_ENABLED", () => {
    test("returns disabled message when JANITOR_CRON_ENABLED is false", async () => {
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
      expect(getMockedExecuteScheduledJanitorRuns()).not.toHaveBeenCalled();
    });

    test("returns disabled message when JANITOR_CRON_ENABLED is not set", async () => {
      // Environment variable not set (undefined)
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
      expect(getMockedExecuteScheduledJanitorRuns()).not.toHaveBeenCalled();
    });

    test("executes when JANITOR_CRON_ENABLED is true", async () => {
      process.env.JANITOR_CRON_ENABLED = "true";

      const mockResult: CronExecutionResult = {
        success: true,
        workspacesProcessed: 0,
        runsCreated: 0,
        errors: [],
        timestamp: new Date(),
      };

      getMockedExecuteScheduledJanitorRuns().mockResolvedValue(mockResult);

      const response = await GET();

      expect(response.status).toBe(200);
      expect(getMockedExecuteScheduledJanitorRuns()).toHaveBeenCalledOnce();
    });
  });

  describe("Successful Execution", () => {
    beforeEach(() => {
      process.env.JANITOR_CRON_ENABLED = "true";
    });

    test("returns successful execution results with no workspaces", async () => {
      const timestamp = new Date();
      const mockResult: CronExecutionResult = {
        success: true,
        workspacesProcessed: 0,
        runsCreated: 0,
        errors: [],
        timestamp,
      };

      getMockedExecuteScheduledJanitorRuns().mockResolvedValue(mockResult);

      const response = await GET();

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toMatchObject({
        success: true,
        workspacesProcessed: 0,
        runsCreated: 0,
        errorCount: 0,
        errors: [],
        timestamp: timestamp.toISOString(),
      });
    });

    test("returns successful execution results with multiple workspaces", async () => {
      const timestamp = new Date();
      const mockResult: CronExecutionResult = {
        success: true,
        workspacesProcessed: 3,
        runsCreated: 5,
        errors: [],
        timestamp,
      };

      getMockedExecuteScheduledJanitorRuns().mockResolvedValue(mockResult);

      const response = await GET();

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toMatchObject({
        success: true,
        workspacesProcessed: 3,
        runsCreated: 5,
        errorCount: 0,
        errors: [],
        timestamp: timestamp.toISOString(),
      });
    });

    test("returns successful execution with correct timestamp format", async () => {
      const timestamp = new Date("2024-01-15T10:30:00.000Z");
      const mockResult: CronExecutionResult = {
        success: true,
        workspacesProcessed: 1,
        runsCreated: 2,
        errors: [],
        timestamp,
      };

      getMockedExecuteScheduledJanitorRuns().mockResolvedValue(mockResult);

      const response = await GET();

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.timestamp).toBe("2024-01-15T10:30:00.000Z");
    });
  });

  describe("Error Handling - Workspace-Specific Errors", () => {
    beforeEach(() => {
      process.env.JANITOR_CRON_ENABLED = "true";
    });

    test("handles single workspace error gracefully", async () => {
      const timestamp = new Date();
      const mockResult: CronExecutionResult = {
        success: false,
        workspacesProcessed: 2,
        runsCreated: 1,
        errors: [
          {
            workspaceSlug: "workspace-1",
            janitorType: JanitorType.UNIT_TESTS,
            error: "Failed to create Stakwork project",
          },
        ],
        timestamp,
      };

      getMockedExecuteScheduledJanitorRuns().mockResolvedValue(mockResult);

      const response = await GET();

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toMatchObject({
        success: false,
        workspacesProcessed: 2,
        runsCreated: 1,
        errorCount: 1,
        errors: [
          {
            workspaceSlug: "workspace-1",
            janitorType: JanitorType.UNIT_TESTS,
            error: "Failed to create Stakwork project",
          },
        ],
        timestamp: timestamp.toISOString(),
      });
    });

    test("handles partial failures (some workspaces succeed, others fail)", async () => {
      const timestamp = new Date();
      const mockResult: CronExecutionResult = {
        success: false,
        workspacesProcessed: 5,
        runsCreated: 8,
        errors: [
          {
            workspaceSlug: "workspace-2",
            janitorType: JanitorType.E2E_TESTS,
            error: "Repository not found",
          },
          {
            workspaceSlug: "workspace-4",
            janitorType: JanitorType.SECURITY_REVIEW,
            error: "Insufficient permissions",
          },
        ],
        timestamp,
      };

      getMockedExecuteScheduledJanitorRuns().mockResolvedValue(mockResult);

      const response = await GET();

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toMatchObject({
        success: false,
        workspacesProcessed: 5,
        runsCreated: 8,
        errorCount: 2,
      });
      expect(data.errors).toHaveLength(2);
      expect(data.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            workspaceSlug: "workspace-2",
            janitorType: JanitorType.E2E_TESTS,
            error: "Repository not found",
          }),
          expect.objectContaining({
            workspaceSlug: "workspace-4",
            janitorType: JanitorType.SECURITY_REVIEW,
            error: "Insufficient permissions",
          }),
        ])
      );
    });

    test("handles multiple errors for same workspace", async () => {
      const timestamp = new Date();
      const mockResult: CronExecutionResult = {
        success: false,
        workspacesProcessed: 1,
        runsCreated: 0,
        errors: [
          {
            workspaceSlug: "workspace-1",
            janitorType: JanitorType.UNIT_TESTS,
            error: "Stakwork API timeout",
          },
          {
            workspaceSlug: "workspace-1",
            janitorType: JanitorType.INTEGRATION_TESTS,
            error: "Database connection failed",
          },
        ],
        timestamp,
      };

      getMockedExecuteScheduledJanitorRuns().mockResolvedValue(mockResult);

      const response = await GET();

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.errorCount).toBe(2);
      expect(data.errors).toHaveLength(2);
      
      // Verify both errors are for the same workspace but different janitor types
      const workspaceErrors = data.errors.filter(
        (e: CronErrorResponse) => e.workspaceSlug === "workspace-1"
      );
      expect(workspaceErrors).toHaveLength(2);
    });

    test("handles errors with all janitor types", async () => {
      const timestamp = new Date();
      const mockResult: CronExecutionResult = {
        success: false,
        workspacesProcessed: 4,
        runsCreated: 0,
        errors: [
          {
            workspaceSlug: "workspace-1",
            janitorType: JanitorType.UNIT_TESTS,
            error: "Error 1",
          },
          {
            workspaceSlug: "workspace-2",
            janitorType: JanitorType.INTEGRATION_TESTS,
            error: "Error 2",
          },
          {
            workspaceSlug: "workspace-3",
            janitorType: JanitorType.E2E_TESTS,
            error: "Error 3",
          },
          {
            workspaceSlug: "workspace-4",
            janitorType: JanitorType.SECURITY_REVIEW,
            error: "Error 4",
          },
        ],
        timestamp,
      };

      getMockedExecuteScheduledJanitorRuns().mockResolvedValue(mockResult);

      const response = await GET();

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.errorCount).toBe(4);
      
      // Verify all janitor types are represented
      const janitorTypes = data.errors.map((e: CronErrorResponse) => e.janitorType);
      expect(janitorTypes).toContain(JanitorType.UNIT_TESTS);
      expect(janitorTypes).toContain(JanitorType.INTEGRATION_TESTS);
      expect(janitorTypes).toContain(JanitorType.E2E_TESTS);
      expect(janitorTypes).toContain(JanitorType.SECURITY_REVIEW);
    });
  });

  describe("Error Handling - Unhandled Exceptions", () => {
    beforeEach(() => {
      process.env.JANITOR_CRON_ENABLED = "true";
    });

    test("handles unhandled exceptions and returns 500", async () => {
      getMockedExecuteScheduledJanitorRuns().mockRejectedValue(
        new Error("Unexpected database failure")
      );

      const response = await GET();

      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data).toMatchObject({
        success: false,
        error: "Internal server error",
      });
      expect(data.timestamp).toBeDefined();
      expect(new Date(data.timestamp)).toBeInstanceOf(Date);
    });

    test("handles non-Error exceptions and returns 500", async () => {
      getMockedExecuteScheduledJanitorRuns().mockRejectedValue(
        "String error message"
      );

      const response = await GET();

      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data).toMatchObject({
        success: false,
        error: "Internal server error",
      });
      expect(data.timestamp).toBeDefined();
    });

    test("handles null rejection and returns 500", async () => {
      getMockedExecuteScheduledJanitorRuns().mockRejectedValue(null);

      const response = await GET();

      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBe("Internal server error");
    });

    test("handles undefined rejection and returns 500", async () => {
      getMockedExecuteScheduledJanitorRuns().mockRejectedValue(undefined);

      const response = await GET();

      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.success).toBe(false);
      expect(data.error).toBe("Internal server error");
    });
  });

  describe("Health Check Behavior", () => {
    beforeEach(() => {
      process.env.JANITOR_CRON_ENABLED = "true";
    });

    test("GET endpoint returns execution status as health check", async () => {
      const timestamp = new Date();
      const mockResult: CronExecutionResult = {
        success: true,
        workspacesProcessed: 2,
        runsCreated: 3,
        errors: [],
        timestamp,
      };

      getMockedExecuteScheduledJanitorRuns().mockResolvedValue(mockResult);

      const response = await GET();

      expect(response.status).toBe(200);
      const data = await response.json();

      // Health check includes execution metadata
      expect(data).toHaveProperty("success");
      expect(data).toHaveProperty("workspacesProcessed");
      expect(data).toHaveProperty("runsCreated");
      expect(data).toHaveProperty("errorCount");
      expect(data).toHaveProperty("errors");
      expect(data).toHaveProperty("timestamp");
      expect(data.timestamp).toBe(timestamp.toISOString());
    });

    test("health check reflects error state accurately", async () => {
      const timestamp = new Date();
      const mockResult: CronExecutionResult = {
        success: false,
        workspacesProcessed: 5,
        runsCreated: 3,
        errors: [
          {
            workspaceSlug: "workspace-1",
            janitorType: JanitorType.UNIT_TESTS,
            error: "Test error",
          },
        ],
        timestamp,
      };

      getMockedExecuteScheduledJanitorRuns().mockResolvedValue(mockResult);

      const response = await GET();

      expect(response.status).toBe(200);
      const data = await response.json();
      
      expect(data.success).toBe(false);
      expect(data.errorCount).toBe(1);
      expect(data.workspacesProcessed).toBe(5);
      expect(data.runsCreated).toBe(3);
    });
  });

  describe("Response Format Validation", () => {
    beforeEach(() => {
      process.env.JANITOR_CRON_ENABLED = "true";
    });

    test("response includes all required fields for success case", async () => {
      const timestamp = new Date();
      const mockResult: CronExecutionResult = {
        success: true,
        workspacesProcessed: 1,
        runsCreated: 2,
        errors: [],
        timestamp,
      };

      getMockedExecuteScheduledJanitorRuns().mockResolvedValue(mockResult);

      const response = await GET();
      const data = await response.json();

      // Verify all required fields are present
      expect(data).toHaveProperty("success");
      expect(data).toHaveProperty("workspacesProcessed");
      expect(data).toHaveProperty("runsCreated");
      expect(data).toHaveProperty("errorCount");
      expect(data).toHaveProperty("errors");
      expect(data).toHaveProperty("timestamp");

      // Verify types
      expect(typeof data.success).toBe("boolean");
      expect(typeof data.workspacesProcessed).toBe("number");
      expect(typeof data.runsCreated).toBe("number");
      expect(typeof data.errorCount).toBe("number");
      expect(Array.isArray(data.errors)).toBe(true);
      expect(typeof data.timestamp).toBe("string");
    });

    test("error objects have correct structure", async () => {
      const timestamp = new Date();
      const mockResult: CronExecutionResult = {
        success: false,
        workspacesProcessed: 1,
        runsCreated: 0,
        errors: [
          {
            workspaceSlug: "test-workspace",
            janitorType: JanitorType.UNIT_TESTS,
            error: "Test error message",
          },
        ],
        timestamp,
      };

      getMockedExecuteScheduledJanitorRuns().mockResolvedValue(mockResult);

      const response = await GET();
      const data = await response.json();

      expect(data.errors).toHaveLength(1);
      const error = data.errors[0];
      
      expect(error).toHaveProperty("workspaceSlug");
      expect(error).toHaveProperty("janitorType");
      expect(error).toHaveProperty("error");
      
      expect(typeof error.workspaceSlug).toBe("string");
      expect(typeof error.janitorType).toBe("string");
      expect(typeof error.error).toBe("string");
    });
  });
});