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
 * Options for creating test repository with webhook configuration
 */
interface CreateTestRepositoryOptions {
  workspaceId?: string;
  githubWebhookId?: string;
  webhookSecret?: string;
  repositoryUrl?: string;
  branch?: string;
  status?: RepositoryStatus;
}

/**
 * Creates a test repository with webhook configuration
 */
export async function createTestRepository(options?: CreateTestRepositoryOptions) {
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
    const encryptedSecret = webhookSecret ? encryptionService.encryptField("githubWebhookSecret", webhookSecret) : null;

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
 * Creates a valid GitHub push event payload
 */
export function createGitHubPushPayload(
  ref: string = "refs/heads/main",
  repositoryUrl: string = "https://github.com/test-owner/test-repo",
  fullName: string = "test-owner/test-repo",
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
 * Computes a valid webhook signature for testing
 */
export function computeValidWebhookSignature(secret: string, body: string): string {
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
  event: string = "push",
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
  missingHeader: "signature" | "event" | "hookId",
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
  feature: "refs/heads/feature/test",
  hotfix: "refs/heads/hotfix/bug-fix",
};

/**
 * Test repository URLs for different scenarios
 */
export const testRepositoryUrls = {
  valid: "https://github.com/test-owner/test-repo",
  withGit: "https://github.com/test-owner/test-repo.git",
  different: "https://github.com/another-org/different-repo",
};
