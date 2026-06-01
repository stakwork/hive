import { describe, test, expect } from "vitest";

// ---------------------------------------------------------------------------
// We test the pure logic extracted from mcpTools.ts without importing the
// module (which has heavy DB / Prisma dependencies). Instead we inline the
// relevant types and functions under test.
// ---------------------------------------------------------------------------

interface StatusItem {
  type: "feature" | "task";
  id: string;
  title: string;
  status: string;
  priority: string;
  workflowStatus: string | null;
  needsAttention: boolean;
  updatedAt: string;
  brief?: string | null;
  branch?: string | null;
}

function statusItemComparator(a: StatusItem, b: StatusItem): number {
  if (a.needsAttention !== b.needsAttention) {
    return a.needsAttention ? -1 : 1;
  }
  return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
}

function makeItem(
  overrides: Partial<StatusItem> & { id: string; updatedAt: string },
): StatusItem {
  return {
    type: "task",
    title: "Test item",
    status: "TODO",
    priority: "MEDIUM",
    workflowStatus: null,
    needsAttention: false,
    ...overrides,
  };
}

describe("statusItemComparator", () => {
  test("needsAttention=true sorts before needsAttention=false", () => {
    const attention = makeItem({
      id: "a",
      updatedAt: "2026-01-01T00:00:00Z",
      needsAttention: true,
    });
    const normal = makeItem({
      id: "b",
      updatedAt: "2026-01-02T00:00:00Z",
      needsAttention: false,
    });

    // Even though 'normal' has a newer updatedAt, 'attention' should come first
    expect(statusItemComparator(attention, normal)).toBeLessThan(0);
    expect(statusItemComparator(normal, attention)).toBeGreaterThan(0);
  });

  test("within needsAttention=true tier, newer updatedAt sorts first", () => {
    const older = makeItem({
      id: "a",
      updatedAt: "2026-01-01T00:00:00Z",
      needsAttention: true,
    });
    const newer = makeItem({
      id: "b",
      updatedAt: "2026-01-03T00:00:00Z",
      needsAttention: true,
    });

    expect(statusItemComparator(newer, older)).toBeLessThan(0);
    expect(statusItemComparator(older, newer)).toBeGreaterThan(0);
  });

  test("within needsAttention=false tier, newer updatedAt sorts first", () => {
    const older = makeItem({
      id: "a",
      updatedAt: "2026-01-01T00:00:00Z",
      needsAttention: false,
    });
    const newer = makeItem({
      id: "b",
      updatedAt: "2026-01-05T00:00:00Z",
      needsAttention: false,
    });

    expect(statusItemComparator(newer, older)).toBeLessThan(0);
    expect(statusItemComparator(older, newer)).toBeGreaterThan(0);
  });

  test("items with equal needsAttention and equal updatedAt compare as 0", () => {
    const a = makeItem({
      id: "a",
      updatedAt: "2026-02-15T12:00:00Z",
      needsAttention: true,
    });
    const b = makeItem({
      id: "b",
      updatedAt: "2026-02-15T12:00:00Z",
      needsAttention: true,
    });

    expect(statusItemComparator(a, b)).toBe(0);
  });

  test("full sort: mixed attention + recency produces correct order", () => {
    const items: StatusItem[] = [
      makeItem({
        id: "no-old",
        updatedAt: "2026-01-01T00:00:00Z",
        needsAttention: false,
      }),
      makeItem({
        id: "yes-old",
        updatedAt: "2026-01-02T00:00:00Z",
        needsAttention: true,
      }),
      makeItem({
        id: "no-new",
        updatedAt: "2026-01-05T00:00:00Z",
        needsAttention: false,
      }),
      makeItem({
        id: "yes-new",
        updatedAt: "2026-01-10T00:00:00Z",
        needsAttention: true,
      }),
    ];

    items.sort(statusItemComparator);

    expect(items.map((i) => i.id)).toEqual([
      "yes-new",
      "yes-old",
      "no-new",
      "no-old",
    ]);
  });
});

