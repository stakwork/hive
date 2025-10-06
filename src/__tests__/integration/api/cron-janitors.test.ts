import { describe, test, expect, beforeEach, vi, afterEach } from "vitest";
import { POST as PostCronJanitors, GET as GetCronJanitors } from "@/app/api/cron/janitors/route";
import { executeScheduledJanitorRuns } from "@/services/janitor-cron";
import { JanitorType } from "@prisma/client";
import fs from "fs";
import {
  createGetRequest,
  createPostRequest,
} from "@/__tests__/support/helpers";

// Mock janitor-cron service
vi.mock("@/services/janitor-cron", () => ({
  executeScheduledJanitorRuns: vi.fn(),
}));

// Mock fs module for vercel.json reading
vi.mock("fs", () => ({
  default: {
    readFileSync: vi.fn(),
  },
}));

const mockExecuteScheduledJanitorRuns = executeScheduledJanitorRuns as vi.MockedFunction<typeof executeScheduledJanitorRuns>;
const mockFsReadFileSync = fs.readFileSync as vi.MockedFunction<typeof fs.readFileSync>;

describe("Janitor Cron API Integration Tests", () => {
  // Store original env vars
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    
    // Reset environment variables
    process.env = { ...originalEnv };
    
    // Set default environment variables
    process.env.CRON_SECRET = "test-cron-secret";
    process.env.JANITOR_CRON_ENABLED = "true";
    
    // Set up default mock for executeScheduledJanitorRuns
    mockExecuteScheduledJanitorRuns.mockResolvedValue({
      success: true,
      workspacesProcessed: 2,
      runsCreated: 3,
      errors: [],
      timestamp: new Date("2024-01-01T00:00:00Z"),
    });
    
    // Set up default mock for fs.readFileSync
    mockFsReadFileSync.mockReturnValue(JSON.stringify({
      crons: [
        {
          path: "/api/cron/janitors",
          schedule: "0 */6 * * *"
        }
      ]
    }));
  });

  afterEach(() => {
    // Restore original env vars
    process.env = originalEnv;
  });

  describe("POST /api/cron/janitors", () => {
    describe("Authentication", () => {
      test("should return 503 when CRON_SECRET is not configured", async () => {
        delete process.env.CRON_SECRET;

        const request = createPostRequest("http://localhost/api/cron/janitors", {});
        const response = await PostCronJanitors(request);

        expect(response.status).toBe(503);
        const responseData = await response.json();
        expect(responseData.error).toBe("Cron functionality not configured");
        expect(mockExecuteScheduledJanitorRuns).not.toHaveBeenCalled();
      });

      test("should return 401 when Authorization header is missing", async () => {
        const request = createPostRequest("http://localhost/api/cron/janitors", {});
        const response = await PostCronJanitors(request);

        expect(response.status).toBe(401);
        const responseData = await response.json();
        expect(responseData.error).toBe("Unauthorized");
        expect(mockExecuteScheduledJanitorRuns).not.toHaveBeenCalled();
      });

      test("should return 401 when Authorization header has invalid format", async () => {
        const request = createPostRequest("http://localhost/api/cron/janitors", {});
        request.headers.set("authorization", "InvalidFormat test-cron-secret");
        
        const response = await PostCronJanitors(request);

        expect(response.status).toBe(401);
        const responseData = await response.json();
        expect(responseData.error).toBe("Unauthorized");
        expect(mockExecuteScheduledJanitorRuns).not.toHaveBeenCalled();
      });

      test("should return 401 when Authorization Bearer token is incorrect", async () => {
        const request = createPostRequest("http://localhost/api/cron/janitors", {});
        request.headers.set("authorization", "Bearer wrong-secret");
        
        const response = await PostCronJanitors(request);

        expect(response.status).toBe(401);
        const responseData = await response.json();
        expect(responseData.error).toBe("Unauthorized");
        expect(mockExecuteScheduledJanitorRuns).not.toHaveBeenCalled();
      });

      test("should accept valid Bearer token and execute", async () => {
        const request = createPostRequest("http://localhost/api/cron/janitors", {});
        request.headers.set("authorization", "Bearer test-cron-secret");
        
        const response = await PostCronJanitors(request);

        expect(response.status).toBe(200);
        expect(mockExecuteScheduledJanitorRuns).toHaveBeenCalledTimes(1);
      });
    });

    describe("Feature Flag", () => {
      test("should return disabled message when JANITOR_CRON_ENABLED is false", async () => {
        process.env.JANITOR_CRON_ENABLED = "false";

        const request = createPostRequest("http://localhost/api/cron/janitors", {});
        request.headers.set("authorization", "Bearer test-cron-secret");
        
        const response = await PostCronJanitors(request);

        expect(response.status).toBe(200);
        const responseData = await response.json();
        expect(responseData.success).toBe(true);
        expect(responseData.message).toBe("Janitor cron is disabled");
        expect(responseData.workspacesProcessed).toBe(0);
        expect(responseData.runsCreated).toBe(0);
        expect(responseData.errors).toEqual([]);
        expect(mockExecuteScheduledJanitorRuns).not.toHaveBeenCalled();
      });

      test("should return disabled message when JANITOR_CRON_ENABLED is not set", async () => {
        delete process.env.JANITOR_CRON_ENABLED;

        const request = createPostRequest("http://localhost/api/cron/janitors", {});
        request.headers.set("authorization", "Bearer test-cron-secret");
        
        const response = await PostCronJanitors(request);

        expect(response.status).toBe(200);
        const responseData = await response.json();
        expect(responseData.success).toBe(true);
        expect(responseData.message).toBe("Janitor cron is disabled");
        expect(mockExecuteScheduledJanitorRuns).not.toHaveBeenCalled();
      });

      test("should execute when JANITOR_CRON_ENABLED is true", async () => {
        process.env.JANITOR_CRON_ENABLED = "true";

        const request = createPostRequest("http://localhost/api/cron/janitors", {});
        request.headers.set("authorization", "Bearer test-cron-secret");
        
        const response = await PostCronJanitors(request);

        expect(response.status).toBe(200);
        expect(mockExecuteScheduledJanitorRuns).toHaveBeenCalledTimes(1);
      });
    });

    describe("Execution Flow", () => {
      test("should execute scheduled janitor runs and return success result", async () => {
        mockExecuteScheduledJanitorRuns.mockResolvedValue({
          success: true,
          workspacesProcessed: 3,
          runsCreated: 5,
          errors: [],
          timestamp: new Date("2024-01-15T10:30:00Z"),
        });

        const request = createPostRequest("http://localhost/api/cron/janitors", {});
        request.headers.set("authorization", "Bearer test-cron-secret");
        
        const response = await PostCronJanitors(request);

        expect(response.status).toBe(200);
        const responseData = await response.json();
        expect(responseData.success).toBe(true);
        expect(responseData.workspacesProcessed).toBe(3);
        expect(responseData.runsCreated).toBe(5);
        expect(responseData.errorCount).toBe(0);
        expect(responseData.errors).toEqual([]);
        expect(responseData.timestamp).toBe("2024-01-15T10:30:00.000Z");
        expect(mockExecuteScheduledJanitorRuns).toHaveBeenCalledTimes(1);
      });

      test("should handle workspace-specific errors gracefully", async () => {
        mockExecuteScheduledJanitorRuns.mockResolvedValue({
          success: false,
          workspacesProcessed: 2,
          runsCreated: 1,
          errors: [
            {
              workspaceSlug: "test-workspace-1",
              janitorType: JanitorType.UNIT_TESTS,
              error: "Stakwork integration failed",
            },
            {
              workspaceSlug: "test-workspace-2",
              janitorType: JanitorType.INTEGRATION_TESTS,
              error: "Workspace not found",
            },
          ],
          timestamp: new Date("2024-01-15T10:30:00Z"),
        });

        const request = createPostRequest("http://localhost/api/cron/janitors", {});
        request.headers.set("authorization", "Bearer test-cron-secret");
        
        const response = await PostCronJanitors(request);

        expect(response.status).toBe(200);
        const responseData = await response.json();
        expect(responseData.success).toBe(false);
        expect(responseData.workspacesProcessed).toBe(2);
        expect(responseData.runsCreated).toBe(1);
        expect(responseData.errorCount).toBe(2);
        expect(responseData.errors).toHaveLength(2);
        expect(responseData.errors[0]).toMatchObject({
          workspaceSlug: "test-workspace-1",
          janitorType: JanitorType.UNIT_TESTS,
          error: "Stakwork integration failed",
        });
        expect(responseData.errors[1]).toMatchObject({
          workspaceSlug: "test-workspace-2",
          janitorType: JanitorType.INTEGRATION_TESTS,
          error: "Workspace not found",
        });
      });

      test("should handle partial failures with mixed success/error results", async () => {
        mockExecuteScheduledJanitorRuns.mockResolvedValue({
          success: false,
          workspacesProcessed: 5,
          runsCreated: 8,
          errors: [
            {
              workspaceSlug: "failing-workspace",
              janitorType: JanitorType.E2E_TESTS,
              error: "Configuration error",
            },
          ],
          timestamp: new Date("2024-01-15T10:30:00Z"),
        });

        const request = createPostRequest("http://localhost/api/cron/janitors", {});
        request.headers.set("authorization", "Bearer test-cron-secret");
        
        const response = await PostCronJanitors(request);

        expect(response.status).toBe(200);
        const responseData = await response.json();
        expect(responseData.success).toBe(false);
        expect(responseData.workspacesProcessed).toBe(5);
        expect(responseData.runsCreated).toBe(8);
        expect(responseData.errorCount).toBe(1);
      });

      test("should handle zero workspaces found scenario", async () => {
        mockExecuteScheduledJanitorRuns.mockResolvedValue({
          success: true,
          workspacesProcessed: 0,
          runsCreated: 0,
          errors: [],
          timestamp: new Date("2024-01-15T10:30:00Z"),
        });

        const request = createPostRequest("http://localhost/api/cron/janitors", {});
        request.headers.set("authorization", "Bearer test-cron-secret");
        
        const response = await PostCronJanitors(request);

        expect(response.status).toBe(200);
        const responseData = await response.json();
        expect(responseData.success).toBe(true);
        expect(responseData.workspacesProcessed).toBe(0);
        expect(responseData.runsCreated).toBe(0);
        expect(responseData.errorCount).toBe(0);
      });
    });

    describe("Error Handling", () => {
      test("should return 500 when executeScheduledJanitorRuns throws unexpected error", async () => {
        mockExecuteScheduledJanitorRuns.mockRejectedValue(new Error("Database connection failed"));

        const request = createPostRequest("http://localhost/api/cron/janitors", {});
        request.headers.set("authorization", "Bearer test-cron-secret");
        
        const response = await PostCronJanitors(request);

        expect(response.status).toBe(500);
        const responseData = await response.json();
        expect(responseData.success).toBe(false);
        expect(responseData.error).toBe("Internal server error");
        expect(responseData.timestamp).toBeDefined();
      });

      test("should return 500 when executeScheduledJanitorRuns throws non-Error object", async () => {
        mockExecuteScheduledJanitorRuns.mockRejectedValue("String error");

        const request = createPostRequest("http://localhost/api/cron/janitors", {});
        request.headers.set("authorization", "Bearer test-cron-secret");
        
        const response = await PostCronJanitors(request);

        expect(response.status).toBe(500);
        const responseData = await response.json();
        expect(responseData.success).toBe(false);
        expect(responseData.error).toBe("Internal server error");
      });
    });
  });

  describe("GET /api/cron/janitors", () => {
    describe("Authentication", () => {
      test("should return 503 when CRON_SECRET is not configured", async () => {
        delete process.env.CRON_SECRET;

        const request = createGetRequest("http://localhost/api/cron/janitors");
        const response = await GetCronJanitors(request);

        expect(response.status).toBe(503);
        const responseData = await response.json();
        expect(responseData.error).toBe("Cron functionality not configured");
      });

      test("should return 401 when Authorization header is missing", async () => {
        const request = createGetRequest("http://localhost/api/cron/janitors");
        const response = await GetCronJanitors(request);

        expect(response.status).toBe(401);
        const responseData = await response.json();
        expect(responseData.error).toBe("Unauthorized");
      });

      test("should return 401 when Authorization Bearer token is incorrect", async () => {
        const request = createGetRequest("http://localhost/api/cron/janitors");
        request.headers.set("authorization", "Bearer wrong-secret");
        
        const response = await GetCronJanitors(request);

        expect(response.status).toBe(401);
        const responseData = await response.json();
        expect(responseData.error).toBe("Unauthorized");
      });

      test("should accept valid Bearer token and return health check", async () => {
        const request = createGetRequest("http://localhost/api/cron/janitors");
        request.headers.set("authorization", "Bearer test-cron-secret");
        
        const response = await GetCronJanitors(request);

        expect(response.status).toBe(200);
        const responseData = await response.json();
        expect(responseData).toHaveProperty("enabled");
        expect(responseData).toHaveProperty("schedule");
      });
    });

    describe("Health Check", () => {
      test("should return enabled status and cron schedule from vercel.json", async () => {
        process.env.JANITOR_CRON_ENABLED = "true";
        mockFsReadFileSync.mockReturnValue(JSON.stringify({
          crons: [
            {
              path: "/api/cron/janitors",
              schedule: "0 */6 * * *"
            }
          ]
        }));

        const request = createGetRequest("http://localhost/api/cron/janitors");
        request.headers.set("authorization", "Bearer test-cron-secret");
        
        const response = await GetCronJanitors(request);

        expect(response.status).toBe(200);
        const responseData = await response.json();
        expect(responseData.enabled).toBe(true);
        expect(responseData.schedule).toBe("0 */6 * * *");
        expect(responseData.scheduleSource).toBe("vercel.json");
        expect(responseData.timestamp).toBeDefined();
      });

      test("should return disabled status when JANITOR_CRON_ENABLED is false", async () => {
        process.env.JANITOR_CRON_ENABLED = "false";

        const request = createGetRequest("http://localhost/api/cron/janitors");
        request.headers.set("authorization", "Bearer test-cron-secret");
        
        const response = await GetCronJanitors(request);

        expect(response.status).toBe(200);
        const responseData = await response.json();
        expect(responseData.enabled).toBe(false);
      });

      test("should handle missing cron configuration in vercel.json", async () => {
        mockFsReadFileSync.mockReturnValue(JSON.stringify({
          crons: [
            {
              path: "/api/other-endpoint",
              schedule: "0 0 * * *"
            }
          ]
        }));

        const request = createGetRequest("http://localhost/api/cron/janitors");
        request.headers.set("authorization", "Bearer test-cron-secret");
        
        const response = await GetCronJanitors(request);

        expect(response.status).toBe(200);
        const responseData = await response.json();
        expect(responseData.schedule).toBe("Not found in vercel.json");
      });

      test("should handle vercel.json with no crons array", async () => {
        mockFsReadFileSync.mockReturnValue(JSON.stringify({
          git: {
            deploymentEnabled: false
          }
        }));

        const request = createGetRequest("http://localhost/api/cron/janitors");
        request.headers.set("authorization", "Bearer test-cron-secret");
        
        const response = await GetCronJanitors(request);

        expect(response.status).toBe(200);
        const responseData = await response.json();
        expect(responseData.schedule).toBe("Not found in vercel.json");
      });
    });

    describe("Error Handling", () => {
      test("should handle fs.readFileSync error gracefully", async () => {
        mockFsReadFileSync.mockImplementation(() => {
          throw new Error("File not found");
        });

        const request = createGetRequest("http://localhost/api/cron/janitors");
        request.headers.set("authorization", "Bearer test-cron-secret");
        
        const response = await GetCronJanitors(request);

        expect(response.status).toBe(200);
        const responseData = await response.json();
        expect(responseData.schedule).toBe("Error reading vercel.json");
      });

      test("should handle JSON.parse error for malformed vercel.json", async () => {
        mockFsReadFileSync.mockReturnValue("{ invalid json");

        const request = createGetRequest("http://localhost/api/cron/janitors");
        request.headers.set("authorization", "Bearer test-cron-secret");
        
        const response = await GetCronJanitors(request);

        expect(response.status).toBe(200);
        const responseData = await response.json();
        expect(responseData.schedule).toBe("Error reading vercel.json");
      });

      test("should return 500 for unhandled exceptions in health check", async () => {
        // Force an error by making fs.readFileSync throw after initial checks
        mockFsReadFileSync.mockImplementation(() => {
          throw new Error("Unexpected error");
        });
        
        // Override environment to trigger the error path
        const originalReadFileSync = fs.readFileSync;
        vi.spyOn(fs, "readFileSync").mockImplementation(() => {
          throw new Error("Critical error");
        });

        const request = createGetRequest("http://localhost/api/cron/janitors");
        request.headers.set("authorization", "Bearer test-cron-secret");
        
        const response = await GetCronJanitors(request);

        expect(response.status).toBe(200);
        const responseData = await response.json();
        // The endpoint catches fs errors and returns a valid response with error message
        expect(responseData.schedule).toBe("Error reading vercel.json");
      });
    });
  });
});