/**
 * Unit tests for `src/lib/github/pullRequestStatus.ts`
 * — `getPullRequestStatus(octokit, { owner, repo, number })`
 *
 * Covers:
 *   - state mapping: open/draft/merged/closed
 *   - checks: check-run conclusions → PullRequestCheck status
 *   - checks: legacy commit statuses
 *   - partial API failures (settled promises) — succeeds with partial checks
 *   - author, headBranch, baseBranch, title, headSha
 */

import { describe, it, expect, vi } from "vitest";
import { getPullRequestStatus } from "@/lib/github/pullRequestStatus";
import type { Octokit } from "@octokit/rest";

// ─── Helpers ────────────────────────────────────────────────────────────────

type DeepPartial<T> = { [K in keyof T]?: DeepPartial<T[K]> };

function makeOctokit(
  pr: Record<string, unknown>,
  checkRuns: unknown[] = [],
  statuses: unknown[] = [],
): Octokit {
  return {
    pulls: {
      get: vi.fn().mockResolvedValue({ data: pr }),
    },
    checks: {
      listForRef: vi.fn().mockResolvedValue({ data: { check_runs: checkRuns } }),
    },
    repos: {
      getCombinedStatusForRef: vi.fn().mockResolvedValue({ data: { statuses } }),
    },
  } as unknown as Octokit;
}

const BASE_PR = {
  state: "open",
  merged: false,
  draft: false,
  head: { ref: "feat/dark-mode", sha: "abc123" },
  base: { ref: "main" },
  user: { login: "alice" },
  title: "Dark mode",
};

// ─── State mapping ───────────────────────────────────────────────────────────

describe("getPullRequestStatus — state mapping", () => {
  it("open PR → 'open'", async () => {
    const octokit = makeOctokit(BASE_PR);
    const result = await getPullRequestStatus(octokit, { owner: "acme", repo: "app", number: 1 });
    expect(result.state).toBe("open");
  });

  it("open draft PR → 'draft'", async () => {
    const octokit = makeOctokit({ ...BASE_PR, draft: true });
    const result = await getPullRequestStatus(octokit, { owner: "acme", repo: "app", number: 1 });
    expect(result.state).toBe("draft");
  });

  it("closed merged PR → 'merged'", async () => {
    const octokit = makeOctokit({ ...BASE_PR, state: "closed", merged: true });
    const result = await getPullRequestStatus(octokit, { owner: "acme", repo: "app", number: 1 });
    expect(result.state).toBe("merged");
  });

  it("closed unmerged PR → 'closed'", async () => {
    const octokit = makeOctokit({ ...BASE_PR, state: "closed", merged: false });
    const result = await getPullRequestStatus(octokit, { owner: "acme", repo: "app", number: 1 });
    expect(result.state).toBe("closed");
  });
});

// ─── Metadata ────────────────────────────────────────────────────────────────

describe("getPullRequestStatus — metadata", () => {
  it("returns headSha, branches, author, title", async () => {
    const octokit = makeOctokit(BASE_PR);
    const result = await getPullRequestStatus(octokit, { owner: "acme", repo: "app", number: 42 });
    expect(result.headSha).toBe("abc123");
    expect(result.headBranch).toBe("feat/dark-mode");
    expect(result.baseBranch).toBe("main");
    expect(result.author).toBe("alice");
    expect(result.title).toBe("Dark mode");
  });

  it("author is undefined when PR user is null", async () => {
    const octokit = makeOctokit({ ...BASE_PR, user: null });
    const result = await getPullRequestStatus(octokit, { owner: "acme", repo: "app", number: 1 });
    expect(result.author).toBeUndefined();
  });
});

// ─── Check-run conclusion mapping ───────────────────────────────────────────

