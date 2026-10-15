/**
 * Unit tests for POST /api/orgs/[githubLogin]/strut/jobs/[jobId]/claims —
 * the claims card's actions (strut plans/job-claims.md §7).
 *
 * Covers:
 *   - 401 without a session; 400 for a body not in shape
 *   - 404 when the caller is not in the org or the job is unknown / of
 *     another org; 403 for anyone but the person who started the job
 *   - verify / claim / a Supports answer go to the service as the job's
 *     owner and answer with the card it published
 *   - a refutation with a note: 409 `busy` before anything is written while
 *     a turn is in flight; otherwise the service fills the slot and the
 *     launch it is handed starts the turn as the owner, into the job's
 *     conversation (202); a launch strut refuses after the write says so
 *   - the service's refusals answered with their status
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { MIDDLEWARE_HEADERS } from "@/config/middleware";

const { mockResolveAuthorizedOrgId, mockWorkspaceFindFirst, mockFirst, mockLive, mockLaunch, mockVerify, mockAnswer, mockAdd } = vi.hoisted(() => ({
  mockResolveAuthorizedOrgId: vi.fn(),
  mockWorkspaceFindFirst: vi.fn(),
  mockFirst: vi.fn(),
  mockLive: vi.fn(),
  mockLaunch: vi.fn(),
  mockVerify: vi.fn(),
  mockAnswer: vi.fn(),
  mockAdd: vi.fn(),
}));

vi.mock("@/lib/auth/org-access", () => ({ resolveAuthorizedOrgId: mockResolveAuthorizedOrgId }));
vi.mock("@/lib/db", () => ({ db: { workspace: { findFirst: mockWorkspaceFindFirst } } }));
vi.mock("@/services/strut-jobs", () => ({
  BUSY_NOTE: "A turn of this job is still running.",
  firstJobTurn: mockFirst,
  jobHasLiveTurn: mockLive,
  launchJobTurn: mockLaunch,
}));
vi.mock("@/services/strut-jobs/claims", async () => {
  class JobClaimsError extends Error {
    constructor(
      readonly status: number,
      message: string,
    ) {
      super(message);
    }
  }
  return { JobClaimsError, verifyJobClaims: mockVerify, answerJobClaim: mockAnswer, addJobClaim: mockAdd };
});

const { POST } = await import("@/app/api/orgs/[githubLogin]/strut/jobs/[jobId]/claims/route");
const { JobClaimsError } = await import("@/services/strut-jobs/claims");

const GITHUB_LOGIN = "acme-org";
const JOB = "6f1c0d3e-1111-4222-8333-444455556666";
const params = { params: Promise.resolve({ githubLogin: GITHUB_LOGIN, jobId: JOB }) };
const FIRST = { id: "row-1", workspaceId: "ws-1", swarmId: "swarm-1", userId: "user-1", conversationId: "conv-1", input: { prompt: "p", title: "Settings page" } };
const CARD = { id: `claims-${JOB}`, kind: "claims", title: "Settings page", source: { type: "inline", content: {} } };
const ANSWER = { action: "answer", claimId: "c-save", slot: "ev-1", runId: "1792018615451", supports: false, note: "It unticks after a reload." };

function request(body: unknown, authed = true): NextRequest {
  const req = new NextRequest(`http://hive.test/api/orgs/${GITHUB_LOGIN}/strut/jobs/${JOB}/claims`, {
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
  mockVerify.mockResolvedValue({ card: CARD, summary: "1 of 2 supported" });
  mockAdd.mockResolvedValue({ card: CARD });
  mockLaunch.mockResolvedValue({ status: "continued", jobId: JOB, title: "Settings page", runId: "row-9", note: "" });
  // The service fills the slot, then calls the launch it is handed for a refutation with a note.
  mockAnswer.mockImplementation(async (_first, _job, answer, launch) =>
    !answer.supports && answer.note ? { card: null, turn: await launch(`[claim-event] refuted "x": ${answer.note}`) } : { card: CARD },
  );
});

describe("POST /api/orgs/[githubLogin]/strut/jobs/[jobId]/claims", () => {
  it("401 without a session; 400 for a body not in shape", async () => {
    expect((await POST(request({ action: "verify" }, false), params)).status).toBe(401);
    for (const body of ["not json", {}, { action: "explode" }, { ...ANSWER, supports: "no" }, { ...ANSWER, slot: "" }, { action: "claim", text: "x" }, { action: "claim", text: "", description: "y" }]) {
      expect((await POST(request(body), params)).status, JSON.stringify(body)).toBe(400);
    }
    expect(mockVerify).not.toHaveBeenCalled();
  });

  it("404 outside the org or for an unknown job; 403 for anyone but its owner", async () => {
    mockResolveAuthorizedOrgId.mockResolvedValueOnce(null);
    expect((await POST(request({ action: "verify" }), params)).status).toBe(404);
    mockFirst.mockResolvedValueOnce(null);
    expect((await POST(request({ action: "verify" }), params)).status).toBe(404);
    mockWorkspaceFindFirst.mockResolvedValueOnce(null);
    expect((await POST(request({ action: "verify" }), params)).status).toBe(404);
    mockFirst.mockResolvedValueOnce({ ...FIRST, userId: "someone-else" });
    const res = await POST(request({ action: "verify" }), params);
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/Only the person who started a job/);
    expect(mockVerify).not.toHaveBeenCalled();
  });

  it("verify and a new claim answer with the version they published", async () => {
    const verified = await POST(request({ action: "verify" }), params);
    expect(verified.status).toBe(200);
    expect(await verified.json()).toEqual({ card: CARD, summary: "1 of 2 supported" });
    expect(mockVerify).toHaveBeenCalledWith(FIRST, JOB);

    const added = await POST(request({ action: "claim", text: "The page works on a phone", description: "Open it at 375 px." }), params);
    expect(added.status).toBe(200);
    expect(mockAdd).toHaveBeenCalledWith(FIRST, JOB, { text: "The page works on a phone", description: "Open it at 375 px." });
  });

  it("Supports is a write and no turn", async () => {
    const res = await POST(request({ ...ANSWER, supports: true, note: "" }), params);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ card: CARD });
    expect(mockLive).not.toHaveBeenCalled();
    expect(mockLaunch).not.toHaveBeenCalled();
  });

  it("a refutation with a note becomes the job's next turn, as its owner, into its conversation", async () => {
    const res = await POST(request(ANSWER), params);
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ runId: "row-9" });
    expect(mockLaunch).toHaveBeenCalledWith(
      { userId: "user-1", workspaceId: "ws-1", conversationId: "conv-1", publicBaseUrl: expect.any(String) },
      { jobId: JOB, title: "Settings page", prompt: '[claim-event] refuted "x": It unticks after a reload.', started: false, event: true },
    );
  });

  it("409 busy before anything is written while a turn is in flight; a refused launch after the write says it was recorded", async () => {
    mockLive.mockResolvedValueOnce(true);
    const busy = await POST(request(ANSWER), params);
    expect(busy.status).toBe(409);
    expect(await busy.json()).toMatchObject({ busy: true });
    expect(mockAnswer).not.toHaveBeenCalled();

    mockLaunch.mockResolvedValueOnce({ status: "busy", jobId: JOB, note: "A turn of this job is still running." });
    const raced = await POST(request(ANSWER), params);
    expect(raced.status).toBe(409);
    expect(await raced.json()).toEqual({ error: "A turn of this job is still running.", busy: true, recorded: true });

    mockLaunch.mockResolvedValueOnce({ status: "error", error: "strut said no" });
    const refused = await POST(request(ANSWER), params);
    expect(refused.status).toBe(502);
    expect(await refused.json()).toEqual({ error: "strut said no", recorded: true });
  });

  it("the service's refusals keep their status", async () => {
    mockVerify.mockRejectedValueOnce(new JobClaimsError(409, "This job's swarm has no claims layer."));
    const res = await POST(request({ action: "verify" }), params);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "This job's swarm has no claims layer." });
  });
});
