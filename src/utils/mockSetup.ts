import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import {
  PodState,
  PoolState,
  RepositoryStatus,
  SourceControlOrgType,
  SwarmStatus,
  WorkspaceRole,
} from "@prisma/client";
import { seedMockData } from "./mockSeedData";
import { slugify } from "./slugify";

// Mock GitHub user ID counter (starts high to avoid conflicts)
let mockGitHubIdCounter = 100000;

/**
 * Ensures a mock workspace and a completed swarm exist for a given user.
 * Also creates GitHub-related records (GitHubAuth, SourceControlOrg, SourceControlToken)
 * to enable full GitHub feature testing in mock mode.
 * 
 * If the user is signing in with a specific role (not OWNER), the function will:
 * 1. Find or create a shared mock workspace (owned by a system mock user)
 * 2. Add the user as a member with the specified role
 * 
 * Returns the workspace slug.
 * All DB operations wrapped in transaction for atomicity.
 */
export async function ensureMockWorkspaceForUser(
  userId: string,
  role?: WorkspaceRole,
): Promise<string> {
  // Check if user already has a workspace (as owner or member)
  const existingWorkspace = await db.workspace.findFirst({
    where: { ownerId: userId, deleted: false },
    select: { id: true, slug: true },
  });

  if (existingWorkspace?.slug) return existingWorkspace.slug;

  // If role is provided and not OWNER, find or create shared workspace and add as member
  if (role && role !== WorkspaceRole.OWNER) {
    return await ensureMockWorkspaceMember(userId, role);
  }

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

/**
 * Ensures a user is added as a member to a shared mock workspace with the specified role.
 * Creates the shared workspace if it doesn't exist.
 * 
 * @param userId - The user ID to add as a member
 * @param role - The workspace role to assign
 * @returns The workspace slug
 */
async function ensureMockWorkspaceMember(
  userId: string,
  role: WorkspaceRole,
): Promise<string> {
  // Check if user is already a member of any workspace
  const existingMembership = await db.workspaceMember.findFirst({
    where: { 
      userId,
      leftAt: null,
    },
    include: {
      workspace: {
        select: { slug: true, deleted: false },
      },
    },
  });

  if (existingMembership?.workspace && !existingMembership.workspace.deleted) {
    return existingMembership.workspace.slug;
  }

  // Find or create a shared mock workspace
  const sharedWorkspaceSlug = "mock-shared-workspace";
  let sharedWorkspace = await db.workspace.findUnique({
    where: { slug: sharedWorkspaceSlug },
    select: { id: true, slug: true, ownerId: true },
  });

  // If shared workspace doesn't exist, create it with a system owner
  if (!sharedWorkspace) {
    // Create system owner user if doesn't exist
    const systemOwnerEmail = "mock-owner@mock.dev";
    let systemOwner = await db.user.findUnique({
      where: { email: systemOwnerEmail },
      select: { id: true },
    });

    if (!systemOwner) {
      systemOwner = await db.user.create({
        data: {
          name: "Mock Owner",
          email: systemOwnerEmail,
          emailVerified: new Date(),
          image: `https://avatars.githubusercontent.com/u/1?v=4`,
        },
        select: { id: true },
      });

      // Create GitHub records for system owner
      const mockGitHubUserId = String(mockGitHubIdCounter++);
      const mockInstallationId = mockGitHubIdCounter++;

      await db.gitHubAuth.create({
        data: {
          userId: systemOwner.id,
          githubUserId: mockGitHubUserId,
          githubUsername: "mock-owner",
          githubNodeId: `MDQ6VXNlcjEwMDAwMA==`,
          name: "Mock Owner",
          accountType: "User",
          publicRepos: 10,
          followers: 5,
          following: 3,
          scopes: ["repo", "user", "read:org"],
        },
      });

      const sourceControlOrg = await db.sourceControlOrg.create({
        data: {
          type: SourceControlOrgType.USER,
          githubLogin: "mock-owner",
          githubInstallationId: mockInstallationId,
          name: "Mock Owner",
          avatarUrl: `https://avatars.githubusercontent.com/u/${mockGitHubUserId}?v=4`,
        },
      });

      // Create encrypted tokens if encryption is available
      try {
        const encryptionService = EncryptionService.getInstance();
        const encryptedGitHubToken = JSON.stringify(
          encryptionService.encryptField("access_token", `gho_mock_token_${mockGitHubUserId}`)
        );
        const encryptedGitHubRefreshToken = JSON.stringify(
          encryptionService.encryptField("refresh_token", `ghr_mock_refresh_${mockGitHubUserId}`)
        );

        await db.sourceControlToken.create({
          data: {
            userId: systemOwner.id,
            sourceControlOrgId: sourceControlOrg.id,
            token: encryptedGitHubToken,
            refreshToken: encryptedGitHubRefreshToken,
            expiresAt: new Date(Date.now() + 8 * 60 * 60 * 1000),
            scopes: ["repo", "user", "read:org"],
          },
        });
      } catch {
        // Encryption not available - fine for testing
      }
    }

    // Now create the shared workspace
    const encryptedPoolApiKey = await (async () => {
      try {
        const encryptionService = EncryptionService.getInstance();
        return JSON.stringify(
          encryptionService.encryptField("poolApiKey", "mock-pool-api-key")
        );
      } catch {
        return null;
      }
    })();

    sharedWorkspace = await db.$transaction(async (tx) => {
      const workspace = await tx.workspace.create({
        data: {
          name: "Mock Shared Workspace",
          description: "Shared workspace for mock users with different roles",
          slug: sharedWorkspaceSlug,
          ownerId: systemOwner!.id,
          logoUrl: `https://api.dicebear.com/7.x/identicons/svg?seed=${encodeURIComponent(sharedWorkspaceSlug)}`,
          logoKey: null,
        },
        select: { id: true, slug: true, ownerId: true },
      });

      // Create repository
      await tx.repository.create({
        data: {
          name: "hive",
          repositoryUrl: "https://github.com/stakwork/hive",
          branch: "master",
          status: RepositoryStatus.SYNCED,
          workspaceId: workspace.id,
          testingFrameworkSetup: true,
          playwrightSetup: true,
          unitGlob: "src/**/*.{test,spec}.{ts,tsx}",
          integrationGlob: "src/__tests__/integration/**/*.test.ts",
          e2eGlob: "src/__tests__/e2e/specs/**/*.spec.ts",
        },
      });

      // Create swarm
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
          containerFilesSetUp: true,
          poolState: PoolState.COMPLETE,
          podState: PodState.COMPLETED,
          poolName: "mock-pool",
          poolApiKey: encryptedPoolApiKey,
        },
      });

      return workspace;
    });

    // Seed mock data
    try {
      await seedMockData(systemOwner!.id, sharedWorkspace.id);
    } catch (error) {
      console.error("[MockSetup] Failed to seed mock data for shared workspace:", error);
    }
  }

  // Get user info for GitHub record
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { name: true, email: true },
  });

  const mockGitHubUsername = user?.name?.toLowerCase().replace(/\s+/g, "-")
    || user?.email?.split("@")[0]
    || "mock-user";
  const mockGitHubUserId = String(mockGitHubIdCounter++);

  // Create GitHub records for the member user if they don't exist
  await db.gitHubAuth.upsert({
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
      scopes: ["repo", "user", "read:org"],
    },
  });

  // Add user as workspace member with specified role
  await db.workspaceMember.upsert({
    where: {
      workspaceId_userId: {
        workspaceId: sharedWorkspace.id,
        userId,
      },
    },
    create: {
      workspaceId: sharedWorkspace.id,
      userId,
      role,
      joinedAt: new Date(),
    },
    update: {
      role,
      leftAt: null, // Ensure they're active
    },
  });

  return sharedWorkspace.slug;
}