describe("getPullRequestStatus — check-run conclusions", () => {
  it.each([
    ["success", "completed", "success", "success"],
    ["skipped", "completed", "skipped", "skipped"],
    ["neutral", "completed", "neutral", "skipped"],
    ["failure", "completed", "failure", "failure"],
    ["timed_out", "completed", "timed_out", "failure"],
    ["action_required", "completed", "action_required", "failure"],
    ["cancelled", "completed", "cancelled", "failure"],
    ["pending", "in_progress", null, "pending"],
    ["queued", "queued", null, "pending"],
  ])("conclusion=%s status=%s → %s", async (_label, status, conclusion, expected) => {
    const octokit = makeOctokit(BASE_PR, [
      { name: "CI", status, conclusion },
    ]);
    const result = await getPullRequestStatus(octokit, { owner: "acme", repo: "app", number: 1 });
    expect(result.checks).toHaveLength(1);
    expect(result.checks[0]).toEqual({ name: "CI", status: expected });
  });

  it("multiple check runs — all mapped", async () => {
    const octokit = makeOctokit(BASE_PR, [
      { name: "lint", status: "completed", conclusion: "success" },
      { name: "test", status: "completed", conclusion: "failure" },
      { name: "build", status: "in_progress", conclusion: null },
    ]);
    const result = await getPullRequestStatus(octokit, { owner: "acme", repo: "app", number: 1 });
    expect(result.checks).toEqual([
      { name: "lint", status: "success" },
      { name: "test", status: "failure" },
      { name: "build", status: "pending" },
    ]);
  });
});

// ─── Legacy commit statuses ──────────────────────────────────────────────────

describe("getPullRequestStatus — legacy commit statuses", () => {
  it("success/pending/failure/error → mapped", async () => {
    const octokit = makeOctokit(BASE_PR, [], [
      { context: "ci/travis", state: "success" },
      { context: "ci/circle", state: "pending" },
      { context: "ci/jenkins", state: "failure" },
      { context: "ci/codeship", state: "error" },
    ]);
    const result = await getPullRequestStatus(octokit, { owner: "acme", repo: "app", number: 1 });
    expect(result.checks).toEqual([
      { name: "ci/travis", status: "success" },
      { name: "ci/circle", status: "pending" },
      { name: "ci/jenkins", status: "failure" },
      { name: "ci/codeship", status: "failure" },
    ]);
  });
});

// ─── Partial API failures ────────────────────────────────────────────────────

describe("getPullRequestStatus — partial API failures", () => {
  it("check-run API failure → empty checks list (still returns PR data)", async () => {
    const octokit = {
      pulls: { get: vi.fn().mockResolvedValue({ data: BASE_PR }) },
      checks: { listForRef: vi.fn().mockRejectedValue(new Error("403")) },
      repos: { getCombinedStatusForRef: vi.fn().mockResolvedValue({ data: { statuses: [] } }) },
    } as unknown as Octokit;
    const result = await getPullRequestStatus(octokit, { owner: "acme", repo: "app", number: 1 });
    expect(result.state).toBe("open");
    expect(result.checks).toEqual([]);
  });

  it("combined status API failure → only check-run checks", async () => {
    const octokit = {
      pulls: { get: vi.fn().mockResolvedValue({ data: BASE_PR }) },
      checks: {
        listForRef: vi.fn().mockResolvedValue({
          data: { check_runs: [{ name: "test", status: "completed", conclusion: "success" }] },
        }),
      },
      repos: { getCombinedStatusForRef: vi.fn().mockRejectedValue(new Error("500")) },
    } as unknown as Octokit;
    const result = await getPullRequestStatus(octokit, { owner: "acme", repo: "app", number: 1 });
    expect(result.checks).toHaveLength(1);
    expect(result.checks[0].name).toBe("test");
  });

  it("PR API failure → throws", async () => {
    const octokit = {
      pulls: { get: vi.fn().mockRejectedValue(new Error("not found")) },
      checks: { listForRef: vi.fn() },
      repos: { getCombinedStatusForRef: vi.fn() },
    } as unknown as Octokit;
    await expect(
      getPullRequestStatus(octokit, { owner: "acme", repo: "app", number: 1 }),
    ).rejects.toThrow("not found");
  });
});
