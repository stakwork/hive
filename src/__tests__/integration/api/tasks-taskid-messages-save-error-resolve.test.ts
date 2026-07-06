/**
 * Integration tests: PR artifact write → ErrorIssue auto-resolve
 *
 * Verifies that when a PULL_REQUEST artifact is saved for a task whose
 * feature has a linked UNRESOLVED ErrorIssue, and the underlying PR is
 * already merged, the ErrorIssue is automatically resolved with a Pusher
 * broadcast — regardless of whether the merge webhook fired first.
 */

import { describe, test, expect, beforeEach, vi, afterEach } from "vitest";
import { POST } from "@/app/api/tasks/[taskId]/messages/save/route";
import {
  ArtifactType,
  TaskStatus,
  WorkflowStatus,
  ErrorIssueStatus,
} from "@prisma/client";
import { db } from "@/lib/db";
import { resetDatabase } from "@/__tests__/support/utilities/database";
import {
  getMockedSession,
  generateUniqueId,
  generateUniqueSlug,
  createPostRequest,
} from "@/__tests__/support/helpers";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("@/lib/pusher", () => ({
  pusherServer: { trigger: vi.fn() },
  getWorkspaceChannelName: (slug: string) => `workspace-${slug}`,
  getTaskChannelName: (id: string) => `task-${id}`,
  PUSHER_EVENTS: {
    ERROR_ISSUE_UPDATED: "error-issue-updated",
    PR_STATUS_CHANGE: "pr-status-change",
    WORKSPACE_TASK_TITLE_UPDATE: "workspace-task-title-update",
  },
}));

vi.mock("@/services/roadmap/feature-status-sync", () => ({
  updateFeatureStatusFromTasks: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/canvas", () => ({
  notifyFeatureCanvasRefresh: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/graph-walker", () => ({
  linkFeatureToConcepts: vi.fn().mockResolvedValue(undefined),
}));

// Mock getUserAppTokens used by extractPrArtifact
vi.mock("@/lib/githubApp", () => ({
  getUserAppTokens: vi.fn(),
}));

// Mock the GitHub API fetch inside extractPrArtifact
const mockFetch = vi.fn();
global.fetch = mockFetch as unknown as typeof fetch;

// ── Helpers ────────────────────────────────────────────────────────────────────

async function createWorkspaceWithUser() {
  const userId = generateUniqueId();
  const user = await db.user.create({
    data: { email: `user-${userId}@example.com`, name: "Test User" },
  });
  const workspace = await db.workspace.create({
    data: {
      name: "Test Workspace",
      slug: generateUniqueSlug("test-ws"),
      ownerId: user.id,
    },
  });
  return { user, workspace };
}

async function createErrorIssue(workspaceId: string, status: ErrorIssueStatus = "UNRESOLVED") {
  return db.errorIssue.create({
    data: {
      workspaceId,
      repoKey: "test-owner/test-repo",
      fingerprint: `fp-${generateUniqueId()}`,
      exceptionType: "TypeError",
      title: "TypeError: something broke",
      status,
      firstSeenAt: new Date(),
      lastSeenAt: new Date(),
    },
  });
}

