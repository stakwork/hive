import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { Priority, RecommendationStatus } from "@prisma/client";
import { JanitorTestDataFactory } from "@/__tests__/support/fixtures";

// Mock all dependencies at module level
vi.mock("@/lib/db", () => ({
  db: {workspaces: {
      findMany: vi.fn(),
    },janitor_recommendations: {
      findMany: vi.fn(),
    },tasks: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("@/lib/pods/status-queries", () => ({
  getPoolStatusFromPods: vi.fn(),
}));

vi.mock("@/services/janitor", () => ({
  acceptJanitorRecommendation: vi.fn(),
}));

vi.mock("@/services/task-workflow", () => ({
  startTaskWorkflow: vi.fn(),
}));

vi.mock("@/lib/pods", () => ({
  releaseTaskPod: vi.fn().mockResolvedValue({ success: true, podDropped: false, taskCleared: false }),
}));

vi.mock("@/lib/helpers/workflow-status", () => ({
  updateTaskWorkflowStatus: vi.fn().mockResolvedValue(undefined),
}));

// Import mocked modules
const { db: mockDb } = await import("@/lib/db");
const { getPoolStatusFromPods: mockGetPoolStatusFromPods } = await import("@/lib/pods/status-queries");
const { acceptJanitorRecommendation: mockAcceptJanitorRecommendation } = await import("@/services/janitor");
const { startTaskWorkflow: mockStartTaskWorkflow } = await import("@/services/task-workflow");

// Import functions under test
const { executeTaskCoordinatorRuns, processTicketSweep, areDependenciesSatisfied } = await import("@/services/task-coordinator-cron");

// Test Helpers - Setup and assertion utilities
const TestHelpers = {
  setupWorkspaceWithConfig: (workspaces: any[] = [JanitorTestDataFactory.createValidWorkspace()]) => {
    vi.mocked(mockDb.workspaces.findMany).mockResolvedValue(workspaces as any);
  },

  setupPoolManagerResponse: (unusedVms: number) => {
    vi.mocked(mockGetPoolStatusFromPods).mockResolvedValue({
      unusedVms,
      runningVms: unusedVms,
      pendingVms: 0,
      failedVms: 0,
      usedVms: 0,
      lastCheck: new Date().toISOString(),
      queuedCount: 0,
    });
  },

  setupRecommendations: (recommendations: any[] = []) => {
    vi.mocked(mockDb.janitor_recommendations.findMany).mockResolvedValue(recommendations as any);
  },

  setupAcceptRecommendationSuccess: () => {
    vi.mocked(mockAcceptJanitorRecommendation).mockResolvedValue(
      JanitorTestDataFactory.createAcceptRecommendationResult() as any
    );
  },

  setupAcceptRecommendationFailure: (errorMessage: string) => {
    vi.mocked(mockAcceptJanitorRecommendation).mockRejectedValue(new Error(errorMessage));
  },

  expectWorkspaceQueryCalled: () => {
    expect(mockDb.workspaces.findMany).toHaveBeenCalledWith({
      where: {
        janitorConfig: {
          OR: [
            { recommendationSweepEnabled: true },
            { ticketSweepEnabled: true },
          ],
        },
      },
      include: {
        janitorConfig: true,
        swarm: true,
        owner: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });
  },

  expectPoolStatusCalled: (swarmId: string, workspaceId: string) => {
    expect(mockGetPoolStatusFromPods).toHaveBeenCalledWith(swarmId, workspaceId);
  },

  expectRecommendationsQueryCalled: (workspaceId: string) => {
    expect(mockDb.janitor_recommendations.findMany).toHaveBeenCalledWith({
      where: {
        status: "PENDING",
        janitorRun: {
          janitorConfig: {
            workspaceId,
          },
        },
      },
      include: {
        janitorRun: {
          include: {
            janitorConfig: {
              include: {
                workspace: true,
              },
            },
          },
        },
      },
      orderBy: [
        {
          priority: "desc",
        },
        {
          createdAt: "asc",
        },
      ],
      take: 1,
    });
  },

  expectAcceptRecommendationCalled: (
    recommendationId: string,
    ownerId: string,
    sourceType: "TASK_COORDINATOR" = "TASK_COORDINATOR"
  ) => {
    expect(mockAcceptJanitorRecommendation).toHaveBeenCalledWith(
      recommendationId,
      ownerId,
      {},
      sourceType
    );
  },

  expectConsoleLog: (message: string) => {
    const consoleLogSpy = vi.spyOn(console, "log");
    return consoleLogSpy;
  },

  expectConsoleError: (message: string) => {
    const consoleErrorSpy = vi.spyOn(console, "error");
    return consoleErrorSpy;
  },
};

// --- Candidate task factory for ticket sweep tests ---
function createCandidateTask(overrides: Record<string, any> = {}) {
  return {
    id: `task-${Math.random().toString(36).slice(2, 8)}`,
    title: "Test Task",
    featureId: null,
    priority: "MEDIUM",
    createdAt: new Date(),
    createdById: "user-1",
    dependsOnTaskIds: [],
    autoMerge: false,
    feature: null,
    phase: null,
    ...overrides,
  };
}

// Mock Setup Helper - Centralized mock configuration
const MockSetup = {
  reset: () => {
    vi.clearAllMocks();
    // Mock empty task list by default (no stale tasks)
    vi.mocked(mockDb.tasks.findMany).mockResolvedValue([]);
    vi.mocked(mockDb.tasks.update).mockResolvedValue({} as any);
    vi.mocked(mockStartTaskWorkflow).mockResolvedValue(undefined as any);
  },

  setupSuccessfulExecution: (unusedVms: number = 3) => {
    const workspace = JanitorTestDataFactory.createValidWorkspace();
    TestHelpers.setupWorkspaceWithConfig([workspace]);
    TestHelpers.setupPoolManagerResponse(unusedVms);
    const recommendation = JanitorTestDataFactory.createPendingRecommendation("HIGH");
    TestHelpers.setupRecommendations([recommendation]);
    TestHelpers.setupAcceptRecommendationSuccess();
    return { workspace, recommendation };
  },

  setupMultipleWorkspaces: (workspaces: any[]) => {
    TestHelpers.setupWorkspaceWithConfig(workspaces);
    TestHelpers.setupPoolManagerResponse(3);
    TestHelpers.setupRecommendations([]);
    TestHelpers.setupAcceptRecommendationSuccess();
  },

  setupNoEnabledWorkspaces: () => {
    TestHelpers.setupWorkspaceWithConfig([]);
  },

  setupInsufficientPods: () => {
    const workspace = JanitorTestDataFactory.createValidWorkspace();
    TestHelpers.setupWorkspaceWithConfig([workspace]);
    TestHelpers.setupPoolManagerResponse(1); // Only 1 unused VM (needs 2+)
    TestHelpers.setupRecommendations([]);
    return { workspace };
  },

  setupNoRecommendations: () => {
    const workspace = JanitorTestDataFactory.createValidWorkspace();
    TestHelpers.setupWorkspaceWithConfig([workspace]);
    TestHelpers.setupPoolManagerResponse(3);
    TestHelpers.setupRecommendations([]);
    return { workspace };
  },
};

describe("executeTaskCoordinatorRuns", () => {
  beforeEach(() => {
    MockSetup.reset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("Workspace Discovery", () => {
    test("should find workspaces with task coordinator enabled", async () => {
      MockSetup.setupSuccessfulExecution();

      await executeTaskCoordinatorRuns();

      TestHelpers.expectWorkspaceQueryCalled();
    });

    test("should include janitorConfig, swarm, and owner in query", async () => {
      MockSetup.setupSuccessfulExecution();

      await executeTaskCoordinatorRuns();

      expect(mockDb.workspaces.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          include: expect.objectContaining({
            janitorConfig: true,
            swarm: true,
            owner: expect.objectContaining({
              select: expect.objectContaining({
                id: true,
                name: true,
                email: true,
              }),
            }),
          }),
        })
      );
    });

    test("should process multiple workspaces with task coordinator enabled", async () => {
      const workspace1 = JanitorTestDataFactory.createValidWorkspace({ id: "ws-1", slug: "workspace-1" });
      const workspace2 = JanitorTestDataFactory.createValidWorkspace({ id: "ws-2", slug: "workspace-2" });
      MockSetup.setupMultipleWorkspaces([workspace1, workspace2]);

      const result = await executeTaskCoordinatorRuns();

      expect(result.workspacesProcessed).toBe(2);
    });

    test("should return zero workspaces when none have task coordinator enabled", async () => {
      MockSetup.setupNoEnabledWorkspaces();

      const result = await executeTaskCoordinatorRuns();

      expect(result.workspacesProcessed).toBe(0);
      expect(result.tasksCreated).toBe(0);
      expect(result.success).toBe(true);
    });
  });

  describe("Swarm and Pool Configuration Validation", () => {
    test("should skip workspace without swarm configuration", async () => {
      const workspace = JanitorTestDataFactory.createWorkspaceWithoutSwarm();
      TestHelpers.setupWorkspaceWithConfig([workspace]);

      const result = await executeTaskCoordinatorRuns();

      expect(result.workspacesProcessed).toBe(1);
      expect(result.tasksCreated).toBe(0);
      expect(mockAcceptJanitorRecommendation).not.toHaveBeenCalled();
    });

    test("should process workspace that has swarm but no poolApiKey (poolApiKey no longer required)", async () => {
      const workspace = JanitorTestDataFactory.createWorkspaceWithoutPoolApiKey();
      TestHelpers.setupWorkspaceWithConfig([workspace]);
      TestHelpers.setupPoolManagerResponse(0); // No pods available → no tasks created
      TestHelpers.setupRecommendations([]);

      const result = await executeTaskCoordinatorRuns();

      expect(result.workspacesProcessed).toBe(1);
      expect(result.tasksCreated).toBe(0);
      expect(mockAcceptJanitorRecommendation).not.toHaveBeenCalled();
    });

    test("should log skip message for workspace without pool configuration", async () => {
      const consoleLogSpy = vi.spyOn(console, "log");
      const workspace = JanitorTestDataFactory.createWorkspaceWithoutSwarm();
      TestHelpers.setupWorkspaceWithConfig([workspace]);

      await executeTaskCoordinatorRuns();

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining(`Skipping workspace ${workspace.slug}: No pool configured`)
      );

      consoleLogSpy.mockRestore();
    });
  });

  describe("Pool Availability Check", () => {
    test("should check pool status for workspace with valid configuration", async () => {
      const { workspace } = MockSetup.setupSuccessfulExecution();

      await executeTaskCoordinatorRuns();

      TestHelpers.expectPoolStatusCalled(workspace.swarm!.id, workspace.id);
    });

    test("should process workspace when 2+ pods available", async () => {
      const workspace = JanitorTestDataFactory.createValidWorkspace();
      TestHelpers.setupWorkspaceWithConfig([workspace]);
      TestHelpers.setupPoolManagerResponse(2); // Exactly 2 unused VMs
      const recommendation = JanitorTestDataFactory.createPendingRecommendation("HIGH");
      TestHelpers.setupRecommendations([recommendation]);
      TestHelpers.setupAcceptRecommendationSuccess();

      const result = await executeTaskCoordinatorRuns();

      expect(result.tasksCreated).toBe(1);
    });

    test("should skip workspace when only 1 pod available", async () => {
      MockSetup.setupInsufficientPods();

      const result = await executeTaskCoordinatorRuns();

      expect(result.tasksCreated).toBe(0);
      expect(mockAcceptJanitorRecommendation).not.toHaveBeenCalled();
    });

    test("should skip workspace when 0 pods available", async () => {
      const workspace = JanitorTestDataFactory.createValidWorkspace();
      TestHelpers.setupWorkspaceWithConfig([workspace]);
      TestHelpers.setupPoolManagerResponse(0);

      const result = await executeTaskCoordinatorRuns();

      expect(result.tasksCreated).toBe(0);
      expect(mockAcceptJanitorRecommendation).not.toHaveBeenCalled();
    });

    test("should log insufficient pods message", async () => {
      const consoleLogSpy = vi.spyOn(console, "log");
      const { workspace } = MockSetup.setupInsufficientPods();

      await executeTaskCoordinatorRuns();

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          `Insufficient available pods for workspace ${workspace.slug} (need 2+ to reserve 1), skipping`
        )
      );

      consoleLogSpy.mockRestore();
    });

    test("should call getPoolStatusFromPods with swarmId and workspaceId", async () => {
      const { workspace } = MockSetup.setupSuccessfulExecution();

      await executeTaskCoordinatorRuns();

      expect(mockGetPoolStatusFromPods).toHaveBeenCalledWith(
        workspace.swarm!.id,
        workspace.id
      );
    });
  });

  describe("Recommendation Processing", () => {
    test("should fetch pending recommendations for workspace", async () => {
      const { workspace } = MockSetup.setupSuccessfulExecution();

      await executeTaskCoordinatorRuns();

      TestHelpers.expectRecommendationsQueryCalled(workspace.id);
    });

    test("should order recommendations by priority descending and createdAt ascending", async () => {
      MockSetup.setupSuccessfulExecution();

      await executeTaskCoordinatorRuns();

      expect(mockDb.janitor_recommendations.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: [
            { priority: "desc" },
            { createdAt: "asc" },
          ],
        })
      );
    });

    test("should limit to 1 recommendation per workspace", async () => {
      MockSetup.setupSuccessfulExecution();

      await executeTaskCoordinatorRuns();

      expect(mockDb.janitor_recommendations.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 1,
        })
      );
    });

    test("should process CRITICAL priority recommendation first", async () => {
      const workspace = JanitorTestDataFactory.createValidWorkspace();
      TestHelpers.setupWorkspaceWithConfig([workspace]);
      TestHelpers.setupPoolManagerResponse(3);
      const criticalRec = JanitorTestDataFactory.createPendingRecommendation("CRITICAL");
      TestHelpers.setupRecommendations([criticalRec]);
      TestHelpers.setupAcceptRecommendationSuccess();

      await executeTaskCoordinatorRuns();

      TestHelpers.expectAcceptRecommendationCalled(
        criticalRec.id,
        workspace.owner.id,
        "TASK_COORDINATOR"
      );
    });

    test("should skip workspace with no pending recommendations", async () => {
      MockSetup.setupNoRecommendations();

      const result = await executeTaskCoordinatorRuns();

      expect(result.tasksCreated).toBe(0);
      expect(mockAcceptJanitorRecommendation).not.toHaveBeenCalled();
    });

    test("should log when no pending recommendations found", async () => {
      const consoleLogSpy = vi.spyOn(console, "log");
      const { workspace } = MockSetup.setupNoRecommendations();

      await executeTaskCoordinatorRuns();

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining(`Found 0 pending recommendations for workspace ${workspace.slug}`)
      );

      consoleLogSpy.mockRestore();
    });
  });

  describe("Task Creation via acceptJanitorRecommendation", () => {
    test("should auto-accept recommendation with workspace owner as user", async () => {
      const { workspace, recommendation } = MockSetup.setupSuccessfulExecution();

      await executeTaskCoordinatorRuns();

      TestHelpers.expectAcceptRecommendationCalled(
        recommendation.id,
        workspace.owner.id,
        "TASK_COORDINATOR"
      );
    });

    test("should pass TASK_COORDINATOR as sourceType", async () => {
      const { recommendation, workspace } = MockSetup.setupSuccessfulExecution();

      await executeTaskCoordinatorRuns();

      expect(mockAcceptJanitorRecommendation).toHaveBeenCalledWith(
        recommendation.id,
        workspace.owner.id,
        {},
        "TASK_COORDINATOR"
      );
    });

    test("should pass empty options object (no specific assignee or repository)", async () => {
      const { recommendation, workspace } = MockSetup.setupSuccessfulExecution();

      await executeTaskCoordinatorRuns();

      expect(mockAcceptJanitorRecommendation).toHaveBeenCalledWith(
        recommendation.id,
        workspace.owner.id,
        {},
        expect.any(String)
      );
    });

    test("should increment tasksCreated counter on successful acceptance", async () => {
      MockSetup.setupSuccessfulExecution();

      const result = await executeTaskCoordinatorRuns();

      expect(result.tasksCreated).toBe(1);
    });

    test("should log successful task creation", async () => {
      const consoleLogSpy = vi.spyOn(console, "log");
      const { recommendation } = MockSetup.setupSuccessfulExecution();

      await executeTaskCoordinatorRuns();

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining(`Successfully created task from recommendation ${recommendation.id}`)
      );

      consoleLogSpy.mockRestore();
    });

    test("should dynamically import acceptJanitorRecommendation from janitor service", async () => {
      MockSetup.setupSuccessfulExecution();

      await executeTaskCoordinatorRuns();

      expect(mockAcceptJanitorRecommendation).toHaveBeenCalled();
    });
  });

  describe("Priority Ordering", () => {
    test("should process CRITICAL priority over HIGH priority", async () => {
      const workspace = JanitorTestDataFactory.createValidWorkspace();
      TestHelpers.setupWorkspaceWithConfig([workspace]);
      TestHelpers.setupPoolManagerResponse(3);
      // findMany should return CRITICAL first due to DESC ordering
      const criticalRec = JanitorTestDataFactory.createPendingRecommendation("CRITICAL");
      TestHelpers.setupRecommendations([criticalRec]);
      TestHelpers.setupAcceptRecommendationSuccess();

      await executeTaskCoordinatorRuns();

      expect(mockAcceptJanitorRecommendation).toHaveBeenCalledWith(
        criticalRec.id,
        expect.any(String),
        expect.any(Object),
        expect.any(String)
      );
    });

    test("should process HIGH priority over MEDIUM priority", async () => {
      const workspace = JanitorTestDataFactory.createValidWorkspace();
      TestHelpers.setupWorkspaceWithConfig([workspace]);
      TestHelpers.setupPoolManagerResponse(3);
      const highRec = JanitorTestDataFactory.createPendingRecommendation("HIGH");
      TestHelpers.setupRecommendations([highRec]);
      TestHelpers.setupAcceptRecommendationSuccess();

      await executeTaskCoordinatorRuns();

      expect(mockAcceptJanitorRecommendation).toHaveBeenCalledWith(
        highRec.id,
        expect.any(String),
        expect.any(Object),
        expect.any(String)
      );
    });

    test("should process MEDIUM priority over LOW priority", async () => {
      const workspace = JanitorTestDataFactory.createValidWorkspace();
      TestHelpers.setupWorkspaceWithConfig([workspace]);
      TestHelpers.setupPoolManagerResponse(3);
      const mediumRec = JanitorTestDataFactory.createPendingRecommendation("MEDIUM");
      TestHelpers.setupRecommendations([mediumRec]);
      TestHelpers.setupAcceptRecommendationSuccess();

      await executeTaskCoordinatorRuns();

      expect(mockAcceptJanitorRecommendation).toHaveBeenCalledWith(
        mediumRec.id,
        expect.any(String),
        expect.any(Object),
        expect.any(String)
      );
    });

    test("should log priority level when auto-accepting", async () => {
      const consoleLogSpy = vi.spyOn(console, "log");
      const workspace = JanitorTestDataFactory.createValidWorkspace();
      TestHelpers.setupWorkspaceWithConfig([workspace]);
      TestHelpers.setupPoolManagerResponse(3);
      const criticalRec = JanitorTestDataFactory.createPendingRecommendation("CRITICAL");
      TestHelpers.setupRecommendations([criticalRec]);
      TestHelpers.setupAcceptRecommendationSuccess();

      await executeTaskCoordinatorRuns();

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          `Auto-accepting recommendation ${criticalRec.id} (CRITICAL) for workspace ${workspace.slug}`
        )
      );

      consoleLogSpy.mockRestore();
    });
  });

  describe("Error Handling - Workspace Processing", () => {
    test("should continue processing next workspace after one fails", async () => {
      const workspace1 = JanitorTestDataFactory.createValidWorkspace({ id: "ws-1", slug: "workspace-1" });
      const workspace2 = JanitorTestDataFactory.createValidWorkspace({ id: "ws-2", slug: "workspace-2" });
      TestHelpers.setupWorkspaceWithConfig([workspace1, workspace2]);

      // First workspace pool check fails, second succeeds
      vi.mocked(mockGetPoolStatusFromPods)
        .mockRejectedValueOnce(new Error("Pool API error"))
        .mockResolvedValueOnce({
          unusedVms: 3,
          runningVms: 3,
          pendingVms: 0,
          failedVms: 0,
          usedVms: 0,
          lastCheck: new Date().toISOString(),
          queuedCount: 0,
        });

      TestHelpers.setupRecommendations([]);

      const result = await executeTaskCoordinatorRuns();

      expect(result.workspacesProcessed).toBe(2);
      expect(result.errorCount).toBe(1);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toEqual({
        workspaceSlug: workspace1.slug,
        error: expect.stringContaining("Pool API error"),
      });
    });

    test("should log error when workspace processing fails", async () => {
      const consoleErrorSpy = vi.spyOn(console, "error");
      const workspace = JanitorTestDataFactory.createValidWorkspace();
      TestHelpers.setupWorkspaceWithConfig([workspace]);
      vi.mocked(mockGetPoolStatusFromPods).mockRejectedValue(new Error("Pool connection timeout"));

      await executeTaskCoordinatorRuns();

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining(`Error processing workspace ${workspace.slug}:`),
        expect.stringContaining("Pool connection timeout")
      );

      consoleErrorSpy.mockRestore();
    });

    test("should include workspace slug in error object", async () => {
      const workspace = JanitorTestDataFactory.createValidWorkspace();
      TestHelpers.setupWorkspaceWithConfig([workspace]);
      vi.mocked(mockGetPoolStatusFromPods).mockRejectedValue(new Error("Test error"));

      const result = await executeTaskCoordinatorRuns();

      expect(result.errors[0]).toEqual({
        workspaceSlug: workspace.slug,
        error: expect.any(String),
      });
    });
  });

  describe("Error Handling - Recommendation Acceptance", () => {
    test("should continue processing after recommendation acceptance fails", async () => {
      const workspace = JanitorTestDataFactory.createValidWorkspace();
      TestHelpers.setupWorkspaceWithConfig([workspace]);
      TestHelpers.setupPoolManagerResponse(3);
      const recommendation = JanitorTestDataFactory.createPendingRecommendation("HIGH");
      TestHelpers.setupRecommendations([recommendation]);
      TestHelpers.setupAcceptRecommendationFailure("Recommendation already processed");

      const result = await executeTaskCoordinatorRuns();

      expect(result.workspacesProcessed).toBe(1);
      expect(result.tasksCreated).toBe(0);
      expect(result.errorCount).toBe(1);
    });

    test("should log error when recommendation acceptance fails", async () => {
      const consoleErrorSpy = vi.spyOn(console, "error");
      const workspace = JanitorTestDataFactory.createValidWorkspace();
      TestHelpers.setupWorkspaceWithConfig([workspace]);
      TestHelpers.setupPoolManagerResponse(3);
      const recommendation = JanitorTestDataFactory.createPendingRecommendation("HIGH");
      TestHelpers.setupRecommendations([recommendation]);
      TestHelpers.setupAcceptRecommendationFailure("Database connection error");

      await executeTaskCoordinatorRuns();

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining(`Failed to accept recommendation ${recommendation.id}:`),
        expect.stringContaining("Database connection error")
      );

      consoleErrorSpy.mockRestore();
    });

    test("should include recommendation ID in error message", async () => {
      const workspace = JanitorTestDataFactory.createValidWorkspace();
      TestHelpers.setupWorkspaceWithConfig([workspace]);
      TestHelpers.setupPoolManagerResponse(3);
      const recommendation = JanitorTestDataFactory.createPendingRecommendation("HIGH");
      TestHelpers.setupRecommendations([recommendation]);
      TestHelpers.setupAcceptRecommendationFailure("Permission denied");

      const result = await executeTaskCoordinatorRuns();

      expect(result.errors[0]).toEqual({
        workspaceSlug: workspace.slug,
        error: expect.stringContaining(`Failed to accept recommendation ${recommendation.id}`),
      });
    });

    test("should not increment tasksCreated when acceptance fails", async () => {
      const workspace = JanitorTestDataFactory.createValidWorkspace();
      TestHelpers.setupWorkspaceWithConfig([workspace]);
      TestHelpers.setupPoolManagerResponse(3);
      const recommendation = JanitorTestDataFactory.createPendingRecommendation("HIGH");
      TestHelpers.setupRecommendations([recommendation]);
      TestHelpers.setupAcceptRecommendationFailure("Validation error");

      const result = await executeTaskCoordinatorRuns();

      expect(result.tasksCreated).toBe(0);
    });
  });

  describe("Error Handling - Critical Failures", () => {
    test("should return system error when workspace query fails", async () => {
      vi.mocked(mockDb.workspaces.findMany).mockRejectedValue(new Error("Database connection lost"));

      const result = await executeTaskCoordinatorRuns();

      expect(result.success).toBe(false);
      expect(result.errorCount).toBe(1);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toEqual({
        workspaceSlug: "SYSTEM",
        error: expect.stringContaining("Critical execution error: Database connection lost"),
      });
    });

    test("should log critical error to console", async () => {
      const consoleErrorSpy = vi.spyOn(console, "error");
      vi.mocked(mockDb.workspaces.findMany).mockRejectedValue(new Error("Fatal database error"));

      await executeTaskCoordinatorRuns();

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("Critical error during execution:"),
        expect.stringContaining("Fatal database error")
      );

      consoleErrorSpy.mockRestore();
    });

    test("should handle non-Error thrown values", async () => {
      vi.mocked(mockDb.workspaces.findMany).mockRejectedValue("String error");

      const result = await executeTaskCoordinatorRuns();

      expect(result.success).toBe(false);
      expect(result.errors[0]).toEqual({
        workspaceSlug: "SYSTEM",
        error: expect.stringContaining("String error"),
      });
    });
  });

  describe("Result Aggregation", () => {
    test("should return success: true when no errors occur", async () => {
      MockSetup.setupSuccessfulExecution();

      const result = await executeTaskCoordinatorRuns();

      expect(result.success).toBe(true);
    });

    test("should return success: false when errors occur", async () => {
      const workspace = JanitorTestDataFactory.createValidWorkspace();
      TestHelpers.setupWorkspaceWithConfig([workspace]);
      vi.mocked(mockGetPoolStatusFromPods).mockRejectedValue(new Error("Pool error"));

      const result = await executeTaskCoordinatorRuns();

      expect(result.success).toBe(false);
    });

    test("should count workspacesProcessed correctly", async () => {
      const workspace1 = JanitorTestDataFactory.createValidWorkspace({ id: "ws-1" });
      const workspace2 = JanitorTestDataFactory.createValidWorkspace({ id: "ws-2" });
      MockSetup.setupMultipleWorkspaces([workspace1, workspace2]);

      const result = await executeTaskCoordinatorRuns();

      expect(result.workspacesProcessed).toBe(2);
    });

    test("should count tasksCreated correctly", async () => {
      const workspace = JanitorTestDataFactory.createValidWorkspace();
      TestHelpers.setupWorkspaceWithConfig([workspace]);
      TestHelpers.setupPoolManagerResponse(3);
      const recommendation = JanitorTestDataFactory.createPendingRecommendation("HIGH");
      TestHelpers.setupRecommendations([recommendation]);
      TestHelpers.setupAcceptRecommendationSuccess();

      const result = await executeTaskCoordinatorRuns();

      expect(result.tasksCreated).toBe(1);
    });

    test("should count errorCount correctly", async () => {
      const workspace1 = JanitorTestDataFactory.createValidWorkspace({ id: "ws-1", slug: "workspace-1" });
      const workspace2 = JanitorTestDataFactory.createValidWorkspace({ id: "ws-2", slug: "workspace-2" });
      TestHelpers.setupWorkspaceWithConfig([workspace1, workspace2]);

      vi.mocked(mockGetPoolStatusFromPods)
        .mockRejectedValueOnce(new Error("Error 1"))
        .mockRejectedValueOnce(new Error("Error 2"));

      const result = await executeTaskCoordinatorRuns();

      expect(result.errorCount).toBe(2);
    });

    test("should include errors array with error details", async () => {
      const workspace = JanitorTestDataFactory.createValidWorkspace();
      TestHelpers.setupWorkspaceWithConfig([workspace]);
      vi.mocked(mockGetPoolStatusFromPods).mockRejectedValue(new Error("Test error message"));

      const result = await executeTaskCoordinatorRuns();

      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toEqual({
        workspaceSlug: workspace.slug,
        error: expect.stringContaining("Test error message"),
      });
    });

    test("should include timestamp in ISO format", async () => {
      MockSetup.setupSuccessfulExecution();

      const beforeTime = new Date();
      const result = await executeTaskCoordinatorRuns();
      const afterTime = new Date();

      const timestamp = new Date(result.timestamp);
      expect(timestamp.getTime()).toBeGreaterThanOrEqual(beforeTime.getTime());
      expect(timestamp.getTime()).toBeLessThanOrEqual(afterTime.getTime());
      expect(result.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });

    test("should return zero counts when no workspaces processed", async () => {
      MockSetup.setupNoEnabledWorkspaces();

      const result = await executeTaskCoordinatorRuns();

      expect(result.workspacesProcessed).toBe(0);
      expect(result.tasksCreated).toBe(0);
      expect(result.errorCount).toBe(0);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe("Logging", () => {
    test("should log execution start with timestamp", async () => {
      const consoleLogSpy = vi.spyOn(console, "log");
      MockSetup.setupSuccessfulExecution();

      await executeTaskCoordinatorRuns();

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("[TaskCoordinator] Starting execution at"),
        expect.any(String)
      );

      consoleLogSpy.mockRestore();
    });

    test("should log number of workspaces found", async () => {
      const consoleLogSpy = vi.spyOn(console, "log");
      const workspace1 = JanitorTestDataFactory.createValidWorkspace({ id: "ws-1" });
      const workspace2 = JanitorTestDataFactory.createValidWorkspace({ id: "ws-2" });
      MockSetup.setupMultipleWorkspaces([workspace1, workspace2]);

      await executeTaskCoordinatorRuns();

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("[TaskCoordinator] Found 2 workspaces with Task Coordinator Sweeps enabled")
      );

      consoleLogSpy.mockRestore();
    });

    test("should log workspace processing start", async () => {
      const consoleLogSpy = vi.spyOn(console, "log");
      const { workspace } = MockSetup.setupSuccessfulExecution();

      await executeTaskCoordinatorRuns();

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining(`[TaskCoordinator] Processing workspace: ${workspace.slug}`)
      );

      consoleLogSpy.mockRestore();
    });

    test("should log available pods count", async () => {
      const consoleLogSpy = vi.spyOn(console, "log");
      const { workspace } = MockSetup.setupSuccessfulExecution(3);

      await executeTaskCoordinatorRuns();

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining(`[TaskCoordinator] Workspace ${workspace.slug} has 3 available pods`)
      );

      consoleLogSpy.mockRestore();
    });

    test("should log execution completion summary", async () => {
      const consoleLogSpy = vi.spyOn(console, "log");
      MockSetup.setupSuccessfulExecution();

      await executeTaskCoordinatorRuns();

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringMatching(
          /\[TaskCoordinator\] Execution completed in \d+ms\. Processed 1 workspaces, created 1 tasks, 0 errors/
        )
      );

      consoleLogSpy.mockRestore();
    });
  });

  describe("Ticket Sweep — Multi-Dispatch", () => {
    test("should dispatch multiple tasks when multiple slots available", async () => {
      const workspace = JanitorTestDataFactory.createValidWorkspace();
      TestHelpers.setupWorkspaceWithConfig([workspace]);
      TestHelpers.setupPoolManagerResponse(6); // slotsAvailable = 5

      // 5 eligible candidate tasks (no deps)
      const candidates = Array.from({ length: 5 }, () => createCandidateTask());
      // findMany called twice: first for stale tasks (returns []), then for ticket sweep candidates
      vi.mocked(mockDb.tasks.findMany)
        .mockResolvedValueOnce([]) // stale tasks query
        .mockResolvedValueOnce(candidates as any); // ticket sweep candidates

      TestHelpers.setupRecommendations([]);

      const result = await executeTaskCoordinatorRuns();

      expect(result.tasksCreated).toBe(5);
      expect(mockStartTaskWorkflow).toHaveBeenCalledTimes(5);
    });

    test("should partially fill when fewer eligible tasks than slots", async () => {
      const workspace = JanitorTestDataFactory.createValidWorkspace();
      TestHelpers.setupWorkspaceWithConfig([workspace]);
      TestHelpers.setupPoolManagerResponse(6); // slotsAvailable = 5

      // Only 2 eligible candidates
      const candidates = Array.from({ length: 2 }, () => createCandidateTask());
      vi.mocked(mockDb.tasks.findMany)
        .mockResolvedValueOnce([]) // stale tasks query
        .mockResolvedValueOnce(candidates as any);

      TestHelpers.setupRecommendations([]);

      const result = await executeTaskCoordinatorRuns();

      expect(result.tasksCreated).toBe(2);
      expect(mockStartTaskWorkflow).toHaveBeenCalledTimes(2);
    });

    test("should dispatch exactly 1 task when slotsAvailable = 1", async () => {
      const workspace = JanitorTestDataFactory.createValidWorkspace();
      TestHelpers.setupWorkspaceWithConfig([workspace]);
      TestHelpers.setupPoolManagerResponse(2); // slotsAvailable = 1

      const candidates = Array.from({ length: 3 }, () => createCandidateTask());
      vi.mocked(mockDb.tasks.findMany)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce(candidates as any);

      TestHelpers.setupRecommendations([]);

      const result = await executeTaskCoordinatorRuns();

      expect(result.tasksCreated).toBe(1);
      expect(mockStartTaskWorkflow).toHaveBeenCalledTimes(1);
    });

    test("should accumulate tasksCreated correctly across multiple workspaces", async () => {
      const workspace1 = JanitorTestDataFactory.createValidWorkspace({ id: "ws-1", slug: "ws-1" });
      const workspace2 = JanitorTestDataFactory.createValidWorkspace({ id: "ws-2", slug: "ws-2" });
      TestHelpers.setupWorkspaceWithConfig([workspace1, workspace2]);

      vi.mocked(mockGetPoolStatusFromPods)
        .mockResolvedValueOnce({
          unusedVms: 4, runningVms: 4, pendingVms: 0, failedVms: 0, usedVms: 0, lastCheck: new Date().toISOString(), queuedCount: 0,
        })
        .mockResolvedValueOnce({
          unusedVms: 3, runningVms: 3, pendingVms: 0, failedVms: 0, usedVms: 0, lastCheck: new Date().toISOString(), queuedCount: 0,
        });

      // ws-1 → 3 candidates (slotsAvailable=3), ws-2 → 2 candidates (slotsAvailable=2)
      const ws1Candidates = Array.from({ length: 3 }, () => createCandidateTask());
      const ws2Candidates = Array.from({ length: 2 }, () => createCandidateTask());
      vi.mocked(mockDb.tasks.findMany)
        .mockResolvedValueOnce([])          // stale tasks
        .mockResolvedValueOnce(ws1Candidates as any) // ws-1 ticket sweep
        .mockResolvedValueOnce(ws2Candidates as any); // ws-2 ticket sweep

      vi.mocked(mockDb.janitor_recommendations.findMany).mockResolvedValue([]);

      const result = await executeTaskCoordinatorRuns();

      expect(result.tasksCreated).toBe(5); // 3 + 2
      expect(mockStartTaskWorkflow).toHaveBeenCalledTimes(5);
    });

    test("should log dispatched count per workspace", async () => {
      const consoleLogSpy = vi.spyOn(console, "log");
      const workspace = JanitorTestDataFactory.createValidWorkspace();
      TestHelpers.setupWorkspaceWithConfig([workspace]);
      TestHelpers.setupPoolManagerResponse(4); // slotsAvailable = 3

      const candidates = Array.from({ length: 2 }, () => createCandidateTask());
      vi.mocked(mockDb.tasks.findMany)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce(candidates as any);

      TestHelpers.setupRecommendations([]);

      await executeTaskCoordinatorRuns();

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining(`Dispatched 2/3 tasks for workspace ${workspace.slug}`)
      );

      consoleLogSpy.mockRestore();
    });

    test("should skip recommendation sweep when ticket sweep dispatches at least 1 task", async () => {
      const workspace = JanitorTestDataFactory.createValidWorkspace();
      TestHelpers.setupWorkspaceWithConfig([workspace]);
      TestHelpers.setupPoolManagerResponse(3); // slotsAvailable = 2

      const candidates = [createCandidateTask()];
      vi.mocked(mockDb.tasks.findMany)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce(candidates as any);

      const recommendation = JanitorTestDataFactory.createPendingRecommendation("HIGH");
      TestHelpers.setupRecommendations([recommendation]);
      TestHelpers.setupAcceptRecommendationSuccess();

      await executeTaskCoordinatorRuns();

      // Recommendation should NOT have been accepted because ticket sweep dispatched a task
      expect(mockAcceptJanitorRecommendation).not.toHaveBeenCalled();
    });
  });

  describe("Edge Cases", () => {
    test("should handle workspace with both sweeps disabled", async () => {
      // This shouldn't happen due to query filter, but test defensive behavior
      const workspace = JanitorTestDataFactory.createValidWorkspace({
        janitorConfig: {
          taskCoordinatorEnabled: false,
          recommendationSweepEnabled: false,
          ticketSweepEnabled: false,
        },
      });
      // Override mock to return workspace despite filter
      vi.mocked(mockDb.workspaces.findMany).mockResolvedValue([workspace] as any);
      TestHelpers.setupPoolManagerResponse(3);
      TestHelpers.setupRecommendations([]);

      const result = await executeTaskCoordinatorRuns();

      // Should still process (query filter failed), but this tests defensive code
      expect(result.workspacesProcessed).toBe(1);
      expect(result.tasksCreated).toBe(0); // No sweeps enabled, so no tasks created
    });

    test("should handle empty errors array when all succeed", async () => {
      MockSetup.setupSuccessfulExecution();

      const result = await executeTaskCoordinatorRuns();

      expect(result.errors).toEqual([]);
      expect(result.errorCount).toBe(0);
    });

    test("should handle workspace with null janitorConfig", async () => {
      const workspace = {
        ...JanitorTestDataFactory.createValidWorkspace(),
        janitorConfig: null,
      };
      vi.mocked(mockDb.workspaces.findMany).mockResolvedValue([workspace] as any);

      const result = await executeTaskCoordinatorRuns();

      expect(result.workspacesProcessed).toBe(1);
    });

    test("should handle multiple recommendations but only process one", async () => {
      const workspace = JanitorTestDataFactory.createValidWorkspace();
      TestHelpers.setupWorkspaceWithConfig([workspace]);
      TestHelpers.setupPoolManagerResponse(3);
      // findMany returns only 1 due to take: 1
      const recommendation = JanitorTestDataFactory.createPendingRecommendation("HIGH");
      TestHelpers.setupRecommendations([recommendation]);
      TestHelpers.setupAcceptRecommendationSuccess();

      const result = await executeTaskCoordinatorRuns();

      expect(result.tasksCreated).toBe(1);
      expect(mockAcceptJanitorRecommendation).toHaveBeenCalledTimes(1);
    });

    test("should handle recommendation with null metadata", async () => {
      const workspace = JanitorTestDataFactory.createValidWorkspace();
      TestHelpers.setupWorkspaceWithConfig([workspace]);
      TestHelpers.setupPoolManagerResponse(3);
      const recommendation = JanitorTestDataFactory.createPendingRecommendation("MEDIUM", {
        metadata: null,
      });
      TestHelpers.setupRecommendations([recommendation]);
      TestHelpers.setupAcceptRecommendationSuccess();

      const result = await executeTaskCoordinatorRuns();

      expect(result.tasksCreated).toBe(1);
    });

    test("should handle very large unusedVms count", async () => {
      const workspace = JanitorTestDataFactory.createValidWorkspace();
      TestHelpers.setupWorkspaceWithConfig([workspace]);
      TestHelpers.setupPoolManagerResponse(100);
      const recommendation = JanitorTestDataFactory.createPendingRecommendation("LOW");
      TestHelpers.setupRecommendations([recommendation]);
      TestHelpers.setupAcceptRecommendationSuccess();

      const result = await executeTaskCoordinatorRuns();

      expect(result.tasksCreated).toBe(1);
    });

    test("should handle workspace owner with null email", async () => {
      const workspace = JanitorTestDataFactory.createValidWorkspace({
        owner: {
          id: "owner-1",
          name: "Test Owner",
          email: null,
        },
      });
      TestHelpers.setupWorkspaceWithConfig([workspace]);
      TestHelpers.setupPoolManagerResponse(3);
      const recommendation = JanitorTestDataFactory.createPendingRecommendation("HIGH");
      TestHelpers.setupRecommendations([recommendation]);
      TestHelpers.setupAcceptRecommendationSuccess();

      const result = await executeTaskCoordinatorRuns();

      expect(result.tasksCreated).toBe(1);
    });

    test("should handle mixed success and failure across workspaces", async () => {
      const workspace1 = JanitorTestDataFactory.createValidWorkspace({ id: "ws-1", slug: "workspace-1" });
      const workspace2 = JanitorTestDataFactory.createValidWorkspace({ id: "ws-2", slug: "workspace-2" });
      TestHelpers.setupWorkspaceWithConfig([workspace1, workspace2]);

      vi.mocked(mockGetPoolStatusFromPods).mockResolvedValue({
        unusedVms: 3,
        runningVms: 3,
        pendingVms: 0,
        failedVms: 0,
        usedVms: 0,
        lastCheck: new Date().toISOString(),
        queuedCount: 0,
      });

      const rec1 = JanitorTestDataFactory.createPendingRecommendation("HIGH");
      const rec2 = JanitorTestDataFactory.createPendingRecommendation("MEDIUM");

      vi.mocked(mockDb.janitor_recommendations.findMany)
        .mockResolvedValueOnce([rec1] as any)
        .mockResolvedValueOnce([rec2] as any);

      vi.mocked(mockAcceptJanitorRecommendation)
        .mockResolvedValueOnce(JanitorTestDataFactory.createAcceptRecommendationResult() as any)
        .mockRejectedValueOnce(new Error("Second workspace failed"));

      const result = await executeTaskCoordinatorRuns();

      expect(result.workspacesProcessed).toBe(2);
      expect(result.tasksCreated).toBe(1);
      expect(result.errorCount).toBe(1);
      expect(result.success).toBe(false);
    });
  });
});

