/**
 * Unit tests for the `code_change_land` completion handler
 * (`services/strut-runs/code-change-land.ts`).
 *
 * Themes:
 *   - `success` maps the run onto the `LandChangeResult` shape and goes
 *     through the REAL hardening (`_processCompletedResult`): the diff is
 *     the ROW's `input.diff`, trusted only once the run echoed its sha256;
 *     a wrong-repo URL dies there;
 *   - failure codes are a contract: the leading token of the error decides
 *     deletable (patch_conflict, no_push_permission) vs kept (push_rejected,
 *     pr_create_failed); anything else is `swarm_run_failed`, kept;
 *   - cancelled → aborted (kept); LOST → swarm_run_failed, retryable;
 *   - the claim is found by (workspaceId, proposalId) and must be THIS
 *     row's attempt; a missing claim or receipt throws (strut retries)
 *     unless the row settled long enough ago that the claim is gone;
 *   - idempotent: a claim with a PR artifact is left alone.
 */

// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from "vitest";
import crypto from "crypto";

const { mockPatchStored, mockReconcilePr } = vi.hoisted(() => ({
  mockPatchStored: vi.fn(),
  mockReconcilePr: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    task: { findFirst: vi.fn(), delete: vi.fn(), update: vi.fn() },
    artifact: { findFirst: vi.fn(), create: vi.fn() },
    chatMessage: { findFirst: vi.fn() },
  },
}));
vi.mock("@/services/canvas-turn-persistence", () => ({ patchStoredCodeChangeResult: mockPatchStored }));
vi.mock("@/lib/github/labels", () => ({ addPrLabels: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } }));
// Keep the hardening REAL; mock only the network-touching reconcile.
vi.mock("@/services/swarm/createPr", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/swarm/createPr")>();
  return { ...actual, reconcilePr: mockReconcilePr };
});

import { db } from "@/lib/db";
import {
  handleCodeChangeLandSettled,
  landDispositionForRow,
  landFailureToken,
} from "@/services/strut-runs/code-change-land";
import type { StrutRunRow } from "@/services/strut-runs";

const REPO_URL = "https://github.com/acme/widgets";
const TASK_ID = "task-claim-1";
const ROW_ID = "strut-row-abcdef";
const BRANCH = "jamie/prop-cc-1-abcdef";

const DIFF = [
  "--- a/src/a.ts",
  "+++ b/src/a.ts",
  "@@ -1,2 +1,2 @@",
  " const a = 1;",
  "-const b = 2;",
  "+const b = 3;",
].join("\n");

const sha = (t: string) => crypto.createHash("sha256").update(t, "utf8").digest("hex");

const INPUT = {
  repo: REPO_URL,
  baseBranch: "main",
  diff: DIFF,
  diffSha256: sha(DIFF),
  branch: BRANCH,
  title: "[Jamie] Bump b",
  body: "body",
};

const OUTPUT = {
  url: `${REPO_URL}/pull/42`,
  number: 42,
  branch: BRANCH,
  base: "main",
  headSha: "abc123def456abc123def456abc123def456abc1",
  filesChanged: 1,
  files: ["src/a.ts"],
  diffSha256: sha(DIFF),
};

const CLAIM = {
  requestId: ROW_ID,
  repositoryUrl: REPO_URL,
  userId: "user-1",
  workspaceSlug: "ws",
  prBranch: BRANCH,
  approvedPaths: ["src/a.ts"],
  conversationId: "conv-1",
  proposalId: "prop-cc-1",
  runner: "strut",
  strutRunId: "1790000000001",
  swarmId: "swarm-1",
};

