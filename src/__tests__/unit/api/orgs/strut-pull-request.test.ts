/**
 * Unit tests for GET /api/orgs/[githubLogin]/strut/pull-request
 *
 * Covers:
 *   - 401 without a session
 *   - 400 for bad swarmId/jobId/repo/number
 *   - 404 when caller is not in the org
 *   - 403 when swarm is outside org, workspace deleted, or no read access
 *   - 404 when no StrutRun with that jobId+swarmId exists
 *   - 404 when PR was not reported by this job (security check)
 *   - 502 when no GitHub token available
 *   - 200 success with Cache-Control: private, max-age=15
 *   - 502 on GitHub API error; 404 on GitHub 404
 */

import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { NextRequest } from "next/server";
import { MIDDLEWARE_HEADERS } from "@/config/middleware";

const {
  mockResolveAuthorizedOrgId,
  mockSwarmFindUnique,
  mockStrutRunFindFirst,
  mockValidateWorkspaceAccess,
  mockResolveJobOwnerOctokit,
  mockGetPullRequestStatus,
  mockJobReportedPullRequest,
} = vi.hoisted(() => ({
  mockResolveAuthorizedOrgId: vi.fn(),
  mockSwarmFindUnique: vi.fn(),
  mockStrutRunFindFirst: vi.fn(),
  mockValidateWorkspaceAccess: vi.fn(),
  mockResolveJobOwnerOctokit: vi.fn(),
  mockGetPullRequestStatus: vi.fn(),
  mockJobReportedPullRequest: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    swarm: { findUnique: mockSwarmFindUnique },
    strutRun: { findFirst: mockStrutRunFindFirst },
  },
}));
vi.mock("@/lib/auth/org-access", () => ({ resolveAuthorizedOrgId: mockResolveAuthorizedOrgId }));
vi.mock("@/services/workspace", () => ({ validateWorkspaceAccess: mockValidateWorkspaceAccess }));
vi.mock("@/lib/github/resolveJobOwnerOctokit", () => ({
  resolveJobOwnerOctokit: mockResolveJobOwnerOctokit,
}));
vi.mock("@/lib/github/pullRequestStatus", () => ({
  getPullRequestStatus: mockGetPullRequestStatus,
}));
vi.mock("@/lib/github/jobReportedPullRequest", () => ({
  jobReportedPullRequest: mockJobReportedPullRequest,
}));

const { GET } = await import("@/app/api/orgs/[githubLogin]/strut/pull-request/route");

const JOB_ID = "job-abc-123";
const SWARM_ID = "swarm-1";
const GITHUB_LOGIN = "acme-org";
const params = { params: Promise.resolve({ githubLogin: GITHUB_LOGIN }) };

const SWARM = {
  workspace: {
    id: "ws-1",
    slug: "acme",
    sourceControlOrgId: "org-1",
    deleted: false,
  },
};

const LIVE_STATUS = {
  state: "open",
  title: "Dark mode",
  headSha: "abc123",
  headBranch: "feat/dark-mode",
  baseBranch: "main",
  author: "alice",
  checks: [{ name: "CI", status: "success" }],
};

const fakeOctokit = { name: "octokit" } as unknown as import("@octokit/rest").Octokit;

function request(query: Record<string, string>, authed = true): NextRequest {
  const url = `http://localhost/api/orgs/${GITHUB_LOGIN}/strut/pull-request?${new URLSearchParams(query)}`;
  const req = new NextRequest(url);
  if (authed) {
    req.headers.set(MIDDLEWARE_HEADERS.USER_ID, "user-1");
    req.headers.set(MIDDLEWARE_HEADERS.USER_EMAIL, "t@e.com");
    req.headers.set(MIDDLEWARE_HEADERS.USER_NAME, "T");
    req.headers.set(MIDDLEWARE_HEADERS.AUTH_STATUS, "authenticated");
  }
  return req;
}

const GOOD_QUERY = { swarmId: SWARM_ID, jobId: JOB_ID, repo: "acme/app", number: "7" };

beforeEach(() => {
  vi.clearAllMocks();
  mockResolveAuthorizedOrgId.mockResolvedValue("org-1");
  mockSwarmFindUnique.mockResolvedValue(SWARM);
  mockValidateWorkspaceAccess.mockResolvedValue({ hasAccess: true, canRead: true, canWrite: false, canAdmin: false });
  mockStrutRunFindFirst.mockResolvedValue({ id: "run-1" });
  mockJobReportedPullRequest.mockResolvedValue(true);   // PR reported by the job — allow through
  mockResolveJobOwnerOctokit.mockResolvedValue({ ok: true, octokit: fakeOctokit, source: "job_owner" });
  mockGetPullRequestStatus.mockResolvedValue(LIVE_STATUS);
});

