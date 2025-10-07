/**
 * Test fixtures and factories for GitHub App installation tests
 */
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { generateUniqueId } from "@/__tests__/support/helpers";

const encryptionService = EncryptionService.getInstance();

/**
 * Options for creating test user with GitHub App installation
 */
interface CreateTestUserWithInstallationOptions {
  githubOwner?: string;
  githubInstallationId?: number;
  ownerType?: "USER" | "ORG";
  accessToken?: string;
  refreshToken?: string;
  includeWorkspace?: boolean;
}

/**
 * Creates a test user with complete GitHub App installation setup
 */
export async function createTestUserWithInstallation(
  options?: CreateTestUserWithInstallationOptions
) {
  const {
    githubOwner = "test-owner",
    githubInstallationId = 123456789,
    ownerType = "ORG",
    accessToken = "github_app_token_test_123",
    refreshToken = "github_refresh_token_test_456",
    includeWorkspace = true,
  } = options || {};

  return await db.$transaction(async (tx) => {
    const testUser = await tx.user.create({
      data: {
        id: generateUniqueId("test-user"),
        email: `test-${generateUniqueId()}@example.com`,
        name: "Test User",
      },
    });

    const sourceControlOrg = await tx.sourceControlOrg.create({
      data: {
        id: generateUniqueId("test-org"),
        githubLogin: githubOwner,
        githubInstallationId,
        type: ownerType,
        name: `${githubOwner} ${ownerType === "ORG" ? "Organization" : "User"}`,
      },
    });

    const encryptedAccessToken = encryptionService.encryptField(
      "source_control_token",
      accessToken
    );
    const encryptedRefreshToken = encryptionService.encryptField(
      "source_control_refresh_token",
      refreshToken
    );

    const sourceControlToken = await tx.sourceControlToken.create({
      data: {
        id: generateUniqueId("test-token"),
        userId: testUser.id,
        sourceControlOrgId: sourceControlOrg.id,
        token: JSON.stringify(encryptedAccessToken),
        refreshToken: JSON.stringify(encryptedRefreshToken),
        expiresAt: new Date(Date.now() + 8 * 60 * 60 * 1000), // 8 hours
      },
    });

    let workspace;
    if (includeWorkspace) {
      workspace = await tx.workspace.create({
        data: {
          id: generateUniqueId("test-workspace"),
          name: "Test Workspace",
          slug: `test-workspace-${generateUniqueId()}`,
          ownerId: testUser.id,
          sourceControlOrgId: sourceControlOrg.id,
        },
      });
    }

    return {
      testUser,
      sourceControlOrg,
      sourceControlToken,
      workspace,
      accessToken,
      refreshToken,
    };
  });
}

/**
 * Creates test workspace without GitHub App installation
 */
export async function createTestWorkspaceWithoutInstallation(userId: string) {
  return await db.workspace.create({
    data: {
      id: generateUniqueId("workspace"),
      name: "No Install Workspace",
      slug: `no-install-${generateUniqueId()}`,
      ownerId: userId,
      swarm: {
        create: {
          name: `swarm-${generateUniqueId()}`,
          repositoryUrl: "https://github.com/test-owner/test-repo",
        },
      },
    },
  });
}

/**
 * Creates test session with GitHub state for CSRF validation
 */
export async function createTestSessionWithState(
  userId: string,
  state: string
) {
  return await db.session.create({
    data: {
      sessionToken: generateUniqueId("session-token"),
      userId,
      expires: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
      githubState: state,
    },
  });
}

/**
 * Generates test state following same pattern as endpoint
 */
export function generateTestState(
  workspaceSlug: string,
  repositoryUrl?: string
): string {
  const randomState = generateUniqueId("random-state");
  const stateData = {
    workspaceSlug,
    repositoryUrl,
    randomState,
    timestamp: Date.now(),
  };
  return Buffer.from(JSON.stringify(stateData)).toString("base64");
}

/**
 * Generates expired test state (older than 1 hour)
 */
export function generateExpiredTestState(
  workspaceSlug: string,
  repositoryUrl?: string
): string {
  const randomState = generateUniqueId("random-state");
  const stateData = {
    workspaceSlug,
    repositoryUrl,
    randomState,
    timestamp: Date.now() - 2 * 60 * 60 * 1000, // 2 hours ago
  };
  return Buffer.from(JSON.stringify(stateData)).toString("base64");
}

/**
 * Mock GitHub API responses for installation flow
 */
export const mockGitHubInstallResponses = {
  // User type check - Organization
  userIsOrg: {
    ok: true,
    status: 200,
    json: async () => ({
      login: "test-owner",
      id: 123456,
      type: "Organization",
      name: "Test Organization",
    }),
  },

  // User type check - User account
  userIsUser: {
    ok: true,
    status: 200,
    json: async () => ({
      login: "test-user",
      id: 654321,
      type: "User",
      name: "Test User",
    }),
  },

  // Organization has app installed
  orgInstallationExists: {
    ok: true,
    status: 200,
    json: async () => ({
      id: 123456789,
      account: {
        login: "test-owner",
        type: "Organization",
      },
    }),
  },

  // User has app installed
  userInstallationExists: {
    ok: true,
    status: 200,
    json: async () => ({
      id: 987654321,
      account: {
        login: "test-user",
        type: "User",
      },
    }),
  },

  // No installation found (404)
  installationNotFound: {
    ok: false,
    status: 404,
    statusText: "Not Found",
    text: async () => "Not Found",
  },

  // Access forbidden (403)
  installationForbidden: {
    ok: false,
    status: 403,
    statusText: "Forbidden",
    text: async () => "Forbidden",
  },

  // Server error (500)
  installationServerError: {
    ok: false,
    status: 500,
    statusText: "Internal Server Error",
    text: async () => "Internal Server Error",
  },

  // Network error
  networkError: new Error("Network request failed"),
};

/**
 * Test repository URLs for different scenarios
 */
export const testRepositoryUrls = {
  https: "https://github.com/test-owner/test-repo",
  httpsWithGit: "https://github.com/test-owner/test-repo.git",
  ssh: "git@github.com:test-owner/test-repo.git",
  userRepo: "https://github.com/test-user/personal-repo",
  orgRepo: "https://github.com/test-org/company-repo",
  invalid: "https://gitlab.com/test-owner/test-repo",
  malformed: "not-a-valid-url",
  incomplete: "https://github.com/test-owner",
};

/**
 * Expected response data structure for install endpoint
 */
export interface InstallEndpointResponse {
  success: boolean;
  message?: string;
  data?: {
    link: string;
    state: string;
    flowType: "installation" | "user_authorization";
    appInstalled: boolean;
    githubOwner: string;
    ownerType: "user" | "org";
    installationId?: number;
    repositoryUrl: string;
  };
}