import { NextRequest, NextResponse } from "next/server";
import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => ({ classify: vi.fn(), findFirst: vi.fn() }));
vi.mock("@/lib/auth/caller-token", () => ({ classifyCallerToken: h.classify }));
vi.mock("@/lib/db", () => ({ db: { workspace: { findFirst: h.findFirst } } }));
vi.mock("@/lib/middleware/utils", () => ({ getMiddlewareContext: vi.fn(), requireAuth: vi.fn() }));

import { resolvePodCaller } from "@/lib/auth/pod-access";

const req = (token?: string) =>
  new NextRequest("http://localhost/x", { headers: token ? { "x-api-token": token } : {} });

beforeEach(() => vi.clearAllMocks());

describe("resolvePodCaller system token", () => {
  it("only resolves non-deleted workspaces", async () => {
    h.classify.mockResolvedValue({ kind: "system" });
    h.findFirst.mockResolvedValue({ id: "w1" });
    expect(await resolvePodCaller(req("sys"), { slug: "ws" })).toEqual({ kind: "system", workspaceId: "w1" });
    expect(h.findFirst).toHaveBeenCalledWith({ where: { slug: "ws", deleted: false }, select: { id: true } });
  });

  it("404 when no live workspace matches", async () => {
    h.classify.mockResolvedValue({ kind: "system" });
    h.findFirst.mockResolvedValue(null);
    const res = await resolvePodCaller(req("sys"), { slug: "ws" });
    expect(res).toBeInstanceOf(NextResponse);
    expect((res as NextResponse).status).toBe(404);
  });
});
