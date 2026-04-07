import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { formatPRSummaryMessage, getMergedPRsForRepo, MergedPR, RepoPRs } from "@/lib/sphinx/daily-pr-summary";

function makePR(index: number): MergedPR {
  return {
    number: index,
    title: `PR title ${index}`,
    url: `https://github.com/org/repo/pull/${index}`,
    mergedAt: new Date("2026-03-13T10:00:00Z"),
  };
}

function makePRs(count: number): MergedPR[] {
  return Array.from({ length: count }, (_, i) => makePR(i + 1));
}

describe("getMergedPRsForRepo", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("includes per_page=100 in the GitHub Search API request URL", async () => {
    const mockFetch = vi.mocked(fetch);
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ items: [] }),
    } as Response);

    await getMergedPRsForRepo("org/repo", "test-token");

    expect(mockFetch).toHaveBeenCalledOnce();
    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain("per_page=100");
  });

  it("returns all 35 items when the API response contains 35 PRs", async () => {
    const mockItems = Array.from({ length: 35 }, (_, i) => ({
      number: i + 1,
      title: `PR ${i + 1}`,
      html_url: `https://github.com/org/repo/pull/${i + 1}`,
      pull_request: { merged_at: "2026-04-01T10:00:00Z" },
    }));

    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ items: mockItems }),
    } as Response);

    const result = await getMergedPRsForRepo("org/repo", "test-token");

    expect(result).toHaveLength(35);
  });
});

describe("formatPRSummaryMessage", () => {
  it("shows all PRs when there are ≤ 3 (exactly 3)", () => {
    const repoPRs: RepoPRs[] = [{ repoFullName: "org/repo", mergedPRs: makePRs(3) }];
    const result = formatPRSummaryMessage(repoPRs, "Test Workspace");

    expect(result).toContain("1. PR title 1");
    expect(result).toContain("2. PR title 2");
    expect(result).toContain("3. PR title 3");
    expect(result).not.toContain("... and");
  });

  it("shows all PRs when there are ≤ 3 (exactly 1)", () => {
    const repoPRs: RepoPRs[] = [{ repoFullName: "org/repo", mergedPRs: makePRs(1) }];
    const result = formatPRSummaryMessage(repoPRs, "Test Workspace");

    expect(result).toContain("1. PR title 1");
    expect(result).not.toContain("... and");
  });

  it("shows exactly 3 PRs + '... and 1 more' when there are 4 PRs", () => {
    const repoPRs: RepoPRs[] = [{ repoFullName: "org/repo", mergedPRs: makePRs(4) }];
    const result = formatPRSummaryMessage(repoPRs, "Test Workspace");

    expect(result).toContain("1. PR title 1");
    expect(result).toContain("2. PR title 2");
    expect(result).toContain("3. PR title 3");
    expect(result).not.toContain("4. PR title 4");
    expect(result).toContain("... and 1 more");
  });

  it("shows exactly 3 PRs + '... and 3 more' when there are 6 PRs", () => {
    const repoPRs: RepoPRs[] = [{ repoFullName: "org/repo", mergedPRs: makePRs(6) }];
    const result = formatPRSummaryMessage(repoPRs, "Test Workspace");

    expect(result).toContain("1. PR title 1");
    expect(result).toContain("2. PR title 2");
    expect(result).toContain("3. PR title 3");
    expect(result).not.toContain("4. PR title 4");
    expect(result).toContain("... and 3 more");
  });

  it("shows 'No pull requests were merged' when there are 0 PRs", () => {
    const repoPRs: RepoPRs[] = [{ repoFullName: "org/repo", mergedPRs: [] }];
    const result = formatPRSummaryMessage(repoPRs, "Test Workspace");

    expect(result).toContain("No pull requests were merged in the last 24 hours.");
    expect(result).not.toContain("... and");
  });

  it("applies truncation independently per repo with multiple repos", () => {
    const repoPRs: RepoPRs[] = [
      { repoFullName: "org/repo-a", mergedPRs: makePRs(5) },
      { repoFullName: "org/repo-b", mergedPRs: makePRs(2) },
    ];
    const result = formatPRSummaryMessage(repoPRs, "Test Workspace");

    // repo-a: 3 shown + "... and 2 more"
    expect(result).toContain("org/repo-a");
    expect(result).toContain("... and 2 more");

    // repo-b: all 2 shown, no truncation line for it
    expect(result).toContain("org/repo-b");
    // count occurrences of "... and" — should be exactly 1 (only repo-a)
    const truncationMatches = result.match(/\.\.\. and \d+ more/g);
    expect(truncationMatches).toHaveLength(1);
    expect(truncationMatches![0]).toBe("... and 2 more");
  });
});
