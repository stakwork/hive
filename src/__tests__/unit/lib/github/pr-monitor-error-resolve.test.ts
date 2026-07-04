/**
 * Unit tests: pr-monitor merge detection → ErrorIssue auto-resolve
 *
 * Verifies that when processOnePR detects a merged PR, it calls
 * autoResolveErrorIssuesForFeatures for the task's linked feature,
 * in the same run that it marks the task DONE — without disrupting the flow.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const mockAutoResolveErrorIssuesForFeatures = vi.fn();

// Mock the dynamic import of error-issues service
vi.mock("@/services/error-issues", () => ({
  autoResolveErrorIssuesForFeatures: mockAutoResolveErrorIssuesForFeatures,
}));

vi.mock("@/lib/db", () => ({
  db: {
    $queryRaw: vi.fn(),
    artifact: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    task: {
      update: vi.fn(),
      findUnique: vi.fn(),
    },
    chatMessage: {
      create: vi.fn(),
    },
    agentLog: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: "log-1", agent: "pr-monitor", createdAt: new Date() }),
      update: vi.fn().mockResolvedValue({ id: "log-1" }),
    },
  },
}));

vi.mock("@/lib/githubApp", () => ({
  getUserAppTokens: vi.fn().mockResolvedValue({ accessToken: "github-token" }),
}));

vi.mock("@/lib/pods/utils", () => ({
  releaseTaskPod: vi.fn().mockResolvedValue({ success: true, podDropped: false, taskCleared: false }),
}));

vi.mock("@/lib/pusher", () => ({
  pusherServer: { trigger: vi.fn().mockResolvedValue(undefined) },
  getTaskChannelName: vi.fn((id: string) => `task-${id}`),
  getWorkspaceChannelName: vi.fn((slug: string) => `workspace-${slug}`),
  getFeatureChannelName: vi.fn((id: string) => `feature-${id}`),
  PUSHER_EVENTS: {
    PR_STATUS_CHANGE: "pr-status-change",
    NEW_MESSAGE: "new-message",
    AGENT_LOG_UPDATED: "agent-log-updated",
  },
}));

vi.mock("@/lib/encryption", () => ({
  EncryptionService: {
    getInstance: vi.fn(() => ({
      decryptField: vi.fn().mockReturnValue("decrypted-secret"),
      encryptField: vi.fn().mockReturnValue({
        data: "enc",
        iv: "iv",
        tag: "tag",
        keyId: "kid",
        version: 1,
        encryptedAt: new Date().toISOString(),
      }),
    })),
  },
}));

vi.mock("@/lib/auth/agent-jwt", () => ({
  createWebhookToken: vi.fn().mockResolvedValue("mock-token"),
  generateWebhookSecret: vi.fn().mockReturnValue("mock-secret"),
}));

vi.mock("@/services/task-workflow", () => ({
  createChatMessageAndTriggerStakwork: vi.fn(),
}));

vi.mock("@/lib/github/pr-ci", () => ({
  fetchCIStatus: vi.fn().mockResolvedValue({
    status: "success",
    summary: "All checks passed",
    failedChecks: [],
    failedCheckLogs: {},
  }),
}));

vi.mock("@/lib/auth/nextauth", () => ({
  getGithubUsernameAndPAT: vi.fn(),
}));

vi.mock("@/services/scorer/pipeline", () => ({}));
vi.mock("@/lib/scorer/pipeline", () => ({
  checkAndTriggerFeatureCompletion: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@vercel/blob", () => ({
  put: vi.fn().mockResolvedValue({ url: "https://blob.vercel.com/fake" }),
}));

vi.mock("@octokit/rest", () => ({
  Octokit: vi.fn().mockImplementation(() => ({
    pulls: {
      get: vi.fn().mockResolvedValue({
        data: {
          state: "closed",
          merged: true,
          mergeable: null,
          mergeable_state: "unknown",
          head: { ref: "feature/fix", sha: "abc123" },
          base: { ref: "main", sha: "def456" },
        },
      }),
    },
    repos: {
      compareCommits: vi.fn().mockResolvedValue({ data: { ahead_by: 0 } }),
    },
  })),
}));

import { db } from "@/lib/db";
import { monitorOpenPRs } from "@/lib/github/pr-monitor";

const PR_URL = "https://github.com/test-owner/test-repo/pull/99";
const TASK_ID = "task-error-resolve-1";
const FEATURE_ID = "feature-error-resolve-1";
const ARTIFACT_ID = "artifact-error-resolve-1";

function makeArtifactRow() {
  return {
    id: ARTIFACT_ID,
    content: {
      url: PR_URL,
      repo: "test-owner/test-repo",
      status: "IN_PROGRESS",
    },
    task_id: TASK_ID,
    pod_id: null,
    workspace_id: "ws-error-resolve-1",
    owner_id: "owner-error-resolve-1",
    last_checked_at: null,
    pr_monitor_enabled: true,
    pr_conflict_fix_enabled: false,
    pr_ci_failure_fix_enabled: false,
    pr_out_of_date_fix_enabled: false,
    pr_use_rebase_for_updates: false,
  };
}

describe("monitorOpenPRs — merged PR triggers ErrorIssue auto-resolve", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockAutoResolveErrorIssuesForFeatures.mockResolvedValue({
      resolvedIssueIds: ["issue-1"],
    });

    vi.mocked(db.$queryRaw).mockResolvedValue([makeArtifactRow()]);
    vi.mocked(db.artifact.findUnique).mockResolvedValue({
      content: { url: PR_URL, repo: "test-owner/test-repo", status: "IN_PROGRESS" },
    } as any);
    vi.mocked(db.artifact.update).mockResolvedValue({} as any);
    vi.mocked(db.task.update).mockResolvedValue({} as any);

    // task.findUnique used for both scorer pipeline and error-resolve hooks
    vi.mocked(db.task.findUnique).mockResolvedValue({
      id: TASK_ID,
      featureId: FEATURE_ID,
    } as any);
  });

  it("calls autoResolveErrorIssuesForFeatures with the feature ID when PR is merged", async () => {
    const stats = await monitorOpenPRs(20);

    // Let async fire-and-forget tasks settle
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(stats.checked).toBe(1);
    expect(stats.healthy).toBe(1);
    expect(stats.errors).toBe(0);

    // Task must be marked DONE
    expect(db.task.update).toHaveBeenCalledWith({
      where: { id: TASK_ID },
      data: { status: "DONE" },
    });

    // Error resolve must fire with the feature ID
    expect(mockAutoResolveErrorIssuesForFeatures).toHaveBeenCalledWith([FEATURE_ID]);
  });

  it("does NOT call autoResolveErrorIssuesForFeatures when task has no featureId", async () => {
    // Override: task has no feature
    vi.mocked(db.task.findUnique).mockResolvedValue({
      id: TASK_ID,
      featureId: null,
    } as any);

    await monitorOpenPRs(20);
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(mockAutoResolveErrorIssuesForFeatures).not.toHaveBeenCalled();
  });

  it("does NOT disrupt PR monitor flow when autoResolveErrorIssuesForFeatures throws", async () => {
    mockAutoResolveErrorIssuesForFeatures.mockRejectedValue(new Error("resolve failed"));

    const stats = await monitorOpenPRs(20);
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Flow must complete normally despite the error
    expect(stats.checked).toBe(1);
    expect(stats.healthy).toBe(1);
    expect(stats.errors).toBe(0);

    // Task was still marked DONE
    expect(db.task.update).toHaveBeenCalledWith({
      where: { id: TASK_ID },
      data: { status: "DONE" },
    });
  });

  it("does NOT call autoResolveErrorIssuesForFeatures when PR is not merged", async () => {
    const { Octokit } = await import("@octokit/rest");
    vi.mocked(Octokit).mockImplementation(() => ({
      pulls: {
        get: vi.fn().mockResolvedValue({
          data: {
            state: "open",
            merged: false,
            mergeable: true,
            mergeable_state: "clean",
            head: { ref: "feature/fix", sha: "abc123" },
            base: { ref: "main", sha: "def456" },
          },
        }),
        updateBranch: vi.fn(),
      },
      repos: {
        compareCommits: vi.fn().mockResolvedValue({ data: { ahead_by: 0 } }),
        merge: vi.fn(),
      },
    } as any));

    await monitorOpenPRs(20);
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(mockAutoResolveErrorIssuesForFeatures).not.toHaveBeenCalled();
  });
});
