/**
 * Unit tests for `codeChangeCompletion` — the single completion path for
 * async code-change claims (webhook + reconcile cron).
 *
 * Themes:
 *   - a terminal success runs the REAL `_processCompletedResult` hardening
 *     before anything persists (wrong-repo URLs and shape drift die here);
 *   - claim deletion happens ONLY on failure codes that prove no PR
 *     exists; `create_pr_not_called` (this feature's founding incident)
 *     keeps the claim;
 *   - every terminal outcome patches the stored conversation row so the
 *     proposal card leaves "PR in progress".
 */

// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockPatchStored, mockReconcilePr } = vi.hoisted(() => ({
  mockPatchStored: vi.fn(),
  mockReconcilePr: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    task: { delete: vi.fn(), update: vi.fn() },
    artifact: { findFirst: vi.fn(), create: vi.fn() },
    chatMessage: { findFirst: vi.fn() },
  },
}));
vi.mock("@/services/canvas-turn-persistence", () => ({
  patchStoredCodeChangeResult: mockPatchStored,
}));
vi.mock("@/lib/github/labels", () => ({
  addPrLabels: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
// Keep the hardening REAL; mock only the network-touching reconcile.
vi.mock("@/services/swarm/createPr", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/services/swarm/createPr")>();
  return { ...actual, reconcilePr: mockReconcilePr };
});

import {
  attachPrArtifact,
  completeClaimFromResult,
  markClaimRunFailed,
  reconcileClaim,
  DELETABLE_FAILURE_CODES,
} from "@/lib/proposals/codeChangeCompletion";
import { db } from "@/lib/db";

const TASK_ID = "task-claim-1";
const REPO_URL = "https://github.com/acme/widgets";

const CLAIM = {
  requestId: "req-1",
  repositoryUrl: REPO_URL,
  userId: "user-1",
  workspaceSlug: "ws",
  prBranch: "swarm/swarm-change-abcd1234",
  approvedPaths: ["src/a.ts"],
  conversationId: "conv-1",
  proposalId: "prop-1",
};

// A LandChangeSuccess that clears the real hardenPrResult (URL matches the
// approved repo; diff under caps; no secrets; paths ⊆ approvedPaths).
const VALID_PR = {
  ok: true,
  url: `${REPO_URL}/pull/42`,
  number: 42,
  branch: "swarm/swarm-change-abcd1234",
  base: "main",
  headSha: "abc123def456abc123def456abc123def456abc1",
  diff: [
    "--- a/src/a.ts",
    "+++ b/src/a.ts",
    "@@ -1 +1 @@",
    "-const a = 1;",
    "+const a = 2;",
    "",
  ].join("\n"),
  filesChanged: 1,
};

beforeEach(() => {
  vi.clearAllMocks();
  // No PULL_REQUEST artifact yet.
  vi.mocked(db.artifact.findFirst).mockResolvedValue(null as never);
  vi.mocked(db.task.update).mockResolvedValue({} as never);
  vi.mocked(db.task.delete).mockResolvedValue({} as never);
  vi.mocked(db.chatMessage.findFirst).mockResolvedValue({
    id: "msg-1",
    artifacts: [],
  } as never);
  vi.mocked(db.artifact.create).mockResolvedValue({} as never);
  mockPatchStored.mockResolvedValue(true);
});

describe("completeClaimFromResult — landed PR", () => {
  it("hardens, persists branch + artifact, and patches the stored card", async () => {
    const outcome = await completeClaimFromResult({
      taskId: TASK_ID,
      claim: CLAIM,
      rawResult: { pr: VALID_PR },
    });

    expect(outcome).toEqual({
      outcome: "landed",
      prUrl: VALID_PR.url,
      prNumber: 42,
    });
    expect(db.task.update).toHaveBeenCalledWith({
      where: { id: TASK_ID },
      data: { branch: VALID_PR.branch },
    });
    expect(db.artifact.create).toHaveBeenCalled();
    expect(mockPatchStored).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: "conv-1",
        proposalId: "prop-1",
        codeChange: expect.objectContaining({
          prUrl: VALID_PR.url,
          prNumber: 42,
          pathSetVerified: true,
        }),
        content: expect.stringContaining("Opened pull request"),
      }),
    );
    expect(db.task.delete).not.toHaveBeenCalled();
  });

  it("refuses a PR whose URL points at another repo (hardening is live)", async () => {
    const outcome = await completeClaimFromResult({
      taskId: TASK_ID,
      claim: CLAIM,
      rawResult: {
        pr: { ...VALID_PR, url: "https://github.com/evil/elsewhere/pull/1" },
      },
    });

    expect(outcome.outcome).toBe("failed");
    expect(db.artifact.create).not.toHaveBeenCalled();
    // pr_create_failed is non-deletable — a PR exists somewhere.
    expect(db.task.delete).not.toHaveBeenCalled();
  });

  it("no-ops when the claim already carries a PR artifact (webhook retry)", async () => {
    vi.mocked(db.artifact.findFirst).mockResolvedValue({ id: "a1" } as never);

    const outcome = await completeClaimFromResult({
      taskId: TASK_ID,
      claim: CLAIM,
      rawResult: { pr: VALID_PR },
    });

    expect(outcome).toEqual({ outcome: "already-complete" });
    expect(db.artifact.create).not.toHaveBeenCalled();
    expect(mockPatchStored).not.toHaveBeenCalled();
  });
});

