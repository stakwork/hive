/**
 * Unit tests for POST /api/orgs/[githubLogin]/initiatives/[initiativeId]/milestones
 *
 * Verifies that:
 * - createdById is set to the authenticated user's ID
 * - assigneeId is accepted in the request body and persisted
 * - standard validation and auth guards still work
 */
import { describe, it, expect, vi, beforeEach, Mock } from "vitest";
import { NextRequest } from "next/server";
import { MIDDLEWARE_HEADERS } from "@/config/middleware";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("@/lib/db", () => ({
  db: {
    initiative: { findFirst: vi.fn() },
    milestone: { create: vi.fn() },
  },
}));

vi.mock("@/lib/auth/org-access", () => ({
  resolveAuthorizedOrgId: vi.fn(),
}));

vi.mock("@/lib/canvas", () => ({
  notifyCanvasesUpdatedByLogin: vi.fn().mockResolvedValue(undefined),
}));

const { db } = await import("@/lib/db");
const { resolveAuthorizedOrgId } = await import("@/lib/auth/org-access");
const mockInitiativeFindFirst = db.initiative.findFirst as Mock;
const mockMilestoneCreate = db.milestone.create as Mock;
const mockResolveOrg = resolveAuthorizedOrgId as Mock;

const { POST } = await import(
  "@/app/api/orgs/[githubLogin]/initiatives/[initiativeId]/milestones/route"
);

// ── Helpers ───────────────────────────────────────────────────────────────────

const USER_ID = "user-123";

function makeRequest(body: Record<string, unknown>, userId = USER_ID): NextRequest {
  return new NextRequest(
    "http://localhost/api/orgs/test-org/initiatives/init-1/milestones",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [MIDDLEWARE_HEADERS.USER_ID]: userId,
        [MIDDLEWARE_HEADERS.USER_EMAIL]: "test@example.com",
        [MIDDLEWARE_HEADERS.USER_NAME]: "Test User",
        [MIDDLEWARE_HEADERS.AUTH_STATUS]: "authenticated",
      },
      body: JSON.stringify(body),
    },
  );
}

const baseParams = {
  params: Promise.resolve({ githubLogin: "test-org", initiativeId: "init-1" }),
};

function makeMilestoneRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "ms-1",
    initiativeId: "init-1",
    name: "Test Milestone",
    description: null,
    status: "NOT_STARTED",
    sequence: 1,
    dueDate: null,
    completedAt: null,
    assigneeId: null,
    createdById: USER_ID,
    assignee: null,
    features: [],
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /api/orgs/[githubLogin]/initiatives/[initiativeId]/milestones", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveOrg.mockResolvedValue("org-1");
    mockInitiativeFindFirst.mockResolvedValue({ id: "init-1" });
    mockMilestoneCreate.mockResolvedValue(makeMilestoneRow());
  });

  it("returns 401 for unauthenticated requests", async () => {
    const req = new NextRequest(
      "http://localhost/api/orgs/test-org/initiatives/init-1/milestones",
      { method: "POST", body: JSON.stringify({ name: "Test", sequence: 1 }) },
    );
    const res = await POST(req, baseParams);
    expect(res.status).toBe(401);
  });

  it("sets createdById to the authenticated user's ID", async () => {
    const req = makeRequest({ name: "My Milestone", sequence: 1 });
    const res = await POST(req, baseParams);
    expect(res.status).toBe(201);
    expect(mockMilestoneCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ createdById: USER_ID }),
      }),
    );
  });

  it("response body includes createdById equal to the authed user's ID", async () => {
    const req = makeRequest({ name: "My Milestone", sequence: 1 });
    const res = await POST(req, baseParams);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.createdById).toBe(USER_ID);
  });

  it("accepts and persists assigneeId from request body", async () => {
    const assigneeId = "user-456";
    mockMilestoneCreate.mockResolvedValue(makeMilestoneRow({ assigneeId }));
    const req = makeRequest({ name: "Owned Milestone", sequence: 2, assigneeId });
    const res = await POST(req, baseParams);
    expect(res.status).toBe(201);
    expect(mockMilestoneCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ assigneeId }),
      }),
    );
    const body = await res.json();
    expect(body.assigneeId).toBe(assigneeId);
  });

  it("returns 400 when name is missing", async () => {
    const req = makeRequest({ sequence: 1 });
    const res = await POST(req, baseParams);
    expect(res.status).toBe(400);
  });

  it("returns 400 when sequence is missing", async () => {
    const req = makeRequest({ name: "No Seq" });
    const res = await POST(req, baseParams);
    expect(res.status).toBe(400);
  });

  it("returns 404 when org not found", async () => {
    mockResolveOrg.mockResolvedValue(null);
    const req = makeRequest({ name: "Milestone", sequence: 1 });
    const res = await POST(req, baseParams);
    expect(res.status).toBe(404);
  });

  it("returns 404 when initiative not found in org", async () => {
    mockInitiativeFindFirst.mockResolvedValue(null);
    const req = makeRequest({ name: "Milestone", sequence: 1 });
    const res = await POST(req, baseParams);
    expect(res.status).toBe(404);
  });
});
