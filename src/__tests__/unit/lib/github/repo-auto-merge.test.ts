import { describe, it, expect, vi, beforeEach } from "vitest";
import { checkRepoAllowsAutoMerge, resolveAutoMergeDefault } from "@/lib/github/repo-auto-merge";
import type { Octokit } from "@octokit/rest";

vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// ── Mocks for resolveAutoMergeDefault ──────────────────────────────────────

const { mockDbUser, mockDbRepository } = vi.hoisted(() => ({
  mockDbUser: { findUnique: vi.fn() },
  mockDbRepository: { findUnique: vi.fn(), update: vi.fn() },
}));

vi.mock("@/lib/db", () => ({
  db: {
    user: mockDbUser,
    repository: mockDbRepository,
  },
}));

const { mockParsePRUrl, mockGetOctokitForWorkspace } = vi.hoisted(() => ({
  mockParsePRUrl: vi.fn(),
  mockGetOctokitForWorkspace: vi.fn(),
}));

vi.mock("@/lib/github/pr-monitor", () => ({
  parsePRUrl: (...args: unknown[]) => mockParsePRUrl(...args),
  getOctokitForWorkspace: (...args: unknown[]) => mockGetOctokitForWorkspace(...args),
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

// ── resolveAutoMergeDefault ────────────────────────────────────────────────

const mockReposGet = vi.fn();
const MOCK_OCTOKIT = { rest: { repos: { get: mockReposGet } } } as unknown as Octokit;

describe("resolveAutoMergeDefault", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns false when user not found", async () => {
    mockDbUser.findUnique.mockResolvedValue(null);

    const result = await resolveAutoMergeDefault("user-1", "repo-1");
    expect(result).toBe(false);
  });

  it("returns false when canvasAutonomousTurns is false", async () => {
    mockDbUser.findUnique.mockResolvedValue({ canvasAutonomousTurns: false });

    const result = await resolveAutoMergeDefault("user-1", "repo-1");
    expect(result).toBe(false);
    expect(mockDbRepository.findUnique).not.toHaveBeenCalled();
  });

  it("returns false when repositoryId is null", async () => {
    mockDbUser.findUnique.mockResolvedValue({ canvasAutonomousTurns: true });

    const result = await resolveAutoMergeDefault("user-1", null);
    expect(result).toBe(false);
    expect(mockDbRepository.findUnique).not.toHaveBeenCalled();
  });

  it("returns false when repository not found", async () => {
    mockDbUser.findUnique.mockResolvedValue({ canvasAutonomousTurns: true });
    mockDbRepository.findUnique.mockResolvedValue(null);

    const result = await resolveAutoMergeDefault("user-1", "repo-1");
    expect(result).toBe(false);
  });

  it("returns true immediately (cache hit) when allowAutoMerge is already true", async () => {
    mockDbUser.findUnique.mockResolvedValue({ canvasAutonomousTurns: true });
    mockDbRepository.findUnique.mockResolvedValue({
      repositoryUrl: "https://github.com/owner/repo",
      allowAutoMerge: true,
    });

    const result = await resolveAutoMergeDefault("user-1", "repo-1");
    expect(result).toBe(true);
    // No GitHub call should be made
    expect(mockParsePRUrl).not.toHaveBeenCalled();
    expect(mockGetOctokitForWorkspace).not.toHaveBeenCalled();
  });

  it("returns false when parsePRUrl fails to parse repositoryUrl", async () => {
    mockDbUser.findUnique.mockResolvedValue({ canvasAutonomousTurns: true });
    mockDbRepository.findUnique.mockResolvedValue({
      repositoryUrl: "not-a-valid-url",
      allowAutoMerge: false,
    });
    mockParsePRUrl.mockReturnValue(null);

    const result = await resolveAutoMergeDefault("user-1", "repo-1");
    expect(result).toBe(false);
    expect(mockGetOctokitForWorkspace).not.toHaveBeenCalled();
  });

  it("returns false when getOctokitForWorkspace returns null", async () => {
    mockDbUser.findUnique.mockResolvedValue({ canvasAutonomousTurns: true });
    mockDbRepository.findUnique.mockResolvedValue({
      repositoryUrl: "https://github.com/owner/repo",
      allowAutoMerge: false,
    });
    mockParsePRUrl.mockReturnValue({ owner: "owner", repo: "repo", prNumber: 1 });
    mockGetOctokitForWorkspace.mockResolvedValue(null);

    const result = await resolveAutoMergeDefault("user-1", "repo-1");
    expect(result).toBe(false);
  });

  it("returns true and caches the result when GitHub allows auto-merge", async () => {
    mockDbUser.findUnique.mockResolvedValue({ canvasAutonomousTurns: true });
    mockDbRepository.findUnique.mockResolvedValue({
      repositoryUrl: "https://github.com/owner/myrepo",
      allowAutoMerge: false,
    });
    mockParsePRUrl.mockReturnValue({ owner: "owner", repo: "myrepo", prNumber: 1 });
    mockGetOctokitForWorkspace.mockResolvedValue(MOCK_OCTOKIT);

    // checkRepoAllowsAutoMerge is called directly inside resolveAutoMergeDefault
    // We need to mock the octokit.rest.repos.get that checkRepoAllowsAutoMerge calls
    mockReposGet.mockResolvedValue({
      data: { allow_auto_merge: true },
    });

    const result = await resolveAutoMergeDefault("user-1", "repo-1");
    expect(result).toBe(true);
    expect(mockDbRepository.update).toHaveBeenCalledWith({
      where: { id: "repo-1" },
      data: { allowAutoMerge: true },
    });
  });

  it("returns false when GitHub does not allow auto-merge", async () => {
    mockDbUser.findUnique.mockResolvedValue({ canvasAutonomousTurns: true });
    mockDbRepository.findUnique.mockResolvedValue({
      repositoryUrl: "https://github.com/owner/myrepo",
      allowAutoMerge: false,
    });
    mockParsePRUrl.mockReturnValue({ owner: "owner", repo: "myrepo", prNumber: 1 });
    mockGetOctokitForWorkspace.mockResolvedValue(MOCK_OCTOKIT);
    mockReposGet.mockResolvedValue({
      data: { allow_auto_merge: false },
    });

    const result = await resolveAutoMergeDefault("user-1", "repo-1");
    expect(result).toBe(false);
    expect(mockDbRepository.update).not.toHaveBeenCalled();
  });

  it("returns false (fail-safe) when an unexpected error is thrown", async () => {
    mockDbUser.findUnique.mockRejectedValue(new Error("DB connection lost"));

    const result = await resolveAutoMergeDefault("user-1", "repo-1");
    expect(result).toBe(false);
  });

  it("returns false (fail-safe) when checkRepoAllowsAutoMerge throws", async () => {
    mockDbUser.findUnique.mockResolvedValue({ canvasAutonomousTurns: true });
    mockDbRepository.findUnique.mockResolvedValue({
      repositoryUrl: "https://github.com/owner/myrepo",
      allowAutoMerge: false,
    });
    mockParsePRUrl.mockReturnValue({ owner: "owner", repo: "myrepo", prNumber: 1 });
    mockGetOctokitForWorkspace.mockResolvedValue(MOCK_OCTOKIT);
    mockReposGet.mockRejectedValue(
      new Error("Network error")
    );

    const result = await resolveAutoMergeDefault("user-1", "repo-1");
    expect(result).toBe(false);
  });
});
