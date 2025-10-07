/**
 * Janitor test fixtures
 * Utilities for creating test janitor configurations, runs, and recommendations
 */

import { db } from "@/lib/db";
import { JanitorStatus, JanitorTrigger, JanitorType, Priority, RecommendationStatus } from "@prisma/client";

export interface CreateTestJanitorConfigOptions {
  workspaceId: string;
  unitTestsEnabled?: boolean;
  integrationTestsEnabled?: boolean;
  e2eTestsEnabled?: boolean;
  securityReviewEnabled?: boolean;
  taskCoordinatorEnabled?: boolean;
}

export interface CreateTestJanitorRunOptions {
  janitorConfigId?: string;
  janitorType?: JanitorType;
  status?: JanitorStatus;
  triggeredBy?: JanitorTrigger;
  stakworkProjectId?: number | null;
  startedAt?: Date | null;
  completedAt?: Date | null;
  error?: string | null;
  metadata?: any;
  workspaceId?: string; // For convenience when janitorConfigId is not provided
}

export interface CreateTestJanitorRecommendationOptions {
  janitorRunId: string;
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
}

export async function createTestJanitorConfig(options: CreateTestJanitorConfigOptions) {
  return db.janitorConfig.create({
    data: {
      workspaceId: options.workspaceId,
      unitTestsEnabled: options.unitTestsEnabled ?? true,
      integrationTestsEnabled: options.integrationTestsEnabled ?? false,
      e2eTestsEnabled: options.e2eTestsEnabled ?? false,
      securityReviewEnabled: options.securityReviewEnabled ?? false,
      taskCoordinatorEnabled: options.taskCoordinatorEnabled ?? false,
    },
  });
}

export async function createTestJanitorRun(options: CreateTestJanitorRunOptions) {
  let janitorConfigId = options.janitorConfigId;

  // Create a janitor config if not provided but workspaceId is given
  if (!janitorConfigId && options.workspaceId) {
    const config = await createTestJanitorConfig({
      workspaceId: options.workspaceId,
    });
    janitorConfigId = config.id;
  }

  if (!janitorConfigId) {
    throw new Error("Either janitorConfigId or workspaceId must be provided");
  }

  return db.janitorRun.create({
    data: {
      janitorConfigId,
      janitorType: options.janitorType ?? "UNIT_TESTS",
      status: options.status ?? "COMPLETED",
      triggeredBy: options.triggeredBy ?? "MANUAL",
      stakworkProjectId: options.stakworkProjectId ?? null,
      startedAt: options.startedAt ?? new Date(),
      completedAt: options.completedAt ?? new Date(),
      error: options.error ?? null,
      metadata: options.metadata ?? {},
    },
  });
}

export async function createTestJanitorRecommendation(options: CreateTestJanitorRecommendationOptions) {
  return db.janitorRecommendation.create({
    data: {
      janitorRunId: options.janitorRunId,
      title: options.title ?? "Add unit tests for authentication module",
      description: options.description ?? "The authentication module lacks comprehensive unit test coverage. Adding tests will improve code reliability and catch potential security issues.",
      priority: options.priority ?? "MEDIUM",
      impact: options.impact ?? "Improves code reliability and maintainability",
      status: options.status ?? "PENDING",
      acceptedAt: options.acceptedAt ?? null,
      dismissedAt: options.dismissedAt ?? null,
      acceptedById: options.acceptedById ?? null,
      dismissedById: options.dismissedById ?? null,
      metadata: options.metadata ?? {},
    },
  });
}

export async function createTestJanitorScenario(workspaceId: string, recommendationCount: number = 1) {
  // Create janitor config
  const config = await createTestJanitorConfig({
    workspaceId,
    unitTestsEnabled: true,
    integrationTestsEnabled: true,
  });

  // Create janitor run
  const run = await createTestJanitorRun({
    janitorConfigId: config.id,
    janitorType: "UNIT_TESTS",
    status: "COMPLETED",
  });

  // Create recommendations
  const recommendations = [];
  for (let i = 0; i < recommendationCount; i++) {
    const recommendation = await createTestJanitorRecommendation({
      janitorRunId: run.id,
      title: `Test Recommendation ${i + 1}`,
      description: `This is test recommendation number ${i + 1} for E2E testing.`,
      priority: i === 0 ? "HIGH" : "MEDIUM",
      impact: `Impact description for recommendation ${i + 1}`,
    });
    recommendations.push(recommendation);
  }

  return {
    config,
    run,
    recommendations,
  };
}