async function createFeatureWithTask(opts: {
  workspaceId: string;
  userId: string;
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

  return { feature, task };
}

function buildSaveRequest(taskId: string, prUrl: string) {
  return createPostRequest(
    `http://localhost:3000/api/tasks/${taskId}/messages/save`,
    {
      message: "",
      role: "ASSISTANT",
      artifacts: [
        {
          type: "PULL_REQUEST",
          content: {
            repo: "test-owner/test-repo",
            url: prUrl,
            status: "open",
          },
        },
      ],
    },
  );
}

// ── Suite ─────────────────────────────────────────────────────────────────────

describe("POST /api/tasks/[taskId]/messages/save — ErrorIssue auto-resolve on artifact write", () => {
  let user: { id: string };
  let workspace: { id: string };

  beforeEach(async () => {
    await resetDatabase();
    vi.clearAllMocks();

    const ctx = await createWorkspaceWithUser();
    user = ctx.user;
    workspace = ctx.workspace;

    getMockedSession().mockResolvedValue({ user: { id: user.id } });

    const { pusherServer } = await import("@/lib/pusher");
    vi.mocked(pusherServer.trigger).mockResolvedValue({} as any);

    // Re-apply implementations that vi.clearAllMocks() strips from module-level mocks
    const { updateFeatureStatusFromTasks } = await import("@/services/roadmap/feature-status-sync");
    vi.mocked(updateFeatureStatusFromTasks).mockResolvedValue(undefined);

    const { notifyFeatureCanvasRefresh } = await import("@/lib/canvas");
    vi.mocked(notifyFeatureCanvasRefresh).mockResolvedValue(undefined);

    const { linkFeatureToConcepts } = await import("@/lib/graph-walker");
    vi.mocked(linkFeatureToConcepts).mockResolvedValue(undefined);
  });

  // ── Happy path: PR already merged at artifact write ──────────────────────────

  test("resolves linked UNRESOLVED ErrorIssue when saved PR artifact is already merged", async () => {
    const { getUserAppTokens } = await import("@/lib/githubApp");
    vi.mocked(getUserAppTokens).mockResolvedValue({ accessToken: "gh-token" } as any);

    // GitHub API returns merged PR
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        state: "closed",
        merged_at: "2024-01-01T00:00:00Z",
      }),
    } as any);

    const prUrl = "https://github.com/test-owner/test-repo/pull/42";
    const issue = await createErrorIssue(workspace.id, "UNRESOLVED");
    const { task } = await createFeatureWithTask({
      workspaceId: workspace.id,
      userId: user.id,
      errorIssueId: issue.id,
    });

    const req = buildSaveRequest(task.id, prUrl);
    const response = await POST(req, {
      params: Promise.resolve({ taskId: task.id }),
    });

    expect(response.status).toBe(201);

    // Give async fire-and-forget a chance to settle
    await new Promise((resolve) => setTimeout(resolve, 500));

    const updated = await db.errorIssue.findUnique({ where: { id: issue.id } });
    expect(updated?.status).toBe("RESOLVED");

    const { pusherServer } = await import("@/lib/pusher");
    const pusherCalls = vi.mocked(pusherServer.trigger).mock.calls;
    const errorUpdatedCall = pusherCalls.find((c) => c[1] === "error-issue-updated");
    expect(errorUpdatedCall).toBeDefined();
    expect(errorUpdatedCall![2]).toMatchObject({ id: issue.id, status: "RESOLVED" });
  });

  // ── PR not yet merged — no resolve ──────────────────────────────────────────

  test("does NOT resolve ErrorIssue when saved PR is still open", async () => {
    const { getUserAppTokens } = await import("@/lib/githubApp");
    vi.mocked(getUserAppTokens).mockResolvedValue({ accessToken: "gh-token" } as any);

    // GitHub API returns open PR
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        state: "open",
        merged_at: null,
      }),
    } as any);

    const prUrl = "https://github.com/test-owner/test-repo/pull/43";
    const issue = await createErrorIssue(workspace.id, "UNRESOLVED");
    const { task } = await createFeatureWithTask({
      workspaceId: workspace.id,
      userId: user.id,
      errorIssueId: issue.id,
    });

    const req = buildSaveRequest(task.id, prUrl);
    const response = await POST(req, {
      params: Promise.resolve({ taskId: task.id }),
    });

    expect(response.status).toBe(201);
    await new Promise((resolve) => setTimeout(resolve, 500));

    const updated = await db.errorIssue.findUnique({ where: { id: issue.id } });
    expect(updated?.status).toBe("UNRESOLVED");
  });

  // ── IGNORED protection ───────────────────────────────────────────────────────

  test("does NOT modify an IGNORED ErrorIssue even when PR is already merged", async () => {
    const { getUserAppTokens } = await import("@/lib/githubApp");
    vi.mocked(getUserAppTokens).mockResolvedValue({ accessToken: "gh-token" } as any);

    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        state: "closed",
        merged_at: "2024-01-01T00:00:00Z",
      }),
    } as any);

    const prUrl = "https://github.com/test-owner/test-repo/pull/44";
    const issue = await createErrorIssue(workspace.id, "IGNORED");
    const { task } = await createFeatureWithTask({
      workspaceId: workspace.id,
      userId: user.id,
      errorIssueId: issue.id,
    });

    const req = buildSaveRequest(task.id, prUrl);
    const response = await POST(req, {
      params: Promise.resolve({ taskId: task.id }),
    });

    expect(response.status).toBe(201);
    await new Promise((resolve) => setTimeout(resolve, 500));

    const updated = await db.errorIssue.findUnique({ where: { id: issue.id } });
    expect(updated?.status).toBe("IGNORED");

    const { pusherServer } = await import("@/lib/pusher");
    const errorUpdatedCalls = vi.mocked(pusherServer.trigger).mock.calls.filter(
      (c) => c[1] === "error-issue-updated",
    );
    expect(errorUpdatedCalls).toHaveLength(0);
  });

  // ── Idempotency ──────────────────────────────────────────────────────────────

  test("is idempotent — saving the artifact twice does not double-resolve or error", async () => {
    const { getUserAppTokens } = await import("@/lib/githubApp");
    vi.mocked(getUserAppTokens).mockResolvedValue({ accessToken: "gh-token" } as any);

    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        state: "closed",
        merged_at: "2024-01-01T00:00:00Z",
      }),
    } as any);

    const prUrl = "https://github.com/test-owner/test-repo/pull/45";
    const issue = await createErrorIssue(workspace.id, "UNRESOLVED");
    const { task } = await createFeatureWithTask({
      workspaceId: workspace.id,
      userId: user.id,
      errorIssueId: issue.id,
    });

    // First save
    await POST(buildSaveRequest(task.id, prUrl), {
      params: Promise.resolve({ taskId: task.id }),
    });
    await new Promise((resolve) => setTimeout(resolve, 500));

    const { pusherServer } = await import("@/lib/pusher");
    const firstResolveCount = vi.mocked(pusherServer.trigger).mock.calls.filter(
      (c) => c[1] === "error-issue-updated",
    ).length;

    vi.clearAllMocks();
    vi.mocked(pusherServer.trigger).mockResolvedValue({} as any);

    // Second save (same PR, already RESOLVED)
    await POST(buildSaveRequest(task.id, prUrl), {
      params: Promise.resolve({ taskId: task.id }),
    });
    await new Promise((resolve) => setTimeout(resolve, 500));

    const secondResolveCount = vi.mocked(pusherServer.trigger).mock.calls.filter(
      (c) => c[1] === "error-issue-updated",
    ).length;

    expect(firstResolveCount).toBe(1);
    expect(secondResolveCount).toBe(0);

    const updated = await db.errorIssue.findUnique({ where: { id: issue.id } });
    expect(updated?.status).toBe("RESOLVED");
  });

  // ── GitHub API failure is non-blocking ───────────────────────────────────────

  test("does not fail the message-save request when GitHub API call errors", async () => {
    const { getUserAppTokens } = await import("@/lib/githubApp");
    vi.mocked(getUserAppTokens).mockResolvedValue({ accessToken: "gh-token" } as any);

    // Simulate GitHub API error
    mockFetch.mockRejectedValue(new Error("GitHub API unavailable"));

    const prUrl = "https://github.com/test-owner/test-repo/pull/46";
    const issue = await createErrorIssue(workspace.id, "UNRESOLVED");
    const { task } = await createFeatureWithTask({
      workspaceId: workspace.id,
      userId: user.id,
      errorIssueId: issue.id,
    });

    const req = buildSaveRequest(task.id, prUrl);
    const response = await POST(req, {
      params: Promise.resolve({ taskId: task.id }),
    });

    // Request must succeed regardless of GitHub API failure
    expect(response.status).toBe(201);

    // ErrorIssue stays unresolved (couldn't check merge status)
    await new Promise((resolve) => setTimeout(resolve, 500));
    const updated = await db.errorIssue.findUnique({ where: { id: issue.id } });
    expect(updated?.status).toBe("UNRESOLVED");
  });

  // ── No linked feature ────────────────────────────────────────────────────────

  test("processes normally when task has no linked feature (no ErrorIssue side effects)", async () => {
    const prUrl = "https://github.com/test-owner/test-repo/pull/47";

    // Task with NO feature
    const task = await db.task.create({
      data: {
        title: "Standalone task",
        workspaceId: workspace.id,
        status: TaskStatus.IN_PROGRESS,
        workflowStatus: WorkflowStatus.IN_PROGRESS,
        createdById: user.id,
        updatedById: user.id,
      },
    });

    const req = buildSaveRequest(task.id, prUrl);
    const response = await POST(req, {
      params: Promise.resolve({ taskId: task.id }),
    });

    expect(response.status).toBe(201);
    await new Promise((resolve) => setTimeout(resolve, 500));

    const { pusherServer } = await import("@/lib/pusher");
    const errorUpdatedCalls = vi.mocked(pusherServer.trigger).mock.calls.filter(
      (c) => c[1] === "error-issue-updated",
    );
    expect(errorUpdatedCalls).toHaveLength(0);
  });
});
