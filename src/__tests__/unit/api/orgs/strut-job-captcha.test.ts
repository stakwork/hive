/**
 * Unit tests for POST /api/orgs/[githubLogin]/strut/jobs/[jobId]/captcha —
 * a person's answer to a captcha a job posted.
 *
 * Covers: 401, 403 for a non-owner, 403 `site_not_allowed`, 400 for a body
 * not in shape (two answers, none, out-of-range tap), 409 busy, 202 with the
 * `[captcha-answer]` prompt carrying the text verbatim, and the GET that tells
 * the viewer whether the site is allowed.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { MIDDLEWARE_HEADERS } from "@/config/middleware";

const { mockResolveAuthorizedOrgId, mockWorkspaceFindFirst, mockFirst, mockLive, mockLaunch } = vi.hoisted(() => ({
  mockResolveAuthorizedOrgId: vi.fn(),
  mockWorkspaceFindFirst: vi.fn(),
  mockFirst: vi.fn(),
  mockLive: vi.fn(),
  mockLaunch: vi.fn(),
}));

vi.mock("@/lib/auth/org-access", () => ({ resolveAuthorizedOrgId: mockResolveAuthorizedOrgId }));
vi.mock("@/lib/db", () => ({ db: { workspace: { findFirst: mockWorkspaceFindFirst } } }));
vi.mock("@/services/strut-jobs", () => ({
  BUSY_NOTE: "A turn of this job is still running.",
  firstJobTurn: mockFirst,
  jobHasLiveTurn: mockLive,
  launchJobTurn: mockLaunch,
}));

const { POST, GET } = await import("@/app/api/orgs/[githubLogin]/strut/jobs/[jobId]/captcha/route");
const { parseCaptchaAnswer } = await import("@/lib/strut-jobs");

const GITHUB_LOGIN = "acme-org";
const JOB = "6f1c0d3e-1111-4222-8333-444455556666";
const params = { params: Promise.resolve({ githubLogin: GITHUB_LOGIN, jobId: JOB }) };
const FIRST = { id: "row-1", workspaceId: "ws-1", swarmId: "swarm-1", userId: "user-1", conversationId: "conv-1", input: { prompt: "p", title: "Login" } };
const BASE = { round: 1, site: "login.example.com" };
const TAPS = { ...BASE, taps: [{ nx: 0.5, ny: 0.25 }] };

function request(body: unknown, authed = true, method = "POST", search = ""): NextRequest {
  const req = new NextRequest(`http://hive.test/api/orgs/${GITHUB_LOGIN}/strut/jobs/${JOB}/captcha${search}`, {
    method,
    headers: { "content-type": "application/json", host: "hive.test" },
    ...(method === "POST" ? { body: typeof body === "string" ? body : JSON.stringify(body) } : {}),
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
  vi.spyOn(console, "log").mockImplementation(() => {});
  mockResolveAuthorizedOrgId.mockResolvedValue("org-1");
  mockWorkspaceFindFirst.mockResolvedValue({ id: "ws-1", captchaAllowedSites: ["example.com"] });
  mockFirst.mockResolvedValue(FIRST);
  mockLive.mockResolvedValue(false);
  mockLaunch.mockResolvedValue({ status: "continued", jobId: JOB, title: "Login", runId: "row-2", note: "" });
});

describe("POST …/captcha", () => {
  it("401 without a session", async () => {
    expect((await POST(request(TAPS, false), params)).status).toBe(401);
    expect(mockLaunch).not.toHaveBeenCalled();
  });

  it("403 for anyone but the person who started the job", async () => {
    mockFirst.mockResolvedValueOnce({ ...FIRST, userId: "user-2" });
    expect((await POST(request(TAPS), params)).status).toBe(403);
    expect(mockLaunch).not.toHaveBeenCalled();
  });

  it("403 site_not_allowed when the workspace does not allow the site", async () => {
    mockWorkspaceFindFirst.mockResolvedValueOnce({ id: "ws-1", captchaAllowedSites: ["other.com"] });
    const res = await POST(request(TAPS), params);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "site_not_allowed" });
    expect(mockLaunch).not.toHaveBeenCalled();
  });

  it("400 for a body not in shape", async () => {
    for (const body of [
      "not json",
      {},
      BASE,
      { ...TAPS, text: "abc" },
      { ...BASE, text: "abc", skip: true },
      { ...BASE, taps: [{ nx: 1.5, ny: 0 }] },
      { ...BASE, taps: Array.from({ length: 41 }, () => ({ nx: 0, ny: 0 })) },
      { ...BASE, text: "x".repeat(201) },
      { ...TAPS, round: 0 },
    ]) {
      expect((await POST(request(body), params)).status, JSON.stringify(body)).toBe(400);
    }
    expect(mockLaunch).not.toHaveBeenCalled();
  });

  it("409 busy while a turn is in flight, or when strut refuses as busy", async () => {
    mockLive.mockResolvedValueOnce(true);
    expect((await POST(request(TAPS), params)).status).toBe(409);
    expect(mockLaunch).not.toHaveBeenCalled();
    mockLaunch.mockResolvedValueOnce({ status: "busy", jobId: JOB, note: "busy note" });
    const res = await POST(request(TAPS), params);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "busy note", busy: true });
  });

  it("202 — taps launched as the owner's next turn", async () => {
    const res = await POST(request(TAPS), params);
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ runId: "row-2" });
    expect(mockLaunch).toHaveBeenCalledWith(
      { userId: "user-1", workspaceId: "ws-1", conversationId: "conv-1", publicBaseUrl: "https://hive.test" },
      { jobId: JOB, title: "Login", prompt: `[captcha-answer] ${JSON.stringify(TAPS)}`, started: false, event: true },
    );
  });

  it("202 — the text reaches the job verbatim: capitals, spaces and all; and is never logged", async () => {
    const text = "  AbC 12 xY  ";
    const res = await POST(request({ ...BASE, text }), params);
    expect(res.status).toBe(202);
    const prompt = mockLaunch.mock.calls[0][1].prompt as string;
    expect(prompt.startsWith("[captcha-answer] ")).toBe(true);
    expect(parseCaptchaAnswer(prompt)).toEqual({ ...BASE, text });
    expect(JSON.stringify(vi.mocked(console.log).mock.calls)).not.toContain("AbC");
    expect(vi.mocked(console.log).mock.calls[0][1]).toBe(JSON.stringify({ jobId: JOB, round: 1, mode: "text", taps: 0, outcome: "sent" }));
  });

  it("202 — a skip", async () => {
    expect((await POST(request({ ...BASE, skip: true }), params)).status).toBe(202);
    expect(parseCaptchaAnswer(mockLaunch.mock.calls[0][1].prompt)).toEqual({ ...BASE, skip: true });
  });
});

describe("GET …/captcha", () => {
  it("says whether the site is allowed and whether the caller owns the job", async () => {
    const res = await GET(request(null, true, "GET", "?site=a.example.com"), params);
    expect(await res.json()).toEqual({ allowed: true, owner: true });
    mockFirst.mockResolvedValueOnce({ ...FIRST, userId: "user-2" });
    const other = await GET(request(null, true, "GET", "?site=evil.io"), params);
    expect(await other.json()).toEqual({ allowed: false, owner: false });
  });

  it("401 without a session", async () => {
    expect((await GET(request(null, false, "GET"), params)).status).toBe(401);
  });
});
