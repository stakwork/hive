import { describe, test, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const access = vi.fn();
const getChoiceTree = vi.fn();
vi.mock("@/lib/auth/workspace-access", () => ({
  resolveWorkspaceAccess: (...a: unknown[]) => access(...a),
  requireMemberAccess: (a: { kind: string; userId?: string }) =>
    a.kind === "member" ? a : NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
}));
vi.mock("@/services/graph/workbench", () => ({ getChoiceTree: (...a: unknown[]) => getChoiceTree(...a) }));

import { GET } from "@/app/api/workspaces/[slug]/graph/choice-tree/route";

const call = (qs: string) =>
  GET(new NextRequest(`http://localhost/api/workspaces/hive/graph/choice-tree${qs}`), {
    params: Promise.resolve({ slug: "hive" }),
  });

beforeEach(() => {
  vi.clearAllMocks();
  access.mockResolvedValue({ kind: "member", userId: "u1" });
});

describe("GET /graph/choice-tree", () => {
  test("401 when unauthenticated", async () => {
    access.mockResolvedValue({ kind: "unauthenticated" });
    expect((await call("?focus=abc")).status).toBe(401);
  });

  test("400 without focus, and on a service validation failure", async () => {
    expect((await call("")).status).toBe(400);
    getChoiceTree.mockResolvedValue({ ok: false, status: 400, message: "Invalid label" });
    const res = await call("?focus=abc&label=bad%60");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid label" });
  });

  test("200 with the tree, labels defaulting to the service's (both)", async () => {
    const data = { nodes: [{ ref_id: "abc", type: "Question", properties: {} }], edges: [], truncated: false };
    getChoiceTree.mockResolvedValue({ ok: true, data });
    const res = await call("?focus=abc");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(data);
    expect(getChoiceTree).toHaveBeenCalledWith({ slug: "hive", userId: "u1" }, "abc", undefined);
  });

  test("the legacy label param narrows to one label, or a comma list", async () => {
    getChoiceTree.mockResolvedValue({ ok: true, data: { nodes: [], edges: [], truncated: false } });
    await call("?focus=abc&label=Choice");
    expect(getChoiceTree).toHaveBeenLastCalledWith({ slug: "hive", userId: "u1" }, "abc", ["Choice"]);
    await call("?focus=abc&label=Choice,%20Question");
    expect(getChoiceTree).toHaveBeenLastCalledWith({ slug: "hive", userId: "u1" }, "abc", ["Choice", "Question"]);
  });
});
