import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import {
  InitiativeStatus,
  MilestoneStatus,
  PodState,
  PoolState,
  RepositoryStatus,
  SourceControlOrgType,
  SwarmStatus,
} from "@prisma/client";
import { seedMockData, seedPublicMockWorkspace } from "./mockSeedData";
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
  let encryptedSwarmPassword: string | null = null;

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
    encryptedSwarmPassword = JSON.stringify(
      encryptionService.encryptField("swarmPassword", "mock-swarm-password")
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
        swarmPassword: encryptedSwarmPassword, // Mock swarm password for cmd API
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

  // Seed the public demo workspace for testing public-viewer + access-request flows
  try {
    await seedPublicMockWorkspace(userId);
  } catch (error) {
    console.error("[MockSetup] Failed to seed public mock workspace:", error);
  }

  return workspace.slug;
}

/**
 * Ensures a "stakwork" workspace exists for a given user with production ID cmh4vrcj70001id04idolu9br.
 * This enables testing of workflow editor, project debugger, and workflow prompt management features
 * that are restricted to the stakwork workspace.
 * Returns the workspace slug ("stakwork").
 * All DB operations wrapped in transaction for atomicity.
 */
export async function ensureStakworkMockWorkspace(
  userId: string,
): Promise<string> {
  const STAKWORK_WORKSPACE_ID = "cmh4vrcj70001id04idolu9br";
  const STAKWORK_SLUG = "stakwork";

  // Check if workspace with production ID already exists (idempotent)
  const existing = await db.workspace.findUnique({
    where: { id: STAKWORK_WORKSPACE_ID },
    select: { id: true, slug: true },
  });

  if (existing?.slug) return existing.slug;

  // Get user info for building mock GitHub username
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { name: true, email: true },
  });

  // Generate mock GitHub username from user's name or email (stakwork-specific)
  const mockGitHubUsername = `${user?.name?.toLowerCase().replace(/\s+/g, "-") || user?.email?.split("@")[0] || "mock-user"}-stakwork`;
  const mockGitHubUserId = String(mockGitHubIdCounter++);
  const mockInstallationId = mockGitHubIdCounter++;

  // Create encrypted tokens for mock (optional - gracefully handle if encryption not available)
  let encryptedPoolApiKey: string | null = null;
  let encryptedGitHubToken: string | null = null;
  let encryptedGitHubRefreshToken: string | null = null;
  let encryptedSwarmPassword: string | null = null;

  try {
    const encryptionService = EncryptionService.getInstance();
    encryptedPoolApiKey = JSON.stringify(
      encryptionService.encryptField("poolApiKey", "mock-stakwork-pool-api-key")
    );
    encryptedGitHubToken = JSON.stringify(
      encryptionService.encryptField("access_token", `gho_mock_stakwork_token_${mockGitHubUserId}`)
    );
    encryptedGitHubRefreshToken = JSON.stringify(
      encryptionService.encryptField("refresh_token", `ghr_mock_stakwork_refresh_${mockGitHubUserId}`)
    );
    encryptedSwarmPassword = JSON.stringify(
      encryptionService.encryptField("swarmPassword", "mock-swarm-password")
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
        name: user?.name || "Mock User (Stakwork)",
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
        githubLogin: mockGitHubUsername,
        type: SourceControlOrgType.USER,
        githubInstallationId: mockInstallationId,
        createdAt: new Date(),
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

    // 4. Create workspace with hardcoded production ID and slug
    const workspace = await tx.workspace.create({
      data: {
        id: STAKWORK_WORKSPACE_ID,
        name: "Stakwork",
        description: "Development workspace for stakwork-specific features (mock)",
        slug: STAKWORK_SLUG,
        ownerId: userId,
        sourceControlOrgId: sourceControlOrg.id,
        logoUrl: `https://api.dicebear.com/7.x/identicons/svg?seed=${encodeURIComponent(STAKWORK_SLUG)}`,
        logoKey: null,
      },
      select: { id: true, slug: true },
    });

    // 5. Create WorkspaceMember record (role=OWNER for the user)
    await tx.workspaceMember.create({
      data: {
        workspaceId: workspace.id,
        userId,
        role: "OWNER",
        joinedAt: new Date(),
      },
    });

    // 6. Create Repository record for "hive"
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

    // 7. Create Swarm record with poolState=COMPLETE and podState=COMPLETED
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
        poolName: "mock-stakwork-pool",
        poolApiKey: encryptedPoolApiKey, // Mock pool API key for Pool Manager mock
        swarmPassword: encryptedSwarmPassword, // Mock swarm password for cmd API
      },
    });

    return workspace;
  });

  // Seed mock data (features, tasks, janitor config, etc.)
  // This runs outside the transaction - workspace creation succeeds even if seeding fails
  try {
    await seedMockData(userId, workspace.id);
  } catch (error) {
    console.error("[MockSetup] Failed to seed stakwork mock data:", error);
    // Don't fail workspace creation if seeding fails
  }

  return workspace.slug;
}

