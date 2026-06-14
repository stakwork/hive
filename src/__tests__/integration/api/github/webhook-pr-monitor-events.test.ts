/**
 * Integration test: Event-driven PR monitor triggers
 *
 * Verifies that pull_request (opened/ready_for_review/synchronize), check_run (completed),
 * and workflow_run (completed) events fire monitorSinglePR immediately via the webhook handler.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { db } from "@/lib/db";
import { resetDatabase } from "@/__tests__/support/utilities/database";
import {
  createWebhookTestScenario,
  createGitHubPullRequestPayload,
  computeValidWebhookSignature,
} from "@/__tests__/support/factories/github-webhook.factory";
import { generateUniqueId } from "@/__tests__/support/helpers";

// Mock monitorSinglePR before importing the route
vi.mock("@/lib/github/pr-monitor", () => ({
  monitorSinglePR: vi.fn().mockResolvedValue({
    checked: 1,
    conflicts: 0,
    ciFailures: 0,
    ciPending: 0,
    outOfDate: 0,
    autoMerged: 0,
    healthy: 1,
    errors: 0,
    agentTriggered: 0,
    notified: 0,
  }),
}));

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

// Import route and mock AFTER mocks are registered
import { POST } from "@/app/api/github/webhook/[workspaceId]/route";
import { monitorSinglePR } from "@/lib/github/pr-monitor";

const FULL_NAME = "test-owner/test-repo";
const REPO_URL = "https://github.com/test-owner/test-repo";

function makeRequest(
  workspaceId: string,
  webhookSecret: string,
  event: string,
  payload: unknown,
  hookId: string,
): Request {
  const body = JSON.stringify(payload);
  const sig = computeValidWebhookSignature(webhookSecret, body);
  return new Request(`http://localhost:3000/api/github/webhook/${workspaceId}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-hub-signature-256": sig,
      "x-github-event": event,
      "x-github-delivery": generateUniqueId("delivery"),
      "x-github-hook-id": hookId,
    },
    body,
  }) as Request;
}

describe("GitHub Webhook — Event-driven PR monitor triggers", () => {
  let testSetup: Awaited<ReturnType<typeof createWebhookTestScenario>>;

  beforeEach(async () => {
    await resetDatabase();
    vi.clearAllMocks();
    testSetup = await createWebhookTestScenario({
      repositoryUrl: REPO_URL,
    });
  });

  afterEach(async () => {
    await resetDatabase();
  });

  // ─── pull_request events ────────────────────────────────────────────────────

  it("pull_request opened → calls monitorSinglePR with the PR URL and returns 202", async () => {
    const prUrl = `https://github.com/${FULL_NAME}/pull/1`;
    const payload = createGitHubPullRequestPayload("opened", false, prUrl, REPO_URL, FULL_NAME);
    (payload as any).pull_request.html_url = prUrl;

    const req = makeRequest(testSetup.workspace.id, testSetup.webhookSecret, "pull_request", payload, testSetup.repository.githubWebhookId!);
    const res = await POST(req as any, {
      params: Promise.resolve({ workspaceId: testSetup.workspace.id }),
    });

    expect(res.status).toBe(202);
    // Allow fire-and-forget to be called
    await new Promise((r) => setTimeout(r, 50));
    expect(monitorSinglePR).toHaveBeenCalledWith(prUrl);
  });

  it("pull_request ready_for_review → calls monitorSinglePR and returns 202", async () => {
    const prUrl = `https://github.com/${FULL_NAME}/pull/2`;
    const payload = createGitHubPullRequestPayload("ready_for_review", false, prUrl, REPO_URL, FULL_NAME);
    (payload as any).pull_request.html_url = prUrl;

    const req = makeRequest(testSetup.workspace.id, testSetup.webhookSecret, "pull_request", payload, testSetup.repository.githubWebhookId!);
    const res = await POST(req as any, {
      params: Promise.resolve({ workspaceId: testSetup.workspace.id }),
    });

    expect(res.status).toBe(202);
    await new Promise((r) => setTimeout(r, 50));
    expect(monitorSinglePR).toHaveBeenCalledWith(prUrl);
  });

  it("pull_request synchronize → calls monitorSinglePR and returns 202", async () => {
    const prUrl = `https://github.com/${FULL_NAME}/pull/3`;
    const payload = createGitHubPullRequestPayload("synchronize", false, prUrl, REPO_URL, FULL_NAME);
    (payload as any).pull_request.html_url = prUrl;

    const req = makeRequest(testSetup.workspace.id, testSetup.webhookSecret, "pull_request", payload, testSetup.repository.githubWebhookId!);
    const res = await POST(req as any, {
      params: Promise.resolve({ workspaceId: testSetup.workspace.id }),
    });

    expect(res.status).toBe(202);
    await new Promise((r) => setTimeout(r, 50));
    expect(monitorSinglePR).toHaveBeenCalledWith(prUrl);
  });

  it("pull_request labeled → does NOT call monitorSinglePR and returns 202", async () => {
    const prUrl = `https://github.com/${FULL_NAME}/pull/4`;
    const payload = createGitHubPullRequestPayload("labeled", false, prUrl, REPO_URL, FULL_NAME);
    (payload as any).pull_request.html_url = prUrl;

    const req = makeRequest(testSetup.workspace.id, testSetup.webhookSecret, "pull_request", payload, testSetup.repository.githubWebhookId!);
    const res = await POST(req as any, {
      params: Promise.resolve({ workspaceId: testSetup.workspace.id }),
    });

    expect(res.status).toBe(202);
    await new Promise((r) => setTimeout(r, 50));
    expect(monitorSinglePR).not.toHaveBeenCalled();
  });

  // ─── check_run events ───────────────────────────────────────────────────────

  it("check_run completed with 1 PR → calls monitorSinglePR with correct URL and returns 202", async () => {
    const prNumber = 42;
    const expectedPrUrl = `https://github.com/${FULL_NAME}/pull/${prNumber}`;
    const payload = {
      action: "completed",
      check_run: {
        status: "completed",
        conclusion: "failure",
        pull_requests: [{ number: prNumber }],
      },
      repository: {
        html_url: REPO_URL,
        full_name: FULL_NAME,
        default_branch: "main",
      },
    };

    const req = makeRequest(testSetup.workspace.id, testSetup.webhookSecret, "check_run", payload, testSetup.repository.githubWebhookId!);
    const res = await POST(req as any, {
      params: Promise.resolve({ workspaceId: testSetup.workspace.id }),
    });

    expect(res.status).toBe(202);
    await new Promise((r) => setTimeout(r, 50));
    expect(monitorSinglePR).toHaveBeenCalledWith(expectedPrUrl);
  });

  it("check_run in_progress → does NOT call monitorSinglePR and returns 202", async () => {
    const payload = {
      action: "created",
      check_run: {
        status: "in_progress",
        pull_requests: [{ number: 42 }],
      },
      repository: {
        html_url: REPO_URL,
        full_name: FULL_NAME,
        default_branch: "main",
      },
    };

    const req = makeRequest(testSetup.workspace.id, testSetup.webhookSecret, "check_run", payload, testSetup.repository.githubWebhookId!);
    const res = await POST(req as any, {
      params: Promise.resolve({ workspaceId: testSetup.workspace.id }),
    });

    expect(res.status).toBe(202);
    await new Promise((r) => setTimeout(r, 50));
    expect(monitorSinglePR).not.toHaveBeenCalled();
  });

  // ─── workflow_run events ─────────────────────────────────────────────────────

  it("workflow_run completed with 1 PR → calls monitorSinglePR with correct URL and returns 202", async () => {
    const prNumber = 7;
    const headRepo = "head-owner/head-repo";
    const expectedPrUrl = `https://github.com/${headRepo}/pull/${prNumber}`;
    const payload = {
      action: "completed",
      workflow_run: {
        status: "completed",
        conclusion: "failure",
        pull_requests: [{ number: prNumber }],
        head_repository: { full_name: headRepo },
      },
      repository: {
        html_url: REPO_URL,
        full_name: FULL_NAME,
        default_branch: "main",
      },
    };

    const req = makeRequest(testSetup.workspace.id, testSetup.webhookSecret, "workflow_run", payload, testSetup.repository.githubWebhookId!);
    const res = await POST(req as any, {
      params: Promise.resolve({ workspaceId: testSetup.workspace.id }),
    });

    expect(res.status).toBe(202);
    await new Promise((r) => setTimeout(r, 50));
    expect(monitorSinglePR).toHaveBeenCalledWith(expectedPrUrl);
  });

  it("workflow_run in_progress → does NOT call monitorSinglePR and returns 202", async () => {
    const payload = {
      action: "requested",
      workflow_run: {
        status: "in_progress",
        pull_requests: [{ number: 7 }],
        head_repository: { full_name: FULL_NAME },
      },
      repository: {
        html_url: REPO_URL,
        full_name: FULL_NAME,
        default_branch: "main",
      },
    };

    const req = makeRequest(testSetup.workspace.id, testSetup.webhookSecret, "workflow_run", payload, testSetup.repository.githubWebhookId!);
    const res = await POST(req as any, {
      params: Promise.resolve({ workspaceId: testSetup.workspace.id }),
    });

    expect(res.status).toBe(202);
    await new Promise((r) => setTimeout(r, 50));
    expect(monitorSinglePR).not.toHaveBeenCalled();
  });
});