describe("needsAttention flag derivation", () => {
  // Mirror the mapping logic from fetchStatusItems
  function deriveNeedsAttention(workflowStatus: string | null): boolean {
    return workflowStatus === "COMPLETED";
  }

  test("workflowStatus === 'COMPLETED' yields needsAttention: true", () => {
    expect(deriveNeedsAttention("COMPLETED")).toBe(true);
  });

  test("workflowStatus === 'IN_PROGRESS' yields needsAttention: false", () => {
    expect(deriveNeedsAttention("IN_PROGRESS")).toBe(false);
  });

  test("workflowStatus === 'PENDING' yields needsAttention: false", () => {
    expect(deriveNeedsAttention("PENDING")).toBe(false);
  });

  test("workflowStatus === null yields needsAttention: false", () => {
    expect(deriveNeedsAttention(null)).toBe(false);
  });

  test("workflowStatus === 'FAILED' yields needsAttention: false", () => {
    expect(deriveNeedsAttention("FAILED")).toBe(false);
  });

  test("workflowStatus === 'HALTED' yields needsAttention: false", () => {
    expect(deriveNeedsAttention("HALTED")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// PR artifact status logic (mirrors mcpReadTask in mcpTools.ts)
// ---------------------------------------------------------------------------

interface PullRequestContent {
  repo: string;
  url: string;
  status: string;
}

const PR_STATUS_LABEL: Record<string, string> = {
  IN_PROGRESS: "open",
  DONE: "merged",
  CANCELLED: "closed",
};

function buildPullRequest(
  artifacts: Array<{ id: string; content: PullRequestContent }> | undefined,
) {
  const prArtifact = artifacts?.[0] ?? null;
  const prContent = prArtifact ? prArtifact.content : null;

  return prContent
    ? {
        id: prArtifact!.id,
        url: prContent.url,
        repo: prContent.repo,
        status: prContent.status,
        statusLabel: PR_STATUS_LABEL[prContent.status] ?? prContent.status,
      }
    : null;
}

describe("mcpReadTask pullRequest field", () => {
  test("returns null when no PULL_REQUEST artifact exists", () => {
    expect(buildPullRequest([])).toBeNull();
    expect(buildPullRequest(undefined)).toBeNull();
  });

  test("statusLabel is 'open' for IN_PROGRESS", () => {
    const result = buildPullRequest([
      {
        id: "art-1",
        content: {
          repo: "owner/repo",
          url: "https://github.com/owner/repo/pull/1",
          status: "IN_PROGRESS",
        },
      },
    ]);
    expect(result?.statusLabel).toBe("open");
    expect(result?.status).toBe("IN_PROGRESS");
  });

  test("statusLabel is 'merged' for DONE", () => {
    const result = buildPullRequest([
      {
        id: "art-2",
        content: {
          repo: "owner/repo",
          url: "https://github.com/owner/repo/pull/2",
          status: "DONE",
        },
      },
    ]);
    expect(result?.statusLabel).toBe("merged");
    expect(result?.status).toBe("DONE");
  });

  test("statusLabel is 'closed' for CANCELLED", () => {
    const result = buildPullRequest([
      {
        id: "art-3",
        content: {
          repo: "owner/repo",
          url: "https://github.com/owner/repo/pull/3",
          status: "CANCELLED",
        },
      },
    ]);
    expect(result?.statusLabel).toBe("closed");
    expect(result?.status).toBe("CANCELLED");
  });

  test("url and repo are passed through correctly", () => {
    const result = buildPullRequest([
      {
        id: "art-4",
        content: {
          repo: "myorg/myrepo",
          url: "https://github.com/myorg/myrepo/pull/42",
          status: "IN_PROGRESS",
        },
      },
    ]);
    expect(result?.id).toBe("art-4");
    expect(result?.url).toBe("https://github.com/myorg/myrepo/pull/42");
    expect(result?.repo).toBe("myorg/myrepo");
  });

  test("unknown status falls back to raw status value", () => {
    const result = buildPullRequest([
      {
        id: "art-5",
        content: {
          repo: "owner/repo",
          url: "https://github.com/owner/repo/pull/5",
          status: "UNKNOWN_STATE",
        },
      },
    ]);
    expect(result?.statusLabel).toBe("UNKNOWN_STATE");
  });
});
