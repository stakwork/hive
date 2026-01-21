/**
 * Test fixtures and factories for GitHub webhook endpoint tests
 */
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { computeHmacSha256Hex } from "@/lib/encryption";
import { generateUniqueId } from "@/__tests__/support/helpers";
import { RepositoryStatus } from "@prisma/client";

const encryptionService = EncryptionService.getInstance();

/**
 * Options for creating webhook test scenario
 */
interface CreateWebhookTestScenarioOptions {
  workspaceId?: string;
  githubWebhookId?: string;
  webhookSecret?: string;
  repositoryUrl?: string;
  branch?: string;
  status?: RepositoryStatus;
}

/**
 * Creates a complete test scenario with user, workspace, swarm, and repository configured for webhook testing
 */
export async function createWebhookTestScenario(options?: CreateWebhookTestScenarioOptions) {
  const {
    workspaceId = generateUniqueId("workspace"),
    githubWebhookId = generateUniqueId("webhook"),
    webhookSecret = "test_webhook_secret_123",
    repositoryUrl = "https://github.com/test-owner/test-repo",
    branch = "main",
    status = RepositoryStatus.SYNCED,
  } = options || {};

  return await db.$transaction(async (tx) => {
    // Create user first (required by foreign key constraint)
    const ownerId = generateUniqueId("user");
    const user = await tx.user.create({
      data: {
        id: ownerId,
        name: "Test User",
        email: `${ownerId}@example.com`,
      },
    });

    // Create workspace with valid owner
    const workspace = await tx.workspace.create({
      data: {
        id: workspaceId,
        name: `Test Workspace ${workspaceId}`,
        slug: `test-workspace-${workspaceId.toLowerCase()}`,
        ownerId: user.id,
      },
    });

    // Create swarm for workspace
    const swarm = await tx.swarm.create({
      data: {
        id: generateUniqueId("swarm"),
        workspaceId: workspace.id,
        name: "test-swarm",
        swarmUrl: "https://test-swarm.sphinx.chat",
        swarmApiKey: JSON.stringify(encryptionService.encryptField("swarmApiKey", "sk_test_swarm_123")),
        agentRequestId: null,
        agentStatus: null,
      },
    });

    // Encrypt webhook secret only if provided (non-null)
    const encryptedSecret = webhookSecret
      ? encryptionService.encryptField("githubWebhookSecret", webhookSecret)
      : null;

    // Create repository with webhook config
    const repository = await tx.repository.create({
      data: {
        id: generateUniqueId("repo"),
        name: "Test Repository",
        workspaceId: workspace.id,
        repositoryUrl,
        branch,
        status,
        githubWebhookId,
        githubWebhookSecret: encryptedSecret ? JSON.stringify(encryptedSecret) : null,
      },
    });

    return {
      user,
      repository,
      workspace,
      swarm,
      webhookSecret, // Return plain secret for test signature generation
    };
  });
}

/**
 * GitHub webhook push event payload structure
 */
interface GitHubPushPayload {
  ref: string;
  repository: {
    html_url: string;
    full_name: string;
    default_branch: string;
  };
  commits?: Array<{
    id: string;
    message: string;
  }>;
}

/**
 * GitHub webhook pull request event payload structure
 */
interface GitHubPullRequestPayload {
  action: string;
  pull_request: {
    html_url: string;
    merged: boolean;
    number: number;
    title: string;
    head: {
      ref: string;
    };
    base: {
      ref: string;
    };
  };
  repository: {
    html_url: string;
    full_name: string;
    default_branch: string;
  };
}

/**
 * Creates a valid GitHub push event payload
 */
export function createGitHubPushPayload(
  ref: string = "refs/heads/main",
  repositoryUrl: string = "https://github.com/test-owner/test-repo",
  fullName: string = "test-owner/test-repo"
): GitHubPushPayload {
  return {
    ref,
    repository: {
      html_url: repositoryUrl,
      full_name: fullName,
      default_branch: "main",
    },
    commits: [
      {
        id: "abc123",
        message: "Test commit",
      },
    ],
  };
}

/**
 * Creates a valid GitHub pull request event payload
 */
export function createGitHubPullRequestPayload(
  action: string = "closed",
  merged: boolean = true,
  prUrl: string = "https://github.com/test-owner/test-repo/pull/123",
  repositoryUrl: string = "https://github.com/test-owner/test-repo",
  fullName: string = "test-owner/test-repo"
): GitHubPullRequestPayload {
  return {
    action,
    pull_request: {
      html_url: prUrl,
      merged,
      number: 123,
      title: "Test PR",
      head: {
        ref: "feature-branch",
      },
      base: {
        ref: "main",
      },
    },
    repository: {
      html_url: repositoryUrl,
      full_name: fullName,
      default_branch: "main",
    },
  };
}

/**
 * Computes a valid webhook signature for testing
 */
export function computeValidWebhookSignature(
  secret: string,
  body: string
): string {
  const hmac = computeHmacSha256Hex(secret, body);
  return `sha256=${hmac}`;
}

/**
 * Creates a NextRequest mock for webhook testing
 */
