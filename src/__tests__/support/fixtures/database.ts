import { db } from "@/lib/db";

export async function countWorkspaces(): Promise<number> {
  return db.workspace.count();
}

export async function countWorkspaceMembers(
  workspaceId: string,
): Promise<number> {
  return db.workspaceMember.count({
    where: { workspaceId, leftAt: null },
  });
}

export async function getWorkspaceWithRelations(workspaceId: string) {
  return db.workspace.findUnique({
    where: { id: workspaceId },
    include: {
      owner: true,
      members: {
        where: { leftAt: null },
        include: { user: true },
      },
      swarm: true,
      products: true,
    },
  });
}

export async function workspaceSlugExists(slug: string): Promise<boolean> {
  const workspace = await db.workspace.findUnique({
    where: { slug },
  });

  return Boolean(workspace);
}

export async function deleteWorkspace(workspaceId: string) {
  await db.workspace.delete({
    where: { id: workspaceId },
  });
}

export async function deleteUser(userId: string) {
  await db.user.delete({
    where: { id: userId },
  });
}

export async function deleteWorkspaces(workspaceIds: string[]) {
  await db.workspace.deleteMany({
    where: { id: { in: workspaceIds } },
  });
}

export async function deleteUsers(userIds: string[]) {
  await db.user.deleteMany({
    where: { id: { in: userIds } },
  });
}

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
    metadata: any
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
    metadata: any
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

export const cleanup = {
  deleteWorkspace,
  deleteWorkspaces,
  deleteUser,
  deleteUsers,
  resetDatabase,
};

export async function resetDatabase() {
  try {
    await db.screenshot.deleteMany();
    await db.attachment.deleteMany();
    await db.artifact.deleteMany();
    await db.chatMessage.deleteMany();
    await db.task.deleteMany();
    await db.janitorRecommendation.deleteMany();
    await db.janitorRun.deleteMany();
    await db.janitorConfig.deleteMany();
    await db.repository.deleteMany();
    await db.swarm.deleteMany();
    await db.workspaceMember.deleteMany();
    await db.workspace.deleteMany();
    await db.session.deleteMany();
    await db.account.deleteMany();
    await db.gitHubAuth.deleteMany();
    await db.sourceControlToken.deleteMany();
    await db.sourceControlOrg.deleteMany();
    await db.user.deleteMany();
  } catch {
    await aggressiveReset();
  }
}

async function aggressiveReset() {
  await db.$executeRaw`SET session_replication_role = replica;`;

  try {
    const tables = [
      "screenshots",
      "attachments",
      "artifacts",
      "chat_messages",
      "tasks",
      "janitor_recommendations",
      "janitor_runs",
      "janitor_configs",
      "repositories",
      "swarms",
      "workspace_members",
      "workspaces",
      "sessions",
      "accounts",
      "github_auth",
      "users",
      "source_control_tokens",
      "source_control_orgs",
    ];

    for (const table of tables) {
      try {
        await db.$executeRawUnsafe(`TRUNCATE TABLE "${table}" CASCADE;`);
      } catch {
        // Some tables may not exist in certain schemas; ignore.
      }
    }
  } finally {
    await db.$executeRaw`SET session_replication_role = DEFAULT;`;
  }
}
