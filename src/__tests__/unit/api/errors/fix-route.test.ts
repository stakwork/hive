import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const m = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  issueFind: vi.fn(),
  access: vi.fn(),
  dispatch: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("@/lib/middleware/utils", () => ({ getMiddlewareContext: vi.fn(() => ({})), requireAuth: m.requireAuth }));
vi.mock("@/lib/db", () => ({ db: { errorIssue: { findUnique: m.issueFind } } }));
vi.mock("@/services/workspace", () => ({ validateWorkspaceAccessById: m.access }));
vi.mock("@/services/error-fix", () => ({ dispatchErrorFix: m.dispatch, refreshErrorFix: m.refresh }));

import { GET, POST } from "@/app/api/errors/[issueId]/fix/route";

const ctx = { params: Promise.resolve({ issueId: "iss-1" }) };
const req = (method: string) => new NextRequest("http://localhost/api/errors/iss-1/fix", { method, headers: { host: "localhost:3000" } });

beforeEach(() => {
  vi.clearAllMocks();
  m.requireAuth.mockReturnValue({ id: "u1" });
  m.issueFind.mockResolvedValue({ workspaceId: "ws-1" });
  m.access.mockResolvedValue({ hasAccess: true, canRead: true, canWrite: true });
});

describe("POST /api/errors/[issueId]/fix", () => {
  it("401 when unauthenticated", async () => {
    m.requireAuth.mockReturnValue(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
    expect((await POST(req("POST"), ctx)).status).toBe(401);
    expect(m.dispatch).not.toHaveBeenCalled();
  });

  it("404 when issue missing", async () => {
    m.issueFind.mockResolvedValue(null);
    expect((await POST(req("POST"), ctx)).status).toBe(404);
  });

  it("404 without workspace access, 404 for read-only", async () => {
    m.access.mockResolvedValue({ hasAccess: false, canRead: false, canWrite: false });
    expect((await POST(req("POST"), ctx)).status).toBe(404);
    m.access.mockResolvedValue({ hasAccess: true, canRead: true, canWrite: false });
    expect((await POST(req("POST"), ctx)).status).toBe(404);
    expect(m.dispatch).not.toHaveBeenCalled();
  });

  it("202 on dispatch", async () => {
    m.dispatch.mockResolvedValue({ status: "dispatched", fix: { fixStatus: "IN_PROGRESS" } });
    const res = await POST(req("POST"), ctx);
    expect(res.status).toBe(202);
    expect((await res.json()).data.fixStatus).toBe("IN_PROGRESS");
    expect(m.dispatch).toHaveBeenCalledWith({ issueId: "iss-1", userId: "u1", publicBaseUrl: "http://localhost:3000" });
  });

  it("409 with existing state", async () => {
    m.dispatch.mockResolvedValue({ status: "exists", fix: { fixStatus: "PR_OPENED" } });
    const res = await POST(req("POST"), ctx);
    expect(res.status).toBe(409);
    expect((await res.json()).data.fixStatus).toBe("PR_OPENED");
  });

  it("422 no repo, 502 launch failure", async () => {
    m.dispatch.mockResolvedValue({ status: "error", code: "NO_REPOSITORY", error: "nope" });
    expect((await POST(req("POST"), ctx)).status).toBe(422);
    m.dispatch.mockResolvedValue({ status: "error", code: "LAUNCH_FAILED", error: "bad" });
    expect((await POST(req("POST"), ctx)).status).toBe(502);
  });

  it("500 on unexpected throw", async () => {
    m.dispatch.mockRejectedValue(new Error("x"));
    expect((await POST(req("POST"), ctx)).status).toBe(500);
  });
});

describe("GET /api/errors/[issueId]/fix", () => {
  it("returns refreshed state for readers", async () => {
    m.access.mockResolvedValue({ hasAccess: true, canRead: true, canWrite: false });
    m.refresh.mockResolvedValue({ fixStatus: "PR_OPENED", fixPrUrl: "u" });
    const res = await GET(req("GET"), ctx);
    expect(res.status).toBe(200);
    expect((await res.json()).data.fixPrUrl).toBe("u");
  });

  it("404 without access", async () => {
    m.access.mockResolvedValue({ hasAccess: false, canRead: false, canWrite: false });
    expect((await GET(req("GET"), ctx)).status).toBe(404);
  });
});