describe("completeClaimFromResult — failures", () => {
  it("deletes the claim on a provably-no-PR failure and patches the card", async () => {
    const outcome = await completeClaimFromResult({
      taskId: TASK_ID,
      claim: CLAIM,
      rawResult: {
        pr: { ok: false, failure: "patch_conflict", diff: "", error: "x" },
      },
    });

    expect(outcome).toEqual({
      outcome: "failed",
      failureCode: "patch_conflict",
      claimDeleted: true,
    });
    expect(db.task.delete).toHaveBeenCalledWith({ where: { id: TASK_ID } });
    expect(mockPatchStored).toHaveBeenCalledWith(
      expect.objectContaining({
        codeChange: expect.objectContaining({ failureCode: "patch_conflict" }),
        content: expect.stringContaining("Code change failed"),
      }),
    );
  });

  it("KEEPS the claim on create_pr_not_called — a PR may exist", async () => {
    expect(DELETABLE_FAILURE_CODES.has("create_pr_not_called")).toBe(false);

    const outcome = await completeClaimFromResult({
      taskId: TASK_ID,
      claim: CLAIM,
      rawResult: {
        pr: {
          ok: false,
          failure: "create_pr_not_called",
          diff: "",
          error: "branch swarm/swarm-change-abcd1234 was never pushed",
        },
      },
    });

    expect(outcome).toEqual({
      outcome: "failed",
      failureCode: "create_pr_not_called",
      claimDeleted: false,
    });
    expect(db.task.delete).not.toHaveBeenCalled();
    expect(mockPatchStored).toHaveBeenCalled();
  });
});

describe("markClaimRunFailed", () => {
  it("patches the card and never deletes the claim", async () => {
    await markClaimRunFailed({ taskId: TASK_ID, claim: CLAIM, retryable: true });

    expect(db.task.delete).not.toHaveBeenCalled();
    expect(mockPatchStored).toHaveBeenCalledWith(
      expect.objectContaining({
        codeChange: expect.objectContaining({ failureCode: "swarm_run_failed" }),
      }),
    );
  });
});

describe("reconcileClaim", () => {
  it("adopts a PR found by reconcilePr: artifact + branch + card patch", async () => {
    mockReconcilePr.mockResolvedValue({
      outcome: "landed",
      prUrl: `${REPO_URL}/pull/9`,
      prNumber: 9,
    });

    const outcome = await reconcileClaim({ taskId: TASK_ID, claim: CLAIM });

    expect(outcome).toBe("landed");
    expect(db.task.update).toHaveBeenCalledWith({
      where: { id: TASK_ID },
      data: { branch: CLAIM.prBranch },
    });
    expect(db.artifact.create).toHaveBeenCalled();
    expect(mockPatchStored).toHaveBeenCalledWith(
      expect.objectContaining({
        codeChange: expect.objectContaining({
          prUrl: `${REPO_URL}/pull/9`,
          branch: CLAIM.prBranch,
        }),
      }),
    );
  });

  it("returns unknown untouched when reconcilePr finds nothing", async () => {
    mockReconcilePr.mockResolvedValue({ outcome: "unknown" });

    const outcome = await reconcileClaim({ taskId: TASK_ID, claim: CLAIM });

    expect(outcome).toBe("unknown");
    expect(db.artifact.create).not.toHaveBeenCalled();
    expect(mockPatchStored).not.toHaveBeenCalled();
    expect(db.task.delete).not.toHaveBeenCalled();
  });

  it("short-circuits when the claim already resolved", async () => {
    vi.mocked(db.artifact.findFirst).mockResolvedValue({ id: "a1" } as never);

    const outcome = await reconcileClaim({ taskId: TASK_ID, claim: CLAIM });

    expect(outcome).toBe("already-complete");
    expect(mockReconcilePr).not.toHaveBeenCalled();
  });
});

describe("attachPrArtifact", () => {
  const PR_URL = "https://github.com/acme/widgets/pull/7";
  const REPO_URL = "https://github.com/acme/widgets";

  it("targets the ASSISTANT message so the PR lands beside its diff", async () => {
    // A claim Task seeds two messages in one transaction — the USER prompt and
    // the ASSISTANT diff — so their createdAt can tie. Ordering alone could
    // hand back the prompt row; the role filter is what makes this decidable.
    vi.mocked(db.chatMessage.findFirst).mockResolvedValue({
      id: "msg-assistant",
      artifacts: [],
    } as never);

    await attachPrArtifact(TASK_ID, PR_URL, REPO_URL);

    expect(db.chatMessage.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { taskId: TASK_ID, role: "ASSISTANT" },
      }),
    );
    expect(db.artifact.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          messageId: "msg-assistant",
          type: "PULL_REQUEST",
        }),
      }),
    );
  });

  it("does not duplicate an artifact the webhook already attached", async () => {
    vi.mocked(db.chatMessage.findFirst).mockResolvedValue({
      id: "msg-assistant",
      artifacts: [{ id: "existing" }],
    } as never);

    await attachPrArtifact(TASK_ID, PR_URL, REPO_URL);

    expect(db.artifact.create).not.toHaveBeenCalled();
  });
});
