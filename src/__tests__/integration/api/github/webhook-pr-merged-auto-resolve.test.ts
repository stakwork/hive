/**
 * Integration tests: GitHub webhook PR merged → ErrorIssue auto-resolve
 *
 * Verifies that when a PR belonging to a Feature with a linked ErrorIssue
 * merges, the issue is automatically set to RESOLVED (with Pusher broadcast),
 * while IGNORED issues are untouched and re-delivery is idempotent.
 */
import { describe, test, expect, beforeEach, vi, afterEach } from "vitest";
import { POST } from "@/app/api/github/webhook/[workspaceId]/route";
import {
  RepositoryStatus,
  ArtifactType,
  TaskStatus,
  WorkflowStatus,
  ErrorIssueStatus,
} from "@prisma/client";
import {
  createWebhookTestScenario,
  createGitHubPullRequestPayload,
  computeValidWebhookSignature,
} from "@/__tests__/support/factories/github-webhook.factory";
import { resetDatabase } from "@/__tests__/support/utilities/database";
import { db } from "@/lib/db";
import { triggerAsyncSync } from "@/services/swarm/stakgraph-actions";
import { getGithubUsernameAndPAT } from "@/lib/auth/nextauth";
import { pusherServer } from "@/lib/pusher";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("@/services/swarm/stakgraph-actions");
vi.mock("@/lib/auth/nextauth");
vi.mock("@/lib/pusher", () => ({
  pusherServer: { trigger: vi.fn() },
  getWorkspaceChannelName: (slug: string) => `workspace-${slug}`,
  getTaskChannelName: (taskId: string) => `task-${taskId}`,
  PUSHER_EVENTS: {
    WORKSPACE_TASK_TITLE_UPDATE: "workspace-task-title-update",
    PR_STATUS_CHANGE: "pr-status-change",
    ERROR_ISSUE_UPDATED: "error-issue-updated",
  },
}));
vi.mock("@/services/roadmap/feature-status-sync", () => ({
  updateFeatureStatusFromTasks: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/pods/utils", async () => {
  const actual = await vi.importActual("@/lib/pods/utils");
  return {
    ...actual,
    releaseTaskPod: vi.fn().mockResolvedValue({ success: true, podDropped: false, taskCleared: false }),
  };
});
vi.mock("@/lib/canvas", () => ({ notifyFeatureCanvasRefresh: vi.fn() }));
vi.mock("@/services/learning-run", () => ({
  triggerLearningRun: vi.fn().mockResolvedValue(undefined),
}));

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Creates a minimal Feature + Task + ChatMessage + PR Artifact chain so the
 * webhook SQL query can match the PR URL to a task with a feature_id.
 */
async function createFeatureTaskWithPR(opts: {
  workspaceId: string;
  userId: string;
  prUrl: string;
  errorIssueId?: string;
}) {
  const feature = await db.feature.create({
    data: {
      title: "Fix feature",
      workspaceId: opts.workspaceId,
      createdById: opts.userId,
      updatedById: opts.userId,
      ...(opts.errorIssueId ? { errorIssueId: opts.errorIssueId } : {}),
    },
  });

  const task = await db.task.create({
    data: {
      title: "Fix task",
      workspaceId: opts.workspaceId,
      featureId: feature.id,
      status: TaskStatus.IN_PROGRESS,
      workflowStatus: WorkflowStatus.IN_PROGRESS,
      createdById: opts.userId,
      updatedById: opts.userId,
    },
  });

  const message = await db.chatMessage.create({
    data: {
      taskId: task.id,
      role: "ASSISTANT",
      message: "PR created",
      status: "SENT",
    },
  });

  await db.artifact.create({
    data: {
      messageId: message.id,
      type: ArtifactType.PULL_REQUEST,
      content: { repo: "test-owner/test-repo", url: opts.prUrl, status: "open" },
    },
  });

  return { feature, task };
}

async function createErrorIssue(workspaceId: string, status: ErrorIssueStatus = "UNRESOLVED") {
  return db.errorIssue.create({
    data: {
      workspaceId,
      repoKey: "test-owner/test-repo",
      fingerprint: `fp-${Math.random()}`,
      exceptionType: "TypeError",
      title: "TypeError: something broke",
      status,
      firstSeenAt: new Date(),
      lastSeenAt: new Date(),
    },
  });
}

function buildMergedPRRequest(opts: {
  workspaceId: string;
  prUrl: string;
  repositoryUrl: string;
  webhookSecret: string;
  webhookId: string;
  delivery?: string;
}) {
  const { workspaceId, prUrl, repositoryUrl, webhookSecret, webhookId, delivery = "delivery-123" } = opts;
  const payload = createGitHubPullRequestPayload("closed", true, prUrl, repositoryUrl);
  const sig = computeValidWebhookSignature(webhookSecret, JSON.stringify(payload));

  return new Request(`http://localhost/api/github/webhook/${workspaceId}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-hub-signature-256": sig,
      "x-github-event": "pull_request",
      "x-github-delivery": delivery,
      "x-github-hook-id": webhookId,
    },
    body: JSON.stringify(payload),
  });
}

// ── Suite ─────────────────────────────────────────────────────────────────────

describe("POST /api/github/webhook/[workspaceId] - PR Merged Error Auto-Resolve", () => {
  let testSetup: Awaited<ReturnType<typeof createWebhookTestScenario>>;

  beforeEach(async () => {
    await resetDatabase();
    vi.clearAllMocks();

    testSetup = await createWebhookTestScenario({
      branch: "main",
      status: RepositoryStatus.SYNCED,
    });

    vi.mocked(getGithubUsernameAndPAT).mockResolvedValue({
      username: "test-user",
      token: "test-pat-token",
    });
    vi.mocked(triggerAsyncSync).mockResolvedValue({
      ok: true,
      status: 200,
      data: { request_id: "sync-req-123" },
    });
    vi.mocked(pusherServer.trigger).mockResolvedValue({} as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Happy path ──────────────────────────────────────────────────────────────

  test("resolves linked UNRESOLVED ErrorIssue when PR merges and broadcasts ERROR_ISSUE_UPDATED", async () => {
    const { workspace, repository, webhookSecret } = testSetup;
    const prUrl = "https://github.com/test-owner/test-repo/pull/42";

    const issue = await createErrorIssue(workspace.id, "UNRESOLVED");
    await createFeatureTaskWithPR({
      workspaceId: workspace.id,
      userId: testSetup.user.id,
      prUrl,
      errorIssueId: issue.id,
    });

    const req = buildMergedPRRequest({
      workspaceId: workspace.id,
      prUrl,
      repositoryUrl: repository.repositoryUrl,
      webhookSecret,
      webhookId: repository.githubWebhookId!,
    });

    const response = await POST(req, {
      params: Promise.resolve({ workspaceId: workspace.id }),
    });

    expect(response.status).toBe(200);

    const updated = await db.errorIssue.findUnique({ where: { id: issue.id } });
    expect(updated?.status).toBe("RESOLVED");

    const pusherCalls = vi.mocked(pusherServer.trigger).mock.calls;
    const errorUpdatedCall = pusherCalls.find((c) => c[1] === "error-issue-updated");
    expect(errorUpdatedCall).toBeDefined();
    expect(errorUpdatedCall![2]).toMatchObject({ id: issue.id, status: "RESOLVED" });
  });

  // ── Idempotency ─────────────────────────────────────────────────────────────

  test("is idempotent — re-delivering the same PR merge webhook does not double-update or duplicate Pusher", async () => {
    const { workspace, repository, webhookSecret } = testSetup;
    const prUrl = "https://github.com/test-owner/test-repo/pull/99";

    const issue = await createErrorIssue(workspace.id, "UNRESOLVED");
    await createFeatureTaskWithPR({
      workspaceId: workspace.id,
      userId: testSetup.user.id,
      prUrl,
      errorIssueId: issue.id,
    });

    const buildReq = (delivery: string) =>
      buildMergedPRRequest({
        workspaceId: workspace.id,
        prUrl,
        repositoryUrl: repository.repositoryUrl,
        webhookSecret,
        webhookId: repository.githubWebhookId!,
        delivery,
      });

    // First delivery
    await POST(buildReq("delivery-A"), { params: Promise.resolve({ workspaceId: workspace.id }) });

    const errorUpdatedAfterFirst = vi.mocked(pusherServer.trigger).mock.calls.filter(
      (c) => c[1] === "error-issue-updated",
    ).length;

    vi.clearAllMocks();
    vi.mocked(pusherServer.trigger).mockResolvedValue({} as any);

    // Second delivery (same logical content, different x-github-delivery)
    await POST(buildReq("delivery-B"), { params: Promise.resolve({ workspaceId: workspace.id }) });

    const errorUpdatedAfterSecond = vi.mocked(pusherServer.trigger).mock.calls.filter(
      (c) => c[1] === "error-issue-updated",
    ).length;

    expect(errorUpdatedAfterFirst).toBe(1);
    expect(errorUpdatedAfterSecond).toBe(0);

    const updated = await db.errorIssue.findUnique({ where: { id: issue.id } });
    expect(updated?.status).toBe("RESOLVED");
  });

  // ── IGNORED protection ──────────────────────────────────────────────────────

  test("does not modify an IGNORED ErrorIssue when the linked Feature's PR merges", async () => {
    const { workspace, repository, webhookSecret } = testSetup;
    const prUrl = "https://github.com/test-owner/test-repo/pull/55";

    const issue = await createErrorIssue(workspace.id, "IGNORED");
    await createFeatureTaskWithPR({
      workspaceId: workspace.id,
      userId: testSetup.user.id,
      prUrl,
      errorIssueId: issue.id,
    });

    const req = buildMergedPRRequest({
      workspaceId: workspace.id,
      prUrl,
      repositoryUrl: repository.repositoryUrl,
      webhookSecret,
      webhookId: repository.githubWebhookId!,
    });

    const response = await POST(req, {
      params: Promise.resolve({ workspaceId: workspace.id }),
    });

    expect(response.status).toBe(200);

    const updated = await db.errorIssue.findUnique({ where: { id: issue.id } });
    expect(updated?.status).toBe("IGNORED");

    const errorUpdatedCalls = vi.mocked(pusherServer.trigger).mock.calls.filter(
      (c) => c[1] === "error-issue-updated",
    );
    expect(errorUpdatedCalls).toHaveLength(0);
  });

  // ── No linked error ─────────────────────────────────────────────────────────

  test("processes merge normally when Feature has no linked ErrorIssue — no error-related side effects", async () => {
    const { workspace, repository, webhookSecret } = testSetup;
    const prUrl = "https://github.com/test-owner/test-repo/pull/77";

    // Feature with NO errorIssueId
    await createFeatureTaskWithPR({
      workspaceId: workspace.id,
      userId: testSetup.user.id,
      prUrl,
    });

    const req = buildMergedPRRequest({
      workspaceId: workspace.id,
      prUrl,
      repositoryUrl: repository.repositoryUrl,
      webhookSecret,
      webhookId: repository.githubWebhookId!,
    });

    const response = await POST(req, {
      params: Promise.resolve({ workspaceId: workspace.id }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);

    // No error-issue-updated Pusher event
    const errorUpdatedCalls = vi.mocked(pusherServer.trigger).mock.calls.filter(
      (c) => c[1] === "error-issue-updated",
    );
    expect(errorUpdatedCalls).toHaveLength(0);
  });
});
