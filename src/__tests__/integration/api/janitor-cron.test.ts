import { describe, test, expect, beforeEach, vi } from "vitest";
import { db } from "@/lib/db";
import { executeScheduledJanitorRuns } from "@/services/janitor-cron";
import { JanitorType, RecommendationStatus, Priority, JanitorStatus } from "@prisma/client";

// Mock the createJanitorRun function to avoid authentication issues in test environment
vi.mock("@/services/janitor", () => ({
  createJanitorRun: vi.fn(async (workspaceSlug, userId, janitorType, triggeredBy) => {
    // Find the workspace
    const workspace = await db.workspace.findUnique({
      where: { slug: workspaceSlug },
      include: { janitorConfig: true }
    });
    
    if (!workspace || !workspace.janitorConfig) {
      throw new Error("Workspace or config not found");
    }
    
    // Create the run directly
    return await db.janitorRun.create({
      data: {
        janitorConfigId: workspace.janitorConfig.id,
        janitorType: janitorType.toUpperCase() as JanitorType,
        status: JanitorStatus.PENDING,
        triggeredBy,
      }
    });
  })
}));

describe("Janitor Cron Safety Mechanism", () => {
  async function createTestWorkspaceWithJanitor() {
    return await db.$transaction(async (tx) => {
      // Create test user
      const user = await tx.user.create({
        data: {
          id: `test-user-${Date.now()}-${Math.random()}`,
          email: `test-${Date.now()}@example.com`,
          name: "Test User",
        },
      });

      // Create test workspace
      const workspace = await tx.workspace.create({
        data: {
          id: `test-workspace-${Date.now()}-${Math.random()}`,
          name: `Test Workspace ${Date.now()}`,
          slug: `test-workspace-${Date.now()}-${Math.random().toString(36).substring(7)}`,
          ownerId: user.id,
        },
      });

      // Create janitor config with unit tests enabled
      const janitorConfig = await tx.janitorConfig.create({
        data: {
          workspaceId: workspace.id,
          unitTestsEnabled: true,
          integrationTestsEnabled: false,
          e2eTestsEnabled: false,
        },
      });

      return { user, workspace, janitorConfig };
    });
  }

  async function createPendingRecommendations(
    janitorConfigId: string,
    count: number,
    status: RecommendationStatus = RecommendationStatus.PENDING,
    userId?: string
  ) {
    // Create a completed run first
    const completedRun = await db.janitorRun.create({
      data: {
        janitorConfigId,
        janitorType: JanitorType.UNIT_TESTS,
        status: JanitorStatus.COMPLETED,
        triggeredBy: "MANUAL",
      },
    });

    // Create recommendations
    const recommendations = [];
    for (let i = 0; i < count; i++) {
      const recommendation = await db.janitorRecommendation.create({
        data: {
          janitorRunId: completedRun.id,
          title: `${status} Recommendation ${i + 1}`,
          description: `Description for ${status.toLowerCase()} recommendation ${i + 1}`,
          priority: Priority.MEDIUM,
          status,
          ...(status === RecommendationStatus.ACCEPTED && userId && {
            acceptedAt: new Date(),
            acceptedById: userId,
          }),
          ...(status === RecommendationStatus.DISMISSED && userId && {
            dismissedAt: new Date(),
            dismissedById: userId,
          }),
        },
      });
      recommendations.push(recommendation);
    }

    return { run: completedRun, recommendations };
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("should skip creating new runs when 5+ pending recommendations exist", async () => {
    const { janitorConfig } = await createTestWorkspaceWithJanitor();
    
    // Create 5 pending recommendations
    await createPendingRecommendations(janitorConfig.id, 5, RecommendationStatus.PENDING);

    // Execute cron job
    const result = await executeScheduledJanitorRuns();

    // Verify no new runs were created (skipped due to pending recommendations)
    expect(result.runsCreated).toBe(0);
    expect(result.runsSkipped).toBe(1);
    expect(result.workspacesProcessed).toBe(1);
    expect(result.success).toBe(true);

    // Verify no new runs in database
    const runsCount = await db.janitorRun.count({
      where: { janitorConfigId: janitorConfig.id },
    });
    expect(runsCount).toBe(1); // Only the initial run from createPendingRecommendations
  });

  test("should create new runs when less than 5 pending recommendations exist", async () => {
    const { janitorConfig } = await createTestWorkspaceWithJanitor();
    
    // Create 3 pending recommendations
    await createPendingRecommendations(janitorConfig.id, 3, RecommendationStatus.PENDING);

    // Execute cron job
    const result = await executeScheduledJanitorRuns();

    // Verify a new run was created
    expect(result.runsCreated).toBe(1);
    expect(result.runsSkipped).toBe(0);
    expect(result.workspacesProcessed).toBe(1);
    expect(result.success).toBe(true);

    // Verify the run was actually created in the database
    const runs = await db.janitorRun.findMany({
      where: { janitorConfigId: janitorConfig.id },
    });
    expect(runs.length).toBe(2); // Original + new one
    expect(runs.some(r => r.triggeredBy === "SCHEDULED")).toBe(true);
  });

  test("should count only PENDING recommendations, not ACCEPTED or DISMISSED", async () => {
    const { janitorConfig, user } = await createTestWorkspaceWithJanitor();
    
    // Create mixed recommendation statuses
    await createPendingRecommendations(janitorConfig.id, 3, RecommendationStatus.PENDING);
    await createPendingRecommendations(janitorConfig.id, 2, RecommendationStatus.ACCEPTED, user.id);
    await createPendingRecommendations(janitorConfig.id, 2, RecommendationStatus.DISMISSED, user.id);

    // Execute cron job
    const result = await executeScheduledJanitorRuns();

    // Should create a new run since only 3 recommendations are pending (< 5)
    expect(result.runsCreated).toBe(1);
    expect(result.runsSkipped).toBe(0);
    expect(result.success).toBe(true);

    // Verify correct count of recommendations
    const pendingCount = await db.janitorRecommendation.count({
      where: {
        janitorRun: {
          janitorConfigId: janitorConfig.id,
          janitorType: JanitorType.UNIT_TESTS,
        },
        status: RecommendationStatus.PENDING,
      },
    });
    expect(pendingCount).toBe(3);
  });

  test("should handle multiple workspaces independently", async () => {
    // Create two workspaces with different pending recommendation counts
    const workspace1 = await createTestWorkspaceWithJanitor();
    const workspace2 = await createTestWorkspaceWithJanitor();
    
    // Workspace 1: 6 pending (should skip)
    await createPendingRecommendations(workspace1.janitorConfig.id, 6, RecommendationStatus.PENDING);
    
    // Workspace 2: 2 pending (should create)
    await createPendingRecommendations(workspace2.janitorConfig.id, 2, RecommendationStatus.PENDING);

    // Execute cron job
    const result = await executeScheduledJanitorRuns();

    // Should process both workspaces but only create run for workspace2
    expect(result.workspacesProcessed).toBe(2);
    expect(result.runsCreated).toBe(1);
    expect(result.runsSkipped).toBe(1);
    expect(result.success).toBe(true);
  });

  test("should handle workspace with no prior runs", async () => {
    const { janitorConfig } = await createTestWorkspaceWithJanitor();
    
    // Execute cron job without any prior runs
    const result = await executeScheduledJanitorRuns();

    // Should create a new run since there are no pending recommendations
    expect(result.runsCreated).toBe(1);
    expect(result.runsSkipped).toBe(0);
    expect(result.workspacesProcessed).toBe(1);
    expect(result.success).toBe(true);

    // Verify run was created
    const runs = await db.janitorRun.findMany({
      where: { janitorConfigId: janitorConfig.id },
    });
    expect(runs.length).toBe(1);
    expect(runs[0].triggeredBy).toBe("SCHEDULED");
  });
});