function row(over: Record<string, unknown> = {}): StrutRunRow {
  return {
    id: ROW_ID,
    workspaceId: "ws-1",
    swarmId: "swarm-1",
    userId: "user-1",
    kind: "code_change_land",
    workflow: "code-change-land",
    strutRunId: "1790000000001",
    status: "SUCCESS",
    input: INPUT,
    output: OUTPUT,
    error: null,
    durationMs: 3000,
    conversationId: "conv-1",
    proposalId: "prop-cc-1",
    createdAt: new Date(),
    settledAt: new Date(),
    ...over,
  } as unknown as StrutRunRow;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(db.task.findFirst).mockResolvedValue({ id: TASK_ID, codeChangeClaim: CLAIM } as never);
  vi.mocked(db.task.update).mockResolvedValue({} as never);
  vi.mocked(db.task.delete).mockResolvedValue({} as never);
  // No PULL_REQUEST artifact yet.
  vi.mocked(db.artifact.findFirst).mockResolvedValue(null as never);
  vi.mocked(db.artifact.create).mockResolvedValue({} as never);
  vi.mocked(db.chatMessage.findFirst).mockResolvedValue({ id: "msg-1", artifacts: [] } as never);
  mockPatchStored.mockResolvedValue(true);
});

describe("landFailureToken", () => {
  it("reads the leading token and nothing else", () => {
    expect(landFailureToken("patch_conflict: hunk #1 FAILED at 12")).toBe("patch_conflict");
    expect(landFailureToken("push_rejected: ! [remote rejected]")).toBe("push_rejected");
    expect(landFailureToken("no_push_permission: 403 from GitHub")).toBe("no_push_permission");
    expect(landFailureToken("pr_create_failed: 422 Validation Failed")).toBe("pr_create_failed");
    expect(landFailureToken("pr_create_failed")).toBe("pr_create_failed");
    // Prose that merely mentions a code is not the code.
    expect(landFailureToken("git/checkout: clone failed (patch_conflict later?)")).toBeNull();
    expect(landFailureToken("patch_conflicted")).toBeNull();
    expect(landFailureToken(null)).toBeNull();
  });
});

describe("landDispositionForRow", () => {
  it("success → a LandChangeSuccess carrying the ROW's diff, once the sha matches", () => {
    const d = landDispositionForRow(row());
    expect(d).toEqual({
      kind: "result",
      rawResult: {
        pr: {
          ok: true,
          url: OUTPUT.url,
          number: 42,
          branch: BRANCH,
          base: "main",
          headSha: OUTPUT.headSha,
          diff: DIFF,
          filesChanged: 1,
        },
      },
    });
  });

  it("a sha256 the run did not echo back is a kept failure with its own code", () => {
    const d = landDispositionForRow(row({ output: { ...OUTPUT, diffSha256: sha("other bytes") } }));
    expect(d).toMatchObject({ kind: "result", rawResult: { pr: { ok: false, failure: "diff_mismatch", diff: "" } } });
  });

  it("an output or input that is not the contract's shape is a run failure (claim kept), not a crash", () => {
    expect(landDispositionForRow(row({ output: { nope: true } }))).toEqual({ kind: "run_failed", retryable: false });
    expect(landDispositionForRow(row({ input: null }))).toEqual({ kind: "run_failed", retryable: false });
  });

  it("error → the leading token becomes the failure code; anything else is a run failure", () => {
    for (const token of ["patch_conflict", "push_rejected", "no_push_permission", "pr_create_failed"]) {
      expect(landDispositionForRow(row({ status: "ERROR", error: `${token}: detail` }))).toEqual({
        kind: "result",
        rawResult: { pr: { ok: false, failure: token, diff: "", error: `${token}: detail` } },
      });
    }
    expect(landDispositionForRow(row({ status: "ERROR", error: "git/checkout: clone failed" }))).toEqual({
      kind: "run_failed",
      retryable: false,
    });
    expect(landDispositionForRow(row({ status: "ERROR", error: null }))).toEqual({ kind: "run_failed", retryable: false });
  });

  it("cancelled → aborted; LOST → a retryable run failure; PENDING → nothing", () => {
    expect(landDispositionForRow(row({ status: "CANCELLED" }))).toMatchObject({
      kind: "result",
      rawResult: { pr: { ok: false, failure: "aborted" } },
    });
    expect(landDispositionForRow(row({ status: "LOST" }))).toEqual({ kind: "run_failed", retryable: true });
    expect(landDispositionForRow(row({ status: "PENDING" }))).toEqual({ kind: "pending" });
  });
});

