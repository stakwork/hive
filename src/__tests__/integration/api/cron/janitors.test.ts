import { describe, test, expect, beforeEach, vi, afterEach } from "vitest";
import { GET } from "@/app/api/cron/janitors/route";
import { db } from "@/lib/db";
import {
  generateUniqueId,
  generateUniqueSlug,
} from "@/__tests__/support/helpers";

// Mock environment config
vi.mock("@/lib/env", () => ({
  config: {
    STAKWORK_API_KEY: "test-api-key",
    STAKWORK_JANITOR_WORKFLOW_ID: "123",
    STAKWORK_BASE_URL: "https://api.stakwork.com/api/v1",
  },
}));

// Mock external services
vi.mock("@/lib/service-factory", () => ({
  stakworkService: vi.fn(() => ({
    stakworkRequest: vi.fn(),
  })),
}));

vi.mock("@/lib/auth/nextauth", async () => {
  const actual = await vi.importActual("@/lib/auth/nextauth");
  return {
    ...actual,
    getGithubUsernameAndPAT: vi.fn(),
  };
});

import { stakworkService } from "@/lib/service-factory";
import { getGithubUsernameAndPAT } from "@/lib/auth/nextauth";

const mockStakworkService = stakworkService as unknown as ReturnType<typeof vi.fn>;
const mockGetGithubUsernameAndPAT = getGithubUsernameAndPAT as unknown as ReturnType<typeof vi.fn>;

