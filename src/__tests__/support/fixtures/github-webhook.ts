import crypto from "crypto";
import { db } from "@/lib/db";
import { RepositoryStatus, WorkspaceRole } from "@prisma/client";
import { EncryptionService } from "@/lib/encryption";
import { NextRequest } from "next/server";

const encryptionService = EncryptionService.getInstance();

/**
 * Creates a complete test environment for webhook testing
 * Includes: User → Workspace → Swarm → Repository with encrypted secrets
 */
export async function createTestRepository(options?: {
  repositoryUrl?: string;
  branch?: string;
  status?: RepositoryStatus;
  webhookSecret?: string;
  swarmApiKey?: string;
}) {
  const webhookSecret = options?.webhookSecret || crypto.randomBytes(32).toString("hex");
  const swarmApiKey = options?.swarmApiKey || `swarm-key-${crypto.randomBytes(16).toString("hex")}`;

  // Create user
  const user = await db.user.create({
    data: {
      email: `test-${Date.now()}@example.com`,
      name: "Test User",
    },
  });

  // Create GitHub auth for user
  await db.gitHubAuth.create({
    data: {
      userId: user.id,
      githubUsername: "testuser",
      githubUserId: Date.now().toString(),
    },
  });

  // Create workspace
  const workspace = await db.workspace.create({
    data: {
      name: `Test Workspace ${Date.now()}`,
      slug: `test-workspace-${Date.now()}`,
      ownerId: user.id,
    },
  });

  // Create workspace membership
  await db.workspaceMember.create({
    data: {
      userId: user.id,
      workspaceId: workspace.id,
      role: WorkspaceRole.OWNER,
    },
  });

  // Encrypt swarm API key
  const encryptedSwarmApiKey = await encryptionService.encryptField(
    "swarmApiKey",
    swarmApiKey
  );

  // Create swarm configuration
  const swarm = await db.swarm.create({
    data: {
      name: `test-swarm-${Date.now()}`,
      workspaceId: workspace.id,
      swarmUrl: "https://test-swarm.example.com",
      swarmApiKey: JSON.stringify(encryptedSwarmApiKey),
    },
  });

  // Encrypt webhook secret
  const encryptedWebhookSecret = await encryptionService.encryptField(
    "githubWebhookSecret",
    webhookSecret
  );

  // Create repository
  const repository = await db.repository.create({
    data: {
      name: "test-repo",
      repositoryUrl: options?.repositoryUrl || "https://github.com/test-org/test-repo",
      branch: options?.branch || "main",
      status: options?.status || RepositoryStatus.SYNCED,
      workspaceId: workspace.id,
      githubWebhookId: `webhook-${Date.now()}`,
      githubWebhookSecret: JSON.stringify(encryptedWebhookSecret),
    },
  });

  return {
    user,
    workspace,
    swarm,
    repository,
    webhookSecret, // Plain text for testing
    swarmApiKey, // Plain text for testing
  };
}

/**
 * Creates a realistic GitHub push event payload
 */
export function createGitHubPushPayload(ref: string, repositoryUrl: string) {
  const [, , owner, repo] = new URL(repositoryUrl).pathname.split("/");

  return {
    ref,
    before: "0000000000000000000000000000000000000000",
    after: "1234567890abcdef1234567890abcdef12345678",
    repository: {
      id: 123456,
      name: repo,
      full_name: `${owner}/${repo}`,
      private: false,
      owner: {
        name: owner,
        email: `${owner}@example.com`,
        login: owner,
      },
      html_url: repositoryUrl,
      description: "Test repository",
      fork: false,
      url: `https://api.github.com/repos/${owner}/${repo}`,
      created_at: "2024-01-01T00:00:00Z",
      updated_at: new Date().toISOString(),
      pushed_at: new Date().toISOString(),
      git_url: `git://github.com/${owner}/${repo}.git`,
      ssh_url: `git@github.com:${owner}/${repo}.git`,
      clone_url: repositoryUrl,
      svn_url: repositoryUrl,
      size: 100,
      stargazers_count: 0,
      watchers_count: 0,
      language: "TypeScript",
      has_issues: true,
      has_projects: true,
      has_downloads: true,
      has_wiki: true,
      has_pages: false,
      forks_count: 0,
      open_issues_count: 0,
      default_branch: "main",
    },
    pusher: {
      name: "testuser",
      email: "testuser@example.com",
    },
    sender: {
      login: "testuser",
      id: 12345,
      avatar_url: "https://github.com/testuser.png",
      url: "https://api.github.com/users/testuser",
      html_url: "https://github.com/testuser",
      type: "User",
    },
    commits: [
      {
        id: "1234567890abcdef1234567890abcdef12345678",
        tree_id: "tree1234567890abcdef1234567890abcdef12345",
        message: "Test commit",
        timestamp: new Date().toISOString(),
        author: {
          name: "Test User",
          email: "testuser@example.com",
          username: "testuser",
        },
        committer: {
          name: "Test User",
          email: "testuser@example.com",
          username: "testuser",
        },
        added: [],
        removed: [],
        modified: ["test-file.ts"],
      },
    ],
    head_commit: {
      id: "1234567890abcdef1234567890abcdef12345678",
      tree_id: "tree1234567890abcdef1234567890abcdef12345",
      message: "Test commit",
      timestamp: new Date().toISOString(),
      author: {
        name: "Test User",
        email: "testuser@example.com",
        username: "testuser",
      },
      committer: {
        name: "Test User",
        email: "testuser@example.com",
        username: "testuser",
      },
      added: [],
      removed: [],
      modified: ["test-file.ts"],
    },
  };
}

