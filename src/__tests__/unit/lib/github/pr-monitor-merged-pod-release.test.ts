import { beforeEach, describe, expect, it, vi } from "vitest";

const mockPullsGet = vi.fn();

vi.mock("@octokit/rest", () => ({
  Octokit: vi.fn().mockImplementation(() => ({
    pulls: {
      get: mockPullsGet,
    },
  })),
}));

vi.mock("@/lib/db", () => ({
  db: {
    $queryRaw: vi.fn(),artifacts: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },tasks: {
      update: vi.fn(),
      findUnique: vi.fn(),
    },chat_messages: {
      create: vi.fn(),
    },
  },
}));

vi.mock("@/lib/githubApp", () => ({
  getUserAppTokens: vi.fn(),
}));

vi.mock("@/lib/pods/utils", () => ({
  releaseTaskPod: vi.fn(),
}));

vi.mock("@/lib/pusher", () => ({
  pusherServer: {
    trigger: vi.fn(),
  },
  getTaskChannelName: vi.fn((taskId: string) => `task-${taskId}`),
  getWorkspaceChannelName: vi.fn((slug: string) => `workspace-${slug}`),
  PUSHER_EVENTS: {
    PR_STATUS_CHANGE: "pr-status-change",
    NEW_MESSAGE: "new-message",
  },
}));

vi.mock("@/lib/encryption", () => ({
  EncryptionService: {
    getInstance: vi.fn(() => ({
      decryptField: vi.fn().mockReturnValue("decrypted-secret"),
      encryptField: vi.fn().mockReturnValue({}),
    })),
  },
}));

vi.mock("@/lib/auth/agent-jwt", () => ({
  createWebhookToken: vi.fn(),
  generateWebhookSecret: vi.fn(),
}));

vi.mock("@/services/task-workflow", () => ({
  createChatMessageAndTriggerStakwork: vi.fn(),
}));

vi.mock("@/lib/github/pr-ci", () => ({
  fetchCIStatus: vi.fn(),
}));

import { db } from "@/lib/db";
import { getUserAppTokens } from "@/lib/githubApp";
import { releaseTaskPod } from "@/lib/pods/utils";
import { monitorOpenPRs } from "@/lib/github/pr-monitor";

describe("monitorOpenPRs - merged PR pod release fallback", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(getUserAppTokens).mockResolvedValue({
      accessToken: "github-token",
    } as any);

    vi.mocked(db.$queryRaw).mockResolvedValue([
      {
        id: "artifact-123",
        content: {
          url: "https://github.com/stakwork/senza-lnd/pull/7632",
          repo: "stakwork/senza-lnd",
          status: "IN_PROGRESS",
        },
        task_id: "task-123",
        pod_id: "pod-123",
        workspace_id: "workspace-123",
        owner_id: "owner-123",
        pr_monitor_enabled: true,
        pr_conflict_fix_enabled: false,
        pr_ci_failure_fix_enabled: false,
        pr_out_of_date_fix_enabled: false,
        pr_use_rebase_for_updates: false,
      },
    ] as any);

    vi.mocked(db.artifacts.findUnique).mockResolvedValue({
      content: {
        url: "https://github.com/stakwork/senza-lnd/pull/7632",
        repo: "stakwork/senza-lnd",
        status: "IN_PROGRESS",
      },
    } as any);

    vi.mocked(db.artifacts.update).mockResolvedValue({} as any);
    vi.mocked(db.tasks.update).mockResolvedValue({} as any);
    vi.mocked(releaseTaskPod).mockResolvedValue({
      success: true,
      podDropped: true,
      taskCleared: true,
    });

    mockPullsGet.mockResolvedValue({
      data: {
        state: "closed",
        merged: true,
        mergeable: null,
        mergeable_state: "unknown",
        head: {
          ref: "feature/test",
          sha: "head-sha",
        },
        base: {
          ref: "master",
          sha: "base-sha",
        },
      },
    });
  });

  it("releases the assigned pod when a merged PR is detected by the monitor", async () => {
    const stats = await monitorOpenPRs(20);

    expect(db.tasks.update).toHaveBeenCalledWith({
      where: { id: "task-123" },
      data: { status: "DONE" },
    });

    expect(releaseTaskPod).toHaveBeenCalledWith({
      taskId: "task-123",
      podId: "pod-123",
      workspaceId: "workspace-123",
      verifyOwnership: true,
      clearTaskFields: true,
      newWorkflowStatus: null,
    });

    expect(db.artifacts.update).toHaveBeenCalledWith({
      where: { id: "artifact-123" },
      data: {
        content: expect.objectContaining({
          url: "https://github.com/stakwork/senza-lnd/pull/7632",
          repo: "stakwork/senza-lnd",
          status: "DONE",
          progress: expect.objectContaining({
            state: "healthy",
          }),
        }),
      },
    });

    expect(stats).toMatchObject({
      checked: 1,
      healthy: 1,
      errors: 0,
    });
  });
});
