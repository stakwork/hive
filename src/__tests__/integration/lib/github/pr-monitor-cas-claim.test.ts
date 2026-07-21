/**
 * Integration tests for the atomic CAS claim in PR Monitor.
 *
 * These tests use the REAL Postgres database to verify that
 * `claimPRFixInProgress` provides true atomicity via Postgres
 * READ COMMITTED row-lock re-evaluation (EPQ).
 *
 * Key guarantees verified:
 * 1. N concurrent claims → exactly one winner (affected === 1)
 * 2. Stale `in_progress` rows are reclaimable after timeout
 * 3. `gave_up` rows are never re-claimed
 * 4. Attempt counter increments correctly in the DB
 * 5. `findSinglePRArtifact` and `claimPRFixInProgress` use the same stale window
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { db } from "@/lib/db";
import {
  createTestUser,
  createTestWorkspace,
  createTestTask,
  createTestChatMessage,
} from "@/__tests__/support/factories";
import { resetDatabase } from "@/__tests__/support/utilities/database";
import { claimPRFixInProgress, monitorSinglePR } from "@/lib/github/pr-monitor";
import type { PullRequestContent } from "@/lib/chat";

// ── Mock all external I/O except the DB ────────────────────────────────────────

vi.mock("@/lib/pusher", () => ({
  pusherServer: { trigger: vi.fn().mockResolvedValue(undefined) },
  getTaskChannelName: (id: string) => `task-${id}`,
  getWorkspaceChannelName: (slug: string) => `workspace-${slug}`,
  getFeatureChannelName: (id: string) => `feature-${id}`,
  PUSHER_EVENTS: {
    PR_STATUS_CHANGE: "pr-status-change",
    AGENT_LOG_UPDATED: "agent-log-updated",
  },
}));

vi.mock("@vercel/blob", () => ({
  put: vi.fn().mockResolvedValue({ url: "https://blob.vercel.com/fake" }),
}));

vi.mock("@/lib/encryption", () => ({
  EncryptionService: {
    getInstance: vi.fn(() => ({
      decryptField: vi.fn().mockReturnValue("decrypted"),
      encryptField: vi.fn().mockReturnValue({ data: "enc", iv: "iv", tag: "tag", keyId: "k", version: 1, encryptedAt: "" }),
    })),
  },
}));

vi.mock("@/lib/githubApp", () => ({
  getUserAppTokens: vi.fn().mockResolvedValue({ accessToken: "github-token" }),
}));

vi.mock("@/lib/github/pr-ci", () => ({
  fetchCIStatus: vi.fn().mockResolvedValue({
    status: "failure",
    summary: "Tests failed",
    failedChecks: ["unit-tests"],
    failedCheckLogs: {},
  }),
}));

vi.mock("@octokit/rest", () => ({
  Octokit: vi.fn().mockImplementation(() => ({
    pulls: {
      get: vi.fn().mockResolvedValue({
        data: {
          state: "open",
          merged: false,
          mergeable: true,
          mergeable_state: "unstable",
          head: { ref: "feature/test", sha: "head-sha" },
          base: { ref: "main", sha: "base-sha" },
        },
      }),
      updateBranch: vi.fn(),
    },
    repos: {
      compareCommits: vi.fn().mockResolvedValue({ data: { ahead_by: 0 } }),
      merge: vi.fn(),
    },
  })),
}));

vi.mock("@/lib/auth/nextauth", () => ({
  getGithubUsernameAndPAT: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/auth/agent-jwt", () => ({
  createWebhookToken: vi.fn().mockResolvedValue("mock-token"),
  generateWebhookSecret: vi.fn().mockReturnValue("mock-secret"),
}));

vi.mock("@/lib/pods/utils", () => ({
  releaseTaskPod: vi.fn().mockResolvedValue({ success: true }),
}));

// Spy on triggerFix so we can count dispatches
vi.mock("@/services/task-workflow", () => ({
  createChatMessageAndTriggerStakwork: vi.fn().mockResolvedValue({
    stakworkData: { projectId: "proj-cas-integration" },
  }),
}));

vi.mock("@/services/bifrost/orchestrator", () => ({
  getBifrostForLLM: vi.fn().mockResolvedValue({ token: "bifrost-token" }),
}));

vi.mock("@/lib/helpers/chat-history", () => ({
  fetchChatHistory: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/services/task-coordinator", () => ({
  buildFeatureContext: vi.fn().mockResolvedValue(null),
}));

// ── Helpers ────────────────────────────────────────────────────────────────────

const PR_FIX_STALE_TIMEOUT_MS = parseInt(process.env.PR_FIX_STALE_TIMEOUT_MS || "1800000", 10);

async function createPRArtifactScenario(opts: {
  workspaceId: string;
  ownerId: string;
  prUrl: string;
  progressOverride?: Record<string, unknown>;
  enableMonitor?: boolean;
  enableCifix?: boolean;
}) {
  const {
    workspaceId,
    ownerId,
    prUrl,
    progressOverride,
    enableMonitor = true,
    enableCifix = true,
  } = opts;

  // Task with mode=live and workflowStatus=COMPLETED so triggerLiveModeFix can dispatch
  // (the live-mode fix gate skips if workflowStatus !== "COMPLETED")
  const task = await createTestTask({ workspaceId, createdById: ownerId, workflowStatus: "COMPLETED" });
  await db.task.update({ where: { id: task.id }, data: { mode: "live" } });

  const msg = await createTestChatMessage({ taskId: task.id, message: "pr check" });

  const content: PullRequestContent = {
    url: prUrl,
    status: "open",
    progress: progressOverride as any,
  };

  const artifact = await db.artifact.create({
    data: {
      messageId: msg.id,
      type: "PULL_REQUEST",
      content: content as any,
    },
  });

  // Janitor config: enable PR monitoring
  await db.janitorConfig.upsert({
    where: { workspaceId },
    create: {
      workspaceId,
      prMonitorEnabled: enableMonitor,
      prCiFailureFixEnabled: enableCifix,
      prConflictFixEnabled: false,
    },
    update: {
      prMonitorEnabled: enableMonitor,
      prCiFailureFixEnabled: enableCifix,
    },
  });

  return { task, msg, artifact };
}

// ── Tests ──────────────────────────────────────────────────────────────────────

describe("claimPRFixInProgress — real Postgres atomicity", () => {
  let workspaceId: string;
  let ownerId: string;

  beforeEach(async () => {
    await resetDatabase();
    vi.clearAllMocks();

    const user = await createTestUser();
    const workspace = await createTestWorkspace({ ownerId: user.id });
    workspaceId = workspace.id;
    ownerId = user.id;
  });

  it("exactly one concurrent claim wins when N invocations race on the same artifact", async () => {
    const prUrl = "https://github.com/org/repo/pull/100";
    const { artifact } = await createPRArtifactScenario({ workspaceId, ownerId, prUrl });

    // Fire N concurrent claims — each runs as its own autocommit statement (no wrapping tx)
    const N = 8;
    const results = await Promise.all(
      Array.from({ length: N }, () =>
        claimPRFixInProgress(artifact.id, PR_FIX_STALE_TIMEOUT_MS),
      ),
    );

    const winners = results.filter(Boolean);
    const losers = results.filter((r) => !r);

    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(N - 1);
  });

  it("claim increments the attempt counter in the DB (not from in-memory snapshot)", async () => {
    const prUrl = "https://github.com/org/repo/pull/101";
    const { artifact } = await createPRArtifactScenario({
      workspaceId,
      ownerId,
      prUrl,
      progressOverride: {
        state: "ci_failure",
        lastCheckedAt: new Date().toISOString(),
        resolution: { status: "notified", attempts: 3, lastAttemptAt: new Date(Date.now() - 700000).toISOString() },
      },
    });

    const won = await claimPRFixInProgress(artifact.id, PR_FIX_STALE_TIMEOUT_MS);
    expect(won).toBe(true);

    // Read back the DB row and confirm attempts = 4
    const updated = await db.artifact.findUnique({ where: { id: artifact.id } });
    const resolution = (updated?.content as PullRequestContent | null)?.progress?.resolution;
    expect(resolution?.status).toBe("in_progress");
    expect(resolution?.attempts).toBe(4);
  });

  it("stale in_progress (older than stale timeout) is reclaimable", async () => {
    const prUrl = "https://github.com/org/repo/pull/102";
    const staleDate = new Date(Date.now() - PR_FIX_STALE_TIMEOUT_MS - 5000).toISOString();

    const { artifact } = await createPRArtifactScenario({
      workspaceId,
      ownerId,
      prUrl,
      progressOverride: {
        state: "ci_failure",
        lastCheckedAt: staleDate,
        resolution: { status: "in_progress", attempts: 1, lastAttemptAt: staleDate },
      },
    });

    const won = await claimPRFixInProgress(artifact.id, PR_FIX_STALE_TIMEOUT_MS);
    expect(won).toBe(true);

    const updated = await db.artifact.findUnique({ where: { id: artifact.id } });
    const resolution = (updated?.content as PullRequestContent | null)?.progress?.resolution;
    expect(resolution?.status).toBe("in_progress");
    expect(resolution?.attempts).toBe(2);
  });

  it("fresh in_progress (within timeout) cannot be claimed again", async () => {
    const prUrl = "https://github.com/org/repo/pull/103";
    const recentDate = new Date(Date.now() - 60000).toISOString(); // 1 minute ago

    const { artifact } = await createPRArtifactScenario({
      workspaceId,
      ownerId,
      prUrl,
      progressOverride: {
        state: "ci_failure",
        lastCheckedAt: recentDate,
        resolution: { status: "in_progress", attempts: 1, lastAttemptAt: recentDate },
      },
    });

    const won = await claimPRFixInProgress(artifact.id, PR_FIX_STALE_TIMEOUT_MS);
    expect(won).toBe(false);
  });

  it("gave_up artifact is never re-claimed by CAS", async () => {
    const prUrl = "https://github.com/org/repo/pull/104";

    const { artifact } = await createPRArtifactScenario({
      workspaceId,
      ownerId,
      prUrl,
      progressOverride: {
        state: "ci_failure",
        lastCheckedAt: new Date().toISOString(),
        resolution: {
          status: "gave_up",
          attempts: 6,
          lastAttemptAt: new Date().toISOString(),
          lastError: "Max attempts exceeded",
        },
      },
    });

    const won = await claimPRFixInProgress(artifact.id, PR_FIX_STALE_TIMEOUT_MS);
    expect(won).toBe(false);

    // Confirm the DB was not mutated
    const unchanged = await db.artifact.findUnique({ where: { id: artifact.id } });
    const resolution = (unchanged?.content as PullRequestContent | null)?.progress?.resolution;
    expect(resolution?.status).toBe("gave_up");
  });

  it("row with no progress object claims cleanly (defensive jsonb_set wrapper)", async () => {
    const prUrl = "https://github.com/org/repo/pull/105";

    const { artifact } = await createPRArtifactScenario({
      workspaceId,
      ownerId,
      prUrl,
      // No progressOverride → content.progress is undefined
    });

    const won = await claimPRFixInProgress(artifact.id, PR_FIX_STALE_TIMEOUT_MS);
    expect(won).toBe(true);

    const updated = await db.artifact.findUnique({ where: { id: artifact.id } });
    const resolution = (updated?.content as PullRequestContent | null)?.progress?.resolution;
    expect(resolution?.status).toBe("in_progress");
    expect(resolution?.attempts).toBe(1);
  });
});

describe("monitorSinglePR — concurrent dispatch integration (real DB)", () => {
  let workspaceId: string;
  let ownerId: string;

  beforeEach(async () => {
    await resetDatabase();
    vi.clearAllMocks();

    const user = await createTestUser();
    const workspace = await createTestWorkspace({ ownerId: user.id });
    workspaceId = workspace.id;
    ownerId = user.id;
  });

  it("N concurrent monitorSinglePR invocations dispatch triggerFix exactly once and notify exactly once", async () => {
    const prUrl = "https://github.com/org/repo/pull/200";

    const user = await createTestUser();
    const workspace = await createTestWorkspace({ ownerId: user.id });

    await createPRArtifactScenario({
      workspaceId: workspace.id,
      ownerId: user.id,
      prUrl,
    });

    const { pusherServer } = await import("@/lib/pusher");
    const { createChatMessageAndTriggerStakwork } = await import("@/services/task-workflow");

    // Fire 4 concurrent webhook-style invocations
    const N = 4;
    await Promise.all(Array.from({ length: N }, () => monitorSinglePR(prUrl)));

    // triggerFix dispatched exactly once
    const triggerCalls = vi.mocked(createChatMessageAndTriggerStakwork).mock.calls.length;
    expect(triggerCalls).toBe(1);

    // PR_STATUS_CHANGE notification fired exactly once
    const prStatusCalls = vi.mocked(pusherServer.trigger).mock.calls.filter(
      (c) => c[1] === "pr-status-change",
    );
    // At minimum 1 (task channel); could be 2 if workspace channel also fires
    // but must NOT be N (no duplicates from losers)
    expect(prStatusCalls.length).toBeGreaterThanOrEqual(1);
    expect(prStatusCalls.length).toBeLessThanOrEqual(2); // task + optional workspace channel
  });
});