describe("GET /api/orgs/[githubLogin]/strut/pull-request", () => {
  it("401 without a session", async () => {
    const res = await GET(request(GOOD_QUERY, false), params);
    expect(res.status).toBe(401);
    expect(mockSwarmFindUnique).not.toHaveBeenCalled();
  });

  it("400 for missing or invalid swarmId / jobId", async () => {
    expect((await GET(request({ jobId: JOB_ID, repo: "acme/app", number: "7" }), params)).status).toBe(400);
    expect((await GET(request({ swarmId: SWARM_ID, repo: "acme/app", number: "7" }), params)).status).toBe(400);
    // Too long swarmId
    expect((await GET(request({ ...GOOD_QUERY, swarmId: "x".repeat(201) }), params)).status).toBe(400);
    expect(mockSwarmFindUnique).not.toHaveBeenCalled();
  });

  it("400 for invalid repo format", async () => {
    expect((await GET(request({ ...GOOD_QUERY, repo: "no-slash" }), params)).status).toBe(400);
    expect((await GET(request({ ...GOOD_QUERY, repo: "owner/name/extra" }), params)).status).toBe(400);
    expect((await GET(request({ ...GOOD_QUERY, repo: "" }), params)).status).toBe(400);
  });

  it("400 for a repo outside GitHub's name characters (never reaches the reported-PR check)", async () => {
    for (const repo of ["acme/(app", "acme/app|x", "acme/.*", "acme/app+", "ac me/app", "acme/app?x=1"]) {
      expect((await GET(request({ ...GOOD_QUERY, repo }), params)).status).toBe(400);
    }
    expect(mockJobReportedPullRequest).not.toHaveBeenCalled();
    expect((await GET(request({ ...GOOD_QUERY, repo: "my-org_1/my.app-2" }), params)).status).toBe(200);
  });

  it("400 for invalid number", async () => {
    expect((await GET(request({ ...GOOD_QUERY, number: "0" }), params)).status).toBe(400);
    expect((await GET(request({ ...GOOD_QUERY, number: "-1" }), params)).status).toBe(400);
    expect((await GET(request({ ...GOOD_QUERY, number: "1.5" }), params)).status).toBe(400);
    expect((await GET(request({ ...GOOD_QUERY, number: "abc" }), params)).status).toBe(400);
    expect((await GET(request({ ...GOOD_QUERY, number: "" }), params)).status).toBe(400);
  });

  it("404 when caller is not in the org", async () => {
    mockResolveAuthorizedOrgId.mockResolvedValue(null);
    expect((await GET(request(GOOD_QUERY), params)).status).toBe(404);
    expect(mockSwarmFindUnique).not.toHaveBeenCalled();
  });

  it("403 when swarm is outside the org, workspace deleted, or swarm not found", async () => {
    mockSwarmFindUnique.mockResolvedValue({ workspace: { ...SWARM.workspace, sourceControlOrgId: "org-2" } });
    expect((await GET(request(GOOD_QUERY), params)).status).toBe(403);

    mockSwarmFindUnique.mockResolvedValue({ workspace: { ...SWARM.workspace, deleted: true } });
    expect((await GET(request(GOOD_QUERY), params)).status).toBe(403);

    mockSwarmFindUnique.mockResolvedValue(null);
    expect((await GET(request(GOOD_QUERY), params)).status).toBe(403);
  });

  it("403 when caller cannot read the workspace", async () => {
    mockValidateWorkspaceAccess.mockResolvedValue({ hasAccess: false, canRead: false, canWrite: false, canAdmin: false });
    expect((await GET(request(GOOD_QUERY), params)).status).toBe(403);
    expect(mockStrutRunFindFirst).not.toHaveBeenCalled();
  });

  it("404 when no StrutRun with that jobId+swarmId exists", async () => {
    mockStrutRunFindFirst.mockResolvedValue(null);
    expect((await GET(request(GOOD_QUERY), params)).status).toBe(404);
    expect(mockJobReportedPullRequest).not.toHaveBeenCalled();
    expect(mockResolveJobOwnerOctokit).not.toHaveBeenCalled();
  });

  // ── Security check ────────────────────────────────────────────────────────

  it("404 when the PR was not reported by this job (security: prevents token misuse)", async () => {
    mockJobReportedPullRequest.mockResolvedValue(false);
    const res = await GET(request(GOOD_QUERY), params);
    expect(res.status).toBe(404);
    // Must not reach the GitHub API with the owner's token.
    expect(mockResolveJobOwnerOctokit).not.toHaveBeenCalled();
    expect(mockGetPullRequestStatus).not.toHaveBeenCalled();
  });

  it("security check called with correct args", async () => {
    await GET(request(GOOD_QUERY), params);
    expect(mockJobReportedPullRequest).toHaveBeenCalledWith(JOB_ID, SWARM_ID, "acme/app", 7);
  });

  // ── Token / GitHub ────────────────────────────────────────────────────────

  it("502 when no GitHub token available", async () => {
    mockResolveJobOwnerOctokit.mockResolvedValue({ ok: false, reason: "no_token" });
    expect((await GET(request(GOOD_QUERY), params)).status).toBe(502);
    expect(mockGetPullRequestStatus).not.toHaveBeenCalled();
  });

  it("200 success — returns live status with correct Cache-Control", async () => {
    const res = await GET(request(GOOD_QUERY), params);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(LIVE_STATUS);
    expect(res.headers.get("cache-control")).toBe("private, max-age=15");

    // Verify calls were made with correct args.
    expect(mockGetPullRequestStatus).toHaveBeenCalledWith(fakeOctokit, {
      owner: "acme",
      repo: "app",
      number: 7,
    });
    expect(mockStrutRunFindFirst).toHaveBeenCalledWith({
      where: { jobId: JOB_ID, swarmId: SWARM_ID },
      select: { id: true },
    });
  });

  it("404 when GitHub returns a 404-like error", async () => {
    mockGetPullRequestStatus.mockRejectedValue(new Error("Not Found — 404"));
    expect((await GET(request(GOOD_QUERY), params)).status).toBe(404);
  });

  it("502 on other GitHub API errors", async () => {
    mockGetPullRequestStatus.mockRejectedValue(new Error("rate limited"));
    expect((await GET(request(GOOD_QUERY), params)).status).toBe(502);
  });
});
