/**
 * Test fixtures and factories for GitHub App installation tests
 */
import { db } from "@/lib/db";
import { generateUniqueId } from "@/__tests__/support/helpers";

/**
 * Options for creating test workspace
 */
interface CreateTestWorkspaceOptions {
  name?: string;
  slug?: string;
  ownerId: string;
  repositoryUrl?: string;
  sourceControlOrgId?: string;
}

/**
 * Creates a test workspace with optional swarm and source control org
 */
export async function createTestWorkspace(options: CreateTestWorkspaceOptions) {
  const {
    name = "Test Workspace",
    slug = `test-workspace-${generateUniqueId()}`,
    ownerId,
    repositoryUrl,
    sourceControlOrgId,
  } = options;

  return await db.$transaction(async (tx) => {
    const workspace = await tx.workspace.create({
      data: {
        id: generateUniqueId("workspace"),
        name,
        slug,
        ownerId,
        sourceControlOrgId,
      },
    });

    // Create swarm with repository URL if provided
    let swarm;
    if (repositoryUrl) {
      swarm = await tx.swarm.create({
        data: {
          id: generateUniqueId("swarm"),
          name: `${slug}.sphinx.chat`,
          workspaceId: workspace.id,
          repositoryUrl,
        },
      });
    }

    return { workspace, swarm };
  });
}

/**
 * Options for creating source control org
 */
interface CreateSourceControlOrgOptions {
  githubLogin: string;
  githubInstallationId?: number;
  type?: "USER" | "ORG";
  name?: string;
}

/**
 * Creates a test source control org
 */
export async function createSourceControlOrg(options: CreateSourceControlOrgOptions) {
  const {
    githubLogin,
    githubInstallationId = 123456789,
    type = "ORG",
    name,
  } = options;

  return await db.sourceControlOrg.create({
    data: {
      id: generateUniqueId("source-org"),
      githubLogin,
      githubInstallationId,
      type,
      name: name || `${githubLogin} ${type === "USER" ? "User" : "Organization"}`,
    },
  });
}

/**
 * Mock GitHub API responses for installation checks
 */
export const mockGitHubInstallationResponses = {
  userType: (login: string) => ({
    ok: true,
    status: 200,
    json: async () => ({
      login,
      id: 12345,
      type: "User",
      avatar_url: `https://avatars.githubusercontent.com/u/12345`,
    }),
  }),

  orgType: (login: string) => ({
    ok: true,
    status: 200,
    json: async () => ({
      login,
      id: 67890,
      type: "Organization",
      avatar_url: `https://avatars.githubusercontent.com/u/67890`,
    }),
  }),

  installationFound: (installationId: number) => ({
    ok: true,
    status: 200,
    json: async () => ({
      id: installationId,
      account: {
        login: "test-owner",
        type: "Organization",
      },
      app_id: 123,
    }),
  }),

  installationNotFound: {
    ok: false,
    status: 404,
    statusText: "Not Found",
    json: async () => ({
      message: "Not Found",
    }),
  },
};

/**
 * Test repository URLs for different scenarios
 */
export const testGitHubRepositoryUrls = {
  https: "https://github.com/test-owner/test-repo",
  httpsWithGit: "https://github.com/test-owner/test-repo.git",
  ssh: "git@github.com:test-owner/test-repo.git",
  userRepo: "https://github.com/testuser/user-repo",
  orgRepo: "https://github.com/testorg/org-repo",
  invalid: "https://gitlab.com/test-owner/test-repo",
  malformed: "not-a-valid-url",
};

/**
 * Mock state data for CSRF validation
 */
export function createMockStateData(workspaceSlug: string, repositoryUrl?: string) {
  return {
    workspaceSlug,
    repositoryUrl,
    randomState: "mock-random-state-32-bytes-hex-string",
    timestamp: Date.now(),
  };
}

/**
 * Helper to create expected redirect URLs
 */
export function createExpectedRedirectUrl(
  flowType: "installation" | "user_authorization",
  state: string,
  ownerType?: "user" | "org"
) {
  const clientId = process.env.GITHUB_APP_CLIENT_ID || "test-client-id";
  const appSlug = process.env.GITHUB_APP_SLUG || "test-app-slug";

  if (flowType === "user_authorization") {
    return `https://github.com/login/oauth/authorize?client_id=${clientId}&state=${state}`;
  }

  if (ownerType === "user") {
    return `https://github.com/apps/${appSlug}/installations/new?state=${state}&target_type=User`;
  }

  return `https://github.com/apps/${appSlug}/installations/new?state=${state}`;
}