describe("handleCodeChangeLandSettled — landed PR", () => {
  it("clears the real hardening and persists branch + artifact + the card patch", async () => {
    await handleCodeChangeLandSettled(row());

    expect(db.task.findFirst).toHaveBeenCalledWith({
      where: { workspaceId: "ws-1", proposalId: "prop-cc-1", deleted: false },
      select: { id: true, codeChangeClaim: true },
    });
    expect(db.task.update).toHaveBeenCalledWith({ where: { id: TASK_ID }, data: { branch: BRANCH } });
    expect(db.artifact.create).toHaveBeenCalledTimes(1);
    expect(mockPatchStored).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: "conv-1",
        proposalId: "prop-cc-1",
        codeChange: expect.objectContaining({
          prUrl: OUTPUT.url,
          prNumber: 42,
          branch: BRANCH,
          baseBranch: "main",
          headSha: OUTPUT.headSha,
          filesChanged: 1,
          repositoryUrl: REPO_URL,
          pathSetVerified: true,
        }),
        content: expect.stringContaining("Opened pull request"),
      }),
    );
    expect(db.task.delete).not.toHaveBeenCalled();
  });

  it("refuses a PR URL for another repository (validatePrUrl is live) and keeps the claim", async () => {
    await handleCodeChangeLandSettled(row({ output: { ...OUTPUT, url: "https://github.com/evil/elsewhere/pull/1" } }));

    expect(db.artifact.create).not.toHaveBeenCalled();
    expect(db.task.delete).not.toHaveBeenCalled();
    expect(mockPatchStored).toHaveBeenCalledWith(
      expect.objectContaining({ codeChange: expect.objectContaining({ failureCode: "pr_create_failed" }) }),
    );
  });

  it("flags paths outside the approved set (the row's diff vs the claim's approvedPaths)", async () => {
    vi.mocked(db.task.findFirst).mockResolvedValue({
      id: TASK_ID,
      codeChangeClaim: { ...CLAIM, approvedPaths: ["src/other.ts"] },
    } as never);

    await handleCodeChangeLandSettled(row());

    expect(mockPatchStored).toHaveBeenCalledWith(
      expect.objectContaining({
        codeChange: expect.objectContaining({ pathSetVerified: false, unapprovedPaths: ["src/a.ts"] }),
      }),
    );
  });

  it("a sha mismatch keeps the claim and says so on the card", async () => {
    await handleCodeChangeLandSettled(row({ output: { ...OUTPUT, diffSha256: sha("other") } }));

    expect(db.artifact.create).not.toHaveBeenCalled();
    expect(db.task.delete).not.toHaveBeenCalled();
    expect(mockPatchStored).toHaveBeenCalledWith(
      expect.objectContaining({
        codeChange: expect.objectContaining({
          failureCode: "diff_mismatch",
          failureMessage: expect.stringContaining("checksum"),
        }),
      }),
    );
  });

  it("is a no-op when the claim already carries a PR artifact (a replayed callback)", async () => {
    vi.mocked(db.artifact.findFirst).mockResolvedValue({ id: "a1" } as never);

    await handleCodeChangeLandSettled(row());

    expect(db.artifact.create).not.toHaveBeenCalled();
    expect(mockPatchStored).not.toHaveBeenCalled();
  });
});

