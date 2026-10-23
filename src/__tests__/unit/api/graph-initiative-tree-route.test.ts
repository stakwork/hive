import { describe, test, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const access = vi.fn();
const getInitiativeTree = vi.fn();
vi.mock("@/lib/auth/workspace-access", () => ({
  resolveWorkspaceAccess: (...a: unknown[]) => access(...a),
  requireMemberAccess: (a: { kind: string; userId?: string }) =>
    a.kind === "member" ? a : NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
}));
vi.mock("@/services/graph/workbench", () => ({ getInitiativeTree: (...a: unknown[]) => getInitiativeTree(...a) }));

import { GET } from "@/app/api/workspaces/[slug]/graph/initiative-tree/route";

const call = (qs: string) =>
  GET(new NextRequest(`http://localhost/api/workspaces/hive/graph/initiative-tree${qs}`), {
    params: Promise.resolve({ slug: "hive" }),
  });

beforeEach(() => {
  vi.clearAllMocks();
  access.mockResolvedValue({ kind: "member", userId: "u1" });
});

describe("GET /graph/initiative-tree", () => {
  test("401 when unauthenticated", async () => {
    access.mockResolvedValue({ kind: "unauthenticated" });
    expect((await call("?focus=abc")).status).toBe(401);
    expect(getInitiativeTree).not.toHaveBeenCalled();
  });

  test("400 without focus, and passes a service failure through", async () => {
    expect((await call("")).status).toBe(400);
    getInitiativeTree.mockResolvedValue({ ok: false, status: 400, message: "Invalid ref_id" });
    const res = await call("?focus=bad%27");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid ref_id" });
  });

  test("200 with the tree for the caller", async () => {
    const data = {
      nodes: [],
      edges: [],
      stage: { milestones: 0, features: 0, stories: 0, requirements: 0, unaccepted: 0 },
      truncated: false,
    };
    getInitiativeTree.mockResolvedValue({ ok: true, data });
    const res = await call("?focus=abc");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(data);
    expect(getInitiativeTree).toHaveBeenCalledWith({ slug: "hive", userId: "u1" }, "abc");
  });
});
