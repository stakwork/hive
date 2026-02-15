/**
 * Integration tests for deployment_status webhook with multiple tasks
 * 
 * Tests scenarios:
 * 1. Multiple tasks deployed to staging together
 * 2. Multiple tasks upgraded from staging to production
 * 3. Staging deployment doesn't downgrade production tasks
 * 4. Production deployment upgrades staging tasks
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { db } from "@/lib/db";
import { pusherServer } from "@/lib/pusher";
import { createWebhookTestScenario, computeValidWebhookSignature, createWebhookRequest, createTestSourceControlToken } from "@/__tests__/support/factories/github-webhook.factory";
import { createTestTask, createTestChatMessage, createTestArtifact } from "@/__tests__/support/factories/task.factory";
import { resetDatabase } from "@/__tests__/support/utilities/database";

// IMPORTANT: Mock Octokit BEFORE importing the route handler (for dynamic imports)
// Create mock at module level so it persists across all Octokit instances
const mockCompareCommits = vi.fn();

vi.mock("@octokit/rest", () => {
  return {
    Octokit: vi.fn(() => ({
      repos: {
        compareCommits: mockCompareCommits,
      },
    })),
    // Export mock for access in tests
    __mockCompareCommits: mockCompareCommits,
  };
});

// Mock GitHub App tokens
vi.mock("@/lib/githubApp", () => {
  const mockGetUserAppTokens = vi.fn();
  return {
    getUserAppTokens: mockGetUserAppTokens,
    __mockGetUserAppTokens: mockGetUserAppTokens,
  };
});

// Mock getGithubUsernameAndPAT for credentials check
vi.mock("@/lib/auth/nextauth", async () => {
  const actual = await vi.importActual("@/lib/auth/nextauth");
  const mockGetGithubUsernameAndPAT = vi.fn();
  return {
    ...actual,
    getGithubUsernameAndPAT: mockGetGithubUsernameAndPAT,
    __mockGetGithubUsernameAndPAT: mockGetGithubUsernameAndPAT,
  };
});

// Mock Pusher
vi.mock("@/lib/pusher", () => ({
  pusherServer: {
    trigger: vi.fn().mockResolvedValue(undefined),
  },
  getWorkspaceChannelName: (slug: string) => `workspace-${slug}`,
  getTaskChannelName: (taskId: string) => `task-${taskId}`,
  PUSHER_EVENTS: {
    DEPLOYMENT_STATUS_CHANGE: "deployment-status-change",
  },
}));

// Import route handler AFTER all mocks are set up
import { POST } from "@/app/api/github/webhook/[workspaceId]/route";

// Get mock references from the mocked modules
import * as githubAppModule from "@/lib/githubApp";
import * as nextauthModule from "@/lib/auth/nextauth";

const mockGetUserAppTokens = (githubAppModule as any).__mockGetUserAppTokens;
const mockGetGithubUsernameAndPAT = (nextauthModule as any).__mockGetGithubUsernameAndPAT;

describe("Deployment Webhook - Multiple Tasks", () => {
  let testSetup: any;
  let task1: any;
  let task2: any;
  let task3: any;

  beforeEach(async () => {
    await resetDatabase();
    
    // Explicitly clean up deployment records for test isolation
    await db.deployment.deleteMany({});
    
    // Add small delay to ensure database operations are fully committed
    await new Promise(resolve => setTimeout(resolve, 50));
    
    // Clear mock call history and re-setup implementations
    mockCompareCommits.mockClear();
    mockCompareCommits.mockResolvedValue({
      data: {
        commits: [
          { sha: "commit1sha" },
          { sha: "commit2sha" },
          { sha: "commit3sha" },
        ],
      },
    });

    mockGetUserAppTokens.mockClear();
    mockGetUserAppTokens.mockResolvedValue({
      accessToken: "test-token",
    });

    mockGetGithubUsernameAndPAT.mockClear();
    mockGetGithubUsernameAndPAT.mockResolvedValue({
      username: "test-user",
      token: "test-github-pat",
    });

    // Create test scenario
    testSetup = await createWebhookTestScenario();

    // Create workspace member - this is critical for the webhook handler to find workspace users
    await db.workspaceMember.create({
      data: {
        userId: testSetup.user.id,
        workspaceId: testSetup.workspace.id,
        role: "OWNER",
      },
    });
    
    // Note: We're mocking getUserAppTokens and getGithubUsernameAndPAT at the module level,
    // so we don't need to create actual source control tokens in the database

    // Create three tasks with PR artifacts (different commit SHAs)
    task1 = await createTestTask({ 
      workspaceId: testSetup.workspace.id, 
      repositoryId: testSetup.repository.id,
      createdById: testSetup.user.id,
      status: "DONE",
    });

    task2 = await createTestTask({ 
      workspaceId: testSetup.workspace.id, 
      repositoryId: testSetup.repository.id,
      createdById: testSetup.user.id,
      status: "DONE",
    });

    task3 = await createTestTask({ 
      workspaceId: testSetup.workspace.id, 
      repositoryId: testSetup.repository.id,
      createdById: testSetup.user.id,
      status: "DONE",
    });

    // Create chat messages and PR artifacts for each task
    const message1 = await createTestChatMessage({ taskId: task1.id, message: "PR created" });
    await createTestArtifact({
      messageId: message1.id,
      type: "PULL_REQUEST",
      content: {
        url: "https://github.com/testowner/testrepo/pull/1",
        merge_commit_sha: "commit1sha",
        status: "MERGED",
      },
    });

    const message2 = await createTestChatMessage({ taskId: task2.id, message: "PR created" });
    await createTestArtifact({
      messageId: message2.id,
      type: "PULL_REQUEST",
      content: {
        url: "https://github.com/testowner/testrepo/pull/2",
        merge_commit_sha: "commit2sha",
        status: "MERGED",
      },
    });

    const message3 = await createTestChatMessage({ taskId: task3.id, message: "PR created" });
    await createTestArtifact({
      messageId: message3.id,
      type: "PULL_REQUEST",
      content: {
        url: "https://github.com/testowner/testrepo/pull/3",
        merge_commit_sha: "commit3sha",
        status: "MERGED",
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const createDeploymentStatusPayload = (
    commitSha: string,
    environment: string,
    state: string
  ) => ({
    deployment_status: {
      state,
      target_url: `https://vercel.com/deployment/${commitSha}`,
      environment_url: `https://app.example.com`,
    },
    deployment: {
      id: 123456,
      sha: commitSha,
      environment,
      ref: "main",
    },
    repository: {
      html_url: testSetup.repository.repositoryUrl,
      full_name: "test-owner/test-repo",
      name: "test-repo",
      owner: {
        login: "test-owner",
      },
    },
  });

  it("should deploy multiple tasks to staging when commit range includes all", async () => {
    // Create a previous deployment to establish baseline for comparison
    await db.deployment.create({
      data: {
        taskId: task1.id,
        repositoryId: testSetup.repository.id,
        commitSha: "commit0sha", // Older commit before our 3 tasks
        environment: "STAGING",
        status: "SUCCESS",
        startedAt: new Date("2024-01-01"),
        completedAt: new Date("2024-01-01"),
      },
    });

    const payload = createDeploymentStatusPayload("commit3sha", "staging", "success");
    const signature = computeValidWebhookSignature(
      testSetup.webhookSecret,
      JSON.stringify(payload)
    );

    const request = createWebhookRequest(
      `http://localhost/api/github/webhook/${testSetup.workspace.id}`,
      payload,
      signature,
      testSetup.repository.githubWebhookId!,
      "deployment_status"
    );

    const response = await POST(request, { params: { workspaceId: testSetup.workspace.id } });
    expect(response.status).toBe(202);

    // Verify all 3 tasks updated to staging
    const updatedTask1 = await db.task.findUnique({ where: { id: task1.id } });
    const updatedTask2 = await db.task.findUnique({ where: { id: task2.id } });
    const updatedTask3 = await db.task.findUnique({ where: { id: task3.id } });

    expect(updatedTask1?.deploymentStatus).toBe("staging");
    expect(updatedTask2?.deploymentStatus).toBe("staging");
    expect(updatedTask3?.deploymentStatus).toBe("staging");

    expect(updatedTask1?.deployedToStagingAt).toBeTruthy();
    expect(updatedTask2?.deployedToStagingAt).toBeTruthy();
    expect(updatedTask3?.deployedToStagingAt).toBeTruthy();

    // Verify deployment records created (should have 4 total: 1 previous + 3 new)
    const deployments = await db.deployment.findMany({
      where: { 
        repositoryId: testSetup.repository.id,
        commitSha: { in: ["commit1sha", "commit2sha", "commit3sha"] },
      },
    });
    expect(deployments.length).toBe(3);
    expect(deployments.every((d) => d.environment === "STAGING")).toBe(true);
    expect(deployments.every((d) => d.status === "SUCCESS")).toBe(true);
  });

  it("should upgrade multiple tasks from staging to production", async () => {
    // Create previous staging deployment for baseline
    await db.deployment.create({
      data: {
        taskId: task1.id,
        repositoryId: testSetup.repository.id,
        commitSha: "commit0sha",
        environment: "STAGING",
        status: "SUCCESS",
        startedAt: new Date("2024-01-01"),
        completedAt: new Date("2024-01-01"),
      },
    });

    // First deploy to staging
    await db.task.update({
      where: { id: task1.id },
      data: {
        deploymentStatus: "staging",
        deployedToStagingAt: new Date("2024-01-01"),
      },
    });

    await db.task.update({
      where: { id: task2.id },
      data: {
        deploymentStatus: "staging",
        deployedToStagingAt: new Date("2024-01-01"),
      },
    });

    await db.task.update({
      where: { id: task3.id },
      data: {
        deploymentStatus: "staging",
        deployedToStagingAt: new Date("2024-01-01"),
      },
    });

    // Now deploy to production
    const payload = createDeploymentStatusPayload("commit3sha", "production", "success");
    const signature = computeValidWebhookSignature(
      testSetup.webhookSecret,
      JSON.stringify(payload)
    );

    const request = createWebhookRequest(
      `http://localhost/api/github/webhook/${testSetup.workspace.id}`,
      payload,
      signature,
      testSetup.repository.githubWebhookId!,
      "deployment_status"
    );

    const response = await POST(request, { params: { workspaceId: testSetup.workspace.id } });
    expect(response.status).toBe(202);

    // Wait for webhook processing to complete
    await new Promise(resolve => setTimeout(resolve, 500));

    // Query tasks - they should be updated to production
    const updatedTask1 = await db.task.findUnique({
      where: { id: task1.id },
      select: { deploymentStatus: true, deployedToProductionAt: true, deployedToStagingAt: true },
    });
    const updatedTask2 = await db.task.findUnique({
      where: { id: task2.id },
      select: { deploymentStatus: true, deployedToProductionAt: true, deployedToStagingAt: true },
    });
    const updatedTask3 = await db.task.findUnique({
      where: { id: task3.id },
      select: { deploymentStatus: true, deployedToProductionAt: true, deployedToStagingAt: true },
    });

    expect(updatedTask1?.deploymentStatus).toBe("production");
    expect(updatedTask2?.deploymentStatus).toBe("production");
    expect(updatedTask3?.deploymentStatus).toBe("production");

    expect(updatedTask1?.deployedToProductionAt).toBeTruthy();
    expect(updatedTask2?.deployedToProductionAt).toBeTruthy();
    expect(updatedTask3?.deployedToProductionAt).toBeTruthy();

    // Staging timestamps should still exist
    expect(updatedTask1?.deployedToStagingAt).toEqual(new Date("2024-01-01"));
    expect(updatedTask2?.deployedToStagingAt).toEqual(new Date("2024-01-01"));
    expect(updatedTask3?.deployedToStagingAt).toEqual(new Date("2024-01-01"));
  });

  it("should NOT downgrade production tasks to staging", async () => {
    // Set task1 and task2 to production, task3 stays at null
    await db.task.update({
      where: { id: task1.id },
      data: {
        deploymentStatus: "production",
        deployedToProductionAt: new Date(),
      },
    });

    await db.task.update({
      where: { id: task2.id },
      data: {
        deploymentStatus: "production",
        deployedToProductionAt: new Date(),
      },
    });

    // Deploy to staging (should only update task3, skip task1 and task2)
    const payload = createDeploymentStatusPayload("commit3sha", "staging", "success");
    const signature = computeValidWebhookSignature(
      testSetup.webhookSecret,
      JSON.stringify(payload)
    );

    const request = createWebhookRequest(
      `http://localhost/api/github/webhook/${testSetup.workspace.id}`,
      payload,
      signature,
      testSetup.repository.githubWebhookId!,
      "deployment_status"
    );

    const response = await POST(request, { params: { workspaceId: testSetup.workspace.id } });
    expect(response.status).toBe(202);

    // Verify task1 and task2 still in production
    const updatedTask1 = await db.task.findUnique({ where: { id: task1.id } });
    const updatedTask2 = await db.task.findUnique({ where: { id: task2.id } });
    const updatedTask3 = await db.task.findUnique({ where: { id: task3.id } });

    expect(updatedTask1?.deploymentStatus).toBe("production");
    expect(updatedTask2?.deploymentStatus).toBe("production");
    expect(updatedTask3?.deploymentStatus).toBe("staging");
  });

  it("should handle task with staging status being upgraded to production", async () => {
    // Create baseline staging deployment at commit0
    await db.deployment.create({
      data: {
        taskId: task1.id,
        repositoryId: testSetup.repository.id,
        commitSha: "commit0sha",
        environment: "STAGING",
        status: "SUCCESS",
        startedAt: new Date("2024-01-01"),
        completedAt: new Date("2024-01-01"),
      },
    });

    // Set task1 to staging
    await db.task.update({
      where: { id: task1.id },
      data: {
        deploymentStatus: "staging",
        deployedToStagingAt: new Date("2024-01-01"),
      },
    });

    // Deploy commit3sha to production (should find all commits from commit0 to commit3)
    const payload = createDeploymentStatusPayload("commit3sha", "production", "success");
    const signature = computeValidWebhookSignature(
      testSetup.webhookSecret,
      JSON.stringify(payload)
    );

    const request = createWebhookRequest(
      `http://localhost/api/github/webhook/${testSetup.workspace.id}`,
      payload,
      signature,
      testSetup.repository.githubWebhookId!,
      "deployment_status"
    );

    const response = await POST(request, { params: { workspaceId: testSetup.workspace.id } });
    expect(response.status).toBe(202);

    // Add delay to ensure webhook processing completes
    await new Promise(resolve => setTimeout(resolve, 100));

    // Poll database until update completes (max 3 seconds)
    let updatedTask1: any;
    const maxAttempts = 30;
    let attempts = 0;
    
    while (attempts < maxAttempts) {
      // Use findUnique to let Prisma handle caching properly
      updatedTask1 = await db.task.findUnique({
        where: { id: task1.id },
        select: {
          id: true,
          deploymentStatus: true,
          deployedToProductionAt: true,
          deployedToStagingAt: true,
        },
      });
      
      if (updatedTask1?.deploymentStatus === "production") {
        break;
      }
      
      await new Promise(resolve => setTimeout(resolve, 100));
      attempts++;
    }

    // Verify task1 upgraded from staging to production
    expect(updatedTask1?.deploymentStatus).toBe("production");
    expect(updatedTask1?.deployedToProductionAt).toBeTruthy();
    
    // Should preserve staging timestamp
    expect(updatedTask1?.deployedToStagingAt).toEqual(new Date("2024-01-01"));
  });

  it("should create deployment records even for failed deployments", async () => {
    const payload = createDeploymentStatusPayload("commit3sha", "staging", "failure");
    const signature = computeValidWebhookSignature(
      testSetup.webhookSecret,
      JSON.stringify(payload)
    );

    const request = createWebhookRequest(
      `http://localhost/api/github/webhook/${testSetup.workspace.id}`,
      payload,
      signature,
      testSetup.repository.githubWebhookId!,
      "deployment_status"
    );

    const response = await POST(request, { params: { workspaceId: testSetup.workspace.id } });
    expect(response.status).toBe(202);

    // Deployment records should be created even for failures
    const deployments = await db.deployment.findMany({
      where: { repositoryId: testSetup.repository.id },
    });
    expect(deployments.length).toBeGreaterThan(0);
    expect(deployments.every((d) => d.status === "FAILURE")).toBe(true);

    // Tasks should NOT be updated (only on success)
    const updatedTask1 = await db.task.findUnique({ where: { id: task1.id } });
    const updatedTask2 = await db.task.findUnique({ where: { id: task2.id } });

    expect(updatedTask1?.deploymentStatus).toBeNull();
    expect(updatedTask2?.deploymentStatus).toBeNull();
  });
});
