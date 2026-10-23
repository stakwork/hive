/**
 * Unit tests for POST /api/orgs/[githubLogin]/strut/pull-request/merge
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { MIDDLEWARE_HEADERS } from "@/config/middleware";

const { mockResolveAuthorizedOrgId, mockGetUserAppTokens, mockReconcile, mockGet, mockMerge, mockRepoGet } = vi.hoisted(() => ({
  mockReconcile: vi.fn(),
  mockResolveAuthorizedOrgId: vi.fn(),
  mockGetUserAppTokens: vi.fn(),
  mockGet: vi.fn(),
  mockMerge: vi.fn(),
  mockRepoGet: vi.fn(),
}));

class FakeOctokit {
  pulls = { get: mockGet, merge: mockMerge };
  repos = { get: mockRepoGet };
  constructor(readonly options: { auth: string }) {}
}

vi.mock("@octokit/rest", () => ({ Octokit: FakeOctokit }));
vi.mock("@/lib/auth/org-access", () => ({ resolveAuthorizedOrgId: mockResolveAuthorizedOrgId }));
vi.mock("@/lib/githubApp", () => ({ getUserAppTokens: mockGetUserAppTokens }));
vi.mock("@/services/orgs/reconcile-chat-pull-request", () => ({ reconcileChatPullRequestState: mockReconcile }));

const { POST } = await import("@/app/api/orgs/[githubLogin]/strut/pull-request/merge/route");

const GITHUB_LOGIN = "acme-org";
const params = { params: Promise.resolve({ githubLogin: GITHUB_LOGIN }) };

function request(body: unknown, authed = true): NextRequest {
  const req = new NextRequest(`http://localhost/api/orgs/${GITHUB_LOGIN}/strut/pull-request/merge`, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
  if (authed) {
    req.headers.set(MIDDLEWARE_HEADERS.USER_ID, "user-1");
    req.headers.set(MIDDLEWARE_HEADERS.USER_EMAIL, "t@e.com");
    req.headers.set(MIDDLEWARE_HEADERS.USER_NAME, "T");
    req.headers.set(MIDDLEWARE_HEADERS.AUTH_STATUS, "authenticated");
  }
  return req;
}

const GOOD = { repo: "acme/app", number: 7 };

beforeEach(() => {
  vi.clearAllMocks();
  mockResolveAuthorizedOrgId.mockResolvedValue("org-1");
  mockGetUserAppTokens.mockResolvedValue({ accessToken: "tok-viewer" });
  mockGet.mockResolvedValue({ data: { merged: false, state: "open", draft: false, mergeable: true, head: { sha: "headsha" } } });
  mockMerge.mockResolvedValue({ data: { merged: true, sha: "deadbeef" } });
  mockReconcile.mockResolvedValue({ updated: 1 });
});

describe("POST /api/orgs/[githubLogin]/strut/pull-request/merge", () => {
  it("401 without a session", async () => {
    expect((await POST(request(GOOD, false), params)).status).toBe(401);
    expect(mockResolveAuthorizedOrgId).not.toHaveBeenCalled();
  });

  it("400 for a bad repo or number", async () => {
    for (const repo of ["", "no-slash", "a/b/c", "acme/app?x=1"]) {
      expect((await POST(request({ repo, number: 7 }), params)).status).toBe(400);
    }
    for (const number of [0, -1, 1.5, "7"]) {
      expect((await POST(request({ repo: "acme/app", number }), params)).status).toBe(400);
    }
    expect(mockResolveAuthorizedOrgId).not.toHaveBeenCalled();
  });

  it("404 when caller is not in the org", async () => {
    mockResolveAuthorizedOrgId.mockResolvedValue(null);
    expect((await POST(request(GOOD), params)).status).toBe(404);
    expect(mockGet).not.toHaveBeenCalled();
  });

  it("403 when the viewer has no GitHub token", async () => {
    mockGetUserAppTokens.mockResolvedValue(null);
    const res = await POST(request(GOOD), params);
    expect(res.status).toBe(403);
    expect(mockGet).not.toHaveBeenCalled();
  });

  it("merges, defaulting to squash, and reconciles as merged", async () => {
    const res = await POST(request({ ...GOOD, conversationId: "conv-1" }), params);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, merged: true, sha: "deadbeef" });
    expect(mockGetUserAppTokens).toHaveBeenCalledWith("user-1", "acme");
    expect(mockMerge).toHaveBeenCalledWith({
      owner: "acme",
      repo: "app", pull_number: 7,
      merge_method: "squash",
      sha: "headsha",
    });
    expect(mockReconcile).toHaveBeenCalledWith({
      conversationId: "conv-1",
      orgId: "org-1",
      userId: "user-1",
      repo: "acme/app",
      number: 7,
      state: "merged",
    });
  });

  it("passes the requested merge method", async () => {
    await POST(request({ ...GOOD, mergeMethod: "rebase" }), params);
    expect(mockMerge).toHaveBeenCalledWith(expect.objectContaining({ merge_method: "rebase" }));
    expect(mockReconcile).not.toHaveBeenCalled();
  });

  it("already merged: success without merging, still reconciles", async () => {
    mockGet.mockResolvedValue({ data: { merged: true, state: "closed" } });
    const res = await POST(request({ ...GOOD, conversationId: "conv-1" }), params);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, merged: true, alreadyMerged: true });
    expect(mockMerge).not.toHaveBeenCalled();
    expect(mockReconcile).toHaveBeenCalledTimes(1);
  });

  it("409 when closed, draft or conflicting", async () => {
    mockGet.mockResolvedValue({ data: { merged: false, state: "closed" } });
    expect((await POST(request(GOOD), params)).status).toBe(409);
    mockGet.mockResolvedValue({ data: { merged: false, state: "open", draft: true } });
    expect((await POST(request(GOOD), params)).status).toBe(409);
    mockGet.mockResolvedValue({ data: { merged: false, state: "open", draft: false, mergeable: false } });
    expect((await POST(request(GOOD), params)).status).toBe(409);
    expect(mockMerge).not.toHaveBeenCalled();
  });

  it("GitHub 405 → 409, 409 → 409, 403 → 403, other → 502", async () => {
    mockMerge.mockRejectedValue(Object.assign(new Error("x"), { status: 405 }));
    expect((await POST(request(GOOD), params)).status).toBe(409);
    mockMerge.mockRejectedValue(Object.assign(new Error("x"), { status: 409 }));
    expect((await POST(request(GOOD), params)).status).toBe(409);
    mockMerge.mockRejectedValue(Object.assign(new Error("x"), { status: 403 }));
    expect((await POST(request(GOOD), params)).status).toBe(403);
    mockMerge.mockRejectedValue(Object.assign(new Error("x"), { status: 500 }));
    expect((await POST(request(GOOD), params)).status).toBe(502);
  });

  it("surfaces GitHub's 405 message", async () => {
    mockMerge.mockRejectedValue(
      Object.assign(new Error("x"), { status: 405, response: { data: { message: "Required status check is expected." } } }),
    );
    const res = await POST(request(GOOD), params);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("Required status check is expected.");
    expect(mockRepoGet).not.toHaveBeenCalled();
  });

  it("retries once with an allowed method when the method is not allowed", async () => {
    mockMerge
      .mockRejectedValueOnce(
        Object.assign(new Error("x"), { status: 405, response: { data: { message: "Squash merges are not allowed on this repository." } } }),
      )
      .mockResolvedValueOnce({ data: { merged: true, sha: "beef" } });
    mockRepoGet.mockResolvedValue({ data: { allow_squash_merge: false, allow_rebase_merge: true, allow_merge_commit: true } });
    const res = await POST(request(GOOD), params);
    expect(res.status).toBe(200);
    expect(mockMerge).toHaveBeenCalledTimes(2);
    expect(mockMerge).toHaveBeenLastCalledWith(expect.objectContaining({ merge_method: "rebase", sha: "headsha" }));
  });

  it("a throwing reconcile still returns 200", async () => {
    mockReconcile.mockRejectedValue(new Error("db down"));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await POST(request({ ...GOOD, conversationId: "conv-1" }), params);
    expect(res.status).toBe(200);
    expect((await res.json()).sha).toBe("deadbeef");
  });
});
