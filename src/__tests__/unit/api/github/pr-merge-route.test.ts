import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  findFirst: vi.fn(),
  update: vi.fn(),
  validate: vi.fn(),
  getPat: vi.fn(),
  get: vi.fn(),
  merge: vi.fn(),
  repoGet: vi.fn(),
}));

vi.mock("next-auth/next", () => ({ getServerSession: mocks.getServerSession }));
vi.mock("@/lib/db", () => ({ db: { artifact: { findFirst: mocks.findFirst, update: mocks.update } } }));
vi.mock("@/lib/auth/nextauth", () => ({
  authOptions: {},
  getGithubUsernameAndPAT: mocks.getPat,
}));
vi.mock("@/services/workspace", () => ({ validateWorkspaceAccess: mocks.validate }));
vi.mock("@octokit/rest", () => ({
  Octokit: vi.fn().mockImplementation(() => ({ pulls: { get: mocks.get, merge: mocks.merge }, repos: { get: mocks.repoGet } })),
}));

import { POST } from "@/app/api/github/pr/merge/route";

const req = (body: unknown) =>
  new NextRequest("http://localhost/api/github/pr/merge", { method: "POST", body: JSON.stringify(body) });

describe("POST /api/github/pr/merge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerSession.mockResolvedValue({ user: { id: "u1" } });
    mocks.findFirst.mockResolvedValue({
      id: "a1",
      content: { url: "https://github.com/org/repo/pull/42", repo: "org/repo", status: "IN_PROGRESS", extra: 1 },
      message: { task: { workspaceId: "w1", workspace: { slug: "ws" } } },
    });
    mocks.validate.mockResolvedValue({ hasAccess: true, canWrite: true });
    mocks.getPat.mockResolvedValue({ username: "x", token: "tok" });
    mocks.get.mockResolvedValue({
      data: { merged: false, state: "open", draft: false, mergeable: true, head: { sha: "headsha" } },
    });
  });

  it("401 without session", async () => {
    mocks.getServerSession.mockResolvedValue(null);
    expect((await POST(req({ artifactId: "a1" }))).status).toBe(401);
  });

  it("400 on bad body", async () => {
    expect((await POST(req({}))).status).toBe(400);
  });

  it("403 when no write access", async () => {
    mocks.validate.mockResolvedValue({ hasAccess: true, canWrite: false });
    expect((await POST(req({ artifactId: "a1" }))).status).toBe(403);
  });

  it("403 when no GitHub token", async () => {
    mocks.getPat.mockResolvedValue(null);
    const res = await POST(req({ artifactId: "a1" }));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("GitHub authorization required");
  });

  it("returns success and marks DONE when already merged", async () => {
    mocks.get.mockResolvedValue({ data: { merged: true, state: "closed" } });
    const res = await POST(req({ artifactId: "a1" }));
    expect(await res.json()).toMatchObject({ success: true, merged: true, alreadyMerged: true });
    expect(mocks.merge).not.toHaveBeenCalled();
    expect(mocks.update).toHaveBeenCalled();
  });

  it("409 when GitHub returns 405", async () => {
    mocks.merge.mockRejectedValue({ status: 405 });
    expect((await POST(req({ artifactId: "a1" }))).status).toBe(409);
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it("surfaces GitHub's 405 message", async () => {
    mocks.merge.mockRejectedValue({ status: 405, response: { data: { message: "Required status check is expected." } } });
    const res = await POST(req({ artifactId: "a1" }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("Required status check is expected.");
    expect(mocks.repoGet).not.toHaveBeenCalled();
  });

  it("retries once with an allowed method when the method is not allowed", async () => {
    mocks.merge
      .mockRejectedValueOnce({ status: 405, response: { data: { message: "Squash merges are not allowed on this repository." } } })
      .mockResolvedValueOnce({ data: { sha: "abc" } });
    mocks.repoGet.mockResolvedValue({ data: { allow_squash_merge: false, allow_rebase_merge: true, allow_merge_commit: true } });
    const res = await POST(req({ artifactId: "a1" }));
    expect(res.status).toBe(200);
    expect(mocks.merge).toHaveBeenLastCalledWith(expect.objectContaining({ merge_method: "rebase" }));
  });

  it("merges and updates artifact preserving content", async () => {
    mocks.merge.mockResolvedValue({ data: { sha: "abc" } });
    const res = await POST(req({ artifactId: "a1" }));
    expect(await res.json()).toEqual({ success: true, merged: true, sha: "abc" });
    expect(mocks.merge).toHaveBeenCalledWith(
      expect.objectContaining({ owner: "org", repo: "repo", pull_number: 42,
        merge_method: "squash",
        sha: "headsha",
      }),
    );
    expect(mocks.update).toHaveBeenCalledWith({
      where: { id: "a1" },
      data: { content: expect.objectContaining({ status: "DONE", extra: 1 }) },
    });
  });
});