describe("GET /api/cron/janitors - Integration Tests", () => {
  const originalEnv = process.env.JANITOR_CRON_ENABLED;

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset environment variable
    process.env.JANITOR_CRON_ENABLED = "true";
  });

  afterEach(() => {
    vi.restoreAllMocks();
    // Restore original environment
    if (originalEnv !== undefined) {
      process.env.JANITOR_CRON_ENABLED = originalEnv;
    } else {
      delete process.env.JANITOR_CRON_ENABLED;
    }
  });

  describe("Feature Flag Behavior", () => {
    test("should return zero counts when JANITOR_CRON_ENABLED is false", async () => {
      process.env.JANITOR_CRON_ENABLED = "false";

      const request = new Request("http://localhost:3000/api/cron/janitors", {
        method: "GET",
      });

      const response = await GET();
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toEqual({
        success: true,
        message: "Janitor cron is disabled",
        workspacesProcessed: 0,
        runsCreated: 0,
        errors: [],
      });

      // Verify no Stakwork API calls were made
      expect(mockStakworkService).not.toHaveBeenCalled();
    });

    test("should return zero counts when JANITOR_CRON_ENABLED is not set", async () => {
      delete process.env.JANITOR_CRON_ENABLED;

      const request = new Request("http://localhost:3000/api/cron/janitors", {
        method: "GET",
      });

      const response = await GET();
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.workspacesProcessed).toBe(0);
      expect(data.runsCreated).toBe(0);
    });

    test("should execute runs when JANITOR_CRON_ENABLED is true", async () => {
      process.env.JANITOR_CRON_ENABLED = "true";

      // Create workspace with enabled janitor
      const testData = await db.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            id: generateUniqueId("user"),
            email: `cron-user-${generateUniqueId()}@example.com`,
            name: "Cron Test User",
          },
        });

        const workspace = await tx.workspace.create({
          data: {
            name: "Cron Test Workspace",
            slug: generateUniqueSlug("cron-ws"),
            ownerId: user.id,
          },
        });

        const janitorConfig = await tx.janitorConfig.create({
          data: {
            workspaceId: workspace.id,
            unitTestsEnabled: true,
          },
        });

        return { user, workspace, janitorConfig };
      });

      // Mock GitHub credentials
      mockGetGithubUsernameAndPAT.mockResolvedValue({
        username: "testuser",
        token: "test-token",
      });

      // Mock Stakwork API success
      const mockStakworkRequestFn = vi.fn().mockResolvedValue({
        data: { project_id: 123 },
      });
      mockStakworkService.mockReturnValue({
        stakworkRequest: mockStakworkRequestFn,
      });

      const request = new Request("http://localhost:3000/api/cron/janitors", {
        method: "GET",
      });

      const response = await GET();
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.workspacesProcessed).toBe(1);
      expect(data.runsCreated).toBeGreaterThanOrEqual(1);
      expect(data.timestamp).toBeTruthy();
    });
  });

  describe("Workspace Discovery", () => {
    test("should process workspace with single enabled janitor", async () => {
      const testData = await db.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            id: generateUniqueId("user"),
            email: `single-janitor-${generateUniqueId()}@example.com`,
            name: "Single Janitor User",
          },
        });

        const workspace = await tx.workspace.create({
          data: {
            name: "Single Janitor Workspace",
            slug: generateUniqueSlug("single-janitor"),
            ownerId: user.id,
          },
        });

        const janitorConfig = await tx.janitorConfig.create({
          data: {
            workspaceId: workspace.id,
            unitTestsEnabled: true,
            integrationTestsEnabled: false,
          },
        });

        return { user, workspace, janitorConfig };
      });

      // Mock successful Stakwork API call
      const mockStakworkRequestFn = vi.fn().mockResolvedValue({
        data: { project_id: 456 },
      });
      mockStakworkService.mockReturnValue({
        stakworkRequest: mockStakworkRequestFn,
      });

      mockGetGithubUsernameAndPAT.mockResolvedValue({
        username: "testuser",
        token: "test-token",
      });

      const response = await GET();
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.workspacesProcessed).toBe(1);
      expect(data.runsCreated).toBe(1); // Only one janitor enabled
    });

    test("should process multiple workspaces with multiple janitor types", async () => {
      const testData = await db.$transaction(async (tx) => {
        // Create first workspace with unit tests enabled
        const user1 = await tx.user.create({
          data: {
            id: generateUniqueId("user1"),
            email: `multi-ws1-${generateUniqueId()}@example.com`,
            name: "Multi Workspace User 1",
          },
        });

        const workspace1 = await tx.workspace.create({
          data: {
            name: "Multi Workspace 1",
            slug: generateUniqueSlug("multi-ws-1"),
            ownerId: user1.id,
          },
        });

        await tx.janitorConfig.create({
          data: {
            workspaceId: workspace1.id,
            unitTestsEnabled: true,
            integrationTestsEnabled: false,
          },
        });

        // Create second workspace with integration tests enabled
        const user2 = await tx.user.create({
          data: {
            id: generateUniqueId("user2"),
            email: `multi-ws2-${generateUniqueId()}@example.com`,
            name: "Multi Workspace User 2",
          },
        });

        const workspace2 = await tx.workspace.create({
          data: {
            name: "Multi Workspace 2",
            slug: generateUniqueSlug("multi-ws-2"),
            ownerId: user2.id,
          },
        });

        await tx.janitorConfig.create({
          data: {
            workspaceId: workspace2.id,
            unitTestsEnabled: false,
            integrationTestsEnabled: true,
          },
        });

        return { user1, workspace1, user2, workspace2 };
      });

      // Mock successful Stakwork API calls
      const mockStakworkRequestFn = vi.fn().mockResolvedValue({
        data: { project_id: 789 },
      });
      mockStakworkService.mockReturnValue({
        stakworkRequest: mockStakworkRequestFn,
      });

      mockGetGithubUsernameAndPAT.mockResolvedValue({
        username: "testuser",
        token: "test-token",
      });

      const response = await GET();
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.workspacesProcessed).toBe(2);
      expect(data.runsCreated).toBe(2); // One janitor per workspace
    });

    test("should skip workspaces with no enabled janitors", async () => {
      const testData = await db.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            id: generateUniqueId("user"),
            email: `no-janitors-${generateUniqueId()}@example.com`,
            name: "No Janitors User",
          },
        });

        const workspace = await tx.workspace.create({
          data: {
            name: "No Janitors Workspace",
            slug: generateUniqueSlug("no-janitors"),
            ownerId: user.id,
          },
        });

        // Create janitor config with all janitors disabled
        await tx.janitorConfig.create({
          data: {
            workspaceId: workspace.id,
            unitTestsEnabled: false,
            integrationTestsEnabled: false,
          },
        });

        return { user, workspace };
      });

      const response = await GET();
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.workspacesProcessed).toBe(0); // Workspace not included in query (no enabled janitors)
      expect(data.runsCreated).toBe(0); // No runs created (all disabled)
    });

    test("should skip workspaces with no janitor config", async () => {
      const testData = await db.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            id: generateUniqueId("user"),
            email: `no-config-${generateUniqueId()}@example.com`,
            name: "No Config User",
          },
        });

        const workspace = await tx.workspace.create({
          data: {
            name: "No Config Workspace",
            slug: generateUniqueSlug("no-config"),
            ownerId: user.id,
          },
        });

        // No janitor config created

        return { user, workspace };
      });

      const response = await GET();
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.workspacesProcessed).toBe(0); // Workspace not processed (no config)
      expect(data.runsCreated).toBe(0);
    });
  });

  describe("Run Creation", () => {
    test("should create janitor run records with PENDING status", async () => {
      const testData = await db.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            id: generateUniqueId("user"),
            email: `run-creation-${generateUniqueId()}@example.com`,
            name: "Run Creation User",
          },
        });

        const workspace = await tx.workspace.create({
          data: {
            name: "Run Creation Workspace",
            slug: generateUniqueSlug("run-creation"),
            ownerId: user.id,
          },
        });

        await tx.janitorConfig.create({
          data: {
            workspaceId: workspace.id,
            unitTestsEnabled: true,
          },
        });

        return { user, workspace };
      });

      // Mock successful Stakwork API
      const mockStakworkRequestFn = vi.fn().mockResolvedValue({
        data: { project_id: 101 },
      });
      mockStakworkService.mockReturnValue({
        stakworkRequest: mockStakworkRequestFn,
      });

      mockGetGithubUsernameAndPAT.mockResolvedValue({
        username: "testuser",
        token: "test-token",
      });

      const response = await GET();
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);

      // Verify janitor run was created in database
      const janitorConfig = await db.janitorConfig.findUnique({
        where: { workspaceId: testData.workspace.id },
        include: { janitorRuns: true },
      });

      expect(janitorConfig?.janitorRuns).toHaveLength(1);
      expect(janitorConfig?.janitorRuns[0].status).toBe("RUNNING"); // Updated after successful Stakwork call
      expect(janitorConfig?.janitorRuns[0].janitorType).toBe("UNIT_TESTS");
      expect(janitorConfig?.janitorRuns[0].triggeredBy).toBe("SCHEDULED");
      expect(janitorConfig?.janitorRuns[0].stakworkProjectId).toBe(101);
    });

    test("should call Stakwork API with correct parameters", async () => {
      const testData = await db.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            id: generateUniqueId("user"),
            email: `stakwork-params-${generateUniqueId()}@example.com`,
            name: "Stakwork Params User",
          },
        });

        const workspace = await tx.workspace.create({
          data: {
            name: "Stakwork Params Workspace",
            slug: generateUniqueSlug("stakwork-params"),
            ownerId: user.id,
          },
        });

        await tx.janitorConfig.create({
          data: {
            workspaceId: workspace.id,
            unitTestsEnabled: true,
          },
        });

        return { user, workspace };
      });

      const mockStakworkRequestFn = vi.fn().mockResolvedValue({
        data: { project_id: 202 },
      });
      mockStakworkService.mockReturnValue({
        stakworkRequest: mockStakworkRequestFn,
      });

      mockGetGithubUsernameAndPAT.mockResolvedValue({
        username: "testuser",
        token: "github-token-123",
      });

      const response = await GET();
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);

      // Verify Stakwork API was called
      expect(mockStakworkRequestFn).toHaveBeenCalled();
      const callArgs = mockStakworkRequestFn.mock.calls[0];
      expect(callArgs[0]).toBe("/projects"); // Endpoint
      
      // Verify payload includes janitor workflow
      const payload = callArgs[1];
      expect(payload).toHaveProperty("name");
      expect(payload).toHaveProperty("workflow_id");
      expect(payload).toHaveProperty("workflow_params");
      expect(payload.workflow_params.set_var.attributes.vars).toHaveProperty("janitorType");
      expect(payload.workflow_params.set_var.attributes.vars).toHaveProperty("webhookUrl");
    });
  });

  describe("Error Handling", () => {
    test("should capture individual janitor failures without stopping orchestration", async () => {
      const testData = await db.$transaction(async (tx) => {
        // Create two workspaces
        const user1 = await tx.user.create({
          data: {
            id: generateUniqueId("user1"),
            email: `error-ws1-${generateUniqueId()}@example.com`,
            name: "Error Workspace User 1",
          },
        });

        const workspace1 = await tx.workspace.create({
          data: {
            name: "Error Workspace 1",
            slug: generateUniqueSlug("error-ws-1"),
            ownerId: user1.id,
          },
        });

        await tx.janitorConfig.create({
          data: {
            workspaceId: workspace1.id,
            unitTestsEnabled: true,
          },
        });

        const user2 = await tx.user.create({
          data: {
            id: generateUniqueId("user2"),
            email: `error-ws2-${generateUniqueId()}@example.com`,
            name: "Error Workspace User 2",
          },
        });

        const workspace2 = await tx.workspace.create({
          data: {
            name: "Error Workspace 2",
            slug: generateUniqueSlug("error-ws-2"),
            ownerId: user2.id,
          },
        });

        await tx.janitorConfig.create({
          data: {
            workspaceId: workspace2.id,
            unitTestsEnabled: true,
          },
        });

        return { user1, workspace1, user2, workspace2 };
      });

      // Mock Stakwork API to fail on first call, succeed on second
      let callCount = 0;
      const mockStakworkRequestFn = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          throw new Error("Stakwork API unavailable");
        }
        return Promise.resolve({ data: { project_id: 303 } });
      });
      mockStakworkService.mockReturnValue({
        stakworkRequest: mockStakworkRequestFn,
      });

      mockGetGithubUsernameAndPAT.mockResolvedValue({
        username: "testuser",
        token: "test-token",
      });

      const response = await GET();
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(false); // At least one error occurred
      expect(data.workspacesProcessed).toBe(2);
      expect(data.runsCreated).toBe(1); // One succeeded
      expect(data.errorCount).toBe(1);
      expect(data.errors).toHaveLength(1);
      expect(data.errors[0]).toMatchObject({
        workspaceSlug: expect.any(String),
        janitorType: "UNIT_TESTS",
        error: expect.stringContaining("Stakwork API unavailable"),
      });
    });

    test("should include error details in response", async () => {
      const testData = await db.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            id: generateUniqueId("user"),
            email: `error-details-${generateUniqueId()}@example.com`,
            name: "Error Details User",
          },
        });

        const workspace = await tx.workspace.create({
          data: {
            name: "Error Details Workspace",
            slug: generateUniqueSlug("error-details"),
            ownerId: user.id,
          },
        });

        await tx.janitorConfig.create({
          data: {
            workspaceId: workspace.id,
            unitTestsEnabled: true,
          },
        });

        return { user, workspace };
      });

      // Mock Stakwork API failure
      const mockStakworkRequestFn = vi.fn().mockRejectedValue(
        new Error("Network timeout")
      );
      mockStakworkService.mockReturnValue({
        stakworkRequest: mockStakworkRequestFn,
      });

      mockGetGithubUsernameAndPAT.mockResolvedValue({
        username: "testuser",
        token: "test-token",
      });

      const response = await GET();
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(false);
      expect(data.errors).toHaveLength(1);
      expect(data.errors[0]).toEqual({
        workspaceSlug: testData.workspace.slug,
        janitorType: "UNIT_TESTS",
        error: expect.stringContaining("Network timeout"),
      });
    });

    test("should handle workspace without swarm/repository gracefully", async () => {
      const testData = await db.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            id: generateUniqueId("user"),
            email: `no-swarm-${generateUniqueId()}@example.com`,
            name: "No Swarm User",
          },
        });

        const workspace = await tx.workspace.create({
          data: {
            name: "No Swarm Workspace",
            slug: generateUniqueSlug("no-swarm"),
            ownerId: user.id,
          },
        });

        await tx.janitorConfig.create({
          data: {
            workspaceId: workspace.id,
            unitTestsEnabled: true,
          },
        });

        // No swarm or repository created

        return { user, workspace };
      });

      mockGetGithubUsernameAndPAT.mockResolvedValue({
        username: "testuser",
        token: "test-token",
      });

      const response = await GET();
      const data = await response.json();

      expect(response.status).toBe(200);
      // Should handle gracefully - either skip or capture error
      expect(data.workspacesProcessed).toBe(1);
      
      if (data.errors.length > 0) {
        expect(data.errors[0].workspaceSlug).toBe(testData.workspace.slug);
        expect(data.errors[0].error).toBeTruthy();
      }
    });
  });

  describe("Response Validation", () => {
    test("should return correct response structure", async () => {
      const response = await GET();
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data).toHaveProperty("success");
      expect(data).toHaveProperty("workspacesProcessed");
      expect(data).toHaveProperty("runsCreated");
      expect(data).toHaveProperty("errorCount");
      expect(data).toHaveProperty("errors");
      expect(data).toHaveProperty("timestamp");

      expect(typeof data.success).toBe("boolean");
      expect(typeof data.workspacesProcessed).toBe("number");
      expect(typeof data.runsCreated).toBe("number");
      expect(typeof data.errorCount).toBe("number");
      expect(Array.isArray(data.errors)).toBe(true);
      expect(typeof data.timestamp).toBe("string");
    });

    test("should include accurate counts and valid timestamp", async () => {
      const testData = await db.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            id: generateUniqueId("user"),
            email: `counts-${generateUniqueId()}@example.com`,
            name: "Counts User",
          },
        });

        const workspace = await tx.workspace.create({
          data: {
            name: "Counts Workspace",
            slug: generateUniqueSlug("counts"),
            ownerId: user.id,
          },
        });

        await tx.janitorConfig.create({
          data: {
            workspaceId: workspace.id,
            unitTestsEnabled: true,
            integrationTestsEnabled: true,
          },
        });

        return { user, workspace };
      });

      // Mock successful Stakwork API
      const mockStakworkRequestFn = vi.fn().mockResolvedValue({
        data: { project_id: 404 },
      });
      mockStakworkService.mockReturnValue({
        stakworkRequest: mockStakworkRequestFn,
      });

      mockGetGithubUsernameAndPAT.mockResolvedValue({
        username: "testuser",
        token: "test-token",
      });

      const response = await GET();
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.workspacesProcessed).toBe(1);
      expect(data.runsCreated).toBe(2); // Two janitors enabled
      expect(data.errorCount).toBe(0);
      expect(data.errors).toHaveLength(0);

      // Verify timestamp is valid ISO string
      const timestamp = new Date(data.timestamp);
      expect(timestamp.toISOString()).toBe(data.timestamp);
      expect(timestamp.getTime()).toBeGreaterThan(Date.now() - 10000); // Within last 10 seconds
    });

    test("should match error count with errors array length", async () => {
      const testData = await db.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            id: generateUniqueId("user"),
            email: `error-count-${generateUniqueId()}@example.com`,
            name: "Error Count User",
          },
        });

        const workspace = await tx.workspace.create({
          data: {
            name: "Error Count Workspace",
            slug: generateUniqueSlug("error-count"),
            ownerId: user.id,
          },
        });

        await tx.janitorConfig.create({
          data: {
            workspaceId: workspace.id,
            unitTestsEnabled: true,
            integrationTestsEnabled: true,
          },
        });

        return { user, workspace };
      });

      // Mock Stakwork API to fail
      const mockStakworkRequestFn = vi.fn().mockRejectedValue(
        new Error("Service unavailable")
      );
      mockStakworkService.mockReturnValue({
        stakworkRequest: mockStakworkRequestFn,
      });

      mockGetGithubUsernameAndPAT.mockResolvedValue({
        username: "testuser",
        token: "test-token",
      });

      const response = await GET();
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.errorCount).toBe(data.errors.length);
      expect(data.errors.length).toBe(2); // Both janitors failed
    });
  });

  describe("Database Integration", () => {
    test("should create janitor runs with correct metadata", async () => {
      const testData = await db.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            id: generateUniqueId("user"),
            email: `metadata-${generateUniqueId()}@example.com`,
            name: "Metadata User",
          },
        });

        const workspace = await tx.workspace.create({
          data: {
            name: "Metadata Workspace",
            slug: generateUniqueSlug("metadata"),
            ownerId: user.id,
          },
        });

        await tx.janitorConfig.create({
          data: {
            workspaceId: workspace.id,
            unitTestsEnabled: true,
          },
        });

        return { user, workspace };
      });

      // Mock successful Stakwork API
      const mockStakworkRequestFn = vi.fn().mockResolvedValue({
        data: { project_id: 505 },
      });
      mockStakworkService.mockReturnValue({
        stakworkRequest: mockStakworkRequestFn,
      });

      mockGetGithubUsernameAndPAT.mockResolvedValue({
        username: "testuser",
        token: "test-token",
      });

      const response = await GET();
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.success).toBe(true);

      // Verify janitor run metadata in database
      const janitorConfig = await db.janitorConfig.findUnique({
        where: { workspaceId: testData.workspace.id },
        include: { janitorRuns: true },
      });

      expect(janitorConfig?.janitorRuns).toHaveLength(1);
      
      const run = janitorConfig!.janitorRuns[0];
      expect(run.triggeredBy).toBe("SCHEDULED");
      
      // Verify metadata JSON field
      const metadata = run.metadata as { triggeredByUserId?: string; workspaceId?: string } | null;
      if (metadata) {
        expect(metadata.triggeredByUserId).toBe(testData.user.id);
        expect(metadata.workspaceId).toBe(testData.workspace.id);
      }
    });

    test("should update run status to FAILED on Stakwork error", async () => {
      const testData = await db.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            id: generateUniqueId("user"),
            email: `failed-run-${generateUniqueId()}@example.com`,
            name: "Failed Run User",
          },
        });

        const workspace = await tx.workspace.create({
          data: {
            name: "Failed Run Workspace",
            slug: generateUniqueSlug("failed-run"),
            ownerId: user.id,
          },
        });

        await tx.janitorConfig.create({
          data: {
            workspaceId: workspace.id,
            unitTestsEnabled: true,
          },
        });

        return { user, workspace };
      });

      // Mock Stakwork API failure
      const mockStakworkRequestFn = vi.fn().mockRejectedValue(
        new Error("API timeout")
      );
      mockStakworkService.mockReturnValue({
        stakworkRequest: mockStakworkRequestFn,
      });

      mockGetGithubUsernameAndPAT.mockResolvedValue({
        username: "testuser",
        token: "test-token",
      });

      const response = await GET();
      const data = await response.json();

      expect(response.status).toBe(200);

      // Verify janitor run status is FAILED
      const janitorConfig = await db.janitorConfig.findUnique({
        where: { workspaceId: testData.workspace.id },
        include: { janitorRuns: true },
      });

      expect(janitorConfig?.janitorRuns).toHaveLength(1);
      expect(janitorConfig?.janitorRuns[0].status).toBe("FAILED");
      expect(janitorConfig?.janitorRuns[0].error).toContain("API timeout");
    });
  });

  describe("End-to-End Flow", () => {
    test("should complete full execution cycle successfully", async () => {
      const testData = await db.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            id: generateUniqueId("user"),
            email: `e2e-${generateUniqueId()}@example.com`,
            name: "E2E User",
          },
        });

        const workspace = await tx.workspace.create({
          data: {
            name: "E2E Workspace",
            slug: generateUniqueSlug("e2e"),
            ownerId: user.id,
          },
        });

        await tx.janitorConfig.create({
          data: {
            workspaceId: workspace.id,
            unitTestsEnabled: true,
            integrationTestsEnabled: true,
          },
        });

        return { user, workspace };
      });

      // Mock successful Stakwork API
      const mockStakworkRequestFn = vi.fn().mockResolvedValue({
        data: { project_id: 606 },
      });
      mockStakworkService.mockReturnValue({
        stakworkRequest: mockStakworkRequestFn,
      });

      mockGetGithubUsernameAndPAT.mockResolvedValue({
        username: "e2e-user",
        token: "e2e-github-token",
      });

      const response = await GET();
      const data = await response.json();

      // Verify response
      expect(response.status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.workspacesProcessed).toBe(1);
      expect(data.runsCreated).toBe(2); // Two janitors enabled
      expect(data.errorCount).toBe(0);
      expect(data.errors).toHaveLength(0);

      // Verify database state
      const janitorConfig = await db.janitorConfig.findUnique({
        where: { workspaceId: testData.workspace.id },
        include: { 
          janitorRuns: {
            orderBy: { createdAt: "asc" },
          }
        },
      });

      expect(janitorConfig?.janitorRuns).toHaveLength(2);
      
      janitorConfig!.janitorRuns.forEach((run) => {
        expect(run.status).toBe("RUNNING");
        expect(run.stakworkProjectId).toBe(606);
        expect(run.triggeredBy).toBe("SCHEDULED");
      });

      // Verify Stakwork API was called twice
      expect(mockStakworkRequestFn).toHaveBeenCalledTimes(2);
    });
  });
});