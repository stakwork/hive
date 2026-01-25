import { vi } from "vitest";
import type { JanitorType, JanitorStatus, JanitorTrigger, RecommendationStatus, Priority } from "@prisma/client";

export const TEST_DATE = new Date("2024-01-01T00:00:00.000Z");
export const TEST_DATE_ISO = "2024-01-01T00:00:00.000Z";

export interface MockJanitorConfigOptions {
  id?: string;
  workspaceId?: string;
  unitTestsEnabled?: boolean;
  integrationTestsEnabled?: boolean;
  e2eTestsEnabled?: boolean;
  securityReviewEnabled?: boolean;
  mockGenerationEnabled?: boolean;
  taskCoordinatorEnabled?: boolean;
  // PR Monitor settings
  prMonitorEnabled?: boolean;
  prConflictFixEnabled?: boolean;
  prCiFailureFixEnabled?: boolean;
  prOutOfDateFixEnabled?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface MockJanitorRunOptions {
  id?: string;
  janitorConfigId?: string;
  janitorType?: JanitorType;
  status?: JanitorStatus;
  triggeredBy?: JanitorTrigger;
  stakworkProjectId?: number | null;
  startedAt?: Date | null;
  completedAt?: Date | null;
  error?: string | null;
  metadata?: any;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface MockJanitorRecommendationOptions {
  id?: string;
  janitorRunId?: string;
  title?: string;
  description?: string;
  priority?: Priority;
  impact?: string | null;
  status?: RecommendationStatus;
  acceptedAt?: Date | null;
  dismissedAt?: Date | null;
  acceptedById?: string | null;
  dismissedById?: string | null;
  metadata?: any;
  createdAt?: Date;
  updatedAt?: Date;
}

export const janitorMocks = {
  createMockConfig(overrides: MockJanitorConfigOptions = {}) {
    return {
      id: overrides.id || "config-1",
      workspaceId: overrides.workspaceId || "ws-1",
      unitTestsEnabled: overrides.unitTestsEnabled ?? true,
      integrationTestsEnabled: overrides.integrationTestsEnabled ?? false,
      e2eTestsEnabled: overrides.e2eTestsEnabled ?? false,
      securityReviewEnabled: overrides.securityReviewEnabled ?? false,
      mockGenerationEnabled: overrides.mockGenerationEnabled ?? false,
      taskCoordinatorEnabled: overrides.taskCoordinatorEnabled ?? false,
      // PR Monitor settings
      prMonitorEnabled: overrides.prMonitorEnabled ?? false,
      prConflictFixEnabled: overrides.prConflictFixEnabled ?? false,
      prCiFailureFixEnabled: overrides.prCiFailureFixEnabled ?? false,
      prOutOfDateFixEnabled: overrides.prOutOfDateFixEnabled ?? false,
      createdAt: overrides.createdAt || TEST_DATE,
      updatedAt: overrides.updatedAt || TEST_DATE,
    };
  },

  createMockRun(overrides: MockJanitorRunOptions = {}) {
    return {
      id: overrides.id || "run-1",
      janitorConfigId: overrides.janitorConfigId || "config-1",
      janitorType: overrides.janitorType || ("UNIT_TESTS" as JanitorType),
      status: overrides.status || ("PENDING" as JanitorStatus),
      triggeredBy: overrides.triggeredBy || ("MANUAL" as JanitorTrigger),
      stakworkProjectId: overrides.stakworkProjectId === undefined ? null : overrides.stakworkProjectId,
      startedAt: overrides.startedAt === undefined ? null : overrides.startedAt,
      completedAt: overrides.completedAt === undefined ? null : overrides.completedAt,
      error: overrides.error === undefined ? null : overrides.error,
      metadata: overrides.metadata || {},
      createdAt: overrides.createdAt || TEST_DATE,
      updatedAt: overrides.updatedAt || TEST_DATE,
    };
  },

  createMockRecommendation(overrides: MockJanitorRecommendationOptions = {}) {
    return {
      id: overrides.id || "rec-1",
      janitorRunId: overrides.janitorRunId || "run-1",
      title: overrides.title || "Add unit tests for authentication",
      description: overrides.description || "Authentication logic lacks unit test coverage",
      priority: overrides.priority || ("MEDIUM" as Priority),
      impact: overrides.impact === undefined ? "Improves code reliability" : overrides.impact,
      status: overrides.status || ("PENDING" as RecommendationStatus),
      acceptedAt: overrides.acceptedAt === undefined ? null : overrides.acceptedAt,
      dismissedAt: overrides.dismissedAt === undefined ? null : overrides.dismissedAt,
      acceptedById: overrides.acceptedById === undefined ? null : overrides.acceptedById,
      dismissedById: overrides.dismissedById === undefined ? null : overrides.dismissedById,
      metadata: overrides.metadata || {},
      createdAt: overrides.createdAt || TEST_DATE,
      updatedAt: overrides.updatedAt || TEST_DATE,
    };
  },

  createMockRunWithConfig(runOverrides: MockJanitorRunOptions = {}, configOverrides: MockJanitorConfigOptions = {}) {
    const config = this.createMockConfig(configOverrides);
    const run = this.createMockRun({ janitorConfigId: config.id, ...runOverrides });

    return {
      ...run,
      janitorConfig: {
        ...config,
        workspace: {
          id: config.workspaceId,
          name: "Test Workspace",
          slug: "test-workspace",
          ownerId: "owner-1",
          swarm: {
            id: "swarm-1",
            swarmUrl: "https://test.sphinx.chat/api",
            swarmSecretAlias: "TRZdJtusiYayzcmqFzWknS3t7aO1W8cs",
            poolName: "test-pool",
            name: "test-swarm",
          },
          repositories: [
            {
              id: "repo-1",
              repositoryUrl: "https://github.com/test/repo",
              branch: "main",
              ignoreDirs: "node_modules,dist",
            },
          ],
        },
      },
    };
  },

  createMockRecommendationWithRun(
    recOverrides: MockJanitorRecommendationOptions = {},
    runOverrides: MockJanitorRunOptions = {},
  ) {
    const run = this.createMockRun(runOverrides);
    const recommendation = this.createMockRecommendation({ janitorRunId: run.id, ...recOverrides });

    return {
      ...recommendation,
      janitorRun: {
        id: run.id,
        janitorType: run.janitorType,
        status: run.status,
        createdAt: run.createdAt,
      },
    };
  },

  serializeDates<T extends { createdAt: Date | string; updatedAt: Date | string }>(obj: T) {
    return {
      ...obj,
      createdAt: typeof obj.createdAt === "string" ? obj.createdAt : obj.createdAt.toISOString(),
      updatedAt: typeof obj.updatedAt === "string" ? obj.updatedAt : obj.updatedAt.toISOString(),
    };
  },
};

export const janitorMockSetup = {
  mockConfigNotFound(db: any) {
    vi.mocked(db.janitorConfig.findUnique).mockResolvedValue(null);
  },

  mockConfigExists(db: any, config: any) {
    vi.mocked(db.janitorConfig.findUnique).mockResolvedValue(config);
  },

  mockConfigCreate(db: any, config: any) {
    vi.mocked(db.janitorConfig.findUnique).mockResolvedValue(null);
    vi.mocked(db.janitorConfig.create).mockResolvedValue(config);
  },

  mockConfigUpdate(db: any, updatedConfig: any) {
    vi.mocked(db.janitorConfig.update).mockResolvedValue(updatedConfig);
  },

  mockRunCreate(db: any, run: any) {
    vi.mocked(db.janitorRun.create).mockResolvedValue(run);
  },

  mockRunNotFound(db: any) {
    vi.mocked(db.janitorRun.findFirst).mockResolvedValue(null);
  },

  mockRunInProgress(db: any, existingRun: any) {
    vi.mocked(db.janitorRun.findFirst).mockResolvedValue(existingRun);
  },

  mockRunFindMany(db: any, runs: any[], total: number) {
    vi.mocked(db.janitorRun.findMany).mockResolvedValue(runs);
    vi.mocked(db.janitorRun.count).mockResolvedValue(total);
  },

  mockRecommendationFindMany(db: any, recommendations: any[], total: number) {
    vi.mocked(db.janitorRecommendation.findMany).mockResolvedValue(recommendations);
    vi.mocked(db.janitorRecommendation.count).mockResolvedValue(total);
  },

  mockRecommendationNotFound(db: any) {
    vi.mocked(db.janitorRecommendation.findUnique).mockResolvedValue(null);
  },

  mockRecommendationExists(db: any, recommendation: any) {
    // Extract workspace from janitorRun if it exists and add as top-level field
    // to match the new schema where recommendations have direct workspace relationship
    const enrichedRecommendation = {
      ...recommendation,
      workspace: recommendation.janitorRun?.janitorConfig?.workspace || recommendation.workspace,
      workspaceId: recommendation.workspaceId || recommendation.janitorRun?.janitorConfig?.workspace?.id || "ws-1",
    };
    vi.mocked(db.janitorRecommendation.findUnique).mockResolvedValue(enrichedRecommendation);
  },

  mockRecommendationUpdate(db: any, updatedRecommendation: any) {
    vi.mocked(db.janitorRecommendation.update).mockResolvedValue(updatedRecommendation);
  },

  mockWorkspaceMemberExists(db: any, exists: boolean) {
    vi.mocked(db.workspaceMember.findFirst).mockResolvedValue(
      exists ? { id: "member-1", userId: "user-1", workspaceId: "ws-1", role: "DEVELOPER" } : null,
    );
  },

  mockRepositoryExists(db: any, exists: boolean) {
    vi.mocked(db.repository.findFirst).mockResolvedValue(
      exists
        ? { id: "repo-1", name: "test-repo", repositoryUrl: "https://github.com/test/repo", workspaceId: "ws-1" }
        : null,
    );
  },

  mockWebhookProcessing(db: any, updateResult: any, janitorRun: any) {
    vi.mocked(db.janitorRun.updateMany).mockResolvedValue(updateResult);
    vi.mocked(db.janitorRun.findFirst).mockResolvedValue(janitorRun);
  },

  mockTransactionSuccess(db: any, updateFn: any, createManyFn: any) {
    vi.mocked(db.$transaction).mockImplementation(async (callback: any) => {
      return callback({
        janitorRun: {
          update: updateFn,
        },
        janitorRecommendation: {
          createMany: createManyFn,
        },
      });
    });
  },
};
