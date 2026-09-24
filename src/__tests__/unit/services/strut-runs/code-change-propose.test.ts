/**
 * Unit tests for the `code_change_propose` completion handler
 * (`services/strut-runs/code-change-propose.ts`).
 *
 * Themes:
 *   - `success` runs REAL hive hygiene on `output.diff` (parse, caps,
 *     secrets) and patches the card `ready` with hive's own sha256 and
 *     file count, `baseBranchDisplay` from strut, `pending` removed;
 *   - `filesChanged: 0` is a SUCCESS run with nothing to propose → failed;
 *   - a secrets hit discards the diff from the card AND the row;
 *   - error / cancelled / LOST → failed / cancelled with the message;
 *   - the Stop button's active-run entry is cleared; a row with no card
 *     patches nothing.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import crypto from "crypto";

const { mockPatch, mockUpdate, mockClearActiveRun, mockNotifyRunActive } = vi.hoisted(() => ({
  mockPatch: vi.fn(),
  mockUpdate: vi.fn(),
  mockClearActiveRun: vi.fn(),
  mockNotifyRunActive: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ db: { strutRun: { update: mockUpdate } } }));
vi.mock("@/services/canvas-turn-persistence", () => ({ patchStoredProposalPreview: mockPatch }));
vi.mock("@/services/canvas-active-runs-hooks", () => ({
  clearActiveRun: mockClearActiveRun,
  notifyRunActive: mockNotifyRunActive,
}));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { handleCodeChangeProposeSettled, previewPatchForRow } from "@/services/strut-runs/code-change-propose";

const DIFF = [
  "diff --git a/src/a.ts b/src/a.ts",
  "--- a/src/a.ts",
  "+++ b/src/a.ts",
  "@@ -1,2 +1,2 @@",
  " const a = 1;",
  "-const b = 2;",
  "+const b = 3;",
  "",
].join("\n");

const sha = (t: string) => crypto.createHash("sha256").update(t, "utf8").digest("hex");

function row(over: Record<string, unknown> = {}) {
  return {
    id: "row-1",
    workspaceId: "ws-1",
    swarmId: "swarm-1",
    userId: "user-1",
    kind: "code_change_propose",
    workflow: "code-change-propose",
    strutRunId: "1790000000000",
    status: "SUCCESS",
    input: { repo: "https://github.com/acme/widgets", prompt: "p" },
    output: { diff: DIFF, diffSha256: "strut-says", filesChanged: 1, files: ["src/a.ts"], baseBranch: "main", baseSha: "abc" },
    error: null,
    durationMs: 100,
    conversationId: "conv-1",
    proposalId: "prop-1",
    createdAt: new Date(),
    settledAt: new Date(),
    ...over,
  } as Parameters<typeof previewPatchForRow>[0];
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPatch.mockResolvedValue(true);
  mockUpdate.mockResolvedValue({});
  mockClearActiveRun.mockResolvedValue({ wasLast: true });
  mockNotifyRunActive.mockResolvedValue(undefined);
});

describe("previewPatchForRow", () => {
  it("success → ready, with hive's own sha256 + file count and strut's base branch", () => {
    const { patch, scrubOutput } = previewPatchForRow(row());
    expect(scrubOutput).toBe(false);
    expect(patch).toEqual({
      preview: "ready",
      pending: undefined,
      failure: undefined,
      diff: DIFF.trimEnd(),
      diffSha256: sha(DIFF.trimEnd()),
      filesChanged: 1,
      baseBranchDisplay: "main",
    });
    expect(patch.diffSha256).not.toBe("strut-says");
  });

  it("filesChanged: 0 is nothing to propose", () => {
    const { patch } = previewPatchForRow(row({ output: { diff: "", filesChanged: 0 } }));
    expect(patch).toMatchObject({ preview: "failed", failure: expect.stringContaining("without changing any files") });
    expect(patch.diff).toBeUndefined();
  });

  it("an output that is not the workflow's shape is a failure, not a crash", () => {
    const { patch } = previewPatchForRow(row({ output: { nope: true } }));
    expect(patch).toMatchObject({ preview: "failed", failure: expect.stringContaining("unexpected result") });
  });

  it("a diff that is not a unified diff, or over the caps, fails with the reason", () => {
    expect(previewPatchForRow(row({ output: { diff: "just prose", filesChanged: 1 } })).patch).toMatchObject({
      preview: "failed",
      failure: expect.stringContaining("valid unified diff"),
    });
    const huge = Array.from({ length: 60 }, (_, i) =>
      [`--- a/f${i}.ts`, `+++ b/f${i}.ts`, "@@ -1 +1 @@", "-a", "+b"].join("\n"),
    ).join("\n");
    expect(previewPatchForRow(row({ output: { diff: huge, filesChanged: 60 } })).patch).toMatchObject({
      preview: "failed",
      failure: expect.stringContaining("too large"),
    });
  });

  it("a credential in the diff discards it and asks for the row to be scrubbed", () => {
    const secretDiff = [
      "--- a/.env",
      "+++ b/.env",
      "@@ -1 +1,2 @@",
      " X=1",
      "+AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      "",
    ].join("\n");
    const { patch, scrubOutput } = previewPatchForRow(row({ output: { diff: secretDiff, filesChanged: 1 } }));
    expect(scrubOutput).toBe(true);
    expect(patch).toMatchObject({ preview: "failed", failure: expect.stringContaining("credentials") });
    expect(JSON.stringify(patch)).not.toContain("wJalrXUtnFEMI");
  });

  it("error / cancelled / LOST carry the message", () => {
    expect(previewPatchForRow(row({ status: "ERROR", error: "git/checkout: clone failed" })).patch).toEqual({
      preview: "failed",
      failure: "git/checkout: clone failed",
      pending: undefined,
    });
    expect(previewPatchForRow(row({ status: "CANCELLED" })).patch).toMatchObject({ preview: "cancelled" });
    expect(previewPatchForRow(row({ status: "LOST" })).patch).toMatchObject({
      preview: "failed",
      failure: expect.stringContaining("lost track"),
    });
  });
});

describe("handleCodeChangeProposeSettled", () => {
  it("patches the stored card in place and clears the active run", async () => {
    await handleCodeChangeProposeSettled(row());
    expect(mockPatch).toHaveBeenCalledWith({
      conversationId: "conv-1",
      proposalId: "prop-1",
      patch: expect.objectContaining({ preview: "ready", diff: DIFF.trimEnd(), filesChanged: 1 }),
    });
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockClearActiveRun).toHaveBeenCalledWith("conv-1", "row-1");
    expect(mockNotifyRunActive).toHaveBeenCalledWith("conv-1", false);
  });

  it("scrubs the diff off the row when a credential was found", async () => {
    const secretDiff = ["--- a/.env", "+++ b/.env", "@@ -1 +1,2 @@", " X=1", "+AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY", ""].join("\n");
    await handleCodeChangeProposeSettled(row({ output: { diff: secretDiff, filesChanged: 1, files: [".env"] } }));
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: "row-1" },
      data: { output: { filesChanged: 1, files: [".env"], diff: "", discarded: "secrets_detected" } },
    });
    expect(mockPatch.mock.calls[0][0].patch).toMatchObject({ preview: "failed" });
  });

  it("a row with no card patches nothing and clears nothing", async () => {
    await handleCodeChangeProposeSettled(row({ conversationId: null, proposalId: null }));
    expect(mockPatch).not.toHaveBeenCalled();
    expect(mockClearActiveRun).not.toHaveBeenCalled();
  });

  it("a patch failure propagates (the caller retries); an active-run failure does not", async () => {
    mockPatch.mockRejectedValueOnce(new Error("db down"));
    await expect(handleCodeChangeProposeSettled(row())).rejects.toThrow("db down");
    mockClearActiveRun.mockRejectedValueOnce(new Error("pusher"));
    await expect(handleCodeChangeProposeSettled(row())).resolves.toBeUndefined();
  });
});
