import { Priority, RecommendationStatus } from "@prisma/client";

/**
 * Test data factories for Janitor-related entities
 * Used for testing janitor runs, recommendations, and task coordinator
 */
export const JanitorTestDataFactory = {
  createValidWorkspace: (overrides = {}) => ({
    id: "workspace-1",
    slug: "test-workspace",
    name: "Test Workspace",
    janitorConfig: {
      id: "config-1",
      taskCoordinatorEnabled: true,
      recommendationSweepEnabled: true,
      ticketSweepEnabled: true,
      unitTestsEnabled: false,
      integrationTestsEnabled: false,
      e2eTestsEnabled: false,
      securityReviewEnabled: false,
      mockGenerationEnabled: false,
      workspaceId: "workspace-1",
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    swarm: {
      id: "swarm-1",
      poolApiKey: "test-pool-api-key",
      poolName: "test-pool",
      name: "test-swarm",
      swarmUrl: "https://test-swarm.com/api",
      swarmSecretAlias: "{{TEST_SECRET}}",
    },
    owner: {
      id: "owner-1",
      name: "Test Owner",
      email: "owner@example.com",
    },
    ...overrides,
  }),

  createWorkspaceWithoutSwarm: () => ({
    id: "workspace-2",
    slug: "no-swarm-workspace",
    name: "No Swarm Workspace",
    janitorConfig: {
      id: "config-2",
      taskCoordinatorEnabled: true,
      recommendationSweepEnabled: true,
      ticketSweepEnabled: true,
      unitTestsEnabled: false,
      integrationTestsEnabled: false,
      e2eTestsEnabled: false,
      securityReviewEnabled: false,
      mockGenerationEnabled: false,
      workspaceId: "workspace-2",
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    swarm: null,
    owner: {
      id: "owner-2",
      name: "Test Owner 2",
      email: "owner2@example.com",
    },
  }),

  createWorkspaceWithoutPoolApiKey: () => ({
    id: "workspace-3",
    slug: "no-pool-key-workspace",
    name: "No Pool Key Workspace",
    janitorConfig: {
      id: "config-3",
      taskCoordinatorEnabled: true,
      recommendationSweepEnabled: true,
      ticketSweepEnabled: true,
      unitTestsEnabled: false,
      integrationTestsEnabled: false,
      e2eTestsEnabled: false,
      securityReviewEnabled: false,
      mockGenerationEnabled: false,
      workspaceId: "workspace-3",
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    swarm: {
      id: "swarm-3",
      poolApiKey: null,
      poolName: "test-pool",
      name: "test-swarm",
      swarmUrl: "https://test-swarm.com/api",
      swarmSecretAlias: "{{TEST_SECRET}}",
    },
    owner: {
      id: "owner-3",
      name: "Test Owner 3",
      email: "owner3@example.com",
    },
  }),

  createPendingRecommendation: (priority: Priority = "MEDIUM", overrides = {}) => ({
    id: `recommendation-${priority}`,
    janitorRunId: "run-1",
    title: `Test Recommendation - ${priority}`,
    description: `Test Description - ${priority}`,
    priority,
    impact: "Improves code quality",
    status: "PENDING" as RecommendationStatus,
    acceptedAt: null,
    dismissedAt: null,
    acceptedById: null,
    dismissedById: null,
    metadata: {},
    createdAt: new Date(),
    updatedAt: new Date(),
    janitorRun: {
      id: "run-1",
      janitorConfigId: "config-1",
      janitorType: "UNIT_TESTS",
      status: "COMPLETED",
      janitorConfig: {
        id: "config-1",
        workspaceId: "workspace-1",
        workspace: {
          id: "workspace-1",
          slug: "test-workspace",
          name: "Test Workspace",
        },
      },
    },
    ...overrides,
  }),

  createPoolStatusResponse: (unusedVms: number) => ({
    status: {
      runningVms: 2,
      pendingVms: 0,
      failedVms: 0,
      usedVms: 2 - unusedVms,
      unusedVms,
      lastCheck: new Date().toISOString(),
    },
  }),

  createAcceptRecommendationResult: () => ({
    recommendation: {
      id: "recommendation-1",
      status: "ACCEPTED" as RecommendationStatus,
      acceptedAt: new Date(),
      acceptedById: "owner-1",
    },
    task: {
      id: "task-1",
      title: "Test Task",
      description: "Test Description",
      sourceType: "TASK_COORDINATOR",
      workspaceId: "workspace-1",
    },
    workflow: {
      success: true,
      data: { project_id: 123 },
    },
  }),
};
