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

// Mock pod status queries (replaces old pool manager mock)
vi.mock("@/lib/pods/status-queries", () => ({
  getPoolStatusFromPods: vi.fn().mockResolvedValue({
    runningVms: 5,
    pendingVms: 0,
    failedVms: 0,
    usedVms: 2,
    unusedVms: 3, // 3 available pods
    lastCheck: new Date().toISOString(),
    queuedCount: 0,
  }),
}));

// Mock Stakwork API responses (not the database layer)
globalThis.fetch = vi.fn().mockImplementation((url: string) => {
  // Mock Stakwork API calls
  if (url.includes('/projects')) {
    return Promise.resolve({
      ok: true,
      status: 200,
      json: async () => ({
        success: true,
        project_id: 123,
        status: 'active'
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

// Helper to create authenticated request with CRON_SECRET
function createAuthenticatedRequest(): NextRequest {
  const headers = new Headers();
  headers.set('authorization', 'Bearer test-cron-secret');
  return new NextRequest('http://localhost:3000/api/cron/task-coordinator', { headers });
}

describe("Integration: /api/cron/task-coordinator", () => {
  let testWorkspace: any;
  let testUser: any;
  let testSwarm: any;
  let originalCronSecret: string | undefined;

  beforeEach(async () => {
    // Set up CRON_SECRET for authentication
    originalCronSecret = process.env.CRON_SECRET;
    process.env.CRON_SECRET = "test-cron-secret";

    // Clean up test data
    await db.tasks.deleteMany({});
    await db.janitor_recommendations.deleteMany({});
    await db.janitor_runs.deleteMany({});
    await db.janitor_configs.deleteMany({});
    await db.workspace_members.deleteMany({});
    await db.swarms.deleteMany({});
    await db.workspaces.deleteMany({});
    await db.users.deleteMany({});

    // Create test user
    testUser = await db.users.create({
      data: {
        email: "test@example.com",
        name: "Test User",
      },
    });

    // Create test workspace with janitor config (without swarm first)
    testWorkspace = await db.workspaces.create({
      data: {
        slug: "test-workspace-integration",
        name: "Test Workspace Integration",owner_id: testUser.id,
        janitorConfig: {
          create: {
            taskCoordinatorEnabled: true,
            recommendationSweepEnabled: true,ticket_sweep_enabled: true,unit_tests_enabled: false,
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
    testSwarm = await db.swarms.create({
      data: {
        name: "test-swarm",swarm_url: "https://test-swarm.com",workspace_id: testWorkspace.id,pool_name: "test-pool",swarm_secret_alias: "{{TEST_SECRET}}",pool_api_key: JSON.stringify({
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
    await db.workspace_members.create({
      data: {user_id: testUser.id,workspace_id: testWorkspace.id,
        role: "OWNER",
      },
    });
  });

  afterEach(async () => {
    // Restore CRON_SECRET
    if (originalCronSecret !== undefined) {
      process.env.CRON_SECRET = originalCronSecret;
    } else {
      delete process.env.CRON_SECRET;
    }

    // Clean up test data
    await db.tasks.deleteMany({});
    await db.janitor_recommendations.deleteMany({});
    await db.janitor_runs.deleteMany({});
    await db.janitor_configs.deleteMany({});
    await db.workspace_members.deleteMany({});
    await db.swarms.deleteMany({});
    await db.workspaces.deleteMany({});
    await db.users.deleteMany({});
    vi.clearAllMocks();
  });

  describe("Phase 1: Stale Task Halting", () => {
    test("should halt tasks in IN_PROGRESS status for >24 hours", async () => {
      // Create stale task (>24 hours old in IN_PROGRESS)
      const twentyFiveHoursAgo = new Date();
      twentyFiveHoursAgo.setHours(twentyFiveHoursAgo.getHours() - 25);

      const staleTask = await db.tasks.create({
        data: {
          title: "Stale Task",
          description: "This task has been running for too long",workspace_id: testWorkspace.id,created_by_id: testUser.id,updated_by_id: testUser.id,
          status: "IN_PROGRESS",
          mode: "agent",source_type: "USER",
          priority: "MEDIUM",created_at: twentyFiveHoursAgo,updated_at: twentyFiveHoursAgo,
        },
      });

      // Execute endpoint
      const mockRequest = createAuthenticatedRequest();
      process.env.TASK_COORDINATOR_ENABLED = "true";

      const response = await GET(mockRequest);
      const result = await response.json();

      // Verify response
      expect(response.status).toBe(200);
      expect(result.success).toBe(true);

      // Verify database state: task should be HALTED
      const updatedTask = await db.tasks.findUnique({
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

      const recentTask = await db.tasks.create({
        data: {
          title: "Recent Task",
          description: "This task is still fresh",workspace_id: testWorkspace.id,created_by_id: testUser.id,updated_by_id: testUser.id,
          status: "IN_PROGRESS",
          mode: "agent",source_type: "USER",
          priority: "MEDIUM",created_at: twoHoursAgo,updated_at: twoHoursAgo,
        },
      });

      // Execute endpoint
      const mockRequest = createAuthenticatedRequest();
      process.env.TASK_COORDINATOR_ENABLED = "true";

      const response = await GET(mockRequest);
      const result = await response.json();

      // Verify response
      expect(response.status).toBe(200);
      expect(result.success).toBe(true);

      // Verify database state: task should remain IN_PROGRESS
      const updatedTask = await db.tasks.findUnique({
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
      const ticket = await db.tasks.create({
        data: {
          title: "Ticket for Coordinator",
          description: "This ticket should be processed",workspace_id: testWorkspace.id,created_by_id: testUser.id,updated_by_id: testUser.id,
          status: "TODO",
          mode: "agent",source_type: "TASK_COORDINATOR",system_assignee_type: "TASK_COORDINATOR",
          priority: "HIGH",depends_on_task_ids: [], // No dependencies
        },
      });

      // Execute endpoint
      const mockRequest = createAuthenticatedRequest();
      process.env.TASK_COORDINATOR_ENABLED = "true";

      const response = await GET(mockRequest);
      const result = await response.json();

      // Verify response shows task processing
      expect(response.status).toBe(200);
      expect(result.success).toBe(true);

      // Verify startTaskWorkflow was called
      const { startTaskWorkflow } = await import("@/services/task-workflow");
      expect(startTaskWorkflow).toHaveBeenCalledWith({task_id: ticket.id,user_id: testUser.id,
        mode: "live",
      });
    });

    test("should dispatch 2 tasks when unusedVms=3 (slotsAvailable=2) and 2 eligible TODO tasks exist", async () => {
      // Create 2 eligible tickets (no dependencies)
      const ticket1 = await db.tasks.create({
        data: {
          title: "Ticket 1",workspace_id: testWorkspace.id,created_by_id: testUser.id,updated_by_id: testUser.id,
          status: "TODO",
          mode: "agent",source_type: "TASK_COORDINATOR",system_assignee_type: "TASK_COORDINATOR",
          priority: "HIGH",depends_on_task_ids: [],
        },
      });

      const ticket2 = await db.tasks.create({
        data: {
          title: "Ticket 2",workspace_id: testWorkspace.id,created_by_id: testUser.id,updated_by_id: testUser.id,
          status: "TODO",
          mode: "agent",source_type: "TASK_COORDINATOR",system_assignee_type: "TASK_COORDINATOR",
          priority: "MEDIUM",depends_on_task_ids: [],
        },
      });

      // Pool mock already configured with unusedVms: 3 → slotsAvailable = 2
      const mockRequest = createAuthenticatedRequest();
      process.env.TASK_COORDINATOR_ENABLED = "true";

      const response = await GET(mockRequest);
      const result = await response.json();

      expect(response.status).toBe(200);
      expect(result.success).toBe(true);
      // With unusedVms=3, slotsAvailable=2 → both tasks dispatched
      expect(result.tasksCreated).toBe(2);

      const { startTaskWorkflow } = await import("@/services/task-workflow");
      expect(startTaskWorkflow).toHaveBeenCalledTimes(2);
      expect(startTaskWorkflow).toHaveBeenCalledWith({task_id: ticket1.id,user_id: testUser.id, mode: "live" });
      expect(startTaskWorkflow).toHaveBeenCalledWith({task_id: ticket2.id,user_id: testUser.id, mode: "live" });
    });

    test("should respect priority ordering (CRITICAL → HIGH → MEDIUM → LOW)", async () => {
      // Create tickets with different priorities
      const lowTask = await db.tasks.create({
        data: {
          title: "Low Priority Ticket",workspace_id: testWorkspace.id,created_by_id: testUser.id,updated_by_id: testUser.id,
          status: "TODO",
          mode: "agent",source_type: "TASK_COORDINATOR",system_assignee_type: "TASK_COORDINATOR",
          priority: "LOW",depends_on_task_ids: [],
        },
      });

      const criticalTask = await db.tasks.create({
        data: {
          title: "Critical Priority Ticket",workspace_id: testWorkspace.id,created_by_id: testUser.id,updated_by_id: testUser.id,
          status: "TODO",
          mode: "agent",source_type: "TASK_COORDINATOR",system_assignee_type: "TASK_COORDINATOR",
          priority: "CRITICAL",depends_on_task_ids: [],
        },
      });

      // Execute endpoint
      const mockRequest = createAuthenticatedRequest();
      process.env.TASK_COORDINATOR_ENABLED = "true";

      const response = await GET(mockRequest);
      const result = await response.json();

      expect(response.status).toBe(200);

      // Verify CRITICAL task was processed (not LOW)
      const { startTaskWorkflow } = await import("@/services/task-workflow");
      expect(startTaskWorkflow).toHaveBeenCalledWith({task_id: criticalTask.id, // CRITICAL task processed first
user_id: testUser.id,
        mode: "live",
      });
    });

    test("should skip tasks with dependencies", async () => {
      // Create blocking task
      const blockingTask = await db.tasks.create({
        data: {
          title: "Blocking Task",workspace_id: testWorkspace.id,created_by_id: testUser.id,updated_by_id: testUser.id,
          status: "TODO",
          mode: "agent",source_type: "USER",
          priority: "HIGH",
        },
      });

      // Create dependent task
      const dependentTask = await db.tasks.create({
        data: {
          title: "Dependent Ticket",workspace_id: testWorkspace.id,created_by_id: testUser.id,updated_by_id: testUser.id,
          status: "TODO",
          mode: "agent",source_type: "TASK_COORDINATOR",system_assignee_type: "TASK_COORDINATOR",
          priority: "HIGH",depends_on_task_ids: [blockingTask.id], // Has dependency
        },
      });

      // Execute endpoint
      const mockRequest = createAuthenticatedRequest();
      process.env.TASK_COORDINATOR_ENABLED = "true";

      const response = await GET(mockRequest);
      const result = await response.json();

      expect(response.status).toBe(200);

      // Verify startTaskWorkflow was NOT called for dependent task
      const { startTaskWorkflow } = await import("@/services/task-workflow");
      expect(startTaskWorkflow).not.toHaveBeenCalled();
    });

    test("should unassign coordinator task whose dependency has a CANCELLED PR artifact", async () => {
      // Create the blocking task (will have a CANCELLED PR artifact)
      const blockingTask = await db.tasks.create({
        data: {
          title: "Cancelled PR Task",workspace_id: testWorkspace.id,created_by_id: testUser.id,updated_by_id: testUser.id,
          status: "IN_PROGRESS",
          mode: "agent",source_type: "USER",
          priority: "HIGH",
        },
      });

      // Add a chat message with a CANCELLED PR artifact to the blocking task
      const chatMessage = await db.chat_messages.create({
        data: {task_id: blockingTask.id,
          message: "PR was closed without merging",
          role: "ASSISTANT",
        },
      });

      await db.artifacts.create({
        data: {
          messageId: chatMessage.id,
          type: "PULL_REQUEST",
          content: {
            url: "https://github.com/org/repo/pull/42",
            status: "CANCELLED",
          },
        },
      });

      // Create the coordinator-assigned task that depends on the blocked task
      const coordinatorTask = await db.tasks.create({
        data: {
          title: "Permanently Blocked Coordinator Task",workspace_id: testWorkspace.id,created_by_id: testUser.id,updated_by_id: testUser.id,
          status: "TODO",
          mode: "agent",source_type: "TASK_COORDINATOR",system_assignee_type: "TASK_COORDINATOR",
          priority: "HIGH",depends_on_task_ids: [blockingTask.id],
        },
      });

      // Verify systemAssigneeType is set before the sweep
      const beforeSweep = await db.tasks.findUnique({ where: { id: coordinatorTask.id } });
      expect(beforeSweep?.systemAssigneeType).toBe("TASK_COORDINATOR");

      // Execute the cron endpoint
      const mockRequest = createAuthenticatedRequest();
      process.env.TASK_COORDINATOR_ENABLED = "true";

      const response = await GET(mockRequest);
      expect(response.status).toBe(200);

      // Verify the coordinator task was unassigned (systemAssigneeType cleared)
      const afterSweep = await db.tasks.findUnique({ where: { id: coordinatorTask.id } });
      expect(afterSweep?.systemAssigneeType).toBeNull();

      // Verify startTaskWorkflow was NOT called — unassigned, not dispatched
      const { startTaskWorkflow } = await import("@/services/task-workflow");
      expect(startTaskWorkflow).not.toHaveBeenCalledWith(
        expect.objectContaining({task_id: coordinatorTask.id })
      );
    });
  });

  describe("Phase 3: Recommendation Sweep", () => {
    test("should accept pending recommendation and create task with TASK_COORDINATOR sourceType", async () => {
      // Create janitor run
      const janitorRun = await db.janitor_runs.create({
        data: {janitor_config_id: testWorkspace.janitorConfig!.id,janitor_type: "UNIT_TESTS",
          status: "COMPLETED",
          metadata: {},
        },
      });

      // Create pending recommendation
      const recommendation = await db.janitor_recommendations.create({
        data: {janitor_run_id: janitorRun.id,workspace_id: testWorkspace.id,
          title: "Add unit tests for UserService",
          description: "UserService lacks test coverage",
          priority: "HIGH",
          impact: "Improves test coverage",
          status: "PENDING",
          metadata: {},
        },
      });

      // Execute endpoint
      const mockRequest = createAuthenticatedRequest();
      process.env.TASK_COORDINATOR_ENABLED = "true";

      const response = await GET(mockRequest);
      const result = await response.json();

      // Verify response
      expect(response.status).toBe(200);
      expect(result.success).toBe(true);
      expect(result.tasksCreated).toBe(1);

      // Verify recommendation status changed
      const updatedRecommendation = await db.janitor_recommendations.findUnique({
        where: { id: recommendation.id },
      });

      expect(updatedRecommendation).not.toBeNull();
      expect(updatedRecommendation!.status).toBe("ACCEPTED");
      expect(updatedRecommendation!.acceptedAt).not.toBeNull();
      expect(updatedRecommendation!.acceptedById).toBe(testUser.id);

      // Verify task was created with correct sourceType marker
      const createdTask = await db.tasks.findFirst({
        where: {workspace_id: testWorkspace.id,source_type: "TASK_COORDINATOR", // Important: prevents duplication
        },
      });

      expect(createdTask).not.toBeNull();
      expect(createdTask!.title).toBe(recommendation.title);
      expect(createdTask!.status).toBe("IN_PROGRESS"); // Task starts workflow immediately
    });

    test("should process CRITICAL priority before HIGH priority", async () => {
      // Create janitor run
      const janitorRun = await db.janitor_runs.create({
        data: {janitor_config_id: testWorkspace.janitorConfig!.id,janitor_type: "UNIT_TESTS",
          status: "COMPLETED",
          metadata: {},
        },
      });

      // Create HIGH priority recommendation (created first)
      const highRec = await db.janitor_recommendations.create({
        data: {janitor_run_id: janitorRun.id,workspace_id: testWorkspace.id,
          title: "High Priority Recommendation",
          description: "High priority code quality improvement",
          priority: "HIGH",
          impact: "Improves code quality",
          status: "PENDING",
          metadata: {},
        },
      });

      // Create CRITICAL priority recommendation (created second)
      const criticalRec = await db.janitor_recommendations.create({
        data: {janitor_run_id: janitorRun.id,workspace_id: testWorkspace.id,
          title: "Critical Priority Recommendation",
          description: "Critical security vulnerability found",
          priority: "CRITICAL",
          impact: "Security vulnerability",
          status: "PENDING",
          metadata: {},
        },
      });

      // Execute endpoint
      const mockRequest = createAuthenticatedRequest();
      process.env.TASK_COORDINATOR_ENABLED = "true";

      const response = await GET(mockRequest);
      const result = await response.json();

      expect(response.status).toBe(200);
      expect(result.tasksCreated).toBe(1); // Only 1 per run

      // Verify CRITICAL recommendation was accepted (not HIGH)
      const criticalUpdated = await db.janitor_recommendations.findUnique({
        where: { id: criticalRec.id },
      });
      const highUpdated = await db.janitor_recommendations.findUnique({
        where: { id: highRec.id },
      });

      expect(criticalUpdated!.status).toBe("ACCEPTED");
      expect(highUpdated!.status).toBe("PENDING"); // Still pending
    });

    test("should limit to 1 recommendation per workspace per run", async () => {
      // Create janitor run
      const janitorRun = await db.janitor_runs.create({
        data: {janitor_config_id: testWorkspace.janitorConfig!.id,janitor_type: "UNIT_TESTS",
          status: "COMPLETED",
          metadata: {},
        },
      });

      // Create 3 pending recommendations
      const rec1 = await db.janitor_recommendations.create({
        data: {janitor_run_id: janitorRun.id,workspace_id: testWorkspace.id,
          title: "Recommendation 1",
          description: "Test description 1",
          priority: "HIGH",
          impact: "Test impact",
          status: "PENDING",
          metadata: {},
        },
      });

      const rec2 = await db.janitor_recommendations.create({
        data: {janitor_run_id: janitorRun.id,workspace_id: testWorkspace.id,
          title: "Recommendation 2",
          description: "Test description 2",
          priority: "HIGH",
          impact: "Test impact",
          status: "PENDING",
          metadata: {},
        },
      });

      const rec3 = await db.janitor_recommendations.create({
        data: {janitor_run_id: janitorRun.id,workspace_id: testWorkspace.id,
          title: "Recommendation 3",
          description: "Test description 3",
          priority: "HIGH",
          impact: "Test impact",
          status: "PENDING",
          metadata: {},
        },
      });

      // Execute endpoint
      const mockRequest = createAuthenticatedRequest();
      process.env.TASK_COORDINATOR_ENABLED = "true";

      const response = await GET(mockRequest);
      const result = await response.json();

      expect(response.status).toBe(200);
      expect(result.tasksCreated).toBe(1); // Only 1 task created

      // Count accepted recommendations
      const acceptedCount = await db.janitor_recommendations.count({
        where: {workspace_id: testWorkspace.id,
          status: "ACCEPTED",
        },
      });

      expect(acceptedCount).toBe(1); // Only 1 accepted
    });
  });

  describe("Data Integrity & Deduplication", () => {
    test("should mark tasks with sourceType=TASK_COORDINATOR to prevent duplication", async () => {
      // Create janitor run and recommendation
      const janitorRun = await db.janitor_runs.create({
        data: {janitor_config_id: testWorkspace.janitorConfig!.id,janitor_type: "UNIT_TESTS",
          status: "COMPLETED",
          metadata: {},
        },
      });

      const recommendation = await db.janitor_recommendations.create({
        data: {janitor_run_id: janitorRun.id,workspace_id: testWorkspace.id,
          title: "Test Recommendation",
          description: "Test recommendation description",
          priority: "HIGH",
          impact: "Test impact",
          status: "PENDING",
          metadata: {},
        },
      });

      // Execute endpoint
      const mockRequest = createAuthenticatedRequest();
      process.env.TASK_COORDINATOR_ENABLED = "true";

      const response = await GET(mockRequest);
      const result = await response.json();

      expect(response.status).toBe(200);

      // Verify created task has TASK_COORDINATOR sourceType
      const createdTask = await db.tasks.findFirst({
        where: {workspace_id: testWorkspace.id,
        },
      });

      expect(createdTask).not.toBeNull();
      expect(createdTask!.sourceType).toBe("TASK_COORDINATOR");
    });

    test("should not create duplicate tasks from same recommendation", async () => {
      // Create janitor run and recommendation
      const janitorRun = await db.janitor_runs.create({
        data: {janitor_config_id: testWorkspace.janitorConfig!.id,janitor_type: "UNIT_TESTS",
          status: "COMPLETED",
          metadata: {},
        },
      });

      const recommendation = await db.janitor_recommendations.create({
        data: {janitor_run_id: janitorRun.id,workspace_id: testWorkspace.id,
          title: "Test Recommendation",
          description: "Test recommendation description",
          priority: "HIGH",
          impact: "Test impact",
          status: "PENDING",
          metadata: {},
        },
      });

      // Execute endpoint twice
      const mockRequest = createAuthenticatedRequest();
      process.env.TASK_COORDINATOR_ENABLED = "true";

      await GET(mockRequest);
      await GET(mockRequest); // Second execution

      // Count tasks created
      const taskCount = await db.tasks.count({
        where: {workspace_id: testWorkspace.id,source_type: "TASK_COORDINATOR",
        },
      });

      expect(taskCount).toBe(1); // Only 1 task created (no duplication)
    });
  });

  describe("Error Isolation", () => {
    test("should continue processing other workspaces when one fails", async () => {
      // Create second workspace without swarm (should fail)
      const workspace2 = await db.workspaces.create({
        data: {
          slug: "workspace-no-swarm",
          name: "Workspace Without Swarm",owner_id: testUser.id,
          // No swarm created - this workspace lacks a swarm
          janitorConfig: {
            create: {
              taskCoordinatorEnabled: true,
              recommendationSweepEnabled: true,ticket_sweep_enabled: false,
            },
          },
        },
        include: {
          janitorConfig: true,
        },
      });

      // Create recommendation for first workspace (should succeed)
      const janitorRun = await db.janitor_runs.create({
        data: {janitor_config_id: testWorkspace.janitorConfig!.id,janitor_type: "UNIT_TESTS",
          status: "COMPLETED",
          metadata: {},
        },
      });

      await db.janitor_recommendations.create({
        data: {janitor_run_id: janitorRun.id,workspace_id: testWorkspace.id,
          title: "Test Recommendation",
          description: "Test recommendation description",
          priority: "HIGH",
          impact: "Test impact",
          status: "PENDING",
          metadata: {},
        },
      });

      // Execute endpoint
      const mockRequest = createAuthenticatedRequest();
      process.env.TASK_COORDINATOR_ENABLED = "true";

      const response = await GET(mockRequest);
      const result = await response.json();

      // Response should indicate partial success
      expect(response.status).toBe(200);
      expect(result.workspacesProcessed).toBe(2); // Both workspaces processed
      expect(result.tasksCreated).toBe(1); // Only first workspace succeeded

      // Verify task was created for successful workspace
      const taskCount = await db.tasks.count({
        where: {workspace_id: testWorkspace.id,
        },
      });

      expect(taskCount).toBe(1);
    });
  });

  describe("Environment Configuration", () => {
    test("should skip execution when TASK_COORDINATOR_ENABLED is false", async () => {
      // Execute endpoint with disabled flag
      const mockRequest = createAuthenticatedRequest();
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
      const janitorRun = await db.janitor_runs.create({
        data: {janitor_config_id: testWorkspace.janitorConfig!.id,janitor_type: "UNIT_TESTS",
          status: "COMPLETED",
          metadata: {},
        },
      });

      await db.janitor_recommendations.create({
        data: {janitor_run_id: janitorRun.id,workspace_id: testWorkspace.id,
          title: "Test Recommendation",
          description: "Test recommendation description",
          priority: "HIGH",
          impact: "Test impact",
          status: "PENDING",
          metadata: {},
        },
      });

      // Execute endpoint
      const mockRequest = createAuthenticatedRequest();
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
