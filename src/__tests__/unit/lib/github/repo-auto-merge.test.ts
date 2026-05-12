import { describe, it, expect, vi } from "vitest";
import { checkRepoAllowsAutoMerge } from "@/lib/github/repo-auto-merge";
import type { Octokit } from "@octokit/rest";

vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

function makeOctokit(
  response: { data: Record<string, unknown> } | { status: number; message?: string }
): Octokit {
  const get =
    "data" in response
      ? vi.fn().mockResolvedValue(response)
      : vi.fn().mockRejectedValue(Object.assign(new Error("GitHub error"), response));

  return {
    rest: { repos: { get } },
  } as unknown as Octokit;
}

describe("checkRepoAllowsAutoMerge", () => {
  it("returns { allowed: true } when GitHub returns allow_auto_merge: true", async () => {
    const octokit = makeOctokit({ data: { allow_auto_merge: true } });
    const result = await checkRepoAllowsAutoMerge(octokit, "owner", "repo");
    expect(result).toEqual({ allowed: true });
  });

  it("returns { allowed: false } when GitHub returns allow_auto_merge: false", async () => {
    const octokit = makeOctokit({ data: { allow_auto_merge: false } });
    const result = await checkRepoAllowsAutoMerge(octokit, "owner", "repo");
    expect(result).toEqual({ allowed: false });
  });

  it("returns { allowed: false } when allow_auto_merge is undefined/null", async () => {
    const octokit = makeOctokit({ data: { allow_auto_merge: null } });
    const result = await checkRepoAllowsAutoMerge(octokit, "owner", "repo");
    expect(result).toEqual({ allowed: false });
  });

  it("returns { allowed: false, error: 'permission_denied' } on 403", async () => {
    const octokit = makeOctokit({ status: 403, message: "Forbidden" });
    const result = await checkRepoAllowsAutoMerge(octokit, "owner", "repo");
    expect(result).toEqual({ allowed: false, error: "permission_denied" });
  });

  it("returns { allowed: false, error: 'not_found' } on 404", async () => {
    const octokit = makeOctokit({ status: 404, message: "Not Found" });
    const result = await checkRepoAllowsAutoMerge(octokit, "owner", "repo");
    expect(result).toEqual({ allowed: false, error: "not_found" });
  });

  it("returns { allowed: false, error: 'unknown' } on unexpected errors", async () => {
    const octokit = makeOctokit({ status: 500, message: "Server Error" });
    const result = await checkRepoAllowsAutoMerge(octokit, "owner", "repo");
    expect(result).toEqual({ allowed: false, error: "unknown" });
  });
});