describe("handleCodeChangeLandSettled — failures", () => {
  it.each(["patch_conflict", "no_push_permission"])("%s deletes the claim so the user can re-approve", async (token) => {
    await handleCodeChangeLandSettled(row({ status: "ERROR", error: `${token}: detail` }));

    expect(db.task.delete).toHaveBeenCalledWith({ where: { id: TASK_ID } });
    expect(mockPatchStored).toHaveBeenCalledWith(
      expect.objectContaining({
        codeChange: expect.objectContaining({ failureCode: token }),
        content: expect.stringContaining("Code change failed"),
      }),
    );
    // Strut's raw error never reaches the card.
    expect(JSON.stringify(mockPatchStored.mock.calls[0][0])).not.toContain("detail");
  });

  it.each(["push_rejected", "pr_create_failed"])("%s keeps the claim — a branch or PR may exist", async (token) => {
    await handleCodeChangeLandSettled(row({ status: "ERROR", error: `${token}: detail` }));

    expect(db.task.delete).not.toHaveBeenCalled();
    expect(mockPatchStored).toHaveBeenCalledWith(
      expect.objectContaining({ codeChange: expect.objectContaining({ failureCode: token }) }),
    );
  });

  it("an error without a code token is swarm_run_failed, claim kept", async () => {
    await handleCodeChangeLandSettled(row({ status: "ERROR", error: "git/checkout: clone failed" }));

    expect(db.task.delete).not.toHaveBeenCalled();
    expect(mockPatchStored).toHaveBeenCalledWith(
      expect.objectContaining({
        codeChange: expect.objectContaining({
          failureCode: "swarm_run_failed",
          failureMessage: expect.stringContaining("failed before a PR could be verified"),
        }),
      }),
    );
  });

  it("cancelled → aborted, claim kept", async () => {
    await handleCodeChangeLandSettled(row({ status: "CANCELLED" }));

    expect(db.task.delete).not.toHaveBeenCalled();
    expect(mockPatchStored).toHaveBeenCalledWith(
      expect.objectContaining({ codeChange: expect.objectContaining({ failureCode: "aborted" }) }),
    );
  });

  it("LOST → swarm_run_failed, retryable wording, claim kept", async () => {
    await handleCodeChangeLandSettled(row({ status: "LOST", error: "strut has no record of the run" }));

    expect(db.task.delete).not.toHaveBeenCalled();
    expect(mockPatchStored).toHaveBeenCalledWith(
      expect.objectContaining({
        codeChange: expect.objectContaining({
          failureCode: "swarm_run_failed",
          failureMessage: expect.stringContaining("interrupted"),
        }),
      }),
    );
  });
});

describe("handleCodeChangeLandSettled — finding the claim", () => {
  it("throws when the claim is not there yet (the callback beat the approval's receipt)", async () => {
    vi.mocked(db.task.findFirst).mockResolvedValue(null as never);
    await expect(handleCodeChangeLandSettled(row())).rejects.toThrow(/claim task not found/);

    vi.mocked(db.task.findFirst).mockResolvedValue({ id: TASK_ID, codeChangeClaim: null } as never);
    await expect(handleCodeChangeLandSettled(row())).rejects.toThrow(/receipt not written/);
    expect(mockPatchStored).not.toHaveBeenCalled();
  });

  it("delivers nothing when the claim is long gone (deleted after a classified failure)", async () => {
    vi.mocked(db.task.findFirst).mockResolvedValue(null as never);
    await expect(
      handleCodeChangeLandSettled(row({ settledAt: new Date(Date.now() - 5 * 60_000) })),
    ).resolves.toBeUndefined();
    expect(mockPatchStored).not.toHaveBeenCalled();
  });

  it("ignores a row that is not the claim's attempt (a superseded approval)", async () => {
    vi.mocked(db.task.findFirst).mockResolvedValue({
      id: TASK_ID,
      codeChangeClaim: { ...CLAIM, requestId: "strut-row-newer" },
    } as never);

    await handleCodeChangeLandSettled(row({ status: "ERROR", error: "patch_conflict: stale" }));

    expect(db.task.delete).not.toHaveBeenCalled();
    expect(mockPatchStored).not.toHaveBeenCalled();
  });

  it("a row with no proposal delivers nothing", async () => {
    await handleCodeChangeLandSettled(row({ proposalId: null }));
    expect(db.task.findFirst).not.toHaveBeenCalled();
  });
});
