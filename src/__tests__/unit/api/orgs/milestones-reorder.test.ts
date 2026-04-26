import { describe, it, expect, vi, beforeEach, Mock } from "vitest";
import { NextRequest } from "next/server";
import { MIDDLEWARE_HEADERS } from "@/config/middleware";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("@/lib/db", () => ({
  db: {
    initiative: { findFirst: vi.fn() },
    milestone: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/auth/org-access", () => ({
  resolveAuthorizedOrgId: vi.fn(),
}));

const { db } = await import("@/lib/db");
const { resolveAuthorizedOrgId } = await import("@/lib/auth/org-access");
const mockInitiativeFindFirst = db.initiative.findFirst as Mock;
const mockMilestoneFindMany = db.milestone.findMany as Mock;
const mockTransaction = db.$transaction as Mock;
const mockResolveOrg = resolveAuthorizedOrgId as Mock;

const { POST } = await import(
  "@/app/api/orgs/[githubLogin]/initiatives/[initiativeId]/milestones/reorder/route"
);

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRequest(body: unknown, userId = "user-1"): NextRequest {
  return new NextRequest(
    "http://localhost/api/orgs/test-org/initiatives/init-1/milestones/reorder",
    {
      method: "POST",
      body: JSON.stringify(body),
      headers: {
        "Content-Type": "application/json",
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

const milestonePayload = [
  { id: "ms-1", sequence: 1 },
  { id: "ms-2", sequence: 2 },
  { id: "ms-3", sequence: 3 },
];

const updatedMilestones = [
  { id: "ms-1", sequence: 1, name: "Alpha", assignee: null },
  { id: "ms-2", sequence: 2, name: "Beta", assignee: null },
  { id: "ms-3", sequence: 3, name: "Gamma", assignee: null },
];

/**
 * What the route emits via `serializeMilestone` (every milestone
 * endpoint now returns the canonical 1:N shape with the legacy `feature`
 * shim). The Prisma mock returns the bare rows above without a
 * `features` field; the serializer fills in `features: []` +
 * `feature: null` for the wire response.
 */
const expectedSerializedMilestones = updatedMilestones.map((m) => ({
  ...m,
  features: [],
  feature: null,
}));

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("POST /milestones/reorder", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveOrg.mockResolvedValue("org-1");
    mockInitiativeFindFirst.mockResolvedValue({ id: "init-1" });
    mockMilestoneFindMany
      // First call: validate IDs exist
      .mockResolvedValueOnce(milestonePayload.map((m) => ({ id: m.id })))
      // Second call: return updated list
      .mockResolvedValueOnce(updatedMilestones);
    mockTransaction.mockResolvedValue(undefined);
  });

  it("returns 401 for unauthenticated requests", async () => {
    const req = new NextRequest(
      "http://localhost/api/orgs/test-org/initiatives/init-1/milestones/reorder",
      { method: "POST", body: JSON.stringify({ milestones: milestonePayload }) },
    );
    const res = await POST(req, baseParams);
    expect(res.status).toBe(401);
  });

  it("returns 400 when milestones array is missing", async () => {
    const res = await POST(makeRequest({}), baseParams);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/milestones array is required/i);
  });

  it("returns 400 when milestones is an empty array", async () => {
    const res = await POST(makeRequest({ milestones: [] }), baseParams);
    expect(res.status).toBe(400);
  });

  it("returns 409 when payload contains duplicate sequence values", async () => {
    const res = await POST(
      makeRequest({
        milestones: [
          { id: "ms-1", sequence: 1 },
          { id: "ms-2", sequence: 1 }, // duplicate
        ],
      }),
      baseParams,
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/duplicate sequence/i);
  });

  it("returns 404 when org is not found", async () => {
    mockResolveOrg.mockResolvedValue(null);
    const res = await POST(makeRequest({ milestones: milestonePayload }), baseParams);
    expect(res.status).toBe(404);
  });

  it("returns 404 when initiative is not found", async () => {
    mockInitiativeFindFirst.mockResolvedValue(null);
    const res = await POST(makeRequest({ milestones: milestonePayload }), baseParams);
    expect(res.status).toBe(404);
  });

  it("returns 400 when a milestone ID does not belong to the initiative", async () => {
    // Reset and re-set so only 2 of the 3 requested IDs are found
    mockMilestoneFindMany.mockReset();
    mockMilestoneFindMany.mockResolvedValueOnce([{ id: "ms-1" }, { id: "ms-2" }]);
    const res = await POST(makeRequest({ milestones: milestonePayload }), baseParams);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/do not belong to this initiative/i);
  });

  it("runs a $transaction with one update per milestone", async () => {
    const res = await POST(makeRequest({ milestones: milestonePayload }), baseParams);
    expect(res.status).toBe(200);
    expect(mockTransaction).toHaveBeenCalledTimes(1);
    const transactionArg = mockTransaction.mock.calls[0][0];
    expect(Array.isArray(transactionArg)).toBe(true);
    expect(transactionArg).toHaveLength(milestonePayload.length);
  });

  it("returns the updated milestone list ordered by sequence", async () => {
    const res = await POST(makeRequest({ milestones: milestonePayload }), baseParams);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(expectedSerializedMilestones);
  });
});