/**
 * Ensures a graph_mindset workspace exists for a given user.
 * This enables testing of /graph-admin features in mock mode.
 * Returns the workspace slug.
 */
export async function ensureGraphMindsetMockWorkspace(
  userId: string,
): Promise<string> {
  const GRAPH_MINDSET_SLUG = "mock-graph-mindset";

  const existing = await db.workspace.findFirst({
    where: { ownerId: userId, workspaceKind: "graph_mindset", deleted: false },
    select: { id: true, slug: true },
  });

  if (existing?.slug) return existing.slug;

  let encryptedSwarmPassword: string | null = null;
  try {
    const encryptionService = EncryptionService.getInstance();
    encryptedSwarmPassword = JSON.stringify(
      encryptionService.encryptField("swarmPassword", "mock-swarm-password")
    );
  } catch {
    // Encryption not available — swarmPassword will be null
  }

  let slugCandidate = GRAPH_MINDSET_SLUG;
  let suffix = 1;
  while (await db.workspace.findUnique({ where: { slug: slugCandidate } })) {
    slugCandidate = `${GRAPH_MINDSET_SLUG}-${++suffix}`;
  }

  const workspace = await db.$transaction(async (tx) => {
    const workspace = await tx.workspace.create({
      data: {
        name: "Mock Graph Mindset",
        description: "Development workspace for graph_mindset features (mock)",
        slug: slugCandidate,
        ownerId: userId,
        workspaceKind: "graph_mindset",
        logoUrl: `https://api.dicebear.com/7.x/identicons/svg?seed=${encodeURIComponent(slugCandidate)}`,
        logoKey: null,
      },
      select: { id: true, slug: true },
    });

    await tx.workspaceMember.create({
      data: {
        workspaceId: workspace.id,
        userId,
        role: "OWNER",
        joinedAt: new Date(),
      },
    });

    await tx.swarm.create({
      data: {
        name: slugify(`${workspace.slug}-swarm`),
        status: SwarmStatus.ACTIVE,
        instanceType: "XL",
        environmentVariables: [],
        services: [],
        workspaceId: workspace.id,
        swarmUrl: "http://localhost",
        containerFilesSetUp: true,
        poolState: PoolState.COMPLETE,
        podState: PodState.COMPLETED,
        poolName: "mock-graph-mindset-pool",
        swarmPassword: encryptedSwarmPassword,
      },
    });

    return workspace;
  });

  return workspace.slug;
}

/**
 * Ensures a second "mock-org" SourceControlOrg (type=ORG) exists with 2 workspaces and 2 team
 * members, giving the org page meaningful multi-workspace data.
 * Idempotent — safe to call on every sign-in.
 */
