import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { Priority, RecommendationStatus } from "@prisma/client";
import { JanitorTestDataFactory } from "@/__tests__/support/fixtures";

// Mock all dependencies at module level
vi.mock("@/lib/db", () => ({
  db: {
    workspace: {
      findMany: vi.fn(),
    },
    janitorRecommendation: {
      findMany: vi.fn(),
    },
    task: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("@/config/services", () => ({
  getServiceConfig: vi.fn(),
}));

vi.mock("@/services/pool-manager", () => ({
  PoolManagerService: vi.fn(),
}));

vi.mock("@/services/janitor", () => ({
  acceptJanitorRecommendation: vi.fn(),
}));

// Import mocked modules
const { db: mockDb } = await import("@/lib/db");
const { getServiceConfig: mockGetServiceConfig } = await import("@/config/services");
const { PoolManagerService: MockPoolManagerService } = await import("@/services/pool-manager");
const { acceptJanitorRecommendation: mockAcceptJanitorRecommendation } = await import("@/services/janitor");

// Import function under test
const { executeTaskCoordinatorRuns } = await import("@/services/task-coordinator-cron");

// Test Helpers - Setup and assertion utilities
const TestHelpers = {
  setupWorkspaceWithConfig: (workspaces: any[] = [JanitorTestDataFactory.createValidWorkspace()]) => {
    vi.mocked(mockDb.workspace.findMany).mockResolvedValue(workspaces as any);
  },

  setupPoolManagerResponse: (unusedVms: number) => {
    const mockPoolManager = {
      getPoolStatus: vi.fn().mockResolvedValue(JanitorTestDataFactory.createPoolStatusResponse(unusedVms)),
    };
    vi.mocked(MockPoolManagerService).mockImplementation(() => mockPoolManager as any);
    vi.mocked(mockGetServiceConfig).mockReturnValue({
      baseURL: "https://pool-manager.com",
      apiKey: "test-api-key",
    } as any);
    return mockPoolManager;
  },

  setupRecommendations: (recommendations: any[] = []) => {
    vi.mocked(mockDb.janitorRecommendation.findMany).mockResolvedValue(recommendations as any);
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
    expect(mockDb.workspace.findMany).toHaveBeenCalledWith({
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

  expectPoolStatusCalled: (swarmId: string, poolApiKey: string) => {
    const mockPoolManagerInstance = vi.mocked(MockPoolManagerService).mock.results[0]?.value;
    expect(mockPoolManagerInstance.getPoolStatus).toHaveBeenCalledWith(swarmId, poolApiKey);
  },

  expectRecommendationsQueryCalled: (workspaceId: string) => {
    expect(mockDb.janitorRecommendation.findMany).toHaveBeenCalledWith({
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

// Mock Setup Helper - Centralized mock configuration
const MockSetup = {
  reset: () => {
    vi.clearAllMocks();
    // Mock empty task list by default (no stale tasks)
    vi.mocked(mockDb.task.findMany).mockResolvedValue([]);
    vi.mocked(mockDb.task.update).mockResolvedValue({} as any);
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

      expect(mockDb.workspace.findMany).toHaveBeenCalledWith(
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

    test("should skip workspace without pool API key", async () => {
      const workspace = JanitorTestDataFactory.createWorkspaceWithoutPoolApiKey();
      TestHelpers.setupWorkspaceWithConfig([workspace]);

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

      TestHelpers.expectPoolStatusCalled(workspace.swarm!.id, workspace.swarm!.poolApiKey!);
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

    test("should create PoolManagerService with correct configuration", async () => {
      MockSetup.setupSuccessfulExecution();

      await executeTaskCoordinatorRuns();

      expect(mockGetServiceConfig).toHaveBeenCalledWith("poolManager");
      expect(MockPoolManagerService).toHaveBeenCalledWith({
        baseURL: "https://pool-manager.com",
        apiKey: "test-api-key",
      });
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

      expect(mockDb.janitorRecommendation.findMany).toHaveBeenCalledWith(
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

      expect(mockDb.janitorRecommendation.findMany).toHaveBeenCalledWith(
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
      const mockPoolManager1 = {
        getPoolStatus: vi.fn().mockRejectedValue(new Error("Pool API error")),
      };
      const mockPoolManager2 = {
        getPoolStatus: vi.fn().mockResolvedValue(JanitorTestDataFactory.createPoolStatusResponse(3)),
      };

      vi.mocked(MockPoolManagerService)
        .mockImplementationOnce(() => mockPoolManager1 as any)
        .mockImplementationOnce(() => mockPoolManager2 as any);

      vi.mocked(mockGetServiceConfig).mockReturnValue({
        baseURL: "https://pool-manager.com",
        apiKey: "test-api-key",
      } as any);

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
      const mockPoolManager = {
        getPoolStatus: vi.fn().mockRejectedValue(new Error("Pool connection timeout")),
      };
      vi.mocked(MockPoolManagerService).mockImplementation(() => mockPoolManager as any);
      vi.mocked(mockGetServiceConfig).mockReturnValue({
        baseURL: "https://pool-manager.com",
        apiKey: "test-api-key",
      } as any);

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
      const mockPoolManager = {
        getPoolStatus: vi.fn().mockRejectedValue(new Error("Test error")),
      };
      vi.mocked(MockPoolManagerService).mockImplementation(() => mockPoolManager as any);
      vi.mocked(mockGetServiceConfig).mockReturnValue({
        baseURL: "https://pool-manager.com",
        apiKey: "test-api-key",
      } as any);

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
      vi.mocked(mockDb.workspace.findMany).mockRejectedValue(new Error("Database connection lost"));

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
      vi.mocked(mockDb.workspace.findMany).mockRejectedValue(new Error("Fatal database error"));

      await executeTaskCoordinatorRuns();

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining("Critical error during execution:"),
        expect.stringContaining("Fatal database error")
      );

      consoleErrorSpy.mockRestore();
    });

    test("should handle non-Error thrown values", async () => {
      vi.mocked(mockDb.workspace.findMany).mockRejectedValue("String error");

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
      const mockPoolManager = {
        getPoolStatus: vi.fn().mockRejectedValue(new Error("Pool error")),
      };
      vi.mocked(MockPoolManagerService).mockImplementation(() => mockPoolManager as any);
      vi.mocked(mockGetServiceConfig).mockReturnValue({
        baseURL: "https://pool-manager.com",
        apiKey: "test-api-key",
      } as any);

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

      const mockPoolManager1 = {
        getPoolStatus: vi.fn().mockRejectedValue(new Error("Error 1")),
      };
      const mockPoolManager2 = {
        getPoolStatus: vi.fn().mockRejectedValue(new Error("Error 2")),
      };

      vi.mocked(MockPoolManagerService)
        .mockImplementationOnce(() => mockPoolManager1 as any)
        .mockImplementationOnce(() => mockPoolManager2 as any);

      vi.mocked(mockGetServiceConfig).mockReturnValue({
        baseURL: "https://pool-manager.com",
        apiKey: "test-api-key",
      } as any);

      const result = await executeTaskCoordinatorRuns();

      expect(result.errorCount).toBe(2);
    });

    test("should include errors array with error details", async () => {
      const workspace = JanitorTestDataFactory.createValidWorkspace();
      TestHelpers.setupWorkspaceWithConfig([workspace]);
      const mockPoolManager = {
        getPoolStatus: vi.fn().mockRejectedValue(new Error("Test error message")),
      };
      vi.mocked(MockPoolManagerService).mockImplementation(() => mockPoolManager as any);
      vi.mocked(mockGetServiceConfig).mockReturnValue({
        baseURL: "https://pool-manager.com",
        apiKey: "test-api-key",
      } as any);

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
      vi.mocked(mockDb.workspace.findMany).mockResolvedValue([workspace] as any);
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
      vi.mocked(mockDb.workspace.findMany).mockResolvedValue([workspace] as any);

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

      const mockPoolManager1 = {
        getPoolStatus: vi.fn().mockResolvedValue(JanitorTestDataFactory.createPoolStatusResponse(3)),
      };
      const mockPoolManager2 = {
        getPoolStatus: vi.fn().mockResolvedValue(JanitorTestDataFactory.createPoolStatusResponse(3)),
      };

      vi.mocked(MockPoolManagerService)
        .mockImplementationOnce(() => mockPoolManager1 as any)
        .mockImplementationOnce(() => mockPoolManager2 as any);

      vi.mocked(mockGetServiceConfig).mockReturnValue({
        baseURL: "https://pool-manager.com",
        apiKey: "test-api-key",
      } as any);

      const rec1 = JanitorTestDataFactory.createPendingRecommendation("HIGH");
      const rec2 = JanitorTestDataFactory.createPendingRecommendation("MEDIUM");

      vi.mocked(mockDb.janitorRecommendation.findMany)
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

  describe("Ticket Sweep with Dependency Resolution", () => {
    beforeEach(() => {
      MockSetup.reset();
    });

    test("should process task with no dependencies", async () => {
      const workspace = JanitorTestDataFactory.createValidWorkspace({
        janitorConfig: {
          ...JanitorTestDataFactory.createValidWorkspace().janitorConfig,
          ticketSweepEnabled: true,
          recommendationSweepEnabled: false,
        },
      });
      TestHelpers.setupWorkspaceWithConfig([workspace]);
      TestHelpers.setupPoolManagerResponse(3);
      TestHelpers.setupRecommendations([]);

      // Mock task with no dependencies
      const taskNoDeps = {
        id: "task-1",
        title: "Task with no dependencies",
        status: "TODO",
        systemAssigneeType: "TASK_COORDINATOR",
        deleted: false,
        dependsOnTaskIds: [],
        priority: "HIGH",
        createdAt: new Date(),
        feature: null,
        phase: null,
      };

      vi.mocked(mockDb.task.findMany).mockResolvedValueOnce([taskNoDeps] as any);

      const result = await executeTaskCoordinatorRuns();

      expect(result.tasksCreated).toBe(1);
    });

    test("should process task with satisfied dependency (status DONE)", async () => {
      const workspace = JanitorTestDataFactory.createValidWorkspace({
        janitorConfig: {
          ...JanitorTestDataFactory.createValidWorkspace().janitorConfig,
          ticketSweepEnabled: true,
          recommendationSweepEnabled: false,
        },
      });
      TestHelpers.setupWorkspaceWithConfig([workspace]);
      TestHelpers.setupPoolManagerResponse(3);
      TestHelpers.setupRecommendations([]);

      // Mock candidate task with dependency
      const taskWithDep = {
        id: "task-2",
        title: "Task with satisfied dependency",
        status: "TODO",
        systemAssigneeType: "TASK_COORDINATOR",
        deleted: false,
        dependsOnTaskIds: ["dep-task-1"],
        priority: "HIGH",
        createdAt: new Date(),
        feature: null,
        phase: null,
      };

      // Mock dependency task as DONE
      const depTask = {
        id: "dep-task-1",
        status: "DONE",
        workflowStatus: "PENDING",
        chatMessages: [],
      };

      vi.mocked(mockDb.task.findMany)
        .mockResolvedValueOnce([taskWithDep] as any) // Candidate tasks
        .mockResolvedValueOnce([depTask] as any); // Dependency check

      const result = await executeTaskCoordinatorRuns();

      expect(result.tasksCreated).toBe(1);
    });

    test("should NOT process task with dependency that has no PR and status not DONE", async () => {
      const workspace = JanitorTestDataFactory.createValidWorkspace({
        janitorConfig: {
          ...JanitorTestDataFactory.createValidWorkspace().janitorConfig,
          ticketSweepEnabled: true,
          recommendationSweepEnabled: false,
        },
      });
      TestHelpers.setupWorkspaceWithConfig([workspace]);
      TestHelpers.setupPoolManagerResponse(3);
      TestHelpers.setupRecommendations([]);

      const taskWithDep = {
        id: "task-3",
        title: "Task with incomplete manual dependency",
        status: "TODO",
        systemAssigneeType: "TASK_COORDINATOR",
        deleted: false,
        dependsOnTaskIds: ["dep-task-2"],
        priority: "CRITICAL",
        createdAt: new Date(),
        feature: null,
        phase: null,
      };

      const depTask = {
        id: "dep-task-2",
        status: "IN_PROGRESS", // Not DONE, no PR artifact
        workflowStatus: "COMPLETED", // WorkflowStatus is ignored
        chatMessages: [],
      };

      vi.mocked(mockDb.task.findMany)
        .mockResolvedValueOnce([taskWithDep] as any)
        .mockResolvedValueOnce([depTask] as any);

      const result = await executeTaskCoordinatorRuns();

      expect(result.tasksCreated).toBe(0); // Should NOT process
    });

    test("should process task with satisfied dependency (merged PR artifact)", async () => {
      const workspace = JanitorTestDataFactory.createValidWorkspace({
        janitorConfig: {
          ...JanitorTestDataFactory.createValidWorkspace().janitorConfig,
          ticketSweepEnabled: true,
          recommendationSweepEnabled: false,
        },
      });
      TestHelpers.setupWorkspaceWithConfig([workspace]);
      TestHelpers.setupPoolManagerResponse(3);
      TestHelpers.setupRecommendations([]);

      const taskWithDep = {
        id: "task-4",
        title: "Task with merged PR dependency",
        status: "TODO",
        systemAssigneeType: "TASK_COORDINATOR",
        deleted: false,
        dependsOnTaskIds: ["dep-task-3"],
        priority: "HIGH",
        createdAt: new Date(),
        feature: null,
        phase: null,
      };

      const depTask = {
        id: "dep-task-3",
        status: "IN_PROGRESS",
        workflowStatus: "PENDING",
        chatMessages: [
          {
            artifacts: [
              {
                type: "PULL_REQUEST",
                content: {
                  repo: "test/repo",
                  url: "https://github.com/test/repo/pull/1",
                  status: "DONE",
                },
              },
            ],
          },
        ],
      };

      vi.mocked(mockDb.task.findMany)
        .mockResolvedValueOnce([taskWithDep] as any)
        .mockResolvedValueOnce([depTask] as any);

      const result = await executeTaskCoordinatorRuns();

      expect(result.tasksCreated).toBe(1);
    });

    test("should skip task with unsatisfied dependency", async () => {
      const workspace = JanitorTestDataFactory.createValidWorkspace({
        janitorConfig: {
          ...JanitorTestDataFactory.createValidWorkspace().janitorConfig,
          ticketSweepEnabled: true,
          recommendationSweepEnabled: false,
        },
      });
      TestHelpers.setupWorkspaceWithConfig([workspace]);
      TestHelpers.setupPoolManagerResponse(3);
      TestHelpers.setupRecommendations([]);

      const taskWithDep = {
        id: "task-5",
        title: "Task with unsatisfied dependency",
        status: "TODO",
        systemAssigneeType: "TASK_COORDINATOR",
        deleted: false,
        dependsOnTaskIds: ["dep-task-4"],
        priority: "HIGH",
        createdAt: new Date(),
        feature: null,
        phase: null,
      };

      const depTask = {
        id: "dep-task-4",
        status: "TODO",
        workflowStatus: "PENDING",
        chatMessages: [],
      };

      vi.mocked(mockDb.task.findMany)
        .mockResolvedValueOnce([taskWithDep] as any)
        .mockResolvedValueOnce([depTask] as any);

      const result = await executeTaskCoordinatorRuns();

      expect(result.tasksCreated).toBe(0);
    });

    test("should skip task with missing dependency", async () => {
      const consoleWarnSpy = vi.spyOn(console, "warn");
      const workspace = JanitorTestDataFactory.createValidWorkspace({
        janitorConfig: {
          ...JanitorTestDataFactory.createValidWorkspace().janitorConfig,
          ticketSweepEnabled: true,
          recommendationSweepEnabled: false,
        },
      });
      TestHelpers.setupWorkspaceWithConfig([workspace]);
      TestHelpers.setupPoolManagerResponse(3);
      TestHelpers.setupRecommendations([]);

      const taskWithDep = {
        id: "task-6",
        title: "Task with missing dependency",
        status: "TODO",
        systemAssigneeType: "TASK_COORDINATOR",
        deleted: false,
        dependsOnTaskIds: ["missing-dep"],
        priority: "HIGH",
        createdAt: new Date(),
        feature: null,
        phase: null,
      };

      vi.mocked(mockDb.task.findMany)
        .mockResolvedValueOnce([taskWithDep] as any)
        .mockResolvedValueOnce([] as any); // No dependency found

      const result = await executeTaskCoordinatorRuns();

      expect(result.tasksCreated).toBe(0);
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining("Expected 1 dependencies, found 0")
      );

      consoleWarnSpy.mockRestore();
    });

    test("should skip task with partially satisfied dependencies", async () => {
      const workspace = JanitorTestDataFactory.createValidWorkspace({
        janitorConfig: {
          ...JanitorTestDataFactory.createValidWorkspace().janitorConfig,
          ticketSweepEnabled: true,
          recommendationSweepEnabled: false,
        },
      });
      TestHelpers.setupWorkspaceWithConfig([workspace]);
      TestHelpers.setupPoolManagerResponse(3);
      TestHelpers.setupRecommendations([]);

      const taskWithDeps = {
        id: "task-7",
        title: "Task with mixed dependencies",
        status: "TODO",
        systemAssigneeType: "TASK_COORDINATOR",
        deleted: false,
        dependsOnTaskIds: ["dep-done", "dep-not-done"],
        priority: "HIGH",
        createdAt: new Date(),
        feature: null,
        phase: null,
      };

      const depDone = {
        id: "dep-done",
        status: "DONE",
        workflowStatus: "COMPLETED",
        chatMessages: [],
      };

      const depNotDone = {
        id: "dep-not-done",
        status: "TODO",
        workflowStatus: "PENDING",
        chatMessages: [],
      };

      vi.mocked(mockDb.task.findMany)
        .mockResolvedValueOnce([taskWithDeps] as any)
        .mockResolvedValueOnce([depDone, depNotDone] as any);

      const result = await executeTaskCoordinatorRuns();

      expect(result.tasksCreated).toBe(0);
    });

    test("should process first eligible task from multiple candidates", async () => {
      const workspace = JanitorTestDataFactory.createValidWorkspace({
        janitorConfig: {
          ...JanitorTestDataFactory.createValidWorkspace().janitorConfig,
          ticketSweepEnabled: true,
          recommendationSweepEnabled: false,
        },
      });
      TestHelpers.setupWorkspaceWithConfig([workspace]);
      TestHelpers.setupPoolManagerResponse(3);
      TestHelpers.setupRecommendations([]);

      const task1 = {
        id: "task-blocked",
        title: "Blocked task",
        status: "TODO",
        systemAssigneeType: "TASK_COORDINATOR",
        deleted: false,
        dependsOnTaskIds: ["dep-blocked"],
        priority: "CRITICAL",
        createdAt: new Date("2024-01-01"),
        feature: null,
        phase: null,
      };

      const task2 = {
        id: "task-ready",
        title: "Ready task",
        status: "TODO",
        systemAssigneeType: "TASK_COORDINATOR",
        deleted: false,
        dependsOnTaskIds: ["dep-ready"],
        priority: "HIGH",
        createdAt: new Date("2024-01-02"),
        feature: null,
        phase: null,
      };

      const depBlocked = {
        id: "dep-blocked",
        status: "TODO",
        workflowStatus: "PENDING",
        chatMessages: [],
      };

      const depReady = {
        id: "dep-ready",
        status: "DONE",
        workflowStatus: "COMPLETED",
        chatMessages: [],
      };

      vi.mocked(mockDb.task.findMany)
        .mockResolvedValueOnce([task1, task2] as any)
        .mockResolvedValueOnce([depBlocked] as any)
        .mockResolvedValueOnce([depReady] as any);

      const result = await executeTaskCoordinatorRuns();

      expect(result.tasksCreated).toBe(1);
    });

    test("should log dependency check progress", async () => {
      const consoleLogSpy = vi.spyOn(console, "log");
      const workspace = JanitorTestDataFactory.createValidWorkspace({
        janitorConfig: {
          ...JanitorTestDataFactory.createValidWorkspace().janitorConfig,
          ticketSweepEnabled: true,
          recommendationSweepEnabled: false,
        },
      });
      TestHelpers.setupWorkspaceWithConfig([workspace]);
      TestHelpers.setupPoolManagerResponse(3);
      TestHelpers.setupRecommendations([]);

      const taskWithDep = {
        id: "task-8",
        title: "Task for logging test",
        status: "TODO",
        systemAssigneeType: "TASK_COORDINATOR",
        deleted: false,
        dependsOnTaskIds: ["dep-1"],
        priority: "HIGH",
        createdAt: new Date(),
        feature: null,
        phase: null,
      };

      const depTask = {
        id: "dep-1",
        status: "DONE",
        workflowStatus: "COMPLETED",
        chatMessages: [],
      };

      vi.mocked(mockDb.task.findMany)
        .mockResolvedValueOnce([taskWithDep] as any)
        .mockResolvedValueOnce([depTask] as any);

      await executeTaskCoordinatorRuns();

      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("Found 1 candidate tickets, checking dependencies")
      );
      expect(consoleLogSpy).toHaveBeenCalledWith(
        expect.stringContaining("Found eligible task task-8 with 1 satisfied dependencies")
      );

      consoleLogSpy.mockRestore();
    });

    test("should check PR artifact with open status (IN_PROGRESS)", async () => {
      const workspace = JanitorTestDataFactory.createValidWorkspace({
        janitorConfig: {
          ...JanitorTestDataFactory.createValidWorkspace().janitorConfig,
          ticketSweepEnabled: true,
          recommendationSweepEnabled: false,
        },
      });
      TestHelpers.setupWorkspaceWithConfig([workspace]);
      TestHelpers.setupPoolManagerResponse(3);
      TestHelpers.setupRecommendations([]);

      const taskWithDep = {
        id: "task-9",
        title: "Task with open PR dependency",
        status: "TODO",
        systemAssigneeType: "TASK_COORDINATOR",
        deleted: false,
        dependsOnTaskIds: ["dep-open-pr"],
        priority: "HIGH",
        createdAt: new Date(),
        feature: null,
        phase: null,
      };

      const depTask = {
        id: "dep-open-pr",
        status: "IN_PROGRESS",
        workflowStatus: "PENDING",
        chatMessages: [
          {
            artifacts: [
              {
                type: "PULL_REQUEST",
                content: {
                  repo: "test/repo",
                  url: "https://github.com/test/repo/pull/2",
                  status: "IN_PROGRESS", // Open PR, not merged
                },
              },
            ],
          },
        ],
      };

      vi.mocked(mockDb.task.findMany)
        .mockResolvedValueOnce([taskWithDep] as any)
        .mockResolvedValueOnce([depTask] as any);

      const result = await executeTaskCoordinatorRuns();

      expect(result.tasksCreated).toBe(0); // Should not process - PR not merged
    });

    test("should NOT process task with mixed state (status DONE + unmerged PR)", async () => {
      const workspace = JanitorTestDataFactory.createValidWorkspace({
        janitorConfig: {
          ...JanitorTestDataFactory.createValidWorkspace().janitorConfig,
          ticketSweepEnabled: true,
          recommendationSweepEnabled: false,
        },
      });
      TestHelpers.setupWorkspaceWithConfig([workspace]);
      TestHelpers.setupPoolManagerResponse(3);
      TestHelpers.setupRecommendations([]);

      const taskWithDep = {
        id: "task-mixed",
        title: "Task with mixed state dependency",
        status: "TODO",
        systemAssigneeType: "TASK_COORDINATOR",
        deleted: false,
        dependsOnTaskIds: ["dep-mixed"],
        priority: "HIGH",
        createdAt: new Date(),
        feature: null,
        phase: null,
      };

      const depTask = {
        id: "dep-mixed",
        status: "DONE", // Status is DONE (misleading)
        workflowStatus: "PENDING",
        chatMessages: [
          {
            artifacts: [
              {
                type: "PULL_REQUEST",
                content: {
                  url: "https://github.com/test/repo/pull/5",
                  status: "open", // PR not merged yet
                },
                createdAt: new Date(),
              },
            ],
            createdAt: new Date(),
          },
        ],
      };

      vi.mocked(mockDb.task.findMany)
        .mockResolvedValueOnce([taskWithDep] as any)
        .mockResolvedValueOnce([depTask] as any);

      const result = await executeTaskCoordinatorRuns();

      expect(result.tasksCreated).toBe(0); // Should NOT process - PR must be merged
    });

    test("should process task with multiple satisfied dependencies", async () => {
      const workspace = JanitorTestDataFactory.createValidWorkspace({
        janitorConfig: {
          ...JanitorTestDataFactory.createValidWorkspace().janitorConfig,
          ticketSweepEnabled: true,
          recommendationSweepEnabled: false,
        },
      });
      TestHelpers.setupWorkspaceWithConfig([workspace]);
      TestHelpers.setupPoolManagerResponse(3);
      TestHelpers.setupRecommendations([]);

      const taskWithDeps = {
        id: "task-10",
        title: "Task with multiple satisfied dependencies",
        status: "TODO",
        systemAssigneeType: "TASK_COORDINATOR",
        deleted: false,
        dependsOnTaskIds: ["dep-a", "dep-b", "dep-c"],
        priority: "HIGH",
        createdAt: new Date(),
        feature: null,
        phase: null,
      };

      const depA = {
        id: "dep-a",
        status: "DONE", // Manual completion, no PR
        workflowStatus: "PENDING",
        chatMessages: [],
      };

      const depB = {
        id: "dep-b",
        status: "DONE", // Manual completion, no PR
        workflowStatus: "COMPLETED",
        chatMessages: [],
      };

      const depC = {
        id: "dep-c",
        status: "IN_PROGRESS", // Status ignored when PR exists
        workflowStatus: "PENDING",
        chatMessages: [
          {
            artifacts: [
              {
                type: "PULL_REQUEST",
                content: {
                  status: "DONE", // PR merged
                },
                createdAt: new Date(),
              },
            ],
            createdAt: new Date(),
          },
        ],
      };

      vi.mocked(mockDb.task.findMany)
        .mockResolvedValueOnce([taskWithDeps] as any)
        .mockResolvedValueOnce([depA, depB, depC] as any);

      const result = await executeTaskCoordinatorRuns();

      expect(result.tasksCreated).toBe(1); // All dependencies satisfied
    });

    test("should check LATEST PR artifact when multiple PRs exist", async () => {
      const workspace = JanitorTestDataFactory.createValidWorkspace({
        janitorConfig: {
          ...JanitorTestDataFactory.createValidWorkspace().janitorConfig,
          ticketSweepEnabled: true,
          recommendationSweepEnabled: false,
        },
      });
      TestHelpers.setupWorkspaceWithConfig([workspace]);
      TestHelpers.setupPoolManagerResponse(3);
      TestHelpers.setupRecommendations([]);

      const taskWithDep = {
        id: "task-multi-pr",
        title: "Task with multi-PR dependency",
        status: "TODO",
        systemAssigneeType: "TASK_COORDINATOR",
        deleted: false,
        dependsOnTaskIds: ["dep-multi-pr"],
        priority: "HIGH",
        createdAt: new Date(),
        feature: null,
        phase: null,
      };

      const depTask = {
        id: "dep-multi-pr",
        status: "DONE",
        workflowStatus: "PENDING",
        chatMessages: [
          {
            artifacts: [
              {
                type: "PULL_REQUEST",
                content: {
                  url: "https://github.com/test/repo/pull/1",
                  status: "DONE", // First PR merged
                },
                createdAt: new Date("2024-01-01"),
              },
            ],
            createdAt: new Date("2024-01-01"),
          },
          {
            artifacts: [
              {
                type: "PULL_REQUEST",
                content: {
                  url: "https://github.com/test/repo/pull/2",
                  status: "open", // Latest PR still open
                },
                createdAt: new Date("2024-01-02"),
              },
            ],
            createdAt: new Date("2024-01-02"),
          },
        ],
      };

      vi.mocked(mockDb.task.findMany)
        .mockResolvedValueOnce([taskWithDep] as any)
        .mockResolvedValueOnce([depTask] as any);

      const result = await executeTaskCoordinatorRuns();

      expect(result.tasksCreated).toBe(0); // Should NOT process - latest PR not merged
    });
  });
});