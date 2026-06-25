/**
 * Integration test: FEATURE_DEPLOYED_PRODUCTION notification trigger
 *
 * Simulates a production deployment_status webhook for a task linked to a
 * feature and verifies that a notification_triggers row is created with type
 * FEATURE_DEPLOYED_PRODUCTION and that the stored message uses `: ` before
 * the URL (so buildPushMessage can strip it correctly).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { db } from "@/lib/db";
import { resetDatabase } from "@/__tests__/support/utilities/database";
import { NotificationTriggerType, NotificationTriggerStatus, TaskStatus } from "@prisma/client";
import {
  createWebhookTestScenario,
  computeValidWebhookSignature,
  createWebhookRequest,
} from "@/__tests__/support/factories/github-webhook.factory";
import { generateUniqueId } from "@/__tests__/support/helpers";
import { createTestTask, createTestChatMessage, createTestArtifact } from "@/__tests__/support/factories/task.factory";

// Mock Octokit (needed for commit comparison in deployment path)
const mockCompareCommits = vi.fn();
vi.mock("@octokit/rest", () => ({
  Octokit: vi.fn(() => ({ repos: { compareCommits: mockCompareCommits } })),
}));

// Mock GitHub App token retrieval
vi.mock("@/lib/githubApp", () => ({
  getUserAppTokens: vi.fn().mockResolvedValue({ accessToken: "test-token" }),
}));

// Mock GitHub PAT retrieval
vi.mock("@/lib/auth/nextauth", () => ({
  getGithubUsernameAndPAT: vi.fn().mockResolvedValue({ username: "test-user", token: "test-pat" }),
}));

// Mock Sphinx so no real HTTP calls are made
vi.mock("@/lib/sphinx/direct-message", () => ({
  sendDirectMessage: vi.fn().mockResolvedValue({ success: true }),
  isDirectMessageConfigured: vi.fn().mockReturnValue(true),
}));

// Mock feature-status-sync to avoid cascading side-effects
vi.mock("@/services/roadmap/feature-status-sync", () => ({
  updateFeatureStatusFromTasks: vi.fn().mockResolvedValue(undefined),
}));

// Mock Pusher
vi.mock("@/lib/pusher", () => ({
  pusherServer: { trigger: vi.fn().mockResolvedValue(undefined) },
  getWorkspaceChannelName: (slug: string) => `workspace-${slug}`,
  getTaskChannelName: (id: string) => `task-${id}`,
  PUSHER_EVENTS: {
    DEPLOYMENT_STATUS_CHANGE: "deployment-status-change",
    WORKSPACE_TASK_TITLE_UPDATE: "workspace-task-title-update",
  },
}));

// Import route AFTER all mocks
import { POST } from "@/app/api/github/webhook/[workspaceId]/route";

/** Build a deployment_status webhook payload for the given commit/environment. */
function createDeploymentStatusPayload(commitSha: string, environment: string, state: string, repositoryUrl: string) {
  return {
    deployment_status: {
      state,
      target_url: `https://vercel.com/deployment/${commitSha}`,
      environment_url: "https://app.example.com",
    },
    deployment: {
      id: 999001,
      sha: commitSha,
      environment,
      ref: "main",
    },
    repository: {
      html_url: repositoryUrl,
      full_name: "test-owner/test-repo",
      name: "test-repo",
      owner: { login: "test-owner" },
    },
  };
}

/** Poll the DB until a matching NotificationTrigger record appears. */
async function waitForNotification(
  where: Record<string, unknown>,
  timeoutMs = 5000,
  intervalMs = 100,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const record = await db.notificationTrigger.findFirst({ where: where as any });
    if (record) return record;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return null;
}

describe("GitHub Webhook — FEATURE_DEPLOYED_PRODUCTION notification", () => {
  let testSetup: Awaited<ReturnType<typeof createWebhookTestScenario>>;
  let task: { id: string };
  let feature: { id: string };
  const commitSha = generateUniqueId("sha");

  beforeEach(async () => {
    await resetDatabase();
    vi.clearAllMocks();

    // compareCommits mock: report the task commit as included in the deployment range
    mockCompareCommits.mockResolvedValue({
      data: { commits: [{ sha: commitSha }] },
    });

    testSetup = await createWebhookTestScenario();

    // Give the workspace owner a lightningPubkey so the notification is eligible
    await db.user.update({
      where: { id: testSetup.user.id },
      data: { lightningPubkey: "test-pubkey-deploy" },
    });

    await db.workspaceMember.create({
      data: {
        userId: testSetup.user.id,
        workspaceId: testSetup.workspace.id,
        role: "OWNER",
      },
    });

    // Create a feature linked to this workspace
    feature = await db.feature.create({
      data: {
        title: "Deploy Feature",
        workspaceId: testSetup.workspace.id,
        createdById: testSetup.user.id,
        updatedById: testSetup.user.id,
      },
    });

    // Create a task linked to the feature and repository
    task = await createTestTask({
      workspaceId: testSetup.workspace.id,
      repositoryId: testSetup.repository.id,
      createdById: testSetup.user.id,
      status: TaskStatus.DONE,
      featureId: feature.id,
    });

    // Attach a PULL_REQUEST artifact carrying the merge commit SHA
    const msg = await createTestChatMessage({ taskId: task.id, message: "PR merged" });
    await createTestArtifact({
      messageId: msg.id,
      type: "PULL_REQUEST",
      content: {
        url: `https://github.com/test-owner/test-repo/pull/42`,
        merge_commit_sha: commitSha,
        status: "MERGED",
      },
    });

    // Seed an earlier STAGING deployment so the webhook handler has a baseline
    await db.deployment.create({
      data: {
        taskId: task.id,
        repositoryId: testSetup.repository.id,
        commitSha: "baseline-sha",
        environment: "STAGING",
        status: "SUCCESS",
        startedAt: new Date("2024-01-01"),
        completedAt: new Date("2024-01-01"),
      },
    });
  });

  afterEach(async () => {
    await resetDatabase();
  });

  it("creates a FEATURE_DEPLOYED_PRODUCTION notification with `: ` separator before URL", async () => {
    const payload = createDeploymentStatusPayload(
      commitSha,
      "production",
      "success",
      testSetup.repository.repositoryUrl,
    );

    const body = JSON.stringify(payload);
    const sig = computeValidWebhookSignature(testSetup.webhookSecret, body);

    const req = createWebhookRequest(
      `http://localhost:3000/api/github/webhook/${testSetup.workspace.id}`,
      payload,
      sig,
      testSetup.repository.githubWebhookId!,
      "deployment_status",
    );

    const res = await POST(req as any, {
      params: Promise.resolve({ workspaceId: testSetup.workspace.id }),
    });

    expect([200, 202]).toContain(res.status);

    const record = await waitForNotification({
      notificationType: NotificationTriggerType.FEATURE_DEPLOYED_PRODUCTION,
      featureId: feature.id,
      status: NotificationTriggerStatus.SENT,
    }, 8000);

    expect(record).not.toBeNull();
    expect(record!.targetUserId).toBe(testSetup.user.id);
    expect(record!.status).toBe(NotificationTriggerStatus.SENT);
    // Separator must be `: ` so buildPushMessage strips the trailing URL from push notifications
    expect(record!.message).toMatch(/deployed to Production: https?:\/\//);
  });
});
