import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { GET } from "@/app/api/cron/janitors/route";
import { db } from "@/lib/db";
import { JanitorType, JanitorStatus } from "@prisma/client";
import {
  generateUniqueId,
  generateUniqueSlug,
} from "@/__tests__/support/helpers";
import type { User, Workspace, Swarm, JanitorConfig } from "@prisma/client";

/**
 * Integration Tests for GET /api/cron/janitors
 * 
 * Verifies:
 * 1. Feature flag control (JANITOR_CRON_ENABLED)
 * 2. Workspace discovery and janitor run orchestration
 * 3. Graceful error handling (continues on individual failures)
 * 4. Response structure validation
 * 5. External service integration (Stakwork API)
 * 6. Data integrity across system boundaries (DB state transitions)
 * 
 * Note: Mocks external APIs (Stakwork, GitHub), uses real test database
 */

// Mock external service dependencies
vi.mock("@/lib/service-factory", () => ({
  stakworkService: vi.fn(() => ({
    stakworkRequest: vi.fn(),
  })),
}));

vi.mock("@/lib/auth/nextauth", () => ({
  getGithubUsernameAndPAT: vi.fn(),
}));

// Mock environment config
vi.mock("@/lib/env", () => ({
  config: {
    STAKWORK_API_KEY: "test-stakwork-api-key",
    STAKWORK_JANITOR_WORKFLOW_ID: "123",
    STAKWORK_BASE_URL: "https://test-stakwork.com/api/v1",
  },
  env: {
    STAKWORK_API_KEY: "test-stakwork-api-key",
    POOL_MANAGER_API_KEY: "test-pool-manager-key",
    POOL_MANAGER_API_USERNAME: "test-user",
    POOL_MANAGER_API_PASSWORD: "test-pass",
    SWARM_SUPERADMIN_API_KEY: "test-swarm-key",
    SWARM_SUPER_ADMIN_URL: "https://test-swarm.com",
    STAKWORK_CUSTOMERS_EMAIL: "test@example.com",
    STAKWORK_CUSTOMERS_PASSWORD: "test-password",
  },
}));

import { stakworkService } from "@/lib/service-factory";
import { getGithubUsernameAndPAT } from "@/lib/auth/nextauth";

const mockStakworkService = stakworkService as unknown as ReturnType<typeof vi.fn>;
const mockGetGithubCreds = getGithubUsernameAndPAT as unknown as ReturnType<typeof vi.fn>;