export async function ensureMockOrgData(userId: string): Promise<void> {
  const MOCK_ORG_LOGIN = "mock-org";
  const MOCK_ORG_INSTALLATION_ID = 999001;

  // Idempotency: if org already exists, top up the auxiliary seed
  // steps (each guarded individually so re-runs are cheap). This path
  // also backfills features+tasks for users who signed in before
  // workspace-level seeding was added — `seedMockData` is a no-op
  // when the workspace already has features.
  const existing = await db.sourceControlOrg.findUnique({
    where: { githubLogin: MOCK_ORG_LOGIN },
  });
  if (existing) {
    // Backfill: users who signed in before the SourceControlToken
    // seed landed have the org but no token, which 404s the
    // org-canvas ask flow. Cheap upsert on every login.
    try {
      const encryptionService = EncryptionService.getInstance();
      const encryptedToken = JSON.stringify(
        encryptionService.encryptField("access_token", `gho_mock_org_token`)
      );
      const encryptedRefresh = JSON.stringify(
        encryptionService.encryptField("refresh_token", `ghr_mock_org_refresh`)
      );
      await db.sourceControlToken.upsert({
        where: {
          userId_sourceControlOrgId: {
            userId,
            sourceControlOrgId: existing.id,
          },
        },
        create: {
          userId,
          sourceControlOrgId: existing.id,
          token: encryptedToken,
          refreshToken: encryptedRefresh,
          expiresAt: new Date(Date.now() + 8 * 60 * 60 * 1000),
          scopes: ["repo", "user", "read:org"],
        },
        update: {
          token: encryptedToken,
          refreshToken: encryptedRefresh,
          expiresAt: new Date(Date.now() + 8 * 60 * 60 * 1000),
        },
      });
    } catch (error) {
      console.error("[MockSetup] Failed to backfill mock-org SourceControlToken:", error);
    }

    const orgWorkspaces = await db.workspace.findMany({
      where: {
        sourceControlOrgId: existing.id,
        slug: { in: ["mock-org-frontend", "mock-org-backend"] },
        deleted: false,
      },
      select: { id: true },
    });
    for (const ws of orgWorkspaces) {
      try {
        await seedMockData(userId, ws.id);
      } catch (error) {
        console.error("[MockSetup] Failed to backfill mock-org workspace data:", error);
      }
    }
    await ensureMockConnectionData(existing.id, userId);
    await ensureMockOrgInitiatives(existing.id, userId);
    return;
  }

  let encryptedPoolApiKey: string | null = null;
  let encryptedOrgGitHubToken: string | null = null;
  let encryptedOrgGitHubRefreshToken: string | null = null;
  try {
    const encryptionService = EncryptionService.getInstance();
    encryptedPoolApiKey = JSON.stringify(
      encryptionService.encryptField("poolApiKey", "mock-org-pool-api-key")
    );
    // Mock GitHub App tokens for the (user × mock-org) pair. The
    // org-canvas chat (`/api/ask/quick`) calls
    // `getGithubUsernameAndPAT(userId, slug)` for every workspace it
    // queries, which requires a `SourceControlToken` row scoped to
    // the workspace's `SourceControlOrg`. Without this, the ask flow
    // 404s before reaching the LLM. Token value is opaque — local
    // canvas tools never call the GitHub API with it.
    encryptedOrgGitHubToken = JSON.stringify(
      encryptionService.encryptField("access_token", `gho_mock_org_token`)
    );
    encryptedOrgGitHubRefreshToken = JSON.stringify(
      encryptionService.encryptField("refresh_token", `ghr_mock_org_refresh`)
    );
  } catch {
    // Encryption not required for mock
  }

  const workspace = await db.$transaction(async (tx) => {
    // 1. Create the org
    const org = await tx.sourceControlOrg.create({
      data: {
        type: SourceControlOrgType.ORG,
        githubLogin: MOCK_ORG_LOGIN,
        githubInstallationId: MOCK_ORG_INSTALLATION_ID,
        name: "Mock Organization",
        avatarUrl: `https://avatars.githubusercontent.com/u/999001?v=4`,
      },
    });

    // 1b. Token for the (user × mock-org) pair. See encryption block
    // above for why this exists.
    if (encryptedOrgGitHubToken) {
      await tx.sourceControlToken.create({
        data: {
          userId,
          sourceControlOrgId: org.id,
          token: encryptedOrgGitHubToken,
          refreshToken: encryptedOrgGitHubRefreshToken,
          expiresAt: new Date(Date.now() + 8 * 60 * 60 * 1000),
          scopes: ["repo", "user", "read:org"],
        },
      });
    }

    // 2. Create two team-member User records
    const member1 = await tx.user.create({
      data: {
        name: "Alice Dev",
        email: "alice-mock-org@example.com",
        emailVerified: new Date(),
        image: "https://api.dicebear.com/7.x/identicons/svg?seed=alice-mock",
      },
    });
    const member2 = await tx.user.create({
      data: {
        name: "Bob Dev",
        email: "bob-mock-org@example.com",
        emailVerified: new Date(),
        image: "https://api.dicebear.com/7.x/identicons/svg?seed=bob-mock",
      },
    });

    // Helper to create a workspace + swarm + repo + members under the org
    const createOrgWorkspace = async (slug: string, name: string, memberIds: string[]) => {
      const ws = await tx.workspace.create({
        data: {
          name,
          description: `Mock workspace for ${MOCK_ORG_LOGIN}`,
          slug,
          ownerId: userId,
          sourceControlOrgId: org.id,
          logoUrl: `https://api.dicebear.com/7.x/identicons/svg?seed=${encodeURIComponent(slug)}`,
        },
      });

      await tx.repository.create({
        data: {
          name: slug,
          repositoryUrl: `https://github.com/${MOCK_ORG_LOGIN}/${slug}`,
          branch: "main",
          status: RepositoryStatus.SYNCED,
          workspaceId: ws.id,
          codeIngestionEnabled: true,
          mocksEnabled: true,
        },
      });

      await tx.swarm.create({
        data: {
          name: slugify(`${slug}-swarm`),
          status: SwarmStatus.ACTIVE,
          instanceType: "XL",
          environmentVariables: [],
          services: [],
          workspaceId: ws.id,
          swarmUrl: "http://localhost",
          containerFilesSetUp: true,
          poolState: PoolState.COMPLETE,
          podState: PodState.COMPLETED,
          poolName: `${slug}-pool`,
          poolApiKey: encryptedPoolApiKey,
        },
      });

      // Add team members as WorkspaceMember records
      for (const memberId of memberIds) {
        await tx.workspaceMember.create({
          data: {
            workspaceId: ws.id,
            userId: memberId,
            role: "DEVELOPER",
            joinedAt: new Date(),
          },
        });
      }

      return ws;
    };

    const frontendWs = await createOrgWorkspace("mock-org-frontend", "Mock Org Frontend", [member1.id, member2.id]);
    const backendWs = await createOrgWorkspace("mock-org-backend", "Mock Org Backend", [member1.id]);

    return { orgId: org.id, workspaceIds: [frontendWs.id, backendWs.id] };
  });

  // Seed features + tasks into both org workspaces so the milestone
  // sub-canvas has real content to project. Runs OUTSIDE the
  // transaction (matches the pattern used for the user's personal
  // mock-stakgraph workspace) — workspace creation succeeds even if
  // seeding has a hiccup. Each call is idempotent on its own
  // (`seedMockData` early-returns when features already exist).
  for (const wsId of workspace.workspaceIds) {
    try {
      await seedMockData(userId, wsId);
    } catch (error) {
      console.error("[MockSetup] Failed to seed mock-org workspace data:", error);
    }
  }

  await ensureMockConnectionData(workspace.orgId, userId);
  await ensureMockOrgInitiatives(workspace.orgId, userId);
}

