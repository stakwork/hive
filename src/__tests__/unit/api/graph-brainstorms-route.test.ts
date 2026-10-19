import { describe, test, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const access = vi.fn();
const listBrainstormRoots = vi.fn();
vi.mock("@/lib/auth/workspace-access", () => ({
  resolveWorkspaceAccess: (...a: unknown[]) => access(...a),
  requireMemberAccess: (a: { kind: string; userId?: string }) =>
    a.kind === "member" ? a : NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
}));
vi.mock("@/services/graph/workbench", () => ({ listBrainstormRoots: (...a: unknown[]) => listBrainstormRoots(...a) }));

import { GET } from "@/app/api/workspaces/[slug]/graph/brainstorms/route";

const call = () =>
  GET(new NextRequest("http://localhost/api/workspaces/hive/graph/brainstorms"), {
    params: Promise.resolve({ slug: "hive" }),
  });

beforeEach(() => {
  vi.clearAllMocks();
  access.mockResolvedValue({ kind: "member", userId: "u1" });
});

describe("GET /graph/brainstorms", () => {
  test("401 when unauthenticated", async () => {
    access.mockResolvedValue({ kind: "unauthenticated" });
    expect((await call()).status).toBe(401);
    expect(listBrainstormRoots).not.toHaveBeenCalled();
  });

  test("200 with the roots, read as the caller", async () => {
    const data = [{ ref_id: "r1", text: "Q?", job: "j", made_by: "user" }];
    listBrainstormRoots.mockResolvedValue({ ok: true, data });
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ brainstorms: data });
    expect(listBrainstormRoots).toHaveBeenCalledWith({ slug: "hive", userId: "u1" });
  });

  test("passes a service failure's status through", async () => {
    listBrainstormRoots.mockResolvedValue({ ok: false, status: 502, message: "down" });
    const res = await call();
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "down" });
  });
});
