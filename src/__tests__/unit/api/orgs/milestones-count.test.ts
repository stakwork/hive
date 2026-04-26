import { describe, it, expect, vi, beforeEach, Mock } from "vitest";
import { NextRequest } from "next/server";
import { MIDDLEWARE_HEADERS } from "@/config/middleware";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("@/lib/db", () => ({
  db: {
    initiative: { findFirst: vi.fn() },
    milestone: { count: vi.fn() },
  },
}));

vi.mock("@/lib/auth/org-access", () => ({
  resolveAuthorizedOrgId: vi.fn(),
}));

const { db } = await import("@/lib/db");
const { resolveAuthorizedOrgId } = await import("@/lib/auth/org-access");
const mockInitiativeFindFirst = db.initiative.findFirst as Mock;
const mockMilestoneCount = db.milestone.count as Mock;
const mockResolveOrg = resolveAuthorizedOrgId as Mock;

const { GET } = await import(
  "@/app/api/orgs/[githubLogin]/initiatives/[initiativeId]/milestones/route"
);

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRequest(userId = "user-1"): NextRequest {
  return new NextRequest(
    "http://localhost/api/orgs/test-org/initiatives/init-1/milestones",
    {
      method: "GET",
      headers: {
        [MIDDLEWARE_HEADERS.USER_ID]: userId,
        [MIDDLEWARE_HEADERS.USER_EMAIL]: "test@example.com",
        [MIDDLEWARE_HEADERS.USER_NAME]: "Test User",
        [MIDDLEWARE_HEADERS.AUTH_STATUS]: "authenticated",
      },
    },
  );
}

const baseParams = {
  params: Promise.resolve({ githubLogin: "test-org", initiativeId: "init-1" }),
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("GET /api/orgs/[githubLogin]/initiatives/[initiativeId]/milestones", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveOrg.mockResolvedValue("org-1");
    mockInitiativeFindFirst.mockResolvedValue({ id: "init-1" });
    mockMilestoneCount.mockResolvedValue(3);
  });

  it("returns 401 for unauthenticated requests", async () => {
    const req = new NextRequest(
      "http://localhost/api/orgs/test-org/initiatives/init-1/milestones",
      { method: "GET" },
    );
    const res = await GET(req, baseParams);
    expect(res.status).toBe(401);
  });

  it("returns { count: N } for an initiative with N milestones", async () => {
    mockMilestoneCount.mockResolvedValue(5);
    const res = await GET(makeRequest(), baseParams);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ count: 5 });
  });

  it("returns { count: 0 } for an initiative with zero milestones", async () => {
    mockMilestoneCount.mockResolvedValue(0);
    const res = await GET(makeRequest(), baseParams);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ count: 0 });
  });

  it("returns 404 when org is not found", async () => {
    mockResolveOrg.mockResolvedValue(null);
    const res = await GET(makeRequest(), baseParams);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toMatch(/organization not found/i);
  });

  it("returns 404 when initiative does not belong to the org", async () => {
    mockInitiativeFindFirst.mockResolvedValue(null);
    const res = await GET(makeRequest(), baseParams);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toMatch(/initiative not found/i);
  });

  it("queries milestone count scoped to the initiativeId", async () => {
    mockMilestoneCount.mockResolvedValue(2);
    await GET(makeRequest(), baseParams);
    expect(mockMilestoneCount).toHaveBeenCalledWith({
      where: { initiativeId: "init-1" },
    });
  });
});
