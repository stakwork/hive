import { describe, test, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const access = vi.fn();
const save = vi.fn();
vi.mock("@/lib/auth/workspace-access", () => ({
  resolveWorkspaceAccess: (...a: unknown[]) => access(...a),
  requireMemberAccess: (a: { kind: string }) =>
    a.kind === "member" ? a : NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
}));
vi.mock("@/services/graph/brainstorm-write", () => ({
  MAX_OPS: 50,
  MAX_TEXT: 2000,
  MAX_REASON: 500,
  saveBrainstormChanges: (...a: unknown[]) => save(...a),
}));

import { POST } from "@/app/api/workspaces/[slug]/graph/brainstorms/changes/route";

const body = { root: "root", ops: [{ op: "choose", ref: "a" }] };
const call = (b: unknown = body) =>
  POST(
    new NextRequest("http://localhost/api/workspaces/hive/graph/brainstorms/changes", {
      method: "POST",
      body: JSON.stringify(b),
    }),
    {
      params: Promise.resolve({ slug: "hive" }),
    },
  );

beforeEach(() => {
  vi.clearAllMocks();
  access.mockResolvedValue({ kind: "member", userId: "u1", role: "DEVELOPER" });
  save.mockResolvedValue({ ok: true, data: { root: "root", created: {} } });
});

describe("POST /graph/brainstorms/changes", () => {
  test("401 when unauthenticated", async () => {
    access.mockResolvedValue({ kind: "unauthenticated" });
    expect((await call()).status).toBe(401);
    expect(save).not.toHaveBeenCalled();
  });

  test("403 below developer", async () => {
    access.mockResolvedValue({ kind: "member", userId: "u1", role: "STAKEHOLDER" });
    expect((await call()).status).toBe(403);
    expect(save).not.toHaveBeenCalled();
  });

  test("400 for an unknown op or no ops", async () => {
    expect((await call({ root: "root", ops: [{ op: "explode", ref: "a" }] })).status).toBe(400);
    expect((await call({ root: "root", ops: [] })).status).toBe(400);
    expect(save).not.toHaveBeenCalled();
  });

  test("saves as the caller and returns the new ids", async () => {
    save.mockResolvedValue({ ok: true, data: { root: "root", created: { t1: "n1" } } });
    const res = await call({ root: "root", ops: [{ op: "add_option", temp: "t1", parent: "root", text: "x" }] });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ root: "root", created: { t1: "n1" } });
    expect(save).toHaveBeenCalledWith(
      { slug: "hive", userId: "u1" },
      { root: "root", ops: [{ op: "add_option", temp: "t1", parent: "root", text: "x" }] },
    );
  });

  test("409 carries the conflicts and the fresh tree", async () => {
    const tree = { nodes: [], edges: [], truncated: false };
    save.mockResolvedValue({ ok: false, status: 409, message: "changed", conflicts: ["a"], tree });
    const res = await call();
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "changed", conflicts: ["a"], tree });
  });
});
