/**
 * Unit tests for GET /api/orgs/[githubLogin]/strut/canvas-jobs — the jobs
 * on an initiative's canvas cards, for any member of the org.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { MIDDLEWARE_HEADERS } from "@/config/middleware";

const { mockResolveAuthorizedOrgId, mockList } = vi.hoisted(() => ({
  mockResolveAuthorizedOrgId: vi.fn(),
  mockList: vi.fn(),
}));

vi.mock("@/lib/auth/org-access", () => ({ resolveAuthorizedOrgId: mockResolveAuthorizedOrgId }));
vi.mock("@/services/canvas-jobs", () => ({ listCanvasJobs: mockList }));
vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const { GET } = await import("@/app/api/orgs/[githubLogin]/strut/canvas-jobs/route");

const params = { params: Promise.resolve({ githubLogin: "acme-gh" }) };

function request(query: string, authed = true): NextRequest {
  const req = new NextRequest(`http://hive.test/api/orgs/acme-gh/strut/canvas-jobs${query}`);
  if (authed) {
    req.headers.set(MIDDLEWARE_HEADERS.USER_ID, "user-2");
    req.headers.set(MIDDLEWARE_HEADERS.USER_EMAIL, "t@e.com");
    req.headers.set(MIDDLEWARE_HEADERS.USER_NAME, "T");
    req.headers.set(MIDDLEWARE_HEADERS.AUTH_STATUS, "authenticated");
  }
  return req;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockResolveAuthorizedOrgId.mockResolvedValue("org-1");
  mockList.mockResolvedValue({ jobs: [], artifactsByRef: {} });
});

describe("GET /api/orgs/[githubLogin]/strut/canvas-jobs", () => {
  it("401 without a session", async () => {
    expect((await GET(request("?initiative=init-1", false), params)).status).toBe(401);
  });

  it("400 without a well-formed initiative ref", async () => {
    expect((await GET(request(""), params)).status).toBe(400);
    expect((await GET(request("?initiative=a%20b"), params)).status).toBe(400);
    expect(mockList).not.toHaveBeenCalled();
  });

  it("404 for someone outside the org", async () => {
    mockResolveAuthorizedOrgId.mockResolvedValue(null);
    expect((await GET(request("?initiative=init-1"), params)).status).toBe(404);
    expect(mockList).not.toHaveBeenCalled();
  });

  it("any member reads the initiative's jobs as themselves", async () => {
    const read = {
      jobs: [
        {
          jobId: "j-1",
          title: "Build",
          state: "done",
          startedBy: { id: "user-1", name: "Ana" },
          refId: "feat-1",
          initiativeRefId: "init-1",
          updatedAt: 1,
        },
      ],
      artifactsByRef: {},
    };
    mockList.mockResolvedValue(read);
    const res = await GET(request("?initiative=init-1"), params);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(read);
    expect(mockResolveAuthorizedOrgId).toHaveBeenCalledWith("acme-gh", "user-2", false);
    expect(mockList).toHaveBeenCalledWith("org-1", "user-2", "init-1");
  });

  it("500 when the read fails", async () => {
    mockList.mockRejectedValue(new Error("db down"));
    expect((await GET(request("?initiative=init-1"), params)).status).toBe(500);
  });
});