async function ensureMockConnectionData(orgId: string, userId: string): Promise<void> {
  const existing = await db.connection.findFirst({
    where: { orgId, slug: "frontend-backend-api" },
  });
  if (existing) return;

  await db.connection.create({
    data: {
      slug: "frontend-backend-api",
      name: "Frontend ↔ Backend API",
      summary:
        "The frontend Next.js app communicates with the backend service via a REST API. " +
        "Auth tokens are passed as Bearer headers. WebSocket is used for real-time updates.",
      diagram: [
        "graph LR",
        "  FE[Frontend Next.js] -->|REST API| GW[API Gateway]",
        "  GW -->|Auth Check| AUTH[Auth Service]",
        "  GW -->|Route| BE[Backend Service]",
        "  BE -->|Query| DB[(PostgreSQL)]",
        "  BE -->|Publish| WS[WebSocket Server]",
        "  WS -->|Push| FE",
      ].join("\n"),
      architecture:
        "## Data Flow\n\n" +
        "1. The frontend makes REST calls to `/api/*` endpoints on the backend\n" +
        "2. The API gateway validates the JWT Bearer token against the Auth Service\n" +
        "3. Validated requests are routed to the appropriate backend handler\n" +
        "4. The backend reads/writes to PostgreSQL via Prisma ORM\n" +
        "5. For real-time features, the backend publishes events to a WebSocket server\n" +
        "6. The frontend subscribes to WebSocket channels for live updates\n\n" +
        "## Authentication\n\n" +
        "- OAuth 2.0 with GitHub as the identity provider\n" +
        "- JWTs issued by the Auth Service, 1-hour expiry\n" +
        "- Refresh tokens stored in HTTP-only cookies\n\n" +
        "## Error Handling\n\n" +
        "- Backend returns standard JSON error envelopes: `{ error, kind, details }`\n" +
        "- Frontend uses a global error boundary plus per-request toast notifications",
      openApiSpec:
        "openapi: '3.0.3'\n" +
        "info:\n" +
        "  title: Mock Org Backend API\n" +
        "  version: 1.0.0\n" +
        "  description: REST API for the mock org backend service\n" +
        "paths:\n" +
        "  /api/tasks:\n" +
        "    get:\n" +
        "      summary: List tasks\n" +
        "      parameters:\n" +
        "        - name: status\n" +
        "          in: query\n" +
        "          schema:\n" +
        "            type: string\n" +
        "            enum: [open, closed, in_progress]\n" +
        "      responses:\n" +
        "        '200':\n" +
        "          description: A list of tasks\n" +
        "          content:\n" +
        "            application/json:\n" +
        "              schema:\n" +
        "                type: array\n" +
        "                items:\n" +
        "                  $ref: '#/components/schemas/Task'\n" +
        "    post:\n" +
        "      summary: Create a task\n" +
        "      requestBody:\n" +
        "        required: true\n" +
        "        content:\n" +
        "          application/json:\n" +
        "            schema:\n" +
        "              $ref: '#/components/schemas/CreateTaskInput'\n" +
        "      responses:\n" +
        "        '201':\n" +
        "          description: Task created\n" +
        "  /api/tasks/{id}:\n" +
        "    get:\n" +
        "      summary: Get a task by ID\n" +
        "      parameters:\n" +
        "        - name: id\n" +
        "          in: path\n" +
        "          required: true\n" +
        "          schema:\n" +
        "            type: string\n" +
        "      responses:\n" +
        "        '200':\n" +
        "          description: Task details\n" +
        "        '404':\n" +
        "          description: Task not found\n" +
        "components:\n" +
        "  schemas:\n" +
        "    Task:\n" +
        "      type: object\n" +
        "      properties:\n" +
        "        id:\n" +
        "          type: string\n" +
        "        title:\n" +
        "          type: string\n" +
        "        status:\n" +
        "          type: string\n" +
        "          enum: [open, closed, in_progress]\n" +
        "        assignee:\n" +
        "          type: string\n" +
        "          nullable: true\n" +
        "        createdAt:\n" +
        "          type: string\n" +
        "          format: date-time\n" +
        "    CreateTaskInput:\n" +
        "      type: object\n" +
        "      required: [title]\n" +
        "      properties:\n" +
        "        title:\n" +
        "          type: string\n" +
        "        assignee:\n" +
        "          type: string",
      createdBy: userId,
      orgId,
    },
  });
}

