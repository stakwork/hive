/**
 * Integration test: TASK_PR_MERGED notification trigger
 *
 * Simulates a merged PR webhook and verifies a notification_triggers row
 * is created with type TASK_PR_MERGED.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { db } from "@/lib/db";
import { resetDatabase } from "@/__tests__/support/utilities/database";
import { NotificationTriggerType, NotificationTriggerStatus, ArtifactType, TaskStatus } from "@prisma/client";
import {
  createWebhookTestScenario,
  createGitHubPullRequestPayload,
  computeValidWebhookSignature,
} from "@/__tests__/support/factories/github-webhook.factory";
import { generateUniqueId } from "@/__tests__/support/helpers";

// Mock external services that are not under test
vi.mock("@/services/swarm/stakgraph-actions", () => ({
  triggerAsyncSync: vi.fn().mockResolvedValue({ ok: true, status: 200, data: {} }),
}));
vi.mock("@/lib/auth/nextauth", () => ({
  getGithubUsernameAndPAT: vi.fn().mockResolvedValue({ username: "test", token: "tok" }),
}));
vi.mock("@/lib/pusher", () => ({
  pusherServer: { trigger: vi.fn().mockResolvedValue(undefined) },
  getWorkspaceChannelName: (slug: string) => `workspace-${slug}`,
  getTaskChannelName: (id: string) => `task-${id}`,
  PUSHER_EVENTS: {
    WORKSPACE_TASK_TITLE_UPDATE: "workspace-task-title-update",
    PR_STATUS_CHANGE: "pr-status-change",
    DEPLOYMENT_STATUS_CHANGE: "deployment-status-change",
  },
}));
vi.mock("@/services/roadmap/feature-status-sync", () => ({
  updateFeatureStatusFromTasks: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/pods/utils", () => ({
  releaseTaskPod: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/sphinx/direct-message", () => ({
  sendDirectMessage: vi.fn().mockResolvedValue({ success: true }),
  isDirectMessageConfigured: vi.fn().mockReturnValue(true),
}));

// Import route AFTER mocks
import { POST } from "@/app/api/github/webhook/[workspaceId]/route";

describe("GitHub Webhook — TASK_PR_MERGED notification", () => {
  let testSetup: Awaited<ReturnType<typeof createWebhookTestScenario>>;
  let task: { id: string };
  const prUrl = "https://github.com/test-owner/test-repo/pull/999";

  beforeEach(async () => {
    await resetDatabase();
    vi.clearAllMocks();

    testSetup = await createWebhookTestScenario();

    // Set lightningPubkey on user so DM notifications are eligible
    await db.user.update({
      where: { id: testSetup.user.id },
      data: { lightningPubkey: "test-pubkey-user" },
    });

    // Create task with the test workspace owner as creator
    task = await db.task.create({
      data: {
        title: "PR Task",
        workspaceId: testSetup.workspace.id,
        createdById: testSetup.user.id,
        updatedById: testSetup.user.id,
        status: TaskStatus.IN_PROGRESS,
      },
    });

    // Create chat message + PR artifact linking the task to the PR URL
    const msg = await db.chatMessage.create({
      data: {
        taskId: task.id,
        role: "ASSISTANT",
        message: "PR opened",
        status: "SENT",
      },
    });
    await db.artifact.create({
      data: {
        messageId: msg.id,
        type: ArtifactType.PULL_REQUEST,
        content: { url: prUrl, status: "open" },
      },
    });
  });

  afterEach(async () => {
    await resetDatabase();
  });

  it("creates a TASK_PR_MERGED notification_triggers row on PR merge", async () => {
    const payload = createGitHubPullRequestPayload(
      "closed",
      true, // merged
      prUrl,
      testSetup.repository.repositoryUrl,
      "test-owner/test-repo",
    );
    // Add merge_commit_sha to payload for completeness
    (payload as any).pull_request.merge_commit_sha = generateUniqueId("sha");

    const body = JSON.stringify(payload);
    const sig = computeValidWebhookSignature(testSetup.webhookSecret, body);

    const req = new Request(
      `http://localhost:3000/api/github/webhook/${testSetup.workspace.id}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-hub-signature-256": sig,
          "x-github-event": "pull_request",
          "x-github-delivery": generateUniqueId("delivery"),
          "x-github-hook-id": testSetup.repository.githubWebhookId,
        },
        body,
      },
    );

    const res = await POST(req as any, {
      params: Promise.resolve({ workspaceId: testSetup.workspace.id }),
    });

    // Route should succeed
    expect([200, 202]).toContain(res.status);

    // Allow async notification to settle
    await new Promise((r) => setTimeout(r, 300));

    const record = await db.notificationTrigger.findFirst({
      where: {
        notificationType: NotificationTriggerType.TASK_PR_MERGED,
        taskId: task.id,
      },
    });

    expect(record).not.toBeNull();
    expect(record!.targetUserId).toBe(testSetup.user.id);
    expect(record!.status).toBe(NotificationTriggerStatus.SENT);
  });
});