describe("Integration: GET /api/cron/janitors", () => {
  let testUser: User;
  let testWorkspace: Workspace;
  let testSwarm: Swarm;
  let janitorConfig: JanitorConfig;

  // Helper to create test workspace with janitor config
  async function createTestWorkspaceWithJanitorConfig(options?: {
    unitTestsEnabled?: boolean;
    integrationTestsEnabled?: boolean;
    e2eTestsEnabled?: boolean;
    securityReviewEnabled?: boolean;
  }) {
    return await db.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          id: generateUniqueId("user"),
          email: `janitor-cron-${generateUniqueId()}@example.com`,
          name: "Janitor Cron Test User",
        },
      });

      const workspace = await tx.workspace.create({
        data: {
          name: `Janitor Cron Workspace ${generateUniqueId()}`,
          slug: generateUniqueSlug("janitor-cron-ws"),
          ownerId: user.id,
        },
      });

      await tx.workspaceMember.create({
        data: {
          workspaceId: workspace.id,
          userId: user.id,
          role: "OWNER",
        },
      });

      const swarm = await tx.swarm.create({
        data: {
          name: `janitor-cron-swarm-${generateUniqueId()}`,
          swarmId: generateUniqueId("swarm"),
          status: "ACTIVE",
          swarmUrl: "https://test-swarm.sphinx.chat/api",
          swarmSecretAlias: "{{TEST_SECRET}}",
          workspaceId: workspace.id,
        },
      });

      const config = await tx.janitorConfig.create({
        data: {
          workspaceId: workspace.id,
          unitTestsEnabled: options?.unitTestsEnabled ?? false,
          integrationTestsEnabled: options?.integrationTestsEnabled ?? false,
          e2eTestsEnabled: options?.e2eTestsEnabled ?? false,
          securityReviewEnabled: options?.securityReviewEnabled ?? false,
        },
      });

      await tx.repository.create({
        data: {
          name: "test-repo",
          repositoryUrl: `https://github.com/test-org/repo-${generateUniqueId()}`,
          workspaceId: workspace.id,
          status: "SYNCED",
          branch: "main",
        },
      });

      return { user, workspace, swarm, janitorConfig: config };
    });
  }

  beforeEach(async () => {
    vi.clearAllMocks();

    // Setup test data
    const testData = await createTestWorkspaceWithJanitorConfig({
      unitTestsEnabled: true,
      integrationTestsEnabled: true,
    });

    testUser = testData.user;
    testWorkspace = testData.workspace;
    testSwarm = testData.swarm;
    janitorConfig = testData.janitorConfig;

    // Mock Stakwork API responses
    const mockStakworkInstance = {
      stakworkRequest: vi.fn().mockResolvedValue({
        data: { project_id: 456 },
      }),
    };
    mockStakworkService.mockReturnValue(mockStakworkInstance);

    // Mock GitHub credentials
    mockGetGithubCreds.mockResolvedValue({
      username: "test-github-user",
      token: "test-github-token",
    });
  });

  afterEach(async () => {
    // Cleanup test data
    await db.janitorRun.deleteMany({});
    await db.janitorConfig.deleteMany({});
    await db.repository.deleteMany({});
    await db.workspaceMember.deleteMany({});
    await db.swarm.deleteMany({});
    await db.workspace.deleteMany({});
    await db.user.deleteMany({});
    vi.restoreAllMocks();
  });

  describe("Feature Flag Control", () => {
    test("should return success with zero runs when JANITOR_CRON_ENABLED is false", async () => {
      process.env.JANITOR_CRON_ENABLED = "false";

      const response = await GET();
      const result = await response.json();

      expect(response.status).toBe(200);
      expect(result.success).toBe(true);
      expect(result.message).toBe("Janitor cron is disabled");
      expect(result.workspacesProcessed).toBe(0);
      expect(result.runsCreated).toBe(0);
      expect(result.errors).toEqual([]);
    });

    test("should execute janitor runs when JANITOR_CRON_ENABLED is true", async () => {
      process.env.JANITOR_CRON_ENABLED = "true";

      const response = await GET();
      const result = await response.json();

      expect(response.status).toBe(200);
      expect(result.success).toBe(true);
      expect(result.workspacesProcessed).toBeGreaterThanOrEqual(1);
      expect(result.runsCreated).toBeGreaterThanOrEqual(1);
    });

    test("should default to disabled when JANITOR_CRON_ENABLED is undefined", async () => {
      delete process.env.JANITOR_CRON_ENABLED;

      const response = await GET();
      const result = await response.json();

      expect(response.status).toBe(200);
      expect(result.workspacesProcessed).toBe(0);
      expect(result.runsCreated).toBe(0);
    });
  });

  describe("Workspace Discovery & Orchestration", () => {
    test("should discover workspace with enabled janitors", async () => {
      process.env.JANITOR_CRON_ENABLED = "true";

      const response = await GET();
      const result = await response.json();

      expect(result.workspacesProcessed).toBeGreaterThanOrEqual(1);
    });

    test("should create runs for each enabled janitor type", async () => {
      process.env.JANITOR_CRON_ENABLED = "true";

      await GET();

      // Verify runs created for both enabled janitors (UNIT_TESTS and INTEGRATION_TESTS)
      const runs = await db.janitorRun.findMany({
        where: {
          janitorConfig: {
            workspaceId: testWorkspace.id,
          },
        },
      });

      expect(runs.length).toBeGreaterThanOrEqual(2);

      const janitorTypes = runs.map((run) => run.janitorType);
      expect(janitorTypes).toContain(JanitorType.UNIT_TESTS);
      expect(janitorTypes).toContain(JanitorType.INTEGRATION_TESTS);
    });

    test("should skip workspaces with no enabled janitors", async () => {
      // Create workspace with all janitors disabled
      await createTestWorkspaceWithJanitorConfig({
        unitTestsEnabled: false,
        integrationTestsEnabled: false,
        e2eTestsEnabled: false,
        securityReviewEnabled: false,
      });

      process.env.JANITOR_CRON_ENABLED = "true";

      const response = await GET();
      const result = await response.json();

      // Should process workspaces but not create runs for disabled janitors
      expect(result.workspacesProcessed).toBeGreaterThanOrEqual(1);
    });

    test("should skip disabled janitor types within workspace", async () => {
      process.env.JANITOR_CRON_ENABLED = "true";

      await GET();

      const runs = await db.janitorRun.findMany({
        where: {
          janitorConfig: {
            workspaceId: testWorkspace.id,
          },
        },
      });

      const janitorTypes = runs.map((run) => run.janitorType);
      expect(janitorTypes).not.toContain(JanitorType.E2E_TESTS);
      expect(janitorTypes).not.toContain(JanitorType.SECURITY_REVIEW);
    });
  });

  describe("Janitor Run Creation", () => {
    test("should create janitor run with SCHEDULED trigger", async () => {
      process.env.JANITOR_CRON_ENABLED = "true";

      await GET();

      const run = await db.janitorRun.findFirst({
        where: {
          janitorConfig: {
            workspaceId: testWorkspace.id,
          },
        },
      });

      expect(run).not.toBeNull();
      expect(run!.triggeredBy).toBe("SCHEDULED");
    });

    test("should create run with RUNNING status on successful Stakwork integration", async () => {
      process.env.JANITOR_CRON_ENABLED = "true";

      await GET();

      const run = await db.janitorRun.findFirst({
        where: {
          janitorConfig: {
            workspaceId: testWorkspace.id,
          },
        },
      });

      expect(run!.status).toBe(JanitorStatus.RUNNING);
      expect(run!.stakworkProjectId).toBe(456);
      expect(run!.startedAt).not.toBeNull();
    });

    test("should store workspace and user metadata in janitor run", async () => {
      process.env.JANITOR_CRON_ENABLED = "true";

      await GET();

      const run = await db.janitorRun.findFirst({
        where: {
          janitorConfig: {
            workspaceId: testWorkspace.id,
          },
        },
      });

      const metadata = run!.metadata as any;
      expect(metadata.workspaceId).toBe(testWorkspace.id);
      expect(metadata.triggeredByUserId).toBe(testUser.id);
    });

    test("should create multiple runs for workspace with multiple enabled janitors", async () => {
      // Enable all janitor types
      await db.janitorConfig.update({
        where: { id: janitorConfig.id },
        data: {
          unitTestsEnabled: true,
          integrationTestsEnabled: true,
          e2eTestsEnabled: true,
          securityReviewEnabled: true,
        },
      });

      process.env.JANITOR_CRON_ENABLED = "true";

      const response = await GET();
      const result = await response.json();

      expect(result.runsCreated).toBe(4);

      const runs = await db.janitorRun.findMany({
        where: {
          janitorConfig: {
            workspaceId: testWorkspace.id,
          },
        },
      });

      expect(runs).toHaveLength(4);
    });
  });

  describe("Error Handling & Graceful Degradation", () => {
    test("should collect errors without stopping orchestration", async () => {
      // Mock Stakwork to fail for first call, succeed for second
      let callCount = 0;
      const mockStakworkInstance = {
        stakworkRequest: vi.fn().mockImplementation(() => {
          callCount++;
          if (callCount === 1) {
            throw new Error("Stakwork connection failed");
          }
          return Promise.resolve({ data: { project_id: 789 } });
        }),
      };
      mockStakworkService.mockReturnValue(mockStakworkInstance);

      process.env.JANITOR_CRON_ENABLED = "true";

      const response = await GET();
      const result = await response.json();

      expect(result.success).toBe(false);
      expect(result.errorCount).toBe(1);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toMatchObject({
        workspaceSlug: testWorkspace.slug,
        error: expect.stringContaining("Stakwork"),
      });

      // Verify second janitor still created despite first failing
      expect(result.runsCreated).toBe(1);
    });

    test("should handle workspace with missing swarm gracefully", async () => {
      // Create workspace without swarm
      const { workspace: noSwarmWorkspace } = await createTestWorkspaceWithJanitorConfig({
        unitTestsEnabled: true,
      });

      // Delete swarm
      await db.swarm.deleteMany({
        where: { workspaceId: noSwarmWorkspace.id },
      });

      process.env.JANITOR_CRON_ENABLED = "true";

      const response = await GET();
      const result = await response.json();

      expect(response.status).toBe(200);
      expect(result.workspacesProcessed).toBeGreaterThanOrEqual(2);
      // Should still succeed for workspace with swarm
      expect(result.runsCreated).toBeGreaterThanOrEqual(1);
    });

    test("should handle missing GitHub credentials gracefully", async () => {
      mockGetGithubCreds.mockResolvedValue(null);

      process.env.JANITOR_CRON_ENABLED = "true";

      const response = await GET();
      const result = await response.json();

      // Should still create runs (credentials optional for janitors)
      expect(response.status).toBe(200);
      expect(result.runsCreated).toBeGreaterThanOrEqual(1);
    });

    test("should continue processing other workspaces when one fails", async () => {
      // Create second workspace
      await createTestWorkspaceWithJanitorConfig({
        unitTestsEnabled: true,
      });

      // Mock Stakwork to fail for first workspace only
      let workspaceCount = 0;
      const mockStakworkInstance = {
        stakworkRequest: vi.fn().mockImplementation(() => {
          workspaceCount++;
          if (workspaceCount <= 2) {
            // First workspace (2 janitors)
            throw new Error("First workspace failed");
          }
          return Promise.resolve({ data: { project_id: 999 } });
        }),
      };
      mockStakworkService.mockReturnValue(mockStakworkInstance);

      process.env.JANITOR_CRON_ENABLED = "true";

      const response = await GET();
      const result = await response.json();

      expect(result.workspacesProcessed).toBe(2);
      expect(result.runsCreated).toBeGreaterThanOrEqual(1);
      expect(result.errorCount).toBeGreaterThanOrEqual(1);
    });
  });

  describe("Response Structure Validation", () => {
    test("should return correct response structure", async () => {
      process.env.JANITOR_CRON_ENABLED = "true";

      const response = await GET();
      const result = await response.json();

      expect(result).toHaveProperty("success");
      expect(result).toHaveProperty("workspacesProcessed");
      expect(result).toHaveProperty("runsCreated");
      expect(result).toHaveProperty("errorCount");
      expect(result).toHaveProperty("errors");
      expect(result).toHaveProperty("timestamp");

      expect(typeof result.success).toBe("boolean");
      expect(typeof result.workspacesProcessed).toBe("number");
      expect(typeof result.runsCreated).toBe("number");
      expect(typeof result.errorCount).toBe("number");
      expect(Array.isArray(result.errors)).toBe(true);
      expect(typeof result.timestamp).toBe("string");
    });

    test("should return ISO 8601 timestamp", async () => {
      process.env.JANITOR_CRON_ENABLED = "true";

      const beforeTimestamp = new Date().toISOString();
      const response = await GET();
      const result = await response.json();
      const afterTimestamp = new Date().toISOString();

      expect(result.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
      expect(result.timestamp >= beforeTimestamp).toBe(true);
      expect(result.timestamp <= afterTimestamp).toBe(true);
    });

    test("should include error details in errors array", async () => {
      // Mock Stakwork to fail
      const mockStakworkInstance = {
        stakworkRequest: vi.fn().mockRejectedValue(new Error("Test error message")),
      };
      mockStakworkService.mockReturnValue(mockStakworkInstance);

      process.env.JANITOR_CRON_ENABLED = "true";

      const response = await GET();
      const result = await response.json();

      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toHaveProperty("workspaceSlug");
      expect(result.errors[0]).toHaveProperty("janitorType");
      expect(result.errors[0]).toHaveProperty("error");
      expect(result.errors[0].error).toContain("Test error message");
    });

    test("should return 200 status code even with errors", async () => {
      // Mock Stakwork to fail
      const mockStakworkInstance = {
        stakworkRequest: vi.fn().mockRejectedValue(new Error("Stakwork failed")),
      };
      mockStakworkService.mockReturnValue(mockStakworkInstance);

      process.env.JANITOR_CRON_ENABLED = "true";

      const response = await GET();

      expect(response.status).toBe(200);
    });
  });

  describe("External Service Integration", () => {
    test("should call Stakwork API with correct workflow parameters", async () => {
      process.env.JANITOR_CRON_ENABLED = "true";

      await GET();

      const mockStakworkInstance = mockStakworkService();
      expect(mockStakworkInstance.stakworkRequest).toHaveBeenCalled();

      const callArgs = mockStakworkInstance.stakworkRequest.mock.calls[0];
      expect(callArgs[0]).toBe("/projects");

      const payload = callArgs[1];
      expect(payload).toHaveProperty("workflow_id");
      expect(payload.workflow_params.set_var.attributes.vars).toHaveProperty("janitorType");
      expect(payload.workflow_params.set_var.attributes.vars).toHaveProperty("webhookUrl");
      expect(payload.workflow_params.set_var.attributes.vars).toHaveProperty("workspaceId");
    });

    test("should retrieve GitHub credentials for janitor runs", async () => {
      process.env.JANITOR_CRON_ENABLED = "true";

      await GET();

      expect(mockGetGithubCreds).toHaveBeenCalled();
    });

    test("should pass GitHub credentials to Stakwork workflow", async () => {
      process.env.JANITOR_CRON_ENABLED = "true";

      await GET();

      const mockStakworkInstance = mockStakworkService();
      const callArgs = mockStakworkInstance.stakworkRequest.mock.calls[0];
      const vars = callArgs[1].workflow_params.set_var.attributes.vars;

      expect(vars.username).toBe("test-github-user");
      expect(vars.pat).toBe("test-github-token");
    });

    test("should include repository context in Stakwork workflow", async () => {
      process.env.JANITOR_CRON_ENABLED = "true";

      await GET();

      const mockStakworkInstance = mockStakworkService();
      const callArgs = mockStakworkInstance.stakworkRequest.mock.calls[0];
      const vars = callArgs[1].workflow_params.set_var.attributes.vars;

      expect(vars).toHaveProperty("repositoryUrl");
      expect(vars.repositoryUrl).toContain("github.com");
    });
  });

  describe("Data Integrity & State Transitions", () => {
    test("should transition janitor run from PENDING to RUNNING", async () => {
      process.env.JANITOR_CRON_ENABLED = "true";

      await GET();

      const runs = await db.janitorRun.findMany({
        where: {
          janitorConfig: {
            workspaceId: testWorkspace.id,
          },
        },
        orderBy: { createdAt: "asc" },
      });

      expect(runs.length).toBeGreaterThan(0);
      runs.forEach((run) => {
        expect(run.status).toBe(JanitorStatus.RUNNING);
        expect(run.startedAt).not.toBeNull();
      });
    });

    test("should set janitor run to FAILED status on Stakwork error", async () => {
      // Mock Stakwork to fail
      const mockStakworkInstance = {
        stakworkRequest: vi.fn().mockRejectedValue(new Error("Stakwork error")),
      };
      mockStakworkService.mockReturnValue(mockStakworkInstance);

      process.env.JANITOR_CRON_ENABLED = "true";

      await GET();

      const run = await db.janitorRun.findFirst({
        where: {
          janitorConfig: {
            workspaceId: testWorkspace.id,
          },
        },
      });

      expect(run!.status).toBe(JanitorStatus.FAILED);
      expect(run!.error).toContain("Stakwork");
      expect(run!.completedAt).not.toBeNull();
    });

    test("should maintain referential integrity between janitor run and config", async () => {
      process.env.JANITOR_CRON_ENABLED = "true";

      await GET();

      const runs = await db.janitorRun.findMany({
        where: {
          janitorConfig: {
            workspaceId: testWorkspace.id,
          },
        },
        include: {
          janitorConfig: {
            include: {
              workspace: true,
            },
          },
        },
      });

      expect(runs.length).toBeGreaterThan(0);
      runs.forEach((run) => {
        expect(run.janitorConfigId).toBe(janitorConfig.id);
        expect(run.janitorConfig.workspaceId).toBe(testWorkspace.id);
      });
    });

    test("should create unique janitor run for each enabled type", async () => {
      process.env.JANITOR_CRON_ENABLED = "true";

      await GET();

      const runs = await db.janitorRun.findMany({
        where: {
          janitorConfig: {
            workspaceId: testWorkspace.id,
          },
        },
      });

      const janitorTypes = runs.map((run) => run.janitorType);
      const uniqueTypes = new Set(janitorTypes);

      expect(janitorTypes.length).toBe(uniqueTypes.size);
    });

    test("should not create duplicate runs on subsequent executions", async () => {
      process.env.JANITOR_CRON_ENABLED = "true";

      // First execution
      await GET();
      const firstRunCount = await db.janitorRun.count({
        where: {
          janitorConfig: {
            workspaceId: testWorkspace.id,
          },
        },
      });

      // Second execution
      await GET();
      const secondRunCount = await db.janitorRun.count({
        where: {
          janitorConfig: {
            workspaceId: testWorkspace.id,
          },
        },
      });

      // Should create additional runs (not duplicates, but new scheduled runs)
      expect(secondRunCount).toBe(firstRunCount * 2);
    });
  });

  describe("Metrics & Observability", () => {
    test("should count workspaces correctly", async () => {
      // Create additional workspace
      await createTestWorkspaceWithJanitorConfig({
        unitTestsEnabled: true,
      });

      process.env.JANITOR_CRON_ENABLED = "true";

      const response = await GET();
      const result = await response.json();

      expect(result.workspacesProcessed).toBeGreaterThanOrEqual(2);
    });

    test("should count runs created correctly", async () => {
      process.env.JANITOR_CRON_ENABLED = "true";

      const response = await GET();
      const result = await response.json();

      const actualRuns = await db.janitorRun.count();
      expect(result.runsCreated).toBe(actualRuns);
    });

    test("should match errorCount with errors array length", async () => {
      // Mock Stakwork to fail
      const mockStakworkInstance = {
        stakworkRequest: vi.fn().mockRejectedValue(new Error("Test error")),
      };
      mockStakworkService.mockReturnValue(mockStakworkInstance);

      process.env.JANITOR_CRON_ENABLED = "true";

      const response = await GET();
      const result = await response.json();

      expect(result.errorCount).toBe(result.errors.length);
    });
  });
});