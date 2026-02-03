import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import {
  PodState,
  PoolState,
  RepositoryStatus,
  SourceControlOrgType,
  SwarmStatus,
} from "@prisma/client";
import { seedMockData } from "./mockSeedData";
import { slugify } from "./slugify";

// Mock GitHub user ID counter (starts high to avoid conflicts)
let mockGitHubIdCounter = 100000;

/**
 * Ensures a mock workspace and a completed swarm exist for a given user.
 * Also creates GitHub-related records (GitHubAuth, SourceControlOrg, SourceControlToken)
 * to enable full GitHub feature testing in mock mode.
 * Returns the workspace slug.
 * All DB operations wrapped in transaction for atomicity.
 */
export async function ensureMockWorkspaceForUser(
  userId: string,
): Promise<string> {
  const existing = await db.workspace.findFirst({
    where: { ownerId: userId, deleted: false },
    select: { id: true, slug: true },
  });

  if (existing?.slug) return existing.slug;

  const baseSlug = "mock-stakgraph";
  let slugCandidate = baseSlug;
  let suffix = 1;
  while (await db.workspace.findUnique({ where: { slug: slugCandidate } })) {
    slugCandidate = `${baseSlug}-${++suffix}`;
  }

  // Get user info for building mock GitHub username
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { name: true, email: true },
  });

  // Generate mock GitHub username from user's name or email
  const mockGitHubUsername = user?.name?.toLowerCase().replace(/\s+/g, "-")
    || user?.email?.split("@")[0]
    || "mock-user";
  const mockGitHubUserId = String(mockGitHubIdCounter++);
  const mockInstallationId = mockGitHubIdCounter++;

  // Create encrypted tokens for mock (optional - gracefully handle if encryption not available)
  let encryptedPoolApiKey: string | null = null;
  let encryptedGitHubToken: string | null = null;
  let encryptedGitHubRefreshToken: string | null = null;

  try {
    const encryptionService = EncryptionService.getInstance();
    encryptedPoolApiKey = JSON.stringify(
      encryptionService.encryptField("poolApiKey", "mock-pool-api-key")
    );
    encryptedGitHubToken = JSON.stringify(
      encryptionService.encryptField("access_token", `gho_mock_token_${mockGitHubUserId}`)
    );
    encryptedGitHubRefreshToken = JSON.stringify(
      encryptionService.encryptField("refresh_token", `ghr_mock_refresh_${mockGitHubUserId}`)
    );
  } catch {
    // Encryption not available (e.g., TOKEN_ENCRYPTION_KEY not set)
    // This is fine for E2E tests - mocks will work without encrypted keys
  }

  // Wrap all DB operations in transaction to prevent partial state
  const workspace = await db.$transaction(async (tx) => {
    // 1. Create GitHubAuth record (links user to their GitHub identity)
    await tx.gitHubAuth.upsert({
      where: { userId },
      create: {
        userId,
        githubUserId: mockGitHubUserId,
        githubUsername: mockGitHubUsername,
        githubNodeId: `MDQ6VXNlcjEwMDAwMA==`,
        name: user?.name || "Mock User",
        accountType: "User",
        publicRepos: 10,
        followers: 5,
        following: 3,
        scopes: ["repo", "user", "read:org"],
      },
      update: {
        // If already exists, just update scopes
        scopes: ["repo", "user", "read:org"],
      },
    });

    // 2. Create SourceControlOrg (represents the GitHub org/user that has the app installed)
    const sourceControlOrg = await tx.sourceControlOrg.upsert({
      where: { githubLogin: mockGitHubUsername },
      create: {
        type: SourceControlOrgType.USER,
        githubLogin: mockGitHubUsername,
        githubInstallationId: mockInstallationId,
        name: user?.name || "Mock User",
        avatarUrl: `https://avatars.githubusercontent.com/u/${mockGitHubUserId}?v=4`,
      },
      update: {
        // If already exists, don't update
      },
    });

    // 3. Create SourceControlToken (encrypted GitHub App tokens for API access)
    if (encryptedGitHubToken) {
      await tx.sourceControlToken.upsert({
        where: {
          userId_sourceControlOrgId: {
            userId,
            sourceControlOrgId: sourceControlOrg.id,
          },
        },
        create: {
          userId,
          sourceControlOrgId: sourceControlOrg.id,
          token: encryptedGitHubToken,
          refreshToken: encryptedGitHubRefreshToken,
          expiresAt: new Date(Date.now() + 8 * 60 * 60 * 1000), // 8 hours from now
          scopes: ["repo", "user", "read:org"],
        },
        update: {
          token: encryptedGitHubToken,
          refreshToken: encryptedGitHubRefreshToken,
          expiresAt: new Date(Date.now() + 8 * 60 * 60 * 1000),
        },
      });
    }

    // 4. Create workspace linked to the SourceControlOrg
    const workspace = await tx.workspace.create({
      data: {
        name: "Mock Workspace",
        description: "Development workspace (mock)",
        slug: slugCandidate,
        ownerId: userId,
        sourceControlOrgId: sourceControlOrg.id,
        logoUrl: `https://api.dicebear.com/7.x/identicons/svg?seed=${encodeURIComponent(slugCandidate)}`,
        logoKey: null,
      },
      select: { id: true, slug: true },
    });

    // Optional repository seed to satisfy UIs expecting a repository
    await tx.repository.create({
      data: {
        name: "hive",
        repositoryUrl: "https://github.com/stakwork/hive",
        branch: "master",
        status: RepositoryStatus.SYNCED,
        workspaceId: workspace.id,
        // Test setup flags for mock workspaces
        testingFrameworkSetup: true,
        playwrightSetup: true,
        unitGlob: "src/**/*.{test,spec}.{ts,tsx}",
        integrationGlob: "src/__tests__/integration/**/*.test.ts",
        e2eGlob: "src/__tests__/e2e/specs/**/*.spec.ts",
        codeIngestionEnabled: true,
        docsEnabled: true,
        mocksEnabled: true,
      },
    });

    await tx.swarm.create({
      data: {
        name: slugify(`${workspace.slug}-swarm`),
        status: SwarmStatus.ACTIVE,
        instanceType: "XL",
        environmentVariables: [{ name: "NODE_ENV", value: "development" }],
        services: [
          { name: "stakgraph", port: 7799, scripts: { start: "start" } },
          { name: "repo2graph", port: 3355, scripts: { start: "start" } },
        ],
        workspaceId: workspace.id,
        swarmUrl: "http://localhost",
        agentRequestId: null,
        agentStatus: null,
        containerFilesSetUp: true, // Enable for E2E tests to show dashboard immediately
        poolState: PoolState.COMPLETE, // Skip "Launch Pods" step for mock users
        podState: PodState.COMPLETED, // Skip "Validating..." message for mock users
        poolName: "mock-pool",
        poolApiKey: encryptedPoolApiKey, // Mock pool API key for Pool Manager mock
      },
    });

    return workspace;
  });

  // Seed mock data (features, tasks, janitor config, etc.)
  // This runs outside the transaction - workspace creation succeeds even if seeding fails
  try {
    await seedMockData(userId, workspace.id);
  } catch (error) {
    console.error("[MockSetup] Failed to seed mock data:", error);
    // Don't fail workspace creation if seeding fails
  }

  return workspace.slug;
}
