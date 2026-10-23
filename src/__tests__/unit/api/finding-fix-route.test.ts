import { describe, expect, it, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

vi.mock("@/lib/auth/workspace-access", () => ({ resolveWorkspaceAccess: vi.fn() }));
vi.mock("@/lib/protect/access", () => ({ requireProtectMemberAccess: vi.fn() }));
vi.mock("@/lib/feature-flags", () => ({
  canAccessServerFeature: vi.fn(() => true),
  FEATURE_FLAGS: { CODEBASE_RECOMMENDATION: "x" },
}));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: vi.fn(async () => ({ allowed: true })) }));

vi.mock("@/services/system-map/finding-fix", async () => {
  class FindingFixError extends Error {
    constructor(
      message: string,
      public status: number,
    ) {
      super(message);
    }
  }
  return { FindingFixError, listFixes: vi.fn(), startFindingFixes: vi.fn() };
});

import { requireProtectMemberAccess } from "@/lib/protect/access";
import { FindingFixError, listFixes, startFindingFixes } from "@/services/system-map/finding-fix";
import { GET, POST } from "@/app/api/workspaces/[slug]/system-map/findings/fix/route";

const params = { params: Promise.resolve({ slug: "ws" }) };
const post = (body: unknown) =>
  new NextRequest("http://localhost/api/workspaces/ws/system-map/findings/fix", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const member = (role: string) => ({ workspaceId: "w1", slug: "ws", userId: "u1", role });

describe("findings/fix route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireProtectMemberAccess).mockReturnValue(member("DEVELOPER") as never);
  });

  it("passes through access denials", async () => {
    vi.mocked(requireProtectMemberAccess).mockReturnValue(NextResponse.json({ error: "no" }, { status: 403 }) as never);
    expect((await POST(post({ refIds: ["a"] }), params)).status).toBe(403);
    expect((await GET(post({}), params)).status).toBe(403);
  });

  it("requires developer role to POST", async () => {
    vi.mocked(requireProtectMemberAccess).mockReturnValue(member("VIEWER") as never);
    expect((await POST(post({ refIds: ["a"] }), params)).status).toBe(403);
    expect(startFindingFixes).not.toHaveBeenCalled();
  });

  it("validates refIds", async () => {
    expect((await POST(post({}), params)).status).toBe(400);
    expect((await POST(post({ refIds: ["bad id!"] }), params)).status).toBe(400);
  });

  it("returns 202 when fixes start, including refused ones", async () => {
    vi.mocked(startFindingFixes).mockResolvedValue({
      started: [{ id: "x" } as never],
      refused: [{ refId: "b", reason: "no" }],
    });
    const res = await POST(post({ refIds: ["a", "b"] }), params);
    expect(res.status).toBe(202);
    expect(await res.json()).toMatchObject({ refused: [{ refId: "b" }] });
    expect(startFindingFixes).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: "w1", userId: "u1", refIds: ["a", "b"] }),
    );
  });

  it("returns 409 when nothing could start (unconfirmed / already fixing)", async () => {
    vi.mocked(startFindingFixes).mockResolvedValue({
      started: [],
      refused: [{ refId: "a", reason: "A fix for this finding is already in progress" }],
    });
    const res = await POST(post({ refIds: ["a"] }), params);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/already in progress/);
  });

  it("maps service errors such as the bulk cap", async () => {
    vi.mocked(startFindingFixes).mockRejectedValue(
      new FindingFixError("At most 10 findings can be fixed at once", 400),
    );
    const res = await POST(post({ refIds: ["a"] }), params);
    expect(res.status).toBe(400);
  });

  it("GET lists fixes", async () => {
    vi.mocked(listFixes).mockResolvedValue([{ id: "x" } as never]);
    const res = await GET(post({}), params);
    expect(await res.json()).toEqual({ fixes: [{ id: "x" }] });
  });
});
