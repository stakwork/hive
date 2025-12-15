/**
 * Factory functions for Janitor-related DB entities
 */
import { db } from "@/lib/db";

/**
 * Factory for creating test screenshots with sensible defaults
 */
export async function createScreenshot(
  workspaceId: string,
  overrides: Partial<{
    taskId: string
    s3Key: string
    s3Url: string
    urlExpiresAt: Date
    hash: string
    pageUrl: string
    timestamp: bigint
    actionIndex: number
    width: number
    height: number
    createdAt: Date
  }> = {}
) {
  const defaults = {
    s3Key: `test-key-${Date.now()}`,
    s3Url: 'https://example.com/test.jpg',
    urlExpiresAt: new Date(Date.now() + 86400000), // 1 day from now
    hash: `test-hash-${Date.now()}`,
    pageUrl: 'https://example.com',
    timestamp: BigInt(Date.now()),
    actionIndex: 0,
  }

  return db.screenshot.create({
    data: {
      workspaceId,
      ...defaults,
      ...overrides,
    },
  })
}

/**
 * Factory for creating test janitor config with sensible defaults
 */
export async function createJanitorConfig(
  workspaceId: string,
  overrides: Partial<{
    taskCoordinatorEnabled: boolean
    recommendationSweepEnabled: boolean
    ticketSweepEnabled: boolean
    unitTestsEnabled: boolean
    integrationTestsEnabled: boolean
    e2eTestsEnabled: boolean
    securityReviewEnabled: boolean
    mockGenerationEnabled: boolean
  }> = {}
) {
  const defaults = {
    taskCoordinatorEnabled: false,
    recommendationSweepEnabled: false,
    ticketSweepEnabled: false,
    unitTestsEnabled: true,
    integrationTestsEnabled: false,
    e2eTestsEnabled: false,
    securityReviewEnabled: false,
    mockGenerationEnabled: false,
  }

  return db.janitorConfig.create({
    data: {
      workspaceId,
      ...defaults,
      ...overrides,
    },
  })
}

/**
 * Factory for creating test janitor run with sensible defaults
 */
export async function createJanitorRun(
  janitorConfigId: string,
  overrides: Partial<{
    janitorType: "UNIT_TESTS" | "INTEGRATION_TESTS" | "E2E_TESTS" | "SECURITY_REVIEW" | "MOCK_GENERATION"
    status: "PENDING" | "IN_PROGRESS" | "COMPLETED" | "FAILED"
    startedAt: Date
    completedAt: Date
    error: string
    metadata: unknown
  }> = {}
) {
  const defaults = {
    janitorType: "UNIT_TESTS" as const,
    status: "COMPLETED" as const,
    startedAt: new Date(),
    completedAt: new Date(),
  }

  return db.janitorRun.create({
    data: {
      janitorConfigId,
      ...defaults,
      ...overrides,
    },
  })
}

/**
 * Factory for creating test janitor recommendation with sensible defaults
 */
export async function createJanitorRecommendation(
  workspaceId: string,
  overrides: Partial<{
    janitorRunId: string
    title: string
    description: string
    priority: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL"
    impact: string
    status: "PENDING" | "ACCEPTED" | "DISMISSED"
    acceptedAt: Date | null
    dismissedAt: Date | null
    acceptedById: string | null
    dismissedById: string | null
    metadata: unknown
  }> = {}
) {
  const defaults = {
    title: `Test Recommendation ${Date.now()}`,
    description: "This is a test recommendation for E2E testing",
    priority: "MEDIUM" as const,
    impact: "Improves code quality and test coverage",
    status: "PENDING" as const,
  }

  return db.janitorRecommendation.create({
    data: {
      workspaceId,
      ...defaults,
      ...overrides,
    },
  })
}