describe("processTicketSweep", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(mockDb.tasks.findMany).mockResolvedValue([]);
    vi.mocked(mockStartTaskWorkflow).mockResolvedValue(undefined as any);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  test("multiple slots filled: 5 slots, 5 eligible tasks → returns 5, startTaskWorkflow called 5 times", async () => {
    const candidates = Array.from({ length: 5 }, () => createCandidateTask());
    vi.mocked(mockDb.tasks.findMany).mockResolvedValueOnce(candidates as any);

    const result = await processTicketSweep("ws-1", "workspace-1", 5);

    expect(result).toBe(5);
    expect(mockStartTaskWorkflow).toHaveBeenCalledTimes(5);
  });

  test("partial fill: 5 slots, 2 eligible tasks → returns 2, startTaskWorkflow called 2 times", async () => {
    const candidates = Array.from({ length: 2 }, () => createCandidateTask());
    vi.mocked(mockDb.tasks.findMany).mockResolvedValueOnce(candidates as any);

    const result = await processTicketSweep("ws-1", "workspace-1", 5);

    expect(result).toBe(2);
    expect(mockStartTaskWorkflow).toHaveBeenCalledTimes(2);
  });

  test("all skipped (deps unmet): 5 slots, 5 candidates all with unmet deps → returns 0", async () => {
    const blockerId = "blocker-task-id";
    // Candidates all depend on a non-existent task (will be missing → unmet)
    const candidates = Array.from({ length: 5 }, () =>
      createCandidateTask({ dependsOnTaskIds: [blockerId] })
    );
    vi.mocked(mockDb.tasks.findMany)
      .mockResolvedValueOnce(candidates as any) // candidates query
      .mockResolvedValue([] as any);            // areDependenciesSatisfied batch fetch (returns 0 tasks → length mismatch)

    const result = await processTicketSweep("ws-1", "workspace-1", 5);

    expect(result).toBe(0);
    expect(mockStartTaskWorkflow).not.toHaveBeenCalled();
  });

  test("single slot (slotsAvailable = 1): returns 1, only one workflow started", async () => {
    const candidates = Array.from({ length: 3 }, () => createCandidateTask());
    vi.mocked(mockDb.tasks.findMany).mockResolvedValueOnce(candidates as any);

    const result = await processTicketSweep("ws-1", "workspace-1", 1);

    expect(result).toBe(1);
    expect(mockStartTaskWorkflow).toHaveBeenCalledTimes(1);
  });

  test("mixed deps: 5 slots, 8 candidates where 3 have unmet deps → returns 5", async () => {
    const blockerId = "blocker-id";
    // 3 with unmet deps, 5 eligible (no deps)
    const candidates = [
      createCandidateTask({ id: "skip-1", dependsOnTaskIds: [blockerId] }),
      createCandidateTask({ id: "ok-1" }),
      createCandidateTask({ id: "skip-2", dependsOnTaskIds: [blockerId] }),
      createCandidateTask({ id: "ok-2" }),
      createCandidateTask({ id: "ok-3" }),
      createCandidateTask({ id: "skip-3", dependsOnTaskIds: [blockerId] }),
      createCandidateTask({ id: "ok-4" }),
      createCandidateTask({ id: "ok-5" }),
    ];
    // Candidates query returns the 8 candidates
    // areDependenciesSatisfied for tasks with deps will call task.findMany and get 0 results → unmet
    // areDependenciesSatisfied for tasks without deps returns true immediately (no DB call)
    vi.mocked(mockDb.tasks.findMany)
      .mockResolvedValueOnce(candidates as any) // candidates query
      .mockResolvedValue([] as any);            // dep checks for the 3 blocked tasks

    const result = await processTicketSweep("ws-1", "workspace-1", 5);

    expect(result).toBe(5);
    expect(mockStartTaskWorkflow).toHaveBeenCalledTimes(5);
  });

  test("no candidates: returns 0 immediately", async () => {
    vi.mocked(mockDb.tasks.findMany).mockResolvedValueOnce([] as any);

    const result = await processTicketSweep("ws-1", "workspace-1", 5);

    expect(result).toBe(0);
    expect(mockStartTaskWorkflow).not.toHaveBeenCalled();
  });

  test("workflow error on one task does not abort sweep — already dispatched count is preserved", async () => {
    const candidates = Array.from({ length: 3 }, () => createCandidateTask());
    vi.mocked(mockDb.tasks.findMany).mockResolvedValueOnce(candidates as any);

    // Second task throws, first and third succeed
    vi.mocked(mockStartTaskWorkflow)
      .mockResolvedValueOnce(undefined as any)
      .mockRejectedValueOnce(new Error("Stakwork API timeout"))
      .mockResolvedValueOnce(undefined as any);

    const result = await processTicketSweep("ws-1", "workspace-1", 5);

    // 2 succeeded despite 1 failure — sweep did not abort
    expect(result).toBe(2);
    expect(mockStartTaskWorkflow).toHaveBeenCalledTimes(3);
  });

  test("uses Math.max(slotsAvailable * 3, 20) as take for candidate query", async () => {
    vi.mocked(mockDb.tasks.findMany).mockResolvedValueOnce([] as any);

    // slotsAvailable=3 → take = max(9, 20) = 20
    await processTicketSweep("ws-1", "workspace-1", 3);

    expect(mockDb.tasks.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 20 })
    );

    vi.clearAllMocks();
    vi.mocked(mockDb.tasks.findMany).mockResolvedValueOnce([] as any);

    // slotsAvailable=10 → take = max(30, 20) = 30
    await processTicketSweep("ws-1", "workspace-1", 10);

    expect(mockDb.tasks.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 30 })
    );
  });
});
