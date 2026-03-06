import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("@/lib/db", () => ({
  db: {
    workspace: { findFirst: vi.fn() },
  },
}));

vi.mock("@/lib/utils/swarm", () => ({
  transformSwarmUrlToRepo2Graph: vi.fn((url: string) =>
    url ? url.replace("/api", ":3355") : "",
  ),
}));

vi.mock("@/lib/encryption", () => ({
  EncryptionService: {
    getInstance: vi.fn(() => ({
      decryptField: vi.fn((_field: string, value: string) => `decrypted:${value}`),
    })),
  },
}));

// Import after mocks
import { db } from "@/lib/db";
import { resolveExtraSwarms } from "@/services/roadmap/feature-chat";

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeWorkspace(overrides: Record<string, unknown> = {}) {
  return {
    id: "ws-1",
    slug: "my-workspace",
    deleted: false,
    ownerId: "user-1",
    swarm: {
      id: "swarm-1",
      swarmUrl: "https://swarm.example.com/api",
      swarmApiKey: "encrypted-key",
    },
    repositories: [
      { repositoryUrl: "https://github.com/org/repo1" },
      { repositoryUrl: "https://github.com/org/repo2" },
    ],
    ...overrides,
  };
}

const mockFindFirst = vi.mocked(db.workspace.findFirst as ReturnType<typeof vi.fn>);

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("resolveExtraSwarms", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns swarm creds for a slug the user is a member of", async () => {
    mockFindFirst.mockResolvedValueOnce(makeWorkspace());

    const result = await resolveExtraSwarms("hello @my-workspace world", "user-1");

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      name: "my-workspace",
      url: "https://swarm.example.com:3355",
      apiKey: "decrypted:encrypted-key",
      repoUrls: "https://github.com/org/repo1,https://github.com/org/repo2",
      toolsConfig: {
        learn_concepts: true,
      },
    });
  });

  it("skips a slug the user is not a member of (workspace not found)", async () => {
    mockFindFirst.mockResolvedValueOnce(null);

    const result = await resolveExtraSwarms("check @unknown-slug here", "user-1");

    expect(result).toHaveLength(0);
  });

  it("skips a workspace with no configured swarm", async () => {
    mockFindFirst.mockResolvedValueOnce(
      makeWorkspace({ swarm: null }),
    );

    const result = await resolveExtraSwarms("hi @no-swarm-ws", "user-1");

    expect(result).toHaveLength(0);
  });

  it("skips a workspace with no repositories", async () => {
    mockFindFirst.mockResolvedValueOnce(
      makeWorkspace({ repositories: [] }),
    );

    const result = await resolveExtraSwarms("hi @empty-repos-ws", "user-1");

    expect(result).toHaveLength(0);
  });

  it("deduplicates the same slug mentioned multiple times", async () => {
    mockFindFirst.mockResolvedValueOnce(makeWorkspace());

    const result = await resolveExtraSwarms(
      "@my-workspace and @my-workspace again",
      "user-1",
    );

    // findFirst only called once due to dedup
    expect(mockFindFirst).toHaveBeenCalledTimes(1);
    expect(result).toHaveLength(1);
  });

  it("returns results for multiple distinct slugs", async () => {
    mockFindFirst
      .mockResolvedValueOnce(makeWorkspace({ slug: "ws-a" }))
      .mockResolvedValueOnce(
        makeWorkspace({
          slug: "ws-b",
          repositories: [{ repositoryUrl: "https://github.com/org/repo-b" }],
        }),
      );

    const result = await resolveExtraSwarms(
      "compare @ws-a with @ws-b",
      "user-1",
    );

    expect(result).toHaveLength(2);
  });

  it("returns an empty array when there are no @ mentions", async () => {
    const result = await resolveExtraSwarms("no mentions here", "user-1");

    expect(mockFindFirst).not.toHaveBeenCalled();
    expect(result).toHaveLength(0);
  });

  it("silently skips a slug that causes a DB error", async () => {
    mockFindFirst.mockRejectedValueOnce(new Error("DB failure"));

    const result = await resolveExtraSwarms("@bad-slug", "user-1");

    expect(result).toHaveLength(0);
  });
});
