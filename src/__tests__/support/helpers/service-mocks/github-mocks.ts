/**
 * GitHub Mock Utilities for Integration Tests
 * 
 * Provides helper functions to set up GitHub API mocks in tests.
 * Works with the mock state manager and endpoints.
 */

import { mockGitHubState } from "@/lib/mock/github-state";

/**
 * Reset GitHub mock state between tests
 */
export function resetGitHubMockState() {
  mockGitHubState.reset();
}

/**
 * Create a complete GitHub OAuth flow mock for testing
 */
export interface MockGitHubOAuthFlowOptions {
  code: string;
  owner: string;
  repoName?: string;
  scope?: string;
  hasInstallation?: boolean;
}

export function setupMockGitHubOAuthFlow({
  code = "test_code_123",
  owner = "test-owner",
  repoName = "test-repo",
  scope = "repo,user,read:org",
  hasInstallation = true,
}: Partial<MockGitHubOAuthFlowOptions> = {}) {
  // Create user
  const user = mockGitHubState.createUser(owner, "User");
  
  // Create token
  const token = mockGitHubState.createToken(code, scope);
  
  // Create installation if requested
  let installation;
  if (hasInstallation) {
    installation = mockGitHubState.createInstallation(owner);
  }
  
  // Create repository
  const repository = mockGitHubState.createRepository(owner, repoName);
  
  return {
    user,
    token,
    installation,
    repository,
  };
}

/**
 * Create a mock repository with branches and commits
 */
export interface MockRepositoryOptions {
  owner: string;
  name: string;
  isPrivate?: boolean;
  defaultBranch?: string;
  additionalBranches?: string[];
  commitCount?: number;
}

export function setupMockRepository({
  owner,
  name,
  isPrivate = false,
  defaultBranch = "main",
  additionalBranches = [],
  commitCount = 10,
}: MockRepositoryOptions) {
  // Create repository
  const repository = mockGitHubState.createRepository(owner, name, isPrivate, defaultBranch);
  
  // Create additional branches
  for (const branchName of additionalBranches) {
    mockGitHubState.createBranch(owner, name, branchName, false);
  }
  
  // Create commits
  const commits = mockGitHubState.createCommits(owner, name, commitCount);
  
  return {
    repository,
    commits,
  };
}

/**
 * Create a mock webhook for a repository
 */
export interface MockWebhookOptions {
  owner: string;
  repo: string;
  url: string;
  events?: string[];
  secret?: string;
}

export function setupMockWebhook({
  owner,
  repo,
  url,
  events = ["push"],
  secret,
}: MockWebhookOptions) {
  // Ensure repository exists
  let repository = mockGitHubState.getRepository(owner, repo);
  if (!repository) {
    repository = mockGitHubState.createRepository(owner, repo);
  }
  
  const webhook = mockGitHubState.createWebhook(
    owner,
    repo,
    {
      url,
      content_type: "json",
      insecure_ssl: "0",
      secret,
    },
    events
  );
  
  return webhook;
}

/**
 * Setup a complete GitHub scenario for testing
 */
export interface MockGitHubScenarioOptions {
  owner: string;
  repoName: string;
  installationId?: number;
  hasWebhook?: boolean;
  webhookUrl?: string;
}

export function setupMockGitHubScenario({
  owner = "test-owner",
  repoName = "test-repo",
  hasWebhook = false,
  webhookUrl = "https://example.com/webhook",
}: Partial<MockGitHubScenarioOptions> = {}) {
  // Create user
  const user = mockGitHubState.createUser(owner, "User");
  
  // Create installation
  const installation = mockGitHubState.createInstallation(owner);
  
  // Create repository with branches and commits
  const repository = mockGitHubState.createRepository(owner, repoName);
  const commits = mockGitHubState.createCommits(owner, repoName);
  const branches = mockGitHubState.getBranches(owner, repoName);
  
  // Optionally create webhook
  let webhook;
  if (hasWebhook && webhookUrl) {
    webhook = mockGitHubState.createWebhook(owner, repoName, {
      url: webhookUrl,
      content_type: "json",
      insecure_ssl: "0",
    });
  }
  
  return {
    user,
    installation,
    repository,
    commits,
    branches,
    webhook,
  };
}

/**
 * Create a mock user search result
 */
export function setupMockUserSearch(usernames: string[]) {
  return usernames.map(username => mockGitHubState.createUser(username, "User"));
}

/**
 * Get all mock data for debugging
 */
export function getMockGitHubState() {
  return {
    // Note: These are internal, but useful for debugging in tests
    resetState: () => mockGitHubState.reset(),
  };
}
