import { describe, test, expect, beforeEach, vi, afterEach } from "vitest";
import { GET } from "@/app/api/cron/janitors/route";
import { db } from "@/lib/db";
import { stakworkService } from "@/lib/service-factory";
import { JanitorType } from "@prisma/client";
import {
  createGetRequest,
  generateUniqueId,
  generateUniqueSlug,
} from "@/__tests__/support/helpers";
import { janitorMocks } from "@/__tests__/support/helpers/service-mocks/janitor-mocks";

// Mock Stakwork service
vi.mock("@/lib/service-factory", () => ({
  stakworkService: vi.fn(() => ({
    stakworkRequest: vi.fn(),
  })),
}));

// Mock environment config - make it dynamic to respond to env variable changes
vi.mock("@/lib/env", () => ({
  config: {
    get STAKWORK_API_KEY() {
      return process.env.STAKWORK_API_KEY;
    },
    get STAKWORK_JANITOR_WORKFLOW_ID() {
      return process.env.STAKWORK_JANITOR_WORKFLOW_ID;
    },
    STAKWORK_BASE_URL: "https://api.stakwork.com/api/v1",
  },
}));

const mockStakworkService = stakworkService as vi.MockedFunction<typeof stakworkService>;

describe("Cron Janitor API Integration Tests", () => {
  let originalEnv: string | undefined;

  beforeEach(() => {
    vi.clearAllMocks();

    // Store original env value
    originalEnv = process.env.JANITOR_CRON_ENABLED;

    // Set up required environment variables for tests
    process.env.STAKWORK_API_KEY = "test-api-key";
    process.env.STAKWORK_JANITOR_WORKFLOW_ID = "123";

    // Set up default Stakwork service mock
    const mockStakworkRequest = vi.fn().mockResolvedValue({
      success: true,
      data: { project_id: 123 },
    });

    mockStakworkService.mockReturnValue({
      stakworkRequest: mockStakworkRequest,
    } as any);
  });

  afterEach(async () => {
    // Restore original env value
    if (originalEnv === undefined) {
      delete process.env.JANITOR_CRON_ENABLED;
    } else {
      process.env.JANITOR_CRON_ENABLED = originalEnv;
    }

    // Clean up test data
    await db.janitorRun.deleteMany({});
    await db.janitorConfig.deleteMany({});
    await db.workspaceMember.deleteMany({});
    await db.workspace.deleteMany({});
    await db.user.deleteMany({});
  });

  async function createTestWorkspaceWithJanitorConfig(options: {
    unitTestsEnabled?: boolean;
    integrationTestsEnabled?: boolean;
    e2eTestsEnabled?: boolean;
    securityReviewEnabled?: boolean;
  } = {}) {
    return await db.$transaction(async (tx) => {
      const owner = await tx.user.create({
        data: {
          id: generateUniqueId("user"),
          email: `owner-${generateUniqueId()}@example.com`,
          name: "Test Owner",
        },
      });

      const workspace = await tx.workspace.create({
        data: {
          name: `Test Workspace ${generateUniqueId()}`,
          slug: generateUniqueSlug("test-workspace"),
          ownerId: owner.id,
        },
      });

      await tx.workspaceMember.create({
        data: {
          workspaceId: workspace.id,
          userId: owner.id,
          role: "OWNER",
        },
      });

      const janitorConfig = await tx.janitorConfig.create({
        data: {
          workspaceId: workspace.id,
          unitTestsEnabled: options.unitTestsEnabled ?? false,
          integrationTestsEnabled: options.integrationTestsEnabled ?? false,
          e2eTestsEnabled: options.e2eTestsEnabled ?? false,
          securityReviewEnabled: options.securityReviewEnabled ?? false,
        },
      });

      return { owner, workspace, janitorConfig };
    });
  }

  describe("Feature Flag Behavior", () => {
    test("should return disabled message when JANITOR_CRON_ENABLED is false", async () => {
      process.env.JANITOR_CRON_ENABLED = "false";

      const request = createGetRequest("http://localhost/api/cron/janitors");
      const response = await GET();
      const responseData = await response.json();

      expect(response.status).toBe(200);
      expect(responseData).toMatchObject({
        success: true,
        message: "Janitor cron is disabled",
        workspacesProcessed: 0,
        runsCreated: 0,
        errors: [],
      });
    });

    test("should return disabled message when JANITOR_CRON_ENABLED is not set", async () => {
      delete process.env.JANITOR_CRON_ENABLED;

      const request = createGetRequest("http://localhost/api/cron/janitors");
      const response = await GET();
      const responseData = await response.json();

      expect(response.status).toBe(200);
      expect(responseData).toMatchObject({
        success: true,
        message: "Janitor cron is disabled",
        workspacesProcessed: 0,
        runsCreated: 0,
        errors: [],
      });
    });

    test("should execute when JANITOR_CRON_ENABLED is true", async () => {
      process.env.JANITOR_CRON_ENABLED = "true";

      const request = createGetRequest("http://localhost/api/cron/janitors");
      const response = await GET();
      const responseData = await response.json();

      expect(response.status).toBe(200);
      expect(responseData).toHaveProperty("success");
      expect(responseData).toHaveProperty("workspacesProcessed");
      expect(responseData).toHaveProperty("runsCreated");
      expect(responseData).toHaveProperty("errorCount");
      expect(responseData).toHaveProperty("errors");
      expect(responseData).toHaveProperty("timestamp");
      expect(responseData.message).toBeUndefined();
    });
  });

  describe("Successful Execution", () => {
    beforeEach(() => {
      process.env.JANITOR_CRON_ENABLED = "true";
    });

    test("should successfully process workspace with single enabled janitor", async () => {
      const { workspace, janitorConfig } = await createTestWorkspaceWithJanitorConfig({
        unitTestsEnabled: true,
      });

      const request = createGetRequest("http://localhost/api/cron/janitors");
      const response = await GET();
      const responseData = await response.json();

      expect(response.status).toBe(200);
      expect(responseData.success).toBe(true);
      expect(responseData.workspacesProcessed).toBe(1);
      expect(responseData.runsCreated).toBe(1);
      expect(responseData.errorCount).toBe(0);
      expect(responseData.errors).toEqual([]);

      // Verify database record was created
      const runs = await db.janitorRun.findMany({
        where: {
          janitorConfig: {
            workspaceId: workspace.id,
          },
        },
      });
      expect(runs).toHaveLength(1);
      expect(runs[0].janitorType).toBe("UNIT_TESTS");
      expect(runs[0].triggeredBy).toBe("SCHEDULED");
      expect(runs[0].status).toBe("RUNNING");
    });

    test("should successfully process workspace with multiple enabled janitors", async () => {
      const { workspace } = await createTestWorkspaceWithJanitorConfig({
        unitTestsEnabled: true,
        integrationTestsEnabled: true,
        e2eTestsEnabled: true,
      });

      const request = createGetRequest("http://localhost/api/cron/janitors");
      const response = await GET();
      const responseData = await response.json();

      expect(response.status).toBe(200);
      expect(responseData.success).toBe(true);
      expect(responseData.workspacesProcessed).toBe(1);
      expect(responseData.runsCreated).toBe(3);
      expect(responseData.errorCount).toBe(0);

      // Verify all janitor types were created
      const runs = await db.janitorRun.findMany({
        where: {
          janitorConfig: {
            workspaceId: workspace.id,
          },
        },
        orderBy: {
          janitorType: "asc",
        },
      });
      expect(runs).toHaveLength(3);
      expect(runs.map((r) => r.janitorType)).toEqual(["UNIT_TESTS", "INTEGRATION_TESTS", "E2E_TESTS"]);
      expect(runs.every((r) => r.triggeredBy === "SCHEDULED")).toBe(true);
    });

    test("should process multiple workspaces with enabled janitors", async () => {
      const workspace1 = await createTestWorkspaceWithJanitorConfig({
        unitTestsEnabled: true,
      });
      const workspace2 = await createTestWorkspaceWithJanitorConfig({
        integrationTestsEnabled: true,
      });
      const workspace3 = await createTestWorkspaceWithJanitorConfig({
        unitTestsEnabled: true,
        e2eTestsEnabled: true,
      });

      const request = createGetRequest("http://localhost/api/cron/janitors");
      const response = await GET();
      const responseData = await response.json();

      expect(response.status).toBe(200);
      expect(responseData.success).toBe(true);
      expect(responseData.workspacesProcessed).toBe(3);
      expect(responseData.runsCreated).toBe(4); // 1 + 1 + 2
      expect(responseData.errorCount).toBe(0);
    });

    test("should return empty result when no workspaces have enabled janitors", async () => {
      // Create workspace with all janitors disabled
      await createTestWorkspaceWithJanitorConfig({
        unitTestsEnabled: false,
        integrationTestsEnabled: false,
        e2eTestsEnabled: false,
        securityReviewEnabled: false,
      });

      const request = createGetRequest("http://localhost/api/cron/janitors");
      const response = await GET();
      const responseData = await response.json();

      expect(response.status).toBe(200);
      expect(responseData.success).toBe(true);
      expect(responseData.workspacesProcessed).toBe(0);
      expect(responseData.runsCreated).toBe(0);
      expect(responseData.errorCount).toBe(0);
    });

    test("should skip deleted workspaces", async () => {
      const { workspace } = await createTestWorkspaceWithJanitorConfig({
        unitTestsEnabled: true,
      });

      // Mark workspace as deleted
      await db.workspace.update({
        where: { id: workspace.id },
        data: { deleted: true },
      });

      const request = createGetRequest("http://localhost/api/cron/janitors");
      const response = await GET();
      const responseData = await response.json();

      expect(response.status).toBe(200);
      expect(responseData.success).toBe(true);
      expect(responseData.workspacesProcessed).toBe(0);
      expect(responseData.runsCreated).toBe(0);
    });
  });

  describe("Error Handling", () => {
    beforeEach(() => {
      process.env.JANITOR_CRON_ENABLED = "true";
    });

    test("should handle Stakwork service failures gracefully", async () => {
      // Mock Stakwork service to fail
      const mockStakworkRequest = vi.fn().mockRejectedValue(new Error("Stakwork API unavailable"));
      mockStakworkService.mockReturnValue({
        stakworkRequest: mockStakworkRequest,
      } as any);

      const { workspace } = await createTestWorkspaceWithJanitorConfig({
        unitTestsEnabled: true,
      });

      const request = createGetRequest("http://localhost/api/cron/janitors");
      const response = await GET();
      const responseData = await response.json();

      expect(response.status).toBe(200);
      expect(responseData.success).toBe(false);
      expect(responseData.workspacesProcessed).toBe(1);
      expect(responseData.runsCreated).toBe(0);
      expect(responseData.errorCount).toBe(1);
      expect(responseData.errors).toHaveLength(1);
      expect(responseData.errors[0]).toMatchObject({
        workspaceSlug: workspace.slug,
        janitorType: "UNIT_TESTS",
      });
      expect(responseData.errors[0].error).toContain("Stakwork API unavailable");
    });

    test("should handle partial failures across multiple workspaces", async () => {
      // Create multiple workspaces
      const workspace1 = await createTestWorkspaceWithJanitorConfig({
        unitTestsEnabled: true,
      });
      const workspace2 = await createTestWorkspaceWithJanitorConfig({
        integrationTestsEnabled: true,
      });

      // Mock Stakwork to succeed on first call, fail on second
      let callCount = 0;
      const mockStakworkRequest = vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          return { success: true, data: { project_id: 123 } };
        } else {
          throw new Error("Stakwork failure on second call");
        }
      });
      mockStakworkService.mockReturnValue({
        stakworkRequest: mockStakworkRequest,
      } as any);

      const request = createGetRequest("http://localhost/api/cron/janitors");
      const response = await GET();
      const responseData = await response.json();

      expect(response.status).toBe(200);
      expect(responseData.success).toBe(false);
      expect(responseData.workspacesProcessed).toBe(2);
      expect(responseData.runsCreated).toBe(1);
      expect(responseData.errorCount).toBe(1);
      expect(responseData.errors).toHaveLength(1);
    });

    test("should handle missing STAKWORK_API_KEY gracefully", async () => {
      delete process.env.STAKWORK_API_KEY;

      const { workspace } = await createTestWorkspaceWithJanitorConfig({
        unitTestsEnabled: true,
      });

      const request = createGetRequest("http://localhost/api/cron/janitors");
      const response = await GET();
      const responseData = await response.json();

      expect(response.status).toBe(200);
      expect(responseData.success).toBe(false);
      expect(responseData.errorCount).toBeGreaterThan(0);
      expect(responseData.errors[0].error).toContain("STAKWORK_API_KEY");
    });

    test("should handle missing STAKWORK_JANITOR_WORKFLOW_ID gracefully", async () => {
      delete process.env.STAKWORK_JANITOR_WORKFLOW_ID;

      const { workspace } = await createTestWorkspaceWithJanitorConfig({
        unitTestsEnabled: true,
      });

      const request = createGetRequest("http://localhost/api/cron/janitors");
      const response = await GET();
      const responseData = await response.json();

      expect(response.status).toBe(200);
      expect(responseData.success).toBe(false);
      expect(responseData.errorCount).toBeGreaterThan(0);
      expect(responseData.errors[0].error).toContain("STAKWORK_JANITOR_WORKFLOW_ID");
    });

    test("should handle unhandled exceptions with 500 status", async () => {
      // Mock the executeScheduledJanitorRuns import to throw unhandled error
      const executeScheduledJanitorRuns = await import("@/services/janitor-cron");
      vi.spyOn(executeScheduledJanitorRuns, "executeScheduledJanitorRuns").mockRejectedValueOnce(new Error("Unhandled exception"));

      const request = createGetRequest("http://localhost/api/cron/janitors");
      const response = await GET();
      const responseData = await response.json();

      expect(response.status).toBe(500);
      expect(responseData.success).toBe(false);
      expect(responseData.error).toBe("Internal server error");
      expect(responseData).toHaveProperty("timestamp");
    });
  });

  describe("Response Structure Validation", () => {
    beforeEach(() => {
      process.env.JANITOR_CRON_ENABLED = "true";
    });

    test("should return valid CronExecutionResult structure", async () => {
      await createTestWorkspaceWithJanitorConfig({
        unitTestsEnabled: true,
      });

      const request = createGetRequest("http://localhost/api/cron/janitors");
      const response = await GET();
      const responseData = await response.json();

      expect(response.status).toBe(200);
      expect(responseData).toHaveProperty("success");
      expect(responseData).toHaveProperty("workspacesProcessed");
      expect(responseData).toHaveProperty("runsCreated");
      expect(responseData).toHaveProperty("errorCount");
      expect(responseData).toHaveProperty("errors");
      expect(responseData).toHaveProperty("timestamp");

      expect(typeof responseData.success).toBe("boolean");
      expect(typeof responseData.workspacesProcessed).toBe("number");
      expect(typeof responseData.runsCreated).toBe("number");
      expect(typeof responseData.errorCount).toBe("number");
      expect(Array.isArray(responseData.errors)).toBe(true);
      expect(typeof responseData.timestamp).toBe("string");
    });

    test("should return valid timestamp in ISO format", async () => {
      const request = createGetRequest("http://localhost/api/cron/janitors");
      const response = await GET();
      const responseData = await response.json();

      expect(response.status).toBe(200);
      expect(responseData.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

      const timestamp = new Date(responseData.timestamp);
      expect(timestamp).toBeInstanceOf(Date);
      expect(timestamp.getTime()).not.toBeNaN();
    });

    test("should return error details with correct structure", async () => {
      // Mock Stakwork to fail
      const mockStakworkRequest = vi.fn().mockRejectedValue(new Error("Test error"));
      mockStakworkService.mockReturnValue({
        stakworkRequest: mockStakworkRequest,
      } as any);

      const { workspace } = await createTestWorkspaceWithJanitorConfig({
        unitTestsEnabled: true,
        integrationTestsEnabled: true,
      });

      const request = createGetRequest("http://localhost/api/cron/janitors");
      const response = await GET();
      const responseData = await response.json();

      expect(response.status).toBe(200);
      expect(responseData.errors).toHaveLength(2);
      
      responseData.errors.forEach((error: any) => {
        expect(error).toHaveProperty("workspaceSlug");
        expect(error).toHaveProperty("janitorType");
        expect(error).toHaveProperty("error");
        expect(typeof error.workspaceSlug).toBe("string");
        expect(Object.values(JanitorType)).toContain(error.janitorType);
        expect(typeof error.error).toBe("string");
      });
    });

    test("should match errorCount with errors array length", async () => {
      // Mock Stakwork to fail
      const mockStakworkRequest = vi.fn().mockRejectedValue(new Error("Test error"));
      mockStakworkService.mockReturnValue({
        stakworkRequest: mockStakworkRequest,
      } as any);

      await createTestWorkspaceWithJanitorConfig({
        unitTestsEnabled: true,
        integrationTestsEnabled: true,
        e2eTestsEnabled: true,
      });

      const request = createGetRequest("http://localhost/api/cron/janitors");
      const response = await GET();
      const responseData = await response.json();

      expect(response.status).toBe(200);
      expect(responseData.errorCount).toBe(responseData.errors.length);
    });
  });

  describe("Concurrent Execution Handling", () => {
    beforeEach(() => {
      process.env.JANITOR_CRON_ENABLED = "true";
    });

    test("should allow concurrent scheduled runs of same janitor type", async () => {
      const { workspace, janitorConfig } = await createTestWorkspaceWithJanitorConfig({
        unitTestsEnabled: true,
      });

      // Create existing RUNNING janitor run
      await db.janitorRun.create({
        data: {
          janitorConfigId: janitorConfig.id,
          janitorType: "UNIT_TESTS",
          triggeredBy: "SCHEDULED",
          status: "RUNNING",
        },
      });

      const request = createGetRequest("http://localhost/api/cron/janitors");
      const response = await GET();
      const responseData = await response.json();

      expect(response.status).toBe(200);
      expect(responseData.success).toBe(true);
      expect(responseData.runsCreated).toBe(1);

      // Verify two runs exist
      const runs = await db.janitorRun.findMany({
        where: {
          janitorConfig: {
            workspaceId: workspace.id,
          },
        },
      });
      expect(runs).toHaveLength(2);
      expect(runs.every((r) => r.janitorType === "UNIT_TESTS")).toBe(true);
    });
  });
});
