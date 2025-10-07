import { RepositoryStatus } from "@prisma/client";
import type { AsyncSyncResult } from "@/services/swarm/stakgraph-actions";

// Test Data Factories
export const GitHubWebhookTestData = {
  createValidRepository: (overrides = {}) => ({
    id: "repo-123",
    repositoryUrl: "https://github.com/test-org/test-repo",
    branch: "main",
    workspaceId: "workspace-123",
    githubWebhookSecret: JSON.stringify({
      data: "encrypted-secret",
      iv: "iv-123",
      tag: "tag-123",
      keyId: "default",
      version: "1",
      encryptedAt: "2024-01-01T00:00:00.000Z",
    }),
    workspace: {
      swarm: {
        defaultBranch: "main",
      },
    },
    ...overrides,
  }),

  createValidSwarm: (overrides = {}) => ({
    id: "swarm-123",
    name: "test-swarm",
    swarmUrl: "https://test-swarm.sphinx.chat/api",
    swarmApiKey: JSON.stringify({
      data: "encrypted-api-key",
      iv: "iv-456",
      tag: "tag-456",
      keyId: "default",
      version: "1",
      encryptedAt: "2024-01-01T00:00:00.000Z",
    }),
    ...overrides,
  }),

  createValidWorkspace: (overrides = {}) => ({
    id: "workspace-123",
    ownerId: "user-123",
    slug: "test-workspace",
    ...overrides,
  }),

  createWorkspaceWithSlug: (overrides = {}) => ({
    ownerId: "user-123",
    slug: "test-workspace",
    ...overrides,
  }),

  createGithubCredentials: (overrides = {}) => ({
    username: "testuser",
    token: "github_pat_test123",
    ...overrides,
  }),

  createGitHubPushPayload: (overrides = {}) => ({
    ref: "refs/heads/main",
    repository: {
      html_url: "https://github.com/test-org/test-repo",
      full_name: "test-org/test-repo",
      default_branch: "main",
    },
    head_commit: {
      id: "abc123",
      message: "Test commit",
    },
    ...overrides,
  }),

  createAsyncSyncResult: (overrides = {}): AsyncSyncResult => ({
    ok: true,
    status: 200,
    data: {
      request_id: "sync-req-123",
      ...overrides,
    },
  }),
};