/**
 * Seeds two strategic Initiatives onto Mock Organization with a
 * realistic spread of milestones (NOT_STARTED / IN_PROGRESS / COMPLETED
 * + due dates spanning past-due, this-quarter, next-quarter, later)
 * and links a subset of mock features to them. Designed to showcase
 * the org-canvas milestone-progress visuals end-to-end:
 *
 *   - **Progress bar**       — milestones land at 0%, partial, and 100%
 *   - **Agent-active badge** — at least one milestone has linked
 *                              features whose tasks are IN_PROGRESS
 *                              (the seed reuses `seedMockData`'s task
 *                              fixtures, several of which are mid-run)
 *   - **Team avatars**       — features are split across both org
 *                              workspaces, so milestones inherit team
 *                              members from cross-workspace assignees
 *
 * Idempotent: bails when initiatives already exist for this org. Safe
 * to call on every sign-in.
 */
async function ensureMockOrgInitiatives(
  orgId: string,
  userId: string,
): Promise<void> {
  // Idempotency check — if any initiative exists for this org we
  // assume seeding has already run. A repeated seed would create
  // duplicate timeline rows and a `sequence` unique-constraint
  // violation on milestones.
  const existingCount = await db.initiative.count({ where: { orgId } });
  if (existingCount > 0) return;

  // Resolve the two org workspaces' features so we can link them
  // into milestones. We look these up by slug (set by `ensureMockOrgData`)
  // — by the time this runs `seedMockData` has populated 5 features
  // per workspace.
  const orgWorkspaces = await db.workspace.findMany({
    where: {
      sourceControlOrgId: orgId,
      slug: { in: ["mock-org-frontend", "mock-org-backend"] },
      deleted: false,
    },
    select: {
      id: true,
      slug: true,
      features: {
        where: { deleted: false },
        select: { id: true, title: true, status: true },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  const allFeatures = orgWorkspaces.flatMap((w) => w.features);
  // Helper to grab a feature by index across the merged list — keeps
  // the linking sites readable.
  const f = (i: number) => allFeatures[i];

  // Date helpers — `seedMockData` runs at sign-in, so "today" varies.
  // We anchor due dates relative to now so the timeline columns
  // (Past Due / This Quarter / Next Quarter / Later) get a card
  // each on every fresh seed.
  const now = new Date();
  const daysFromNow = (d: number) =>
    new Date(now.getTime() + d * 24 * 60 * 60 * 1000);

  // ── Initiative 1: "Q4 Platform Modernization" — actively in flight ──
  // Mix of done, in-progress, and upcoming milestones. The first
  // milestone is past-due to demonstrate the timeline's left-most
  // band, the middle two are this/next quarter, and the last is later.
  const platform = await db.initiative.create({
    data: {
      orgId,
      name: "Q4 Platform Modernization",
      description:
        "Lift the platform off legacy infrastructure: migrate auth, ship a faster dashboard, and harden the public API.",
      status: InitiativeStatus.ACTIVE,
      assigneeId: userId,
      startDate: daysFromNow(-60),
      targetDate: daysFromNow(120),
    },
  });

  // Build the milestone payloads in order. Sequence MUST be unique
  // within an initiative; the projector lays out by sequence on the
  // timeline x-axis so 1..N reads as left-to-right.
  const platformMilestones = [
    {
      name: "Auth migration",
      status: MilestoneStatus.COMPLETED,
      sequence: 1,
      dueDate: daysFromNow(-30),
      completedAt: daysFromNow(-25),
      // Link the COMPLETED auth feature → 1/1 = 100% progress
      featureIds: f(0) ? [f(0).id] : [],
    },
    {
      name: "Dashboard overhaul",
      status: MilestoneStatus.IN_PROGRESS,
      sequence: 2,
      // Past-due to show the "Past Due" band on the timeline.
      dueDate: daysFromNow(-3),
      // 2 features linked, only 1 done → 50% progress bar.
      // Also: the "Dashboard Analytics" feature is IN_PROGRESS in
      // mock data, with mid-run tasks → agent-count badge fires.
      featureIds: [f(0)?.id, f(1)?.id].filter((x): x is string => !!x),
    },
    {
      name: "API rate limiting",
      status: MilestoneStatus.IN_PROGRESS,
      sequence: 3,
      // This-quarter band.
      dueDate: daysFromNow(20),
      featureIds: f(2) ? [f(2).id] : [],
    },
    {
      name: "Search & filters",
      status: MilestoneStatus.NOT_STARTED,
      sequence: 4,
      // Next-quarter band.
      dueDate: daysFromNow(95),
      featureIds: f(3) ? [f(3).id] : [],
    },
    {
      name: "Cross-region failover",
      status: MilestoneStatus.NOT_STARTED,
      sequence: 5,
      // Later band — no feature link yet (the empty progress-bar
      // case: the bar is hidden when featureCount === 0).
      dueDate: daysFromNow(180),
      featureIds: [],
    },
  ];

  for (const m of platformMilestones) {
    await db.milestone.create({
      data: {
        initiativeId: platform.id,
        name: m.name,
        status: m.status,
        sequence: m.sequence,
        dueDate: m.dueDate,
        completedAt: m.completedAt ?? null,
        assigneeId: userId,
        ...(m.featureIds.length > 0 && {
          features: { connect: m.featureIds.map((id) => ({ id })) },
        }),
      },
    });
  }

  // ── Initiative 2: "Trust & Safety" — early-stage, mostly not-started ──
  // Smaller initiative with fewer milestones. Demonstrates a "young"
  // initiative on the canvas: low progress, fewer features linked.
  const trust = await db.initiative.create({
    data: {
      orgId,
      name: "Trust & Safety",
      description:
        "Rate-limit abuse vectors, ship audit logs, and start an incident-response runbook.",
      status: InitiativeStatus.ACTIVE,
      assigneeId: userId,
      startDate: daysFromNow(-7),
      targetDate: daysFromNow(150),
    },
  });

  const trustMilestones = [
    {
      name: "Threat model",
      status: MilestoneStatus.COMPLETED,
      sequence: 1,
      dueDate: daysFromNow(-2),
      completedAt: daysFromNow(-1),
      featureIds: [],
    },
    {
      name: "Audit log v1",
      status: MilestoneStatus.IN_PROGRESS,
      sequence: 2,
      dueDate: daysFromNow(45),
      // Cross-link a backend feature so the milestone team-stack
      // surfaces a different set of avatars from initiative 1.
      featureIds: f(5) ? [f(5).id] : [],
    },
    {
      name: "Incident runbook",
      status: MilestoneStatus.NOT_STARTED,
      sequence: 3,
      dueDate: daysFromNow(110),
      featureIds: [],
    },
  ];

  for (const m of trustMilestones) {
    await db.milestone.create({
      data: {
        initiativeId: trust.id,
        name: m.name,
        status: m.status,
        sequence: m.sequence,
        dueDate: m.dueDate,
        completedAt: m.completedAt ?? null,
        assigneeId: userId,
        ...(m.featureIds.length > 0 && {
          features: { connect: m.featureIds.map((id) => ({ id })) },
        }),
      },
    });
  }

  console.log(
    `[MockSetup] Seeded ${platformMilestones.length + trustMilestones.length} milestones across 2 initiatives for mock-org`,
  );
}
