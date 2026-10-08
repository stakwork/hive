/**
 * Unit tests for POST /api/orgs/[githubLogin]/strut/jobs/[jobId]/events —
 * a card's action on an artifact a job reported, the pull-request panel's
 * Fix (strut plans/job-artifact-events.md §5).
 *
 * Covers:
 *   - 401 without a session; 400 for a body not in shape
 *   - 404 when the caller is not in the org, the job is unknown or of
 *     another org, or the job never reported the artifact
 *   - 403 for anyone but the person who started the job
 *   - 409 `busy` while a turn is in flight, or when strut refuses as busy
 *   - 202 — the event composed from the ref's kind and indexed URL, with
 *     the details below, launched as the owner into the job's conversation
 *   - 502 when strut refuses the launch
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { MIDDLEWARE_HEADERS } from "@/config/middleware";

const { mockResolveAuthorizedOrgId, mockWorkspaceFindFirst, mockFirst, mockLive, mockLaunch, mockCompose } = vi.hoisted(() => ({
  mockResolveAuthorizedOrgId: vi.fn(),
  mockWorkspaceFindFirst: vi.fn(),
  mockFirst: vi.fn(),
  mockLive: vi.fn(),
  mockLaunch: vi.fn(),
  mockCompose: vi.fn(),
}));

vi.mock("@/lib/auth/org-access", () => ({ resolveAuthorizedOrgId: mockResolveAuthorizedOrgId }));
vi.mock("@/lib/db", () => ({ db: { workspace: { findFirst: mockWorkspaceFindFirst } } }));
vi.mock("@/services/strut-jobs", () => ({
  BUSY_NOTE: "A turn of this job is still running.",
  firstJobTurn: mockFirst,
  jobHasLiveTurn: mockLive,
  launchJobTurn: mockLaunch,
}));
vi.mock("@/services/strut-jobs/artifact-events", () => ({ composeJobArtifactEvent: mockCompose }));

const { POST } = await import("@/app/api/orgs/[githubLogin]/strut/jobs/[jobId]/events/route");

const GITHUB_LOGIN = "acme-org";
const JOB = "6f1c0d3e-1111-4222-8333-444455556666";
const params = { params: Promise.resolve({ githubLogin: GITHUB_LOGIN, jobId: JOB }) };
const PR = "https://github.com/acme/app/pull/12";
const LINE = `[artifact-event] pull_request ${PR} checks failed\nhead: a1b2c3d\n- lint — https://ci.test/1`;

const FIRST = { id: "row-1", workspaceId: "ws-1", swarmId: "swarm-1", userId: "user-1", conversationId: "conv-1", input: { prompt: "p", title: "Dark mode plan" } };
const BODY = { url: PR, what: "checks failed", details: ["head: a1b2c3d", "- lint — https://ci.test/1"] };

function request(body: unknown, authed = true): NextRequest {
  const req = new NextRequest(`http://hive.test/api/orgs/${GITHUB_LOGIN}/strut/jobs/${JOB}/events`, {
    method: "POST",
    headers: { "content-type": "application/json", host: "hive.test" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  if (authed) {
    req.headers.set(MIDDLEWARE_HEADERS.USER_ID, "user-1");
    req.headers.set(MIDDLEWARE_HEADERS.USER_EMAIL, "t@e.com");
    req.headers.set(MIDDLEWARE_HEADERS.USER_NAME, "T");
    req.headers.set(MIDDLEWARE_HEADERS.AUTH_STATUS, "authenticated");
  }
  return req;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockResolveAuthorizedOrgId.mockResolvedValue("org-1");
  mockWorkspaceFindFirst.mockResolvedValue({ id: "ws-1" });
  mockFirst.mockResolvedValue(FIRST);
  mockLive.mockResolvedValue(false);
  mockCompose.mockResolvedValue(LINE);
  mockLaunch.mockResolvedValue({ status: "continued", jobId: JOB, title: "Dark mode plan", runId: "row-2", note: "" });
});

describe("POST /api/orgs/[githubLogin]/strut/jobs/[jobId]/events", () => {
  it("401 without a session", async () => {
    expect((await POST(request(BODY, false), params)).status).toBe(401);
    expect(mockResolveAuthorizedOrgId).not.toHaveBeenCalled();
  });

  it("400 for a body not in shape", async () => {
    for (const body of [
      "not json",
      {},
      { ...BODY, url: "ftp://x" },
      { ...BODY, url: "https://a b" },
      { ...BODY, what: "" },
      { ...BODY, what: "two\nlines" },
      { ...BODY, details: ["ok", "bad\nline"] },
      { ...BODY, details: "head: abc" },
    ]) {
      expect((await POST(request(body), params)).status, JSON.stringify(body)).toBe(400);
    }
    expect(mockResolveAuthorizedOrgId).not.toHaveBeenCalled();
  });

  it("404 when the caller is not in the org, the job is unknown or of another org, or the job never reported the artifact", async () => {
    mockResolveAuthorizedOrgId.mockResolvedValueOnce(null);
    expect((await POST(request(BODY), params)).status).toBe(404);

    mockFirst.mockResolvedValueOnce(null);
    expect((await POST(request(BODY), params)).status).toBe(404);

    mockWorkspaceFindFirst.mockResolvedValueOnce(null);
    expect((await POST(request(BODY), params)).status).toBe(404);
    expect(mockWorkspaceFindFirst).toHaveBeenLastCalledWith(expect.objectContaining({ where: { id: "ws-1", sourceControlOrgId: "org-1", deleted: false } }));

    mockCompose.mockResolvedValueOnce(null);
    const res = await POST(request(BODY), params);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "The job did not report that artifact" });
    expect(mockLaunch).not.toHaveBeenCalled();
  });

  it("403 for anyone but the person who started the job", async () => {
    mockFirst.mockResolvedValueOnce({ ...FIRST, userId: "user-2" });
    const res = await POST(request(BODY), params);
    expect(res.status).toBe(403);
    expect(mockCompose).not.toHaveBeenCalled();
    expect(mockLaunch).not.toHaveBeenCalled();
  });

  it("409 busy while a turn is in flight, or when strut refuses as busy — nothing queued from a button", async () => {
    mockLive.mockResolvedValueOnce(true);
    let res = await POST(request(BODY), params);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "A turn of this job is still running.", busy: true });
    expect(mockLaunch).not.toHaveBeenCalled();

    mockLaunch.mockResolvedValueOnce({ status: "busy", jobId: JOB, note: "busy note" });
    res = await POST(request(BODY), params);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "busy note", busy: true });
  });

  it("202 — the event composed from the job's own ref, launched as the owner into the job's conversation", async () => {
    const res = await POST(request(BODY), params);
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ runId: "row-2" });
    expect(mockCompose).toHaveBeenCalledWith(JOB, PR, "checks failed", ["head: a1b2c3d", "- lint — https://ci.test/1"]);
    expect(mockLaunch).toHaveBeenCalledWith(
      { userId: "user-1", workspaceId: "ws-1", conversationId: "conv-1", publicBaseUrl: "https://hive.test" },
      { jobId: JOB, title: "Dark mode plan", prompt: LINE, started: false, event: true },
    );
  });

  it("502 when strut refuses the launch; 409 for a job with no conversation", async () => {
    mockLaunch.mockResolvedValueOnce({ status: "error", error: "no strut" });
    let res = await POST(request(BODY), params);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "no strut" });

    mockFirst.mockResolvedValueOnce({ ...FIRST, conversationId: null });
    res = await POST(request(BODY), params);
    expect(res.status).toBe(409);
    expect(mockLaunch).toHaveBeenCalledTimes(1);
  });
});
