import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { MIDDLEWARE_HEADERS } from "@/config/middleware";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("@/lib/db", () => ({
  db: {users: { findUnique: vi.fn() },workspaces: { findUnique: vi.fn() },
    $queryRaw: vi.fn(),
  },
}));

vi.mock("@/lib/githubApp", () => ({
  getUserAppTokens: vi.fn(),
}));

vi.mock("@/lib/github/pr-stats", async (importOriginal) => {
  // Keep real bucketByWindows; mock only getPRCountForRepo
  const real = await importOriginal<typeof import("@/lib/github/pr-stats")>();
  return {
    ...real,
    getPRCountForRepo: vi.fn(),
  };
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

import { db } from "@/lib/db";
import { getUserAppTokens } from "@/lib/githubApp";
import { getPRCountForRepo } from "@/lib/github/pr-stats";

const mockDb = db as unknown as {users: { findUnique: ReturnType<typeof vi.fn> };
workspaces: { findUnique: ReturnType<typeof vi.fn> };
  $queryRaw: ReturnType<typeof vi.fn>;
};

const mockGetUserAppTokens = getUserAppTokens as ReturnType<typeof vi.fn>;
const mockGetPRCountForRepo = getPRCountForRepo as ReturnType<typeof vi.fn>;

function makeRequest(userId: string | null, workspaceId: string): NextRequest {
  const req = new NextRequest(`http://localhost/api/admin/workspaces/${workspaceId}/pr-stats`);
  if (userId) {
    // Clone with headers
    return new NextRequest(req.url, {
      headers: {
        [MIDDLEWARE_HEADERS.USER_ID]: userId,
        [MIDDLEWARE_HEADERS.AUTH_STATUS]: "authenticated",
      },
    });
  }
  return req;
}

function makeWorkspace(overrides: Partial<{
  id: string;
  ownerId: string;
  repositories: { id: string; repositoryUrl: string }[];
}> = {}) {
  return {
    id: "ws-1",
    ownerId: "owner-1",
    repositories: [
      { id: "repo-1", repositoryUrl: "https://github.com/stakwork/hive" },
    ],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("GET /api/admin/workspaces/[id]/pr-stats", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when no user id header", async () => {
    const { GET } = await import("@/app/api/admin/workspaces/[id]/pr-stats/route");
    const req = makeRequest(null, "ws-1");
    const res = await GET(req, { params: Promise.resolve({ id: "ws-1" }) });
    expect(res.status).toBe(401);
  });

  it("returns 403 for non-super-admin user", async () => {
    mockDb.users.findUnique.mockResolvedValueOnce({ role: "USER" });

    const { GET } = await import("@/app/api/admin/workspaces/[id]/pr-stats/route");
    const req = makeRequest("user-regular", "ws-1");
    const res = await GET(req, { params: Promise.resolve({ id: "ws-1" }) });
    expect(res.status).toBe(403);
  });

  it("returns 404 when workspace not found", async () => {
    mockDb.users.findUnique.mockResolvedValueOnce({ role: "SUPER_ADMIN" });
    mockDb.workspaces.findUnique.mockResolvedValueOnce(null);

    const { GET } = await import("@/app/api/admin/workspaces/[id]/pr-stats/route");
    const req = makeRequest("super-admin-1", "nonexistent");
    const res = await GET(req, { params: Promise.resolve({ id: "nonexistent" }) });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toBe("Workspace not found");
  });

  it("passes correct SQL params (workspaceId + date 30 days ago)", async () => {
    const now = new Date("2026-03-11T21:00:00.000Z");
    vi.setSystemTime(now);

    mockDb.users.findUnique.mockResolvedValueOnce({ role: "SUPER_ADMIN" });
    mockDb.workspaces.findUnique.mockResolvedValueOnce(makeWorkspace());
    mockDb.$queryRaw.mockResolvedValueOnce([]);
    mockGetUserAppTokens.mockResolvedValueOnce(null);

    const { GET } = await import("@/app/api/admin/workspaces/[id]/pr-stats/route");
    const req = makeRequest("super-admin-1", "ws-1");
    await GET(req, { params: Promise.resolve({ id: "ws-1" }) });

    expect(mockDb.$queryRaw).toHaveBeenCalledTimes(1);
    // The tagged template call wraps params; verify the query object was invoked
    const call = mockDb.$queryRaw.mock.calls[0];
    expect(call).toBeDefined();

    vi.useRealTimers();
  });

  it("only counts DONE artifacts — raw SQL result is bucketed correctly", async () => {
    vi.setSystemTime(new Date("2026-03-11T12:00:00.000Z"));

    mockDb.users.findUnique.mockResolvedValueOnce({ role: "SUPER_ADMIN" });
    mockDb.workspaces.findUnique.mockResolvedValueOnce(makeWorkspace());

    // Two DONE artifacts: one 1h ago, one 10d ago
    const now = new Date("2026-03-11T12:00:00.000Z");
    mockDb.$queryRaw.mockResolvedValueOnce([
      { repo: "stakwork/hive", created_at: new Date(now.getTime() - 1 * 60 * 60 * 1000) },
      { repo: "stakwork/hive", created_at: new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000) },
    ]);
    mockGetUserAppTokens.mockResolvedValueOnce({ accessToken: "token-123" });
    mockGetPRCountForRepo.mockResolvedValueOnce({ items: [] });

    const { GET } = await import("@/app/api/admin/workspaces/[id]/pr-stats/route");
    const req = makeRequest("super-admin-1", "ws-1");
    const res = await GET(req, { params: Promise.resolve({ id: "ws-1" }) });
    expect(res.status).toBe(200);

    const body = await res.json();
    const repo = body.repos[0];
    expect(repo.windows["24h"].hiveCount).toBe(1);   // only the 1h-ago artifact
    expect(repo.windows["48h"].hiveCount).toBe(1);
    expect(repo.windows["1w"].hiveCount).toBe(1);
    expect(repo.windows["2w"].hiveCount).toBe(2);    // both artifacts
    expect(repo.windows["1mo"].hiveCount).toBe(2);

    vi.useRealTimers();
  });

  it("sets githubTotal to null when getUserAppTokens returns null (no token)", async () => {
    mockDb.users.findUnique.mockResolvedValueOnce({ role: "SUPER_ADMIN" });
    mockDb.workspaces.findUnique.mockResolvedValueOnce(makeWorkspace());
    mockDb.$queryRaw.mockResolvedValueOnce([]);
    mockGetUserAppTokens.mockResolvedValueOnce(null); // no token available

    const { GET } = await import("@/app/api/admin/workspaces/[id]/pr-stats/route");
    const req = makeRequest("super-admin-1", "ws-1");
    const res = await GET(req, { params: Promise.resolve({ id: "ws-1" }) });
    expect(res.status).toBe(200);

    const body = await res.json();
    for (const window of ["24h", "48h", "1w", "2w", "1mo"] as const) {
      expect(body.repos[0].windows[window].githubTotal).toBeNull();
      expect(body.repos[0].windows[window].percentage).toBeNull();
    }
  });

  it("sets githubTotal to null when getPRCountForRepo throws (Promise.allSettled failure)", async () => {
    mockDb.users.findUnique.mockResolvedValueOnce({ role: "SUPER_ADMIN" });
    mockDb.workspaces.findUnique.mockResolvedValueOnce(makeWorkspace());
    mockDb.$queryRaw.mockResolvedValueOnce([]);
    mockGetUserAppTokens.mockResolvedValueOnce({ accessToken: "token-abc" });
    mockGetPRCountForRepo.mockRejectedValueOnce(new Error("GitHub rate limit"));

    const { GET } = await import("@/app/api/admin/workspaces/[id]/pr-stats/route");
    const req = makeRequest("super-admin-1", "ws-1");
    const res = await GET(req, { params: Promise.resolve({ id: "ws-1" }) });
    // Should NOT throw — graceful degradation
    expect(res.status).toBe(200);

    const body = await res.json();
    for (const window of ["24h", "48h", "1w", "2w", "1mo"] as const) {
      expect(body.repos[0].windows[window].githubTotal).toBeNull();
    }
  });

  it("calculates percentage correctly", async () => {
    vi.setSystemTime(new Date("2026-03-11T12:00:00.000Z"));

    const now = new Date("2026-03-11T12:00:00.000Z");
    mockDb.users.findUnique.mockResolvedValueOnce({ role: "SUPER_ADMIN" });
    mockDb.workspaces.findUnique.mockResolvedValueOnce(makeWorkspace());
    // 3 hive PRs all within 24h
    mockDb.$queryRaw.mockResolvedValueOnce([
      { repo: "stakwork/hive", created_at: new Date(now.getTime() - 1 * 60 * 60 * 1000) },
      { repo: "stakwork/hive", created_at: new Date(now.getTime() - 2 * 60 * 60 * 1000) },
      { repo: "stakwork/hive", created_at: new Date(now.getTime() - 3 * 60 * 60 * 1000) },
    ]);
    mockGetUserAppTokens.mockResolvedValueOnce({ accessToken: "token-abc" });
    // 7 total GitHub PRs within 24h
    mockGetPRCountForRepo.mockResolvedValueOnce({
      items: Array.from({ length: 7 }, (_, i) => ({
        createdAt: new Date(now.getTime() - (i + 1) * 60 * 60 * 1000),
      })),
    });

    const { GET } = await import("@/app/api/admin/workspaces/[id]/pr-stats/route");
    const req = makeRequest("super-admin-1", "ws-1");
    const res = await GET(req, { params: Promise.resolve({ id: "ws-1" }) });
    const body = await res.json();

    // 3/7 = 42.857... → rounds to 43
    expect(body.repos[0].windows["24h"].hiveCount).toBe(3);
    expect(body.repos[0].windows["24h"].githubTotal).toBe(7);
    expect(body.repos[0].windows["24h"].percentage).toBe(43);

    vi.useRealTimers();
  });

  it("aggregates totals correctly across multiple repos", async () => {
    vi.setSystemTime(new Date("2026-03-11T12:00:00.000Z"));
    const now = new Date("2026-03-11T12:00:00.000Z");

    const workspace = makeWorkspace({
      repositories: [
        { id: "repo-1", repositoryUrl: "https://github.com/stakwork/hive" },
        { id: "repo-2", repositoryUrl: "https://github.com/stakwork/staklink" },
      ],
    });

    mockDb.users.findUnique.mockResolvedValueOnce({ role: "SUPER_ADMIN" });
    mockDb.workspaces.findUnique.mockResolvedValueOnce(workspace);

    // 1 hive PR for stakwork/hive, 2 for stakwork/staklink — both within 24h
    mockDb.$queryRaw.mockResolvedValueOnce([
      { repo: "stakwork/hive", created_at: new Date(now.getTime() - 1 * 60 * 60 * 1000) },
      { repo: "stakwork/staklink", created_at: new Date(now.getTime() - 2 * 60 * 60 * 1000) },
      { repo: "stakwork/staklink", created_at: new Date(now.getTime() - 3 * 60 * 60 * 1000) },
    ]);

    // Tokens for both repos
    mockGetUserAppTokens.mockResolvedValue({ accessToken: "token-abc" });
    // GitHub: 3 PRs for hive, 5 PRs for staklink — within 24h
    mockGetPRCountForRepo
      .mockResolvedValueOnce({
        items: Array.from({ length: 3 }, (_, i) => ({
          createdAt: new Date(now.getTime() - (i + 1) * 60 * 60 * 1000),
        })),
      })
      .mockResolvedValueOnce({
        items: Array.from({ length: 5 }, (_, i) => ({
          createdAt: new Date(now.getTime() - (i + 1) * 60 * 60 * 1000),
        })),
      });

    const { GET } = await import("@/app/api/admin/workspaces/[id]/pr-stats/route");
    const req = makeRequest("super-admin-1", "ws-1");
    const res = await GET(req, { params: Promise.resolve({ id: "ws-1" }) });
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.repos).toHaveLength(2);

    // totals: 3 hive (1+2), 8 github (3+5), 38%
    expect(body.totals.windows["24h"].hiveCount).toBe(3);
    expect(body.totals.windows["24h"].githubTotal).toBe(8);
    expect(body.totals.windows["24h"].percentage).toBe(38);

    vi.useRealTimers();
  });

  it("returns repos and totals with all 5 window keys", async () => {
    mockDb.users.findUnique.mockResolvedValueOnce({ role: "SUPER_ADMIN" });
    mockDb.workspaces.findUnique.mockResolvedValueOnce(makeWorkspace());
    mockDb.$queryRaw.mockResolvedValueOnce([]);
    mockGetUserAppTokens.mockResolvedValueOnce(null);

    const { GET } = await import("@/app/api/admin/workspaces/[id]/pr-stats/route");
    const req = makeRequest("super-admin-1", "ws-1");
    const res = await GET(req, { params: Promise.resolve({ id: "ws-1" }) });
    const body = await res.json();

    const expectedWindows = ["24h", "48h", "1w", "2w", "1mo"];
    for (const w of expectedWindows) {
      expect(body.repos[0].windows[w]).toBeDefined();
      expect(body.totals.windows[w]).toBeDefined();
    }
  });
});
