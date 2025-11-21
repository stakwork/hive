import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { db } from "@/lib/db";
import { Priority, RecommendationStatus } from "@prisma/client";
import { GET } from "@/app/api/cron/task-coordinator/route";
import { NextRequest } from "next/server";

/**
 * Integration tests for Task Coordinator Cron Endpoint
 *
 * Verifies:
 * 1. Orchestration - All 3 phases execute in correct order
 * 2. State Transitions - Real database updates (TODO → IN_PROGRESS → DONE/HALTED)
 * 3. Data Integrity - No loss/duplication, correct sourceType markers
 *
 * Note: Mocks only external APIs (Stakwork, Pool Manager), uses real database
 */

// Mock external service calls only
vi.mock("@/services/pool-manager", () => ({
  PoolManagerService: vi.fn().mockImplementation(() => ({
    getPoolStatus: vi.fn().mockResolvedValue({
      status: {
        runningVms: 5,
        pendingVms: 0,
        failedVms: 0,
        usedVms: 2,
        unusedVms: 3, // 3 available pods
        lastCheck: new Date().toISOString(),
      },
    }),
  })),
}));

vi.mock("@/config/services", () => ({
  getServiceConfig: vi.fn().mockReturnValue({
    baseURL: "https://test-pool-manager.com",
    apiKey: "test-api-key",
  }),
}));

// Mock Stakwork API responses (not the database layer)
globalThis.fetch = vi.fn().mockImplementation((url: string) => {
  // Mock Stakwork API calls
  if (url.includes("/projects")) {
    return Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        project_id: 123,
        status: "active",
      }),
    } as Response);
  }
  // Default mock for other fetch calls
  return Promise.resolve({
    ok: true,
    status: 200,
    json: async () => ({}),
  } as Response);
});

// Mock startTaskWorkflow since it triggers external workflows
// But keep createTaskWithStakworkWorkflow unmocked so tasks are created in DB
vi.mock("@/services/task-workflow", async () => {
  const actual = await vi.importActual("@/services/task-workflow");
  return {
    ...actual,
    startTaskWorkflow: vi.fn().mockResolvedValue({
      success: true,
      data: { project_id: 456 },
    }),
  };
});

// Mock workspace access validation
vi.mock("@/lib/auth/workspace-resolver", () => ({
  validateWorkspaceAccess: vi.fn().mockResolvedValue({
    hasAccess: true,
    canWrite: true,
  }),
}));