export function createWebhookRequest(
  url: string,
  payload: GitHubPushPayload,
  signature: string,
  webhookId: string,
  event: string = "push"
): Request {
  const body = JSON.stringify(payload);

  return new Request(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-hub-signature-256": signature,
      "x-github-event": event,
      "x-github-delivery": generateUniqueId("delivery"),
      "x-github-hook-id": webhookId,
    },
    body,
  });
}

/**
 * Creates a NextRequest with missing headers for testing validation
 */
export function createWebhookRequestWithMissingHeaders(
  url: string,
  payload: GitHubPushPayload,
  missingHeader: "signature" | "event" | "hookId"
): Request {
  const body = JSON.stringify(payload);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  // Conditionally add headers based on what should be missing
  if (missingHeader !== "signature") {
    headers["x-hub-signature-256"] = "sha256=test";
  }
  if (missingHeader !== "event") {
    headers["x-github-event"] = "push";
  }
  if (missingHeader !== "hookId") {
    headers["x-github-hook-id"] = "123";
  }

  return new Request(url, {
    method: "POST",
    headers,
    body,
  });
}

/**
 * Mock GitHub webhook event types for testing
 */
export const mockGitHubEvents = {
  push: "push",
  pullRequest: "pull_request",
  issues: "issues",
  release: "release",
};

/**
 * Common branch names for testing branch filtering
 */
export const testBranches = {
  main: "refs/heads/main",
  master: "refs/heads/master",
  develop: "refs/heads/develop",
  feature: "refs/heads/feature/test-feature",
} as const;

/**
 * Test repository URLs for different scenarios
 */
export const testRepositoryUrls = {
  valid: "https://github.com/test-owner/test-repo",
  withGit: "https://github.com/test-owner/test-repo.git",
  different: "https://github.com/another-org/different-repo",
};

/**
 * GitHub App authorization webhook payload structure
 */
interface GitHubAppAuthPayload {
  action: string;
  sender: {
    login: string;
    id: number;
  };
}

/**
 * Creates a GitHub App authorization webhook payload
 */
export function createGitHubAppAuthPayload(
  action: string = "revoked",
  username: string = "test-user"
): GitHubAppAuthPayload {
  return {
    action,
    sender: {
      login: username,
      id: Math.floor(Math.random() * 1000000),
    },
  };
}

/**
 * Creates a NextRequest for GitHub App webhook testing
 */
export function createGitHubAppWebhookRequest(
  url: string,
  payload: GitHubAppAuthPayload,
  signature: string,
  event: string = "github_app_authorization"
): Request {
  const body = JSON.stringify(payload);

  return new Request(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-hub-signature-256": signature,
      "x-github-event": event,
    },
    body,
  });
}

/**
 * Options for creating test user with GitHub auth
 */
interface CreateTestUserWithGitHubAuthOptions {
  githubUsername: string;
  email?: string;
  name?: string;
}

/**
 * Creates a test user with GitHub authentication
 */
export async function createTestUserWithGitHubAuth(
  options: CreateTestUserWithGitHubAuthOptions
) {
  const uniqueId = generateUniqueId("user");
  const { githubUsername, email, name } = options;

  // Check if user already exists
  const existingUser = await db.user.findFirst({
    where: {
      githubAuth: {
        githubUsername,
      },
    },
    include: {
      githubAuth: true,
    },
  });

  if (existingUser) {
    return existingUser;
  }

  // Create user with GitHub auth
  const user = await db.user.create({
    data: {
      name: name || `Test User ${uniqueId}`,
      email: email || `test-${uniqueId}@example.com`,
      githubAuth: {
        create: {
          githubUserId: generateUniqueId("github"),
          githubUsername,
          name: name || `Test User ${uniqueId}`,
          bio: "Test bio",
          publicRepos: 10,
          followers: 5,
        },
      },
    },
    include: {
      githubAuth: true,
    },
  });

  return user;
}

/**
 * Options for creating test source control token
 */
interface CreateTestSourceControlTokenOptions {
  githubLogin?: string;
  installationId?: number;
}

/**
 * Creates a test source control token for a user
 */
export async function createTestSourceControlToken(
  userId: string,
  options?: CreateTestSourceControlTokenOptions
) {
  const { githubLogin, installationId } = options || {};
  const uniqueId = generateUniqueId("org");

  // Create or get source control org
  const org = await db.sourceControlOrg.create({
    data: {
      githubLogin: githubLogin || `test-org-${uniqueId}`,
      githubInstallationId: installationId || Math.floor(Math.random() * 1000000),
      name: `Test Org ${uniqueId}`,
    },
  });

  // Create encrypted token
  const testToken = `ghs_test_token_${uniqueId}`;
  const encryptedToken = JSON.stringify(
    encryptionService.encryptField("access_token", testToken)
  );

  // Create source control token
  const token = await db.sourceControlToken.create({
    data: {
      userId,
      sourceControlOrgId: org.id,
      token: encryptedToken,
      scopes: ["repo", "read:org"],
    },
  });

  return { token, org };
}
