import { describe, test, expect, vi, beforeEach } from "vitest";
import { NextRequest, NextResponse } from "next/server";

const access = vi.fn();
const save = vi.fn();
vi.mock("@/lib/auth/workspace-access", () => ({
  resolveWorkspaceAccess: (...a: unknown[]) => access(...a),
  requireMemberAccess: (a: { kind: string }) =>
    a.kind === "member" ? a : NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
}));
vi.mock("@/services/graph/initiative-write", () => ({
  MAX_OPS: 50,
  MAX_TEXT: 4000,
  saveInitiativeChanges: (...a: unknown[]) => save(...a),
}));

import { POST } from "@/app/api/workspaces/[slug]/graph/initiative-tree/changes/route";

const call = (body: unknown) =>
  POST(
    new NextRequest("http://localhost/api/workspaces/hive/graph/initiative-tree/changes", {
      method: "POST",
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ slug: "hive" }) },
  );
const edit = { root: "init", ops: [{ op: "edit", ref: "init", fields: { name: "New name" } }] };

beforeEach(() => {
  vi.clearAllMocks();
  access.mockResolvedValue({ kind: "member", userId: "u1", role: "DEVELOPER" });
});

describe("POST /graph/initiative-tree/changes", () => {
  test("401 unauthenticated, 403 below developer", async () => {
    access.mockResolvedValue({ kind: "unauthenticated" });
    expect((await call(edit)).status).toBe(401);
    access.mockResolvedValue({ kind: "member", userId: "u1", role: "STAKEHOLDER" });
    expect((await call(edit)).status).toBe(403);
    expect(save).not.toHaveBeenCalled();
  });

  test("400 on a malformed body or an unknown node type", async () => {
    expect((await call({ root: "init", ops: [] })).status).toBe(400);
    expect(
      (await call({ root: "init", ops: [{ op: "add", temp: "t", type: "Question", parent: "init", fields: {} }] }))
        .status,
    ).toBe(400);
    expect(save).not.toHaveBeenCalled();
  });

  test("passes the save through and returns what it created", async () => {
    save.mockResolvedValue({ ok: true, data: { root: "init", created: {} } });
    const res = await call(edit);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ root: "init", created: {} });
    expect(save).toHaveBeenCalledWith({ slug: "hive", userId: "u1" }, edit);
  });

  test("takes schedule and choose ops, and refuses a malformed one", async () => {
    save.mockResolvedValue({ ok: true, data: { root: "init", created: {} } });
    for (const body of [
      { root: "init", ops: [{ op: "schedule", ref: "r", milestone: "m" }] },
      { root: "init", ops: [{ op: "schedule", ref: "r", milestone: null }] },
      { root: "init", ops: [{ op: "choose", root: "q", option: "o", chosen: true }] },
    ]) {
      expect((await call(body)).status).toBe(200);
      expect(save).toHaveBeenLastCalledWith({ slug: "hive", userId: "u1" }, body);
    }
    expect((await call({ root: "init", ops: [{ op: "schedule", ref: "r" }] })).status).toBe(400);
    expect((await call({ root: "init", ops: [{ op: "choose", root: "q" }] })).status).toBe(400);
    expect((await call({ root: "init", ops: [{ op: "choose", root: "q", option: "o" }] })).status).toBe(400);
  });

  test("takes a remove op", async () => {
    save.mockResolvedValue({ ok: true, data: { root: "init", created: {} } });
    const body = { root: "init", ops: [{ op: "remove", ref: "s" }] };
    expect((await call(body)).status).toBe(200);
    expect(save).toHaveBeenCalledWith({ slug: "hive", userId: "u1" }, body);
  });

  test("a service failure keeps its status", async () => {
    save.mockResolvedValue({ ok: false, status: 404, message: "gone" });
    const res = await call(edit);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "gone" });
  });
});
