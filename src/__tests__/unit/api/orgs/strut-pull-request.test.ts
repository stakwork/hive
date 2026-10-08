/**
 * Unit tests for GET /api/orgs/[githubLogin]/strut/pull-request
 *
 * Covers:
 *   - 401 without a session
 *   - 400 for a bad repo or number
 *   - 404 when caller is not in the org
 *   - 403 when the viewer has no GitHub token for the repo's owner
 *   - 200 success with Cache-Control: private, max-age=15, read with the viewer's token
 *   - 502 on GitHub API error; 404 on GitHub 404
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { MIDDLEWARE_HEADERS } from "@/config/middleware";

const { mockResolveAuthorizedOrgId, mockGetUserAppTokens, mockGetPullRequestStatus } = vi.hoisted(() => ({
  mockResolveAuthorizedOrgId: vi.fn(),
  mockGetUserAppTokens: vi.fn(),
  mockGetPullRequestStatus: vi.fn(),
}));

/** Stands in for Octokit: keeps the auth it was built with, so the test can see whose token was used. */
class FakeOctokit {
  constructor(readonly options: { auth: string }) {}
}

vi.mock("@octokit/rest", () => ({ Octokit: FakeOctokit }));
vi.mock("@/lib/auth/org-access", () => ({ resolveAuthorizedOrgId: mockResolveAuthorizedOrgId }));
vi.mock("@/lib/githubApp", () => ({ getUserAppTokens: mockGetUserAppTokens }));
vi.mock("@/lib/github/pullRequestStatus", () => ({ getPullRequestStatus: mockGetPullRequestStatus }));

const { GET } = await import("@/app/api/orgs/[githubLogin]/strut/pull-request/route");

const GITHUB_LOGIN = "acme-org";
const params = { params: Promise.resolve({ githubLogin: GITHUB_LOGIN }) };

const LIVE_STATUS = {
  state: "open",
  title: "Dark mode",
  headSha: "abc123",
  headBranch: "feat/dark-mode",
  baseBranch: "main",
  author: "alice",
  checks: [{ name: "CI", status: "success" }],
};

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

const GOOD_QUERY = { repo: "acme/app", number: "7" };

beforeEach(() => {
  vi.clearAllMocks();
  mockResolveAuthorizedOrgId.mockResolvedValue("org-1");
  mockGetUserAppTokens.mockResolvedValue({ accessToken: "tok-viewer" });
  mockGetPullRequestStatus.mockResolvedValue(LIVE_STATUS);
});

describe("GET /api/orgs/[githubLogin]/strut/pull-request", () => {
  it("401 without a session", async () => {
    const res = await GET(request(GOOD_QUERY, false), params);
    expect(res.status).toBe(401);
    expect(mockResolveAuthorizedOrgId).not.toHaveBeenCalled();
  });

  it("400 for a missing or malformed repo", async () => {
    expect((await GET(request({ number: "7" }), params)).status).toBe(400);
    for (const repo of ["", "no-slash", "owner/name/extra", "acme/(app", "acme/app|x", "acme/.*", "ac me/app", "acme/app?x=1"]) {
      expect((await GET(request({ repo, number: "7" }), params)).status).toBe(400);
    }
    expect(mockResolveAuthorizedOrgId).not.toHaveBeenCalled();
    expect((await GET(request({ repo: "my-org_1/my.app-2", number: "7" }), params)).status).toBe(200);
  });

  it("400 for a missing or invalid number", async () => {
    expect((await GET(request({ repo: "acme/app" }), params)).status).toBe(400);
    for (const number of ["0", "-1", "1.5", "abc", "", "07"]) {
      expect((await GET(request({ ...GOOD_QUERY, number }), params)).status).toBe(400);
    }
    expect(mockResolveAuthorizedOrgId).not.toHaveBeenCalled();
  });

  it("404 when caller is not in the org", async () => {
    mockResolveAuthorizedOrgId.mockResolvedValue(null);
    expect((await GET(request(GOOD_QUERY), params)).status).toBe(404);
    expect(mockGetUserAppTokens).not.toHaveBeenCalled();
    expect(mockGetPullRequestStatus).not.toHaveBeenCalled();
  });

  it("403 when the viewer has no GitHub token for the repo's owner", async () => {
    mockGetUserAppTokens.mockResolvedValue(null);
    expect((await GET(request(GOOD_QUERY), params)).status).toBe(403);
    mockGetUserAppTokens.mockResolvedValue({ refreshToken: "r" });
    expect((await GET(request(GOOD_QUERY), params)).status).toBe(403);
    expect(mockGetPullRequestStatus).not.toHaveBeenCalled();
  });

  it("200 — reads GitHub with the viewer's own token for the repo's owner, with a short private cache", async () => {
    const res = await GET(request(GOOD_QUERY), params);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(LIVE_STATUS);
    expect(res.headers.get("cache-control")).toBe("private, max-age=15");

    expect(mockGetUserAppTokens).toHaveBeenCalledWith("user-1", "acme");
    expect(mockGetPullRequestStatus).toHaveBeenCalledTimes(1);
    const [octokit, target] = mockGetPullRequestStatus.mock.calls[0];
    expect(octokit).toBeInstanceOf(FakeOctokit);
    expect((octokit as FakeOctokit).options).toEqual({ auth: "tok-viewer" });
    expect(target).toEqual({ owner: "acme", repo: "app", number: 7 });
  });

  it("the token is the viewer's for the PR's owner, not for the org the canvas is on", async () => {
    await GET(request({ repo: "other-org/thing", number: "3" }), params);
    expect(mockGetUserAppTokens).toHaveBeenCalledWith("user-1", "other-org");
    expect(mockGetPullRequestStatus).toHaveBeenCalledWith(expect.any(FakeOctokit), {
      owner: "other-org",
      repo: "thing",
      number: 3,
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