describe("Integration: /api/cron/task-coordinator", () => {
  let testWorkspace: any;
  let testUser: any;
  let testSwarm: any;

  beforeEach(async () => {
    // Clean up test data
    await db.task.deleteMany({});
    await db.janitorRecommendation.deleteMany({});
    await db.janitorRun.deleteMany({});
    await db.janitorConfig.deleteMany({});
    await db.workspaceMember.deleteMany({});
    await db.swarm.deleteMany({});
    await db.workspace.deleteMany({});
    await db.user.deleteMany({});

    // Create test user
    testUser = await db.user.create({
      data: {
        email: "test@example.com",
        name: "Test User",
      },
    });

    // Create test workspace with janitor config (without swarm first)
    testWorkspace = await db.workspace.create({
      data: {
        slug: "test-workspace-integration",
        name: "Test Workspace Integration",
        ownerId: testUser.id,
        janitorConfig: {
          create: {
            taskCoordinatorEnabled: true,
            recommendationSweepEnabled: true,
            ticketSweepEnabled: true,
            unitTestsEnabled: false,
            integrationTestsEnabled: false,
            e2eTestsEnabled: false,
            securityReviewEnabled: false,
          },
        },
      },
      include: {
        janitorConfig: true,
      },
    });

    // Create test swarm with pool configuration (after workspace exists)
    testSwarm = await db.swarm.create({
      data: {
        name: "test-swarm",
        swarmUrl: "https://test-swarm.com",
        workspaceId: testWorkspace.id,
        poolName: "test-pool",
        swarmSecretAlias: "{{TEST_SECRET}}",
        poolApiKey: JSON.stringify({
          data: "encrypted-pool-api-key",
          iv: "test-iv",
          tag: "test-tag",
          keyId: "test-key-id",
          version: "v1",
          encryptedAt: new Date().toISOString(),
        }),
      },
    });

    // Add user as workspace member
    await db.workspaceMember.create({
      data: {
        userId: testUser.id,
        workspaceId: testWorkspace.id,
        role: "OWNER",
      },
    });
  });

  afterEach(async () => {
    // Clean up test data
    await db.task.deleteMany({});
    await db.janitorRecommendation.deleteMany({});
    await db.janitorRun.deleteMany({});
    await db.janitorConfig.deleteMany({});
    await db.workspaceMember.deleteMany({});
    await db.swarm.deleteMany({});
    await db.workspace.deleteMany({});
    await db.user.deleteMany({});
    vi.clearAllMocks();
  });

  describe("Phase 1: Stale Task Halting", () => {
    test("should halt tasks in IN_PROGRESS status for >24 hours", async () => {
      // Create stale task (>24 hours old in IN_PROGRESS)
      const twentyFiveHoursAgo = new Date();
      twentyFiveHoursAgo.setHours(twentyFiveHoursAgo.getHours() - 25);

      const staleTask = await db.task.create({
        data: {
          title: "Stale Task",
          description: "This task has been running for too long",
          workspaceId: testWorkspace.id,
          createdById: testUser.id,
          updatedById: testUser.id,
          status: "IN_PROGRESS",
          mode: "agent",
          sourceType: "USER",
          priority: "MEDIUM",
          createdAt: twentyFiveHoursAgo,
        },
      });

      // Execute endpoint
      const mockRequest = new NextRequest("http://localhost:3000/api/cron/task-coordinator");
      process.env.TASK_COORDINATOR_ENABLED = "true";

      const response = await GET(mockRequest);
      const result = await response.json();

      // Verify response
      expect(response.status).toBe(200);
      expect(result.success).toBe(true);

      // Verify database state: task should be HALTED
      const updatedTask = await db.task.findUnique({
        where: { id: staleTask.id },
      });

      expect(updatedTask).not.toBeNull();
      expect(updatedTask!.workflowStatus).toBe("HALTED"); // workflowStatus, not status
      expect(updatedTask!.workflowCompletedAt).not.toBeNull();
    });

    test("should NOT halt recent tasks in IN_PROGRESS status", async () => {
      // Create recent task (only 2 hours old)
      const twoHoursAgo = new Date();
      twoHoursAgo.setHours(twoHoursAgo.getHours() - 2);

      const recentTask = await db.task.create({
        data: {
          title: "Recent Task",
          description: "This task is still fresh",
          workspaceId: testWorkspace.id,
          createdById: testUser.id,
          updatedById: testUser.id,
          status: "IN_PROGRESS",
          mode: "agent",
          sourceType: "USER",
          priority: "MEDIUM",
          createdAt: twoHoursAgo,
        },
      });

      // Execute endpoint
      const mockRequest = new NextRequest("http://localhost:3000/api/cron/task-coordinator");
      process.env.TASK_COORDINATOR_ENABLED = "true";

      const response = await GET(mockRequest);
      const result = await response.json();

      // Verify response
      expect(response.status).toBe(200);
      expect(result.success).toBe(true);

      // Verify database state: task should remain IN_PROGRESS
      const updatedTask = await db.task.findUnique({
        where: { id: recentTask.id },
      });

      expect(updatedTask).not.toBeNull();
      expect(updatedTask!.status).toBe("IN_PROGRESS");
      expect(updatedTask!.workflowCompletedAt).toBeNull();
    });
  });

  describe("Phase 2: Ticket Sweep", () => {
    test("should process TODO task with TASK_COORDINATOR assignee", async () => {
      // Create eligible ticket
      const ticket = await db.task.create({
        data: {
          title: "Ticket for Coordinator",
          description: "This ticket should be processed",
          workspaceId: testWorkspace.id,
          createdById: testUser.id,
          updatedById: testUser.id,
          status: "TODO",
          mode: "agent",
          sourceType: "TASK_COORDINATOR",
          systemAssigneeType: "TASK_COORDINATOR",
          priority: "HIGH",
          dependsOnTaskIds: [], // No dependencies
        },
      });

      // Execute endpoint
      const mockRequest = new NextRequest("http://localhost:3000/api/cron/task-coordinator");
      process.env.TASK_COORDINATOR_ENABLED = "true";

      const response = await GET(mockRequest);
      const result = await response.json();

      // Verify response shows task processing
      expect(response.status).toBe(200);
      expect(result.success).toBe(true);

      // Verify startTaskWorkflow was called
      const { startTaskWorkflow } = await import("@/services/task-workflow");
      expect(startTaskWorkflow).toHaveBeenCalledWith({
        taskId: ticket.id,
        userId: testUser.id,
        mode: "live",
      });
    });

    test("should respect priority ordering (CRITICAL → HIGH → MEDIUM → LOW)", async () => {
      // Create tickets with different priorities
      const lowTask = await db.task.create({
        data: {
          title: "Low Priority Ticket",
          workspaceId: testWorkspace.id,
          createdById: testUser.id,
          updatedById: testUser.id,
          status: "TODO",
          mode: "agent",
          sourceType: "TASK_COORDINATOR",
          systemAssigneeType: "TASK_COORDINATOR",
          priority: "LOW",
          dependsOnTaskIds: [],
        },
      });

      const criticalTask = await db.task.create({
        data: {
          title: "Critical Priority Ticket",
          workspaceId: testWorkspace.id,
          createdById: testUser.id,
          updatedById: testUser.id,
          status: "TODO",
          mode: "agent",
          sourceType: "TASK_COORDINATOR",
          systemAssigneeType: "TASK_COORDINATOR",
          priority: "CRITICAL",
          dependsOnTaskIds: [],
        },
      });

      // Execute endpoint
      const mockRequest = new NextRequest("http://localhost:3000/api/cron/task-coordinator");
      process.env.TASK_COORDINATOR_ENABLED = "true";

      const response = await GET(mockRequest);
      const result = await response.json();

      expect(response.status).toBe(200);

      // Verify CRITICAL task was processed (not LOW)
      const { startTaskWorkflow } = await import("@/services/task-workflow");
      expect(startTaskWorkflow).toHaveBeenCalledWith({
        taskId: criticalTask.id, // CRITICAL task processed first
        userId: testUser.id,
        mode: "live",
      });
    });

    test("should skip tasks with dependencies", async () => {
      // Create blocking task
      const blockingTask = await db.task.create({
        data: {
          title: "Blocking Task",
          workspaceId: testWorkspace.id,
          createdById: testUser.id,
          updatedById: testUser.id,
          status: "TODO",
          mode: "agent",
          sourceType: "USER",
          priority: "HIGH",
        },
      });

      // Create dependent task
      const dependentTask = await db.task.create({
        data: {
          title: "Dependent Ticket",
          workspaceId: testWorkspace.id,
          createdById: testUser.id,
          updatedById: testUser.id,
          status: "TODO",
          mode: "agent",
          sourceType: "TASK_COORDINATOR",
          systemAssigneeType: "TASK_COORDINATOR",
          priority: "HIGH",
          dependsOnTaskIds: [blockingTask.id], // Has dependency
        },
      });

      // Execute endpoint
      const mockRequest = new NextRequest("http://localhost:3000/api/cron/task-coordinator");
      process.env.TASK_COORDINATOR_ENABLED = "true";

      const response = await GET(mockRequest);
      const result = await response.json();

      expect(response.status).toBe(200);

      // Verify startTaskWorkflow was NOT called for dependent task
      const { startTaskWorkflow } = await import("@/services/task-workflow");
      expect(startTaskWorkflow).not.toHaveBeenCalled();
    });
  });

  describe("Phase 3: Recommendation Sweep", () => {
    test("should accept pending recommendation and create task with TASK_COORDINATOR sourceType", async () => {
      // Create janitor run
      const janitorRun = await db.janitorRun.create({
        data: {
          janitorConfigId: testWorkspace.janitorConfig!.id,
          janitorType: "UNIT_TESTS",
          status: "COMPLETED",
          metadata: {},
        },
      });

      // Create pending recommendation
      const recommendation = await db.janitorRecommendation.create({
        data: {
          janitorRunId: janitorRun.id,
          workspaceId: testWorkspace.id,
          title: "Add unit tests for UserService",
          description: "UserService lacks test coverage",
          priority: "HIGH",
          impact: "Improves test coverage",
          status: "PENDING",
          metadata: {},
        },
      });

      // Execute endpoint
      const mockRequest = new NextRequest("http://localhost:3000/api/cron/task-coordinator");
      process.env.TASK_COORDINATOR_ENABLED = "true";

      const response = await GET(mockRequest);
      const result = await response.json();

      // Verify response
      expect(response.status).toBe(200);
      expect(result.success).toBe(true);
      expect(result.tasksCreated).toBe(1);

      // Verify recommendation status changed
      const updatedRecommendation = await db.janitorRecommendation.findUnique({
        where: { id: recommendation.id },
      });

      expect(updatedRecommendation).not.toBeNull();
      expect(updatedRecommendation!.status).toBe("ACCEPTED");
      expect(updatedRecommendation!.acceptedAt).not.toBeNull();
      expect(updatedRecommendation!.acceptedById).toBe(testUser.id);

      // Verify task was created with correct sourceType marker
      const createdTask = await db.task.findFirst({
        where: {
          workspaceId: testWorkspace.id,
          sourceType: "TASK_COORDINATOR", // Important: prevents duplication
        },
      });

      expect(createdTask).not.toBeNull();
      expect(createdTask!.title).toBe(recommendation.title);
      expect(createdTask!.status).toBe("IN_PROGRESS"); // Task starts workflow immediately
    });

    test("should process CRITICAL priority before HIGH priority", async () => {
      // Create janitor run
      const janitorRun = await db.janitorRun.create({
        data: {
          janitorConfigId: testWorkspace.janitorConfig!.id,
          janitorType: "UNIT_TESTS",
          status: "COMPLETED",
          metadata: {},
        },
      });

      // Create HIGH priority recommendation (created first)
      const highRec = await db.janitorRecommendation.create({
        data: {
          janitorRunId: janitorRun.id,
          workspaceId: testWorkspace.id,
          title: "High Priority Recommendation",
          description: "High priority code quality improvement",
          priority: "HIGH",
          impact: "Improves code quality",
          status: "PENDING",
          metadata: {},
        },
      });

      // Create CRITICAL priority recommendation (created second)
      const criticalRec = await db.janitorRecommendation.create({
        data: {
          janitorRunId: janitorRun.id,
          workspaceId: testWorkspace.id,
          title: "Critical Priority Recommendation",
          description: "Critical security vulnerability found",
          priority: "CRITICAL",
          impact: "Security vulnerability",
          status: "PENDING",
          metadata: {},
        },
      });

      // Execute endpoint
      const mockRequest = new NextRequest("http://localhost:3000/api/cron/task-coordinator");
      process.env.TASK_COORDINATOR_ENABLED = "true";

      const response = await GET(mockRequest);
      const result = await response.json();

      expect(response.status).toBe(200);
      expect(result.tasksCreated).toBe(1); // Only 1 per run

      // Verify CRITICAL recommendation was accepted (not HIGH)
      const criticalUpdated = await db.janitorRecommendation.findUnique({
        where: { id: criticalRec.id },
      });
      const highUpdated = await db.janitorRecommendation.findUnique({
        where: { id: highRec.id },
      });

      expect(criticalUpdated!.status).toBe("ACCEPTED");
      expect(highUpdated!.status).toBe("PENDING"); // Still pending
    });

    test("should limit to 1 recommendation per workspace per run", async () => {
      // Create janitor run
      const janitorRun = await db.janitorRun.create({
        data: {
          janitorConfigId: testWorkspace.janitorConfig!.id,
          janitorType: "UNIT_TESTS",
          status: "COMPLETED",
          metadata: {},
        },
      });

      // Create 3 pending recommendations
      const rec1 = await db.janitorRecommendation.create({
        data: {
          janitorRunId: janitorRun.id,
          workspaceId: testWorkspace.id,
          title: "Recommendation 1",
          description: "Test description 1",
          priority: "HIGH",
          impact: "Test impact",
          status: "PENDING",
          metadata: {},
        },
      });

      const rec2 = await db.janitorRecommendation.create({
        data: {
          janitorRunId: janitorRun.id,
          workspaceId: testWorkspace.id,
          title: "Recommendation 2",
          description: "Test description 2",
          priority: "HIGH",
          impact: "Test impact",
          status: "PENDING",
          metadata: {},
        },
      });

      const rec3 = await db.janitorRecommendation.create({
        data: {
          janitorRunId: janitorRun.id,
          workspaceId: testWorkspace.id,
          title: "Recommendation 3",
          description: "Test description 3",
          priority: "HIGH",
          impact: "Test impact",
          status: "PENDING",
          metadata: {},
        },
      });

      // Execute endpoint
      const mockRequest = new NextRequest("http://localhost:3000/api/cron/task-coordinator");
      process.env.TASK_COORDINATOR_ENABLED = "true";

      const response = await GET(mockRequest);
      const result = await response.json();

      expect(response.status).toBe(200);
      expect(result.tasksCreated).toBe(1); // Only 1 task created

      // Count accepted recommendations
      const acceptedCount = await db.janitorRecommendation.count({
        where: {
          workspaceId: testWorkspace.id,
          status: "ACCEPTED",
        },
      });

      expect(acceptedCount).toBe(1); // Only 1 accepted
    });
  });

  describe("Data Integrity & Deduplication", () => {
    test("should mark tasks with sourceType=TASK_COORDINATOR to prevent duplication", async () => {
      // Create janitor run and recommendation
      const janitorRun = await db.janitorRun.create({
        data: {
          janitorConfigId: testWorkspace.janitorConfig!.id,
          janitorType: "UNIT_TESTS",
          status: "COMPLETED",
          metadata: {},
        },
      });

      const recommendation = await db.janitorRecommendation.create({
        data: {
          janitorRunId: janitorRun.id,
          workspaceId: testWorkspace.id,
          title: "Test Recommendation",
          description: "Test recommendation description",
          priority: "HIGH",
          impact: "Test impact",
          status: "PENDING",
          metadata: {},
        },
      });

      // Execute endpoint
      const mockRequest = new NextRequest("http://localhost:3000/api/cron/task-coordinator");
      process.env.TASK_COORDINATOR_ENABLED = "true";

      const response = await GET(mockRequest);
      const result = await response.json();

      expect(response.status).toBe(200);

      // Verify created task has TASK_COORDINATOR sourceType
      const createdTask = await db.task.findFirst({
        where: {
          workspaceId: testWorkspace.id,
        },
      });

      expect(createdTask).not.toBeNull();
      expect(createdTask!.sourceType).toBe("TASK_COORDINATOR");
    });

    test("should not create duplicate tasks from same recommendation", async () => {
      // Create janitor run and recommendation
      const janitorRun = await db.janitorRun.create({
        data: {
          janitorConfigId: testWorkspace.janitorConfig!.id,
          janitorType: "UNIT_TESTS",
          status: "COMPLETED",
          metadata: {},
        },
      });

      const recommendation = await db.janitorRecommendation.create({
        data: {
          janitorRunId: janitorRun.id,
          workspaceId: testWorkspace.id,
          title: "Test Recommendation",
          description: "Test recommendation description",
          priority: "HIGH",
          impact: "Test impact",
          status: "PENDING",
          metadata: {},
        },
      });

      // Execute endpoint twice
      const mockRequest = new NextRequest("http://localhost:3000/api/cron/task-coordinator");
      process.env.TASK_COORDINATOR_ENABLED = "true";

      await GET(mockRequest);
      await GET(mockRequest); // Second execution

      // Count tasks created
      const taskCount = await db.task.count({
        where: {
          workspaceId: testWorkspace.id,
          sourceType: "TASK_COORDINATOR",
        },
      });

      expect(taskCount).toBe(1); // Only 1 task created (no duplication)
    });
  });

  describe("Error Isolation", () => {
    test("should continue processing other workspaces when one fails", async () => {
      // Create second workspace without swarm (should fail)
      const workspace2 = await db.workspace.create({
        data: {
          slug: "workspace-no-swarm",
          name: "Workspace Without Swarm",
          ownerId: testUser.id,
          // No swarm created - this workspace lacks a swarm
          janitorConfig: {
            create: {
              taskCoordinatorEnabled: true,
              recommendationSweepEnabled: true,
              ticketSweepEnabled: false,
            },
          },
        },
        include: {
          janitorConfig: true,
        },
      });

      // Create recommendation for first workspace (should succeed)
      const janitorRun = await db.janitorRun.create({
        data: {
          janitorConfigId: testWorkspace.janitorConfig!.id,
          janitorType: "UNIT_TESTS",
          status: "COMPLETED",
          metadata: {},
        },
      });

      await db.janitorRecommendation.create({
        data: {
          janitorRunId: janitorRun.id,
          workspaceId: testWorkspace.id,
          title: "Test Recommendation",
          description: "Test recommendation description",
          priority: "HIGH",
          impact: "Test impact",
          status: "PENDING",
          metadata: {},
        },
      });

      // Execute endpoint
      const mockRequest = new NextRequest("http://localhost:3000/api/cron/task-coordinator");
      process.env.TASK_COORDINATOR_ENABLED = "true";

      const response = await GET(mockRequest);
      const result = await response.json();

      // Response should indicate partial success
      expect(response.status).toBe(200);
      expect(result.workspacesProcessed).toBe(2); // Both workspaces processed
      expect(result.tasksCreated).toBe(1); // Only first workspace succeeded

      // Verify task was created for successful workspace
      const taskCount = await db.task.count({
        where: {
          workspaceId: testWorkspace.id,
        },
      });

      expect(taskCount).toBe(1);
    });
  });

  describe("Environment Configuration", () => {
    test("should skip execution when TASK_COORDINATOR_ENABLED is false", async () => {
      // Execute endpoint with disabled flag
      const mockRequest = new NextRequest("http://localhost:3000/api/cron/task-coordinator");
      process.env.TASK_COORDINATOR_ENABLED = "false";

      const response = await GET(mockRequest);
      const result = await response.json();

      expect(response.status).toBe(200);
      expect(result.success).toBe(true);
      expect(result.message).toBe("Task Coordinator is disabled");
      expect(result.workspacesProcessed).toBe(0);
      expect(result.tasksCreated).toBe(0);
    });
  });

  describe("Result Aggregation", () => {
    test("should return correct execution metrics", async () => {
      // Create janitor run and recommendation
      const janitorRun = await db.janitorRun.create({
        data: {
          janitorConfigId: testWorkspace.janitorConfig!.id,
          janitorType: "UNIT_TESTS",
          status: "COMPLETED",
          metadata: {},
        },
      });

      await db.janitorRecommendation.create({
        data: {
          janitorRunId: janitorRun.id,
          workspaceId: testWorkspace.id,
          title: "Test Recommendation",
          description: "Test recommendation description",
          priority: "HIGH",
          impact: "Test impact",
          status: "PENDING",
          metadata: {},
        },
      });

      // Execute endpoint
      const mockRequest = new NextRequest("http://localhost:3000/api/cron/task-coordinator");
      process.env.TASK_COORDINATOR_ENABLED = "true";

      const response = await GET(mockRequest);
      const result = await response.json();

      // Verify result structure
      expect(result).toHaveProperty("success");
      expect(result).toHaveProperty("workspacesProcessed");
      expect(result).toHaveProperty("tasksCreated");
      expect(result).toHaveProperty("errorCount");
      expect(result).toHaveProperty("errors");
      expect(result).toHaveProperty("timestamp");

      // Verify metrics
      expect(result.success).toBe(true);
      expect(result.workspacesProcessed).toBe(1);
      expect(result.tasksCreated).toBe(1);
      expect(result.errorCount).toBe(0);
      expect(result.errors).toEqual([]);
      expect(result.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/); // ISO format
    });
  });
});
