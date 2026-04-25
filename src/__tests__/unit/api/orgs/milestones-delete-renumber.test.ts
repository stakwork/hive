import { describe, it, expect, vi, beforeEach, Mock } from "vitest";
import { NextRequest } from "next/server";
import { MIDDLEWARE_HEADERS } from "@/config/middleware";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("@/lib/db", () => ({
  db: {
    milestone: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      delete: vi.fn(),
      updateMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/auth/org-access", () => ({
  resolveAuthorizedOrgId: vi.fn(),
}));

const { db } = await import("@/lib/db");
const { resolveAuthorizedOrgId } = await import("@/lib/auth/org-access");
const mockFindFirst = db.milestone.findFirst as Mock;
const mockFindUnique = db.milestone.findUnique as Mock;
const mockFindMany = db.milestone.findMany as Mock;
const mockTransaction = db.$transaction as Mock;
const mockResolveOrg = resolveAuthorizedOrgId as Mock;

const { DELETE } = await import(
  "@/app/api/orgs/[githubLogin]/initiatives/[initiativeId]/milestones/[milestoneId]/route"
);

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeAuthRequest(url: string): NextRequest {
  return new NextRequest(url, {
    headers: {
      [MIDDLEWARE_HEADERS.USER_ID]: "user-1",
      [MIDDLEWARE_HEADERS.USER_EMAIL]: "test@example.com",
      [MIDDLEWARE_HEADERS.USER_NAME]: "Test User",
      [MIDDLEWARE_HEADERS.AUTH_STATUS]: "authenticated",
    },
  });
}

const baseParams = {
  params: Promise.resolve({
    githubLogin: "test-org",
    initiativeId: "init-1",
    milestoneId: "ms-1",
  }),
};

const sibling = { id: "ms-2", sequence: 1, name: "Sibling", assignee: null };

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("DELETE /milestones/[milestoneId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveOrg.mockResolvedValue("org-1");
    mockFindFirst.mockResolvedValue({ id: "ms-1" });
  });

  it("returns 401 for unauthenticated requests", async () => {
    const req = new NextRequest(
      "http://localhost/api/orgs/test-org/initiatives/init-1/milestones/ms-1",
    );
    const res = await DELETE(req, baseParams);
    expect(res.status).toBe(401);
  });

  it("returns { status: 'deleted' } without renumber param (no regression)", async () => {
    mockTransaction.mockResolvedValue(undefined);
    const req = makeAuthRequest(
      "http://localhost/api/orgs/test-org/initiatives/init-1/milestones/ms-1",
    );
    const res = await DELETE(req, baseParams);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ status: "deleted" });
    // $transaction should NOT be called in non-renumber path
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("returns { status: 'deleted' } with renumber=false (no regression)", async () => {
    const req = makeAuthRequest(
      "http://localhost/api/orgs/test-org/initiatives/init-1/milestones/ms-1?renumber=false",
    );
    const res = await DELETE(req, baseParams);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ status: "deleted" });
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("returns { status: 'deleted', milestones } with renumber=true", async () => {
    mockFindUnique.mockResolvedValue({ sequence: 2 });
    mockTransaction.mockResolvedValue(undefined);
    mockFindMany.mockResolvedValue([sibling]);

    const req = makeAuthRequest(
      "http://localhost/api/orgs/test-org/initiatives/init-1/milestones/ms-1?renumber=true",
    );
    const res = await DELETE(req, baseParams);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("deleted");
    expect(body.milestones).toEqual([sibling]);
  });

  it("runs delete + updateMany in $transaction when renumber=true", async () => {
    mockFindUnique.mockResolvedValue({ sequence: 2 });
    mockTransaction.mockResolvedValue(undefined);
    mockFindMany.mockResolvedValue([sibling]);

    const req = makeAuthRequest(
      "http://localhost/api/orgs/test-org/initiatives/init-1/milestones/ms-1?renumber=true",
    );
    await DELETE(req, baseParams);

    expect(mockTransaction).toHaveBeenCalledTimes(1);
    // The transaction receives an array of two prisma ops
    const transactionArg = mockTransaction.mock.calls[0][0];
    expect(Array.isArray(transactionArg)).toBe(true);
    expect(transactionArg).toHaveLength(2);
  });

  it("returns 404 when milestone does not belong to the initiative", async () => {
    mockFindFirst.mockResolvedValue(null);
    const req = makeAuthRequest(
      "http://localhost/api/orgs/test-org/initiatives/init-1/milestones/ms-1",
    );
    const res = await DELETE(req, baseParams);
    expect(res.status).toBe(404);
  });

  it("returns 404 when org is not found", async () => {
    mockResolveOrg.mockResolvedValue(null);
    const req = makeAuthRequest(
      "http://localhost/api/orgs/test-org/initiatives/init-1/milestones/ms-1",
    );
    const res = await DELETE(req, baseParams);
    expect(res.status).toBe(404);
  });
});
