import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { db } from "@/lib/db";
import { createWebhookTestScenario, computeValidWebhookSignature, createWebhookRequest } from "@/__tests__/support/factories/github-webhook.factory";
import { createTestTask, createTestChatMessage, createTestArtifact } from "@/__tests__/support/factories/task.factory";
import { resetDatabase } from "@/__tests__/support/utilities/database";

// Mock Octokit before importing the route handler
const mockCompareCommits = vi.fn().mockResolvedValue({
  data: {
    commits: [
      { sha: "abc123def456" },
    ],
  },
});

vi.mock("@octokit/rest", () => ({
  Octokit: vi.fn().mockImplementation(() => ({
    repos: {
      compareCommits: mockCompareCommits,
    },
  })),
}));

vi.mock("@/lib/githubApp", () => ({
  getUserAppTokens: vi.fn().mockResolvedValue({
    accessToken: "test-token",
  }),
}));

vi.mock("@/lib/pusher", () => ({
  pusherServer: {
    trigger: vi.fn().mockResolvedValue({}),
  },
  getWorkspaceChannelName: (slug: string) => `workspace-${slug}`,
  getTaskChannelName: (taskId: string) => `task-${taskId}`,
  PUSHER_EVENTS: {
    DEPLOYMENT_STATUS_CHANGE: "deployment-status-change",
  },
}));

// Import route handler AFTER all mocks are set up
import { POST } from "@/app/api/github/webhook/[workspaceId]/route";
import { pusherServer } from "@/lib/pusher";

