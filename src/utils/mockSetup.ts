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
 * Ensures a second "mock-org" SourceControlOrg (type=ORG) exists with 2 workspaces and 2 team
 * members, giving the org page meaningful multi-workspace data.
 * Idempotent — safe to call on every sign-in.
 */
export async function ensureMockOrgData(userId: string): Promise<void> {
  const MOCK_ORG_LOGIN = "mock-org";
  const MOCK_ORG_INSTALLATION_ID = 999001;

  // Idempotency: if org already exists, just ensure connections are seeded
  const existing = await db.sourceControlOrg.findUnique({
    where: { githubLogin: MOCK_ORG_LOGIN },
  });
  if (existing) {
    await ensureMockConnectionData(existing.id, userId);
    return;
  }

  let encryptedPoolApiKey: string | null = null;
  try {
    const encryptionService = EncryptionService.getInstance();
    encryptedPoolApiKey = JSON.stringify(
      encryptionService.encryptField("poolApiKey", "mock-org-pool-api-key")
    );
  } catch {
    // Encryption not required for mock
  }

  await db.$transaction(async (tx) => {
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

    await createOrgWorkspace("mock-org-frontend", "Mock Org Frontend", [member1.id, member2.id]);
    await createOrgWorkspace("mock-org-backend", "Mock Org Backend", [member1.id]);

    await ensureMockConnectionData(org.id, userId);
  });
}

async function ensureMockConnectionData(orgId: string, userId: string): Promise<void> {
  const existing = await db.connection.findFirst({ where: { orgId } });
  if (existing) return;

  await db.connection.create({
    data: {
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