/**
 * Creates a realistic GitHub pull request event payload
 */
export function createGitHubPullRequestPayload(
  repositoryUrl: string,
  merged: boolean
) {
  const [, , owner, repo] = new URL(repositoryUrl).pathname.split("/");

  return {
    action: merged ? "closed" : "opened",
    number: 1,
    pull_request: {
      id: 123456,
      number: 1,
      state: merged ? "closed" : "open",
      locked: false,
      title: "Test Pull Request",
      user: {
        login: "testuser",
        id: 12345,
        avatar_url: "https://github.com/testuser.png",
        url: "https://api.github.com/users/testuser",
        html_url: "https://github.com/testuser",
        type: "User",
      },
      body: "Test PR description",
      created_at: "2024-01-01T00:00:00Z",
      updated_at: new Date().toISOString(),
      closed_at: merged ? new Date().toISOString() : null,
      merged_at: merged ? new Date().toISOString() : null,
      merge_commit_sha: merged ? "merge1234567890abcdef1234567890abcdef123" : null,
      merged: merged,
      mergeable: true,
      merged_by: merged
        ? {
            login: "testuser",
            id: 12345,
            avatar_url: "https://github.com/testuser.png",
            url: "https://api.github.com/users/testuser",
            html_url: "https://github.com/testuser",
            type: "User",
          }
        : null,
      head: {
        label: `${owner}:feature-branch`,
        ref: "feature-branch",
        sha: "head1234567890abcdef1234567890abcdef12345",
      },
      base: {
        label: `${owner}:main`,
        ref: "main",
        sha: "base1234567890abcdef1234567890abcdef12345",
      },
      html_url: `${repositoryUrl}/pull/1`,
      diff_url: `${repositoryUrl}/pull/1.diff`,
      patch_url: `${repositoryUrl}/pull/1.patch`,
    },
    repository: {
      id: 123456,
      name: repo,
      full_name: `${owner}/${repo}`,
      private: false,
      owner: {
        login: owner,
        id: 54321,
        avatar_url: `https://github.com/${owner}.png`,
        type: "User",
      },
      html_url: repositoryUrl,
      url: `https://api.github.com/repos/${owner}/${repo}`,
      default_branch: "main",
    },
    sender: {
      login: "testuser",
      id: 12345,
      avatar_url: "https://github.com/testuser.png",
      url: "https://api.github.com/users/testuser",
      html_url: "https://github.com/testuser",
      type: "User",
    },
  };
}

/**
 * Computes valid HMAC-SHA256 signature for webhook verification
 */
export function computeValidWebhookSignature(
  secret: string,
  body: string
): string {
  const hmac = crypto.createHmac("sha256", secret);
  hmac.update(body);
  return `sha256=${hmac.digest("hex")}`;
}

/**
 * Creates a complete webhook request object for testing
 */
export function createWebhookRequest(
  url: string,
  payload: Record<string, unknown>,
  signature: string,
  webhookId: string
): NextRequest {
  const body = JSON.stringify(payload);

  return new NextRequest(`http://localhost:3000${url}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-hub-signature-256": signature,
      "x-github-event": "push",
      "x-github-delivery": `delivery-${Date.now()}`,
      "x-github-hook-id": webhookId,
    },
    body,
  });
}