describe("POST /api/github/webhook/[workspaceId] - deployment_status", () => {
  const COMMIT_SHA = "abc123def456";

  beforeEach(async () => {
    await resetDatabase();
    // Explicitly clean up deployment records for test isolation
    await db.deployment.deleteMany({});
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const createDeploymentStatusPayload = (
    state: string,
    environment: string,
    sha: string = COMMIT_SHA,
    repositoryUrl?: string,
  ) => ({
    deployment_status: {
      state,
      target_url: "https://deploy.example.com/abc123",
      environment_url: "https://staging.example.com",
    },
    deployment: {
      id: 12345,
      sha,
      environment,
    },
    repository: {
      html_url: repositoryUrl || "https://github.com/test-owner/test-repo",
      full_name: "test-owner/test-repo",
      name: "test-repo",
      owner: {
        login: "test-owner",
      },
    },
  });

  it("should process deployment_status webhook with staging success", async () => {
    // Setup
    const testSetup = await createWebhookTestScenario();
    const task = await createTestTask({ 
      workspaceId: testSetup.workspace.id, 
      repositoryId: testSetup.repository.id,
      createdById: testSetup.user.id 
    });
    const message = await createTestChatMessage({ taskId: task.id, message: "Test message" });
    await createTestArtifact({
      messageId: message.id,
      type: "PULL_REQUEST",
      content: {
        url: "https://github.com/owner/repo/pull/1",
        merge_commit_sha: COMMIT_SHA,
        status: "DONE",
      },
    });

    const payload = createDeploymentStatusPayload("success", "staging");
    const signature = computeValidWebhookSignature(
      testSetup.webhookSecret,
      JSON.stringify(payload)
    );

    // Execute
    const request = createWebhookRequest(
      `http://localhost/api/github/webhook/${testSetup.workspace.id}`,
      payload,
      signature,
      testSetup.repository.githubWebhookId!,
      "deployment_status"
    );

    const response = await POST(request, { params: { workspaceId: testSetup.workspace.id } });

    // Assert
    expect(response.status).toBe(202);
    
    const updatedTask = await db.task.findUnique({
      where: { id: task.id },
      select: { deploymentStatus: true, deployedToStagingAt: true },
    });
    expect(updatedTask?.deploymentStatus).toBe("staging");
    expect(updatedTask?.deployedToStagingAt).toBeTruthy();

    const deployment = await db.deployment.findFirst({
      where: { taskId: task.id },
    });
    expect(deployment).toBeTruthy();
    expect(deployment?.environment).toBe("STAGING");
    expect(deployment?.status).toBe("SUCCESS");
    expect(deployment?.deploymentUrl).toBe("https://deploy.example.com/abc123");

    // Verify Pusher was called
    // Verify Pusher was called for both workspace and task channels
    expect(pusherServer.trigger).toHaveBeenCalledWith(
      `workspace-${testSetup.workspace.slug}`,
      "deployment-status-change",
      expect.objectContaining({
        taskId: task.id,
        deploymentStatus: "staging",
        environment: "staging",
      })
    );
    expect(pusherServer.trigger).toHaveBeenCalledWith(
      `task-${task.id}`,
      "deployment-status-change",
      expect.objectContaining({
        taskId: task.id,
        deploymentStatus: "staging",
        environment: "staging",
      })
    );
  });

  it("should process deployment_status webhook with production success", async () => {
    // Setup
    const testSetup = await createWebhookTestScenario();
    const task = await createTestTask({ 
      workspaceId: testSetup.workspace.id, 
      repositoryId: testSetup.repository.id,
      createdById: testSetup.user.id 
    });
    const message = await createTestChatMessage({ taskId: task.id, message: "Test message" });
    await createTestArtifact({
      messageId: message.id,
      type: "PULL_REQUEST",
      content: {
        url: "https://github.com/owner/repo/pull/1",
        merge_commit_sha: COMMIT_SHA,
        status: "DONE",
      },
    });

    const payload = createDeploymentStatusPayload("success", "production");
    const signature = computeValidWebhookSignature(
      testSetup.webhookSecret,
      JSON.stringify(payload)
    );

    // Execute
    const request = createWebhookRequest(
      `http://localhost/api/github/webhook/${testSetup.workspace.id}`,
      payload,
      signature,
      testSetup.repository.githubWebhookId!,
      "deployment_status"
    );

    const response = await POST(request, { params: { workspaceId: testSetup.workspace.id } });

    // Assert
    expect(response.status).toBe(202);
    
    const updatedTask = await db.task.findUnique({
      where: { id: task.id },
      select: { deploymentStatus: true, deployedToProductionAt: true },
    });
    expect(updatedTask?.deploymentStatus).toBe("production");
    expect(updatedTask?.deployedToProductionAt).toBeTruthy();

    const deployment = await db.deployment.findFirst({
      where: { taskId: task.id },
    });
    expect(deployment).toBeTruthy();
    expect(deployment?.environment).toBe("PRODUCTION");
    expect(deployment?.status).toBe("SUCCESS");
  });

  it("should ignore deployment_status for non-tracked environments", async () => {
    // Setup
    const testSetup = await createWebhookTestScenario();
    const task = await createTestTask({ 
      workspaceId: testSetup.workspace.id, 
      repositoryId: testSetup.repository.id,
      createdById: testSetup.user.id 
    });
    const message = await createTestChatMessage({ taskId: task.id, message: "Test message" });
    await createTestArtifact({
      messageId: message.id,
      type: "PULL_REQUEST",
      content: {
        url: "https://github.com/owner/repo/pull/1",
        merge_commit_sha: COMMIT_SHA,
        status: "DONE",
      },
    });

    const payload = createDeploymentStatusPayload("success", "development");
    const signature = computeValidWebhookSignature(
      testSetup.webhookSecret,
      JSON.stringify(payload)
    );

    // Execute
    const request = createWebhookRequest(
      `http://localhost/api/github/webhook/${testSetup.workspace.id}`,
      payload,
      signature,
      testSetup.repository.githubWebhookId!,
      "deployment_status"
    );

    const response = await POST(request, { params: { workspaceId: testSetup.workspace.id } });

    // Assert
    expect(response.status).toBe(202);
    
    const updatedTask = await db.task.findUnique({
      where: { id: task.id },
      select: { deploymentStatus: true, deployedToStagingAt: true, deployedToProductionAt: true },
    });
    expect(updatedTask?.deploymentStatus).toBeNull();
    expect(updatedTask?.deployedToStagingAt).toBeNull();
    expect(updatedTask?.deployedToProductionAt).toBeNull();

    const deployment = await db.deployment.findFirst({
      where: { taskId: task.id },
    });
    expect(deployment).toBeNull();

    // Verify Pusher was NOT called
    expect(pusherServer.trigger).not.toHaveBeenCalled();
  });

  it("should update multiple tasks with the same commit SHA", async () => {
    // Setup
    const testSetup = await createWebhookTestScenario();
    
    const task1 = await createTestTask({ 
      workspaceId: testSetup.workspace.id, 
      repositoryId: testSetup.repository.id,
      createdById: testSetup.user.id 
    });
    const message1 = await createTestChatMessage({ taskId: task1.id, message: "Test message 1" });
    await createTestArtifact({
      messageId: message1.id,
      type: "PULL_REQUEST",
      content: {
        url: "https://github.com/owner/repo/pull/1",
        merge_commit_sha: COMMIT_SHA,
        status: "DONE",
      },
    });

    const task2 = await createTestTask({ 
      workspaceId: testSetup.workspace.id, 
      repositoryId: testSetup.repository.id,
      createdById: testSetup.user.id 
    });
    const message2 = await createTestChatMessage({ taskId: task2.id, message: "Test message 2" });
    await createTestArtifact({
      messageId: message2.id,
      type: "PULL_REQUEST",
      content: {
        url: "https://github.com/owner/repo/pull/2",
        merge_commit_sha: COMMIT_SHA,
        status: "DONE",
      },
    });

    const payload = createDeploymentStatusPayload("success", "staging");
    const signature = computeValidWebhookSignature(
      testSetup.webhookSecret,
      JSON.stringify(payload)
    );

    // Execute
    const request = createWebhookRequest(
      `http://localhost/api/github/webhook/${testSetup.workspace.id}`,
      payload,
      signature,
      testSetup.repository.githubWebhookId!,
      "deployment_status"
    );

    const response = await POST(request, { params: { workspaceId: testSetup.workspace.id } });

    // Assert
    expect(response.status).toBe(202);
    
    const updatedTask1 = await db.task.findUnique({
      where: { id: task1.id },
      select: { deploymentStatus: true },
    });
    expect(updatedTask1?.deploymentStatus).toBe("staging");

    const updatedTask2 = await db.task.findUnique({
      where: { id: task2.id },
      select: { deploymentStatus: true },
    });
    expect(updatedTask2?.deploymentStatus).toBe("staging");

    const deployments = await db.deployment.findMany({
      where: { 
        taskId: { in: [task1.id, task2.id] }
      },
    });
    expect(deployments).toHaveLength(2);

    // Verify Pusher was called for both tasks (2 channels per task: workspace + task)
    expect(pusherServer.trigger).toHaveBeenCalledTimes(4);
  });

  it("should handle failed deployments", async () => {
    // Setup
    const testSetup = await createWebhookTestScenario();
    const task = await createTestTask({ 
      workspaceId: testSetup.workspace.id, 
      repositoryId: testSetup.repository.id,
      createdById: testSetup.user.id 
    });
    const message = await createTestChatMessage({ taskId: task.id, message: "Test message" });
    await createTestArtifact({
      messageId: message.id,
      type: "PULL_REQUEST",
      content: {
        url: "https://github.com/owner/repo/pull/1",
        merge_commit_sha: COMMIT_SHA,
        status: "DONE",
      },
    });

    const payload = createDeploymentStatusPayload("failure", "staging");
    const signature = computeValidWebhookSignature(
      testSetup.webhookSecret,
      JSON.stringify(payload)
    );

    // Execute
    const request = createWebhookRequest(
      `http://localhost/api/github/webhook/${testSetup.workspace.id}`,
      payload,
      signature,
      testSetup.repository.githubWebhookId!,
      "deployment_status"
    );

    const response = await POST(request, { params: { workspaceId: testSetup.workspace.id } });

    // Assert
    expect(response.status).toBe(202);
    
    const deployment = await db.deployment.findFirst({
      where: { taskId: task.id },
    });
    expect(deployment).toBeTruthy();
    expect(deployment?.status).toBe("FAILURE");
    expect(deployment?.completedAt).toBeTruthy();
    
    // Task status should NOT be updated for failures
    const updatedTask = await db.task.findUnique({
      where: { id: task.id },
      select: { deploymentStatus: true },
    });
    expect(updatedTask?.deploymentStatus).toBeNull();
    
    // Verify Pusher was NOT called for failures
    expect(pusherServer.trigger).not.toHaveBeenCalled();
  });

  it("should handle in-progress deployments", async () => {
    // Setup
    const testSetup = await createWebhookTestScenario();
    const task = await createTestTask({ 
      workspaceId: testSetup.workspace.id, 
      repositoryId: testSetup.repository.id,
      createdById: testSetup.user.id 
    });
    const message = await createTestChatMessage({ taskId: task.id, message: "Test message" });
    await createTestArtifact({
      messageId: message.id,
      type: "PULL_REQUEST",
      content: {
        url: "https://github.com/owner/repo/pull/1",
        merge_commit_sha: COMMIT_SHA,
        status: "DONE",
      },
    });

    const payload = createDeploymentStatusPayload("in_progress", "staging");
    const signature = computeValidWebhookSignature(
      testSetup.webhookSecret,
      JSON.stringify(payload)
    );

    // Execute
    const request = createWebhookRequest(
      `http://localhost/api/github/webhook/${testSetup.workspace.id}`,
      payload,
      signature,
      testSetup.repository.githubWebhookId!,
      "deployment_status"
    );

    const response = await POST(request, { params: { workspaceId: testSetup.workspace.id } });

    // Assert
    expect(response.status).toBe(202);
    
    const deployment = await db.deployment.findFirst({
      where: { taskId: task.id },
    });
    expect(deployment).toBeTruthy();
    expect(deployment?.status).toBe("IN_PROGRESS");
    expect(deployment?.completedAt).toBeNull();
  });

  it("should handle deployment_status with no matching tasks", async () => {
    // Setup
    const testSetup = await createWebhookTestScenario();

    const payload = createDeploymentStatusPayload("success", "staging", "non-existent-sha");
    const signature = computeValidWebhookSignature(
      testSetup.webhookSecret,
      JSON.stringify(payload)
    );

    // Execute
    const request = createWebhookRequest(
      `http://localhost/api/github/webhook/${testSetup.workspace.id}`,
      payload,
      signature,
      testSetup.repository.githubWebhookId!,
      "deployment_status"
    );

    const response = await POST(request, { params: { workspaceId: testSetup.workspace.id } });

    // Assert
    expect(response.status).toBe(202);
    
    const deployments = await db.deployment.findMany();
    expect(deployments).toHaveLength(0);

    // Verify Pusher was NOT called
    expect(pusherServer.trigger).not.toHaveBeenCalled();
  });

  it("should verify webhook signature", async () => {
    // Setup
    const testSetup = await createWebhookTestScenario();

    const payload = createDeploymentStatusPayload("success", "staging");
    
    // Create invalid signature
    const invalidSignature = computeValidWebhookSignature(
      "wrong-secret",
      JSON.stringify(payload)
    );

    // Execute
    const request = createWebhookRequest(
      `http://localhost/api/github/webhook/${testSetup.workspace.id}`,
      payload,
      invalidSignature,
      testSetup.repository.githubWebhookId!,
      "deployment_status"
    );

    const response = await POST(request, { params: { workspaceId: testSetup.workspace.id } });

    // Assert
    expect(response.status).toBe(401);
  });

  it("should include deployment fields in task query for task list display", async () => {
    // Setup
    const testSetup = await createWebhookTestScenario();
    const task = await createTestTask({ 
      workspaceId: testSetup.workspace.id,
      repositoryId: testSetup.repository.id,
      createdById: testSetup.user.id 
    });
    const message = await createTestChatMessage({ taskId: task.id, message: "Test message" });
    await createTestArtifact({
      messageId: message.id,
      type: "PULL_REQUEST",
      content: {
        url: "https://github.com/owner/repo/pull/1",
        merge_commit_sha: COMMIT_SHA,
        status: "DONE",
      },
    });

    // Create staging deployment
    const stagingPayload = createDeploymentStatusPayload("success", "staging");
    const stagingSignature = computeValidWebhookSignature(
      testSetup.webhookSecret,
      JSON.stringify(stagingPayload)
    );

    const stagingRequest = createWebhookRequest(
      `http://localhost/api/github/webhook/${testSetup.workspace.id}`,
      stagingPayload,
      stagingSignature,
      testSetup.repository.githubWebhookId!,
      "deployment_status"
    );

    await POST(stagingRequest, { params: { workspaceId: testSetup.workspace.id } });

    // Query task with deployment fields (simulating task list query)
    const updatedTask = await db.task.findUnique({
      where: { id: task.id },
      select: {
        id: true,
        title: true,
        status: true,
        deploymentStatus: true,
        deployedToStagingAt: true,
        deployedToProductionAt: true,
      },
    });

    // Assert - verify deployment fields are populated for badge display
    expect(updatedTask).toBeTruthy();
    expect(updatedTask?.deploymentStatus).toBe("staging");
    expect(updatedTask?.deployedToStagingAt).toBeInstanceOf(Date);
    expect(updatedTask?.deployedToProductionAt).toBeNull();
  });

  it("should show production badge after production deployment webhook", async () => {
    // Setup
    const testSetup = await createWebhookTestScenario();
    const task = await createTestTask({ 
      workspaceId: testSetup.workspace.id,
      repositoryId: testSetup.repository.id,
      createdById: testSetup.user.id 
    });
    const message = await createTestChatMessage({ taskId: task.id, message: "Test message" });
    await createTestArtifact({
      messageId: message.id,
      type: "PULL_REQUEST",
      content: {
        url: "https://github.com/owner/repo/pull/1",
        merge_commit_sha: COMMIT_SHA,
        status: "DONE",
      },
    });

    // First deploy to staging
    const stagingPayload = createDeploymentStatusPayload("success", "staging");
    const stagingSignature = computeValidWebhookSignature(
      testSetup.webhookSecret,
      JSON.stringify(stagingPayload)
    );
    const stagingRequest = createWebhookRequest(
      `http://localhost/api/github/webhook/${testSetup.workspace.id}`,
      stagingPayload,
      stagingSignature,
      testSetup.repository.githubWebhookId!,
      "deployment_status"
    );
    await POST(stagingRequest, { params: { workspaceId: testSetup.workspace.id } });

    // Then deploy to production
    const productionPayload = createDeploymentStatusPayload("success", "production");
    const productionSignature = computeValidWebhookSignature(
      testSetup.webhookSecret,
      JSON.stringify(productionPayload)
    );
    const productionRequest = createWebhookRequest(
      `http://localhost/api/github/webhook/${testSetup.workspace.id}`,
      productionPayload,
      productionSignature,
      testSetup.repository.githubWebhookId!,
      "deployment_status"
    );
    await POST(productionRequest, { params: { workspaceId: testSetup.workspace.id } });

    // Query task as task list would
    const updatedTask = await db.task.findUnique({
      where: { id: task.id },
      select: {
        id: true,
        title: true,
        deploymentStatus: true,
        deployedToStagingAt: true,
        deployedToProductionAt: true,
      },
    });

    // Assert - verify badge should show production (not staging)
    expect(updatedTask?.deploymentStatus).toBe("production");
    expect(updatedTask?.deployedToStagingAt).toBeInstanceOf(Date);
    expect(updatedTask?.deployedToProductionAt).toBeInstanceOf(Date);
  });
});
