import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { GET } from "@/app/api/cron/task-coordinator/route";
import { db } from "@/lib/db";
import { resetDatabase } from "@/__tests__/support/fixtures/database";
import { createTestSwarm } from "@/__tests__/support/fixtures/swarm";
import { createTestUser } from "@/__tests__/support/fixtures/user";
import { Priority, RecommendationStatus } from "@prisma/client";

// Mock external services only - database operations are real
vi.mock("@/services/pool-manager", () => ({
  PoolManagerService: vi.fn(),
}));

vi.mock("@/config/services", () => ({
  getServiceConfig: vi.fn(),
}));

// Import mocked services
const { PoolManagerService: MockPoolManagerService } = await import("@/services/pool-manager");
const { getServiceConfig: mockGetServiceConfig } = await import("@/config/services");

describe("Task Coordinator Cron Endpoint - Integration Tests", () => {
  beforeEach(async () => {
    // Clean database before each test for isolation
    await resetDatabase();
    
    // Reset all mocks
    vi.clearAllMocks();
    
    // Setup default service config mock
    vi.mocked(mockGetServiceConfig).mockReturnValue({
      baseURL: "https://pool-manager.com",
      apiKey: "test-api-key",
    } as any);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("Endpoint Configuration & Execution", () => {
    test("should return success when TASK_COORDINATOR_ENABLED is true", async () => {
      // Set environment variable
      process.env.TASK_COORDINATOR_ENABLED = "true";

      // Create workspace with sweeps disabled (no processing)
      const user = await db.user.create({
        data: {
          name: "Test Owner",
          email: "owner@example.com",
        },
      });

      await db.workspace.create({
        data: {
          name: "Test Workspace",
          slug: "test-workspace",
          ownerId: user.id,
          janitorConfig: {
            create: {
              recommendationSweepEnabled: false,
              ticketSweepEnabled: false,
            },
          },
        },
      });

      const request = new Request("http://localhost:3000/api/cron/task-coordinator", {
        method: "GET",
      });

      const response = await GET(request);
      const result = await response.json();

      expect(response.status).toBe(200);
      expect(result).toMatchObject({
        success: true,
        workspacesProcessed: 0,
        tasksCreated: 0,
        errorCount: 0,
        errors: [],
      });
      expect(result.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });

    test("should return disabled message when TASK_COORDINATOR_ENABLED is false", async () => {
      process.env.TASK_COORDINATOR_ENABLED = "false";

      const request = new Request("http://localhost:3000/api/cron/task-coordinator", {
        method: "GET",
      });

      const response = await GET(request);
      const result = await response.json();

      expect(response.status).toBe(200);
      expect(result).toMatchObject({
        success: true,
        message: "Task Coordinator is disabled",
        workspacesProcessed: 0,
        tasksCreated: 0,
        errors: [],
      });
    });

    test("should handle critical errors gracefully", async () => {
      process.env.TASK_COORDINATOR_ENABLED = "true";

      // Force a database error by mocking workspace.findMany
      const originalFindMany = db.workspace.findMany;
      vi.spyOn(db.workspace, "findMany").mockRejectedValue(new Error("Database connection lost"));

      const request = new Request("http://localhost:3000/api/cron/task-coordinator", {
        method: "GET",
      });

      const response = await GET(request);
      const result = await response.json();

      expect(response.status).toBe(200);
      expect(result.success).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].workspaceSlug).toBe("SYSTEM");
      expect(result.errors[0].error).toContain("Database connection lost");

      // Restore original function
      db.workspace.findMany = originalFindMany;
    });
  });

  describe("Orchestration - Workspace Discovery", () => {
    test("should process workspace with recommendation sweep enabled", async () => {
      process.env.TASK_COORDINATOR_ENABLED = "true";

      // Create workspace with recommendation sweep enabled
      const user = await db.user.create({
        data: {
          name: "Test Owner",
          email: "owner@example.com",
        },
      });

      const workspace = await db.workspace.create({
        data: {
          name: "Test Workspace",
          slug: "test-workspace",
          ownerId: user.id,
          janitorConfig: {
            create: {
              recommendationSweepEnabled: true,
              ticketSweepEnabled: false,
            },
          },
        },
        include: {
          janitorConfig: true,
        },
      });

      await createTestSwarm({
        workspaceId: workspace.id,
        name: "Test Swarm",
        poolName: "test-pool",
        poolApiKey: "test-pool-api-key",
      });

      // Create janitor run and recommendation
      const janitorRun = await db.janitorRun.create({
        data: {
          janitorConfigId: workspace.janitorConfig!.id,
          janitorType: "UNIT_TESTS",
          status: "COMPLETED",
        },
      });

      await db.janitorRecommendation.create({
        data: {
          janitorRunId: janitorRun.id,
          workspaceId: workspace.id,
          title: "Add unit tests",
          description: "Add unit tests for service layer",
          priority: "HIGH",
          status: "PENDING",
          impact: "Improves code quality",
        },
      });

      // Mock pool manager response - sufficient pods
      const mockPoolManager = {
        getPoolStatus: vi.fn().mockResolvedValue({
          status: {
            runningVms: 5,
            pendingVms: 0,
            failedVms: 0,
            usedVms: 2,
            unusedVms: 3,
            lastCheck: new Date().toISOString(),
          },
        }),
      };
      vi.mocked(MockPoolManagerService).mockImplementation(() => mockPoolManager as any);

      const request = new Request("http://localhost:3000/api/cron/task-coordinator", {
        method: "GET",
      });

      const response = await GET(request);
      const result = await response.json();

      expect(response.status).toBe(200);
      expect(result.success).toBe(true);
      expect(result.workspacesProcessed).toBe(1);
      expect(result.tasksCreated).toBe(1);
      expect(result.errorCount).toBe(0);

      // Verify database state - recommendation should be ACCEPTED
      const updatedRecommendation = await db.janitorRecommendation.findFirst({
        where: { workspaceId: workspace.id },
      });
      expect(updatedRecommendation?.status).toBe("ACCEPTED");
      expect(updatedRecommendation?.acceptedAt).toBeTruthy();
      expect(updatedRecommendation?.acceptedById).toBe(user.id);

      // Verify task was created with sourceType TASK_COORDINATOR
      const tasks = await db.task.findMany({
        where: { workspaceId: workspace.id },
      });
      expect(tasks).toHaveLength(1);
      expect(tasks[0].sourceType).toBe("TASK_COORDINATOR");
      expect(tasks[0].title).toBe("Add unit tests");
      expect(tasks[0].priority).toBe("HIGH");
    });

    test.skip("should process workspace with ticket sweep enabled", async () => {
      process.env.TASK_COORDINATOR_ENABLED = "true";

      // Create workspace with ticket sweep enabled
      const user = await db.user.create({
        data: {
          name: "Test Owner",
          email: "owner@example.com",
        },
      });

      const swarm = await db.swarm.create({
        data: {
          name: "Test Swarm",
          poolName: "test-pool",
          swarmUrl: "https://swarm.com/api",
          swarmSecretAlias: "{{TEST_SECRET}}",
          poolApiKey: "test-pool-api-key",
        },
      });

      const workspace = await db.workspace.create({
        data: {
          name: "Test Workspace",
          slug: "test-workspace",
          ownerId: user.id,
          swarmId: swarm.id,
          janitorConfig: {
            create: {
              recommendationSweepEnabled: false,
              ticketSweepEnabled: true,
            },
          },
        },
      });

      // Create eligible task for ticket sweep
      await db.task.create({
        data: {
          workspaceId: workspace.id,
          title: "Fix bug in authentication",
          description: "Fix authentication flow bug",
          status: "TODO",
          priority: "HIGH",
          systemAssigneeType: "TASK_COORDINATOR",
          createdById: user.id,
        },
      });

      // Mock pool manager response
      const mockPoolManager = {
        getPoolStatus: vi.fn().mockResolvedValue({
          status: {
            runningVms: 5,
            pendingVms: 0,
            failedVms: 0,
            usedVms: 2,
            unusedVms: 3,
            lastCheck: new Date().toISOString(),
          },
        }),
      };
      vi.mocked(MockPoolManagerService).mockImplementation(() => mockPoolManager as any);

      const request = new Request("http://localhost:3000/api/cron/task-coordinator", {
        method: "GET",
      });

      const response = await GET(request);
      const result = await response.json();

      expect(response.status).toBe(200);
      expect(result.success).toBe(true);
      expect(result.workspacesProcessed).toBe(1);
      expect(result.tasksCreated).toBe(1);

      // Verify task status was updated to IN_PROGRESS by workflow
      const updatedTask = await db.task.findFirst({
        where: { workspaceId: workspace.id },
      });
      expect(updatedTask?.status).toBe("IN_PROGRESS");
    });

    test("should skip workspace without swarm configuration", async () => {
      process.env.TASK_COORDINATOR_ENABLED = "true";

      const user = await db.user.create({
        data: {
          name: "Test Owner",
          email: "owner@example.com",
        },
      });

      await db.workspace.create({
        data: {
          name: "Test Workspace",
          slug: "test-workspace",
          ownerId: user.id,
          janitorConfig: {
            create: {
              recommendationSweepEnabled: true,
              ticketSweepEnabled: false,
            },
          },
        },
      });

      const request = new Request("http://localhost:3000/api/cron/task-coordinator", {
        method: "GET",
      });

      const response = await GET(request);
      const result = await response.json();

      expect(response.status).toBe(200);
      expect(result.success).toBe(true);
      expect(result.workspacesProcessed).toBe(1);
      expect(result.tasksCreated).toBe(0); // Skipped due to no swarm
    });

    test.skip("should skip workspace without pool API key", async () => {
      process.env.TASK_COORDINATOR_ENABLED = "true";

      const user = await db.user.create({
        data: {
          name: "Test Owner",
          email: "owner@example.com",
        },
      });

      const swarm = await db.swarm.create({
        data: {
          name: "Test Swarm",
          poolName: "test-pool",
          swarmUrl: "https://swarm.com/api",
          swarmSecretAlias: "{{TEST_SECRET}}",
          poolApiKey: null, // No pool API key
        },
      });

      await db.workspace.create({
        data: {
          name: "Test Workspace",
          slug: "test-workspace",
          ownerId: user.id,
          swarmId: swarm.id,
          janitorConfig: {
            create: {
              recommendationSweepEnabled: true,
              ticketSweepEnabled: false,
            },
          },
        },
      });

      const request = new Request("http://localhost:3000/api/cron/task-coordinator", {
        method: "GET",
      });

      const response = await GET(request);
      const result = await response.json();

      expect(response.status).toBe(200);
      expect(result.success).toBe(true);
      expect(result.workspacesProcessed).toBe(1);
      expect(result.tasksCreated).toBe(0); // Skipped due to no pool API key
    });
  });

  describe("Orchestration - Priority Ordering", () => {
    test.skip("should process CRITICAL priority recommendation before HIGH priority", async () => {
      process.env.TASK_COORDINATOR_ENABLED = "true";

      const user = await db.user.create({
        data: {
          name: "Test Owner",
          email: "owner@example.com",
        },
      });

      const swarm = await db.swarm.create({
        data: {
          name: "Test Swarm",
          poolName: "test-pool",
          swarmUrl: "https://swarm.com/api",
          swarmSecretAlias: "{{TEST_SECRET}}",
          poolApiKey: "test-pool-api-key",
        },
      });

      const workspace = await db.workspace.create({
        data: {
          name: "Test Workspace",
          slug: "test-workspace",
          ownerId: user.id,
          swarmId: swarm.id,
          janitorConfig: {
            create: {
              recommendationSweepEnabled: true,
              ticketSweepEnabled: false,
            },
          },
        },
        include: {
          janitorConfig: true,
        },
      });

      const janitorRun = await db.janitorRun.create({
        data: {
          janitorConfigId: workspace.janitorConfig!.id,
          janitorType: "SECURITY_REVIEW",
          status: "COMPLETED",
        },
      });

      // Create HIGH priority recommendation first (older createdAt)
      await db.janitorRecommendation.create({
        data: {
          janitorRunId: janitorRun.id,
          workspaceId: workspace.id,
          title: "High Priority Item",
          description: "High priority description",
          priority: "HIGH",
          status: "PENDING",
          impact: "Improves security",
          createdAt: new Date(Date.now() - 1000), // Created 1 second ago
        },
      });

      // Create CRITICAL priority recommendation later (newer createdAt)
      await db.janitorRecommendation.create({
        data: {
          janitorRunId: janitorRun.id,
          workspaceId: workspace.id,
          title: "Critical Priority Item",
          description: "Critical priority description",
          priority: "CRITICAL",
          status: "PENDING",
          impact: "Critical security fix",
          createdAt: new Date(), // Created now
        },
      });

      // Mock pool manager
      const mockPoolManager = {
        getPoolStatus: vi.fn().mockResolvedValue({
          status: {
            runningVms: 5,
            pendingVms: 0,
            failedVms: 0,
            usedVms: 2,
            unusedVms: 3,
            lastCheck: new Date().toISOString(),
          },
        }),
      };
      vi.mocked(MockPoolManagerService).mockImplementation(() => mockPoolManager as any);

      const request = new Request("http://localhost:3000/api/cron/task-coordinator", {
        method: "GET",
      });

      const response = await GET(request);
      const result = await response.json();

      expect(response.status).toBe(200);
      expect(result.success).toBe(true);
      expect(result.tasksCreated).toBe(1); // Only 1 recommendation processed

      // Verify CRITICAL priority was processed (accepted)
      const recommendations = await db.janitorRecommendation.findMany({
        where: { workspaceId: workspace.id },
        orderBy: { priority: "desc" },
      });

      expect(recommendations[0].priority).toBe("CRITICAL");
      expect(recommendations[0].status).toBe("ACCEPTED");
      expect(recommendations[1].priority).toBe("HIGH");
      expect(recommendations[1].status).toBe("PENDING"); // Not processed yet
    });

    test.skip("should process oldest recommendation when priorities are equal", async () => {
      process.env.TASK_COORDINATOR_ENABLED = "true";

      const user = await db.user.create({
        data: {
          name: "Test Owner",
          email: "owner@example.com",
        },
      });

      const swarm = await db.swarm.create({
        data: {
          name: "Test Swarm",
          poolName: "test-pool",
          swarmUrl: "https://swarm.com/api",
          swarmSecretAlias: "{{TEST_SECRET}}",
          poolApiKey: "test-pool-api-key",
        },
      });

      const workspace = await db.workspace.create({
        data: {
          name: "Test Workspace",
          slug: "test-workspace",
          ownerId: user.id,
          swarmId: swarm.id,
          janitorConfig: {
            create: {
              recommendationSweepEnabled: true,
              ticketSweepEnabled: false,
            },
          },
        },
        include: {
          janitorConfig: true,
        },
      });

      const janitorRun = await db.janitorRun.create({
        data: {
          janitorConfigId: workspace.janitorConfig!.id,
          janitorType: "UNIT_TESTS",
          status: "COMPLETED",
        },
      });

      // Create older HIGH priority recommendation
      const olderRec = await db.janitorRecommendation.create({
        data: {
          janitorRunId: janitorRun.id,
          workspaceId: workspace.id,
          title: "Older Recommendation",
          description: "Older description",
          priority: "HIGH",
          status: "PENDING",
          impact: "Test impact",
          createdAt: new Date(Date.now() - 5000), // 5 seconds ago
        },
      });

      // Create newer HIGH priority recommendation
      await db.janitorRecommendation.create({
        data: {
          janitorRunId: janitorRun.id,
          workspaceId: workspace.id,
          title: "Newer Recommendation",
          description: "Newer description",
          priority: "HIGH",
          status: "PENDING",
          impact: "Test impact",
          createdAt: new Date(), // Now
        },
      });

      // Mock pool manager
      const mockPoolManager = {
        getPoolStatus: vi.fn().mockResolvedValue({
          status: {
            runningVms: 5,
            pendingVms: 0,
            failedVms: 0,
            usedVms: 2,
            unusedVms: 3,
            lastCheck: new Date().toISOString(),
          },
        }),
      };
      vi.mocked(MockPoolManagerService).mockImplementation(() => mockPoolManager as any);

      const request = new Request("http://localhost:3000/api/cron/task-coordinator", {
        method: "GET",
      });

      const response = await GET(request);
      const result = await response.json();

      expect(response.status).toBe(200);
      expect(result.success).toBe(true);
      expect(result.tasksCreated).toBe(1);

      // Verify older recommendation was accepted
      const acceptedRec = await db.janitorRecommendation.findUnique({
        where: { id: olderRec.id },
      });
      expect(acceptedRec?.status).toBe("ACCEPTED");
    });
  });

  describe("Orchestration - Rate Limiting", () => {
    test.skip("should process only 1 recommendation per workspace per run", async () => {
      process.env.TASK_COORDINATOR_ENABLED = "true";

      const user = await db.user.create({
        data: {
          name: "Test Owner",
          email: "owner@example.com",
        },
      });

      const swarm = await db.swarm.create({
        data: {
          name: "Test Swarm",
          poolName: "test-pool",
          swarmUrl: "https://swarm.com/api",
          swarmSecretAlias: "{{TEST_SECRET}}",
          poolApiKey: "test-pool-api-key",
        },
      });

      const workspace = await db.workspace.create({
        data: {
          name: "Test Workspace",
          slug: "test-workspace",
          ownerId: user.id,
          swarmId: swarm.id,
          janitorConfig: {
            create: {
              recommendationSweepEnabled: true,
              ticketSweepEnabled: false,
            },
          },
        },
        include: {
          janitorConfig: true,
        },
      });

      const janitorRun = await db.janitorRun.create({
        data: {
          janitorConfigId: workspace.janitorConfig!.id,
          janitorType: "UNIT_TESTS",
          status: "COMPLETED",
        },
      });

      // Create 5 pending recommendations
      for (let i = 0; i < 5; i++) {
        await db.janitorRecommendation.create({
          data: {
            janitorRunId: janitorRun.id,
            workspaceId: workspace.id,
            title: `Recommendation ${i + 1}`,
            description: `Description ${i + 1}`,
            priority: "MEDIUM",
            status: "PENDING",
            impact: "Test impact",
          },
        });
      }

      // Mock pool manager
      const mockPoolManager = {
        getPoolStatus: vi.fn().mockResolvedValue({
          status: {
            runningVms: 5,
            pendingVms: 0,
            failedVms: 0,
            usedVms: 2,
            unusedVms: 3,
            lastCheck: new Date().toISOString(),
          },
        }),
      };
      vi.mocked(MockPoolManagerService).mockImplementation(() => mockPoolManager as any);

      const request = new Request("http://localhost:3000/api/cron/task-coordinator", {
        method: "GET",
      });

      const response = await GET(request);
      const result = await response.json();

      expect(response.status).toBe(200);
      expect(result.success).toBe(true);
      expect(result.tasksCreated).toBe(1); // Only 1 task created despite 5 pending

      // Verify only 1 recommendation was accepted
      const acceptedRecs = await db.janitorRecommendation.findMany({
        where: {
          workspaceId: workspace.id,
          status: "ACCEPTED",
        },
      });
      expect(acceptedRecs).toHaveLength(1);

      // Verify 4 are still pending
      const pendingRecs = await db.janitorRecommendation.findMany({
        where: {
          workspaceId: workspace.id,
          status: "PENDING",
        },
      });
      expect(pendingRecs).toHaveLength(4);
    });
  });

  describe("Orchestration - Resource Availability", () => {
    test.skip("should skip workspace when only 1 pod available (requires 2+)", async () => {
      process.env.TASK_COORDINATOR_ENABLED = "true";

      const user = await db.user.create({
        data: {
          name: "Test Owner",
          email: "owner@example.com",
        },
      });

      const swarm = await db.swarm.create({
        data: {
          name: "Test Swarm",
          poolName: "test-pool",
          swarmUrl: "https://swarm.com/api",
          swarmSecretAlias: "{{TEST_SECRET}}",
          poolApiKey: "test-pool-api-key",
        },
      });

      const workspace = await db.workspace.create({
        data: {
          name: "Test Workspace",
          slug: "test-workspace",
          ownerId: user.id,
          swarmId: swarm.id,
          janitorConfig: {
            create: {
              recommendationSweepEnabled: true,
              ticketSweepEnabled: false,
            },
          },
        },
        include: {
          janitorConfig: true,
        },
      });

      const janitorRun = await db.janitorRun.create({
        data: {
          janitorConfigId: workspace.janitorConfig!.id,
          janitorType: "UNIT_TESTS",
          status: "COMPLETED",
        },
      });

      await db.janitorRecommendation.create({
        data: {
          janitorRunId: janitorRun.id,
          workspaceId: workspace.id,
          title: "Test Recommendation",
          description: "Test description",
          priority: "HIGH",
          status: "PENDING",
          impact: "Test impact",
        },
      });

      // Mock pool manager with insufficient pods
      const mockPoolManager = {
        getPoolStatus: vi.fn().mockResolvedValue({
          status: {
            runningVms: 5,
            pendingVms: 0,
            failedVms: 0,
            usedVms: 4,
            unusedVms: 1, // Only 1 unused VM (requires 2+)
            lastCheck: new Date().toISOString(),
          },
        }),
      };
      vi.mocked(MockPoolManagerService).mockImplementation(() => mockPoolManager as any);

      const request = new Request("http://localhost:3000/api/cron/task-coordinator", {
        method: "GET",
      });

      const response = await GET(request);
      const result = await response.json();

      expect(response.status).toBe(200);
      expect(result.success).toBe(true);
      expect(result.workspacesProcessed).toBe(1);
      expect(result.tasksCreated).toBe(0); // Skipped due to insufficient pods

      // Verify recommendation is still pending
      const recommendation = await db.janitorRecommendation.findFirst({
        where: { workspaceId: workspace.id },
      });
      expect(recommendation?.status).toBe("PENDING");
    });

    test.skip("should process workspace when exactly 2 pods available", async () => {
      process.env.TASK_COORDINATOR_ENABLED = "true";

      const user = await db.user.create({
        data: {
          name: "Test Owner",
          email: "owner@example.com",
        },
      });

      const swarm = await db.swarm.create({
        data: {
          name: "Test Swarm",
          poolName: "test-pool",
          swarmUrl: "https://swarm.com/api",
          swarmSecretAlias: "{{TEST_SECRET}}",
          poolApiKey: "test-pool-api-key",
        },
      });

      const workspace = await db.workspace.create({
        data: {
          name: "Test Workspace",
          slug: "test-workspace",
          ownerId: user.id,
          swarmId: swarm.id,
          janitorConfig: {
            create: {
              recommendationSweepEnabled: true,
              ticketSweepEnabled: false,
            },
          },
        },
        include: {
          janitorConfig: true,
        },
      });

      const janitorRun = await db.janitorRun.create({
        data: {
          janitorConfigId: workspace.janitorConfig!.id,
          janitorType: "UNIT_TESTS",
          status: "COMPLETED",
        },
      });

      await db.janitorRecommendation.create({
        data: {
          janitorRunId: janitorRun.id,
          workspaceId: workspace.id,
          title: "Test Recommendation",
          description: "Test description",
          priority: "HIGH",
          status: "PENDING",
          impact: "Test impact",
        },
      });

      // Mock pool manager with exactly 2 unused pods
      const mockPoolManager = {
        getPoolStatus: vi.fn().mockResolvedValue({
          status: {
            runningVms: 5,
            pendingVms: 0,
            failedVms: 0,
            usedVms: 3,
            unusedVms: 2, // Exactly 2 unused VMs
            lastCheck: new Date().toISOString(),
          },
        }),
      };
      vi.mocked(MockPoolManagerService).mockImplementation(() => mockPoolManager as any);

      const request = new Request("http://localhost:3000/api/cron/task-coordinator", {
        method: "GET",
      });

      const response = await GET(request);
      const result = await response.json();

      expect(response.status).toBe(200);
      expect(result.success).toBe(true);
      expect(result.tasksCreated).toBe(1); // Processed successfully

      // Verify recommendation was accepted
      const recommendation = await db.janitorRecommendation.findFirst({
        where: { workspaceId: workspace.id },
      });
      expect(recommendation?.status).toBe("ACCEPTED");
    });
  });

  describe("Error Handling - Workspace-Level Isolation", () => {
    test.skip("should continue processing other workspaces when one fails", async () => {
      process.env.TASK_COORDINATOR_ENABLED = "true";

      const user = await db.user.create({
        data: {
          name: "Test Owner",
          email: "owner@example.com",
        },
      });

      // Create first workspace with valid configuration
      const swarm1 = await db.swarm.create({
        data: {
          name: "Test Swarm 1",
          poolName: "test-pool-1",
          swarmUrl: "https://swarm1.com/api",
          swarmSecretAlias: "{{TEST_SECRET_1}}",
          poolApiKey: "test-pool-api-key-1",
        },
      });

      const workspace1 = await db.workspace.create({
        data: {
          name: "Test Workspace 1",
          slug: "test-workspace-1",
          ownerId: user.id,
          swarmId: swarm1.id,
          janitorConfig: {
            create: {
              recommendationSweepEnabled: true,
              ticketSweepEnabled: false,
            },
          },
        },
        include: {
          janitorConfig: true,
        },
      });

      const janitorRun1 = await db.janitorRun.create({
        data: {
          janitorConfigId: workspace1.janitorConfig!.id,
          janitorType: "UNIT_TESTS",
          status: "COMPLETED",
        },
      });

      await db.janitorRecommendation.create({
        data: {
          janitorRunId: janitorRun1.id,
          workspaceId: workspace1.id,
          title: "Recommendation 1",
          description: "Description 1",
          priority: "HIGH",
          status: "PENDING",
          impact: "Test impact",
        },
      });

      // Create second workspace
      const swarm2 = await db.swarm.create({
        data: {
          name: "Test Swarm 2",
          poolName: "test-pool-2",
          swarmUrl: "https://swarm2.com/api",
          swarmSecretAlias: "{{TEST_SECRET_2}}",
          poolApiKey: "test-pool-api-key-2",
        },
      });

      const workspace2 = await db.workspace.create({
        data: {
          name: "Test Workspace 2",
          slug: "test-workspace-2",
          ownerId: user.id,
          swarmId: swarm2.id,
          janitorConfig: {
            create: {
              recommendationSweepEnabled: true,
              ticketSweepEnabled: false,
            },
          },
        },
        include: {
          janitorConfig: true,
        },
      });

      const janitorRun2 = await db.janitorRun.create({
        data: {
          janitorConfigId: workspace2.janitorConfig!.id,
          janitorType: "UNIT_TESTS",
          status: "COMPLETED",
        },
      });

      await db.janitorRecommendation.create({
        data: {
          janitorRunId: janitorRun2.id,
          workspaceId: workspace2.id,
          title: "Recommendation 2",
          description: "Description 2",
          priority: "HIGH",
          status: "PENDING",
          impact: "Test impact",
        },
      });

      // Mock pool manager: first call fails, second succeeds
      const mockPoolManager1 = {
        getPoolStatus: vi.fn().mockRejectedValue(new Error("Pool API connection timeout")),
      };
      const mockPoolManager2 = {
        getPoolStatus: vi.fn().mockResolvedValue({
          status: {
            runningVms: 5,
            pendingVms: 0,
            failedVms: 0,
            usedVms: 2,
            unusedVms: 3,
            lastCheck: new Date().toISOString(),
          },
        }),
      };

      vi.mocked(MockPoolManagerService)
        .mockImplementationOnce(() => mockPoolManager1 as any)
        .mockImplementationOnce(() => mockPoolManager2 as any);

      const request = new Request("http://localhost:3000/api/cron/task-coordinator", {
        method: "GET",
      });

      const response = await GET(request);
      const result = await response.json();

      expect(response.status).toBe(200);
      expect(result.success).toBe(false); // One workspace had error
      expect(result.workspacesProcessed).toBe(2);
      expect(result.tasksCreated).toBe(1); // Second workspace succeeded
      expect(result.errorCount).toBe(1);
      expect(result.errors[0].workspaceSlug).toBe("test-workspace-1");
      expect(result.errors[0].error).toContain("Pool API connection timeout");

      // Verify second workspace recommendation was accepted
      const rec2 = await db.janitorRecommendation.findFirst({
        where: { workspaceId: workspace2.id },
      });
      expect(rec2?.status).toBe("ACCEPTED");
    });
  });

  describe("Error Handling - Sweep-Level Independence", () => {
    test.skip("should process recommendation sweep even if ticket sweep fails", async () => {
      process.env.TASK_COORDINATOR_ENABLED = "true";

      const user = await db.user.create({
        data: {
          name: "Test Owner",
          email: "owner@example.com",
        },
      });

      const swarm = await db.swarm.create({
        data: {
          name: "Test Swarm",
          poolName: "test-pool",
          swarmUrl: "https://swarm.com/api",
          swarmSecretAlias: "{{TEST_SECRET}}",
          poolApiKey: "test-pool-api-key",
        },
      });

      const workspace = await db.workspace.create({
        data: {
          name: "Test Workspace",
          slug: "test-workspace",
          ownerId: user.id,
          swarmId: swarm.id,
          janitorConfig: {
            create: {
              recommendationSweepEnabled: true,
              ticketSweepEnabled: true, // Both sweeps enabled
            },
          },
        },
        include: {
          janitorConfig: true,
        },
      });

      // Create task for ticket sweep (will fail due to missing workflow)
      await db.task.create({
        data: {
          workspaceId: workspace.id,
          title: "Ticket Task",
          description: "Ticket description",
          status: "TODO",
          priority: "HIGH",
          systemAssigneeType: "TASK_COORDINATOR",
          createdById: user.id,
        },
      });

      // Create recommendation for recommendation sweep
      const janitorRun = await db.janitorRun.create({
        data: {
          janitorConfigId: workspace.janitorConfig!.id,
          janitorType: "UNIT_TESTS",
          status: "COMPLETED",
        },
      });

      await db.janitorRecommendation.create({
        data: {
          janitorRunId: janitorRun.id,
          workspaceId: workspace.id,
          title: "Recommendation Task",
          description: "Recommendation description",
          priority: "HIGH",
          status: "PENDING",
          impact: "Test impact",
        },
      });

      // Mock pool manager
      const mockPoolManager = {
        getPoolStatus: vi.fn().mockResolvedValue({
          status: {
            runningVms: 5,
            pendingVms: 0,
            failedVms: 0,
            usedVms: 2,
            unusedVms: 3,
            lastCheck: new Date().toISOString(),
          },
        }),
      };
      vi.mocked(MockPoolManagerService).mockImplementation(() => mockPoolManager as any);

      const request = new Request("http://localhost:3000/api/cron/task-coordinator", {
        method: "GET",
      });

      const response = await GET(request);
      const result = await response.json();

      expect(response.status).toBe(200);
      // Ticket sweep will fail (missing workspace.repositories), but recommendation sweep should succeed
      expect(result.tasksCreated).toBeGreaterThanOrEqual(1);

      // Verify recommendation was still processed
      const recommendation = await db.janitorRecommendation.findFirst({
        where: { workspaceId: workspace.id },
      });
      expect(recommendation?.status).toBe("ACCEPTED");
    });
  });

  describe("Downstream Process Triggering - Recommendation Sweep", () => {
    test.skip("should create task with sourceType TASK_COORDINATOR when accepting recommendation", async () => {
      process.env.TASK_COORDINATOR_ENABLED = "true";

      const user = await db.user.create({
        data: {
          name: "Test Owner",
          email: "owner@example.com",
        },
      });

      const swarm = await db.swarm.create({
        data: {
          name: "Test Swarm",
          poolName: "test-pool",
          swarmUrl: "https://swarm.com/api",
          swarmSecretAlias: "{{TEST_SECRET}}",
          poolApiKey: "test-pool-api-key",
        },
      });

      const workspace = await db.workspace.create({
        data: {
          name: "Test Workspace",
          slug: "test-workspace",
          ownerId: user.id,
          swarmId: swarm.id,
          janitorConfig: {
            create: {
              recommendationSweepEnabled: true,
              ticketSweepEnabled: false,
            },
          },
        },
        include: {
          janitorConfig: true,
        },
      });

      const janitorRun = await db.janitorRun.create({
        data: {
          janitorConfigId: workspace.janitorConfig!.id,
          janitorType: "SECURITY_REVIEW",
          status: "COMPLETED",
        },
      });

      await db.janitorRecommendation.create({
        data: {
          janitorRunId: janitorRun.id,
          workspaceId: workspace.id,
          title: "Fix SQL injection vulnerability",
          description: "Implement parameterized queries",
          priority: "CRITICAL",
          status: "PENDING",
          impact: "Prevents SQL injection attacks",
        },
      });

      // Mock pool manager
      const mockPoolManager = {
        getPoolStatus: vi.fn().mockResolvedValue({
          status: {
            runningVms: 5,
            pendingVms: 0,
            failedVms: 0,
            usedVms: 2,
            unusedVms: 3,
            lastCheck: new Date().toISOString(),
          },
        }),
      };
      vi.mocked(MockPoolManagerService).mockImplementation(() => mockPoolManager as any);

      const request = new Request("http://localhost:3000/api/cron/task-coordinator", {
        method: "GET",
      });

      const response = await GET(request);
      const result = await response.json();

      expect(response.status).toBe(200);
      expect(result.success).toBe(true);
      expect(result.tasksCreated).toBe(1);

      // Verify task was created with correct sourceType
      const tasks = await db.task.findMany({
        where: { workspaceId: workspace.id },
      });

      expect(tasks).toHaveLength(1);
      expect(tasks[0].sourceType).toBe("TASK_COORDINATOR");
      expect(tasks[0].title).toBe("Fix SQL injection vulnerability");
      expect(tasks[0].description).toBe("Implement parameterized queries");
      expect(tasks[0].priority).toBe("CRITICAL");
      expect(tasks[0].status).toBe("IN_PROGRESS"); // Started by workflow
      expect(tasks[0].createdById).toBe(user.id); // Created by workspace owner
    });

    test.skip("should update recommendation status from PENDING to ACCEPTED", async () => {
      process.env.TASK_COORDINATOR_ENABLED = "true";

      const user = await db.user.create({
        data: {
          name: "Test Owner",
          email: "owner@example.com",
        },
      });

      const swarm = await db.swarm.create({
        data: {
          name: "Test Swarm",
          poolName: "test-pool",
          swarmUrl: "https://swarm.com/api",
          swarmSecretAlias: "{{TEST_SECRET}}",
          poolApiKey: "test-pool-api-key",
        },
      });

      const workspace = await db.workspace.create({
        data: {
          name: "Test Workspace",
          slug: "test-workspace",
          ownerId: user.id,
          swarmId: swarm.id,
          janitorConfig: {
            create: {
              recommendationSweepEnabled: true,
              ticketSweepEnabled: false,
            },
          },
        },
        include: {
          janitorConfig: true,
        },
      });

      const janitorRun = await db.janitorRun.create({
        data: {
          janitorConfigId: workspace.janitorConfig!.id,
          janitorType: "UNIT_TESTS",
          status: "COMPLETED",
        },
      });

      const recommendation = await db.janitorRecommendation.create({
        data: {
          janitorRunId: janitorRun.id,
          workspaceId: workspace.id,
          title: "Add unit tests",
          description: "Add comprehensive unit tests",
          priority: "HIGH",
          status: "PENDING",
          impact: "Improves code quality",
        },
      });

      // Mock pool manager
      const mockPoolManager = {
        getPoolStatus: vi.fn().mockResolvedValue({
          status: {
            runningVms: 5,
            pendingVms: 0,
            failedVms: 0,
            usedVms: 2,
            unusedVms: 3,
            lastCheck: new Date().toISOString(),
          },
        }),
      };
      vi.mocked(MockPoolManagerService).mockImplementation(() => mockPoolManager as any);

      const request = new Request("http://localhost:3000/api/cron/task-coordinator", {
        method: "GET",
      });

      const response = await GET(request);
      const result = await response.json();

      expect(response.status).toBe(200);
      expect(result.success).toBe(true);

      // Verify recommendation status was updated
      const updatedRecommendation = await db.janitorRecommendation.findUnique({
        where: { id: recommendation.id },
      });

      expect(updatedRecommendation?.status).toBe("ACCEPTED");
      expect(updatedRecommendation?.acceptedAt).toBeTruthy();
      expect(updatedRecommendation?.acceptedById).toBe(user.id);
    });

    test("should set acceptedById to workspace owner", async () => {
      process.env.TASK_COORDINATOR_ENABLED = "true";

      const user = await db.user.create({
        data: {
          name: "Test Owner",
          email: "owner@example.com",
        },
      });

      const workspace = await db.workspace.create({
        data: {
          name: "Test Workspace",
          slug: "test-workspace",
          ownerId: user.id,
          janitorConfig: {
            create: {
              recommendationSweepEnabled: true,
              ticketSweepEnabled: false,
            },
          },
        },
        include: {
          janitorConfig: true,
        },
      });

      await createTestSwarm({
        workspaceId: workspace.id,
        name: "Test Swarm",
        poolName: "test-pool",
        poolApiKey: "test-pool-api-key",
      });

      const janitorRun = await db.janitorRun.create({
        data: {
          janitorConfigId: workspace.janitorConfig!.id,
          janitorType: "UNIT_TESTS",
          status: "COMPLETED",
        },
      });

      await db.janitorRecommendation.create({
        data: {
          janitorRunId: janitorRun.id,
          workspaceId: workspace.id,
          title: "Test Recommendation",
          description: "Test description",
          priority: "MEDIUM",
          status: "PENDING",
          impact: "Test impact",
        },
      });

      // Mock pool manager
      const mockPoolManager = {
        getPoolStatus: vi.fn().mockResolvedValue({
          status: {
            runningVms: 5,
            pendingVms: 0,
            failedVms: 0,
            usedVms: 2,
            unusedVms: 3,
            lastCheck: new Date().toISOString(),
          },
        }),
      };
      vi.mocked(MockPoolManagerService).mockImplementation(() => mockPoolManager as any);

      const request = new Request("http://localhost:3000/api/cron/task-coordinator", {
        method: "GET",
      });

      const response = await GET(request);
      await response.json();

      // Verify acceptedById is workspace owner
      const recommendation = await db.janitorRecommendation.findFirst({
        where: { workspaceId: workspace.id },
      });

      expect(recommendation?.acceptedById).toBe(user.id);
    });
  });

  describe("Response Structure Validation", () => {
    test("should return all required fields in response", async () => {
      process.env.TASK_COORDINATOR_ENABLED = "true";

      const user = await db.user.create({
        data: {
          name: "Test Owner",
          email: "owner@example.com",
        },
      });

      await db.workspace.create({
        data: {
          name: "Test Workspace",
          slug: "test-workspace",
          ownerId: user.id,
          janitorConfig: {
            create: {
              recommendationSweepEnabled: false,
              ticketSweepEnabled: false,
            },
          },
        },
      });

      const request = new Request("http://localhost:3000/api/cron/task-coordinator", {
        method: "GET",
      });

      const response = await GET(request);
      const result = await response.json();

      expect(result).toHaveProperty("success");
      expect(result).toHaveProperty("workspacesProcessed");
      expect(result).toHaveProperty("tasksCreated");
      expect(result).toHaveProperty("errorCount");
      expect(result).toHaveProperty("errors");
      expect(result).toHaveProperty("timestamp");

      expect(typeof result.success).toBe("boolean");
      expect(typeof result.workspacesProcessed).toBe("number");
      expect(typeof result.tasksCreated).toBe("number");
      expect(typeof result.errorCount).toBe("number");
      expect(Array.isArray(result.errors)).toBe(true);
      expect(typeof result.timestamp).toBe("string");
    });

    test("should include ISO timestamp in response", async () => {
      process.env.TASK_COORDINATOR_ENABLED = "true";

      const request = new Request("http://localhost:3000/api/cron/task-coordinator", {
        method: "GET",
      });

      const beforeTime = new Date();
      const response = await GET(request);
      const result = await response.json();
      const afterTime = new Date();

      const timestamp = new Date(result.timestamp);
      expect(timestamp.getTime()).toBeGreaterThanOrEqual(beforeTime.getTime());
      expect(timestamp.getTime()).toBeLessThanOrEqual(afterTime.getTime());
      expect(result.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });

    test.skip("should return errorCount matching errors array length", async () => {
      process.env.TASK_COORDINATOR_ENABLED = "true";

      const user = await db.user.create({
        data: {
          name: "Test Owner",
          email: "owner@example.com",
        },
      });

      const swarm = await db.swarm.create({
        data: {
          name: "Test Swarm",
          poolName: "test-pool",
          swarmUrl: "https://swarm.com/api",
          swarmSecretAlias: "{{TEST_SECRET}}",
          poolApiKey: "test-pool-api-key",
        },
      });

      await db.workspace.create({
        data: {
          name: "Test Workspace",
          slug: "test-workspace",
          ownerId: user.id,
          swarmId: swarm.id,
          janitorConfig: {
            create: {
              recommendationSweepEnabled: true,
              ticketSweepEnabled: false,
            },
          },
        },
      });

      // Mock pool manager to fail
      const mockPoolManager = {
        getPoolStatus: vi.fn().mockRejectedValue(new Error("Pool service unavailable")),
      };
      vi.mocked(MockPoolManagerService).mockImplementation(() => mockPoolManager as any);

      const request = new Request("http://localhost:3000/api/cron/task-coordinator", {
        method: "GET",
      });

      const response = await GET(request);
      const result = await response.json();

      expect(result.errorCount).toBe(result.errors.length);
      expect(result.errorCount).toBeGreaterThan(0);
    });
  });
});