import { describe, it, expect, vi, beforeEach, Mock } from "vitest";
import { NextRequest } from "next/server";

// ── Hoisted mocks ─────────────────────────────────────────────────────────
const {
  mockDbRepositoryFindUnique,
  mockDbRepositoryUpdate,
  mockDbWorkspaceMemberFindFirst,
} = vi.hoisted(() => ({
  mockDbRepositoryFindUnique: vi.fn(),
  mockDbRepositoryUpdate: vi.fn(),
  mockDbWorkspaceMemberFindFirst: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    repository: {
      findUnique: mockDbRepositoryFindUnique,
      update: mockDbRepositoryUpdate,
    },
    workspaceMember: {
      findFirst: mockDbWorkspaceMemberFindFirst,
    },
  },
}));

vi.mock("next-auth/next", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("@/lib/auth/nextauth", () => ({
  authOptions: {},
}));

vi.mock("@/lib/github", () => ({
  parsePRUrl: vi.fn(),
  getOctokitForWorkspace: vi.fn(),
  checkRepoAllowsAutoMerge: vi.fn(),
}));

vi.mock("@/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ── Imports after mocks ───────────────────────────────────────────────────
import { GET } from "@/app/api/github/repository/auto-merge/route";
import { getServerSession } from "next-auth/next";
import { parsePRUrl, getOctokitForWorkspace, checkRepoAllowsAutoMerge } from "@/lib/github";

const mockGetServerSession = getServerSession as Mock;
const mockParsePRUrl = parsePRUrl as Mock;
const mockGetOctokitForWorkspace = getOctokitForWorkspace as Mock;
const mockCheckRepoAllowsAutoMerge = checkRepoAllowsAutoMerge as Mock;

// ── Helpers ───────────────────────────────────────────────────────────────
const makeRequest = (repositoryId?: string) =>
  new NextRequest(
    `http://localhost/api/github/repository/auto-merge${repositoryId ? `?repositoryId=${repositoryId}` : ""}`
  );

const SESSION = { user: { id: "user-123", email: "test@example.com" } };

const REPO_BASE = {
  id: "repo-abc",
  repositoryUrl: "https://github.com/acme/myrepo",
  allowAutoMerge: false,
  workspaceId: "ws-001",
  workspace: { ownerId: "owner-999" },
};

// ── Tests ─────────────────────────────────────────────────────────────────
describe("GET /api/github/repository/auto-merge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetServerSession.mockResolvedValue(SESSION);
    mockDbWorkspaceMemberFindFirst.mockResolvedValue({ id: "mem-1" });
    mockDbRepositoryUpdate.mockResolvedValue({});
    mockParsePRUrl.mockReturnValue({ owner: "acme", repo: "myrepo", prNumber: 1 });
    mockGetOctokitForWorkspace.mockResolvedValue({ rest: {} });
    mockCheckRepoAllowsAutoMerge.mockResolvedValue({ allowed: true });
  });

  // ── Auth ────────────────────────────────────────────────────────────────
  it("returns 401 when unauthenticated", async () => {
    mockGetServerSession.mockResolvedValue(null);
    const res = await GET(makeRequest("repo-abc"));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toMatch(/unauthorized/i);
  });

  // ── Validation ──────────────────────────────────────────────────────────
  it("returns 400 when repositoryId is missing", async () => {
    const res = await GET(makeRequest());
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/repositoryId/i);
  });

  // ── Not found ───────────────────────────────────────────────────────────
  it("returns 404 when repository is not found", async () => {
    mockDbRepositoryFindUnique.mockResolvedValue(null);
    const res = await GET(makeRequest("repo-abc"));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toMatch(/not found/i);
  });

  // ── IDOR ────────────────────────────────────────────────────────────────
  it("returns 403 when user is not a workspace member or owner", async () => {
    mockDbRepositoryFindUnique.mockResolvedValue(REPO_BASE);
    // user-123 is not the owner (owner-999) and not a member
    mockDbWorkspaceMemberFindFirst.mockResolvedValue(null);
    const res = await GET(makeRequest("repo-abc"));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/forbidden/i);
  });

  it("allows workspace owner without a WorkspaceMember record", async () => {
    mockDbRepositoryFindUnique.mockResolvedValue({
      ...REPO_BASE,
      workspace: { ownerId: "user-123" }, // session user is the owner
    });
    mockDbWorkspaceMemberFindFirst.mockResolvedValue(null);
    mockCheckRepoAllowsAutoMerge.mockResolvedValue({ allowed: false });

    const res = await GET(makeRequest("repo-abc"));
    expect(res.status).toBe(200);
    // membership check should NOT have been called
    expect(mockDbWorkspaceMemberFindFirst).not.toHaveBeenCalled();
  });

  // ── Cache hit ───────────────────────────────────────────────────────────
  it("returns { allowed: true } immediately on cache hit without hitting GitHub", async () => {
    mockDbRepositoryFindUnique.mockResolvedValue({ ...REPO_BASE, allowAutoMerge: true });

    const res = await GET(makeRequest("repo-abc"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.allowed).toBe(true);

    // No GitHub calls should have been made
    expect(mockCheckRepoAllowsAutoMerge).not.toHaveBeenCalled();
    expect(mockGetOctokitForWorkspace).not.toHaveBeenCalled();
  });

  // ── Cache miss, GitHub allows ────────────────────────────────────────────
  it("returns { allowed: true } and caches the result when GitHub permits auto-merge", async () => {
    mockDbRepositoryFindUnique.mockResolvedValue(REPO_BASE);
    mockCheckRepoAllowsAutoMerge.mockResolvedValue({ allowed: true });

    const res = await GET(makeRequest("repo-abc"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.allowed).toBe(true);

    expect(mockCheckRepoAllowsAutoMerge).toHaveBeenCalledWith(
      expect.anything(),
      "acme",
      "myrepo"
    );
    // Should cache the positive result
    expect(mockDbRepositoryUpdate).toHaveBeenCalledWith({
      where: { id: "repo-abc" },
      data: { allowAutoMerge: true },
    });
  });

  // ── Cache miss, GitHub denies ────────────────────────────────────────────
  it("returns { allowed: false } and does NOT cache when GitHub denies auto-merge", async () => {
    mockDbRepositoryFindUnique.mockResolvedValue(REPO_BASE);
    mockCheckRepoAllowsAutoMerge.mockResolvedValue({ allowed: false });

    const res = await GET(makeRequest("repo-abc"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.allowed).toBe(false);

    // Should not cache a negative result
    expect(mockDbRepositoryUpdate).not.toHaveBeenCalled();
  });

  // ── Fail-safe: no Octokit ────────────────────────────────────────────────
  it("returns { allowed: false } when Octokit token is unavailable", async () => {
    mockDbRepositoryFindUnique.mockResolvedValue(REPO_BASE);
    mockGetOctokitForWorkspace.mockResolvedValue(null);

    const res = await GET(makeRequest("repo-abc"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.allowed).toBe(false);
    expect(mockCheckRepoAllowsAutoMerge).not.toHaveBeenCalled();
  });

  // ── Fail-safe: bad repo URL ──────────────────────────────────────────────
  it("returns { allowed: false } when repositoryUrl cannot be parsed", async () => {
    mockDbRepositoryFindUnique.mockResolvedValue(REPO_BASE);
    mockParsePRUrl.mockReturnValue(null);

    const res = await GET(makeRequest("repo-abc"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.allowed).toBe(false);
    expect(mockCheckRepoAllowsAutoMerge).not.toHaveBeenCalled();
  });
});
